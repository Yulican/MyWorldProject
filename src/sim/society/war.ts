import { DIRECTION_COUNT, hexDistance } from '../hex';
import { MinHeap } from '../minHeap';
import { createRng, deriveSeed, type Rng } from '../rng';
import { isWaterBiome } from '../world/biomes';
import { Deposit } from '../world/deposits';
import { addRoad, stepCost } from '../world/roads';
import { BUILDINGS } from './buildings';
import { BO, BI, Defense, fightBattle, givesUp, remainingSoldiers } from './battle';
import { PAIRS, addMood, rebuildPartners } from './diplomacy';
import { updateCellSupply } from './economy';
import { MIL, TROOP_TYPES } from './military';
import { SupplyKind, type SupplyModifier } from './supply';
import { hasSeat, satisfactionTarget } from './satisfaction';
import { changeCiv, record, type Simulation } from './simulation';

// War on the map, phase 3a + 3b ("Design Documents/Requirement Krieg.md",
// sections 4 to 6): declaration, armies, march, battles, siege, occupation,
// peace and conquest.
//
// Soldiers stay in their cells' counters (military.soldiers), so pay,
// training and strength work as before; an army is a count of soldiers
// "away" from their cells (`away`), with a position. Casualties are taken
// from the cells. Everything lives in flat typed arrays: wars by war slot,
// armies by army slot, the rest by cell or people. Nothing is allocated per
// week; the yearly part allocates nothing either, events (a war's start, a
// siege, its end) only a few strings and the siege's supply modifiers.
//
// Simplifications kept from the simulated prototype (the numbers were chosen
// with them):
// - Armies gather instantly at their anchor (the settlements with the most
//   soldiers), and the cells' soldiers are counted to the nearest anchor.
// - A beaten army is gone: its soldiers go home (a draw sends both home).
// - Only the war goal is besieged; armies march to it and nowhere else, so no
//   other seat is ever occupied (nothing to give back at the war's end).
// - Relief armies and the garrison of the seat fight as one pool; the 30 %
//   left at home do not fight.
// - "Besieged" halves the natural food, water and space of the seat's
//   settlement (a supply modifier), not its buildings' share.
// - Exhaustion counts the attacker's successes (battles won, occupation).
// - Armies are raised again each year while the war runs (up to the caps).
// - Defenders are also made to fight in the last month before every yearly
//   check after an occupation.
// - The attacker withdraws from a siege when its besiegers fall below half of
//   their largest strength there.

/**
 * The war's numbers (chosen by the user after the simulation, section 14/15).
 * Mutable only so tools/warMapStats.ts can compare values; `enabled` = 0 is
 * the tools' baseline without war.
 */
export const WAR = {
  /** 1 = wars happen (the game); 0 only for the stats tools' baseline. */
  enabled: 1,
  /** Declaration: own strength at least this times the target's; yearly chance per people with a candidate. */
  ratio: 2,
  chance: 0.1,
  /** Benefit of a district: inhabitants + resPop per deposit (x resMul for strategic and luxury deposits), divided by 1 + its defenders. */
  resPop: 50,
  resMul: 2,
  /** Armies: share of a people's soldiers that march, armies per people and worldwide, smallest army, hexes between anchors. */
  sendShare: 0.7,
  maxArmies: 4,
  worldArmies: 32,
  armyMin: 5,
  anchorSep: 3,
  /** Travel cost per week (a road hex costs mostly 0.5), cost limit of the path search, weeks without a path before an army goes home. */
  speed: 1,
  fieldMax: 25,
  noTargetWeeks: 104,
  /** Siege: "Besieged" satisfaction part, weeks of siege before the first occupation check, weeks between checks. */
  siegeMalus: 40,
  occupyWeeks: 104,
  occupyCheck: 52,
  /** The attacker withdraws below this share of its largest siege strength; defenders must fight this many weeks before a check. */
  withdraw: 0.5,
  forceWeeks: 4,
  /** Share of the seat's treasury the conqueror keeps, the "Conquered" part and the years it fades over. */
  loot: 0.5,
  conqMalus: 15,
  conqYears: 10,
  /** Years without an attacker success before peace by exhaustion, years of truce, trust lost after the war. */
  exhaustYears: 10,
  truceYears: 20,
  trustLoss: 30,
};

/** Army slots (WAR.worldArmies is at most this). */
export const MAX_ARMIES = 32;
/** War slots. A war needs room for two armies when it starts, so 16 would do; spare slots for wars whose armies are gone. */
export const MAX_WARS = 24;
const TICKS_PER_YEAR = 52;

/** How a war ended. */
export const EndType = { GaveUp: 0, AttackerGaveUp: 1, Exhausted: 2, GoalLost: 3, Vanished: 4 } as const;
export const END_NAMES = ['defender gave up', 'attacker gave up', 'exhaustion', 'goal lost', 'a people vanished'] as const;

/** Tools only: a clock to measure the war parts (e.g. performance.now); the simulation never reads the time itself. */
export const WAR_PROFILE: { clock: (() => number) | null } = { clock: null };

export type WarStats = {
  declared: number;
  /** Declarations that found no room for armies (WAR.worldArmies). */
  capBlocked: number;
  /** Ended wars per EndType. */
  ended: Int32Array;
  battles: number;
  battleWinsAtt: number;
  battleWinsDef: number;
  battleDraws: number;
  armiesRaised: number;
  maxArmies: number;
  maxWars: number;
  sieges: number;
  occupations: number;
  /** Siege ends: no besieger left, attacker withdrew. */
  siegeBroken: number;
  siegeWithdrew: number;
  /** First occupation checks: count, below 0, sum of satisfaction and of target; satisfaction at siege starts. */
  checks: number;
  checksBelow: number;
  checkSat: number;
  checkTarget: number;
  startSat: number;
  /** Settlements and people that changed hands, whole peoples annexed, conquest roads. */
  cellsMoved: number;
  peopleMoved: number;
  annexed: number;
  roads: number;
  /** Wars without any battle, against a people without strength. */
  noBattle: number;
  zeroDefender: number;
  /** Against established peoples (not the attacker's own splinters). */
  estDeclared: number;
  estBattles: number;
  estSieges: number;
  estOcc: number;
  estAnnexed: number;
  /** Summed durations (ticks) of the ended wars. */
  durationSum: number;
  /** WAR_PROFILE: ms of the weekly and yearly parts (sum, calls, worst). */
  weekMs: number;
  weekCalls: number;
  weekMax: number;
  yearMs: number;
  yearCalls: number;
  yearMax: number;
};

export type WarState = {
  /** Per people: the people it is at war with, 0 = none (one war per people). */
  enemy: Uint8Array;
  /** Per people: its war's slot, -1 = none. */
  civWar: Int8Array;
  /** Running wars, and per war slot: */
  wars: number;
  wLive: Uint8Array;
  wAtt: Uint8Array;
  wDef: Uint8Array;
  /** The goal seat (cell). */
  wGoal: Int32Array;
  wStart: Int32Array;
  /** Tick of the attacker's last success (battle won, occupation). */
  wLastGain: Int32Array;
  /** Tick the siege of the goal began (-1 = none), the besiegers' largest strength. */
  wSiegeStart: Int32Array;
  wSiegeStrength: Float64Array;
  /** 1 once the goal seat is occupied (the siege goes on until the war ends or relief breaks it). */
  wOccupied: Uint8Array;
  /** 1 if the defender arose from the attacker (secession, revolution). Statistics only. */
  wSplinter: Uint8Array;
  wBattles: Uint16Array;
  /** End queued during the week (EndType), -1 = none. */
  wEnd: Int8Array;
  /** Travel cost to the goal per war, side (0 attacker, 1 defender) and cell: ((war * 2 + side) * cellCount + cell). */
  field: Float32Array;
  /** Armies, per army slot: */
  armies: number;
  live: Uint8Array;
  aCiv: Uint8Array;
  aWar: Int8Array;
  aCell: Int32Array;
  /** Soldiers and strategic factor per troop type (army * TROOP_TYPES + type). */
  aN: Float64Array;
  aFac: Float64Array;
  /** Travel cost walked towards the next hex, weeks without a path. */
  aProg: Float32Array;
  aIdle: Uint16Array;
  /** Tick the army reached its hex. */
  aSince: Int32Array;
  /** Per cell and troop type: soldiers of the cell that are in an army. */
  away: Uint16Array;
  /** Per cell: 1 while the settlement is besieged, and its "Besieged" part (negative). */
  siege: Uint8Array;
  siegeValue: Float32Array;
  /** Per cell: the "Conquered" part, the tick it began and the tick it is gone (it fades linearly; satisfaction.ts). */
  conqValue: Float32Array;
  conqTick: Int32Array;
  conqUntil: Int32Array;
  /** Per people pair (min * PAIRS + max): tick the truce ends (0 = none). */
  truce: Int32Array;
  /** Counts every change the map shows (armies moved, wars, sieges). */
  version: number;
  rng: Rng;
  stats: WarStats;
};

export function createWar(seed: number, cellCount: number): WarState {
  return {
    enemy: new Uint8Array(PAIRS),
    civWar: new Int8Array(PAIRS).fill(-1),
    wars: 0,
    wLive: new Uint8Array(MAX_WARS),
    wAtt: new Uint8Array(MAX_WARS),
    wDef: new Uint8Array(MAX_WARS),
    wGoal: new Int32Array(MAX_WARS).fill(-1),
    wStart: new Int32Array(MAX_WARS),
    wLastGain: new Int32Array(MAX_WARS),
    wSiegeStart: new Int32Array(MAX_WARS).fill(-1),
    wSiegeStrength: new Float64Array(MAX_WARS),
    wOccupied: new Uint8Array(MAX_WARS),
    wSplinter: new Uint8Array(MAX_WARS),
    wBattles: new Uint16Array(MAX_WARS),
    wEnd: new Int8Array(MAX_WARS).fill(-1),
    field: new Float32Array(MAX_WARS * 2 * cellCount),
    armies: 0,
    live: new Uint8Array(MAX_ARMIES),
    aCiv: new Uint8Array(MAX_ARMIES),
    aWar: new Int8Array(MAX_ARMIES).fill(-1),
    aCell: new Int32Array(MAX_ARMIES),
    aN: new Float64Array(MAX_ARMIES * TROOP_TYPES),
    aFac: new Float64Array(MAX_ARMIES * TROOP_TYPES),
    aProg: new Float32Array(MAX_ARMIES),
    aIdle: new Uint16Array(MAX_ARMIES),
    aSince: new Int32Array(MAX_ARMIES),
    away: new Uint16Array(cellCount * TROOP_TYPES),
    siege: new Uint8Array(cellCount),
    siegeValue: new Float32Array(cellCount),
    conqValue: new Float32Array(cellCount),
    conqTick: new Int32Array(cellCount),
    conqUntil: new Int32Array(cellCount),
    truce: new Int32Array(PAIRS * PAIRS),
    version: 0,
    rng: createRng(deriveSeed(seed, 'war')),
    stats: {
      declared: 0,
      capBlocked: 0,
      ended: new Int32Array(END_NAMES.length),
      battles: 0,
      battleWinsAtt: 0,
      battleWinsDef: 0,
      battleDraws: 0,
      armiesRaised: 0,
      maxArmies: 0,
      maxWars: 0,
      sieges: 0,
      occupations: 0,
      siegeBroken: 0,
      siegeWithdrew: 0,
      checks: 0,
      checksBelow: 0,
      checkSat: 0,
      checkTarget: 0,
      startSat: 0,
      cellsMoved: 0,
      peopleMoved: 0,
      annexed: 0,
      roads: 0,
      noBattle: 0,
      zeroDefender: 0,
      estDeclared: 0,
      estBattles: 0,
      estSieges: 0,
      estOcc: 0,
      estAnnexed: 0,
      durationSum: 0,
      weekMs: 0,
      weekCalls: 0,
      weekMax: 0,
      yearMs: 0,
      yearCalls: 0,
      yearMax: 0,
    },
  };
}

const pairKey = (a: number, b: number) => (a < b ? a * PAIRS + b : b * PAIRS + a);

/** Whether a new war between a and b is barred by a truce. */
export function inTruce(sim: Simulation, a: number, b: number): boolean {
  return sim.tick < sim.war.truce[pairKey(a, b)];
}

/** A new people takes id `id` (a reused one): no war, no truce from the old people of that id. */
export function resetWarCiv(sim: Simulation, id: number): void {
  const w = sim.war;
  const s = w.civWar[id];
  if (s >= 0 && w.wLive[s]) endWar(sim, s, EndType.Vanished);
  w.enemy[id] = 0;
  w.civWar[id] = -1;
  for (let b = 0; b < PAIRS; b++) w.truce[pairKey(id, b)] = 0;
}

// ---------------------------------------------------------------------------
// Yearly: end checks, new armies, declarations

let adj = new Uint8Array(0);
const candidate = new Uint8Array(PAIRS);
let bPop = new Float64Array(0);
let bRes = new Float64Array(0);
let bDef = new Float64Array(0);
let bBorder = new Uint8Array(0);
let bCells = new Uint16Array(0);
let touched = new Int32Array(0);
/** Deposits that count resMul times: luxury deposits (a building harvests them) and the strategic iron and flint. */
const DOUBLE_DEPOSIT = new Uint8Array(32);
{
  for (const b of BUILDINGS) if (b.deposit) DOUBLE_DEPOSIT[b.deposit] = 1;
  DOUBLE_DEPOSIT[Deposit.Iron] = 1;
  DOUBLE_DEPOSIT[Deposit.Flint] = 1;
}

function clockStart(): number {
  return WAR_PROFILE.clock ? WAR_PROFILE.clock() : 0;
}

/** The war's yearly part (simulation.ts: WAR_WEEK): end checks and new armies for the running wars, then declarations. */
export function runWarYear(sim: Simulation): void {
  if (!WAR.enabled) return;
  const t0 = clockStart();
  const w = sim.war;
  const m = sim.military;
  for (let s = 0; s < MAX_WARS; s++) {
    if (!w.wLive[s]) continue;
    if (endIfGone(sim, s)) continue;
    const att = w.wAtt[s];
    const def = w.wDef[s];
    const sa = m.strength[att] ?? 0;
    const sd = m.strength[def] ?? 0;
    if (defenderGivesUp(w, s, sd, sa)) endWar(sim, s, EndType.GaveUp);
    else if (givesUp(sa, sd)) endWar(sim, s, EndType.AttackerGaveUp);
    else if (sim.tick - w.wLastGain[s] >= WAR.exhaustYears * TICKS_PER_YEAR) endWar(sim, s, EndType.Exhausted);
    else {
      reraise(sim, s, att);
      reraise(sim, s, def);
    }
  }
  declareWars(sim);
  if (WAR_PROFILE.clock) {
    const dt = WAR_PROFILE.clock() - t0;
    w.stats.yearMs += dt;
    w.stats.yearCalls++;
    if (dt > w.stats.yearMax) w.stats.yearMax = dt;
  }
}

/** The defender gives up only once the goal seat is occupied, and then below BATTLE.giveUp of the attacker's strength. */
function defenderGivesUp(w: WarState, s: number, sd: number, sa: number): boolean {
  return w.wOccupied[s] === 1 && givesUp(sd, sa);
}

/** Ends war `s` if a side vanished or the goal seat is no longer the defender's; true if it ended. */
function endIfGone(sim: Simulation, s: number): boolean {
  const w = sim.war;
  if (!sim.civs[w.wAtt[s]] || !sim.civs[w.wDef[s]]) {
    endWar(sim, s, EndType.Vanished);
    return true;
  }
  const goal = w.wGoal[s];
  if (sim.world.owner[goal] !== w.wDef[s] || sim.cellPop[goal] === 0) {
    endWar(sim, s, EndType.GoalLost);
    return true;
  }
  return false;
}

function countArmies(w: WarState, s: number, civ: number): number {
  let k = 0;
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a] && w.aWar[a] === s && w.aCiv[a] === civ) k++;
  return k;
}

function worldRoom(w: WarState): number {
  return Math.min(WAR.worldArmies, MAX_ARMIES) - w.armies;
}

function reraise(sim: Simulation, s: number, civ: number): void {
  const w = sim.war;
  const room = Math.min(WAR.maxArmies - countArmies(w, s, civ), worldRoom(w));
  if (room > 0) raiseArmies(sim, s, civ, room);
}

/** Fills `adj` (civs x civs): 1 where two peoples have settlements on adjacent hexes (a common border). */
function findNeighbors(sim: Simulation): number {
  const world = sim.world;
  const owner = world.owner;
  const n = world.cellCount;
  const civs = sim.civs.length;
  if (adj.length < civs * civs) adj = new Uint8Array(civs * civs);
  adj.fill(0, 0, civs * civs);
  for (let c = 0; c < n; c++) {
    const a = owner[c];
    if (a === 0 || sim.cellPop[c] === 0) continue;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0) continue;
      const b = owner[nb];
      if (b !== 0 && b !== a && sim.cellPop[nb] > 0) adj[a * civs + b] = 1;
    }
  }
  return civs;
}

/** Marks in `candidate` the peoples `a` may declare war on (findNeighbors first); false if none or `a` is at war. */
function markCandidates(sim: Simulation, a: number, civs: number): boolean {
  const w = sim.war;
  const m = sim.military;
  candidate.fill(0);
  if (!sim.civs[a] || w.enemy[a] !== 0) return false;
  const sa = m.strength[a] ?? 0;
  let any = false;
  for (let b = 1; b < civs; b++) {
    if (b === a || !sim.civs[b] || w.enemy[b] !== 0 || adj[a * civs + b] === 0 || inTruce(sim, a, b)) continue;
    if (sa < WAR.ratio * (m.strength[b] ?? 0)) continue;
    candidate[b] = 1;
    any = true;
  }
  return any;
}

/**
 * The peoples `a` may declare war on now: neighbors (a common border), at
 * least WAR.ratio times weaker, not in a truce with it, and neither side at war.
 */
export function warTargets(sim: Simulation, a: number): number[] {
  const civs = findNeighbors(sim);
  const list: number[] = [];
  if (markCandidates(sim, a, civs)) for (let b = 1; b < civs; b++) if (candidate[b]) list.push(b);
  return list;
}

/** Every people with a target rolls WAR.chance; the winner picks its goal and declares. */
function declareWars(sim: Simulation): void {
  const w = sim.war;
  const civs = findNeighbors(sim);
  for (let a = 1; a < civs; a++) {
    if (!markCandidates(sim, a, civs) || w.rng() >= WAR.chance) continue;
    if (worldRoom(w) < 2 || w.wars >= MAX_WARS) {
      w.stats.capBlocked++;
      continue;
    }
    const goal = chooseGoal(sim, a, candidate);
    if (goal >= 0) startWar(sim, a, goal);
  }
}

/**
 * The seat to take: among the districts of the candidate peoples that hold a
 * settlement next to one of the attacker's, the one with the largest benefit
 * (inhabitants + WAR.resPop per deposit, strategic and luxury deposits
 * WAR.resMul times, divided by 1 + the district's soldiers); -1 if none.
 * Ties: the lower seat cell.
 */
export function chooseGoal(sim: Simulation, att: number, candidates: Uint8Array): number {
  const gov = sim.government;
  const world = sim.world;
  const owner = world.owner;
  const n = world.cellCount;
  if (bPop.length !== n) {
    bPop = new Float64Array(n);
    bRes = new Float64Array(n);
    bDef = new Float64Array(n);
    bBorder = new Uint8Array(n);
    bCells = new Uint16Array(n);
    touched = new Int32Array(n);
  }
  const soldiers = sim.military.soldiers;
  let count = 0;
  for (let c = 0; c < n; c++) {
    const b = owner[c];
    if (b === 0 || !candidates[b] || sim.cellPop[c] === 0) continue;
    const d = gov.district[c];
    if (d < 0 || owner[d] !== b || sim.cellPop[d] === 0) continue;
    if (bCells[d] === 0) touched[count++] = d;
    bCells[d]++;
    bPop[d] += sim.cellPop[c];
    const dep = world.deposit[c];
    if (dep !== 0) bRes[d] += DOUBLE_DEPOSIT[dep] ? WAR.resMul : 1;
    bDef[d] += soldiers[c * TROOP_TYPES] + soldiers[c * TROOP_TYPES + 1] + soldiers[c * TROOP_TYPES + 2];
    if (!bBorder[d]) {
      for (let k = 0; k < DIRECTION_COUNT; k++) {
        const nb = world.neighbors[c * DIRECTION_COUNT + k];
        if (nb >= 0 && owner[nb] === att && sim.cellPop[nb] > 0) {
          bBorder[d] = 1;
          break;
        }
      }
    }
  }
  let best = -1;
  let bestValue = -1;
  for (let i = 0; i < count; i++) {
    const d = touched[i];
    if (bBorder[d]) {
      const v = (bPop[d] + WAR.resPop * bRes[d]) / (1 + bDef[d]);
      if (v > bestValue || (v === bestValue && d < best)) {
        bestValue = v;
        best = d;
      }
    }
    bCells[d] = 0;
    bPop[d] = 0;
    bRes[d] = 0;
    bDef[d] = 0;
    bBorder[d] = 0;
  }
  return best;
}

/**
 * `att` declares war on the owner of seat `goal` (no checks: declareWars and
 * tests). Borders and agreements end, both sides raise their armies. Returns
 * the war's slot, -1 if there is no room.
 */
export function startWar(sim: Simulation, att: number, goal: number): number {
  const w = sim.war;
  const def = sim.world.owner[goal];
  let s = 0;
  while (s < MAX_WARS && w.wLive[s]) s++;
  if (s === MAX_WARS || def === 0 || def === att || w.enemy[att] !== 0 || w.enemy[def] !== 0) return -1;
  w.wLive[s] = 1;
  w.wAtt[s] = att;
  w.wDef[s] = def;
  w.wGoal[s] = goal;
  w.wStart[s] = sim.tick;
  w.wLastGain[s] = sim.tick;
  w.wSiegeStart[s] = -1;
  w.wSiegeStrength[s] = 0;
  w.wOccupied[s] = 0;
  w.wSplinter[s] = sim.civs[def]!.parentName === sim.civs[att]!.name ? 1 : 0;
  w.wBattles[s] = 0;
  w.wEnd[s] = -1;
  w.wars++;
  w.enemy[att] = def;
  w.enemy[def] = att;
  w.civWar[att] = s;
  w.civWar[def] = s;
  w.version++;
  const st = w.stats;
  st.declared++;
  if (!w.wSplinter[s]) st.estDeclared++;
  if ((sim.military.strength[def] ?? 0) <= 0) st.zeroDefender++;
  if (w.wars > st.maxWars) st.maxWars = w.wars;
  sever(sim, att, def);
  planMarch(sim, s);
  const each = Math.min(WAR.maxArmies, Math.floor(worldRoom(w) / 2));
  raiseArmies(sim, s, att, each);
  raiseArmies(sim, s, def, each);
  record(sim, `The ${sim.civs[att]!.name} declared war on the ${sim.civs[def]!.name}.`, goal);
  return s;
}

/** Borders closed, free trade, migration and trade agreements gone, peace starts over. */
function sever(sim: Simulation, a: number, b: number): void {
  const dip = sim.diplomacy;
  const k = a * PAIRS + b;
  const k2 = b * PAIRS + a;
  const changed = dip.open[k] === 1 || dip.open[k2] === 1;
  dip.open[k] = 0;
  dip.open[k2] = 0;
  dip.freeTrade[k] = 0;
  dip.freeTrade[k2] = 0;
  dip.migration[k] = 0;
  dip.migration[k2] = 0;
  dip.peace[k] = 0;
  dip.peace[k2] = 0;
  let any = false;
  for (const t of dip.agreements) if ((t.a === a && t.b === b) || (t.a === b && t.b === a)) any = true;
  if (any) dip.agreements = dip.agreements.filter((t) => !((t.a === a && t.b === b) || (t.a === b && t.b === a)));
  rebuildPartners(dip);
  if (changed) dip.bordersVersion++;
}

// ---------------------------------------------------------------------------
// Armies

let takeBuf = new Int32Array(0);
let raiseCells = new Int32Array(0);
const sold = new Float64Array(TROOP_TYPES);
const cov = new Float64Array(TROOP_TYPES);
const anchorBuf = new Int32Array(MAX_ARMIES);
const slotBuf = new Int32Array(MAX_ARMIES);

function weightOf(c: number): number {
  return takeBuf[c * TROOP_TYPES] + takeBuf[c * TROOP_TYPES + 1] + takeBuf[c * TROOP_TYPES + 2];
}

/**
 * Raises up to `room` armies of `civ` for war `s` from WAR.sendShare of its
 * soldiers (never more than that share away at a time). Anchors are the cells
 * with the most soldiers to send, at least WAR.anchorSep hexes apart if
 * possible; every cell sends its soldiers to the nearest anchor's army.
 */
function raiseArmies(sim: Simulation, s: number, civ: number, room: number): void {
  const w = sim.war;
  const m = sim.military;
  const n = sim.world.cellCount;
  const owner = sim.world.owner;
  if (room <= 0) return;
  if (takeBuf.length !== n * TROOP_TYPES) {
    takeBuf = new Int32Array(n * TROOP_TYPES);
    raiseCells = new Int32Array(n);
  }
  sold.fill(0);
  cov.fill(0);
  let cells = 0;
  let total = 0;
  for (let c = 0; c < n; c++) {
    if (owner[c] !== civ) continue;
    let any = 0;
    for (let t = 0; t < TROOP_TYPES; t++) {
      const i = c * TROOP_TYPES + t;
      const k = m.soldiers[i];
      if (k === 0) {
        takeBuf[i] = 0;
        continue;
      }
      sold[t] += k;
      if (m.covered[i]) cov[t] += k;
      const take = Math.max(0, Math.floor(WAR.sendShare * k) - w.away[i]);
      takeBuf[i] = take;
      any += take;
    }
    if (any > 0) {
      raiseCells[cells++] = c;
      total += any;
    }
  }
  const k = Math.min(room, Math.floor(total / WAR.armyMin), MAX_ARMIES);
  if (k <= 0) return;
  // Anchors: greedily the cell with the most soldiers to send that keeps `sep` from the anchors so far; then closer.
  let anchors = 0;
  for (let sep = WAR.anchorSep; anchors < k && sep >= 0; sep--) {
    while (anchors < k) {
      let best = -1;
      let bestW = -1;
      for (let i = 0; i < cells; i++) {
        const c = raiseCells[i];
        const wt = weightOf(c);
        if (wt <= bestW) continue;
        let ok = true;
        for (let j = 0; j < anchors; j++) {
          if (anchorBuf[j] === c || hexDistance(sim.world, c, anchorBuf[j]) < sep) {
            ok = false;
            break;
          }
        }
        if (ok) {
          best = c;
          bestW = wt;
        }
      }
      if (best < 0) break;
      anchorBuf[anchors++] = best;
    }
  }
  // One army per anchor.
  let slots = 0;
  for (let j = 0; j < anchors; j++) {
    let a = 0;
    while (a < MAX_ARMIES && w.live[a]) a++;
    if (a === MAX_ARMIES) break;
    w.live[a] = 1;
    w.aCiv[a] = civ;
    w.aWar[a] = s;
    w.aCell[a] = anchorBuf[j];
    w.aProg[a] = 0;
    w.aIdle[a] = 0;
    w.aSince[a] = sim.tick;
    for (let t = 0; t < TROOP_TYPES; t++) {
      w.aN[a * TROOP_TYPES + t] = 0;
      w.aFac[a * TROOP_TYPES + t] = 1 + (MIL.factor - 1) * (sold[t] > 0 ? cov[t] / sold[t] : 0);
    }
    slotBuf[slots++] = a;
    w.armies++;
    w.stats.armiesRaised++;
  }
  if (slots === 0) return;
  for (let i = 0; i < cells; i++) {
    const c = raiseCells[i];
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < slots; j++) {
      const d = hexDistance(sim.world, c, w.aCell[slotBuf[j]]);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    const a = slotBuf[best];
    for (let t = 0; t < TROOP_TYPES; t++) {
      const idx = c * TROOP_TYPES + t;
      const take = takeBuf[idx];
      if (take === 0) continue;
      w.away[idx] += take;
      w.aN[a * TROOP_TYPES + t] += take;
    }
  }
  for (let j = 0; j < slots; j++) {
    const a = slotBuf[j];
    if (armySoldiers(w, a) <= 0) removeArmy(w, a);
  }
  if (w.armies > w.stats.maxArmies) w.stats.maxArmies = w.armies;
  w.version++;
}

/** Soldiers in army `a`. */
export function armySoldiers(w: WarState, a: number): number {
  return w.aN[a * TROOP_TYPES] + w.aN[a * TROOP_TYPES + 1] + w.aN[a * TROOP_TYPES + 2];
}

function removeArmy(w: WarState, a: number): void {
  if (!w.live[a]) return;
  w.live[a] = 0;
  w.aWar[a] = -1;
  w.armies--;
  w.version++;
}

/** The soldiers of army `a` go home (their cells count them again) and the army is gone. */
export function disbandArmy(sim: Simulation, a: number): void {
  const w = sim.war;
  const civ = w.aCiv[a];
  for (let t = 0; t < TROOP_TYPES; t++) takeAway(sim, civ, t, Math.round(w.aN[a * TROOP_TYPES + t]), false);
  removeArmy(w, a);
}

/** Takes `k` soldiers of type `t` out of the "away" counters of `civ`'s cells; with `kill` they die (leave the cells' soldiers too). */
function takeAway(sim: Simulation, civ: number, t: number, k: number, kill: boolean): void {
  if (k <= 0) return;
  const w = sim.war;
  const m = sim.military;
  const owner = sim.world.owner;
  const n = sim.world.cellCount;
  for (let c = 0; c < n && k > 0; c++) {
    if (owner[c] !== civ) continue;
    const i = c * TROOP_TYPES + t;
    const have = w.away[i];
    if (have === 0) continue;
    const x = Math.min(k, have);
    w.away[i] -= x;
    k -= x;
    if (kill) {
      const base = c * TROOP_TYPES;
      const before = m.soldiers[base] + m.soldiers[base + 1] + m.soldiers[base + 2];
      m.soldiers[i] -= Math.min(x, m.soldiers[i]);
      if (before > 0) m.faith[c] *= (m.soldiers[base] + m.soldiers[base + 1] + m.soldiers[base + 2]) / before;
    }
  }
}

/** Whether `civ` may enter land of `o` in war against `enemy`: free land, its own, the enemy's, or open to it. */
function mayEnter(sim: Simulation, o: number, civ: number, enemy: number): boolean {
  return o === 0 || o === civ || o === enemy || sim.diplomacy.open[o * PAIRS + civ] === 1;
}

/**
 * Cheapest travel cost from every hex to the goal for the armies of `civ`
 * (side 0 attacker, 1 defender): a Dijkstra from the goal over land the army
 * may enter, up to WAR.fieldMax; no water (no ships). An army steps to the
 * neighbor with the least cost to go, so the path is found once per war.
 */
const fieldHeap = new MinHeap(256);
function travelField(sim: Simulation, s: number, side: number, civ: number, enemy: number): void {
  const world = sim.world;
  const owner = world.owner;
  const n = world.cellCount;
  const field = sim.war.field;
  const base = (s * 2 + side) * n;
  const goal = sim.war.wGoal[s];
  field.fill(Infinity, base, base + n);
  field[base + goal] = 0;
  fieldHeap.push(goal, 0);
  while (fieldHeap.size > 0) {
    const c = fieldHeap.pop();
    const here = field[base + c];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || isWaterBiome(world.biome[nb]) || !mayEnter(sim, owner[nb], civ, enemy)) continue;
      const next = here + stepCost(world, c, d);
      if (next >= field[base + nb] || next > WAR.fieldMax) continue;
      field[base + nb] = next;
      fieldHeap.push(nb, next);
    }
  }
}

/** Both sides' ways to the goal of war `s` (at the war's start; again only if the goal changed). */
export function planMarch(sim: Simulation, s: number): void {
  const w = sim.war;
  travelField(sim, s, 0, w.wAtt[s], w.wDef[s]);
  travelField(sim, s, 1, w.wDef[s], w.wAtt[s]);
}

/** Travel cost from `cell` to the goal of war `s` for its side `side` (0 attacker, 1 defender); Infinity = no path. */
export function travelCost(sim: Simulation, s: number, side: number, cell: number): number {
  return sim.war.field[(s * 2 + side) * sim.world.cellCount + cell];
}

// ---------------------------------------------------------------------------
// Weekly: march, battles, siege

const inp = new Float64Array(BI.SIDE * 2);
const out = new Float64Array(BO.SIZE);
const groupA = new Int32Array(MAX_ARMIES);
const groupB = new Int32Array(MAX_ARMIES);

/** One week of war (simulation.ts, every tick; nothing to do without wars). */
export function advanceWar(sim: Simulation): void {
  const w = sim.war;
  if (w.wars === 0) return;
  const t0 = clockStart();
  for (let s = 0; s < MAX_WARS; s++) if (w.wLive[s]) endIfGone(sim, s);
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a]) moveArmy(sim, a);
  resolveBattles(sim);
  for (let s = 0; s < MAX_WARS; s++) if (w.wLive[s] && w.wEnd[s] < 0) updateSiege(sim, s);
  for (let s = 0; s < MAX_WARS; s++) if (w.wLive[s] && w.wEnd[s] >= 0) endWar(sim, s, w.wEnd[s]);
  if (WAR_PROFILE.clock) {
    const dt = WAR_PROFILE.clock() - t0;
    w.stats.weekMs += dt;
    w.stats.weekCalls++;
    if (dt > w.stats.weekMax) w.stats.weekMax = dt;
  }
}

/** Whether an army of the other side of war `s` than `civ` stands on `cell`. */
function enemyAt(w: WarState, s: number, civ: number, cell: number): boolean {
  for (let b = 0; b < MAX_ARMIES; b++) if (w.live[b] && w.aWar[b] === s && w.aCell[b] === cell && w.aCiv[b] !== civ) return true;
  return false;
}

/**
 * WAR.speed travel cost per week along the cheapest way to the goal. An army
 * that meets an enemy army (shares its hex, or steps onto it) stops there to
 * fight. Without a path for WAR.noTargetWeeks it goes home.
 */
function moveArmy(sim: Simulation, a: number): void {
  const w = sim.war;
  const s = w.aWar[a];
  const goal = w.wGoal[s];
  const civ = w.aCiv[a];
  let cur = w.aCell[a];
  if (cur === goal || enemyAt(w, s, civ, cur)) return;
  const n = sim.world.cellCount;
  const base = (s * 2 + (civ === w.wAtt[s] ? 0 : 1)) * n;
  const field = w.field;
  if (field[base + cur] === Infinity) {
    if (++w.aIdle[a] >= WAR.noTargetWeeks) disbandArmy(sim, a);
    return;
  }
  const world = sim.world;
  let prog = w.aProg[a] + WAR.speed;
  for (let guard = 0; guard < 8; guard++) {
    let next = -1;
    let bestV = Infinity;
    let bestStep = 0;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[cur * DIRECTION_COUNT + d];
      if (nb < 0 || field[base + nb] === Infinity) continue;
      const step = stepCost(world, cur, d);
      const v = field[base + nb] + step;
      if (v < bestV) {
        bestV = v;
        next = nb;
        bestStep = step;
      }
    }
    if (next < 0 || prog < bestStep) break;
    prog -= bestStep;
    cur = next;
    if (cur === goal || enemyAt(w, s, civ, cur)) {
      prog = 0;
      break;
    }
  }
  w.aProg[a] = prog;
  if (cur !== w.aCell[a]) {
    w.aCell[a] = cur;
    w.aSince[a] = sim.tick;
    w.version++;
  }
}

/** Armies of both sides of a war on one hex fight, each (war, hex) once. */
function resolveBattles(sim: Simulation): void {
  const w = sim.war;
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a]) continue;
    const s = w.aWar[a];
    if (w.wEnd[s] >= 0) continue;
    const cell = w.aCell[a];
    let first = true;
    let na = 0;
    let nb = 0;
    for (let b = 0; b < MAX_ARMIES; b++) {
      if (!w.live[b] || w.aWar[b] !== s || w.aCell[b] !== cell) continue;
      if (b < a) {
        first = false;
        break;
      }
      if (w.aCiv[b] === w.wAtt[s]) groupA[na++] = b;
      else groupB[nb++] = b;
    }
    if (first && na > 0 && nb > 0) fight(sim, s, cell, na, nb);
  }
}

/**
 * The attacker's armies (groupA) against the defender's (groupB). In a field
 * battle they fight at once. At the goal seat the defenders (garrison and
 * relief together) only attack when they would win, or in the last
 * WAR.forceWeeks before an occupation check; with an army in the seat since
 * before this week they get the SeatArmy bonus, else the Seat bonus.
 */
function fight(sim: Simulation, s: number, cell: number, na: number, nb: number): void {
  const w = sim.war;
  for (let t = 0; t < TROOP_TYPES; t++) {
    let sa = 0;
    let fa = 0;
    for (let i = 0; i < na; i++) {
      const a = groupA[i];
      sa += w.aN[a * TROOP_TYPES + t];
      fa += w.aN[a * TROOP_TYPES + t] * w.aFac[a * TROOP_TYPES + t];
    }
    let sb = 0;
    let fb = 0;
    for (let i = 0; i < nb; i++) {
      const a = groupB[i];
      sb += w.aN[a * TROOP_TYPES + t];
      fb += w.aN[a * TROOP_TYPES + t] * w.aFac[a * TROOP_TYPES + t];
    }
    inp[BI.soldiers + t] = sa;
    inp[BI.factor + t] = sa > 0 ? fa / sa : 1;
    inp[BI.SIDE + BI.soldiers + t] = sb;
    inp[BI.SIDE + BI.factor + t] = sb > 0 ? fb / sb : 1;
  }
  const att = w.wAtt[s];
  const def = w.wDef[s];
  let defense: Defense = Defense.Field;
  const seat = cell === w.wGoal[s];
  if (seat) {
    let garrison = false;
    for (let i = 0; i < nb; i++) if (w.aSince[groupB[i]] < sim.tick) garrison = true;
    defense = garrison ? Defense.SeatArmy : Defense.Seat;
  }
  const result = fightBattle(inp, defense, out);
  if (seat) {
    if (w.wSiegeStart[s] < 0) startSiege(sim, s);
    if (result >= 0 && !forced(sim, s)) return;
  }
  w.wBattles[s]++;
  const st = w.stats;
  st.battles++;
  if (!w.wSplinter[s]) st.estBattles++;
  if (result > 0) {
    st.battleWinsAtt++;
    w.wLastGain[s] = sim.tick;
  } else if (result < 0) st.battleWinsDef++;
  else st.battleDraws++;
  const m = sim.military;
  if (m.strength.length > att) m.strength[att] = Math.max(0, m.strength[att] - out[BO.strLostA]);
  if (m.strength.length > def) m.strength[def] = Math.max(0, m.strength[def] - out[BO.strLostB]);
  applyLosses(sim, groupA, na, att, 0);
  applyLosses(sim, groupB, nb, def, 1);
  // The loser leaves the field (its soldiers go home); a draw sends both home.
  if (result >= 0) for (let i = 0; i < nb; i++) disbandArmy(sim, groupB[i]);
  if (result <= 0) for (let i = 0; i < na; i++) disbandArmy(sim, groupA[i]);
  // Giving up after the battle.
  const sa = m.strength[att] ?? 0;
  const sd = m.strength[def] ?? 0;
  if (defenderGivesUp(w, s, sd, sa)) w.wEnd[s] = EndType.GaveUp;
  else if (givesUp(sa, sd)) w.wEnd[s] = EndType.AttackerGaveUp;
}

/** Scales the group's armies to what is left of `side` after the battle and kills the difference in the cells. */
function applyLosses(sim: Simulation, group: Int32Array, count: number, civ: number, side: number): void {
  const w = sim.war;
  for (let t = 0; t < TROOP_TYPES; t++) {
    let before = 0;
    for (let i = 0; i < count; i++) before += w.aN[group[i] * TROOP_TYPES + t];
    if (before <= 0) continue;
    const left = remainingSoldiers(side, t);
    const lost = before - left;
    if (lost <= 0) continue;
    const k = left / before;
    for (let i = 0; i < count; i++) w.aN[group[i] * TROOP_TYPES + t] *= k;
    takeAway(sim, civ, t, Math.round(lost), true);
  }
}

// ---------------------------------------------------------------------------
// Siege

/** Defenders must fight when an occupation check is at most WAR.forceWeeks away. */
function forced(sim: Simulation, s: number): boolean {
  const age = sim.tick - sim.war.wSiegeStart[s];
  const next = age <= WAR.occupyWeeks ? WAR.occupyWeeks : WAR.occupyWeeks + Math.ceil((age - WAR.occupyWeeks) / WAR.occupyCheck) * WAR.occupyCheck;
  return next - age <= WAR.forceWeeks;
}

const SUPPLY_LABEL = 'Besieged';
const SIEGE_KINDS = [SupplyKind.Food, SupplyKind.Water, SupplyKind.Space] as const;

function startSiege(sim: Simulation, s: number): void {
  const w = sim.war;
  const goal = w.wGoal[s];
  w.wSiegeStart[s] = sim.tick;
  w.stats.sieges++;
  if (!w.wSplinter[s]) w.stats.estSieges++;
  w.siege[goal] = 1;
  w.siegeValue[goal] = -WAR.siegeMalus;
  w.stats.startSat += sim.satisfaction[goal];
  w.wSiegeStrength[s] = besiegerStrength(sim, s);
  w.version++;
  const mods: SupplyModifier[] = (sim.supplyModifiers.get(goal) ?? []).filter((x) => x.label !== SUPPLY_LABEL);
  for (const kind of SIEGE_KINDS) mods.push({ kind, label: SUPPLY_LABEL, amount: -0.5, percent: true });
  sim.supplyModifiers.set(goal, mods);
  updateCellSupply(sim, goal);
  record(sim, `The ${sim.civs[w.wAtt[s]]!.name} besieged a seat of government of the ${sim.civs[w.wDef[s]]!.name}.`, goal);
}

function endSiege(sim: Simulation, s: number): void {
  const w = sim.war;
  if (w.wSiegeStart[s] < 0) return;
  const goal = w.wGoal[s];
  w.wSiegeStart[s] = -1;
  w.wOccupied[s] = 0;
  w.siege[goal] = 0;
  w.siegeValue[goal] = 0;
  w.version++;
  const old = sim.supplyModifiers.get(goal);
  if (old) {
    const rest = old.filter((x) => x.label !== SUPPLY_LABEL);
    if (rest.length > 0) sim.supplyModifiers.set(goal, rest);
    else sim.supplyModifiers.delete(goal);
    updateCellSupply(sim, goal);
  }
}

function besiegerStrength(sim: Simulation, s: number): number {
  const w = sim.war;
  const att = w.wAtt[s];
  const goal = w.wGoal[s];
  let sum = 0;
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a] || w.aWar[a] !== s || w.aCiv[a] !== att || w.aCell[a] !== goal) continue;
    for (let t = 0; t < TROOP_TYPES; t++) sum += w.aN[a * TROOP_TYPES + t] * w.aFac[a * TROOP_TYPES + t];
  }
  return sum;
}

/**
 * A siege begins when an attacker's army stands on the goal seat, and ends
 * when none is left (relief won) or the attacker withdraws. After
 * WAR.occupyWeeks, and then every WAR.occupyCheck weeks, the seat is occupied
 * if its settlement's satisfaction is below 0.
 */
function updateSiege(sim: Simulation, s: number): void {
  const w = sim.war;
  const here = besiegerStrength(sim, s);
  if (w.wSiegeStart[s] < 0) {
    if (here > 0) startSiege(sim, s);
    return;
  }
  if (here <= 0) {
    endSiege(sim, s);
    w.stats.siegeBroken++;
    return;
  }
  if (here < WAR.withdraw * w.wSiegeStrength[s]) {
    const goal = w.wGoal[s];
    for (let a = 0; a < MAX_ARMIES; a++) {
      if (w.live[a] && w.aWar[a] === s && w.aCiv[a] === w.wAtt[s] && w.aCell[a] === goal) disbandArmy(sim, a);
    }
    endSiege(sim, s);
    w.stats.siegeWithdrew++;
    return;
  }
  if (w.wSiegeStrength[s] < here) w.wSiegeStrength[s] = here;
  if (w.wOccupied[s]) return;
  const age = sim.tick - w.wSiegeStart[s];
  if (age < WAR.occupyWeeks || (age - WAR.occupyWeeks) % WAR.occupyCheck !== 0) return;
  const cell = w.wGoal[s];
  const sat = sim.satisfaction[cell];
  if (age === WAR.occupyWeeks) {
    w.stats.checks++;
    w.stats.checkSat += sat;
    w.stats.checkTarget += satisfactionTarget(sim, cell, sim.civs[sim.world.owner[cell]] ?? null);
    if (sat < 0) w.stats.checksBelow++;
  }
  if (sat < 0) {
    w.stats.occupations++;
    if (!w.wSplinter[s]) w.stats.estOcc++;
    w.wLastGain[s] = sim.tick;
    w.wOccupied[s] = 1;
    w.version++;
    record(sim, `The ${sim.civs[w.wAtt[s]]!.name} occupied a seat of government of the ${sim.civs[w.wDef[s]]!.name}.`, cell);
  }
}

// ---------------------------------------------------------------------------
// End of a war

/**
 * Peace: the siege ends, all armies of the war go home, trust drops by
 * WAR.trustLoss both ways, borders stay closed and agreements gone, and a
 * truce of WAR.truceYears begins. If the defender gave up, the goal seat's
 * district goes to the attacker.
 */
export function endWar(sim: Simulation, s: number, type: number): void {
  const w = sim.war;
  if (!w.wLive[s]) return;
  const att = w.wAtt[s];
  const def = w.wDef[s];
  const goal = w.wGoal[s];
  const st = w.stats;
  st.ended[type]++;
  if (w.wBattles[s] === 0) st.noBattle++;
  st.durationSum += sim.tick - w.wStart[s];
  const attName = sim.civs[att]?.name ?? '?';
  const defName = sim.civs[def]?.name ?? '?';
  endSiege(sim, s);
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a] && w.aWar[a] === s) disbandArmy(sim, a);
  w.wLive[s] = 0;
  w.wEnd[s] = -1;
  w.wars--;
  w.version++;
  if (w.enemy[att] === def) {
    w.enemy[att] = 0;
    w.civWar[att] = -1;
  }
  if (w.enemy[def] === att) {
    w.enemy[def] = 0;
    w.civWar[def] = -1;
  }
  w.truce[pairKey(att, def)] = sim.tick + WAR.truceYears * TICKS_PER_YEAR;
  if (sim.civs[att] && sim.civs[def]) {
    addMood(sim.diplomacy, att, def, 'War', -WAR.trustLoss, sim.tick);
    addMood(sim.diplomacy, def, att, 'War', -WAR.trustLoss, sim.tick);
    sever(sim, att, def);
  }
  if (type === EndType.GaveUp && sim.civs[att] && sim.civs[def] && sim.world.owner[goal] === def) {
    const whole = transferDistrict(sim, s);
    record(sim, whole ? `The ${defName} gave up: the ${attName} conquered all their land.` : `The ${defName} gave up: the ${attName} conquered their seat of government.`, goal);
  } else if (type === EndType.AttackerGaveUp) {
    record(sim, `The ${attName} gave up their war against the ${defName}.`, goal);
  } else if (type === EndType.Exhausted) {
    record(sim, `The ${attName} and the ${defName} made peace, exhausted by war.`, goal);
  } else {
    record(sim, `The war between the ${attName} and the ${defName} ended.`, goal);
  }
}

let moveMask = new Uint8Array(0);

/**
 * The goal seat's district goes from the defender to the attacker: its
 * inhabitants, soldiers, buildings, stock and half the seat's treasury. A
 * people whose only seat it was goes over whole (annexed). A conquered
 * capital makes the rest choose a new one: its most populous seat, else its
 * most populous settlement. A road joins the district to the conqueror's land
 * at the border crossing. Returns true if the whole people was annexed.
 */
function transferDistrict(sim: Simulation, s: number): boolean {
  const w = sim.war;
  const gov = sim.government;
  const world = sim.world;
  const n = world.cellCount;
  const owner = world.owner;
  const att = w.wAtt[s];
  const def = w.wDef[s];
  const goal = w.wGoal[s];
  const loser = sim.civs[def]!;
  if (moveMask.length !== n) moveMask = new Uint8Array(n);
  const mask = moveMask;
  mask.fill(0);
  // The defender's seats besides the goal: none means the whole people goes.
  let otherSeats = loser.capital >= 0 && loser.capital !== goal && owner[loser.capital] === def ? 1 : 0;
  for (let c = 0; c < n && otherSeats === 0; c++) {
    if (c !== goal && owner[c] === def && sim.hasBuildings[c] && hasSeat(sim.economy, c)) otherSeats = 1;
  }
  const whole = otherSeats === 0;
  let cells = 0;
  let people = 0;
  for (let c = 0; c < n; c++) {
    if (owner[c] !== def || sim.cellPop[c] === 0) continue;
    if (!whole && gov.district[c] !== goal && c !== goal) continue;
    mask[c] = 1;
    cells++;
    people += sim.cellPop[c];
  }
  if (cells === 0) return false;
  const st = w.stats;
  if (whole) {
    st.annexed++;
    if (!w.wSplinter[s]) st.estAnnexed++;
  }
  st.cellsMoved += cells;
  st.peopleMoved += people;
  const pop = sim.pop;
  for (let i = 0; i < pop.end; i++) {
    if (pop.alive[i] && pop.civ[i] === def && mask[pop.cell[i]]) changeCiv(sim, i, att);
  }
  for (let c = 0; c < n; c++) {
    if (!mask[c]) continue;
    owner[c] = att;
    for (let t = 0; t < TROOP_TYPES; t++) w.away[c * TROOP_TYPES + t] = 0;
    w.conqValue[c] = -WAR.conqMalus;
    w.conqTick[c] = sim.tick;
    w.conqUntil[c] = sim.tick + WAR.conqYears * TICKS_PER_YEAR;
  }
  gov.treasury[goal] *= WAR.loot;
  // A new capital for the rest.
  if (!whole && mask[loser.capital]) {
    let best = -1;
    for (let c = 0; c < n; c++) {
      if (owner[c] !== def || sim.cellPop[c] === 0 || !sim.hasBuildings[c] || !hasSeat(sim.economy, c)) continue;
      if (best < 0 || sim.cellPop[c] > sim.cellPop[best]) best = c;
    }
    if (best < 0) {
      for (let c = 0; c < n; c++) if (owner[c] === def && (best < 0 || sim.cellPop[c] > sim.cellPop[best])) best = c;
    }
    if (best >= 0) loser.capital = best;
  }
  // The conquest road: the first crossing from the district to a settlement of the conqueror's.
  for (let c = 0; c < n; c++) {
    if (!mask[c]) continue;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb >= 0 && !mask[nb] && owner[nb] === att && sim.cellPop[nb] > 0) {
        addRoad(world, c, d);
        st.roads++;
        return whole;
      }
    }
  }
  return whole;
}

// ---------------------------------------------------------------------------
// After the yearly military update (simulation.ts: runMilitaryYear)

const armySum = new Float64Array(PAIRS * TROOP_TYPES);
const awaySum = new Float64Array(PAIRS * TROOP_TYPES);

/** Soldiers away can't exceed the cells' soldiers (dismissals, owners changed); armies follow the counters. */
export function reconcileWar(sim: Simulation): void {
  const w = sim.war;
  if (w.armies === 0 && w.wars === 0) return;
  const m = sim.military;
  const owner = sim.world.owner;
  const n = sim.world.cellCount;
  armySum.fill(0);
  awaySum.fill(0);
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a]) continue;
    for (let t = 0; t < TROOP_TYPES; t++) armySum[w.aCiv[a] * TROOP_TYPES + t] += w.aN[a * TROOP_TYPES + t];
  }
  for (let c = 0; c < n; c++) {
    for (let t = 0; t < TROOP_TYPES; t++) {
      const i = c * TROOP_TYPES + t;
      if (w.away[i] === 0) continue;
      const civ = owner[c];
      if (civ === 0 || armySum[civ * TROOP_TYPES + t] === 0) {
        w.away[i] = 0;
        continue;
      }
      if (w.away[i] > m.soldiers[i]) w.away[i] = m.soldiers[i];
      awaySum[civ * TROOP_TYPES + t] += w.away[i];
    }
  }
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a]) continue;
    for (let t = 0; t < TROOP_TYPES; t++) {
      const k = w.aCiv[a] * TROOP_TYPES + t;
      if (armySum[k] > awaySum[k] + 0.5) w.aN[a * TROOP_TYPES + t] *= awaySum[k] / armySum[k];
    }
  }
  // More away than in armies (rounding): bring the difference home.
  for (let civ = 1; civ < PAIRS; civ++) {
    for (let t = 0; t < TROOP_TYPES; t++) {
      const k = civ * TROOP_TYPES + t;
      const diff = Math.floor(awaySum[k] - armySum[k] + 0.5);
      if (diff > 0 && armySum[k] > 0) takeAway(sim, civ, t, diff, false);
    }
  }
}

// ---------------------------------------------------------------------------
// Queries for the app (panels, map); they allocate, the simulation never calls them.

export type ArmyInfo = { slot: number; civ: number; cell: number; soldiers: number; strength: number; besieging: boolean };
export type CivWar = {
  enemy: number;
  attacker: boolean;
  /** The goal seat, the year the war began. */
  goal: number;
  startTick: number;
  /** Siege of the goal: tick it began (-1 = none), whether the seat is occupied. */
  siegeStart: number;
  occupied: boolean;
  battles: number;
  ownArmies: ArmyInfo[];
  enemyArmies: ArmyInfo[];
};

/** All armies on the map (markers: cell, people for the flag color, soldiers). */
export function warArmies(sim: Simulation): ArmyInfo[] {
  const w = sim.war;
  const list: ArmyInfo[] = [];
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a]) continue;
    let strength = 0;
    for (let t = 0; t < TROOP_TYPES; t++) strength += w.aN[a * TROOP_TYPES + t] * w.aFac[a * TROOP_TYPES + t];
    const s = w.aWar[a];
    list.push({
      slot: a,
      civ: w.aCiv[a],
      cell: w.aCell[a],
      soldiers: Math.round(armySoldiers(w, a)),
      strength,
      besieging: w.aCiv[a] === w.wAtt[s] && w.aCell[a] === w.wGoal[s],
    });
  }
  return list;
}

/** The war of people `civ`, null in peace. */
export function civWar(sim: Simulation, civ: number): CivWar | null {
  const w = sim.war;
  const s = w.civWar[civ];
  if (s < 0 || !w.wLive[s]) return null;
  const armies = warArmies(sim).filter((x) => w.aWar[x.slot] === s);
  return {
    enemy: w.enemy[civ],
    attacker: w.wAtt[s] === civ,
    goal: w.wGoal[s],
    startTick: w.wStart[s],
    siegeStart: w.wSiegeStart[s],
    occupied: w.wOccupied[s] === 1,
    battles: w.wBattles[s],
    ownArmies: armies.filter((x) => x.civ === civ),
    enemyArmies: armies.filter((x) => x.civ !== civ),
  };
}

/** Peoples `civ` has a truce with, and the tick each ends. */
export function civTruces(sim: Simulation, civ: number): { civ: number; until: number }[] {
  const list: { civ: number; until: number }[] = [];
  for (let b = 1; b < sim.civs.length; b++) {
    if (b !== civ && sim.civs[b] && inTruce(sim, civ, b)) list.push({ civ: b, until: sim.war.truce[pairKey(civ, b)] });
  }
  return list;
}

import { DIRECTION_COUNT, hexDistance } from '../hex';
import { MinHeap } from '../minHeap';
import { createRng, deriveSeed, type Rng } from '../rng';
import { isWaterBiome } from '../world/biomes';
import { Deposit } from '../world/deposits';
import { addRoad, stepCost } from '../world/roads';
import { BUILDINGS } from './buildings';
import { BO, BI, Defense, fightBattle, remainingSoldiers } from './battle';
import { PAIRS, addMood, rebuildPartners } from './diplomacy';
import { updateCellSupply } from './economy';
import { MIL, TROOP_TYPES } from './military';
import { SupplyKind, type SupplyModifier } from './supply';
import { satisfactionTarget } from './satisfaction';
import { changeCiv, record, type Simulation } from './simulation';

// War on the map, phase 3 ("Design Documents/Requirement Krieg.md", sections
// 4 to 6). PROTOTYPE for the simulation step: all numbers are named in WAR so
// tools/warMapStats.ts can compare values; WAR.phase switches it (0 = off,
// 1 = 3a: declaration, armies, march, battles, peace; 2 = 3a + 3b: siege,
// occupation, conquest).
//
// Soldiers stay in the cells' counters (military.soldiers), so pay, training
// and strength work as before; an army is a counter of the soldiers "away"
// from their cells (`away`), with a position. Casualties are taken from the
// cells. All state lives in typed arrays; only the few wars are objects.

export const WAR = {
  /** 0 = off, 1 = 3a, 2 = 3a + 3b. */
  phase: 0,
  /** Declaration: own strength at least this times the target's; yearly chance; own strength floor (prototype addition, 0 = none). */
  ratio: 2,
  chance: 0.1,
  minStrength: 0,
  /** Added to both strengths in the ratio test (like MIL.floor in the danger formula; 0 = the plain 2x of the requirement). */
  ratioFloor: 0,
  /** Neighbors: 0 = settlements on adjacent hexes, else the people's travel-cost distance (diplomacy) at most this. */
  nbDist: 0,
  /** Benefit of a district: inhabitants + resPop per deposit (x resMul for strategic and luxury deposits), divided by 1 + defenders. */
  resPop: 50,
  resMul: 2,
  /** 1: the goal district must not be the target's only district (no annexation of a whole people). */
  noAnnex: 0,
  /** Armies: share of the soldiers that march, armies per people, armies worldwide, smallest army, anchor spacing (hexes). */
  sendShare: 0.7,
  maxArmies: 4,
  worldArmies: 32,
  armyMin: 5,
  anchorSep: 3,
  /** Travel cost per week, cost limit of the path search, weeks without a path before an army goes home. */
  speed: 1,
  fieldMax: 25,
  noTargetWeeks: 104,
  /** Raise armies again each year while the war runs (1 = yes). */
  reraise: 1,
  /** 3b: satisfaction part of a besieged seat, weeks of siege before occupation, weeks between checks, 1 = check the target instead of the value. */
  siegeMalus: 40,
  occupyWeeks: 104,
  occupyCheck: 52,
  occupyOnTarget: 0,
  /** 3b: the attacker withdraws below this share of its siege strength; defenders must fight this many weeks before an occupation check. */
  withdraw: 0.5,
  forceWeeks: 4,
  /** Share of the seat's treasury the conqueror gets, the "Conquered" part and the years it fades over. */
  loot: 0.5,
  conqMalus: 15,
  conqYears: 10,
  /** A side gives up below this share of the enemy's strength (battle.ts: BATTLE.giveUp = 0.4; 0 = never), and not before the war is this many weeks old. */
  giveUp: 0.4,
  giveUpAfter: 0,
  /** Defender's give-up: 0 = whenever below giveUp (old), 1 = only once the goal seat is occupied, then only below giveUp (the war goes on, occupied, until give-up, exhaustion or relief), 2 = occupying the goal ends the war at once, no give-up before. The attacker always gives up at the plain rule. */
  giveUpMode: 1,
  /** 1: a road joins a conquered district to the conqueror's land (else it is cut off from the conqueror's capital and becomes a people of its own). */
  conquestRoad: 1,
  /** Exhaustion (years without attacker success), truce (years), trust lost after the war. */
  exhaustYears: 10,
  truceYears: 20,
  trustLoss: 30,
  /** Measure the time of the war parts (tools). */
  profile: 0,
};

const MAX_ARMIES = 64;
const MAX_WARS = 24;
const TICKS_PER_YEAR = 52;
export const EndType = { Conquered: 0, GaveUp: 1, Exhausted: 2, AttackerGaveUp: 3, Vanished: 4 } as const;
export const END_NAMES = ['goal conquered', 'defender gave up', 'exhaustion', 'attacker gave up', 'a people vanished'] as const;

export type War = {
  att: number;
  def: number;
  goal: number;
  start: number;
  /** Tick of the attacker's last success (battle won, occupation). */
  lastGain: number;
  /** Tick the siege began (-1 = none) and the besiegers' strength then. */
  siegeStart: number;
  siegeStrength: number;
  fieldAtt: Float32Array | null;
  fieldDef: Float32Array | null;
  battles: number;
  sieges: number;
  maxArmies: number;
  slot: number;
  /** 3b, giveUpMode 1: the goal seat is occupied (the siege goes on). */
  occupied: boolean;
  /** The target arose from the attacker (secession, revolution, cut-off land). */
  splinter: boolean;
};

export type WarStats = {
  declared: number;
  capBlocked: number;
  /** Targets that could not be a goal for lack of a second district (WAR.noAnnex). */
  annexBlocked: number;
  ended: number[];
  weeks: number;
  battles: number;
  warBattles: number;
  armiesRaised: number;
  maxArmies: number;
  maxWars: number;
  sieges: number;
  occupations: number;
  /** Siege ends: relief won, attacker withdrew, attacker gone. */
  siegeBroken: number;
  siegeWithdrew: number;
  /** First occupation check of a siege: seat satisfaction below 0 / checks / sum of satisfaction, and the same for the target. */
  checks: number;
  checksBelow: number;
  checkSat: number;
  checkTarget: number;
  startSat: number;
  /** Cells and people that changed hands, annexations of a whole people. */
  cellsMoved: number;
  peopleMoved: number;
  annexed: number;
  /** Weekly and yearly cost of the war parts (WAR.profile), ms: sum, calls, worst. */
  weekMs: number;
  weekCalls: number;
  weekMax: number;
  yearMs: number;
  yearCalls: number;
  yearMax: number;
  battleWins: number[];
  /** Wars that ended without any battle, wars against a people without soldiers, wars declared at a strength ratio above 2.5. */
  noBattle: number;
  zeroDefender: number;
  ratioHigh: number;
  /** Wars whose goal district was not a neighbor-adjacent... (unused) / roads built for conquered districts. */
  roads: number;
  /** Wars (and their battles, sieges, occupations, annexed peoples) against established peoples, i.e. not against the attacker's own splinters. */
  estDeclared: number;
  estBattles: number;
  estSieges: number;
  estOcc: number;
  estAnnexed: number;
  /** Durations (ticks) of the wars that ended, and their battles. */
  durations: number[];
};

export type WarState = {
  /** Per people: the people it is at war with, 0 = none (one war per people). */
  enemy: Uint8Array;
  slots: (War | null)[];
  wars: number;
  /** Armies (struct of arrays); `live` marks used entries. */
  live: Uint8Array;
  aCiv: Uint8Array;
  aWar: Int8Array;
  aCell: Int32Array;
  aN: Float64Array;
  aFac: Float64Array;
  aProg: Float32Array;
  aIdle: Uint16Array;
  /** Tick the army reached its hex. */
  aSince: Int32Array;
  armies: number;
  /** Per cell and troop type: soldiers of the cell that are in an army. */
  away: Uint16Array;
  /** Per cell: 1 while the settlement is besieged; its satisfaction part (negative). */
  siege: Uint8Array;
  siegeValue: Float32Array;
  /** Per cell: the "Conquered" part, the tick it began and the years it fades over (satisfaction.ts). */
  conqValue: Float32Array;
  conqTick: Int32Array;
  conqYears: number;
  /** Truce end tick per ordered pair key a * PAIRS + b (min, max). */
  truce: Map<number, number>;
  rng: Rng;
  stats: WarStats;
};

export function createWar(seed: number, cellCount: number): WarState {
  return {
    enemy: new Uint8Array(PAIRS),
    slots: new Array<War | null>(MAX_WARS).fill(null),
    wars: 0,
    live: new Uint8Array(MAX_ARMIES),
    aCiv: new Uint8Array(MAX_ARMIES),
    aWar: new Int8Array(MAX_ARMIES),
    aCell: new Int32Array(MAX_ARMIES),
    aN: new Float64Array(MAX_ARMIES * TROOP_TYPES),
    aFac: new Float64Array(MAX_ARMIES * TROOP_TYPES),
    aProg: new Float32Array(MAX_ARMIES),
    aIdle: new Uint16Array(MAX_ARMIES),
    aSince: new Int32Array(MAX_ARMIES),
    armies: 0,
    away: new Uint16Array(cellCount * TROOP_TYPES),
    siege: new Uint8Array(cellCount),
    siegeValue: new Float32Array(cellCount),
    conqValue: new Float32Array(cellCount),
    conqTick: new Int32Array(cellCount),
    conqYears: WAR.conqYears,
    truce: new Map(),
    rng: createRng(deriveSeed(seed, 'war')),
    stats: {
      declared: 0,
      capBlocked: 0,
      annexBlocked: 0,
      ended: [0, 0, 0, 0, 0],
      weeks: 0,
      battles: 0,
      warBattles: 0,
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
      weekMs: 0,
      weekCalls: 0,
      weekMax: 0,
      yearMs: 0,
      yearCalls: 0,
      yearMax: 0,
      battleWins: [0, 0, 0],
      noBattle: 0,
      zeroDefender: 0,
      ratioHigh: 0,
      roads: 0,
      estDeclared: 0,
      estBattles: 0,
      estSieges: 0,
      estOcc: 0,
      estAnnexed: 0,
      durations: [],
    },
  };
}

/** Whether a side of strength `own` gives up against `enemy` in a war of this age (BATTLE.giveUp as WAR.giveUp). */
function gaveUp(own: number, enemy: number, age: number): boolean {
  return WAR.giveUp > 0 && age >= WAR.giveUpAfter && own < WAR.giveUp * enemy;
}

/** Whether the defender gives up now. */
function defenderGaveUp(war: War, sd: number, sa: number, age: number): boolean {
  if (WAR.giveUpMode !== 0 && WAR.phase >= 2 && !war.occupied) return false;
  return gaveUp(sd, sa, age);
}

const pairKey = (a: number, b: number) => (a < b ? a * PAIRS + b : b * PAIRS + a);

/** Whether a new war between a and b is barred by a truce. */
export function inTruce(sim: Simulation, a: number, b: number): boolean {
  const until = sim.war.truce.get(pairKey(a, b));
  return until !== undefined && sim.tick < until;
}

// ---------------------------------------------------------------------------
// Yearly: end checks, new armies, declarations

let adj = new Uint8Array(0);
let benefit = new Float64Array(0);
let bPop = new Float64Array(0);
let bRes = new Float64Array(0);
let bDef = new Float64Array(0);
let bBorder = new Uint8Array(0);
let bCells = new Uint16Array(0);
const DOUBLE_DEPOSIT = new Uint8Array(32);
{
  for (const b of BUILDINGS) if (b.deposit) DOUBLE_DEPOSIT[b.deposit] = 1;
}

/** The war's yearly part (week of simulation.ts: WAR_WEEK): end checks and new armies for the running wars, then declarations. */
export function runWarYear(sim: Simulation): void {
  if (WAR.phase === 0) return;
  const t0 = WAR.profile ? performance.now() : 0;
  const w = sim.war;
  w.conqYears = WAR.conqYears;
  const m = sim.military;
  for (let s = 0; s < MAX_WARS; s++) {
    const war = w.slots[s];
    if (!war) continue;
    if (!sim.civs[war.att] || !sim.civs[war.def]) {
      endWar(sim, war, EndType.Vanished);
      continue;
    }
    if (sim.world.owner[war.goal] !== war.def || sim.cellPop[war.goal] === 0) {
      endWar(sim, war, EndType.Exhausted);
      continue;
    }
    const sa = m.strength[war.att] ?? 0;
    const sd = m.strength[war.def] ?? 0;
    const age = sim.tick - war.start;
    if (defenderGaveUp(war, sd, sa, age)) endWar(sim, war, EndType.GaveUp);
    else if (gaveUp(sa, sd, age)) endWar(sim, war, EndType.AttackerGaveUp);
    else if (sim.tick - war.lastGain >= WAR.exhaustYears * TICKS_PER_YEAR) endWar(sim, war, EndType.Exhausted);
    else if (WAR.reraise) {
      reraise(sim, war, war.att);
      reraise(sim, war, war.def);
    }
  }
  declareWars(sim);
  if (WAR.profile) {
    const dt = performance.now() - t0;
    w.stats.yearMs += dt;
    w.stats.yearCalls++;
    if (dt > w.stats.yearMax) w.stats.yearMax = dt;
  }
}

function countArmies(w: WarState, war: War, civ: number): number {
  let k = 0;
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a] && w.aWar[a] === war.slot && w.aCiv[a] === civ) k++;
  return k;
}

function reraise(sim: Simulation, war: War, civ: number): void {
  const w = sim.war;
  const have = countArmies(w, war, civ);
  const room = Math.min(WAR.maxArmies - have, WAR.worldArmies - w.armies);
  if (room > 0) raiseArmies(sim, war, civ, room);
}

function declareWars(sim: Simulation): void {
  const w = sim.war;
  const dip = sim.diplomacy;
  const m = sim.military;
  const world = sim.world;
  const owner = world.owner;
  const n = world.cellCount;
  if (WAR.nbDist === 0) {
    if (adj.length !== PAIRS * PAIRS) adj = new Uint8Array(PAIRS * PAIRS);
    adj.fill(0);
    for (let c = 0; c < n; c++) {
      const a = owner[c];
      if (a === 0 || sim.cellPop[c] === 0) continue;
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const nb = world.neighbors[c * DIRECTION_COUNT + d];
        if (nb < 0) continue;
        const b = owner[nb];
        if (b !== 0 && b !== a && sim.cellPop[nb] > 0) adj[a * PAIRS + b] = 1;
      }
    }
  }
  for (let a = 1; a < sim.civs.length; a++) {
    if (!sim.civs[a] || w.enemy[a] !== 0) continue;
    const sa = m.strength[a] ?? 0;
    if (sa < WAR.minStrength) continue;
    // Candidates: free neighbors we outweigh.
    let any = false;
    let mask: Uint8Array | null = null;
    for (let b = 1; b < sim.civs.length; b++) {
      if (b === a || !sim.civs[b] || w.enemy[b] !== 0 || !dip.known[a * PAIRS + b]) continue;
      const near = WAR.nbDist === 0 ? adj[a * PAIRS + b] === 1 : dip.distance[a * PAIRS + b] <= WAR.nbDist;
      if (!near || inTruce(sim, a, b)) continue;
      if (sa + WAR.ratioFloor < WAR.ratio * ((m.strength[b] ?? 0) + WAR.ratioFloor)) continue;
      (mask ??= new Uint8Array(sim.civs.length))[b] = 1;
      any = true;
    }
    if (!any) continue;
    if (w.rng() >= WAR.chance) continue;
    if (WAR.worldArmies - w.armies < 2) {
      w.stats.capBlocked++;
      continue;
    }
    const goal = chooseGoal(sim, a, mask!);
    if (goal < 0) continue;
    startWar(sim, a, owner[goal], goal);
  }
}

/** The seat to take: among the districts of the marked peoples with settlements next to the attacker's, the one with the largest benefit; -1 if none. */
function chooseGoal(sim: Simulation, att: number, mask: Uint8Array): number {
  const gov = sim.government;
  const world = sim.world;
  const owner = world.owner;
  const n = world.cellCount;
  if (benefit.length !== n) {
    benefit = new Float64Array(n);
    bPop = new Float64Array(n);
    bRes = new Float64Array(n);
    bDef = new Float64Array(n);
    bBorder = new Uint8Array(n);
    bCells = new Uint16Array(n);
  }
  const touched: number[] = [];
  for (let c = 0; c < n; c++) {
    const b = owner[c];
    if (b === 0 || !mask[b] || sim.cellPop[c] === 0) continue;
    const d = gov.district[c];
    if (d < 0 || owner[d] !== b || sim.cellPop[d] === 0) continue;
    if (bCells[d] === 0) touched.push(d);
    bCells[d]++;
    bPop[d] += sim.cellPop[c];
    const dep = world.deposit[c];
    if (dep !== 0) bRes[d] += DOUBLE_DEPOSIT[dep] || dep === Deposit.Iron || dep === Deposit.Flint ? WAR.resMul : 1;
    bDef[d] += sim.military.soldiers[c * TROOP_TYPES] + sim.military.soldiers[c * TROOP_TYPES + 1] + sim.military.soldiers[c * TROOP_TYPES + 2];
    if (!bBorder[d]) {
      for (let k = 0; k < DIRECTION_COUNT; k++) {
        const nb = world.neighbors[c * DIRECTION_COUNT + k];
        if (nb >= 0 && owner[nb] === att && sim.cellPop[nb] > 0) {
          bBorder[d] = 1;
          break;
        }
      }
      if (!bBorder[d] && WAR.nbDist > 0) bBorder[d] = 1;
    }
  }
  // Districts per people (annexation rule).
  const districts = new Map<number, number>();
  if (WAR.noAnnex) {
    const all = new Map<number, Set<number>>();
    for (let c = 0; c < n; c++) {
      const b = owner[c];
      if (b === 0 || !mask[b] || sim.cellPop[c] === 0 || gov.district[c] < 0) continue;
      let set = all.get(b);
      if (!set) all.set(b, (set = new Set()));
      set.add(gov.district[c]);
    }
    for (const [b, set] of all) districts.set(b, set.size);
  }
  let best = -1;
  let bestValue = -1;
  for (const d of touched) {
    if (bBorder[d]) {
      if (WAR.noAnnex && (districts.get(owner[d]) ?? 0) < 2) {
        sim.war.stats.annexBlocked++;
      } else {
        const v = (bPop[d] + WAR.resPop * bRes[d]) / (1 + bDef[d]);
        if (v > bestValue) {
          bestValue = v;
          best = d;
        }
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

function startWar(sim: Simulation, att: number, def: number, goal: number): void {
  const w = sim.war;
  const slot = w.slots.indexOf(null);
  if (slot < 0) return;
  const war: War = {
    att,
    def,
    goal,
    start: sim.tick,
    lastGain: sim.tick,
    siegeStart: -1,
    siegeStrength: 0,
    fieldAtt: null,
    fieldDef: null,
    battles: 0,
    sieges: 0,
    maxArmies: 0,
    slot,
    occupied: false,
    splinter: sim.civs[def]!.parentName === sim.civs[att]!.name,
  };
  w.slots[slot] = war;
  w.wars++;
  w.enemy[att] = def;
  w.enemy[def] = att;
  w.stats.declared++;
  if (!war.splinter) w.stats.estDeclared++;
  const sdef = sim.military.strength[def] ?? 0;
  if (sdef <= 0) w.stats.zeroDefender++;
  if (sdef * 2.5 < (sim.military.strength[att] ?? 0)) w.stats.ratioHigh++;
  if (w.wars > w.stats.maxWars) w.stats.maxWars = w.wars;
  sever(sim, att, def);
  const each = Math.min(WAR.maxArmies, Math.floor((WAR.worldArmies - w.armies) / 2));
  war.fieldAtt = travelField(sim, goal, att, def);
  war.fieldDef = travelField(sim, goal, def, att);
  raiseArmies(sim, war, att, each);
  raiseArmies(sim, war, def, each);
  record(sim, `The ${sim.civs[att]!.name} declared war on the ${sim.civs[def]!.name}.`, goal);
}

/** Borders closed, agreements gone, peace and trust start over (a war's start). */
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
  dip.agreements = dip.agreements.filter((t) => !((t.a === a && t.b === b) || (t.a === b && t.b === a)));
  rebuildPartners(dip);
  if (changed) dip.bordersVersion++;
}

// ---------------------------------------------------------------------------
// Armies

let takeBuf = new Int32Array(0);

/** Raises up to `room` armies of `civ` from 70 % of its soldiers (never more than that share away at a time). */
function raiseArmies(sim: Simulation, war: War, civ: number, room: number): void {
  const w = sim.war;
  const m = sim.military;
  const n = sim.world.cellCount;
  const owner = sim.world.owner;
  if (room <= 0) return;
  if (takeBuf.length !== n * TROOP_TYPES) takeBuf = new Int32Array(n * TROOP_TYPES);
  const sold = [0, 0, 0];
  const cov = [0, 0, 0];
  const cells: number[] = [];
  let total = 0;
  for (let c = 0; c < n; c++) {
    if (owner[c] !== civ) continue;
    let any = 0;
    for (let t = 0; t < TROOP_TYPES; t++) {
      const i = c * TROOP_TYPES + t;
      const s = m.soldiers[i];
      if (s === 0) {
        takeBuf[i] = 0;
        continue;
      }
      sold[t] += s;
      if (m.covered[i]) cov[t] += s;
      const take = Math.max(0, Math.floor(WAR.sendShare * s) - w.away[i]);
      takeBuf[i] = take;
      any += take;
    }
    if (any > 0) {
      cells.push(c);
      total += any;
    }
  }
  const k = Math.min(room, Math.floor(total / WAR.armyMin));
  if (k <= 0) return;
  // Anchors: the cells with the most soldiers to take, spaced apart.
  const weight = (c: number) => takeBuf[c * 3] + takeBuf[c * 3 + 1] + takeBuf[c * 3 + 2];
  cells.sort((x, y) => weight(y) - weight(x) || x - y);
  const anchors: number[] = [];
  for (let sep = WAR.anchorSep; anchors.length < k && sep >= 0; sep = sep > 0 ? sep - 1 : -1) {
    for (const c of cells) {
      if (anchors.length >= k) break;
      if (anchors.includes(c)) continue;
      let ok = true;
      for (const a of anchors) {
        if (hexDistance(sim.world, c, a) < sep) {
          ok = false;
          break;
        }
      }
      if (ok) anchors.push(c);
    }
  }
  // One army per anchor, filled with the cells nearest to it.
  const slots: number[] = [];
  for (const anchor of anchors) {
    let a = 0;
    while (a < MAX_ARMIES && w.live[a]) a++;
    if (a === MAX_ARMIES) break;
    w.live[a] = 1;
    w.aCiv[a] = civ;
    w.aWar[a] = war.slot;
    w.aCell[a] = anchor;
    w.aProg[a] = 0;
    w.aIdle[a] = 0;
    w.aSince[a] = sim.tick;
    for (let t = 0; t < TROOP_TYPES; t++) {
      w.aN[a * 3 + t] = 0;
      w.aFac[a * 3 + t] = 1 + (MIL.factor - 1) * (sold[t] > 0 ? cov[t] / sold[t] : 0);
    }
    slots.push(a);
    w.armies++;
    w.stats.armiesRaised++;
  }
  if (slots.length === 0) return;
  for (const c of cells) {
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < slots.length; j++) {
      const d = hexDistance(sim.world, c, w.aCell[slots[j]]);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    const a = slots[best];
    for (let t = 0; t < TROOP_TYPES; t++) {
      const i = c * TROOP_TYPES + t;
      const take = takeBuf[i];
      if (take === 0) continue;
      w.away[i] += take;
      w.aN[a * 3 + t] += take;
    }
  }
  // Drop armies that ended up empty.
  for (const a of slots) if (w.aN[a * 3] + w.aN[a * 3 + 1] + w.aN[a * 3 + 2] <= 0) removeArmy(w, a);
  const live = countArmies(w, war, civ) + countArmies(w, war, civ === war.att ? war.def : war.att);
  if (live > war.maxArmies) war.maxArmies = live;
  if (w.armies > w.stats.maxArmies) w.stats.maxArmies = w.armies;
}

function removeArmy(w: WarState, a: number): void {
  if (!w.live[a]) return;
  w.live[a] = 0;
  w.armies--;
}

/** The soldiers of army `a` go home (their cells count them again) and the army is gone. */
function disbandArmy(sim: Simulation, a: number): void {
  const w = sim.war;
  const civ = w.aCiv[a];
  for (let t = 0; t < TROOP_TYPES; t++) takeAway(sim, civ, t, Math.round(w.aN[a * 3 + t]), false);
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
      const before = m.soldiers[c * 3] + m.soldiers[c * 3 + 1] + m.soldiers[c * 3 + 2];
      m.soldiers[i] -= Math.min(x, m.soldiers[i]);
      if (before > 0) m.faith[c] *= (m.soldiers[c * 3] + m.soldiers[c * 3 + 1] + m.soldiers[c * 3 + 2]) / before;
    }
  }
}

/**
 * Cheapest travel cost from every hex to `goal` for the armies of `civ` (a
 * Dijkstra from the goal; the path of an army is found by always stepping to
 * the neighbor with the least cost to go, so it is computed once per war):
 * through free land, its own, the enemy's, and the land of peoples that
 * opened their borders to it; not over water (no ships).
 */
const fieldHeap = new MinHeap(256);
function travelField(sim: Simulation, goal: number, civ: number, enemy: number): Float32Array {
  const world = sim.world;
  const owner = world.owner;
  const dip = sim.diplomacy;
  const n = world.cellCount;
  const field = new Float32Array(n).fill(Infinity);
  field[goal] = 0;
  fieldHeap.push(goal, 0);
  while (fieldHeap.size > 0) {
    const c = fieldHeap.pop();
    const here = field[c];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || isWaterBiome(world.biome[nb])) continue;
      const next = here + stepCost(world, c, d);
      if (next >= field[nb] || next > WAR.fieldMax) continue;
      field[nb] = next;
      const o = owner[nb];
      // An army may enter nb (later in the path) only if the land allows it; it may stand on any hex to start.
      if (o === 0 || o === civ || o === enemy || dip.open[o * PAIRS + civ] === 1) fieldHeap.push(nb, next);
    }
  }
  return field;
}

// ---------------------------------------------------------------------------
// Weekly: march, battles, siege

const inp = new Float64Array(12);
const out = new Float64Array(BO.SIZE);
const groupA = new Int32Array(MAX_ARMIES);
const groupB = new Int32Array(MAX_ARMIES);
const finishing: War[] = [];
const finishTypes: number[] = [];

/** One week of war (called every tick from simulation.ts; nothing to do without wars). */
export function advanceWar(sim: Simulation): void {
  const w = sim.war;
  if (w.wars === 0) return;
  const t0 = WAR.profile ? performance.now() : 0;
  w.stats.weeks++;
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a]) moveArmy(sim, a);
  resolveBattles(sim);
  if (WAR.phase >= 2) {
    for (let s = 0; s < MAX_WARS; s++) {
      const war = w.slots[s];
      if (war) updateSiege(sim, war);
    }
  }
  for (let i = 0; i < finishing.length; i++) endWar(sim, finishing[i], finishTypes[i]);
  finishing.length = 0;
  finishTypes.length = 0;
  if (WAR.profile) {
    const dt = performance.now() - t0;
    w.stats.weekMs += dt;
    w.stats.weekCalls++;
    if (dt > w.stats.weekMax) w.stats.weekMax = dt;
  }
}

function moveArmy(sim: Simulation, a: number): void {
  const w = sim.war;
  const war = w.slots[w.aWar[a]]!;
  let cur = w.aCell[a];
  if (cur === war.goal) return;
  const field = w.aCiv[a] === war.att ? war.fieldAtt! : war.fieldDef!;
  if (field[cur] === Infinity) {
    if (++w.aIdle[a] >= WAR.noTargetWeeks) disbandArmy(sim, a);
    return;
  }
  const world = sim.world;
  let prog = w.aProg[a] + WAR.speed;
  for (let guard = 0; guard < 8; guard++) {
    let bestD = -1;
    let bestV = Infinity;
    let bestStep = 0;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[cur * DIRECTION_COUNT + d];
      if (nb < 0 || field[nb] === Infinity) continue;
      const step = stepCost(world, cur, d);
      const v = field[nb] + step;
      if (v < bestV) {
        bestV = v;
        bestD = nb;
        bestStep = step;
      }
    }
    if (bestD < 0 || prog < bestStep) break;
    prog -= bestStep;
    cur = bestD;
    if (cur === war.goal) {
      prog = 0;
      break;
    }
  }
  w.aProg[a] = prog;
  if (cur !== w.aCell[a]) {
    w.aCell[a] = cur;
    w.aSince[a] = sim.tick;
  }
}

function resolveBattles(sim: Simulation): void {
  const w = sim.war;
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a]) continue;
    const war = w.slots[w.aWar[a]];
    if (!war) continue;
    const cell = w.aCell[a];
    // Handle each (war, hex) once, at its first army.
    let first = true;
    let na = 0;
    let nb = 0;
    for (let b = 0; b < MAX_ARMIES; b++) {
      if (!w.live[b] || w.aWar[b] !== war.slot || w.aCell[b] !== cell) continue;
      if (b < a) first = false;
      if (w.aCiv[b] === war.att) groupA[na++] = b;
      else groupB[nb++] = b;
    }
    if (!first || na === 0 || nb === 0) continue;
    fight(sim, war, cell, na, nb);
  }
}

function fight(sim: Simulation, war: War, cell: number, na: number, nb: number): void {
  const w = sim.war;
  // Sum the two sides: soldiers and the factor that gives the right strength.
  for (let t = 0; t < 3; t++) {
    let sa = 0;
    let fa = 0;
    for (let i = 0; i < na; i++) {
      const a = groupA[i];
      sa += w.aN[a * 3 + t];
      fa += w.aN[a * 3 + t] * w.aFac[a * 3 + t];
    }
    let sb = 0;
    let fb = 0;
    for (let i = 0; i < nb; i++) {
      const a = groupB[i];
      sb += w.aN[a * 3 + t];
      fb += w.aN[a * 3 + t] * w.aFac[a * 3 + t];
    }
    inp[BI.soldiers + t] = sa;
    inp[BI.factor + t] = sa > 0 ? fa / sa : 1;
    inp[BI.SIDE + BI.soldiers + t] = sb;
    inp[BI.SIDE + BI.factor + t] = sb > 0 ? fb / sb : 1;
  }
  let defense: Defense = Defense.Field;
  let seat = false;
  if (WAR.phase >= 2 && cell === war.goal) {
    seat = true;
    let garrison = false;
    for (let i = 0; i < nb; i++) if (w.aSince[groupB[i]] < sim.tick) garrison = true;
    defense = garrison ? Defense.SeatArmy : Defense.Seat;
  }
  const result = fightBattle(inp, defense, out);
  if (seat) {
    // Defenders wait in the seat until they can win, or the last weeks before an occupation check.
    if (war.siegeStart < 0) startSiege(sim, war);
    if (result >= 0 && !forced(sim, war)) return;
  }
  war.battles++;
  w.stats.battles++;
  if (!war.splinter) w.stats.estBattles++;
  const str = (side: number) => (side === 0 ? out[BO.strLostA] : out[BO.strLostB]);
  w.stats.battleWins[result > 0 ? 0 : result < 0 ? 1 : 2]++;
  if (result > 0) war.lastGain = sim.tick;
  // Losses and strength.
  const m = sim.military;
  if (m.strength.length > war.att) m.strength[war.att] = Math.max(0, m.strength[war.att] - str(0));
  if (m.strength.length > war.def) m.strength[war.def] = Math.max(0, m.strength[war.def] - str(1));
  applyLosses(sim, groupA, na, war.att, 0);
  applyLosses(sim, groupB, nb, war.def, 1);
  // The loser leaves the field; a draw sends both away.
  if (result >= 0) for (let i = 0; i < nb; i++) disbandArmy(sim, groupB[i]);
  if (result <= 0) for (let i = 0; i < na; i++) disbandArmy(sim, groupA[i]);
  // Giving up after the battle.
  const sa = m.strength[war.att] ?? 0;
  const sd = m.strength[war.def] ?? 0;
  const age = sim.tick - war.start;
  if (defenderGaveUp(war, sd, sa, age)) queueEnd(war, EndType.GaveUp);
  else if (gaveUp(sa, sd, age)) queueEnd(war, EndType.AttackerGaveUp);
}

function queueEnd(war: War, type: number): void {
  if (finishing.includes(war)) return;
  finishing.push(war);
  finishTypes.push(type);
}

/** Scales the group's armies to what is left of `side` after the battle and kills the difference in the cells. */
function applyLosses(sim: Simulation, group: Int32Array, count: number, civ: number, side: number): void {
  const w = sim.war;
  for (let t = 0; t < TROOP_TYPES; t++) {
    let before = 0;
    for (let i = 0; i < count; i++) before += w.aN[group[i] * 3 + t];
    if (before <= 0) continue;
    const left = remainingSoldiers(side, t);
    const lost = before - left;
    if (lost <= 0) continue;
    const k = left / before;
    for (let i = 0; i < count; i++) w.aN[group[i] * 3 + t] *= k;
    takeAway(sim, civ, t, Math.round(lost), true);
  }
}

// ---------------------------------------------------------------------------
// Siege (3b)

/** Defenders must fight when an occupation check is at most WAR.forceWeeks away. */
function forced(sim: Simulation, war: War): boolean {
  const age = sim.tick - war.siegeStart;
  const next = age <= WAR.occupyWeeks ? WAR.occupyWeeks : WAR.occupyWeeks + Math.ceil((age - WAR.occupyWeeks) / WAR.occupyCheck) * WAR.occupyCheck;
  return next - age <= WAR.forceWeeks;
}

const SUPPLY_LABEL = 'Besieged';
function startSiege(sim: Simulation, war: War): void {
  const w = sim.war;
  war.siegeStart = sim.tick;
  war.sieges++;
  w.stats.sieges++;
  if (!war.splinter) w.stats.estSieges++;
  w.siege[war.goal] = 1;
  w.siegeValue[war.goal] = -WAR.siegeMalus;
  w.stats.startSat += sim.satisfaction[war.goal];
  war.siegeStrength = besiegerStrength(sim, war);
  const mods: SupplyModifier[] = [];
  for (const kind of [SupplyKind.Food, SupplyKind.Water, SupplyKind.Space]) mods.push({ kind, label: SUPPLY_LABEL, amount: -0.5, percent: true });
  const old = sim.supplyModifiers.get(war.goal);
  sim.supplyModifiers.set(war.goal, old ? [...old, ...mods] : mods);
  updateCellSupply(sim, war.goal);
  record(sim, `The ${sim.civs[war.att]!.name} besieged the ${sim.civs[war.def]!.name} seat of government.`, war.goal);
}

function endSiege(sim: Simulation, war: War): void {
  const w = sim.war;
  if (war.siegeStart < 0) return;
  war.siegeStart = -1;
  war.occupied = false;
  w.siege[war.goal] = 0;
  w.siegeValue[war.goal] = 0;
  const old = sim.supplyModifiers.get(war.goal);
  if (old) {
    const rest = old.filter((x) => x.label !== SUPPLY_LABEL);
    if (rest.length > 0) sim.supplyModifiers.set(war.goal, rest);
    else sim.supplyModifiers.delete(war.goal);
    updateCellSupply(sim, war.goal);
  }
}

function besiegerStrength(sim: Simulation, war: War): number {
  const w = sim.war;
  let s = 0;
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a] || w.aWar[a] !== war.slot || w.aCiv[a] !== war.att || w.aCell[a] !== war.goal) continue;
    for (let t = 0; t < 3; t++) s += w.aN[a * 3 + t] * w.aFac[a * 3 + t];
  }
  return s;
}

function updateSiege(sim: Simulation, war: War): void {
  const w = sim.war;
  // Armies may have reached the seat without a battle that started it.
  const here = besiegerStrength(sim, war);
  if (war.siegeStart < 0) {
    if (here > 0) startSiege(sim, war);
    return;
  }
  if (here <= 0) {
    endSiege(sim, war);
    w.stats.siegeBroken++;
    return;
  }
  if (here < WAR.withdraw * war.siegeStrength) {
    for (let a = 0; a < MAX_ARMIES; a++) {
      if (w.live[a] && w.aWar[a] === war.slot && w.aCiv[a] === war.att && w.aCell[a] === war.goal) disbandArmy(sim, a);
    }
    endSiege(sim, war);
    w.stats.siegeWithdrew++;
    return;
  }
  if (war.siegeStrength < here) war.siegeStrength = here;
  if (war.occupied) return;
  const age = sim.tick - war.siegeStart;
  if (age < WAR.occupyWeeks || (age - WAR.occupyWeeks) % WAR.occupyCheck !== 0) return;
  const cell = war.goal;
  const sat = sim.satisfaction[cell];
  if (age === WAR.occupyWeeks) {
    w.stats.checks++;
    w.stats.checkSat += sat;
    w.stats.checkTarget += satTarget(sim, cell);
    if (sat < 0) w.stats.checksBelow++;
  }
  const value = WAR.occupyOnTarget ? satTarget(sim, cell) : sat;
  if (value < 0) {
    w.stats.occupations++;
    if (!war.splinter) w.stats.estOcc++;
    war.lastGain = sim.tick;
    if (WAR.giveUpMode === 1) war.occupied = true;
    else queueEnd(war, EndType.Conquered);
  }
}

function satTarget(sim: Simulation, cell: number): number {
  return satisfactionTarget(sim, cell, sim.civs[sim.world.owner[cell]] ?? null);
}

// ---------------------------------------------------------------------------
// End of a war

function endWar(sim: Simulation, war: War, type: number): void {
  const w = sim.war;
  if (w.slots[war.slot] !== war) return;
  const stats = w.stats;
  stats.ended[type]++;
  stats.warBattles += war.battles;
  if (war.battles === 0) stats.noBattle++;
  const attName = sim.civs[war.att]?.name ?? '?';
  const defName = sim.civs[war.def]?.name ?? '?';
  endSiege(sim, war);
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a] && w.aWar[a] === war.slot) disbandArmy(sim, a);
  w.slots[war.slot] = null;
  w.wars--;
  if (w.enemy[war.att] === war.def) w.enemy[war.att] = 0;
  if (w.enemy[war.def] === war.att) w.enemy[war.def] = 0;
  stats.durations.push(sim.tick - war.start);
  const dip = sim.diplomacy;
  for (const [x, y] of [
    [war.att, war.def],
    [war.def, war.att],
  ]) {
    if (!sim.civs[x] || !sim.civs[y]) continue;
    addMood(dip, x, y, 'War', -WAR.trustLoss, sim.tick);
    dip.peace[x * PAIRS + y] = 0;
  }
  w.truce.set(pairKey(war.att, war.def), sim.tick + WAR.truceYears * TICKS_PER_YEAR);
  if (type === EndType.Conquered || type === EndType.GaveUp) {
    if (sim.civs[war.att] && sim.civs[war.def] && sim.world.owner[war.goal] === war.def) transferDistrict(sim, war);
    record(sim, `The ${attName} conquered the seat of government of the ${defName}.`, war.goal);
  } else {
    record(sim, `The war between the ${attName} and the ${defName} ended (${END_NAMES[type]}).`, war.goal);
  }
  war.fieldAtt = null;
  war.fieldDef = null;
}

/** The goal seat's district goes from the loser to the attacker; the conquered get "Conquered". */
function transferDistrict(sim: Simulation, war: War): void {
  const w = sim.war;
  const gov = sim.government;
  const world = sim.world;
  const n = world.cellCount;
  const owner = world.owner;
  const mask = new Uint8Array(n);
  let cells = 0;
  let all = 0;
  let people = 0;
  for (let c = 0; c < n; c++) {
    if (owner[c] !== war.def || sim.cellPop[c] === 0) continue;
    all++;
    if (gov.district[c] !== war.goal) continue;
    mask[c] = 1;
    cells++;
    people += sim.cellPop[c];
  }
  if (cells === 0) return;
  if (cells === all) {
    w.stats.annexed++;
    if (!war.splinter) w.stats.estAnnexed++;
  }
  w.stats.cellsMoved += cells;
  w.stats.peopleMoved += people;
  // The loser's armies lose the soldiers of the cells (they stay as the conqueror's garrison).
  for (let c = 0; c < n; c++) {
    if (!mask[c]) continue;
    for (let t = 0; t < TROOP_TYPES; t++) {
      const k = w.away[c * 3 + t];
      if (k === 0) continue;
      w.away[c * 3 + t] = 0;
    }
  }
  const pop = sim.pop;
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i] || pop.civ[i] !== war.def || !mask[pop.cell[i]]) continue;
    changeCiv(sim, i, war.att);
  }
  for (let c = 0; c < n; c++) {
    if (!mask[c]) continue;
    owner[c] = war.att;
    w.conqValue[c] = -WAR.conqMalus;
    w.conqTick[c] = sim.tick;
  }
  gov.treasury[war.goal] *= WAR.loot;
  if (WAR.conquestRoad) {
    // One road from the district to the conqueror's old land, so it stays connected to its capital.
    let built = false;
    for (let c = 0; c < n && !built; c++) {
      if (!mask[c]) continue;
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const nb = world.neighbors[c * DIRECTION_COUNT + d];
        if (nb >= 0 && !mask[nb] && owner[nb] === war.att && sim.cellPop[nb] > 0) {
          addRoad(world, c, d);
          w.stats.roads++;
          built = true;
          break;
        }
      }
    }
  }
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
    for (let t = 0; t < TROOP_TYPES; t++) armySum[w.aCiv[a] * 3 + t] += w.aN[a * 3 + t];
  }
  for (let c = 0; c < n; c++) {
    for (let t = 0; t < TROOP_TYPES; t++) {
      const i = c * TROOP_TYPES + t;
      if (w.away[i] === 0) continue;
      const civ = owner[c];
      if (civ === 0 || armySum[civ * 3 + t] === 0) {
        w.away[i] = 0;
        continue;
      }
      if (w.away[i] > m.soldiers[i]) w.away[i] = m.soldiers[i];
      awaySum[civ * 3 + t] += w.away[i];
    }
  }
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a]) continue;
    for (let t = 0; t < TROOP_TYPES; t++) {
      const k = w.aCiv[a] * 3 + t;
      if (armySum[k] > awaySum[k] + 0.5) w.aN[a * 3 + t] *= awaySum[k] / armySum[k];
    }
  }
  // More away than in armies (rounding): bring the difference home.
  for (let civ = 1; civ < PAIRS; civ++) {
    for (let t = 0; t < TROOP_TYPES; t++) {
      const k = civ * 3 + t;
      const diff = Math.floor(awaySum[k] - armySum[k] + 0.5);
      if (diff > 0 && armySum[k] > 0) takeAway(sim, civ, t, diff, false);
    }
  }
}

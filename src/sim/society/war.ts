import { DIRECTION_COUNT, hexDistance } from '../hex';
import { MinHeap } from '../minHeap';
import { createRng, deriveSeed, type Rng } from '../rng';
import { isWaterBiome } from '../world/biomes';
import { Deposit } from '../world/deposits';
import { addRoad, stepCost } from '../world/roads';
import { BUILDINGS } from './buildings';
import { BO, BI, Defense, fightBattle, givesUp, remainingSoldiers } from './battle';
import { ALLY, Pact, foeStrength, mayOutweigh } from './pacts';
import { checkRebellion, continueRebellion, countRestless } from './rebellion';
import { breakAlliances, endPact, formAlliance, updateAlliances } from './alliance';
import { PAIRS, addMood, rebuildPartners } from './diplomacy';
import { updateCellSupply } from './economy';
import { MIL, TROOP_TYPES, Troop } from './military';
import { SupplyKind, type SupplyModifier } from './supply';
import { MOOD_REVOLUTION_LOST, MOOD_REVOLUTION_WON, addMood as addCivMood, hasSeat, satisfactionTarget } from './satisfaction';
import { changeCiv, dischargeSoldiers, record, type Simulation } from './simulation';

// War on the map, phase 3a + 3b ("Design Documents/Requirement Krieg.md",
// sections 4 to 6): declaration, armies, march, battles, siege, occupation,
// peace and conquest; phase 4b (section 7): allies join a war at its start
// (joinAllies) and fight on its sides (`side` per war and people, `foe` per
// pair), each with one army; the main parties' peace ends it for all; phase
// 5 (section 8): uprisings are rebellions, wars of the mother against all
// rebel seats (rebellion.ts declares them, startRebelWar and below run them).
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
// - Gathering: the attacker raises one main army (WAR.mainArmies) at its seat
//   nearest the goal, the defender up to WAR.reliefArmies relief armies at its
//   other seats nearest the goal (only without one: a garrison in the goal).
//   Contingents (the soldiers of each settlement, to the nearest rally point)
//   are not armies on the map: each walks virtually, at army speed over land
//   the army may enter, and joins its army when its travel time is over. The army stands at the rally point meanwhile (one
//   marker) and fights with the soldiers that have arrived. It sets out when
//   all have arrived, at the latest after WAR.gatherWeeks; the late ones go home.
// - A beaten army (a draw: both) retreats with what is left along the
//   cheapest way to its nearest own seat and goes home there (its soldiers
//   count in their cells again); a defender's army that reaches the goal seat
//   stays there as its garrison. Besiegers that withdraw retreat the same way.
//   Retreating armies don't attack, but are attacked where an enemy meets them.
// - At the war's end every army goes home at once.
// - Only the war goal is besieged; armies march to it and nowhere else, so no
//   other seat is ever occupied (nothing to give back at the war's end). A
//   rebellion has one goal at a time; the seats taken before stay occupied.
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
  /** Declaration: own strength above 0 and at least this times the target's; yearly chance per people with a candidate. */
  ratio: 2,
  chance: 0.1,
  /** Benefit of a district: inhabitants + resPop per deposit (x resMul for strategic and luxury deposits), divided by 1 + its defenders. */
  resPop: 50,
  resMul: 2,
  /** Armies: share of a people's soldiers that march, armies per people (all, retreating ones too) and worldwide, smallest army. */
  sendShare: 0.7,
  maxArmies: 4,
  worldArmies: 32,
  armyMin: 5,
  /** The attacker's main armies and the defender's relief armies (each from another seat) at a time. */
  mainArmies: 1,
  reliefArmies: 3,
  /** Weeks an army waits at its rally point for its contingents at most. */
  gatherWeeks: 8,
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
  /**
   * Phase 5 (uprisings as war, section 8; rebellion.ts): the rebels' militia, a share of their settlements'
   * people that fight as melee (no strategic factor, no pay, back to the people at the war's end); 5b: a third
   * people helps the rebels if the mother's danger for it is at least helpDanger and its trust in her below
   * helpTrust (and it has no pact or alliance with her, and the rebel side is then the stronger).
   */
  militia: 0.025,
  helpDanger: 50,
  helpTrust: 50,
  /** Years within which a second rebellion in the same realm counts as a chain (statistics only). */
  chainYears: 30,
};

/** Army slots (WAR.worldArmies is at most this). */
export const MAX_ARMIES = 32;
/** What an army does (WarState.aState). */
export const ArmyState = { Marching: 0, Gathering: 1, Retreating: 2 } as const;
/** Hexes of a retreat path at most (WAR.fieldMax / the cheapest step 0.5 is 50). */
const PATH_MAX = 64;
/** War slots. A war needs room for two armies when it starts, so 16 would do; spare slots for wars whose armies are gone. */
export const MAX_WARS = 24;
const TICKS_PER_YEAR = 52;

/** How a war ended. */
export const EndType = { GaveUp: 0, AttackerGaveUp: 1, Exhausted: 2, GoalLost: 3, Vanished: 4, Crushed: 5 } as const;
export const END_NAMES = ['defender gave up', 'attacker gave up', 'exhaustion', 'goal lost', 'a people vanished', 'rebellion crushed'] as const;
/** Rebel seats a rebellion can have (one per rebel group). */
export const MAX_GOALS = 8;

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
  /** Contingents sent, arrived, sent home late; armies that set out, their summed weeks of gathering. */
  contingents: number;
  contingentsArrived: number;
  contingentsLate: number;
  setOut: number;
  gatherWeeksSum: number;
  /** Retreats begun, retreats that reached their seat, battles a retreating army was in. */
  retreats: number;
  retreatsHome: number;
  retreatBattles: number;
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
  /** Phase 4: pacts and alliances signed, alliances downgraded, pacts/alliances ended, alliances broken by a declaration. */
  pactsSigned: number;
  alliancesSigned: number;
  downgraded: number;
  pactsEnded: number;
  alliesBroken: number;
  /** Allies that joined a war, declined (side too weak, an ally of the other side), and joined without room for an army. */
  joins: number;
  joinWeak: number;
  joinOwnAlly: number;
  joinNoRoom: number;
  /** Wars with at least one ally, and their battles, sieges, occupations, whole peoples annexed. */
  allyWars: number;
  /** Wars with allies on both sides. */
  allyWarsBoth: number;
  allyBattles: number;
  allySieges: number;
  allyOcc: number;
  allyAnnexed: number;
  /** Largest number of peoples on one side of a war. */
  maxSide: number;
  /** Phase 5: rebellions declared, rebel groups and settlements and people in them, ended: crushed / rebels gave up / exhaustion / other. */
  rebDeclared: number;
  rebGroups: number;
  rebSettlements: number;
  rebPeople: number;
  rebCrushed: number;
  rebGaveUp: number;
  rebExhausted: number;
  rebOther: number;
  rebDurationSum: number;
  rebAnnexedGroups: number;
  /** Rebellions with outside helpers / the mother's partners that joined, and the helpers / partners joined. */
  rebHelpWars: number;
  rebHelpers: number;
  rebMotherAllies: number;
  /** Battles, sieges and occupations in rebel wars. */
  rebBattles: number;
  rebSieges: number;
  rebOcc: number;
  /** Chains: rebellions in a realm that had one within WAR.chainYears, settlements that rose a second time, most rebellions in one realm. */
  rebRepeat: number;
  rebCellRepeat: number;
  rebMaxRealm: number;
  /** Rebellions that found no room for a people (no free id) and the militia raised. */
  rebNoRoom: number;
  /** Sum of the mother's / the rebels' strength at the declarations (each capped at 5). */
  rebRatioSum: number;
  /** Militia raised, and gone back to the people at the wars' ends. */
  militia: number;
  militiaBack: number;
  /** WAR_PROFILE: ms of the slowest rebellion check step (a declaration included). */
  rebelMax: number;
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
  /** Phase 5: 1 for a rebellion (the attacker is the mother, the defender side the rebel groups), its goals (one seat per rebel group), how many, which are occupied. */
  wRebel: Uint8Array;
  wGoals: Int32Array;
  wGoalN: Uint8Array;
  wGoalDone: Uint8Array;
  /** Per people: the mother of a rebel group (0 = none), the rebel wars a people is the mother of, tick and count of its rebellions. */
  rebelMother: Uint8Array;
  motherBusy: Uint8Array;
  rebLast: Int32Array;
  rebTimes: Uint8Array;
  /**
   * The year's rebellion checks (runWarYearStep, one realm per step): `restless` counts each people's
   * dissatisfied settlements, `rebelNext` is the next people to check (0 = not begun this year, PAIRS = done).
   */
  restless: Uint16Array;
  rebelNext: number;
  /**
   * A declaration spread over steps of the war's year (rebellion.ts): 0 none, 1 founding the rebel peoples (one
   * per step), 2 their settlements change sides, 3 the war starts. The mother; per cell the rebel group + 1
   * (`rebelTo`, 0 = none); per group (largest first) its capital, settlements and new people; groups chosen and founded.
   */
  rebelStage: number;
  rebelOf: number;
  rebelTo: Uint8Array;
  rebelSeats: Int32Array;
  rebelCells: Int32Array;
  rebelCivs: Int32Array;
  rebelPicked: number;
  rebelCount: number;
  /** Per cell: rebel militia (melee soldiers among the cell's soldiers that need no building and get no pay), times the settlement rose. */
  militia: Uint16Array;
  rebCount: Uint8Array;
  /** Phase 4: allies that joined the war. */
  wAllies: Uint8Array;
  /** Per war and people (war * PAIRS + people): 0 attacker's side, 1 defender's side, -1 not in the war. */
  side: Int8Array;
  /** Per people pair (a * PAIRS + b): in how many wars they are on opposite sides (main parties and allies). */
  foe: Uint8Array;
  /** Per people: wars it fights in as an ally. */
  allyWarsOf: Uint8Array;
  /**
   * The war whose sides still raise their armies in the next steps of the
   * war's year (runWarYearStep: one member per step), -1 if none; `raiseNext`
   * is the next member: 0 the attacker, 1 the defender, 2 + p the ally p.
   */
  raiseWar: number;
  raiseNext: number;
  /** Pacts and alliances (alliance.ts): per pair 0 none, 1 pact, 2 alliance (symmetric), a pact's common threat, and the number of pairs with one. */
  pact: Uint8Array;
  pactX: Uint8Array;
  pactCount: number;
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
  /** ArmyState; while gathering: contingents still on the way and the tick it sets out at the latest. */
  aState: Uint8Array;
  aWait: Uint16Array;
  aLeave: Int32Array;
  /** While retreating: the way to the seat (army * PATH_MAX + step, the seat last), its length and the next step. */
  aPath: Int32Array;
  aPathLen: Uint8Array;
  aPathPos: Uint8Array;
  /** Armies gathering. */
  gathering: number;
  /** Per cell: the army its contingent walks to (-1 = none), the tick it arrives, its soldiers per troop type (cell * TROOP_TYPES + type). */
  cArmy: Int8Array;
  cArrive: Int32Array;
  pend: Uint16Array;
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
    wRebel: new Uint8Array(MAX_WARS),
    wGoals: new Int32Array(MAX_WARS * MAX_GOALS).fill(-1),
    wGoalN: new Uint8Array(MAX_WARS),
    wGoalDone: new Uint8Array(MAX_WARS * MAX_GOALS),
    rebelMother: new Uint8Array(PAIRS),
    motherBusy: new Uint8Array(PAIRS),
    rebLast: new Int32Array(PAIRS),
    rebTimes: new Uint8Array(PAIRS),
    restless: new Uint16Array(PAIRS),
    rebelNext: 0,
    rebelStage: 0,
    rebelOf: 0,
    rebelTo: new Uint8Array(cellCount),
    rebelSeats: new Int32Array(MAX_GOALS),
    rebelCells: new Int32Array(MAX_GOALS),
    rebelCivs: new Int32Array(MAX_GOALS),
    rebelPicked: 0,
    rebelCount: 0,
    militia: new Uint16Array(cellCount),
    rebCount: new Uint8Array(cellCount),
    wAllies: new Uint8Array(MAX_WARS),
    side: new Int8Array(MAX_WARS * PAIRS).fill(-1),
    foe: new Uint8Array(PAIRS * PAIRS),
    allyWarsOf: new Uint8Array(PAIRS),
    raiseWar: -1,
    raiseNext: 0,
    pact: new Uint8Array(PAIRS * PAIRS),
    pactX: new Uint8Array(PAIRS * PAIRS),
    pactCount: 0,
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
    aState: new Uint8Array(MAX_ARMIES),
    aWait: new Uint16Array(MAX_ARMIES),
    aLeave: new Int32Array(MAX_ARMIES),
    aPath: new Int32Array(MAX_ARMIES * PATH_MAX),
    aPathLen: new Uint8Array(MAX_ARMIES),
    aPathPos: new Uint8Array(MAX_ARMIES),
    gathering: 0,
    cArmy: new Int8Array(cellCount).fill(-1),
    cArrive: new Int32Array(cellCount),
    pend: new Uint16Array(cellCount * TROOP_TYPES),
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
      contingents: 0,
      contingentsArrived: 0,
      contingentsLate: 0,
      setOut: 0,
      gatherWeeksSum: 0,
      retreats: 0,
      retreatsHome: 0,
      retreatBattles: 0,
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
      pactsSigned: 0,
      alliancesSigned: 0,
      downgraded: 0,
      pactsEnded: 0,
      alliesBroken: 0,
      joins: 0,
      joinWeak: 0,
      joinOwnAlly: 0,
      joinNoRoom: 0,
      allyWars: 0,
      allyWarsBoth: 0,
      allyBattles: 0,
      allySieges: 0,
      allyOcc: 0,
      allyAnnexed: 0,
      maxSide: 0,
      rebDeclared: 0,
      rebGroups: 0,
      rebSettlements: 0,
      rebPeople: 0,
      rebCrushed: 0,
      rebGaveUp: 0,
      rebExhausted: 0,
      rebOther: 0,
      rebDurationSum: 0,
      rebAnnexedGroups: 0,
      rebHelpWars: 0,
      rebHelpers: 0,
      rebMotherAllies: 0,
      rebBattles: 0,
      rebSieges: 0,
      rebOcc: 0,
      rebRepeat: 0,
      rebCellRepeat: 0,
      rebMaxRealm: 0,
      rebNoRoom: 0,
      rebRatioSum: 0,
      militia: 0,
      militiaBack: 0,
      rebelMax: 0,
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

/** The side of people `civ` in war `s` (0 attacker's, 1 defender's, -1 none). */
function sideOf(w: WarState, s: number, civ: number): number {
  return w.side[s * PAIRS + civ];
}

/** The side of army `a`. */
function armySide(w: WarState, a: number): number {
  return w.side[w.aWar[a] * PAIRS + w.aCiv[a]];
}

/** Whether people `a` and `b` are on opposite sides of some war. */
export function atWar(sim: Simulation, a: number, b: number): boolean {
  return sim.war.foe[a * PAIRS + b] > 0;
}

/** Whether a new war between a and b is barred by a truce. */
export function inTruce(sim: Simulation, a: number, b: number): boolean {
  return sim.tick < sim.war.truce[pairKey(a, b)];
}

/** A new people takes id `id` (a reused one): no war, no truce from the old people of that id. */
export function resetWarCiv(sim: Simulation, id: number): void {
  const w = sim.war;
  // Rebel wars the old people was the mother of end (its rebels stay independent); a rebel group just leaves its rebellion.
  for (let q = 0; q < MAX_WARS; q++) {
    if (!w.wLive[q] || !w.wRebel[q]) continue;
    if (w.wAtt[q] === id) endWar(sim, q, EndType.Vanished);
    else if (isRebelGroup(w, q, id)) leaveRebellion(sim, q, id);
  }
  const s = w.civWar[id];
  if (s >= 0 && w.wLive[s]) endWar(sim, s, EndType.Vanished);
  // Wars the old people fought as an ally: it leaves them (their foes count down).
  for (let q = 0; q < MAX_WARS; q++) if (w.wLive[q] && w.side[q * PAIRS + id] >= 0) dropMember(sim, q, id);
  w.rebelMother[id] = 0;
  w.motherBusy[id] = 0;
  w.rebLast[id] = 0;
  w.rebTimes[id] = 0;
  w.enemy[id] = 0;
  w.civWar[id] = -1;
  for (let b = 0; b < PAIRS; b++) endPact(sim, id, b);
  for (let q = 0; q < MAX_WARS; q++) w.side[q * PAIRS + id] = -1;
  w.allyWarsOf[id] = 0;
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
  for (let step = 0; step >= 0; step = runWarYearStep(sim, step));
}

/**
 * One step of the war's yearly part, so the game clock can spread it over
 * frames (raising armies and planning marches search the map): step 0
 * first comes back as 0 for the alliances, then once per realm with
 * dissatisfied settlements (its rebellion check, rebellion.ts); steps 0 to
 * MAX_WARS - 1 check one running war each (end, or new armies), the further
 * steps roll the declarations in people order up to the next war declared.
 * Returns the next step, -1 after the last; all steps in a row give exactly
 * runWarYear.
 */
export function runWarYearStep(sim: Simulation, step: number): number {
  if (!WAR.enabled) return -1;
  const t0 = clockStart();
  const w = sim.war;
  // Armies of the war reviewed or declared in the step before: one side member per step.
  if (w.raiseWar >= 0) {
    raiseNextMember(sim);
    profileYear(w, t0, step);
    return step;
  }
  // A rebellion being declared: its next step (founding a rebel people, changing sides, the war).
  if (w.rebelStage !== 0) {
    continueRebellion(sim);
    if (WAR_PROFILE.clock) w.stats.rebelMax = Math.max(w.stats.rebelMax, WAR_PROFILE.clock() - t0);
    profileYear(w, t0, step);
    return step;
  }
  if (step === 0 && w.rebelNext < PAIRS) {
    // First the alliances and the count of dissatisfied settlements, then one realm's rebellion check per step.
    if (w.rebelNext === 0) {
      updateAlliances(sim);
      countRestless(sim);
      w.rebelNext = 1;
      profileYear(w, t0, 0);
      return 0;
    }
    const max = sim.diplomacy.maxId;
    let civ = w.rebelNext;
    while (civ <= max && w.restless[civ] === 0) civ++;
    if (civ <= max) {
      w.rebelNext = civ + 1;
      checkRebellion(sim, civ);
      if (WAR_PROFILE.clock) w.stats.rebelMax = Math.max(w.stats.rebelMax, WAR_PROFILE.clock() - t0);
      profileYear(w, t0, 0);
      return 0;
    }
    w.rebelNext = PAIRS;
  }
  let next = -1;
  let s = step;
  while (s < MAX_WARS && !w.wLive[s]) s++;
  if (s < MAX_WARS) {
    reviewWar(sim, s, true);
    next = s + 1;
  } else {
    // Declarations: step MAX_WARS + i goes on from people i + 1.
    const a = declareWars(sim, Math.max(step, MAX_WARS) - MAX_WARS + 1);
    if (a >= 0) next = MAX_WARS + a - 1;
  }
  if (next < 0) w.rebelNext = 0;
  profileYear(w, t0, next);
  return next;
}

function profileYear(w: WarState, t0: number, next: number): void {
  if (!WAR_PROFILE.clock) return;
  const dt = WAR_PROFILE.clock() - t0;
  w.stats.yearMs += dt;
  if (next < 0) w.stats.yearCalls++;
  if (dt > w.stats.yearMax) w.stats.yearMax = dt;
}

/** Raises the armies of the next member of war `raiseWar` (attacker, defender, allies in people order); ends the round after the last. */
function raiseNextMember(sim: Simulation): void {
  const w = sim.war;
  const s = w.raiseWar;
  const att = w.wAtt[s];
  const def = w.wDef[s];
  if (w.raiseNext === 0) {
    w.raiseNext = 1;
    reraise(sim, s, att);
    return;
  }
  const p = w.raiseNext === 1 ? def : w.raiseNext - 2;
  reraise(sim, s, p);
  // The next ally after p (people order), or the round ends.
  const next = w.wAllies[s] > 0 ? nextAlly(sim, s, w.raiseNext === 1 ? 1 : p + 1) : -1;
  if (next < 0) w.raiseWar = -1;
  else w.raiseNext = next + 2;
}

/** The first ally of war `s` (a member other than its main parties) from people `from` on, -1 if none. */
function nextAlly(sim: Simulation, s: number, from: number): number {
  const w = sim.war;
  const max = sim.diplomacy.maxId;
  for (let p = from; p <= max; p++) if (p !== w.wAtt[s] && p !== w.wDef[s] && sideOf(w, s, p) >= 0) return p;
  return -1;
}

/** Leaves the armies of war `s` to raiseNextMember, from the attacker on. */
function raiseLater(w: WarState, s: number): void {
  w.raiseWar = s;
  w.raiseNext = 0;
}

/**
 * The yearly check of running war `s`: a side gives up or is exhausted, else
 * both raise what they may still have (with `later`, in the next steps).
 */
function reviewWar(sim: Simulation, s: number, later = false): void {
  const w = sim.war;
  if (endIfGone(sim, s)) return;
  const att = w.wAtt[s];
  const def = w.wDef[s];
  if (w.wAllies[s] > 0) {
    // Allies that vanished leave before the sides are weighed.
    for (let p = 1; p <= sim.diplomacy.maxId; p++) if (p !== att && p !== def && sideOf(w, s, p) >= 0 && !sim.civs[p]) dropMember(sim, s, p);
  }
  const sa = sideStrength(sim, s, 0);
  const sd = sideStrength(sim, s, 1);
  if (defenderGivesUp(w, s, sd, sa)) endWar(sim, s, EndType.GaveUp);
  else if (attackerGivesUp(w, s, sa, sd)) endWar(sim, s, EndType.AttackerGaveUp);
  else if (sim.tick - w.wLastGain[s] >= WAR.exhaustYears * TICKS_PER_YEAR) endWar(sim, s, EndType.Exhausted);
  else if (later) raiseLater(w, s);
  else {
    reraise(sim, s, att);
    reraise(sim, s, def);
    if (w.wAllies[s] > 0) {
      for (let p = 1; p <= sim.diplomacy.maxId; p++) if (p !== att && p !== def && sideOf(w, s, p) >= 0) reraise(sim, s, p);
    }
  }
}

/** Strength of `side` (0 attacker's, 1 defender's) of war `s`: its main party and the allies that joined it. */
export function sideStrength(sim: Simulation, s: number, side: number): number {
  const w = sim.war;
  const m = sim.military.strength;
  const main = side === 0 ? w.wAtt[s] : w.wDef[s];
  let sum = main < m.length ? m[main] : 0;
  if (w.wAllies[s] === 0) return sum;
  const max = sim.diplomacy.maxId;
  for (let p = 1; p <= max; p++) {
    if (p !== main && w.side[s * PAIRS + p] === side && sim.civs[p] && p < m.length) sum += m[p];
  }
  return sum;
}

/** Whether the attacker gives up: below BATTLE.giveUp of the other side; the mother of a rebellion never does. */
function attackerGivesUp(w: WarState, s: number, sa: number, sd: number): boolean {
  return w.wRebel[s] === 0 && givesUp(sa, sd);
}

/**
 * The defender gives up only once the goal seat is occupied, and then below
 * BATTLE.giveUp of the attacker's strength; rebels once one of their seats
 * is occupied (then the mother has won).
 */
function defenderGivesUp(w: WarState, s: number, sd: number, sa: number): boolean {
  const taken = w.wRebel[s] === 1 ? rebelSeatTaken(w, s) : w.wOccupied[s] === 1;
  return taken && givesUp(sd, sa);
}

/** Whether the mother has occupied a seat of rebellion `s` (the current goal or an earlier one). */
function rebelSeatTaken(w: WarState, s: number): boolean {
  if (w.wOccupied[s] === 1) return true;
  for (let i = 0; i < w.wGoalN[s]; i++) if (w.wGoalDone[s * MAX_GOALS + i]) return true;
  return false;
}

/** Ends war `s` if a side vanished or the goal seat is no longer the defender's; true if it ended. */
function endIfGone(sim: Simulation, s: number): boolean {
  const w = sim.war;
  if (w.wRebel[s] === 1) return rebellionGone(sim, s);
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

/** Armies of `civ` (all its wars, retreating ones too). */
function countArmies(w: WarState, civ: number): number {
  let k = 0;
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a] && w.aCiv[a] === civ) k++;
  return k;
}

function worldRoom(w: WarState): number {
  return Math.min(WAR.worldArmies, MAX_ARMIES) - w.armies;
}

/**
 * Raises what `civ` may still have in war `s`: the attacker up to
 * WAR.mainArmies, the defender up to WAR.reliefArmies (armies not
 * retreating), all its armies at most WAR.maxArmies, the world WAR.worldArmies.
 */
function reraise(sim: Simulation, s: number, civ: number): void {
  const w = sim.war;
  let active = 0;
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (w.live[a] && w.aWar[a] === s && w.aCiv[a] === civ && w.aState[a] !== ArmyState.Retreating) active++;
  }
  // A rebel group fights like a main party (its own armies, the relief armies' number).
  const group = w.rebelMother[civ] !== 0 && w.rebelMother[civ] === w.wAtt[s];
  const main = civ === w.wAtt[s] || civ === w.wDef[s] || group;
  const cap = !main ? ALLY.armies : civ === w.wAtt[s] ? WAR.mainArmies : WAR.reliefArmies;
  const room = Math.min(cap - active, WAR.maxArmies - countArmies(w, civ), worldRoom(w));
  if (room > 0) raiseArmies(sim, s, civ, room, main ? WAR.sendShare : ALLY.send);
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
  // Only a people at peace starts a war (neither a main party nor an ally in one).
  if (!sim.civs[a] || w.enemy[a] !== 0 || w.allyWarsOf[a] > 0 || w.motherBusy[a] > 0) return false;
  const sa = m.strength[a] ?? 0;
  if (sa <= 0) return false;
  let any = false;
  for (let b = 1; b < civs; b++) {
    if (b === a || !sim.civs[b] || w.enemy[b] !== 0 || w.motherBusy[b] > 0 || adj[a * civs + b] === 0 || inTruce(sim, a, b)) continue;
    // Allies never attack each other.
    if (w.pact[a * PAIRS + b] === Pact.Alliance) continue;
    if (!mayOutweigh(sim, a, b, WAR.ratio)) continue;
    candidate[b] = 1;
    any = true;
  }
  return any;
}

/**
 * The peoples `a` may declare war on now (none while `a` has no strength):
 * neighbors (a common border), at least WAR.ratio times weaker, not in a truce with it, and neither side at war.
 */
export function warTargets(sim: Simulation, a: number): number[] {
  const civs = findNeighbors(sim);
  const list: number[] = [];
  if (markCandidates(sim, a, civs)) for (let b = 1; b < civs; b++) if (candidate[b]) list.push(b);
  return list;
}

/**
 * Every people from id `from` on with a target rolls WAR.chance; the winner
 * picks its goal and declares. Stops after a declared war and returns the
 * next people's id (to go on from), -1 when all have rolled.
 */
function declareWars(sim: Simulation, from: number): number {
  const w = sim.war;
  const civs = findNeighbors(sim);
  for (let a = from; a < civs; a++) {
    if (!markCandidates(sim, a, civs) || w.rng() >= WAR.chance) continue;
    if (worldRoom(w) < 2 || w.wars >= MAX_WARS) {
      w.stats.capBlocked++;
      continue;
    }
    const goal = chooseGoal(sim, a, candidate);
    if (goal >= 0 && startWar(sim, a, goal, true) >= 0) return a + 1;
  }
  return -1;
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
 * tests). Borders and agreements end, both sides raise their armies (with `later`: in the next steps of the war's year, see raiseNextMember). Returns
 * the war's slot, -1 if there is no room.
 */
export function startWar(sim: Simulation, att: number, goal: number, later = false): number {
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
  w.wRebel[s] = 0;
  w.wGoalN[s] = 0;
  w.wAllies[s] = 0;
  w.wEnd[s] = -1;
  w.side.fill(-1, s * PAIRS, s * PAIRS + PAIRS);
  w.side[s * PAIRS + att] = 0;
  w.side[s * PAIRS + def] = 1;
  w.foe[att * PAIRS + def]++;
  w.foe[def * PAIRS + att]++;
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
  record(sim, `The ${sim.civs[att]!.name} declared war on the ${sim.civs[def]!.name}.`, goal);
  // A declaration ends the alliances with partners allied to the target; a war ends the pact between its parties.
  if (w.pactCount > 0) {
    breakAlliances(sim, att, def);
    endPact(sim, att, def);
    if (w.pactCount > 0) joinAllies(sim, s);
  }
  planMarch(sim, s);
  if (w.wAllies[s] > 0) {
    st.allyWars++;
    let sides = 0;
    for (let p = 1; p <= sim.diplomacy.maxId; p++) if (p !== att && p !== def && sideOf(w, s, p) >= 0) sides |= 1 << sideOf(w, s, p);
    if (sides === 3) st.allyWarsBoth++;
  }
  if (later) {
    // The armies in the next steps of the war's year (declareWars).
    raiseLater(w, s);
    return s;
  }
  reraise(sim, s, att);
  reraise(sim, s, def);
  if (w.wAllies[s] > 0) {
    for (let p = 1; p <= sim.diplomacy.maxId; p++) if (p !== att && p !== def && sideOf(w, s, p) >= 0) reraise(sim, s, p);
  }
  return s;
}

const candA = new Uint8Array(PAIRS);
const candD = new Uint8Array(PAIRS);

/**
 * Phase 4b: the allies of both parties join war `s` (only at its start). The
 * defender's pact and alliance partners always join it first; the attacker's
 * alliance partners then join if the attacker's side with them is stronger
 * than the defender with all its pacts and alliances. A people that is the
 * ally of one party and a partner of the other (pact or alliance) joins
 * neither; none that is allied to a member of the other side joins. Joining
 * ends agreements and pacts with the other side.
 */
function joinAllies(sim: Simulation, s: number): void {
  const w = sim.war;
  const m = sim.military;
  const att = w.wAtt[s];
  const def = w.wDef[s];
  const max = sim.diplomacy.maxId;
  const st = w.stats;
  candA.fill(0);
  candD.fill(0);
  let sumA = m.strength[att] ?? 0;
  for (let p = 1; p <= max; p++) {
    if (p === att || p === def || !sim.civs[p]) continue;
    const ka = w.pact[att * PAIRS + p];
    const kd = w.pact[def * PAIRS + p];
    if (ka === Pact.Alliance && kd !== Pact.None) {
      // Bound to both parties (breakAlliances has ended an alliance with both already): it stays out.
      st.joinOwnAlly++;
    } else if (ka === Pact.Alliance) {
      candA[p] = 1;
      sumA += m.strength[p] ?? 0;
    } else if (kd !== Pact.None) {
      candD[p] = 1;
    }
  }
  // The defender's partners always join.
  for (let p = 1; p <= max; p++) if (candD[p]) joinMember(sim, s, p, 1);
  // The attacker's allies only if their side can win against the defender with all its pacts and alliances.
  const okA = sumA > foeStrength(sim, def, att);
  for (let p = 1; p <= max; p++) {
    if (!candA[p]) continue;
    if (!okA) st.joinWeak++;
    else joinMember(sim, s, p, 0);
  }
}

/** People `p` becomes a member of war `s` on `side`: foes of every member of the other side, agreements with them end. */
function addMember(sim: Simulation, s: number, p: number, side: number): void {
  const w = sim.war;
  const max = sim.diplomacy.maxId;
  w.side[s * PAIRS + p] = side;
  if (p !== w.wAtt[s] && p !== w.wDef[s]) {
    w.wAllies[s]++;
    w.allyWarsOf[p]++;
  }
  let count = 0;
  for (let q = 1; q <= max; q++) {
    const sq = sideOf(w, s, q);
    if (sq === side) count++;
    if (sq !== 1 - side) continue;
    w.foe[p * PAIRS + q]++;
    w.foe[q * PAIRS + p]++;
    endPact(sim, p, q);
    sever(sim, p, q);
  }
  if (count > w.stats.maxSide) w.stats.maxSide = count;
}

/** People `p` joins war `s` on `side` (unless it is allied to a member of the other side). */
function joinMember(sim: Simulation, s: number, p: number, side: number): void {
  const w = sim.war;
  const max = sim.diplomacy.maxId;
  for (let q = 1; q <= max; q++) {
    if (sideOf(w, s, q) === 1 - side && w.pact[p * PAIRS + q] === Pact.Alliance) {
      w.stats.joinOwnAlly++;
      return;
    }
  }
  // It joins even without room for its army on the map (it raises one yearly once there is room).
  if (worldRoom(w) < 1 || countArmies(w, p) >= WAR.maxArmies) w.stats.joinNoRoom++;
  addMember(sim, s, p, side);
  w.stats.joins++;
  const main = side === 0 ? w.wAtt[s] : w.wDef[s];
  record(sim, `The ${sim.civs[p]!.name} joined the ${sim.civs[main]!.name} in the war against the ${sim.civs[side === 0 ? w.wDef[s] : w.wAtt[s]]!.name}.`, w.wGoal[s]);
}

/** Ally `p` leaves war `s` (it vanished, or the war ends). */
function dropMember(sim: Simulation, s: number, p: number): void {
  const w = sim.war;
  const side = sideOf(w, s, p);
  if (side < 0) return;
  const max = sim.diplomacy.maxId;
  for (let q = 1; q <= max; q++) {
    if (sideOf(w, s, q) === 1 - side) {
      if (w.foe[p * PAIRS + q] > 0) w.foe[p * PAIRS + q]--;
      if (w.foe[q * PAIRS + p] > 0) w.foe[q * PAIRS + p]--;
    }
  }
  w.side[s * PAIRS + p] = -1;
  if (p !== w.wAtt[s] && p !== w.wDef[s]) {
    w.wAllies[s]--;
    if (w.allyWarsOf[p] > 0) w.allyWarsOf[p]--;
  }
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a] && w.aWar[a] === s && w.aCiv[a] === p) disbandArmy(sim, a);
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

/** Whether `c` is a seat of government of `civ` (its capital or a settlement with a seat). */
function isSeatOf(sim: Simulation, c: number, civ: number): boolean {
  if (sim.world.owner[c] !== civ || sim.cellPop[c] === 0) return false;
  return sim.civs[civ]?.capital === c || (sim.hasBuildings[c] === 1 && hasSeat(sim.economy, c));
}

const rallyBuf = new Int32Array(MAX_ARMIES);

/**
 * Where `civ`'s armies for war `s` gather (up to `max`, into `out`): its seats
 * nearest the goal (least travel cost to it, else fewest hexes, else the lower
 * cell). The attacker's may be any seat; the defender's are its other seats
 * (relief armies), and only without one the goal itself (its garrison).
 */
export function rallyPoints(sim: Simulation, s: number, civ: number, max: number, out: Int32Array): number {
  const n = sim.world.cellCount;
  const w = sim.war;
  const goal = w.wGoal[s];
  const defender = sideOf(w, s, civ) === 1;
  const base = (s * 2 + (defender ? 1 : 0)) * n;
  let k = 0;
  while (k < max) {
    let best = -1;
    let bestCost = Infinity;
    let bestD = Infinity;
    for (let c = 0; c < n; c++) {
      if ((defender && c === goal) || !isSeatOf(sim, c, civ)) continue;
      let taken = false;
      for (let j = 0; j < k; j++) if (out[j] === c) taken = true;
      if (taken) continue;
      const cost = w.field[base + c];
      const d = hexDistance(sim.world, c, goal);
      if (best < 0 || cost < bestCost || (cost === bestCost && d < bestD)) {
        best = c;
        bestCost = cost;
        bestD = d;
      }
    }
    if (best < 0) break;
    out[k++] = best;
  }
  if (k === 0 && defender && max > 0 && isSeatOf(sim, goal, civ)) out[k++] = goal;
  return k;
}

/** The first rally point of `civ` in war `s`, -1 if none. */
export function rallyPoint(sim: Simulation, s: number, civ: number): number {
  return rallyPoints(sim, s, civ, 1, rallyBuf) > 0 ? rallyBuf[0] : -1;
}

/**
 * Travel cost from every hex to the nearest of `count` rally points (rallyBuf)
 * over land `civ` may enter in war against `enemy` (up to WAR.fieldMax;
 * Infinity beyond), and which one is nearest (`label`, index into rallyBuf).
 */
let gatherCost = new Float32Array(0);
let gatherLabel = new Int8Array(0);
function costFrom(sim: Simulation, s: number, count: number, civ: number, dist: Float32Array, label: Int8Array): void {
  const world = sim.world;
  const owner = world.owner;
  dist.fill(Infinity);
  fieldHeap.size = 0;
  for (let j = 0; j < count; j++) {
    const r = rallyBuf[j];
    dist[r] = 0;
    label[r] = j;
    fieldHeap.push(r, 0);
  }
  while (fieldHeap.size > 0) {
    const c = fieldHeap.pop();
    const here = dist[c];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || isWaterBiome(world.biome[nb]) || !mayEnter(sim, s, owner[nb], civ)) continue;
      const next = here + stepCost(world, c, d);
      if (next >= dist[nb] || next > WAR.fieldMax) continue;
      dist[nb] = next;
      label[nb] = label[c];
      fieldHeap.push(nb, next);
    }
  }
}

/** A free army slot set up for `civ` in war `s` on `cell` (no soldiers yet); -1 if none. */
function newArmy(sim: Simulation, s: number, civ: number, cell: number): number {
  const w = sim.war;
  let a = 0;
  while (a < MAX_ARMIES && w.live[a]) a++;
  if (a === MAX_ARMIES) return -1;
  w.live[a] = 1;
  w.aCiv[a] = civ;
  w.aWar[a] = s;
  w.aCell[a] = cell;
  w.aProg[a] = 0;
  w.aIdle[a] = 0;
  w.aSince[a] = sim.tick;
  w.aState[a] = ArmyState.Marching;
  w.aWait[a] = 0;
  w.aPathLen[a] = 0;
  w.aPathPos[a] = 0;
  for (let t = 0; t < TROOP_TYPES; t++) {
    w.aN[a * TROOP_TYPES + t] = 0;
    w.aFac[a * TROOP_TYPES + t] = 1 + (MIL.factor - 1) * (sold[t] > 0 ? cov[t] / sold[t] : 0);
  }
  w.armies++;
  w.stats.armiesRaised++;
  if (w.armies > w.stats.maxArmies) w.stats.maxArmies = w.armies;
  w.version++;
  return a;
}

const labelTotal = new Float64Array(MAX_ARMIES);
const labelArmy = new Int32Array(MAX_ARMIES);

/**
 * Raises up to `room` armies of `civ` for war `s`, one per rally point
 * (rallyPoints), from WAR.sendShare of its soldiers (never more than that
 * share away or on the way at a time). Every settlement that can reach a
 * rally point sends its share as a contingent to the nearest one; it joins
 * that army after its travel time (cost / WAR.speed weeks, rounded up). An
 * army sets out when all its contingents have arrived, at the latest after
 * WAR.gatherWeeks. A rally point that would gather fewer than WAR.armyMin
 * soldiers raises no army (its settlements send none).
 */
function raiseArmies(sim: Simulation, s: number, civ: number, room: number, share: number = WAR.sendShare): void {
  const w = sim.war;
  const m = sim.military;
  const n = sim.world.cellCount;
  const owner = sim.world.owner;
  if (room <= 0) return;
  if (takeBuf.length !== n * TROOP_TYPES) {
    takeBuf = new Int32Array(n * TROOP_TYPES);
    raiseCells = new Int32Array(n);
    gatherCost = new Float32Array(n);
    gatherLabel = new Int8Array(n);
  }
  const rallies = rallyPoints(sim, s, civ, Math.min(room, MAX_ARMIES), rallyBuf);
  if (rallies === 0) return;
  costFrom(sim, s, rallies, civ, gatherCost, gatherLabel);
  sold.fill(0);
  cov.fill(0);
  labelTotal.fill(0);
  let cells = 0;
  for (let c = 0; c < n; c++) {
    if (owner[c] !== civ) continue;
    const reach = gatherCost[c] !== Infinity && w.cArmy[c] < 0;
    let any = 0;
    for (let t = 0; t < TROOP_TYPES; t++) {
      const i = c * TROOP_TYPES + t;
      const k = m.soldiers[i];
      takeBuf[i] = 0;
      if (k === 0) continue;
      sold[t] += k;
      // A rebellion's militia fights without the strategic factor.
      if (m.covered[i]) cov[t] += k - (t === Troop.Melee ? Math.min(k, w.militia[c]) : 0);
      if (!reach) continue;
      const take = Math.max(0, Math.floor(share * k) - w.away[i] - w.pend[i]);
      takeBuf[i] = take;
      any += take;
    }
    if (any > 0) {
      raiseCells[cells++] = c;
      labelTotal[gatherLabel[c]] += any;
    }
  }
  let raised = 0;
  for (let j = 0; j < rallies; j++) {
    labelArmy[j] = -1;
    if (labelTotal[j] < WAR.armyMin) continue;
    const a = newArmy(sim, s, civ, rallyBuf[j]);
    if (a < 0) continue;
    labelArmy[j] = a;
    w.aState[a] = ArmyState.Gathering;
    w.aLeave[a] = sim.tick + WAR.gatherWeeks;
    w.gathering++;
    raised++;
  }
  if (raised === 0) return;
  for (let i = 0; i < cells; i++) {
    const c = raiseCells[i];
    const a = labelArmy[gatherLabel[c]];
    if (a < 0) continue;
    const weeks = Math.ceil(gatherCost[c] / WAR.speed);
    if (weeks <= 0) {
      for (let t = 0; t < TROOP_TYPES; t++) {
        const k = c * TROOP_TYPES + t;
        w.away[k] += takeBuf[k];
        w.aN[a * TROOP_TYPES + t] += takeBuf[k];
      }
      continue;
    }
    for (let t = 0; t < TROOP_TYPES; t++) w.pend[c * TROOP_TYPES + t] = takeBuf[c * TROOP_TYPES + t];
    w.cArmy[c] = a;
    w.cArrive[c] = sim.tick + weeks;
    w.aWait[a]++;
    w.stats.contingents++;
  }
  for (let j = 0; j < rallies; j++) {
    const a = labelArmy[j];
    if (a >= 0 && w.aWait[a] === 0) setOut(sim, a);
  }
}

/** Contingent of cell `c` arrives at its army. */
function arrive(sim: Simulation, c: number): void {
  const w = sim.war;
  const m = sim.military;
  const a = w.cArmy[c];
  for (let t = 0; t < TROOP_TYPES; t++) {
    const i = c * TROOP_TYPES + t;
    const x = Math.max(0, Math.min(w.pend[i], m.soldiers[i] - w.away[i]));
    w.away[i] += x;
    w.aN[a * TROOP_TYPES + t] += x;
    w.pend[i] = 0;
  }
  w.cArmy[c] = -1;
  w.aWait[a]--;
  w.stats.contingentsArrived++;
}

/** Contingent of cell `c` goes home (its soldiers were never away). */
function dropContingent(w: WarState, c: number): void {
  const a = w.cArmy[c];
  if (a < 0) return;
  w.pend.fill(0, c * TROOP_TYPES, c * TROOP_TYPES + TROOP_TYPES);
  w.cArmy[c] = -1;
  w.aWait[a]--;
}

/** Contingents still on their way to army `a` go home. */
function dropContingents(sim: Simulation, a: number): void {
  const w = sim.war;
  if (w.aWait[a] === 0) return;
  const n = sim.world.cellCount;
  for (let c = 0; c < n && w.aWait[a] > 0; c++) {
    if (w.cArmy[c] !== a) continue;
    dropContingent(w, c);
    w.stats.contingentsLate++;
  }
}

/** Army `a` ends its gathering: the late contingents go home; it marches (or is gone without soldiers). */
function setOut(sim: Simulation, a: number): void {
  const w = sim.war;
  if (w.aState[a] !== ArmyState.Gathering) return;
  dropContingents(sim, a);
  w.aState[a] = ArmyState.Marching;
  w.gathering--;
  w.stats.setOut++;
  w.stats.gatherWeeksSum += sim.tick - w.aSince[a];
  w.version++;
  if (armySoldiers(w, a) <= 0) removeArmy(w, a);
}

/** Tests and benchmark setup: every contingent of army `a` arrives now and it sets out. */
export function finishGathering(sim: Simulation, a: number): void {
  const w = sim.war;
  if (!w.live[a] || w.aState[a] !== ArmyState.Gathering) return;
  const n = sim.world.cellCount;
  for (let c = 0; c < n && w.aWait[a] > 0; c++) if (w.cArmy[c] === a) arrive(sim, c);
  setOut(sim, a);
}

/** The weekly gathering: contingents arrive, armies set out. */
function advanceGathering(sim: Simulation): void {
  const w = sim.war;
  if (w.gathering === 0) return;
  const n = sim.world.cellCount;
  const tick = sim.tick;
  for (let c = 0; c < n; c++) if (w.cArmy[c] >= 0 && w.cArrive[c] <= tick) arrive(sim, c);
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (w.live[a] && w.aState[a] === ArmyState.Gathering && (w.aWait[a] === 0 || tick >= w.aLeave[a])) setOut(sim, a);
  }
}

/** Soldiers in army `a`. */
export function armySoldiers(w: WarState, a: number): number {
  return w.aN[a * TROOP_TYPES] + w.aN[a * TROOP_TYPES + 1] + w.aN[a * TROOP_TYPES + 2];
}

function removeArmy(w: WarState, a: number): void {
  if (!w.live[a]) return;
  if (w.aState[a] === ArmyState.Gathering) {
    w.gathering--;
    // Contingents on the way go home (the caller passes no sim: scan the cells directly).
    for (let c = 0; c < w.cArmy.length && w.aWait[a] > 0; c++) if (w.cArmy[c] === a) dropContingent(w, c);
  }
  w.live[a] = 0;
  w.aWar[a] = -1;
  w.aState[a] = ArmyState.Marching;
  w.aWait[a] = 0;
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
function mayEnter(sim: Simulation, s: number, o: number, civ: number): boolean {
  return o === 0 || o === civ || sim.war.side[s * PAIRS + o] >= 0 || sim.diplomacy.open[o * PAIRS + civ] === 1;
}

/**
 * Cheapest travel cost from every hex to the goal for the armies of `civ`
 * (side 0 attacker, 1 defender): a Dijkstra from the goal over land the army
 * may enter, up to WAR.fieldMax; no water (no ships). An army steps to the
 * neighbor with the least cost to go, so the path is found once per war.
 */
const fieldHeap = new MinHeap(256);
function travelField(sim: Simulation, s: number, side: number, civ: number): void {
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
      if (nb < 0 || isWaterBiome(world.biome[nb]) || !mayEnter(sim, s, owner[nb], civ)) continue;
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
  travelField(sim, s, 0, w.wAtt[s]);
  travelField(sim, s, 1, w.wDef[s]);
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

/** One week of war (simulation.ts, every tick; nothing to do without wars): gathering, march and retreat, battles, sieges. */
export function advanceWar(sim: Simulation): void {
  const w = sim.war;
  if (w.wars === 0) return;
  const t0 = clockStart();
  for (let s = 0; s < MAX_WARS; s++) if (w.wLive[s]) endIfGone(sim, s);
  advanceGathering(sim);
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a]) continue;
    if (w.aState[a] === ArmyState.Retreating) retreatStep(sim, a);
    else if (w.aState[a] === ArmyState.Marching) moveArmy(sim, a);
  }
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

/** Whether an army of the other side of war `s` than `civ` with soldiers stands on `cell` (retreating ones only with `retreating`). */
function enemyAt(w: WarState, s: number, civ: number, cell: number, retreating: boolean): boolean {
  const mine = sideOf(w, s, civ);
  for (let b = 0; b < MAX_ARMIES; b++) {
    if (!w.live[b] || w.aWar[b] !== s || w.aCell[b] !== cell || armySide(w, b) === mine || armySoldiers(w, b) <= 0) continue;
    if (retreating || w.aState[b] !== ArmyState.Retreating) return true;
  }
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
  if (cur === goal || enemyAt(w, s, civ, cur, true)) return;
  const n = sim.world.cellCount;
  const base = (s * 2 + armySide(w, a)) * n;
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
    if (cur === goal || enemyAt(w, s, civ, cur, true)) {
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

let retreatCost = new Float32Array(0);
let retreatFrom = new Int32Array(0);

/**
 * Army `a` was beaten: it retreats with what is left along the cheapest way
 * (the march's rules, up to WAR.fieldMax) to the nearest seat of its people
 * other than the hex it stands on. Without one in reach it goes home at once.
 */
function startRetreat(sim: Simulation, a: number): void {
  const w = sim.war;
  if (!w.live[a] || w.aState[a] === ArmyState.Retreating) return;
  if (w.aState[a] === ArmyState.Gathering) {
    dropContingents(sim, a);
    w.gathering--;
  }
  w.aState[a] = ArmyState.Retreating;
  w.aProg[a] = 0;
  w.aPathLen[a] = 0;
  w.aPathPos[a] = 0;
  w.stats.retreats++;
  w.version++;
  if (armySoldiers(w, a) <= 0) {
    removeArmy(w, a);
    return;
  }
  const world = sim.world;
  const n = world.cellCount;
  if (retreatCost.length !== n) {
    retreatCost = new Float32Array(n);
    retreatFrom = new Int32Array(n);
  }
  const s = w.aWar[a];
  const civ = w.aCiv[a];
  const start = w.aCell[a];
  const dist = retreatCost;
  dist.fill(Infinity);
  dist[start] = 0;
  retreatFrom[start] = -1;
  fieldHeap.size = 0;
  fieldHeap.push(start, 0);
  let seat = -1;
  while (fieldHeap.size > 0) {
    const c = fieldHeap.pop();
    const here = dist[c];
    if (c !== start && isSeatOf(sim, c, civ)) {
      seat = c;
      break;
    }
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || isWaterBiome(world.biome[nb]) || !mayEnter(sim, s, world.owner[nb], civ)) continue;
      const next = here + stepCost(world, c, d);
      if (next >= dist[nb] || next > WAR.fieldMax) continue;
      dist[nb] = next;
      retreatFrom[nb] = c;
      fieldHeap.push(nb, next);
    }
  }
  fieldHeap.size = 0;
  let len = 0;
  for (let c = seat; c >= 0 && c !== start; c = retreatFrom[c]) len++;
  if (seat < 0 || len > PATH_MAX) {
    disbandArmy(sim, a);
    return;
  }
  // The way from the first step to the seat.
  let i = len;
  for (let c = seat; c !== start; c = retreatFrom[c]) w.aPath[a * PATH_MAX + --i] = c;
  w.aPathLen[a] = len;
}

/** One week of retreat (WAR.speed travel cost); an enemy army on the next hex stops it there. At the seat its soldiers go home. */
function retreatStep(sim: Simulation, a: number): void {
  const w = sim.war;
  const world = sim.world;
  const s = w.aWar[a];
  const civ = w.aCiv[a];
  let cur = w.aCell[a];
  let pos = w.aPathPos[a];
  const len = w.aPathLen[a];
  let prog = w.aProg[a] + WAR.speed;
  let met = false;
  while (pos < len) {
    const next = w.aPath[a * PATH_MAX + pos];
    let step = Infinity;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      if (world.neighbors[cur * DIRECTION_COUNT + d] === next) {
        step = stepCost(world, cur, d);
        break;
      }
    }
    if (prog < step) break;
    prog -= step;
    cur = next;
    pos++;
    if (enemyAt(w, s, civ, cur, false)) {
      prog = 0;
      met = true;
      break;
    }
  }
  w.aProg[a] = prog;
  w.aPathPos[a] = pos;
  if (cur !== w.aCell[a]) {
    w.aCell[a] = cur;
    w.aSince[a] = sim.tick;
    w.version++;
  }
  // Attacked where it stopped: home next week if it is still there.
  if (pos < len || met) return;
  w.stats.retreatsHome++;
  if (cur === w.wGoal[s] && sideOf(w, s, civ) === 1) {
    // Back in the goal seat: it stays as its garrison.
    w.aState[a] = ArmyState.Marching;
    w.version++;
  } else disbandArmy(sim, a);
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
    let active = false;
    let fleeing = false;
    for (let b = 0; b < MAX_ARMIES; b++) {
      if (!w.live[b] || w.aWar[b] !== s || w.aCell[b] !== cell) continue;
      if (b < a) {
        first = false;
        break;
      }
      if (armySoldiers(w, b) <= 0) continue;
      if (w.aState[b] === ArmyState.Retreating) fleeing = true;
      else active = true;
      if (armySide(w, b) === 0) groupA[na++] = b;
      else groupB[nb++] = b;
    }
    // Retreating armies don't attack: some army on the hex must be fighting.
    if (first && active && na > 0 && nb > 0) {
      if (fleeing) w.stats.retreatBattles++;
      fight(sim, s, cell, na, nb);
    }
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
  let defense: Defense = Defense.Field;
  const seat = cell === w.wGoal[s];
  if (seat) {
    let garrison = false;
    for (let i = 0; i < nb; i++) if (w.aSince[groupB[i]] < sim.tick) garrison = true;
    defense = garrison ? Defense.SeatArmy : Defense.Seat;
  }
  const result = fightBattle(inp, defense, out);
  if (seat) {
    if (w.wSiegeStart[s] < 0 && besiegerStrength(sim, s) > 0) startSiege(sim, s);
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
  if (w.wAllies[s] > 0 && w.wRebel[s] === 0) st.allyBattles++;
  if (w.wRebel[s] === 1) st.rebBattles++;
  applyLosses(sim, groupA, na, 0, out[BO.strLostA]);
  applyLosses(sim, groupB, nb, 1, out[BO.strLostB]);
  // The loser retreats with what is left; a draw sends both back.
  if (result >= 0) for (let i = 0; i < nb; i++) startRetreat(sim, groupB[i]);
  if (result <= 0) for (let i = 0; i < na; i++) startRetreat(sim, groupA[i]);
  // Giving up after the battle: the sides with the allies that joined.
  const sa = sideStrength(sim, s, 0);
  const sd = sideStrength(sim, s, 1);
  if (defenderGivesUp(w, s, sd, sa)) w.wEnd[s] = EndType.GaveUp;
  else if (attackerGivesUp(w, s, sa, sd)) w.wEnd[s] = EndType.AttackerGaveUp;
}

/** Scales the group's armies to what is left of `side` after the battle and kills the difference in the cells. */
function applyLosses(sim: Simulation, group: Int32Array, count: number, side: number, strengthLost: number): void {
  const w = sim.war;
  const m = sim.military;
  // The strength lost is shared by the armies' peoples in proportion to their strength before the battle.
  let total = 0;
  for (let i = 0; i < count; i++) {
    const a = group[i];
    for (let t = 0; t < TROOP_TYPES; t++) total += w.aN[a * TROOP_TYPES + t] * w.aFac[a * TROOP_TYPES + t];
  }
  if (total > 0) {
    for (let i = 0; i < count; i++) {
      const a = group[i];
      let mine = 0;
      for (let t = 0; t < TROOP_TYPES; t++) mine += w.aN[a * TROOP_TYPES + t] * w.aFac[a * TROOP_TYPES + t];
      const civ = w.aCiv[a];
      if (m.strength.length > civ) m.strength[civ] = Math.max(0, m.strength[civ] - (strengthLost * mine) / total);
    }
  }
  for (let t = 0; t < TROOP_TYPES; t++) {
    let before = 0;
    for (let i = 0; i < count; i++) before += w.aN[group[i] * TROOP_TYPES + t];
    if (before <= 0) continue;
    const left = remainingSoldiers(side, t);
    if (before - left <= 0) continue;
    const k = left / before;
    for (let i = 0; i < count; i++) {
      const a = group[i];
      const lost = w.aN[a * TROOP_TYPES + t] * (1 - k);
      w.aN[a * TROOP_TYPES + t] -= lost;
      takeAway(sim, w.aCiv[a], t, Math.round(lost), true);
    }
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
  if (w.wAllies[s] > 0 && w.wRebel[s] === 0) w.stats.allySieges++;
  if (w.wRebel[s] === 1) w.stats.rebSieges++;
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
  const goal = w.wGoal[s];
  let sum = 0;
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a] || w.aWar[a] !== s || armySide(w, a) !== 0 || w.aCell[a] !== goal || w.aState[a] === ArmyState.Retreating) continue;
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
      if (w.live[a] && w.aWar[a] === s && armySide(w, a) === 0 && w.aCell[a] === goal) startRetreat(sim, a);
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
    if (w.wAllies[s] > 0 && w.wRebel[s] === 0) w.stats.allyOcc++;
    w.wLastGain[s] = sim.tick;
    w.wOccupied[s] = 1;
    w.version++;
    if (w.wRebel[s] === 1) {
      // The occupied seat stays occupied to the war's end; the nearest rebel seat left is next.
      w.stats.rebOcc++;
      record(sim, `The ${sim.civs[w.wAtt[s]]!.name} occupied the rebel seat of the ${sim.civs[sim.world.owner[cell]]?.name ?? 'rebels'}.`, cell);
      if (!advanceGoal(sim, s) && w.wEnd[s] < 0) w.wEnd[s] = EndType.Crushed;
    } else record(sim, `The ${sim.civs[w.wAtt[s]]!.name} occupied a seat of government of the ${sim.civs[w.wDef[s]]!.name}.`, cell);
  }
}

// ---------------------------------------------------------------------------
// Phase 5: uprisings as war ("Design Documents/Requirement Krieg.md",
// section 8; rebellion.ts declares them)
//
// A rebellion is a war whose attacker side is the mother (with her pact and
// alliance partners) and whose defender side is all rebel groups (each a new
// people, allied with each other) and their helpers. It has one goal seat per
// group (wGoals); the mother besieges them one at a time, the nearest first,
// and an occupied seat stays occupied (its siege part stays) to the war's
// end. The mother never gives up; the rebels only once one of their seats is
// occupied. All seats occupied, or the rebels gave up: the mother annexes
// every group ("Conquered"). Exhaustion: the groups stay independent.

const rebGroups = new Int32Array(MAX_GOALS);
const isGroup = new Uint8Array(PAIRS);

/** Whether people `p` is one of the rebel groups of rebellion `s`. */
function isRebelGroup(w: WarState, s: number, p: number): boolean {
  return p > 0 && w.rebelMother[p] === w.wAtt[s] && sideOf(w, s, p) === 1;
}

/**
 * The current goal of rebellion `s` is occupied (or no longer a rebel
 * seat): the next goal is the nearest rebel seat not yet taken (from the one
 * just taken), its siege starts afresh and the armies get their way to it.
 * Goals that are no longer a rebel group's (emptied, cut off) count as
 * taken. False if none is left.
 */
function advanceGoal(sim: Simulation, s: number): boolean {
  const w = sim.war;
  const cur = w.wGoal[s];
  const base = s * MAX_GOALS;
  const owner = sim.world.owner;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < w.wGoalN[s]; i++) {
    const g = w.wGoals[base + i];
    if (g === cur || sim.cellPop[g] === 0 || !isRebelGroup(w, s, owner[g])) w.wGoalDone[base + i] = 1;
    if (w.wGoalDone[base + i]) continue;
    const d = hexDistance(sim.world, cur, g);
    if (d < bestD || (d === bestD && g < best)) {
      bestD = d;
      best = g;
    }
  }
  if (best < 0) return false;
  w.wGoal[s] = best;
  w.wSiegeStart[s] = -1;
  w.wSiegeStrength[s] = 0;
  w.wOccupied[s] = 0;
  w.version++;
  planMarch(sim, s);
  return true;
}

/** A people at peace that is the mother of a running rebellion: that rebellion is its war (enemy, civWar). */
function rebelFront(w: WarState, civ: number): void {
  if (w.enemy[civ] !== 0 || w.motherBusy[civ] === 0) return;
  for (let q = 0; q < MAX_WARS; q++) {
    if (!w.wLive[q] || !w.wRebel[q] || w.wAtt[q] !== civ) continue;
    w.enemy[civ] = w.wDef[q];
    w.civWar[civ] = q;
    return;
  }
}

/** Rebel group `p` of rebellion `s` vanished (its id is taken again): it leaves; the next group leads, none left: crushed. */
function leaveRebellion(sim: Simulation, s: number, p: number): void {
  const w = sim.war;
  if (w.wDef[s] === p) {
    if (!nextLeader(sim, s, p)) endWar(sim, s, EndType.Crushed);
    return;
  }
  quitRebellion(sim, s, p);
}

/** Rebel group `p` is no member of rebellion `s` any more. */
function quitRebellion(sim: Simulation, s: number, p: number): void {
  const w = sim.war;
  dropMember(sim, s, p);
  w.rebelMother[p] = 0;
  if (w.civWar[p] === s) {
    w.civWar[p] = -1;
    w.enemy[p] = 0;
  }
}

/** The first living rebel group other than `old` leads rebellion `s` (is its defender); false if none is left. */
function nextLeader(sim: Simulation, s: number, old: number): boolean {
  const w = sim.war;
  let alt = -1;
  for (let q = 1; q <= sim.diplomacy.maxId && alt < 0; q++) if (q !== old && sim.civs[q] && isRebelGroup(w, s, q)) alt = q;
  if (alt < 0) return false;
  // The old leader leaves as the main party; the new one counted as an ally of the war so far.
  quitRebellion(sim, s, old);
  w.wAllies[s]--;
  if (w.allyWarsOf[alt] > 0) w.allyWarsOf[alt]--;
  w.wDef[s] = alt;
  if (w.enemy[w.wAtt[s]] === old) w.enemy[w.wAtt[s]] = alt;
  w.version++;
  return true;
}

/** endIfGone for a rebellion: the mother vanished, the main rebel group vanished (the next one leads), the goal is no rebel seat any more. */
function rebellionGone(sim: Simulation, s: number): boolean {
  const w = sim.war;
  const att = w.wAtt[s];
  if (!sim.civs[att]) {
    endWar(sim, s, EndType.Vanished);
    return true;
  }
  if (!sim.civs[w.wDef[s]] && !nextLeader(sim, s, w.wDef[s])) {
    endWar(sim, s, EndType.Crushed);
    return true;
  }
  const goal = w.wGoal[s];
  if ((sim.cellPop[goal] === 0 || !isRebelGroup(w, s, sim.world.owner[goal])) && !advanceGoal(sim, s)) {
    endWar(sim, s, EndType.Crushed);
    return true;
  }
  return false;
}

/** Removes the siege of cell `goal` (the seat's part and supply modifier). */
function clearSiegeAt(sim: Simulation, goal: number): void {
  const w = sim.war;
  if (w.siege[goal] === 0 && w.siegeValue[goal] === 0) return;
  w.siege[goal] = 0;
  w.siegeValue[goal] = 0;
  const old = sim.supplyModifiers.get(goal);
  if (old) {
    const rest = old.filter((x) => x.label !== SUPPLY_LABEL);
    if (rest.length > 0) sim.supplyModifiers.set(goal, rest);
    else sim.supplyModifiers.delete(goal);
    updateCellSupply(sim, goal);
  }
}

/**
 * Starts the rebellion of the `count` peoples in `groups` (new peoples, the
 * largest first; rebellion.ts founded them and gave them their settlements
 * and militia) against `mother`: a war whose attacker side is the mother,
 * whose other side is all rebel groups (allied with each other), with one
 * goal seat per group (`goals`, the groups' capitals), the one nearest the
 * mother's capital first. The mother's partners join her, helpers may join
 * the rebels (joinRebelSides). The mother may be at war elsewhere (two
 * fronts); the rebellion is no declaration of hers. Armies are raised at
 * once, or with `later` in the next steps of the war's year. Returns the
 * war's slot, -1 if none is free.
 */
export function startRebelWar(sim: Simulation, mother: number, groups: Int32Array, goals: Int32Array, count: number, later = false): number {
  const w = sim.war;
  let s = 0;
  while (s < MAX_WARS && w.wLive[s]) s++;
  if (s === MAX_WARS || count <= 0) return -1;
  // The rebels' soldiers leave the mother's armies and contingents: they are the rebels' now.
  const owner = sim.world.owner;
  for (let c = 0; c < sim.world.cellCount; c++) {
    const a = w.cArmy[c];
    if (a >= 0 && w.aCiv[a] !== owner[c]) dropContingent(w, c);
  }
  reconcileWar(sim);
  const first = groups[0];
  const cap = sim.civs[mother]!.capital;
  let g0 = 0;
  for (let i = 1; i < count; i++) {
    const d = hexDistance(sim.world, cap, goals[i]);
    const d0 = hexDistance(sim.world, cap, goals[g0]);
    if (d < d0 || (d === d0 && goals[i] < goals[g0])) g0 = i;
  }
  w.wLive[s] = 1;
  w.wAtt[s] = mother;
  w.wDef[s] = first;
  w.wGoal[s] = goals[g0];
  w.wStart[s] = sim.tick;
  w.wLastGain[s] = sim.tick;
  w.wSiegeStart[s] = -1;
  w.wSiegeStrength[s] = 0;
  w.wOccupied[s] = 0;
  w.wSplinter[s] = 1;
  w.wBattles[s] = 0;
  w.wRebel[s] = 1;
  w.wAllies[s] = 0;
  w.wEnd[s] = -1;
  w.wGoalN[s] = count;
  for (let i = 0; i < MAX_GOALS; i++) {
    w.wGoals[s * MAX_GOALS + i] = i < count ? goals[i] : -1;
    w.wGoalDone[s * MAX_GOALS + i] = 0;
  }
  w.side.fill(-1, s * PAIRS, s * PAIRS + PAIRS);
  w.side[s * PAIRS + mother] = 0;
  w.side[s * PAIRS + first] = 1;
  w.foe[mother * PAIRS + first]++;
  w.foe[first * PAIRS + mother]++;
  w.wars++;
  w.version++;
  const st = w.stats;
  if (w.wars > st.maxWars) st.maxWars = w.wars;
  // The rebel groups are allied with each other (the normal alliance rules afterwards).
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) formAlliance(sim, groups[i], groups[j]);
  for (let i = 0; i < count; i++) {
    const g = groups[i];
    w.rebelMother[g] = mother;
    w.enemy[g] = mother;
    w.civWar[g] = s;
    if (i > 0) addMember(sim, s, g, 1);
    sever(sim, mother, g);
  }
  w.motherBusy[mother]++;
  // Only a mother at peace elsewhere has the rebels as her enemy.
  if (w.enemy[mother] === 0) {
    w.enemy[mother] = first;
    w.civWar[mother] = s;
  }
  joinRebelSides(sim, s, groups, count);
  planMarch(sim, s);
  if (later) {
    raiseLater(w, s);
    return s;
  }
  reraise(sim, s, mother);
  for (let p = 1; p <= sim.diplomacy.maxId; p++) if (p !== mother && sideOf(w, s, p) >= 0) reraise(sim, s, p);
  return s;
}

/**
 * 5b, at the declaration: the mother's pact and alliance partners join her
 * (unless allied with a rebel group); third peoples join the rebels if the
 * mother's danger for them is at least WAR.helpDanger, their trust in her is
 * below WAR.helpTrust, they have no pact or alliance with her and the rebel
 * side with all of them is then stronger than the mother's side.
 */
function joinRebelSides(sim: Simulation, s: number, groups: Int32Array, count: number): void {
  const w = sim.war;
  const m = sim.military;
  const dip = sim.diplomacy;
  const mother = w.wAtt[s];
  const max = dip.maxId;
  const st = w.stats;
  let sumM = strengthOf(sim, mother);
  for (let p = 1; p <= max; p++) {
    if (p === mother || !sim.civs[p] || sideOf(w, s, p) >= 0 || w.pact[mother * PAIRS + p] === Pact.None) continue;
    const before = st.joins;
    joinMember(sim, s, p, 0);
    if (st.joins > before) {
      st.rebMotherAllies++;
      sumM += strengthOf(sim, p);
    }
  }
  let sumR = 0;
  for (let i = 0; i < count; i++) sumR += strengthOf(sim, groups[i]);
  let any = 0;
  for (let p = 1; p <= max; p++) {
    candD[p] = 0;
    if (p === mother || !sim.civs[p] || sideOf(w, s, p) >= 0 || w.rebelMother[p] !== 0) continue;
    const k = p * PAIRS + mother;
    if (w.pact[k] !== Pact.None || !dip.known[k] || dip.danger[k] < WAR.helpDanger || dip.trust[k] >= WAR.helpTrust) continue;
    candD[p] = 1;
    sumR += strengthOf(sim, p);
    any++;
  }
  void m;
  if (any === 0 || sumR <= sumM) return;
  st.rebHelpWars++;
  for (let p = 1; p <= max; p++) {
    if (!candD[p]) continue;
    const before = st.joins;
    joinMember(sim, s, p, 1);
    if (st.joins > before) st.rebHelpers++;
  }
}

function strengthOf(sim: Simulation, p: number): number {
  const m = sim.military.strength;
  return p < m.length ? m[p] : 0;
}

/**
 * The rebellion ends. Crushed (all seats occupied) or the rebels gave up:
 * every rebel group goes back to the mother ("Conquered"). Otherwise
 * (exhaustion, a people vanished) the groups stay independent; after
 * exhaustion they won their revolution and the mother lost it. Always: the
 * militia goes back to its people, sieges end, armies go home, trust
 * between the mother and the groups drops, truce.
 */
function endRebelWar(sim: Simulation, s: number, type: number): void {
  const w = sim.war;
  const mother = w.wAtt[s];
  const st = w.stats;
  const n = sim.world.cellCount;
  const owner = sim.world.owner;
  const max = sim.diplomacy.maxId;
  const won = type === EndType.Crushed || type === EndType.GaveUp;
  st.rebDurationSum += sim.tick - w.wStart[s];
  if (type === EndType.Crushed) st.rebCrushed++;
  else if (type === EndType.GaveUp) st.rebGaveUp++;
  else if (type === EndType.Exhausted) st.rebExhausted++;
  else st.rebOther++;
  // Sieges off, armies home.
  const base = s * MAX_GOALS;
  for (let i = 0; i < w.wGoalN[s]; i++) clearSiegeAt(sim, w.wGoals[base + i]);
  w.wSiegeStart[s] = -1;
  w.wOccupied[s] = 0;
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a] && w.aWar[a] === s) disbandArmy(sim, a);
  let ng = 0;
  isGroup.fill(0);
  for (let p = 1; p <= max && ng < MAX_GOALS; p++) {
    if (!isRebelGroup(w, s, p)) continue;
    isGroup[p] = 1;
    if (sim.civs[p]) rebGroups[ng++] = p;
  }
  // The militia goes back to its people (not that of another rebellion still running).
  for (let c = 0; c < n; c++) {
    if (w.cArmy[c] >= 0 && w.aWar[w.cArmy[c]] === s) dropContingent(w, c);
    if (w.militia[c] === 0) continue;
    const o = owner[c];
    if (o !== 0 && !isGroup[o] && w.rebelMother[o] !== 0) continue;
    st.militiaBack += Math.min(w.militia[c], sim.military.soldiers[c * TROOP_TYPES]);
    dischargeSoldiers(sim, c, w.militia[c]);
    w.militia[c] = 0;
  }
  if (won && ng > 0 && sim.civs[mother]) {
    // Every rebel group is annexed: its land and people go back to the mother, "Conquered".
    st.rebAnnexedGroups += ng;
    const pop = sim.pop;
    for (let i = 0; i < pop.end; i++) if (pop.alive[i] && isGroup[pop.civ[i]]) changeCiv(sim, i, mother);
    for (let c = 0; c < n; c++) {
      if (!isGroup[owner[c]]) continue;
      owner[c] = mother;
      for (let t = 0; t < TROOP_TYPES; t++) w.away[c * TROOP_TYPES + t] = 0;
      w.conqValue[c] = -WAR.conqMalus;
      w.conqTick[c] = sim.tick;
      w.conqUntil[c] = sim.tick + WAR.conqYears * TICKS_PER_YEAR;
    }
  }
  // Partners and helpers: the winner's main party trusts its partners more, those of the loser less.
  const winMain = won ? mother : type === EndType.Exhausted && ng > 0 ? rebGroups[0] : 0;
  const winSide = won ? 0 : 1;
  if (winMain !== 0 && sim.civs[winMain]) {
    for (let p = 1; p <= max; p++) {
      const side = sideOf(w, s, p);
      if (side < 0 || p === mother || isGroup[p] || !sim.civs[p]) continue;
      if (side === winSide) addMood(sim.diplomacy, winMain, p, 'Fought at our side', ALLY.winBonus, sim.tick);
      else addMood(sim.diplomacy, winMain, p, 'Fought against us', -ALLY.loseLoss, sim.tick);
    }
  }
  // Every member leaves (foes count down).
  for (let p = 1; p <= max; p++) if (sideOf(w, s, p) >= 0) dropMember(sim, s, p);
  w.side.fill(-1, s * PAIRS, s * PAIRS + PAIRS);
  // Peace between the mother and the groups: trust down, truce; the revolution won and lost.
  for (let p = 1; p <= max; p++) {
    if (!isGroup[p]) continue;
    w.rebelMother[p] = 0;
    if (w.enemy[p] === mother) w.enemy[p] = 0;
    if (w.civWar[p] === s) w.civWar[p] = -1;
    w.truce[pairKey(mother, p)] = sim.tick + WAR.truceYears * TICKS_PER_YEAR;
    if (won || !sim.civs[p] || !sim.civs[mother]) continue;
    addMood(sim.diplomacy, mother, p, 'War', -WAR.trustLoss, sim.tick);
    addMood(sim.diplomacy, p, mother, 'War', -WAR.trustLoss, sim.tick);
    sever(sim, mother, p);
    if (type === EndType.Exhausted) addCivMood(sim.civs[p]!, 'Won its revolution', MOOD_REVOLUTION_WON, sim.tick);
  }
  if (type === EndType.Exhausted && ng > 0 && sim.civs[mother]) addCivMood(sim.civs[mother]!, 'Lost a revolution', MOOD_REVOLUTION_LOST, sim.tick);
  if (w.motherBusy[mother] > 0) w.motherBusy[mother]--;
  if (w.civWar[mother] === s) {
    w.enemy[mother] = 0;
    w.civWar[mother] = -1;
  }
  w.wLive[s] = 0;
  w.wRebel[s] = 0;
  w.wEnd[s] = -1;
  w.wGoalN[s] = 0;
  w.wars--;
  w.version++;
  const mName = sim.civs[mother]?.name ?? '?';
  const goal = w.wGoal[s];
  if (type === EndType.Crushed) record(sim, `The ${mName} crushed the rebellion and took the rebels' land back.`, goal);
  else if (type === EndType.GaveUp) record(sim, `The rebels gave up: the ${mName} took their land back.`, goal);
  else if (type === EndType.Exhausted) record(sim, `The ${mName} could not crush the rebellion: the rebels stay independent.`, goal);
  else record(sim, `The rebellion against the ${mName} ended.`, goal);
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
  if (w.wRebel[s] === 1) {
    endRebelWar(sim, s, type);
    return;
  }
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
  if (w.wAllies[s] > 0) endAllies(sim, s, type);
  w.foe[att * PAIRS + def] = Math.max(0, w.foe[att * PAIRS + def] - 1);
  w.foe[def * PAIRS + att] = Math.max(0, w.foe[def * PAIRS + att] - 1);
  w.side[s * PAIRS + att] = -1;
  w.side[s * PAIRS + def] = -1;
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
  // A mother still fighting her rebels has them as her war again.
  rebelFront(w, att);
  rebelFront(w, def);
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

/** The war's allies go home: the winner's get trust from their partner, the loser's lose it at the winner. */
function endAllies(sim: Simulation, s: number, type: number): void {
  const w = sim.war;
  const att = w.wAtt[s];
  const def = w.wDef[s];
  const winner = type === EndType.GaveUp ? 0 : type === EndType.AttackerGaveUp ? 1 : -1;
  const max = sim.diplomacy.maxId;
  for (let p = 1; p <= max; p++) {
    const side = sideOf(w, s, p);
    if (side < 0 || p === att || p === def) continue;
    if (winner >= 0 && sim.civs[p]) {
      const winMain = winner === 0 ? att : def;
      if (side === winner) {
        if (sim.civs[winMain]) addMood(sim.diplomacy, winMain, p, 'Fought at our side', ALLY.winBonus, sim.tick);
      } else if (sim.civs[winMain]) addMood(sim.diplomacy, winMain, p, 'Fought against us', -ALLY.loseLoss, sim.tick);
    }
    dropMember(sim, s, p);
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
    if (w.wAllies[s] > 0 && w.wRebel[s] === 0) st.allyAnnexed++;
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
    dropContingent(w, c);
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
  for (let c = 0; c < n; c++) if (w.militia[c] > m.soldiers[c * TROOP_TYPES]) w.militia[c] = m.soldiers[c * TROOP_TYPES];
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

export type ArmyInfo = {
  slot: number;
  civ: number;
  cell: number;
  soldiers: number;
  strength: number;
  besieging: boolean;
  /** ArmyState: marching, gathering at its rally point, retreating. */
  state: number;
};
export type CivWar = {
  /** War slot. */
  war: number;
  /** The main party on the other side (the people `civ`, or the partner it fights for, is at war with). */
  enemy: number;
  /** Whether `civ`'s side is the attacker's. */
  attacker: boolean;
  /** Whether `civ` fights as an ally (not a main party), and for which main party. */
  ally: boolean;
  partner: number;
  /** Peoples on `civ`'s side besides itself (main party first), and on the other side (main party first). */
  ownSide: number[];
  otherSide: number[];
  /** The goal seat, the year the war began. */
  goal: number;
  startTick: number;
  /** Siege of the goal: tick it began (-1 = none), whether the seat is occupied. */
  siegeStart: number;
  occupied: boolean;
  battles: number;
  /** Armies of `civ` itself, of its allies in this war, of the other side. */
  ownArmies: ArmyInfo[];
  allyArmies: ArmyInfo[];
  enemyArmies: ArmyInfo[];
  /**
   * Phase 5: a rebellion (the attacker is the mother, the other side the rebel groups and their helpers): its
   * rebel groups (each a main party of the rebel side, the leader first), all their seats the mother must
   * occupy (the nearest first; `goal` is the current one) and those occupied so far. Empty for other wars.
   */
  rebellion: boolean;
  rebels: number[];
  rebelSeats: number[];
  seatsTaken: number[];
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
      besieging: armySide(w, a) === 0 && w.aCell[a] === w.wGoal[s] && w.aState[a] !== ArmyState.Retreating,
      state: w.aState[a],
    });
  }
  return list;
}

function warInfo(sim: Simulation, s: number, civ: number): CivWar {
  const w = sim.war;
  const side = w.side[s * PAIRS + civ];
  const att = w.wAtt[s];
  const def = w.wDef[s];
  const ownMain = side === 0 ? att : def;
  const otherMain = side === 0 ? def : att;
  const ownSide: number[] = ownMain !== civ ? [ownMain] : [];
  const otherSide: number[] = [otherMain];
  for (let p = 1; p < PAIRS; p++) {
    if (p === att || p === def || p === civ) continue;
    const q = w.side[s * PAIRS + p];
    if (q === side) ownSide.push(p);
    else if (q === 1 - side) otherSide.push(p);
  }
  const armies = warArmies(sim).filter((x) => w.aWar[x.slot] === s);
  const rebellion = w.wRebel[s] === 1;
  const rebels: number[] = [];
  const rebelSeats: number[] = [];
  const seatsTaken: number[] = [];
  if (rebellion) {
    rebels.push(def);
    for (let p = 1; p < PAIRS; p++) if (p !== def && isRebelGroup(w, s, p)) rebels.push(p);
    for (let i = 0; i < w.wGoalN[s]; i++) {
      rebelSeats.push(w.wGoals[s * MAX_GOALS + i]);
      if (w.wGoalDone[s * MAX_GOALS + i]) seatsTaken.push(w.wGoals[s * MAX_GOALS + i]);
    }
  }
  return {
    war: s,
    enemy: otherMain,
    attacker: side === 0,
    ally: civ !== att && civ !== def && !(rebellion && rebels.includes(civ)),
    partner: ownMain,
    ownSide,
    otherSide,
    goal: w.wGoal[s],
    startTick: w.wStart[s],
    siegeStart: w.wSiegeStart[s],
    occupied: w.wOccupied[s] === 1,
    battles: w.wBattles[s],
    ownArmies: armies.filter((x) => x.civ === civ),
    allyArmies: armies.filter((x) => x.civ !== civ && w.side[s * PAIRS + x.civ] === side),
    enemyArmies: armies.filter((x) => w.side[s * PAIRS + x.civ] === 1 - side),
    rebellion,
    rebels,
    rebelSeats,
    seatsTaken,
  };
}

/** The war people `civ` fights as a main party, null if none. */
export function civWar(sim: Simulation, civ: number): CivWar | null {
  const w = sim.war;
  const s = w.civWar[civ];
  if (s < 0 || !w.wLive[s]) return null;
  return warInfo(sim, s, civ);
}

/** All wars of people `civ`: its own (as a main party) first, then those it fights in as an ally. */
export function civWars(sim: Simulation, civ: number): CivWar[] {
  const w = sim.war;
  const list: CivWar[] = [];
  const own = civWar(sim, civ);
  if (own) list.push(own);
  for (let s = 0; s < MAX_WARS; s++) {
    if (w.wLive[s] && s !== w.civWar[civ] && w.side[s * PAIRS + civ] >= 0) list.push(warInfo(sim, s, civ));
  }
  return list;
}

/** Peoples `civ` has a truce with, and the tick each ends. */
export function civTruces(sim: Simulation, civ: number): { civ: number; until: number }[] {
  const list: { civ: number; until: number }[] = [];
  for (let b = 1; b < sim.civs.length; b++) {
    if (b !== civ && sim.civs[b] && inTruce(sim, civ, b)) list.push({ civ: b, until: sim.war.truce[pairKey(civ, b)] });
  }
  return list;
}

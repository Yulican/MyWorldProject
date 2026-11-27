import { createRng, deriveSeed, type Rng } from '../rng';
import type { World } from '../world/world';
import { endPact, formAlliance } from './alliance';
import { PAIRS, addMood } from './diplomacy';
import { EVENTS, Ev, L, LEADER_CIVS, LEVERS } from './leaders';
import { MAXR, heresyFactor, markFaithRebellion, stateFaith, within } from './religion';
import { REBEL_CHECK, inRebellion, measureCells, prepareRebellionCells } from './rebellion';
import { changeCiv, foundCivilization, mostPopulousCell, record, type Simulation } from './simulation';
import { startRebelWar } from './war';

// The Mandate ("Design Documents/Requirement Mandat.md", frozen set "ab"): loyalty per settlement (reach, satisfaction,
// faith/Heresy with the neighbors' gradient, the realm's legitimacy, garrison, grace, reconciliation), legitimacy per
// people, restless blocs with a countdown of 5-10 years, outcomes independence (the rebel war, rebellion.ts / war.ts),
// autonomy (a vassal: tribute in government.ts, permanent alliance, diplomacy through the mother in diplomacy.ts) or
// reconciliation; vassals' ends. Replaces the strength check of the rebellion (Krieg 8).
//
// It runs in the war's year (war.ts runWarYearStep, one step each): first all loyalties (beginMandateYear), then one
// realm per step with restless settlements, a countdown or as a vassal (mandateRealm). State is flat arrays in
// `sim.mandate` (saved); random numbers only from its own sequence "mandate".

export const MANDATE = {
  base: 50,
  /** Reach: +reachNear at travel cost <= 1 to a seat, linear to reachFar from cost 8. */
  reachNear: 15,
  reachFar: -25,
  /** Satisfaction part: weight, bounds. */
  satWeight: 0.5,
  satMin: -30,
  satMax: 15,
  /** Faith part (Heresy): -faithWeight x deviation (own x gradientOwn + the realm's settlements within gradientRadius), at most faithCap, moving at most faithStep a year. */
  faithWeight: 45,
  faithCap: -50,
  faithStep: 5,
  gradientOwn: 0.7,
  gradientRadius: 3,
  /** Garrison: per 1 % soldiers of the hex's people, at most. */
  garrisonPer1: 0.5,
  garrisonCap: 6,
  /** Restless below threshold / lever rebel, calm again at threshold + hysteresis; the loyalty falls at most `fall`, rises at most `rise` a year. */
  threshold: 45,
  hysteresis: 10,
  fall: 6,
  rise: 2,
  /** A bloc's countdown starts when its weight > ratio x the core's, ends in reconciliation at <= ratioEnd x that; bloc size; hexes that link restless settlements; blocs per realm. */
  ratio: 0.5,
  ratioEnd: 0.8,
  blockMinSettlements: 2,
  blockMinShare: 0.15,
  link: 2,
  blocsPerRealm: 8,
  /** Countdown: countdownMin + a roll of 0..countdownRoll years. */
  countdownMin: 5,
  countdownRoll: 5,
  /** Agitation: chance per restless neighbor (within 2 hexes) and year for a settlement below agitateBelow, its loyalty drop. */
  agitate: 0.2,
  agitateBelow: 45,
  agitateDrop: 8,
  /** Outcome weights: faith, legitimacy divisor, mother busy elsewhere, autonomy scale, mother at least 2x stronger. */
  wFaith: 2,
  wLegit: 10,
  wBusy: 0.5,
  wAutonomy: 0.5,
  wStrong: 0.5,
  /** Legitimacy: tenure (+1 per tenureYears, at most), succession (an heir of the line: dynasty), old age, goal reached, wars, rebellions, the god. */
  tenureYears: 3,
  tenureMax: 6,
  succession: -8,
  dynasty: -4,
  successionFade: 0.9,
  oldAge: 60,
  oldPer: 0.2,
  oldMax: 4,
  goal: 4,
  won: 6,
  lost: -10,
  crushed: 4,
  independence: -8,
  autonomy: -3,
  reconcile: 2,
  decay: 0.93,
  worship: 3,
  legitMax: 20,
  /** Reconciliation: loyalty bonus, fading over reconcileYears. */
  reconcileBonus: 10,
  reconcileYears: 10,
  /** Decree of Grace: loyalty of all settlements once, fading over graceYears (the legitimacy is the god layer's, gacha.ts). */
  grace: 6,
  graceYears: 20,
  /** Vassals: tribute share of the seats' taxes (halved when poor), groups per autonomy, independence roll and truce, peaceful when the mother's legitimacy <= weakLegit; re-integration after years, chance, needs. */
  tribute: 0.15,
  vassalMax: 3,
  indep: 0.015,
  vassalTruce: 20,
  weakLegit: -5,
  leaveTrust: -10,
  reintegrate: 0.015,
  reintegrateYears: 20,
  reintegrateLegit: 5,
  reintegrateTrust: 60,
  reintegrateShare: 0.7,
  vassalTrust: 70,
};
// The satisfaction part "connection" counts x0.5 while the Mandate runs: satisfaction.ts CONNECTION_SCALE.

const CIVS = LEADER_CIVS;
const TICKS_PER_YEAR = 52;
/** Countdown places. */
export const BLOCS = 16;

export type MandateStats = {
  countdowns: number;
  faithCountdowns: number;
  independence: number;
  faithIndependence: number;
  autonomy: number;
  reconcile: number;
  dissolved: number;
  failedStart: number;
  countdownYears: number;
  agitations: number;
  vassalsMade: number;
  vassalIndepPeace: number;
  vassalIndepWar: number;
  vassalReintegrated: number;
  vassalFreed: number;
  vassalLife: number;
  tribute: number;
};

export type Mandate = {
  rng: Rng;
  /** Per hex: loyalty 0..100 of a settlement (-1 none / not yet), restless (1, hysteresis), its countdown (-1 none). */
  loyalty: Float32Array;
  restless: Uint8Array;
  blocId: Int8Array;
  /** Per hex: the parts reach, satisfaction, faith, legitimacy of the last year (the faith part moves at most faithStep a year), the deviation from the state faith. */
  parts: Float32Array;
  dev: Float32Array;
  /** Per hex: reconciliation and grace bonus (fading). */
  rec: Float32Array;
  grace: Float32Array;
  /** Per people: legitimacy, its event part (x decay a year) and succession part, the leader counters and goal seen last. */
  legit: Float32Array;
  legitEvents: Float32Array;
  succ: Float32Array;
  seenEv: Int32Array;
  seenCounter: Int32Array;
  seenGoal: Int32Array;
  /** Per people: restless settlements at the year's check. */
  restlessCount: Uint16Array;
  /** Per people: mother of a vassal (-1 none), year it became one, tribute paid and received this year (money value). */
  vassalOf: Int16Array;
  vassalSince: Int32Array;
  tributePaid: Float32Array;
  tributeGot: Float32Array;
  /** Countdowns: people, start year, length rolled, 1 while running, 1 when faith is the worst part. */
  blocCiv: Int16Array;
  blocStart: Int16Array;
  blocLen: Int16Array;
  blocActive: Uint8Array;
  blocFaith: Uint8Array;
  /** Increases whenever loyalties or countdowns change (the map). */
  version: number;
  stats: MandateStats;
};

export function createMandate(world: World): Mandate {
  const n = world.cellCount;
  return {
    rng: createRng(deriveSeed(world.seed, 'mandate')),
    loyalty: new Float32Array(n).fill(-1),
    restless: new Uint8Array(n),
    blocId: new Int8Array(n).fill(-1),
    parts: new Float32Array(n * 4),
    dev: new Float32Array(n),
    rec: new Float32Array(n),
    grace: new Float32Array(n),
    legit: new Float32Array(CIVS),
    legitEvents: new Float32Array(CIVS),
    succ: new Float32Array(CIVS),
    seenEv: new Int32Array(CIVS * EVENTS),
    seenCounter: new Int32Array(CIVS),
    seenGoal: new Int32Array(CIVS),
    restlessCount: new Uint16Array(CIVS),
    vassalOf: new Int16Array(CIVS).fill(-1),
    vassalSince: new Int32Array(CIVS),
    tributePaid: new Float32Array(CIVS),
    tributeGot: new Float32Array(CIVS),
    blocCiv: new Int16Array(BLOCS),
    blocStart: new Int16Array(BLOCS),
    blocLen: new Int16Array(BLOCS),
    blocActive: new Uint8Array(BLOCS),
    blocFaith: new Uint8Array(BLOCS),
    version: 0,
    stats: {
      countdowns: 0, faithCountdowns: 0, independence: 0, faithIndependence: 0, autonomy: 0, reconcile: 0, dissolved: 0, failedStart: 0, countdownYears: 0,
      agitations: 0, vassalsMade: 0, vassalIndepPeace: 0, vassalIndepWar: 0, vassalReintegrated: 0, vassalFreed: 0, vassalLife: 0, tribute: 0,
    },
  };
}

const year = (sim: Simulation) => Math.floor(sim.tick / TICKS_PER_YEAR);

export { vassalOf, vassalPair } from './vassals';

/** A people founded under id `civ` (also a reused one): no legitimacy events, not a vassal; vassals of an old people with that id are free. */
export function resetMandateCiv(sim: Simulation, civ: number): void {
  const m = sim.mandate;
  if (civ <= 0 || civ >= CIVS) return;
  m.legit[civ] = 0;
  m.legitEvents[civ] = 0;
  m.succ[civ] = 0;
  for (let k = 0; k < EVENTS; k++) m.seenEv[civ * EVENTS + k] = sim.leaders.events[civ * EVENTS + k];
  m.seenCounter[civ] = sim.leaders.counter[civ];
  m.seenGoal[civ] = sim.leaders.goalTick[civ];
  m.restlessCount[civ] = 0;
  m.vassalOf[civ] = -1;
  m.vassalSince[civ] = 0;
  m.tributePaid[civ] = 0;
  m.tributeGot[civ] = 0;
  for (let v = 1; v < CIVS; v++) if (m.vassalOf[v] === civ) m.vassalOf[v] = -1;
  for (let k = 0; k < BLOCS; k++) if (m.blocActive[k] && m.blocCiv[k] === civ) m.blocActive[k] = 0;
}

// ---------------------------------------------------------------------------
// Legitimacy and loyalty

/** Legitimacy of every people (3): tenure, succession, age, goal, wars, the god. */
function updateLegitimacy(sim: Simulation): void {
  const m = sim.mandate;
  const s = sim.leaders;
  for (let c = 1; c < CIVS && c < sim.civSlots; c++) {
    const civ = sim.civs[c];
    if (!civ) continue;
    const won = s.events[c * EVENTS + Ev.WarWon] - m.seenEv[c * EVENTS + Ev.WarWon];
    const lost = s.events[c * EVENTS + Ev.WarLost] - m.seenEv[c * EVENTS + Ev.WarLost];
    for (let k = 0; k < EVENTS; k++) m.seenEv[c * EVENTS + k] = s.events[c * EVENTS + k];
    let ev = m.legitEvents[c] * MANDATE.decay + (won > 0 ? MANDATE.won * won : 0) + (lost > 0 ? MANDATE.lost * lost : 0);
    // The leader reached the goal (+4, fading like the events).
    if (s.has[c] && s.goalDone[c] && s.goalTick[c] !== m.seenGoal[c]) ev += MANDATE.goal;
    m.seenGoal[c] = s.goalTick[c];
    m.legitEvents[c] = ev;
    if (s.counter[c] !== m.seenCounter[c]) {
      // A new leader (not a people's first): an heir who inherited from the predecessor costs less.
      if (m.seenCounter[c] !== 0) m.succ[c] = s.inheritedLast[c] ? MANDATE.dynasty : MANDATE.succession;
      m.seenCounter[c] = s.counter[c];
    }
    m.succ[c] *= MANDATE.successionFade;
    let v = ev + m.succ[c];
    if (s.has[c]) {
      const years = (sim.tick - s.start[c]) / TICKS_PER_YEAR;
      v += Math.min(MANDATE.tenureMax, Math.floor(years / MANDATE.tenureYears));
      const age = s.age0[c] + years;
      if (age > MANDATE.oldAge) v -= Math.min(MANDATE.oldMax, MANDATE.oldPer * (age - MANDATE.oldAge));
    }
    if (civ.worshipsPlayer) v += MANDATE.worship;
    v += sim.gacha.godLegit[c];
    m.legit[c] = Math.max(-MANDATE.legitMax, Math.min(MANDATE.legitMax, v));
  }
}

/** Mean deviation of the realm's settlements within `radius` hexes of `c` (not c itself); `c`'s own without any. */
function nearMean(sim: Simulation, c: number, owner: number, radius: number): number {
  const m = sim.mandate;
  const w = sim.world;
  const near = within(w, c, radius);
  let sum = 0;
  let k = 0;
  for (let i = 0; i < near.length; i++) {
    const x = near[i];
    if (w.owner[x] === owner && sim.cellPop[x] > 0) {
      sum += m.dev[x];
      k++;
    }
  }
  return k > 0 ? sum / k : m.dev[c];
}

/** The reach part of a settlement at travel cost `cost` to its nearest seat. */
export function reachValue(cost: number): number {
  if (cost <= 1) return MANDATE.reachNear;
  if (cost >= 8) return MANDATE.reachFar;
  return MANDATE.reachNear + ((MANDATE.reachFar - MANDATE.reachNear) * (cost - 1)) / 7;
}

/** The garrison part of settlement `c`. */
function garrisonValue(sim: Simulation, c: number): number {
  let soldiers = 0;
  for (let t = 0; t < 3; t++) soldiers += sim.military.soldiers[c * 3 + t];
  return Math.min(MANDATE.garrisonCap, MANDATE.garrisonPer1 * ((100 * soldiers) / Math.max(1, sim.cellPop[c])));
}

/** The loyalty threshold below which a settlement of `civ` is restless. */
export function restlessBelow(sim: Simulation, civ: number): number {
  return MANDATE.threshold / sim.leaders.lev[civ * LEVERS + L.rebel];
}

const factorTmp = new Float64Array(CIVS);

/** Loyalty of every settlement (2): the target from its parts, the inertia, restless with hysteresis. */
function updateLoyalty(sim: Simulation): void {
  const m = sim.mandate;
  const rs = sim.religion;
  const w = sim.world;
  const n = w.cellCount;
  // Deviation: believers of other religions than the state faith over the settlement's people.
  for (let c = 0; c < n; c++) {
    m.dev[c] = 0;
    const o = w.owner[c];
    const people = sim.cellPop[c];
    if (people === 0 || o === 0) continue;
    const sr = stateFaith(sim, o);
    if (sr < 0) continue;
    let other = 0;
    for (let r = 0; r < MAXR; r++) if (r !== sr) other += rs.cellBel[c * MAXR + r];
    m.dev[c] = other / people;
  }
  factorTmp.fill(-1);
  m.restlessCount.fill(0);
  for (let c = 0; c < n; c++) {
    const o = w.owner[c];
    if (sim.cellPop[c] === 0 || o === 0 || !sim.civs[o]) {
      m.loyalty[c] = -1;
      m.restless[c] = 0;
      m.rec[c] = 0;
      m.grace[c] = 0;
      continue;
    }
    const civ = sim.civs[o]!;
    if (m.rec[c] > 0) m.rec[c] = Math.max(0, m.rec[c] - MANDATE.reconcileBonus / MANDATE.reconcileYears);
    if (civ.capital === c) {
      m.loyalty[c] = 100;
      m.restless[c] = 0;
      m.parts.fill(0, c * 4, c * 4 + 4);
      continue;
    }
    const reach = reachValue(sim.seatCost[c]);
    const sat = Math.max(MANDATE.satMin, Math.min(MANDATE.satMax, MANDATE.satWeight * sim.satisfaction[c]));
    if (factorTmp[o] < 0) factorTmp[o] = heresyFactor(sim, o);
    const dev = MANDATE.gradientOwn * m.dev[c] + (1 - MANDATE.gradientOwn) * nearMean(sim, c, o, MANDATE.gradientRadius);
    let faith = Math.max(MANDATE.faithCap, -MANDATE.faithWeight * dev * factorTmp[o]);
    if (m.loyalty[c] >= 0) {
      const prev = m.parts[c * 4 + 2];
      faith = prev + Math.max(-MANDATE.faithStep, Math.min(MANDATE.faithStep, faith - prev));
    }
    const legit = m.legit[o];
    const T = Math.max(0, Math.min(100, MANDATE.base + reach + sat + faith + legit + garrisonValue(sim, c) + m.rec[c] + m.grace[c]));
    m.parts[c * 4] = reach;
    m.parts[c * 4 + 1] = sat;
    m.parts[c * 4 + 2] = faith;
    m.parts[c * 4 + 3] = legit;
    if (m.grace[c] > 0) m.grace[c] = Math.max(0, m.grace[c] - MANDATE.grace / MANDATE.graceYears);
    const cur = m.loyalty[c];
    const now = cur < 0 ? T : cur + Math.max(-MANDATE.fall, Math.min(MANDATE.rise, T - cur));
    m.loyalty[c] = now;
    const th = restlessBelow(sim, o);
    m.restless[c] = m.restless[c] ? (now >= th + MANDATE.hysteresis ? 0 : 1) : now < th ? 1 : 0;
    if (m.restless[c] && m.restlessCount[o] < 65535) m.restlessCount[o]++;
  }
}

/** Agitation (5.1): a restless settlement pulls its uneasy neighbors of the same realm (within 2 hexes) down by chance. */
function agitate(sim: Simulation): void {
  const m = sim.mandate;
  const w = sim.world;
  const hits: number[] = [];
  for (let c = 0; c < w.cellCount; c++) {
    if (!m.restless[c]) continue;
    const near = within(w, c, 2);
    for (let i = 0; i < near.length; i++) {
      const x = near[i];
      if (w.owner[x] === w.owner[c] && sim.cellPop[x] > 0 && m.loyalty[x] >= 0 && m.loyalty[x] < MANDATE.agitateBelow && !m.restless[x] && sim.civs[w.owner[x]]?.capital !== x && m.rng() < MANDATE.agitate) hits.push(x);
    }
  }
  for (const x of hits) {
    m.loyalty[x] = Math.max(0, m.loyalty[x] - MANDATE.agitateDrop);
    m.stats.agitations++;
  }
}

/**
 * The war's year, first step (war.ts): legitimacy, every settlement's loyalty, agitation; marks in
 * `sim.war.restless` the realms the next steps check (restless settlements, a countdown, a vassal).
 */
export function beginMandateYear(sim: Simulation): void {
  const m = sim.mandate;
  const w = sim.war;
  updateLegitimacy(sim);
  updateLoyalty(sim);
  agitate(sim);
  w.restless.fill(0);
  for (let c = 1; c < CIVS && c < w.restless.length; c++) {
    if (!sim.civs[c] && m.vassalOf[c] < 0) continue;
    if (m.restlessCount[c] > 0 || m.vassalOf[c] >= 0) w.restless[c] = 1;
  }
  for (let k = 0; k < BLOCS; k++) if (m.blocActive[k] && m.blocCiv[k] < w.restless.length) w.restless[m.blocCiv[k]] = 1;
  m.version++;
}

// ---------------------------------------------------------------------------
// Blocs and countdowns (4), outcomes (6)

type Bloc = { cells: number[]; pop: number; wB: number };

/** The restless settlements of realm `civ` joined within MANDATE.link hexes, the largest first (at most blocsPerRealm); its core weight and people. */
function realmBlocs(sim: Simulation, civ: number): { blocs: Bloc[]; wK: number; realmPop: number } {
  const m = sim.mandate;
  const w = sim.world;
  let wK = 0;
  let realmPop = 0;
  const restless: number[] = [];
  for (let c = 0; c < w.cellCount; c++) {
    if (w.owner[c] !== civ || sim.cellPop[c] === 0 || m.loyalty[c] < 0) continue;
    realmPop += sim.cellPop[c];
    if (m.restless[c]) restless.push(c);
    else wK += (sim.cellPop[c] * m.loyalty[c]) / 100;
  }
  const blocs: Bloc[] = [];
  const seen = new Set<number>();
  for (const c of restless) {
    if (seen.has(c)) continue;
    const cells = [c];
    seen.add(c);
    for (let k = 0; k < cells.length; k++) {
      const near = within(w, cells[k], MANDATE.link);
      for (let i = 0; i < near.length; i++) {
        const x = near[i];
        if (!seen.has(x) && m.restless[x] && w.owner[x] === civ && sim.cellPop[x] > 0) {
          seen.add(x);
          cells.push(x);
        }
      }
    }
    cells.sort((a, b) => a - b);
    let pop = 0;
    let wB = 0;
    for (const x of cells) {
      pop += sim.cellPop[x];
      wB += (sim.cellPop[x] * (100 - m.loyalty[x])) / 100;
    }
    blocs.push({ cells, pop, wB });
  }
  blocs.sort((a, b) => b.pop - a.pop || a.cells[0] - b.cells[0]);
  if (blocs.length > MANDATE.blocsPerRealm) blocs.length = MANDATE.blocsPerRealm;
  return { blocs, wK, realmPop };
}

/** The worst part of the bloc's loyalty: 0 reach, 1 satisfaction, 2 faith, 3 legitimacy. */
function mainCause(sim: Simulation, cells: readonly number[]): number {
  const m = sim.mandate;
  const sum = [0, 0, 0, 0];
  for (const c of cells) for (let k = 0; k < 4; k++) sum[k] += m.parts[c * 4 + k];
  let best = 0;
  for (let k = 1; k < 4; k++) if (sum[k] < sum[best]) best = k;
  return best;
}

function reconcile(sim: Simulation, cells: readonly number[], civ: number): void {
  const m = sim.mandate;
  for (const c of cells) m.rec[c] = MANDATE.reconcileBonus;
  m.legitEvents[civ] += MANDATE.reconcile;
  m.stats.reconcile++;
  const people = sim.civs[civ];
  if (people && cells.length > 0) record(sim, `The unrest in the land of the ${people.name} calmed down.`, cells[0], false);
}

/** The daughter religion holding most of the bloc's settlements against the state faith, -1 if none. */
function blocDaughter(sim: Simulation, cells: readonly number[], state: number): number {
  const rs = sim.religion;
  const count = new Int32Array(MAXR);
  for (const c of cells) for (let r = 0; r < MAXR; r++) if (r !== state && rs.cellBel[c * MAXR + r] * 2 > sim.cellPop[c]) count[r]++;
  let best = -1;
  let bestN = 0;
  for (let r = 0; r < MAXR; r++) if (count[r] > bestN) {
    bestN = count[r];
    best = r;
  }
  return best;
}

/** The countdown `id` of realm `civ` ends: reconciliation if the bloc weighs too little now, else independence or autonomy by the dice (5.3). */
function endBloc(sim: Simulation, id: number, b: Bloc, civ: number, wK: number): void {
  const m = sim.mandate;
  const s = m.stats;
  m.blocActive[id] = 0;
  s.countdownYears += year(sim) - m.blocStart[id];
  const faithBloc = mainCause(sim, b.cells) === 2;
  if (b.wB <= MANDATE.ratio * wK || b.cells.length === 0) {
    reconcile(sim, b.cells, civ);
    return;
  }
  let faithy = 0;
  for (const c of b.cells) if (m.dev[c] > 0.5) faithy++;
  const faithShare = faithy / Math.max(1, b.cells.length);
  const legit = m.legit[civ];
  const isVassal = m.vassalOf[civ] >= 0;
  measureCells(sim, civ, b.cells);
  const strong = REBEL_CHECK.mother >= 2 * REBEL_CHECK.rebels ? MANDATE.wStrong : 0;
  const wU = 1 + MANDATE.wFaith * faithShare + Math.max(0, -legit) / MANDATE.wLegit + (sim.war.enemy[civ] !== 0 ? MANDATE.wBusy : 0);
  const wA = isVassal ? 0 : MANDATE.wAutonomy * (1 + Math.max(0, legit) / MANDATE.wLegit + strong);
  const state = stateFaith(sim, civ);
  const daughter = faithBloc ? blocDaughter(sim, b.cells, state) : -1;
  if (m.rng() * (wU + wA) < wU) {
    // Independence: the rebel war (rebellion.ts, war.ts), over faith when Heresy is the worst part.
    if (!prepareRebellionCells(sim, civ, b.cells)) {
      s.failedStart++;
      reconcile(sim, b.cells, civ);
      return;
    }
    s.independence++;
    if (daughter >= 0) {
      markFaithRebellion(sim, civ, daughter, state);
      s.faithIndependence++;
    }
    m.legitEvents[civ] += MANDATE.independence;
    return;
  }
  makeVassals(sim, b.cells, civ, daughter);
  s.autonomy++;
  m.legitEvents[civ] += MANDATE.autonomy;
}

/** Autonomy: the bloc splits into groups by adjacency; the largest MANDATE.vassalMax become vassal peoples of `mother` (peaceful, allied). */
function makeVassals(sim: Simulation, cells: readonly number[], mother: number, daughter: number): void {
  const m = sim.mandate;
  const w = sim.world;
  const inBloc = new Set(cells);
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const c of cells) {
    if (seen.has(c)) continue;
    const g = [c];
    seen.add(c);
    for (let k = 0; k < g.length; k++) {
      for (let d = 0; d < 6; d++) {
        const x = w.neighbors[g[k] * 6 + d];
        if (x >= 0 && inBloc.has(x) && !seen.has(x)) {
          seen.add(x);
          g.push(x);
        }
      }
    }
    groups.push(g);
  }
  groups.sort((a, b) => b.length - a.length || a[0] - b[0]);
  const parent = sim.civs[mother]!;
  const y = year(sim);
  let made = false;
  for (const g of groups.slice(0, MANDATE.vassalMax)) {
    const mask = new Uint8Array(w.cellCount);
    for (const c of g) mask[c] = 1;
    const capital = mostPopulousCell(sim, mother, mask);
    if (capital < 0) continue;
    const civ = foundCivilization(sim, 'secession', capital, parent);
    if (!civ) continue;
    const pop = sim.pop;
    for (let i = 0; i < pop.end; i++) if (pop.alive[i] && pop.civ[i] === mother && mask[pop.cell[i]]) changeCiv(sim, i, civ.id);
    for (const c of g) {
      w.owner[c] = civ.id;
      m.loyalty[c] = -1;
      m.restless[c] = 0;
    }
    makeVassal(sim, civ.id, mother, y);
    m.stats.vassalsMade++;
    made = true;
    record(sim, `The ${civ.name} broke away from the ${parent.name} and became their vassal.`, capital, true);
  }
  if (made && daughter >= 0 && !sim.religion.herRebelled[daughter]) {
    sim.religion.herRebelled[daughter] = 2;
    sim.religion.stats.schismVassals++;
  }
}

/** `v` becomes a vassal of `mother` (Mandat 7): allied, a truce, trust 70 / danger 0 to begin with, known to each other. */
export function makeVassal(sim: Simulation, v: number, mother: number, since = year(sim)): void {
  const m = sim.mandate;
  const dip = sim.diplomacy;
  m.vassalOf[v] = mother;
  m.vassalSince[v] = since;
  formAlliance(sim, mother, v);
  sim.war.truce[mother * PAIRS + v] = sim.tick + MANDATE.vassalTruce * TICKS_PER_YEAR;
  sim.war.truce[v * PAIRS + mother] = sim.tick + MANDATE.vassalTruce * TICKS_PER_YEAR;
  dip.maxId = Math.max(dip.maxId, v, mother);
  dip.known[v * PAIRS + mother] = 1;
  dip.known[mother * PAIRS + v] = 1;
  dip.trust[v * PAIRS + mother] = MANDATE.vassalTrust;
  dip.trust[mother * PAIRS + v] = MANDATE.vassalTrust;
  dip.danger[v * PAIRS + mother] = 0;
  dip.danger[mother * PAIRS + v] = 0;
}

/** Vassal `v` is free (`peaceful`: Mandat 7.1 with trust -10 and a truce; else silent: the mother is gone). */
function freeVassal(sim: Simulation, v: number, peaceful: boolean): void {
  const m = sim.mandate;
  const mother = m.vassalOf[v];
  m.vassalOf[v] = -1;
  m.stats.vassalLife += year(sim) - m.vassalSince[v];
  if (mother <= 0) return;
  endPact(sim, mother, v);
  if (!peaceful || !sim.civs[mother] || !sim.civs[v]) return;
  addMood(sim.diplomacy, mother, v, 'Left our rule', MANDATE.leaveTrust, sim.tick);
  addMood(sim.diplomacy, v, mother, 'Our former rulers', MANDATE.leaveTrust, sim.tick);
  sim.war.truce[mother * PAIRS + v] = sim.tick + MANDATE.vassalTruce * TICKS_PER_YEAR;
  sim.war.truce[v * PAIRS + mother] = sim.tick + MANDATE.vassalTruce * TICKS_PER_YEAR;
  record(sim, `The ${sim.civs[v]!.name} are no longer vassals of the ${sim.civs[mother]!.name}.`, sim.civs[v]!.capital, true);
}

/** The yearly rolls of vassal `v` (Mandat 7): the mother gone, independence after the truce, re-integration. */
function vassalYear(sim: Simulation, v: number): void {
  const m = sim.mandate;
  const mother = m.vassalOf[v];
  const civ = sim.civs[v];
  const y = year(sim);
  if (!civ) {
    m.vassalOf[v] = -1;
    m.stats.vassalLife += y - m.vassalSince[v];
    return;
  }
  const mom = sim.civs[mother];
  if (!mom) {
    freeVassal(sim, v, false);
    m.stats.vassalFreed++;
    return;
  }
  formAlliance(sim, mother, v);
  const legit = m.legit[mother];
  const strength = sim.military.strength;
  const otherFaith = stateFaith(sim, v) !== stateFaith(sim, mother) ? 1 : 0;
  const stronger = (strength[v] ?? 0) > (strength[mother] ?? 0) ? 1 : 0;
  const pInd = MANDATE.indep * (1 + Math.max(0, -legit) / MANDATE.wLegit + otherFaith + stronger);
  if (y - m.vassalSince[v] >= MANDATE.vassalTruce && m.rng() < pInd) {
    const weak = legit <= MANDATE.weakLegit || (sim.war.enemy[mother] !== 0 && (strength[mother] ?? 0) < (strength[v] ?? 0));
    const w = sim.war;
    const busy = w.enemy[v] !== 0 || w.allyWarsOf[v] > 0 || w.rebelMother[v] !== 0 || inRebellion(sim, mother) || inRebellion(sim, v) || civ.capital < 0;
    if (weak || busy) {
      freeVassal(sim, v, true);
      m.stats.vassalIndepPeace++;
    } else {
      // The vassal rises as a rebel people (the rebel war, its settlements as they are).
      m.vassalOf[v] = -1;
      m.stats.vassalLife += y - m.vassalSince[v];
      endPact(sim, mother, v);
      w.truce[mother * PAIRS + v] = 0;
      w.truce[v * PAIRS + mother] = 0;
      const s = startRebelWar(sim, mother, Int32Array.of(v), Int32Array.of(civ.capital), 1, true);
      if (s >= 0) record(sim, `The ${civ.name} rose against their rulers, the ${mom.name}.`, civ.capital, true);
      m.stats.vassalIndepWar++;
    }
    m.legitEvents[mother] += MANDATE.independence;
    return;
  }
  if (y - m.vassalSince[v] >= MANDATE.reintegrateYears && m.rng() < MANDATE.reintegrate) {
    if (legit >= MANDATE.reintegrateLegit && sim.diplomacy.trust[v * PAIRS + mother] >= MANDATE.reintegrateTrust && civ.population <= MANDATE.reintegrateShare * mom.population) reintegrate(sim, v, mother);
  }
}

/** Vassal `v` goes back into `mother` (Mandat 7.2): its settlements, people, treasuries and stocks; its leader ends. */
function reintegrate(sim: Simulation, v: number, mother: number): void {
  const m = sim.mandate;
  const w = sim.world;
  const pop = sim.pop;
  const name = sim.civs[v]!.name;
  for (let i = 0; i < pop.end; i++) if (pop.alive[i] && pop.civ[i] === v) changeCiv(sim, i, mother);
  for (let c = 0; c < w.cellCount; c++) if (w.owner[c] === v) {
    w.owner[c] = mother;
    m.loyalty[c] = -1;
    m.restless[c] = 0;
  }
  m.vassalOf[v] = -1;
  m.stats.vassalReintegrated++;
  m.stats.vassalLife += year(sim) - m.vassalSince[v];
  endPact(sim, mother, v);
  sim.civs[v] = null;
  record(sim, `The ${name} rejoined the ${sim.civs[mother]!.name}.`, sim.civs[mother]!.capital, false);
}

/** The war's year, one realm (war.ts, after beginMandateYear): its blocs and countdowns, then its rolls as a vassal. */
export function mandateRealm(sim: Simulation, civ: number): void {
  const m = sim.mandate;
  const w = sim.world;
  const y = year(sim);
  if (sim.civs[civ]) {
    const { blocs, wK, realmPop } = realmBlocs(sim, civ);
    const used = new Uint8Array(BLOCS);
    // The settlements' countdowns from the last check (blocId) find a bloc's countdown again; the new ones afterwards.
    const next: number[] = [];
    for (const b of blocs) {
      const big = b.cells.length >= MANDATE.blockMinSettlements || b.pop >= MANDATE.blockMinShare * realmPop;
      let id = -1;
      let best = 0;
      for (let k = 0; k < BLOCS; k++) {
        if (!m.blocActive[k] || used[k] || m.blocCiv[k] !== civ) continue;
        let v = 0;
        for (const c of b.cells) if (m.blocId[c] === k) v++;
        if (v > best) {
          best = v;
          id = k;
        }
      }
      const heavy = b.wB > MANDATE.ratio * wK;
      if (id < 0) {
        if (!big || !heavy) continue;
        for (let k = 0; k < BLOCS && id < 0; k++) if (!m.blocActive[k]) id = k;
        if (id < 0) continue;
        m.blocActive[id] = 1;
        m.blocCiv[id] = civ;
        m.blocStart[id] = y;
        m.blocLen[id] = MANDATE.countdownMin + Math.floor(m.rng() * (MANDATE.countdownRoll + 1));
        const faith = mainCause(sim, b.cells) === 2;
        m.blocFaith[id] = faith ? 1 : 0;
        m.stats.countdowns++;
        if (faith) m.stats.faithCountdowns++;
        used[id] = 1;
        for (const c of b.cells) next.push(c, id);
        record(sim, `Unrest threatens to split the ${sim.civs[civ]!.name}.`, b.cells[0], true);
        continue;
      }
      used[id] = 1;
      m.blocFaith[id] = mainCause(sim, b.cells) === 2 ? 1 : 0;
      if (b.wB <= MANDATE.ratioEnd * MANDATE.ratio * wK) {
        m.blocActive[id] = 0;
        m.stats.countdownYears += y - m.blocStart[id];
        reconcile(sim, b.cells, civ);
        continue;
      }
      if (y - m.blocStart[id] >= m.blocLen[id]) {
        endBloc(sim, id, b, civ, wK);
        continue;
      }
      for (const c of b.cells) next.push(c, id);
    }
    // Countdowns whose bloc vanished dissolve.
    for (let k = 0; k < BLOCS; k++) if (m.blocActive[k] && m.blocCiv[k] === civ && !used[k]) {
      m.blocActive[k] = 0;
      m.stats.dissolved++;
      m.stats.countdownYears += y - m.blocStart[k];
    }
    for (let c = 0; c < w.cellCount; c++) if (w.owner[c] === civ) m.blocId[c] = -1;
    for (let i = 0; i < next.length; i += 2) if (w.owner[next[i]] === civ) m.blocId[next[i]] = next[i + 1];
  } else for (let k = 0; k < BLOCS; k++) if (m.blocActive[k] && m.blocCiv[k] === civ) m.blocActive[k] = 0;
  // As a vassal (no new rebel war while a rebellion is being declared).
  if (m.vassalOf[civ] >= 0 && sim.war.rebelStage === 0) vassalYear(sim, civ);
  m.version++;
}

/** A rebel war of `mother` ended (war.ts endRebelWar): crushed or the rebels gave up gives legitimacy (3). */
export function rebellionEnded(sim: Simulation, mother: number, crushed: boolean): void {
  if (crushed && mother > 0 && mother < CIVS) sim.mandate.legitEvents[mother] += MANDATE.crushed;
}

/** Decree of Grace (Mandat 9) on people `civ`: every settlement's loyalty +6 once, fading (the legitimacy +10 is the god layer's). */
export function decreeOfGrace(sim: Simulation, civ: number): void {
  const m = sim.mandate;
  const w = sim.world;
  for (let c = 0; c < w.cellCount; c++) {
    if (w.owner[c] !== civ || sim.cellPop[c] === 0) continue;
    m.grace[c] = MANDATE.grace;
    if (m.loyalty[c] >= 0 && sim.civs[civ]?.capital !== c) m.loyalty[c] = Math.min(100, m.loyalty[c] + MANDATE.grace);
  }
  m.version++;
}

/** Whether people `civ` has a restless settlement or a countdown (Decree of Grace's target). */
export function hasUnrest(sim: Simulation, civ: number): boolean {
  const m = sim.mandate;
  if (civ <= 0 || civ >= CIVS) return false;
  for (let k = 0; k < BLOCS; k++) if (m.blocActive[k] && m.blocCiv[k] === civ) return true;
  const w = sim.world;
  for (let c = 0; c < w.cellCount; c++) if (m.restless[c] && w.owner[c] === civ) return true;
  return false;
}

/** The parts of settlement `c`'s loyalty target now, for the hex panel (garrison and grace as they are). */
export function loyaltyParts(sim: Simulation, c: number): { reach: number; satisfaction: number; faith: number; legitimacy: number; garrison: number; grace: number; reconciled: number } {
  const m = sim.mandate;
  return {
    reach: m.parts[c * 4],
    satisfaction: m.parts[c * 4 + 1],
    faith: m.parts[c * 4 + 2],
    legitimacy: m.parts[c * 4 + 3],
    garrison: sim.cellPop[c] > 0 ? garrisonValue(sim, c) : 0,
    grace: m.grace[c],
    reconciled: m.rec[c],
  };
}

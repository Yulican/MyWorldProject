import { DIRECTION_COUNT } from '../hex';
import { createRng, deriveSeed, type Rng } from '../rng';
import { mostPopulousCell, changeCiv, foundCivilization, type Simulation, TICKS_PER_YEAR } from './simulation';
import { FAITH } from './faithHooks';
import { ATTR_SLOTS, Ev, EVENTS, L, LEVERS } from './leaders';
import { MAXR, CIVS, heresyFactor, religionOf } from './religion';
import { startRebellionCells } from './rebellion';
import { endPact, formAlliance } from './alliance';
import { PAIRS } from './diplomacy';
import { startWar } from './war';
import { connectionValue } from './satisfaction';

// Mandate prototype (Requirement Mandat.md): loyalty per settlement, legitimacy per people, blocs with a countdown,
// outcomes independence / vassal / reconciliation, vassals with tribute. Replaces the strength-check rebellion
// (FAITH.mandate). Run yearly by tools/mandateStats.ts after the religion step. All numbers start values; own RNG "mandate".

export const MANDATE = {
  enabled: 0,
  base: 50,
  /** Reach: +reachNear at travel cost <= 1, linear to reachFar at cost >= 8. */
  reachNear: 15,
  reachFar: -25,
  satWeight: 0.5,
  satMin: -30,
  satMax: 15,
  faithWeight: 30,
  faithCap: -35,
  gradientOwn: 0.7,
  gradientRadius: 3,
  garrisonPer1: 0.5,
  garrisonCap: 6,
  /** Restless below threshold / lever rebel; calm again at threshold + hysteresis. Inertia: fall at most, rise at most. */
  threshold: 25,
  hysteresis: 10,
  fall: 6,
  rise: 4,
  ratio: 1,
  ratioEnd: 0.8,
  blockMinSettlements: 2,
  blockMinShare: 0.15,
  link: 2,
  countdownMin: 5,
  countdownRoll: 5,
  /** Agitation: chance per restless neighbor and year, only if loyalty below `agitateBelow`, loyalty drop. */
  agitate: 0.2,
  agitateBelow: 45,
  agitateDrop: 8,
  /** Outcome weights. */
  wFaith: 2,
  wLegit: 10,
  wBusy: 0.5,
  wAutonomy: 1,
  /** Legitimacy: tenure, succession, age, wars, god. */
  tenureYears: 3,
  tenureMax: 6,
  succession: -8,
  oldAge: 60,
  oldPer: 0.2,
  oldMax: 4,
  won: 6,
  lost: -10,
  independence: -8,
  autonomy: -3,
  reconcile: 2,
  decay: 0.93,
  worship: 3,
  reconcileBonus: 10,
  /** Vassals: tribute, independence roll, re-integration (after reintegrateYears, chance, needs). */
  tribute: 0.15,
  vassalMax: 3,
  indep: 0.03,
  reintegrate: 0.015,
  reintegrateYears: 30,
  reintegrateLegit: 5,
  reintegrateTrust: 70,
  reintegrateShare: 0.4,
  /** Vassal truce: years after its creation without independence. */
  vassalTruce: 0,
  /** A daughter faith with a majority in a settlement makes it restless; connected ones (2+) always count as a bloc (1 = on). */
  heresyBloc: 0,
  /** Leader faith (Anführer 6a, 0 = the state faith is the largest share): heir draw (capital share weight), predecessor bonus, conversion shares/chances, forced conversion after forceYears (0 = off) at forceShare, loyalty faith part moves at most faithStep a year (0 = off). */
  leaderFaith: 0,
  capWeight: 0.7,
  predecessor: 1.5,
  convertShare: 0.55,
  opportunist: 0.03,
  weakHand: 0.02,
  forceYears: 0,
  forceShare: 0.6,
  faithStep: 0,
  /** Scale on the satisfaction connection part while Mandate is on (reach is the new road term). */
  connScale: 1,
};

type Stats = {
  blocsFormed: number;
  countdowns: number;
  independence: number;
  autonomy: number;
  reconcile: number;
  dissolved: number;
  countdownYears: number;
  blocCells: number;
  blocShare: number;
  large: number;
  small: number;
  causes: number[];
  causesStart: number[];
  faithCountdowns: number;
  faithIndependence: number;
  vassalsMade: number;
  vassalLife: number;
  vassalIndepPeace: number;
  vassalIndepWar: number;
  vassalReintegrated: number;
  vassalFreed: number;
  tribute: number;
  agitations: number;
  failedStart: number;
  stateSucc: number;
  stateConv: number;
  stateForced: number;
  stateDeath: number;
  stateToDaughter: number;
  faithEnd: number[];
};

export type MandateState = {
  sim: Simulation;
  rng: Rng;
  loyalty: Float32Array;
  restless: Uint8Array;
  blocId: Int8Array;
  rec: Float32Array;
  legit: Float32Array;
  legitEvents: Float32Array;
  succ: Float32Array;
  seenEv: Int32Array;
  seenCounter: Int32Array;
  civObj: (object | null)[];
  stateRel: Int16Array;
  vassalOf: Int16Array;
  vassalSince: Int32Array;
  vassalPrev: Float32Array;
  succFlag: Uint8Array;
  forced: Uint8Array;
  warInfo: Map<number, { size: number; rel: number; serial: number }>;
  faithWars: { size: number; rebelsWon: boolean; rel: number; serial: number }[];
  forceCnt: Uint8Array;
  /** Blocs (16 places): people, start year, countdown length, active. */
  blocCiv: Int16Array;
  blocStart: Int16Array;
  blocLen: Int16Array;
  blocActive: Uint8Array;
  parts: Float32Array;
  dev: Float32Array;
  stats: Stats;
};

let ACTIVE: MandateState | null = null;
export const mandateOf = (sim: Simulation): MandateState | null => (ACTIVE !== null && ACTIVE.sim === sim ? ACTIVE : null);
export const CAUSES = ['reach', 'satisfaction', 'faith', 'legitimacy'] as const;

export function installMandate(sim: Simulation): MandateState {
  const n = sim.world.cellCount;
  const st: MandateState = {
    sim,
    rng: createRng(deriveSeed(sim.world.seed, 'mandate')),
    loyalty: new Float32Array(n).fill(-1),
    restless: new Uint8Array(n),
    blocId: new Int8Array(n).fill(-1),
    rec: new Float32Array(n),
    legit: new Float32Array(CIVS),
    legitEvents: new Float32Array(CIVS),
    succ: new Float32Array(CIVS),
    seenEv: new Int32Array(CIVS * EVENTS),
    seenCounter: new Int32Array(CIVS),
    civObj: new Array(CIVS).fill(null),
    stateRel: new Int16Array(CIVS).fill(-1),
    vassalOf: new Int16Array(CIVS).fill(-1),
    vassalSince: new Int32Array(CIVS),
    vassalPrev: new Float32Array(n),
    succFlag: new Uint8Array(CIVS),
    forced: new Uint8Array(n),
    warInfo: new Map(),
    faithWars: [],
    forceCnt: new Uint8Array(CIVS),
    blocCiv: new Int16Array(16),
    blocStart: new Int16Array(16),
    blocLen: new Int16Array(16),
    blocActive: new Uint8Array(16),
    parts: new Float32Array(n * 4),
    dev: new Float32Array(n),
    stats: {
      blocsFormed: 0, countdowns: 0, independence: 0, autonomy: 0, reconcile: 0, dissolved: 0, countdownYears: 0, blocCells: 0, blocShare: 0,
      large: 0, small: 0, causes: [0, 0, 0, 0], causesStart: [0, 0, 0, 0], faithCountdowns: 0, faithIndependence: 0, vassalsMade: 0, vassalLife: 0,
      vassalIndepPeace: 0, vassalIndepWar: 0, vassalReintegrated: 0, vassalFreed: 0, tribute: 0, agitations: 0, failedStart: 0, stateSucc: 0, stateConv: 0, stateForced: 0, stateDeath: 0, stateToDaughter: 0, faithEnd: [0, 0, 0, 0],
    },
  };
  ACTIVE = st;
  FAITH.mandate = true;
  FAITH.vassal = st.vassalOf;
  FAITH.loyalty = st.loyalty;
  FAITH.stateRel = st.stateRel;
  FAITH.connScale = MANDATE.connScale;
  return st;
}

export function removeMandate(): void {
  ACTIVE = null;
  FAITH.mandate = false;
  FAITH.vassal = null;
  FAITH.loyalty = null;
  FAITH.stateRel = null;
  FAITH.connScale = 1;
}

const year = (sim: Simulation) => Math.floor(sim.tick / TICKS_PER_YEAR);
const stamp = new Int32Array(0);
let stampArr = stamp;
let stampNow = 0;

/** Legitimacy of every people (3). */
function updateLegitimacy(st: MandateState): void {
  const sim = st.sim;
  for (let c = 1; c < CIVS && c < sim.civSlots; c++) {
    const civ = sim.civs[c] ?? null;
    if (civ !== st.civObj[c]) {
      st.civObj[c] = civ;
      st.legitEvents[c] = 0;
      st.succ[c] = 0;
      st.vassalOf[c] = -1;
      st.stateRel[c] = -1;
      for (let k = 0; k < EVENTS; k++) st.seenEv[c * EVENTS + k] = civ ? sim.leaders.events[c * EVENTS + k] : 0;
      st.seenCounter[c] = civ ? sim.leaders.counter[c] : 0;
    }
    if (!civ) continue;
    const won = sim.leaders.events[c * EVENTS + Ev.WarWon] - st.seenEv[c * EVENTS + Ev.WarWon];
    const lost = sim.leaders.events[c * EVENTS + Ev.WarLost] - st.seenEv[c * EVENTS + Ev.WarLost];
    for (let k = 0; k < EVENTS; k++) st.seenEv[c * EVENTS + k] = sim.leaders.events[c * EVENTS + k];
    st.legitEvents[c] = st.legitEvents[c] * MANDATE.decay + (won > 0 ? MANDATE.won * won : 0) + (lost > 0 ? MANDATE.lost * lost : 0);
    st.succFlag[c] = 0;
    if (sim.leaders.counter[c] !== st.seenCounter[c]) {
      if (st.seenCounter[c] !== 0) {
        st.succ[c] = MANDATE.succession;
        st.succFlag[c] = 1;
      }
      st.seenCounter[c] = sim.leaders.counter[c];
    }
    st.succ[c] *= 0.9;
    let v = st.legitEvents[c] + st.succ[c];
    if (sim.leaders.has[c]) {
      const years = (sim.tick - sim.leaders.start[c]) / TICKS_PER_YEAR;
      v += Math.min(MANDATE.tenureMax, Math.floor(years / MANDATE.tenureYears));
      const age = sim.leaders.age0[c] + years;
      if (age > MANDATE.oldAge) v -= Math.min(MANDATE.oldMax, MANDATE.oldPer * (age - MANDATE.oldAge));
    }
    if (civ.worshipsPlayer) v += MANDATE.worship;
    st.legit[c] = Math.max(-20, Math.min(20, v));
  }
}

/** State religion of every people: the largest share, with a 5 point hysteresis. */
function updateStateReligion(st: MandateState): void {
  const rs = religionOf(st.sim);
  if (rs === null) return;
  for (let c = 1; c < CIVS; c++) {
    let best = -1;
    let bestS = 0;
    for (let r = 0; r < MAXR; r++) if (rs.alive[r] && rs.share[c * MAXR + r] > bestS) {
      bestS = rs.share[c * MAXR + r];
      best = r;
    }
    const cur = st.stateRel[c];
    if (cur >= 0 && rs.alive[cur] && best !== cur && rs.share[c * MAXR + cur] + 0.05 >= bestS) continue;
    st.stateRel[c] = best;
  }
}

/** Mean deviation of the realm's settlements within `radius` hexes of `c` (not c itself). */
function nearMean(st: MandateState, c: number, owner: number, radius: number): number {
  const sim = st.sim;
  const w = sim.world;
  if (stampArr.length !== w.cellCount) stampArr = new Int32Array(w.cellCount);
  stampNow++;
  let frontier = [c];
  stampArr[c] = stampNow;
  let sum = 0;
  let k = 0;
  for (let r = 0; r < radius; r++) {
    const next: number[] = [];
    for (const a of frontier) {
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const x = w.neighbors[a * DIRECTION_COUNT + d];
        if (x < 0 || stampArr[x] === stampNow) continue;
        stampArr[x] = stampNow;
        next.push(x);
        if (w.owner[x] === owner && sim.cellPop[x] > 0) {
          sum += st.dev[x];
          k++;
        }
      }
    }
    frontier = next;
  }
  return k > 0 ? sum / k : st.dev[c];
}

/** Loyalty of every settlement (2): target from the parts, inertia, restless with hysteresis. */
function updateLoyalty(st: MandateState): void {
  const sim = st.sim;
  const w = sim.world;
  const n = w.cellCount;
  const rs = religionOf(sim);
  // Deviation: believers of other religions than the state's over the settlement's people.
  for (let c = 0; c < n; c++) {
    st.dev[c] = 0;
    const o = w.owner[c];
    const people = sim.cellPop[c];
    if (people === 0 || o === 0 || rs === null) continue;
    const sr = st.stateRel[o];
    let other = 0;
    for (let r = 0; r < MAXR; r++) if (r !== sr) other += rs.cellBel[c * MAXR + r];
    st.dev[c] = other / people;
  }
  const factors = new Float64Array(CIVS).fill(-1);
  for (let c = 0; c < n; c++) {
    const o = w.owner[c];
    const people = sim.cellPop[c];
    if (people === 0 || o === 0) {
      st.loyalty[c] = -1;
      st.restless[c] = 0;
      continue;
    }
    const civ = sim.civs[o];
    if (!civ) continue;
    if (civ.capital === c) {
      st.loyalty[c] = 100;
      st.restless[c] = 0;
      st.parts.fill(0, c * 4, c * 4 + 4);
      continue;
    }
    const cost = sim.seatCost[c];
    const reach = cost <= 1 ? MANDATE.reachNear : cost >= 8 ? MANDATE.reachFar : MANDATE.reachNear + ((MANDATE.reachFar - MANDATE.reachNear) * (cost - 1)) / 7;
    const sat = Math.max(MANDATE.satMin, Math.min(MANDATE.satMax, MANDATE.satWeight * sim.satisfaction[c]));
    let faith = 0;
    if (rs !== null) {
      if (factors[o] < 0) factors[o] = heresyFactor(rs, o);
      const dev = MANDATE.gradientOwn * st.dev[c] + (1 - MANDATE.gradientOwn) * nearMean(st, c, o, MANDATE.gradientRadius);
      faith = Math.max(MANDATE.faithCap, -MANDATE.faithWeight * dev * factors[o]);
      if (MANDATE.faithStep > 0 && st.loyalty[c] >= 0) {
        const prev = st.parts[c * 4 + 2];
        faith = prev + Math.max(-MANDATE.faithStep, Math.min(MANDATE.faithStep, faith - prev));
      }
    }
    const legit = st.legit[o];
    let soldiers = 0;
    for (let t = 0; t < 3; t++) soldiers += sim.military.soldiers[c * 3 + t];
    const garrison = Math.min(MANDATE.garrisonCap, MANDATE.garrisonPer1 * ((100 * soldiers) / people));
    const T = Math.max(0, Math.min(100, MANDATE.base + reach + sat + faith + legit + garrison + st.rec[c]));
    st.parts[c * 4] = reach;
    st.parts[c * 4 + 1] = sat;
    st.parts[c * 4 + 2] = faith;
    st.parts[c * 4 + 3] = legit;
    if (st.rec[c] > 0) st.rec[c] = Math.max(0, st.rec[c] - MANDATE.reconcileBonus / 10);
    const cur = st.loyalty[c];
    const L0 = cur < 0 ? T : cur + Math.max(-MANDATE.fall, Math.min(MANDATE.rise, T - cur));
    st.loyalty[c] = L0;
    const th = MANDATE.threshold / sim.leaders.lev[o * LEVERS + L.rebel];
    if (st.restless[c]) st.restless[c] = L0 >= th + MANDATE.hysteresis ? 0 : 1;
    else st.restless[c] = L0 < th ? 1 : 0;
  }
  // Heresy bloc rule: a daughter faith in the majority makes the settlement restless.
  st.forced.fill(0);
  if (MANDATE.heresyBloc && rs !== null) {
    for (let c = 0; c < n; c++) {
      const o = w.owner[c];
      const people = sim.cellPop[c];
      if (people === 0 || o === 0 || sim.civs[o]?.capital === c) continue;
      for (let r = 1; r < MAXR; r++) {
        if (rs.alive[r] && rs.parent[r] >= 0 && r !== st.stateRel[o] && rs.cellBel[c * MAXR + r] * 2 > people) {
          st.forced[c] = 1;
          st.restless[c] = 1;
          break;
        }
      }
    }
  }
}

const near = (st: MandateState, c: number, link: number, out: number[]): void => {
  const w = st.sim.world;
  out.length = 0;
  let frontier = [c];
  const seen = new Set<number>([c]);
  for (let r = 0; r < link; r++) {
    const next: number[] = [];
    for (const a of frontier) {
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const x = w.neighbors[a * DIRECTION_COUNT + d];
        if (x < 0 || seen.has(x)) continue;
        seen.add(x);
        next.push(x);
        out.push(x);
      }
    }
    frontier = next;
  }
};

/** Agitation (5.1): restless settlements pull their neighbors (the same people, within 2 hexes) down by chance. */
function agitate(st: MandateState): void {
  const sim = st.sim;
  const w = sim.world;
  const hits: number[] = [];
  const list: number[] = [];
  for (let c = 0; c < w.cellCount; c++) {
    if (!st.restless[c]) continue;
    near(st, c, 2, list);
    for (const x of list) {
      if (w.owner[x] === w.owner[c] && sim.cellPop[x] > 0 && st.loyalty[x] >= 0 && st.loyalty[x] < MANDATE.agitateBelow && !st.restless[x] && sim.civs[w.owner[x]]?.capital !== x && st.rng() < MANDATE.agitate) hits.push(x);
    }
  }
  for (const x of hits) {
    st.loyalty[x] = Math.max(0, st.loyalty[x] - MANDATE.agitateDrop);
    st.stats.agitations++;
  }
}

type Bloc = { civ: number; cells: number[]; pop: number; wB: number };

function components(st: MandateState): { blocs: Bloc[]; wK: Float64Array; realmPop: Float64Array } {
  const sim = st.sim;
  const w = sim.world;
  const n = w.cellCount;
  const wK = new Float64Array(CIVS);
  const realmPop = new Float64Array(CIVS);
  for (let c = 0; c < n; c++) {
    const o = w.owner[c];
    if (o === 0 || sim.cellPop[c] === 0 || st.loyalty[c] < 0) continue;
    realmPop[o] += sim.cellPop[c];
    if (!st.restless[c]) wK[o] += (sim.cellPop[c] * st.loyalty[c]) / 100;
  }
  const seen = new Uint8Array(n);
  const blocs: Bloc[] = [];
  const list: number[] = [];
  for (let c = 0; c < n; c++) {
    if (!st.restless[c] || seen[c]) continue;
    const o = w.owner[c];
    const cells = [c];
    seen[c] = 1;
    for (let k = 0; k < cells.length; k++) {
      near(st, cells[k], MANDATE.link, list);
      for (const x of list) if (!seen[x] && st.restless[x] && w.owner[x] === o) {
        seen[x] = 1;
        cells.push(x);
      }
    }
    let pop = 0;
    let wB = 0;
    for (const x of cells) {
      pop += sim.cellPop[x];
      wB += (sim.cellPop[x] * (100 - st.loyalty[x])) / 100;
    }
    blocs.push({ civ: o, cells, pop, wB });
  }
  blocs.sort((a, b) => b.pop - a.pop);
  return { blocs, wK, realmPop };
}

function mainCause(st: MandateState, cells: number[]): number {
  const sum = [0, 0, 0, 0];
  for (const c of cells) for (let k = 0; k < 4; k++) sum[k] += st.parts[c * 4 + k];
  let best = 0;
  for (let k = 1; k < 4; k++) if (sum[k] < sum[best]) best = k;
  return best;
}

function endBloc(st: MandateState, id: number, cells: number[], civ: number, wB: number, wK: number): void {
  const sim = st.sim;
  const s = st.stats;
  const w = sim.world;
  st.blocActive[id] = 0;
  const y = year(sim);
  s.countdownYears += y - st.blocStart[id];
  const th = MANDATE.ratio * wK;
  let forcedN = 0;
  for (const c of cells) forcedN += st.forced[c];
  const heresyBloc = MANDATE.heresyBloc === 1 && forcedN >= 2 && forcedN * 2 >= cells.length;
  const faithBloc = mainCause(st, cells) === 2 || heresyBloc;
  if ((wB <= th && !heresyBloc) || cells.length === 0) {
    reconcile(st, cells, civ);
    if (faithBloc) s.faithEnd[2]++;
    return;
  }
  // Faith share of the bloc: settlements with a deviation over 50 %.
  let faithy = 0;
  for (const c of cells) if (st.dev[c] > 0.5) faithy++;
  const faithShare = faithy / Math.max(1, cells.length);
  const legit = st.legit[civ];
  const isVassal = st.vassalOf[civ] >= 0;
  const wU = 1 + MANDATE.wFaith * faithShare + Math.max(0, -legit) / MANDATE.wLegit + (sim.war.enemy[civ] !== 0 ? MANDATE.wBusy : 0);
  const wA = isVassal ? 0 : MANDATE.wAutonomy * (1 + Math.max(0, legit) / MANDATE.wLegit);
  const pick = st.rng() * (wU + wA);
  const realm = Math.max(1, st.sim.civs[civ] ? sim.civs[civ]!.territory : 1);
  const share = cells.length / realm;
  void w;
  if (pick < wU) {
    // Independence: the existing rebel war.
    const rs = religionOf(sim);
    const faithDriven = rs !== null && faithBloc;
    let faithRel = -1;
    if (rs !== null) {
      rs.faithFlag[civ] = faithDriven ? 1 : 0;
      if (faithDriven) {
        const count = new Int32Array(MAXR);
        for (const c of cells) for (let r = 0; r < MAXR; r++) if (r !== st.stateRel[civ] && rs.cellBel[c * MAXR + r] * 2 > sim.cellPop[c]) count[r]++;
        let best = -1;
        let bestN = 0;
        for (let r = 0; r < MAXR; r++) if (count[r] > bestN) {
          bestN = count[r];
          best = r;
        }
        if (best >= 0) {
          rs.rebelFaith[civ] = best + 1;
          rs.rebelMother[civ] = st.stateRel[civ];
          rs.stats.faithRebellions++;
          if (!rs.herRebelled[best]) {
            rs.herRebelled[best] = 1;
            rs.stats.schismRebels++;
          }
          s.faithIndependence++;
          faithRel = best;
        }
      }
    }
    const slot = startRebellionCells(sim, civ, cells);
    if (rs !== null) rs.rebelFaith.fill(0);
    if (slot < 0) {
      s.failedStart++;
      reconcile(st, cells, civ);
      return;
    }
    s.independence++;
    if (faithBloc) s.faithEnd[0]++;
    if (faithRel >= 0 && rs !== null) st.warInfo.set(slot, { size: cells.length, rel: faithRel, serial: rs.serial[faithRel] });
    st.legitEvents[civ] += MANDATE.independence;
    if (share >= 0.2) s.large++;
    else s.small++;
    s.blocCells += cells.length;
    s.blocShare += share;
    return;
  }
  // Autonomy: up to vassalMax groups become vassals.
  makeVassals(st, cells, civ);
  s.autonomy++;
  if (faithBloc) s.faithEnd[1]++;
  st.legitEvents[civ] += MANDATE.autonomy;
  if (share >= 0.2) s.large++;
  else s.small++;
  s.blocCells += cells.length;
  s.blocShare += share;
}

function reconcile(st: MandateState, cells: number[], civ: number): void {
  for (const c of cells) st.rec[c] = MANDATE.reconcileBonus;
  st.legitEvents[civ] += MANDATE.reconcile;
  st.stats.reconcile++;
}

/** Splits the bloc into groups by adjacency; the largest become vassal peoples (peaceful, allied). */
function makeVassals(st: MandateState, cells: number[], mother: number): void {
  const sim = st.sim;
  const w = sim.world;
  const inBloc = new Set(cells);
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const c of cells) {
    if (seen.has(c)) continue;
    const g = [c];
    seen.add(c);
    for (let k = 0; k < g.length; k++) {
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const x = w.neighbors[g[k] * DIRECTION_COUNT + d];
        if (x >= 0 && inBloc.has(x) && !seen.has(x)) {
          seen.add(x);
          g.push(x);
        }
      }
    }
    groups.push(g);
  }
  groups.sort((a, b) => b.length - a.length);
  const parent = sim.civs[mother]!;
  for (const g of groups.slice(0, MANDATE.vassalMax)) {
    const mask = new Uint8Array(w.cellCount);
    for (const c of g) mask[c] = 1;
    const capital = mostPopulousCell(sim, mother, mask);
    if (capital < 0) continue;
    const civ = foundCivilization(sim, 'secession', capital, parent);
    if (!civ) continue;
    const pop = sim.pop;
    for (let i = 0; i < pop.end; i++) if (pop.alive[i] && pop.civ[i] === mother && mask[pop.cell[i]]) changeCiv(sim, i, civ.id);
    for (const c of g) w.owner[c] = civ.id;
    st.vassalOf[civ.id] = mother;
    st.vassalSince[civ.id] = year(sim);
    st.civObj[civ.id] = civ;
    st.stats.vassalsMade++;
    formAlliance(sim, mother, civ.id);
    for (const c of g) st.loyalty[c] = -1;
  }
}

/** The yearly vassal step: alliance, tribute, end rolls. */
function vassalsYear(st: MandateState): void {
  const sim = st.sim;
  const w = sim.world;
  const y = year(sim);
  const s = st.stats;
  for (let v = 1; v < CIVS && v < sim.civSlots; v++) {
    const m = st.vassalOf[v];
    if (m < 0) continue;
    const civ = sim.civs[v];
    if (!civ) {
      st.vassalOf[v] = -1;
      s.vassalLife += y - st.vassalSince[v];
      continue;
    }
    if (!sim.civs[m]) {
      st.vassalOf[v] = -1;
      s.vassalFreed++;
      s.vassalLife += y - st.vassalSince[v];
      continue;
    }
    formAlliance(sim, m, v);
    // Tribute: a share of the treasuries' yearly gain, halved when poor.
    let gain = 0;
    let total = 0;
    for (let c = 0; c < w.cellCount; c++) {
      if (w.owner[c] !== v) continue;
      const t = sim.government.treasury[c];
      total += t;
      gain += Math.max(0, t - st.vassalPrev[c]);
    }
    const poor = total < gain;
    const pay = MANDATE.tribute * gain * (poor ? 0.5 : 1);
    if (pay > 0 && total > 0 && sim.civs[m]!.capital >= 0) {
      for (let c = 0; c < w.cellCount; c++) if (w.owner[c] === v) sim.government.treasury[c] -= (sim.government.treasury[c] / total) * Math.min(pay, total);
      sim.government.treasury[sim.civs[m]!.capital] += Math.min(pay, total);
      s.tribute += Math.min(pay, total);
    }
    for (let c = 0; c < w.cellCount; c++) if (w.owner[c] === v) st.vassalPrev[c] = sim.government.treasury[c];
    const legit = st.legit[m];
    const strength = sim.military.strength;
    const rs = religionOf(sim);
    const otherFaith = rs !== null && st.stateRel[v] !== st.stateRel[m] ? 1 : 0;
    const stronger = (strength[v] ?? 0) > (strength[m] ?? 0) ? 1 : 0;
    const pInd = MANDATE.indep * (1 + Math.max(0, -legit) / 10 + otherFaith + stronger);
    if (y - st.vassalSince[v] >= MANDATE.vassalTruce && st.rng() < pInd) {
      const weak = legit <= -5 || (sim.war.enemy[m] !== 0 && (strength[m] ?? 0) < (strength[v] ?? 0));
      st.vassalOf[v] = -1;
      s.vassalLife += y - st.vassalSince[v];
      endPact(sim, m, v);
      if (weak) s.vassalIndepPeace++;
      else {
        s.vassalIndepWar++;
        if (civ.capital >= 0) startWar(sim, m, civ.capital);
      }
      st.legitEvents[m] += MANDATE.independence;
      continue;
    }
    if (y - st.vassalSince[v] >= MANDATE.reintegrateYears && st.rng() < MANDATE.reintegrate) {
      const popV = civ.population;
      const popM = sim.civs[m]!.population;
      if (legit >= MANDATE.reintegrateLegit && sim.diplomacy.trust[v * PAIRS + m] >= MANDATE.reintegrateTrust && popV < MANDATE.reintegrateShare * popM) {
        const pop = sim.pop;
        for (let i = 0; i < pop.end; i++) if (pop.alive[i] && pop.civ[i] === v) changeCiv(sim, i, m);
        for (let c = 0; c < w.cellCount; c++) if (w.owner[c] === v) {
          w.owner[c] = m;
          st.loyalty[c] = -1;
        }
        st.vassalOf[v] = -1;
        s.vassalReintegrated++;
        s.vassalLife += y - st.vassalSince[v];
      }
    }
  }
}

/** State faith = the leader's faith (Anführer 6a): heir draw, conversion in office, death of the faith, forced conversion variant. */
function updateLeaderFaith(st: MandateState): void {
  const sim = st.sim;
  const rs = religionOf(sim);
  if (rs === null) return;
  const s = st.stats;
  for (let c = 1; c < CIVS && c < sim.civSlots; c++) {
    const civ = sim.civs[c];
    if (!civ) continue;
    const cap = civ.capital;
    const capPop = cap >= 0 ? sim.cellPop[cap] : 0;
    const capShare = (r: number) => (capPop > 0 ? rs.cellBel[cap * MAXR + r] / capPop : 0);
    let capMajor = -1;
    let best = 0;
    for (let r = 0; r < MAXR; r++) {
      if (!rs.alive[r]) continue;
      const v = capPop > 0 ? capShare(r) : rs.share[c * MAXR + r];
      if (v > best) {
        best = v;
        capMajor = r;
      }
    }
    const cur = st.stateRel[c];
    const set = (r: number, cause: number) => {
      if (r === cur) return;
      st.stateRel[c] = r;
      if (cause === 1) s.stateSucc++;
      else if (cause === 2) s.stateConv++;
      else if (cause === 4) s.stateForced++;
      else if (cause === 3) s.stateDeath++;
      if (cause !== 0 && r >= 0 && rs.parent[r] >= 0) {
        s.stateToDaughter++;
        if (rs.wonBy[r] === 0) {
          rs.wonBy[r] = cause === 3 ? 1 : cause;
          rs.stats.dWon[cause === 3 ? 1 : cause]++;
        }
      }
    };
    if (cur < 0) {
      st.stateRel[c] = capMajor;
      continue;
    }
    if (!rs.alive[cur]) {
      set(capMajor, 3);
      continue;
    }
    if (st.succFlag[c]) {
      let total = 0;
      const w = new Float64Array(MAXR);
      for (let r = 0; r < MAXR; r++) {
        if (!rs.alive[r]) continue;
        w[r] = (MANDATE.capWeight * capShare(r) + (1 - MANDATE.capWeight) * rs.share[c * MAXR + r]) * (r === cur ? MANDATE.predecessor : 1);
        total += w[r];
      }
      if (total > 0) {
        let pick = st.rng() * total;
        for (let r = 0; r < MAXR; r++) {
          pick -= w[r];
          if (pick <= 0 && w[r] > 0) {
            set(r, 1);
            break;
          }
        }
      }
      continue;
    }
    // In office: a rival faith with a majority of the capital.
    let rival = -1;
    for (let r = 0; r < MAXR; r++) if (rs.alive[r] && r !== cur && capShare(r) >= MANDATE.convertShare) rival = r;
    let never = false;
    let flexible = 0;
    for (let k = 0; k < ATTR_SLOTS; k++) {
      const a = sim.leaders.attr[c * ATTR_SLOTS + k];
      if (a === 24 || a === 4 || a === 22 || a === 21) never = true;
      else if (a === 10) flexible = Math.max(flexible, MANDATE.opportunist);
      else if (a === 23) flexible = Math.max(flexible, MANDATE.weakHand);
    }
    if (rival >= 0 && !never && flexible > 0 && st.rng() < flexible) {
      set(rival, 2);
      st.forceCnt[c] = 0;
      continue;
    }
    if (MANDATE.forceYears > 0) {
      let hard = -1;
      for (let r = 0; r < MAXR; r++) if (rs.alive[r] && r !== cur && capShare(r) >= MANDATE.forceShare) hard = r;
      st.forceCnt[c] = hard >= 0 ? Math.min(255, st.forceCnt[c] + 1) : 0;
      if (hard >= 0 && st.forceCnt[c] >= MANDATE.forceYears) {
        set(hard, 4);
        st.forceCnt[c] = 0;
      }
    }
  }
}

/** The tool's hook at the end of a rebel war: faith wars are kept with their bloc size, a won war makes the heresy "won by rebellion". */
export function recordFaithWar(sim: Simulation, slot: number, rebelsWon: boolean): void {
  const st = ACTIVE;
  if (st === null || st.sim !== sim) return;
  const info = st.warInfo.get(slot);
  if (!info) return;
  st.warInfo.delete(slot);
  st.faithWars.push({ size: info.size, rebelsWon, rel: info.rel, serial: info.serial });
  const rs = religionOf(sim);
  if (rebelsWon && rs !== null && rs.serial[info.rel] === info.serial && rs.wonBy[info.rel] === 0 && rs.parent[info.rel] >= 0) {
    rs.wonBy[info.rel] = 3;
    rs.stats.dWon[3]++;
  }
}

/** The yearly Mandate step (call after the religion step, at the year's end). */
export function mandateYear(sim: Simulation): void {
  const st = ACTIVE;
  if (st === null || st.sim !== sim || !MANDATE.enabled) return;
  const y = year(sim);
  updateLegitimacy(st);
  if (MANDATE.leaderFaith) updateLeaderFaith(st);
  else updateStateReligion(st);
  updateLoyalty(st);
  agitate(st);
  const { blocs, wK, realmPop } = components(st);
  const s = st.stats;
  const used = new Set<number>();
  const newId = new Int8Array(sim.world.cellCount).fill(-1);
  for (const b of blocs) {
    const big = b.cells.length >= MANDATE.blockMinSettlements || b.pop >= MANDATE.blockMinShare * realmPop[b.civ];
    // An existing countdown on these settlements (the most overlapped).
    const votes = new Map<number, number>();
    for (const c of b.cells) if (st.blocId[c] >= 0) votes.set(st.blocId[c], (votes.get(st.blocId[c]) ?? 0) + 1);
    let id = -1;
    let best = 0;
    for (const [k, v] of votes) if (v > best && !used.has(k) && st.blocActive[k] && st.blocCiv[k] === b.civ) {
      best = v;
      id = k;
    }
    let forcedN = 0;
    for (const c of b.cells) forcedN += st.forced[c];
    const heavy = b.wB > MANDATE.ratio * wK[b.civ] || (MANDATE.heresyBloc === 1 && forcedN >= 2 && forcedN * 2 >= b.cells.length);
    if (id < 0) {
      if (!big) continue;
      if (st.blocId.length > 0) s.blocsFormed++;
      if (!heavy) continue;
      for (let k = 0; k < 16 && id < 0; k++) if (!st.blocActive[k]) id = k;
      if (id < 0) continue;
      st.blocActive[id] = 1;
      st.blocCiv[id] = b.civ;
      st.blocStart[id] = y;
      st.blocLen[id] = MANDATE.countdownMin + Math.floor(st.rng() * (MANDATE.countdownRoll + 1));
      s.countdowns++;
      const cause = mainCause(st, b.cells);
      s.causesStart[cause]++;
      if (cause === 2) s.faithCountdowns++;
      used.add(id);
      for (const c of b.cells) newId[c] = id;
      continue;
    }
    used.add(id);
    for (const c of b.cells) newId[c] = id;
    if (b.wB <= MANDATE.ratioEnd * MANDATE.ratio * wK[b.civ]) {
      st.blocActive[id] = 0;
      s.countdownYears += y - st.blocStart[id];
      if (forcedN < 2) reconcile(st, b.cells, b.civ);
      else {
        st.blocActive[id] = 1;
        continue;
      }
      for (const c of b.cells) newId[c] = -1;
      continue;
    }
    if (y - st.blocStart[id] >= st.blocLen[id]) {
      endBloc(st, id, b.cells, b.civ, b.wB, wK[b.civ]);
      for (const c of b.cells) newId[c] = -1;
    }
  }
  // Countdowns whose block vanished dissolve.
  for (let k = 0; k < 16; k++) if (st.blocActive[k] && !used.has(k)) {
    st.blocActive[k] = 0;
    s.dissolved++;
    s.countdownYears += y - st.blocStart[k];
  }
  st.blocId.set(newId);
  vassalsYear(st);
  void connectionValue;
}

function faithWarRows(st: MandateState): Record<string, number> {
  const rs = religionOf(st.sim);
  const won = st.faithWars.filter((w) => w.rebelsWon);
  const lost = st.faithWars.filter((w) => !w.rebelsWon);
  const mean = (a: { size: number }[]) => (a.length ? a.reduce((x, w) => x + w.size, 0) / a.length : 0);
  let died = 0;
  let smoulder = 0;
  let wonLater = 0;
  if (rs !== null) {
    for (const w of lost) {
      if (!rs.alive[w.rel] || rs.serial[w.rel] !== w.serial) died++;
      else if (rs.wonBy[w.rel] > 0) wonLater++;
      else smoulder++;
    }
  }
  return {
    'faith wars ended: rebels won': won.length,
    'faith wars ended: mother won (crushed)': lost.length,
    'faith wars: bloc size, rebels won (mean settlements)': mean(won),
    'faith wars: bloc size, crushed (mean settlements)': mean(lost),
    'crushed heresies: died': died,
    'crushed heresies: smouldering (alive)': smoulder,
    'crushed heresies: won later': wonLater,
  };
}

/** Numbers for the tool at a checkpoint: loyalty spread, restless share, main causes, double counting of the road distance. */
export function mandateSnapshot(st: MandateState): Record<string, number> {
  const sim = st.sim;
  const w = sim.world;
  let n = 0;
  let sum = 0;
  let restless = 0;
  const causes = [0, 0, 0, 0];
  let both = 0;
  let conn = 0;
  let reachSum = 0;
  let satTermSum = 0;
  let activeBlocs = 0;
  for (let c = 0; c < w.cellCount; c++) {
    if (st.loyalty[c] < 0 || sim.cellPop[c] === 0) continue;
    const o = w.owner[c];
    if (sim.civs[o]?.capital === c) continue;
    n++;
    sum += st.loyalty[c];
    reachSum += st.parts[c * 4];
    const cv = connectionValue(sim.seatCost[c]);
    satTermSum += cv;
    if (st.restless[c]) {
      restless++;
      let best = 0;
      for (let k = 1; k < 4; k++) if (st.parts[c * 4 + k] < st.parts[c * 4 + best]) best = k;
      causes[best]++;
      if (cv <= -5 && st.parts[c * 4] <= -10) both++;
      if (cv <= -5) conn++;
    }
  }
  for (let k = 0; k < 16; k++) activeBlocs += st.blocActive[k];
  let vassals = 0;
  for (let c = 1; c < CIVS; c++) if (st.vassalOf[c] >= 0 && sim.civs[c]) vassals++;
  const s = st.stats;
  const end = s.independence + s.autonomy;
  return {
    'MANDATE loyalty mean': n ? sum / n : 0,
    'loyalty: restless share %': n ? (100 * restless) / n : 0,
    'restless settlements': restless,
    'mean reach part': n ? reachSum / n : 0,
    'mean satisfaction connection term': n ? satTermSum / n : 0,
    'restless: cause reach %': restless ? (100 * causes[0]) / restless : 0,
    'restless: cause satisfaction %': restless ? (100 * causes[1]) / restless : 0,
    'restless: cause faith %': restless ? (100 * causes[2]) / restless : 0,
    'restless: cause legitimacy %': restless ? (100 * causes[3]) / restless : 0,
    'restless with road penalty in both parts %': restless ? (100 * both) / restless : 0,
    'restless with a connection term <= -5 %': restless ? (100 * conn) / restless : 0,
    'countdowns running': activeBlocs,
    'blocs formed (size ok)': s.blocsFormed,
    'countdowns started': s.countdowns,
    'countdown cause (start): reach': s.causesStart[0],
    'countdown cause (start): satisfaction': s.causesStart[1],
    'countdown cause (start): faith': s.causesStart[2],
    'countdown cause (start): legitimacy': s.causesStart[3],
    'countdowns over faith': s.faithCountdowns,
    'outcome: independence': s.independence,
    'outcome: autonomy (vassal)': s.autonomy,
    'outcome: reconciliation': s.reconcile,
    'outcome: bloc dissolved': s.dissolved,
    'outcome: rebellion failed to start': s.failedStart,
    'reconciliation % of outcomes': 100 * (s.reconcile + s.dissolved) / Math.max(1, s.reconcile + s.dissolved + end),
    'countdown length (mean years, ended)': s.countdownYears / Math.max(1, s.independence + s.autonomy + s.reconcile + s.dissolved),
    'split: >= 20 % of the realm (events)': s.large,
    'split: < 20 % of the realm (events)': s.small,
    'split: settlements per event': end ? s.blocCells / end : 0,
    'split: share of realm per event %': end ? (100 * s.blocShare) / end : 0,
    'independence over faith': s.faithIndependence,
    'agitations': s.agitations,
    'faith blocs ended: independence': s.faithEnd[0],
    'faith blocs ended: vassal': s.faithEnd[1],
    'faith blocs ended: reconciliation': s.faithEnd[2],
    ...faithWarRows(st),
    'state faith changes: succession': s.stateSucc,
    'state faith changes: conversion in office': s.stateConv,
    'state faith changes: forced conversion': s.stateForced,
    'state faith changes: faith died': s.stateDeath,
    'state faith changed to a daughter': s.stateToDaughter,
    'VASSALS now': vassals,
    'vassals made': s.vassalsMade,
    'vassal ends: independence peaceful': s.vassalIndepPeace,
    'vassal ends: independence by war': s.vassalIndepWar,
    'vassal ends: re-integrated': s.vassalReintegrated,
    'vassal ends: mother gone': s.vassalFreed,
    'vassal life (years, ended)': s.vassalLife / Math.max(1, s.vassalIndepPeace + s.vassalIndepWar + s.vassalReintegrated + s.vassalFreed),
    'tribute paid (money, total)': s.tribute,
  };
}

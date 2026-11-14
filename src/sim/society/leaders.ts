import { createRng, deriveSeed, type Rng } from '../rng';
import { GOV_TUNING } from './taxes';
import type { Simulation } from './simulation';

// Leaders ("Design Documents/Requirement Anführer.md"), the leaf part: the numbers, the lever set per
// people, the state and the event counters. No imports besides types, so war.ts, diplomacy.ts,
// military.ts and the rest can read the levers without import cycles at load time.
// The yearly rules (death, succession, attributes, goals) are in leaderRules.ts, what the app shows of a
// leader in leaderInfo.ts.
//
// How the rule acts on the simulation: every decision that a leader may shift reads ONE number from the
// lever set of its people (`sim.leaders.lev`, people x LEVERS, Float32). Additive levers are 0 and
// multiplicative ones 1 when nobody changes them. The set of a people is computed once whenever its leader,
// an attribute or the goal's state changes (leaderRules.ts: recompute); decisions never look at attributes.
// With LEADER.enabled = 0 (tools only: the comparison "without leaders") the table stays neutral.
// All state is flat typed arrays per people (index = people id); names are indices into LEADER_STEMS.

/** Peoples the tables have room for (MAX_CIV_ID + 1). */
export const LEADER_CIVS = 256;
/** Years of trade value kept per people. */
export const TRADE_HISTORY = 10;

/** Tunable numbers (tools/leaderStats.ts changes them by name); the Requirement's values. */
export const LEADER = {
  /** 1 = the peoples of a new simulation have leaders (the game); 0 = without them (tools/leaderStats.ts: the comparison). */
  enabled: 1,
  /** 1 = keep a sample of every ended term (`records`; tools and tests only, the game keeps none). */
  records: 0,
  /** 1 = leaders go into the chronicle: a new leader (with the predecessor's death) as an important entry, a new attribute and a reached goal as silent ones. */
  chronicle: 1,
  /** Age at takeover: ageMin + one of (ageMax - ageMin + 1); death: from deathFrom with deathBase + deathStep per year over it, at most deathMax. */
  ageMin: 20,
  ageMax: 40,
  deathFrom: 55,
  deathBase: 0.02,
  deathStep: 0.015,
  deathMax: 0.5,
  /** Years in office until the 2nd attribute. */
  secondYears: 10,
  /** Chance that the 1st attribute of a successor is one of the predecessor's. */
  inherit: 0.5,
  /** Chance that the 2nd and 3rd attribute come from experience (else random). */
  experience: 0.6,
  /** Share of goals chosen by the people's situation (else uniformly), and the situation factors. */
  goalBySituation: 0.6,
  weightExpansion: 2,
  weightWealth: 2,
  weightSecurity: 3,
  weightGlory: 2,
  /** What a goal keeps of its effect after completion. */
  goalHalf: 0.5,
  /** Goal completion: Expansion settlements x and at least +n; Wealth trade value x, partners and a floor for the start value; Security years; Glory years of +2 satisfaction. */
  expansionFactor: 1.5,
  expansionMin: 2,
  wealthFactor: 1.5,
  /** Years of trade value before takeover that make the start value (the mean). */
  wealthYears: 5,
  wealthPartners: 0,
  wealthFloor: 15,
  securityYears: 5,
  securityDanger: 40,
  gloryYears: 10,
  /** Years without war that count as one "long peace" experience. */
  peaceYears: 10,
  /** Share of a people's settlements below satisfaction 0 that counts as "hardship" of a year (at least one settlement). */
  hardshipShare: 0.1,
  /** Caps (Requirement section 3). */
  capSatisfaction: 8,
  capRatioMin: 1.2,
  capWarChance: 0.4,
  /** Attribute and goal effects scaled by these (1 = the table; 0.5 = half the deviation from the base; 0 = no effect). */
  attrScale: 1,
  goalScale: 1,
  /** Years a defeat is remembered (Grudge-bearer). */
  revengeYears: 30,
  /** Experiments: every new leader starts with this attribute (1..25, 0 = off), so one attribute can be compared with another on the same worlds. */
  forceAttr: 0,
};

/** The lever set. Kind: 0 additive (identity 0), 1 multiplicative (identity 1). */
export const L = {
  warChance: 0,
  warChanceMul: 1,
  neverWar: 2,
  ratio: 3,
  ratioBusy: 4,
  ratioCalm: 5,
  giveUp: 6,
  exhaust: 7,
  dangerMul: 8,
  sold: 9,
  strength: 10,
  truce: 11,
  warTrust: 12,
  moodYears: 13,
  openTrust: 14,
  closeTrust: 15,
  pactTrust: 16,
  allyTrust: 17,
  tradeTrust: 18,
  trust: 19,
  trustBase: 20,
  tollPay: 21,
  tollAsk: 22,
  margin: 23,
  income: 24,
  buildFrom: 25,
  govUpkeep: 26,
  travel: 27,
  settleOver: 28,
  threat: 29,
  devotion: 30,
  rebel: 31,
  resMul: 32,
  warPop: 33,
  oath: 34,
  sat: 35,
  satWar: 36,
  satGlory: 37,
  sendShare: 38,
  popShare: 39,
  trainShare: 40,
  occupy: 41,
  lossTaken: 42,
  defExtra: 43,
  openDanger: 44,
  closeDanger: 45,
  birth: 46,
  buildCost: 47,
  buildTime: 48,
  upkeepAll: 49,
  harvest: 50,
  load: 51,
  centerMin: 52,
  lossTrade: 53,
  tripRange: 54,
  revenge: 55,
  dealAmount: 56,
  reserve: 57,
  connection: 58,
  tradeFirst: 59,
  capitalFirst: 60,
} as const;
export const LEVERS = 61;
export const LEVER_NAMES = Object.keys(L) as (keyof typeof L)[];
/** 1 for the multiplicative levers. */
export const LEVER_KIND = new Uint8Array(LEVERS);
for (const k of [L.warChanceMul, L.dangerMul, L.sold, L.strength, L.tollPay, L.tollAsk, L.govUpkeep, L.travel, L.settleOver, L.rebel, L.resMul, L.warPop, L.occupy, L.lossTaken, L.birth, L.buildCost, L.buildTime, L.upkeepAll, L.harvest, L.load, L.centerMin, L.lossTrade, L.tripRange, L.revenge, L.dealAmount, L.reserve]) LEVER_KIND[k] = 1;

/** Experiments: 1 for levers (L index) whose effect is switched off, to see which lever causes a difference (tools only; all 0 in the game). */
export const MUTE = new Uint8Array(LEVERS);

/** Kinds of experience (Requirement section 4, "Erlebtes"). */
export const Ev = { WarWon: 0, WarLost: 1, Uprising: 2, Hardship: 3, Trade: 4, Pact: 5, BorderClosed: 6, Settled: 7, Peace: 8 } as const;
export const EVENTS = 9;
export const EVENT_NAMES = ['war won', 'war lost / seat besieged', 'uprising', 'hardship', 'trade success', 'pact/alliance/joined a war', 'border closed', 'new settlements', 'long peace'] as const;

/**
 * Dynasty names (Requirement section 6): a people's line is an index into this list, its leaders are
 * "Aron", "Aron II", "Aron III" ... Append only (the index is state).
 */
export const LEADER_STEMS = [
  'Aron', 'Belka', 'Corin', 'Dava', 'Eskil', 'Fenna', 'Garin', 'Hesta', 'Ivor', 'Jora', 'Kelan', 'Lysa',
  'Marek', 'Nessa', 'Orin', 'Pela', 'Quen', 'Rhea', 'Soren', 'Tavi', 'Ulric', 'Vessa', 'Wynn', 'Xara',
  'Yorin', 'Zela', 'Alder', 'Brina', 'Cael', 'Dessa', 'Emrik', 'Fala', 'Gerod', 'Hild', 'Ilan', 'Jessa',
  'Koren', 'Lena', 'Malin', 'Nardo', 'Odila', 'Perrin', 'Rasmus', 'Sela', 'Toren', 'Una', 'Varek', 'Wilda',
  'Ander', 'Bera', 'Cassim', 'Doran', 'Elva', 'Finn', 'Greta', 'Harun', 'Isolde', 'Joss', 'Kira', 'Loran',
  'Mira', 'Nolan', 'Orla', 'Pavo',
] as const;

const ROMAN: readonly [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
/** The name of the `counter`-th leader of line `stem`: "Aron", "Aron II" ... (display only). */
export function leaderName(stem: number, counter: number): string {
  const base = LEADER_STEMS[stem % LEADER_STEMS.length];
  if (counter <= 1) return base;
  let n = counter;
  let roman = '';
  for (const [v, r] of ROMAN) {
    while (n >= v) {
      roman += r;
      n -= v;
    }
  }
  return `${base} ${roman}`;
}

export const GOALS = ['none', 'Expansion', 'Wealth', 'Security', 'Glory'] as const;
export const Goal = { None: 0, Expansion: 1, Wealth: 2, Security: 3, Glory: 4 } as const;

/** Per-year measures of a people, summed per attribute for the "do opposite attributes behave differently" question (tools only). */
export const M = { years: 0, war: 1, declared: 2, open: 3, deals: 4, pacts: 5, tradeValue: 6, settlements: 7, growth: 8, satisfaction: 9, rebellions: 10, people: 11 } as const;
export const MEASURES = 12;
export const MEASURE_NAMES = ['years', 'years at war', 'wars declared', 'borders open (per pair known)', 'trade partners', 'pacts+alliances', 'trade value', 'settlements', 'settlement growth', 'satisfaction', 'rebellions suffered', 'people'] as const;

/** What a finished (or, at the end of a run, running) term of office left: the tool's sample. */
export type TermRecord = {
  civ: number;
  goal: number;
  /** Years in office; years until the goal was reached, -1 if not (by the end of the term). */
  years: number;
  doneYears: number;
  attrs: number[];
  /** Why the term ended: 0 death, 1 people gone, 2 still ruling at the end of the run. */
  end: number;
};

export type Leaders = {
  rng: Rng;
  /** 1 = the peoples of this simulation have leaders (LEADER.enabled when it was created; dismissLeaders sets 0). */
  enabled: number;
  /** 1 while the people has a leader. */
  has: Uint8Array;
  /** Dynasty: the line's name (index into LEADER_STEMS) and its counter (1 = first of the line); age at takeover, tick of takeover. */
  stem: Uint16Array;
  counter: Uint16Array;
  age0: Uint8Array;
  start: Int32Array;
  /** Attributes (1..25, 0 = empty): civ * 3 + slot. */
  attr: Uint8Array;
  /** Goal (Goal), 1 once reached, and the tick it was reached. */
  goal: Uint8Array;
  goalDone: Uint8Array;
  goalTick: Int32Array;
  /** Value of the goal's measure at takeover (settlements, trade value, capital tier). */
  goalBase: Float64Array;
  /** Years in a row safe (Security), tick of the last won war (Glory window), tick of the last war lost. */
  safeYears: Uint8Array;
  lastWin: Int32Array;
  /** Peace counter: years without war. */
  calmYears: Uint16Array;
  /** Experience counters and tick of the latest event per kind: civ * EVENTS + kind. */
  events: Uint16Array;
  eventTick: Int32Array;
  /** Last year's values for the diffs (settlements, partners, pacts). */
  lastSettlements: Int32Array;
  lastDeals: Int32Array;
  lastPacts: Int32Array;
  /** Settlements at the last yearly pass (the Expansion goal's progress). */
  settlements: Int32Array;
  /** The lever set, people x LEVERS. */
  lev: Float32Array;
  /** Satisfaction part "Leader" of the people and what its leader adds to the connection part; together capped at LEADER.capSatisfaction. */
  sat: Float32Array;
  conn: Float32Array;
  /** Trade value (goods x price, both peoples of a delivery) of the running year and the last year. */
  tradeValue: Float64Array;
  tradeLast: Float64Array;
  /** Ring of the last TRADE_HISTORY yearly trade values per people and the years counted. */
  tradeHist: Float64Array;
  tradeCount: Uint32Array;
  /** Wars the people declared in the running year (a measure), uprisings suffered likewise. */
  declared: Uint16Array;
  uprisings: Uint16Array;
  /** Measures: tools only. */
  all: Float64Array;
  attrM: Float64Array;
  /** The same per goal (index Goal; a reached goal counts under goal + 5). */
  goalM: Float64Array;
  /** Tick + 1 at which people b last beat or occupied a seat of people a: a * LEADER_CIVS + b (Grudge-bearer's revenge). */
  beaten: Int32Array;
  /** Districts conquered as the attacker of a war that was won, and wars won as the attacker (Glory goal), this term. */
  conquests: Uint16Array;
  wonAttack: Uint16Array;
  /** Samples of ended terms (only with LEADER.records). */
  records: TermRecord[];
  /** Tallies for the tool. */
  stats: {
    started: number;
    dynasties: number;
    died: number;
    inherited: number;
    inheritChances: number;
    capSat: number;
    capRatio: number;
    capChance: number;
    capYears: number;
    secondFromExperience: number;
    thirdFromExperience: number;
    attrDrawn: Int32Array;
    goalsChosen: Int32Array;
    goalsDone: Int32Array;
    /** Violations of an exclusion pair (must stay 0). */
    exclusionBreaks: number;
    /** Wars declared on a people that had beaten the attacker within LEADER.revengeYears. */
    revengeWars: number;
    /** Active-goal years and how often each part of a completion condition held: see leaderRules.ts goalReached. */
    parts: Int32Array;
  };
};

export function createLeaders(seed: number): Leaders {
  const lev = new Float32Array(LEADER_CIVS * LEVERS);
  for (let c = 0; c < LEADER_CIVS; c++) setIdentity(lev, c);
  return {
    rng: createRng(deriveSeed(seed, 'leader')),
    enabled: LEADER.enabled,
    has: new Uint8Array(LEADER_CIVS),
    stem: new Uint16Array(LEADER_CIVS),
    counter: new Uint16Array(LEADER_CIVS),
    age0: new Uint8Array(LEADER_CIVS),
    start: new Int32Array(LEADER_CIVS),
    attr: new Uint8Array(LEADER_CIVS * 3),
    goal: new Uint8Array(LEADER_CIVS),
    goalDone: new Uint8Array(LEADER_CIVS),
    goalTick: new Int32Array(LEADER_CIVS),
    goalBase: new Float64Array(LEADER_CIVS),
    safeYears: new Uint8Array(LEADER_CIVS),
    lastWin: new Int32Array(LEADER_CIVS).fill(-1),
    calmYears: new Uint16Array(LEADER_CIVS),
    events: new Uint16Array(LEADER_CIVS * EVENTS),
    eventTick: new Int32Array(LEADER_CIVS * EVENTS),
    lastSettlements: new Int32Array(LEADER_CIVS),
    lastDeals: new Int32Array(LEADER_CIVS),
    lastPacts: new Int32Array(LEADER_CIVS),
    settlements: new Int32Array(LEADER_CIVS),
    lev,
    sat: new Float32Array(LEADER_CIVS),
    conn: new Float32Array(LEADER_CIVS),
    tradeValue: new Float64Array(LEADER_CIVS),
    tradeLast: new Float64Array(LEADER_CIVS),
    tradeHist: new Float64Array(LEADER_CIVS * TRADE_HISTORY),
    tradeCount: new Uint32Array(LEADER_CIVS),
    declared: new Uint16Array(LEADER_CIVS),
    conquests: new Uint16Array(LEADER_CIVS),
    wonAttack: new Uint16Array(LEADER_CIVS),
    beaten: new Int32Array(LEADER_CIVS * LEADER_CIVS),
    uprisings: new Uint16Array(LEADER_CIVS),
    all: new Float64Array(MEASURES),
    attrM: new Float64Array(26 * MEASURES),
    goalM: new Float64Array(10 * MEASURES),
    records: [],
    stats: {
      started: 0,
      dynasties: 0,
      died: 0,
      inherited: 0,
      inheritChances: 0,
      capSat: 0,
      capRatio: 0,
      capChance: 0,
      capYears: 0,
      secondFromExperience: 0,
      thirdFromExperience: 0,
      attrDrawn: new Int32Array(26),
      goalsChosen: new Int32Array(5),
      goalsDone: new Int32Array(5),
      exclusionBreaks: 0,
      revengeWars: 0,
      parts: new Int32Array(12),
    },
  };
}

/** Writes the neutral lever set of people `civ`. */
export function setIdentity(lev: Float32Array, civ: number): void {
  const o = civ * LEVERS;
  for (let k = 0; k < LEVERS; k++) lev[o + k] = LEVER_KIND[k];
}

/** A people with a reused id starts over: no leader, the neutral lever set (leaderRules.ts: resetLeaderCiv closes the old term first). */
export function clearLeader(sim: Simulation, civ: number): void {
  const s = sim.leaders;
  s.has[civ] = 0;
  s.sat[civ] = 0;
  s.conn[civ] = 0;
  setIdentity(s.lev, civ);
}

/** An experience of the leader of `civ` (war won, uprising ...); counted only while it has one. */
export function leaderEvent(sim: Simulation, civ: number, kind: number): void {
  const s = sim.leaders;
  if (civ <= 0 || civ >= LEADER_CIVS || s.has[civ] === 0) return;
  s.events[civ * EVENTS + kind]++;
  s.eventTick[civ * EVENTS + kind] = sim.tick;
  if (kind === Ev.WarWon) s.lastWin[civ] = sim.tick;
}

/** Lever `k` of people `civ`. */
export function lever(sim: Simulation, civ: number, k: number): number {
  return sim.leaders.lev[civ * LEVERS + k];
}

/** Yearly chance that `civ` declares a war when it has a target: `base` (WAR.chance) with the leader's shifts, capped (Pacifist: never). */
export function warChance(sim: Simulation, civ: number, base: number, revenge = false): number {
  const lev = sim.leaders.lev;
  const o = civ * LEVERS;
  if (lev[o + L.neverWar] > 0) return 0;
  const add = lev[o + L.warChance];
  const mul = lev[o + L.warChanceMul] * (revenge ? lev[o + L.revenge] : 1);
  if (add === 0 && mul === 1) return base;
  return Math.max(0, Math.min(LEADER.capWarChance, (base + add) * mul));
}

/** Strength ratio `a` needs over `t` to declare war: `base` (WAR.ratio) with the leader's shifts, at least LEADER.capRatioMin. */
export function warRatio(sim: Simulation, a: number, busy: boolean, base: number, revenge = false): number {
  const lev = sim.leaders.lev;
  const o = a * LEVERS;
  if (revenge && lev[o + L.revenge] > 1) return LEADER.capRatioMin;
  const dev = lev[o + L.ratio] + (busy ? lev[o + L.ratioBusy] : lev[o + L.ratioCalm]);
  if (dev === 0) return base;
  return Math.max(LEADER.capRatioMin, base + dev);
}

/** Share of the potential income a district's government buildings and soldiers may take in yearly upkeep (GOV_TUNING.incomeShare, the leader's shift). */
export function incomeShare(sim: Simulation, civ: number): number {
  return GOV_TUNING.incomeShare + sim.leaders.lev[civ * LEVERS + L.income];
}

/** Satisfaction the weakest settlement keeps above zero under the taxes (GOV_TUNING.margin, the leader's shift); `base` for the seat financing margin. */
export function taxMargin(sim: Simulation, civ: number, base: number): number {
  return base + sim.leaders.lev[civ * LEVERS + L.margin];
}

/** Whether people `b` beat or occupied a seat of people `a` within LEADER.revengeYears (the memory of a Grudge-bearer). */
export function beatenBy(sim: Simulation, a: number, b: number): boolean {
  const t = sim.leaders.beaten[a * LEADER_CIVS + b];
  return t > 0 && sim.tick - (t - 1) <= LEADER.revengeYears * 52;
}

/** People `winner` beat or occupied a seat of `loser`. */
export function leaderBeaten(sim: Simulation, loser: number, winner: number): void {
  if (loser > 0 && winner > 0 && loser < LEADER_CIVS && winner < LEADER_CIVS) sim.leaders.beaten[loser * LEADER_CIVS + winner] = sim.tick + 1;
}

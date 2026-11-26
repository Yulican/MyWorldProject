import { DIRECTION_COUNT } from '../hex';
import { createRng, deriveSeed, type Rng } from '../rng';
import { Culture } from './culture';
import { FAITH } from './faithHooks';
import { PAIRS } from './diplomacy';
import { GODS, PLAYER_GOD } from './gacha';
import { ATTR_SLOTS, EVENTS, Ev, L, LEVERS, LEVER_KIND, combineLevers } from './leaders';
import { BELIEVER_FAITH, TICKS_PER_YEAR, type Simulation } from './simulation';

// Religion prototype, step 1 (Requirement Religion.md): religions as objects with traits, spread, folk faiths, schism,
// merging, death, the third lever layer, Creed and Heresy, Faith in trust, holy war. Installed by tools/religionStats.ts
// (`installReligion`), run yearly by `religionYear`; off (FAITH.on false) the game runs as before. All numbers are
// parameters (`RELIGION`), the requirement's start values; own random sequence "faith".

export const RELIGION = {
  /** Religions alive at most. */
  max: 16,
  /** Folk faith: people with >= foundMinPop inhabitants, >= foundShare without religion or wavering, foundYears in a row, foundChance per year; they take it with foundFaith. */
  foundMinPop: 100,
  foundShare: 0.3,
  foundYears: 5,
  foundChance: 0.05,
  foundFaith: 0.6,
  /** Founding needs this many believers; death below deathMin believers or deathShare of the world's people for deathYears in a row, grace years after founding. */
  minBelievers: 20,
  deathMin: 20,
  deathShare: 0.01,
  deathYears: 2,
  grace: 5,
  /** A people follows a religion from followStart of its people, loses it below followEnd. */
  followStart: 0.55,
  followEnd: 0.45,
  /** Yearly pull of the faith to the hex's mean faith, conversion: pressure needed, faith taken, faith below which the religion is lost, below which wavering. */
  pull: 0.1,
  convert: 0.2,
  convertFaith: 0.5,
  lose: 0.2,
  wavering: BELIEVER_FAITH,
  fading: 0.005,
  /** Inquisition: faith lost per year by other faiths in a people that follows it (level 2). */
  suppress: 0.03,
  /** Devotion of a followed religion's believers: culture Devout x this. */
  devout: 0.02,
  /** Trait slots: base, years per extra slot, natural maximum. */
  slotsBase: 2,
  slotYears: 20,
  slotsMax: 5,
  /** Level factors (level 1..3) on the deviation. */
  levelFactor1: 0.5,
  levelFactor2: 1,
  levelFactor3: 1.5,
  /** Progress per event (max per year), without an event, against an opposing event; level up at 100 -> 40; down below 0 -> 60. */
  gain: 10,
  gainMax: 25,
  idle: -2,
  /** Progress of a new level-1 trait (the requirement: 0, so one year without an event removes it). */
  newProgress: 0,
  counter: -8,
  /** New trait every newEvery years: share from events, replacement chance when full and a kind has >= replaceEvents events in 10 years. */
  newEvery: 10,
  newFromEvents: 0.6,
  replaceChance: 0.5,
  replaceEvents: 10,
  /** Founding: first trait from the leader attribute / culture; second from events. */
  firstFromAttr: 0.5,
  secondFromEvents: 0.6,
  /** Faith needed in a people to credit its events to a religion. */
  eventShare: 0.25,
  /** Schism tension: per war pair, once per people that seceded, per extra distinct story, per year from sizeFrom peoples; decay; chance base + per 10 over 40; cap; peoples needed with believersMin believers. */
  tensionWar: 5,
  tensionSecession: 10,
  tensionStory: 2,
  tensionSize: 1,
  sizeFrom: 4,
  tensionDecay: 3,
  schismBase: 0.005,
  schismPer10: 0.01,
  schismCap: 0.15,
  schismPeoples: 2,
  schismBelievers: 20,
  /** The seceding people must have this many settlements (1 = any: the requirement; 2 lets Heresy reach a non-capital settlement). */
  schismMinSettlements: 1,
  /** Merge: both with mergeShare in one people for mergeYears in a row, chance per year. */
  mergeShare: 0.25,
  mergeYears: 10,
  mergeChance: 0.03,
  /** Creed cap (+-), Heresy: start value, years, cap. */
  creedCap: 8,
  heresyStart: -6,
  heresyYears: 30,
  heresyCap: -10,
  /** Experiment: while a people has Heresy its rebels need only this share of the mother's strength (lever `rebel` x this; 1 = the requirement). */
  heresyRebel: 1,
  /** Heresy factors (Inquisition, Open Gates, Syncretic Spirit, Holy War, Steadfast Flock). */
  heresyInq: 0.5,
  heresyOpen: 0.5,
  heresySync: 0.5,
  heresyHoly: 1.3,
  heresyFlock: 1.2,
  /** Faith in trust: same religion, foreign religion, caps, kin cap. */
  trustSame: 8,
  trustForeign: -8,
  trustMin: -16,
  trustMax: 12,
  kinMin: -16,
  kinMax: 8,
  /** 1 scales the traits' trust bonus in the lever layer (0 = Faith part only; checks the double counting). */
  flatTrust: 1,
  /** Holy war: strength ratio, years of cooldown per attacker religion, trust needed to join, share of the people to join a faith rebellion. */
  holyRatio: 1.5,
  holyCooldown: 30,
  joinTrust: 40,
  joinShare: 0.5,
  /** Scale on the lever layer's deviations and on Creed (experiments: 0 isolates the other effects). */
  leverScale: 1,
  creedScale: 1,
  /** Scale on all trait effects (0 = traits without effect: the religions only exist). */
  effect: 1,
  /** Switches for the experiments: 1 = on. */
  holyWar: 1,
  /** Experiment: every religion may declare holy wars (upper bound of their number). */
  holyAll: 0,
  heresy: 1,
  faithTrust: 1,
  spread: 1,
};

/** Experiments: 1 for levers (L index) of the faith layer that have no effect (tools only; all 0 in the game). */
export const FAITH_MUTE = new Uint8Array(LEVERS);
export const MAXR = 16;
const SLOTS = 7;
const CIVS = 256;
const NK = 14;
/** Event kinds (Requirement 4.5; Aggr = declared a war). */
export const K = { War: 0, WarWon: 1, WarLost: 2, Uprising: 3, Hardship: 4, Trade: 5, Pact: 6, Settled: 7, Peace: 8, Disaster: 9, Foreign: 10, Pressure: 11, Succession: 12, Aggr: 13 } as const;
const KIND_NAMES = ['War', 'WarWon', 'WarLost', 'Uprising', 'Hardship', 'Trade', 'Pact', 'Settled', 'Peace', 'Disaster', 'Foreign', 'Pressure', 'Succession', 'Aggr'];
/** Experience counters of the leaders that map onto event kinds. */
const LEADER_KIND: [number, number][] = [[Ev.WarWon, K.WarWon], [Ev.WarLost, K.WarLost], [Ev.Uprising, K.Uprising], [Ev.Hardship, K.Hardship], [Ev.Trade, K.Trade], [Ev.Pact, K.Pact], [Ev.Settled, K.Settled], [Ev.Peace, K.Peace]];

type Eff = [lever: number, value: number];
type TraitDef = {
  name: string;
  theme: number;
  lev: Eff[];
  /** Satisfaction deviation (part "Creed"). */
  sat: number;
  /** R-levers (religion's own): pull, hold, devotion (add), suppress (add), merge, schism (factors). */
  pull?: number;
  hold?: number;
  devotion?: number;
  suppress?: number;
  merge?: number;
  schism?: number;
  /** Faith in trust (6a): bond factor, kin shift, xeno factor. */
  bond?: number;
  kin?: number;
  xeno?: number;
  /** Event kinds that feed it, the kind that harms it (-1 none, -2 Divine Mandate's 20 quiet years). */
  src: number[];
  counter: number;
  /** Leader attributes of a founder that bring it. */
  attrs: number[];
};
export const THEMES = ['War', 'Fertility', 'Order', 'Mission', 'Openness', 'Asceticism', 'Ancestors', 'Sea & Wandering'] as const;

/** The pool of 24 (index 1..24, Requirement 4.2); effects at level 2. */
export const TRAITS: TraitDef[] = [
  { name: '', theme: 0, lev: [], sat: 0, src: [], counter: -1, attrs: [] },
  { name: 'Holy War', theme: 0, lev: [[L.warChance, 0.1], [L.strength, 1.1]], sat: -1, bond: 1.2, kin: -10, xeno: 1.5, src: [K.War, K.WarWon], counter: K.Peace, attrs: [1] },
  { name: 'Peacemakers', theme: 0, lev: [[L.warChanceMul, 0.6], [L.openTrust, -5], [L.trust, 5]], sat: 1, kin: 3, xeno: 0.7, src: [K.Peace], counter: K.Aggr, attrs: [2] },
  { name: "Martyrs' Creed", theme: 0, lev: [[L.lossTaken, 0.8], [L.giveUp, -0.1], [L.sold, 0.9], [L.exhaust, 2]], sat: 0, src: [K.WarLost], counter: K.Peace, attrs: [4] },
  { name: 'Fertility Rites', theme: 1, lev: [[L.birth, 1.08]], sat: 1, src: [K.Peace, K.Settled], counter: K.Hardship, attrs: [] },
  { name: 'Harvest Covenant', theme: 1, lev: [[L.food, 1.08]], sat: 0, src: [K.Hardship], counter: K.Hardship, attrs: [] },
  { name: 'Hearth Blessing', theme: 1, lev: [[L.travel, 1.2], [L.birth, 1.03]], sat: 2, src: [K.Hardship, K.Peace], counter: -1, attrs: [19] },
  { name: 'Divine Mandate', theme: 2, lev: [[L.rebel, 1.4], [L.income, 0.05]], sat: -1, src: [K.Uprising], counter: -2, attrs: [21, 22] },
  { name: 'Alms and Mercy', theme: 2, lev: [[L.margin, 5]], sat: 3, src: [K.Hardship, K.Peace], counter: -1, attrs: [13, 20] },
  { name: 'Sacred Tithe', theme: 2, lev: [[L.income, 0.1]], sat: -2, src: [K.Trade], counter: K.Hardship, attrs: [14] },
  { name: 'Missionary Zeal', theme: 3, lev: [[L.warChance, 0.03]], sat: 0, pull: 1.5, src: [K.Settled, K.Trade, K.Pact, K.WarWon], counter: K.Pressure, attrs: [24] },
  { name: 'Inquisition', theme: 3, lev: [[L.rebel, 1.2], [L.tollAsk, 1.5]], sat: -3, suppress: 1, merge: 0, schism: 0.7, bond: 1, kin: -14, xeno: 1.5, src: [K.Uprising, K.Foreign, K.War], counter: -1, attrs: [22] },
  { name: 'Steadfast Flock', theme: 3, lev: [[L.closeTrust, 5]], sat: 1, hold: 1.6, merge: 0, schism: 0.7, bond: 1.3, kin: -6, xeno: 1.3, src: [K.Pressure], counter: -1, attrs: [8] },
  { name: 'Open Gates', theme: 4, lev: [[L.trust, 6], [L.openTrust, -5]], sat: 1, hold: 0.8, bond: 1, kin: 3, xeno: 0.5, src: [K.Trade, K.Pact, K.Peace], counter: K.Pressure, attrs: [7] },
  { name: 'Pilgrim Roads', theme: 4, lev: [[L.load, 1.15], [L.tripRange, 1.15], [L.dealAmount, 1.2]], sat: 0, kin: 1, xeno: 0.8, src: [K.Trade], counter: -1, attrs: [12] },
  { name: 'Syncretic Spirit', theme: 4, lev: [[L.trust, 3]], sat: 1, merge: 3, schism: 0.5, kin: 6, xeno: 0.5, src: [K.Foreign], counter: -1, attrs: [] },
  { name: 'Ascetic Vows', theme: 5, lev: [[L.upkeepAll, 0.85], [L.reserve, 1.5], [L.birth, 0.95]], sat: -1, devotion: 0.01, src: [K.Hardship], counter: -1, attrs: [16] },
  { name: 'Temple Splendor', theme: 5, lev: [[L.upkeepAll, 1.1], [L.capitalFirst, 1]], sat: 3, devotion: 0.01, src: [K.Trade], counter: K.Hardship, attrs: [15] },
  { name: 'Stoic Endurance', theme: 5, lev: [[L.exhaust, 3], [L.rebel, 1.2]], sat: 0, src: [K.Hardship, K.WarLost], counter: -1, attrs: [] },
  { name: 'Ancestor Veneration', theme: 6, lev: [], sat: 2, hold: 1.3, schism: 0.8, src: [K.Succession, K.Peace], counter: -1, attrs: [] },
  { name: 'Spirit Guardians', theme: 6, lev: [[L.defExtra, 0.2], [L.strength, 1.05]], sat: 1, src: [K.WarLost], counter: -1, attrs: [] },
  { name: 'Ancestral Wisdom', theme: 6, lev: [[L.buildCost, 0.9], [L.buildTime, 0.9]], sat: 0, src: [K.Succession, K.Peace], counter: -1, attrs: [] },
  { name: 'Sea Gods', theme: 7, lev: [[L.tripRange, 1.15], [L.lossTrade, 0.7]], sat: 0, src: [K.Trade], counter: -1, attrs: [] },
  { name: "Wayfarers' Faith", theme: 7, lev: [[L.settleOver, 0.97], [L.travel, 0.85]], sat: -1, src: [K.Settled], counter: -1, attrs: [18] },
  { name: 'Omen Readers', theme: 7, lev: [], sat: 2, src: [K.Disaster], counter: -1, attrs: [] },
];
export const TRAIT_COUNT = 24;
const EXCLUDE: [number, number][] = [[1, 2], [2, 3], [4, 16], [6, 23], [8, 9], [10, 12], [11, 13], [11, 15], [12, 13], [16, 17]];
const excludes = new Uint8Array(25 * 25);
for (const [a, b] of EXCLUDE) {
  excludes[a * 25 + b] = 1;
  excludes[b * 25 + a] = 1;
}
const CULTURE_THEMES: number[][] = [];
CULTURE_THEMES[Culture.Warlike] = [0];
CULTURE_THEMES[Culture.Seafaring] = [7];
CULTURE_THEMES[Culture.Farming] = [1];
CULTURE_THEMES[Culture.Wandering] = [7];
CULTURE_THEMES[Culture.Devout] = [3, 5];

export type ReligionStats = {
  /** Foundings by path. */
  start: number;
  folk: number;
  schism: number;
  merged: number;
  died: number;
  blockedFull: number;
  lifeSum: number;
  traitGain: number[];
  traitLose: number[];
  levelUp: number;
  levelDown: number;
  traitReplace: number;
  schismsOf0: number;
  tensionAtSchism0: number;
  maxTension0: number;
  heresyStarts: number;
  /** Settlements of the people that split off, summed; schisms where it had two or more (a rebellion needs a non-capital settlement). */
  schismSettlements: number;
  schismMulti: number;
  schismRebels: number;
  faithRebellions: number;
  faithJoinsRebel: number;
  faithJoinsMother: number;
  wars: number;
  holyWars: number;
  holyJoins: number;
  holyYears: number;
  holyEnded: number;
  holyLongest: number;
  maxWarAge: number;
  /** Religions that kept >= T believers for 15 years without a god (T = 100, 150, 300), counted once per religion. */
  awake100: number;
  awake150: number;
  awake300: number;
  merge0: number;
  yearsFull: number;
  reachedFull: number;
  /** Person-years in religion 0 or in peoples that follow it, sums per year of alive religions. */
  aliveSum: number;
  years: number;
  followSum: number;
};

export type ReligionState = {
  sim: Simulation;
  rng: Rng;
  alive: Uint8Array;
  serial: Int32Array;
  next: number;
  founded: Int32Array;
  founderCiv: Int16Array;
  parent: Int16Array;
  parentSerial: Int32Array;
  traitId: Uint8Array;
  traitLvl: Uint8Array;
  traitProg: Float32Array;
  tension: Float32Array;
  newClock: Int32Array;
  total: Int32Array;
  below: Uint8Array;
  lastUprising: Int32Array;
  lastHoly: Int32Array;
  mergeYears: Uint8Array;
  secFlag: Uint8Array;
  /** Event histogram per religion x kind x 10 years, and the year's counts; per people the same. */
  evHist: Uint8Array;
  yev: Int16Array;
  civHist: Uint8Array;
  civYear: Int16Array;
  lostOut: Int32Array;
  startTotal: Int32Array;
  awakeStreak: Int32Array;
  awakeDone: Uint8Array;
  /** Believers per (civ, religion), people, unaffiliated or wavering. */
  cnt: Int32Array;
  popC: Int32Array;
  wav: Int32Array;
  share: Float32Array;
  major: Int16Array;
  foundStreak: Uint8Array;
  /** The civilization object a slot's data belongs to (a reused slot resets). */
  civObj: (object | null)[];
  heresyYear: Int32Array;
  heresyDaughter: Int16Array;
  heresyMother: Int16Array;
  heresyAbs: Float32Array;
  /** A faith rebellion declared by this realm this year: daughter religion + 1 (0 none), and the mother religion. */
  rebelFaith: Int16Array;
  rebelMother: Int16Array;
  /** Last counts of the leaders' experiences and rulers, per people. */
  seenEv: Int32Array;
  seenCounter: Int32Array;
  /** Per cell x religion: mean faith of the religion's inhabitants over the cell's people, believers in the cell and its neighbors over their people. */
  cellFs: Float32Array;
  press: Float32Array;
  cellBel: Float32Array;
  /** R-levers per religion. */
  rPull: Float32Array;
  rHold: Float32Array;
  rDev: Float32Array;
  rSup: Float32Array;
  rMerge: Float32Array;
  rSchism: Float32Array;
  lev: Float32Array;
  creed: Float32Array;
  heresy: Float32Array;
  trust: Float32Array;
  holyWar: Uint8Array;
  holyAge: Int32Array;
  stats: ReligionStats;
  /** Years the sim has run (the last religionYear). */
  year: number;
  /** Per-year samples the tool reads. */
  history: { year: number; alive: number; believers0: number }[];
};

let ACTIVE: ReligionState | null = null;
export const religionOf = (sim: Simulation): ReligionState | null => (ACTIVE !== null && ACTIVE.sim === sim ? ACTIVE : null);

const lf = (level: number) => (level <= 1 ? RELIGION.levelFactor1 : level === 2 ? RELIGION.levelFactor2 : RELIGION.levelFactor3);

function newStats(): ReligionStats {
  return {
    start: 0, folk: 0, schism: 0, merged: 0, died: 0, blockedFull: 0, lifeSum: 0,
    traitGain: new Array(25).fill(0), traitLose: new Array(25).fill(0),
    levelUp: 0, levelDown: 0, traitReplace: 0, schismsOf0: 0, tensionAtSchism0: 0, maxTension0: 0,
    heresyStarts: 0, schismSettlements: 0, schismMulti: 0, schismRebels: 0, faithRebellions: 0, faithJoinsRebel: 0, faithJoinsMother: 0,
    wars: 0, holyWars: 0, holyJoins: 0, holyYears: 0, holyEnded: 0, holyLongest: 0, maxWarAge: 0,
    awake100: 0, awake150: 0, awake300: 0, merge0: 0, yearsFull: 0, reachedFull: 0, aliveSum: 0, years: 0, followSum: 0,
  };
}

/** Switches the religion layer on for `sim` (religion 0 = the start people's faith). Call right after createSimulation. */
export function installReligion(sim: Simulation): ReligionState {
  const cells = sim.world.cellCount;
  const st: ReligionState = {
    sim,
    rng: createRng(deriveSeed(sim.world.seed, 'faith')),
    alive: new Uint8Array(MAXR),
    serial: new Int32Array(MAXR),
    next: 1,
    founded: new Int32Array(MAXR),
    founderCiv: new Int16Array(MAXR),
    parent: new Int16Array(MAXR).fill(-1),
    parentSerial: new Int32Array(MAXR),
    traitId: new Uint8Array(MAXR * SLOTS),
    traitLvl: new Uint8Array(MAXR * SLOTS),
    traitProg: new Float32Array(MAXR * SLOTS),
    tension: new Float32Array(MAXR),
    newClock: new Int32Array(MAXR),
    total: new Int32Array(MAXR),
    below: new Uint8Array(MAXR),
    lastUprising: new Int32Array(MAXR),
    lastHoly: new Int32Array(MAXR).fill(-1000),
    mergeYears: new Uint8Array(MAXR * MAXR),
    secFlag: new Uint8Array(MAXR * CIVS),
    evHist: new Uint8Array(MAXR * NK * 10),
    yev: new Int16Array(MAXR * NK),
    civHist: new Uint8Array(CIVS * NK * 10),
    civYear: new Int16Array(CIVS * NK),
    lostOut: new Int32Array(MAXR),
    startTotal: new Int32Array(MAXR),
    awakeStreak: new Int32Array(MAXR * 3),
    awakeDone: new Uint8Array(MAXR * 3),
    cnt: new Int32Array(CIVS * MAXR),
    popC: new Int32Array(CIVS),
    wav: new Int32Array(CIVS),
    share: new Float32Array(CIVS * MAXR),
    major: new Int16Array(CIVS).fill(-1),
    foundStreak: new Uint8Array(CIVS),
    civObj: new Array(CIVS).fill(null),
    heresyYear: new Int32Array(CIVS).fill(-1),
    heresyDaughter: new Int16Array(CIVS).fill(-1),
    heresyMother: new Int16Array(CIVS).fill(-1),
    heresyAbs: new Float32Array(CIVS),
    rebelFaith: new Int16Array(CIVS),
    rebelMother: new Int16Array(CIVS),
    seenEv: new Int32Array(CIVS * EVENTS),
    seenCounter: new Int32Array(CIVS),
    cellFs: new Float32Array(cells * MAXR),
    press: new Float32Array(cells * MAXR),
    cellBel: new Float32Array(cells * MAXR),
    rPull: new Float32Array(MAXR).fill(1),
    rHold: new Float32Array(MAXR).fill(1),
    rDev: new Float32Array(MAXR),
    rSup: new Float32Array(MAXR),
    rMerge: new Float32Array(MAXR).fill(1),
    rSchism: new Float32Array(MAXR).fill(1),
    lev: new Float32Array(CIVS * LEVERS),
    creed: new Float32Array(CIVS),
    heresy: new Float32Array(CIVS),
    trust: new Float32Array(PAIRS * PAIRS),
    holyWar: new Uint8Array(64),
    holyAge: new Int32Array(64),
    stats: newStats(),
    year: 0,
    history: [],
  };
  for (let c = 0; c < CIVS; c++) for (let k = 0; k < LEVERS; k++) st.lev[c * LEVERS + k] = LEVER_KIND[k] ? 1 : 0;
  ACTIVE = st;
  FAITH.on = true;
  FAITH.lev = st.lev;
  FAITH.creed = st.creed;
  FAITH.heresy = st.heresy;
  FAITH.trust = RELIGION.faithTrust ? st.trust : null;
  FAITH.rel = new Uint8Array(sim.pop.capacity).fill(255);
  FAITH.holy = st.holyWar;
  FAITH.added = onAdded;
  FAITH.step = onStep;
  FAITH.holyRatio = holyRatio;
  FAITH.warStarted = warStarted;
  FAITH.joinSide = joinSide;
  // Religion 0: the start faith of the start people (all of them, 75-100 % faith).
  const pop = sim.pop;
  for (let i = 0; i < pop.end; i++) if (pop.alive[i]) FAITH.rel[i] = 0;
  let founder = 1;
  for (let id = 1; id < sim.civSlots; id++) if (sim.civs[id]) { founder = id; break; }
  found(st, 0, founder, -1, 0);
  st.stats.start++;
  countAll(st);
  return st;
}

/** Switches it off again (tests, tools running other variants in one process). */
export function removeReligion(): void {
  ACTIVE = null;
  FAITH.on = false;
  FAITH.lev = null;
  FAITH.creed = null;
  FAITH.heresy = null;
  FAITH.trust = null;
  FAITH.added = null;
  FAITH.step = null;
  FAITH.holyRatio = null;
  FAITH.warStarted = null;
  FAITH.holy = null;
  FAITH.joinSide = null;
}

function ensureRel(sim: Simulation): void {
  if (FAITH.rel.length < sim.pop.capacity) {
    const grown = new Uint8Array(sim.pop.capacity).fill(255);
    grown.set(FAITH.rel);
    FAITH.rel = grown;
  }
}

// ---------------------------------------------------------------------------
// Inhabitants

/** A new inhabitant: a child takes its parent's religion, a soldier coming home the cell's strongest, a new tribe none. */
function onAdded(sim: Simulation, slot: number, parent: number, cell: number): void {
  ensureRel(sim);
  if (parent >= 0) {
    FAITH.rel[slot] = FAITH.rel[parent];
    return;
  }
  const st = ACTIVE!;
  let best = 255;
  let bestV = 0.05;
  for (let r = 0; r < MAXR; r++) {
    const v = st.cellFs[cell * MAXR + r];
    if (v > bestV) {
      bestV = v;
      best = r;
    }
  }
  FAITH.rel[slot] = best;
}

/** The yearly faith step of one inhabitant (replaces the player-faith step of updateInhabitant). */
function onStep(sim: Simulation, i: number, civId: number, cell: number, before: number): number {
  const st = ACTIVE!;
  const rel = FAITH.rel;
  const r = rel[i];
  const base = cell * MAXR;
  if (r === 255 || !st.alive[r]) {
    rel[i] = 255;
    let top = -1;
    let topV = RELIGION.convert;
    for (let q = 0; q < MAXR; q++) {
      const v = st.press[base + q] * st.rPull[q];
      if (v >= topV && st.alive[q]) {
        topV = v;
        top = q;
      }
    }
    if (top >= 0 && RELIGION.spread) {
      rel[i] = top;
      return RELIGION.convertFaith;
    }
    return 0;
  }
  const civ = sim.civs[civId]!;
  let f = before + (st.cellFs[base + r] - before) * RELIGION.pull;
  if (st.major[civId] === r) {
    f += civ.culture[Culture.Devout] * RELIGION.devout + sim.leaders.lev[civId * LEVERS + L.devotion] + st.rDev[r];
    if (r === 0) f += sim.gacha.godDevotion[civId * GODS + PLAYER_GOD];
  } else f -= RELIGION.fading;
  const major = st.major[civId];
  if (major >= 0 && major !== r) f -= st.rSup[major];
  if (f < RELIGION.lose) {
    rel[i] = 255;
    return 0;
  }
  if (f >= 1) f = 1;
  if (f < RELIGION.wavering && RELIGION.spread) {
    // Wavering: the strongest pressure of another religion (against the own religion's hold) wins them over.
    const own = st.press[base + r] * st.rPull[r];
    let top = -1;
    let topV = Math.max(RELIGION.convert, own);
    for (let q = 0; q < MAXR; q++) {
      if (q === r || !st.alive[q]) continue;
      const v = (st.press[base + q] * st.rPull[q]) / st.rHold[r];
      if (v > topV) {
        topV = v;
        top = q;
      }
    }
    if (top >= 0) {
      rel[i] = top;
      st.lostOut[r]++;
      return RELIGION.convertFaith;
    }
  }
  return f;
}

// ---------------------------------------------------------------------------
// Counting

const year = (sim: Simulation) => Math.floor(sim.tick / TICKS_PER_YEAR);

/** Counts believers per (people, religion), the cells' faith and pressure arrays (one pass over the inhabitants). */
function countAll(st: ReligionState): void {
  const sim = st.sim;
  const pop = sim.pop;
  const cells = sim.world.cellCount;
  ensureRel(sim);
  st.cnt.fill(0);
  st.popC.fill(0);
  st.wav.fill(0);
  st.total.fill(0);
  st.cellFs.fill(0);
  st.cellBel.fill(0);
  const rel = FAITH.rel;
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i]) continue;
    const c = pop.civ[i];
    st.popC[c]++;
    const r = rel[i];
    if (r === 255) {
      st.wav[c]++;
      continue;
    }
    const f = pop.faith[i];
    st.cellFs[pop.cell[i] * MAXR + r] += f;
    if (f >= BELIEVER_FAITH) {
      st.cnt[c * MAXR + r]++;
      st.total[r]++;
      st.cellBel[pop.cell[i] * MAXR + r]++;
    } else st.wav[c]++;
  }
  for (let c = 0; c < cells; c++) {
    const n = sim.cellPop[c];
    if (n > 0) for (let r = 0; r < MAXR; r++) st.cellFs[c * MAXR + r] /= n;
  }
  // Pressure: believers in the cell and its neighbors over their people.
  st.press.fill(0);
  const nb = sim.world.neighbors;
  for (let c = 0; c < cells; c++) {
    if (sim.cellPop[c] === 0) continue;
    let people = sim.cellPop[c];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const x = nb[c * DIRECTION_COUNT + d];
      if (x >= 0) people += sim.cellPop[x];
    }
    for (let r = 0; r < MAXR; r++) {
      if (!st.alive[r]) continue;
      let k = st.cellBel[c * MAXR + r];
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const x = nb[c * DIRECTION_COUNT + d];
        if (x >= 0) k += st.cellBel[x * MAXR + r];
      }
      st.press[c * MAXR + r] = k / people;
    }
  }
  for (let c = 0; c < CIVS; c++) {
    const n = st.popC[c];
    for (let r = 0; r < MAXR; r++) st.share[c * MAXR + r] = n > 0 ? st.cnt[c * MAXR + r] / n : 0;
  }
}

// ---------------------------------------------------------------------------
// Traits

const traitCount = (st: ReligionState, r: number): number => {
  let n = 0;
  for (let k = 0; k < SLOTS; k++) if (st.traitId[r * SLOTS + k] !== 0) n++;
  return n;
};
const hasTrait = (st: ReligionState, r: number, t: number): number => {
  for (let k = 0; k < SLOTS; k++) if (st.traitId[r * SLOTS + k] === t) return k;
  return -1;
};
const excluded = (st: ReligionState, r: number, t: number): boolean => {
  if (hasTrait(st, r, t) >= 0) return true;
  for (let k = 0; k < SLOTS; k++) {
    const o = st.traitId[r * SLOTS + k];
    if (o !== 0 && excludes[o * 25 + t]) return true;
  }
  return false;
};
const slotsOf = (st: ReligionState, r: number) => Math.min(RELIGION.slotsMax, RELIGION.slotsBase + Math.floor((st.sim.tick / TICKS_PER_YEAR - st.founded[r]) / RELIGION.slotYears));

function addTrait(st: ReligionState, r: number, t: number, level: number): boolean {
  for (let k = 0; k < SLOTS; k++) {
    if (st.traitId[r * SLOTS + k] === 0) {
      st.traitId[r * SLOTS + k] = t;
      st.traitLvl[r * SLOTS + k] = level;
      st.traitProg[r * SLOTS + k] = level === 1 ? RELIGION.newProgress : 40;
      st.stats.traitGain[t]++;
      return true;
    }
  }
  return false;
}

function pickTrait(st: ReligionState, r: number, allowed: (t: number) => boolean): number {
  let n = 0;
  for (let t = 1; t <= TRAIT_COUNT; t++) if (allowed(t) && !excluded(st, r, t)) n++;
  if (n === 0) return 0;
  let k = Math.floor(st.rng() * n);
  for (let t = 1; t <= TRAIT_COUNT; t++) {
    if (allowed(t) && !excluded(st, r, t)) {
      if (k === 0) return t;
      k--;
    }
  }
  return 0;
}

/** The event kind with the most events in the 10-year histogram `h` (offset), -1 if none; ties to the larger index (younger kinds). */
function topKind(h: Uint8Array, base: number, canUse: (kind: number) => boolean): number {
  let best = -1;
  let bestN = 0;
  for (let k = 0; k < NK; k++) {
    if (!canUse(k)) continue;
    let n = 0;
    for (let y = 0; y < 10; y++) n += h[base + k * 10 + y];
    if (n >= bestN && n > 0) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

/** Draws a trait for religion `r` from the events in histogram `h` at `base` (60 %) or at random. */
function drawTrait(st: ReligionState, r: number, h: Uint8Array, base: number, fromEvents: number): number {
  if (st.rng() < fromEvents) {
    const kind = topKind(h, base, (k) => {
      for (let t = 1; t <= TRAIT_COUNT; t++) if (TRAITS[t].src.includes(k) && !excluded(st, r, t)) return true;
      return false;
    });
    if (kind >= 0) {
      const t = pickTrait(st, r, (x) => TRAITS[x].src.includes(kind));
      if (t) return t;
    }
  }
  return pickTrait(st, r, () => true);
}

const strongestCulture = (sim: Simulation, civ: number): number => {
  const c = sim.civs[civ];
  let best = 0;
  if (!c) return Culture.Farming;
  for (let k = 1; k < c.culture.length; k++) if (c.culture[k] > c.culture[best]) best = k;
  return best;
};

/** Founds religion `r` (slot free) with the traits of the founding rule 4.5; `civ` = the founding people. */
function found(st: ReligionState, r: number, civ: number, parent: number, path: number): void {
  const sim = st.sim;
  st.alive[r] = 1;
  st.serial[r] = st.next++;
  st.founded[r] = year(sim);
  st.founderCiv[r] = civ;
  st.parent[r] = parent;
  st.parentSerial[r] = parent >= 0 ? st.serial[parent] : 0;
  st.traitId.fill(0, r * SLOTS, r * SLOTS + SLOTS);
  st.traitLvl.fill(0, r * SLOTS, r * SLOTS + SLOTS);
  st.traitProg.fill(0, r * SLOTS, r * SLOTS + SLOTS);
  st.tension[r] = 0;
  st.below[r] = 0;
  st.newClock[r] = year(sim);
  st.lastUprising[r] = year(sim);
  st.lastHoly[r] = -1000;
  st.mergeYears.fill(0, r * MAXR, r * MAXR + MAXR);
  for (let q = 0; q < MAXR; q++) st.mergeYears[q * MAXR + r] = 0;
  st.secFlag.fill(0, r * CIVS, r * CIVS + CIVS);
  st.evHist.fill(0, r * NK * 10, (r + 1) * NK * 10);
  st.yev.fill(0, r * NK, (r + 1) * NK);
  st.awakeStreak.fill(0, r * 3, r * 3 + 3);
  st.awakeDone.fill(0, r * 3, r * 3 + 3);
  st.lostOut[r] = 0;
  void path;
  if (parent >= 0) return;
  // First trait: the leader's attribute or the strongest culture, level 2.
  const hasAttr = (a: number) => {
    for (let k = 0; k < ATTR_SLOTS; k++) if (sim.leaders.attr[civ * ATTR_SLOTS + k] === a) return true;
    return false;
  };
  const forbidden = (t: number) => (hasAttr(2) && (t === 1 || t === 11)) || (hasAttr(1) && t === 2);
  let first = 0;
  if (st.rng() < RELIGION.firstFromAttr && sim.leaders.has[civ]) {
    first = pickTrait(st, r, (t) => TRAITS[t].attrs.some((a) => hasAttr(a)) && !forbidden(t));
  }
  if (!first) {
    const themes = CULTURE_THEMES[strongestCulture(sim, civ)] ?? [1];
    const theme = themes[Math.floor(st.rng() * themes.length)];
    first = pickTrait(st, r, (t) => TRAITS[t].theme === theme && !forbidden(t));
  }
  if (first) addTrait(st, r, first, 2);
  // Second: from the founding people's events (60 %) or at random, level 1.
  const second = drawTrait(st, r, st.civHist, civ * NK * 10, RELIGION.secondFromEvents);
  if (second && !forbidden(second)) addTrait(st, r, second, 1);
  else {
    const t = pickTrait(st, r, (x) => !forbidden(x));
    if (t) addTrait(st, r, t, 1);
  }
}

function freeSlot(st: ReligionState): number {
  for (let r = 0; r < MAXR; r++) if (!st.alive[r]) return r;
  return -1;
}

// ---------------------------------------------------------------------------
// R-levers, levers of the peoples, Creed, Heresy, Faith in trust

function computeRLevers(st: ReligionState): void {
  for (let r = 0; r < MAXR; r++) {
    st.rPull[r] = 1;
    st.rHold[r] = 1;
    st.rDev[r] = 0;
    st.rSup[r] = 0;
    st.rMerge[r] = 1;
    st.rSchism[r] = 1;
    if (!st.alive[r]) continue;
    for (let k = 0; k < SLOTS; k++) {
      const t = st.traitId[r * SLOTS + k];
      if (t === 0) continue;
      const d = TRAITS[t];
      const f = lf(st.traitLvl[r * SLOTS + k]) * RELIGION.effect;
      if (d.pull) st.rPull[r] *= Math.pow(d.pull, f);
      if (d.hold) st.rHold[r] *= Math.pow(d.hold, f);
      if (d.devotion) st.rDev[r] += d.devotion * f;
      if (d.suppress) st.rSup[r] += RELIGION.suppress * f;
      if (d.merge === 0) st.rMerge[r] = 0;
      else if (d.merge) st.rMerge[r] *= Math.pow(d.merge, f);
      if (d.schism) st.rSchism[r] *= Math.pow(d.schism, f);
    }
  }
}

const logs = new Float64Array(LEVERS);
const adds = new Float64Array(LEVERS);

function computeCivLevers(st: ReligionState): void {
  const sim = st.sim;
  const flat = RELIGION.flatTrust;
  for (let c = 1; c < sim.civSlots && c < CIVS; c++) {
    const o = c * LEVERS;
    logs.fill(0);
    adds.fill(0);
    let creed = 0;
    if (sim.civs[c]) {
      for (let r = 0; r < MAXR; r++) {
        const s = st.share[c * MAXR + r];
        if (s <= 0 || !st.alive[r]) continue;
        for (let k = 0; k < SLOTS; k++) {
          const t = st.traitId[r * SLOTS + k];
          if (t === 0) continue;
          const d = TRAITS[t];
          const f = lf(st.traitLvl[r * SLOTS + k]) * RELIGION.effect * s;
          creed += d.sat * f * RELIGION.creedScale;
          const g = f * RELIGION.leverScale;
          for (const [lever, v] of d.lev) {
            if (FAITH_MUTE[lever]) continue;
            if (LEVER_KIND[lever]) logs[lever] += g * Math.log(v);
            else adds[lever] += v * g * (lever === L.trust ? flat : 1);
          }
        }
      }
    }
    if (st.heresy[c] !== 0) logs[L.rebel] += Math.log(RELIGION.heresyRebel);
    for (let k = 0; k < LEVERS; k++) st.lev[o + k] = LEVER_KIND[k] ? Math.exp(logs[k]) : adds[k];
    st.creed[c] = Math.max(-RELIGION.creedCap, Math.min(RELIGION.creedCap, creed));
    combineLevers(sim, c);
  }
}

/** Heresy per people: its start value fading over heresyYears, scaled by the faith's traits (6.4). */
function computeHeresy(st: ReligionState): void {
  const sim = st.sim;
  const y = year(sim);
  for (let c = 1; c < CIVS; c++) {
    if (st.heresyYear[c] < 0 || !RELIGION.heresy || !sim.civs[c]) {
      st.heresy[c] = 0;
      continue;
    }
    const age = y - st.heresyYear[c];
    if (age >= RELIGION.heresyYears) {
      st.heresy[c] = 0;
      st.heresyYear[c] = -1;
      continue;
    }
    let factor = 1;
    for (let r = 0; r < MAXR; r++) {
      const s = st.share[c * MAXR + r];
      if (s <= 0 || !st.alive[r]) continue;
      for (let k = 0; k < SLOTS; k++) {
        const t = st.traitId[r * SLOTS + k];
        const base = t === 11 ? RELIGION.heresyInq : t === 13 ? RELIGION.heresyOpen : t === 16 ? RELIGION.heresySync : t === 1 ? RELIGION.heresyHoly : t === 12 ? RELIGION.heresyFlock : 1;
        if (base !== 1) factor *= Math.pow(base, s * lf(st.traitLvl[r * SLOTS + k]));
      }
    }
    st.heresy[c] = Math.max(RELIGION.heresyCap, RELIGION.heresyStart * factor * (1 - age / RELIGION.heresyYears));
  }
}

/** Faith in trust (6a): per known pair, a's view of b's religions. */
const kinOf = (st: ReligionState, r: number, s: number): boolean =>
  r !== s && ((st.parent[r] >= 0 && st.parentSerial[r] === st.serial[s] && st.alive[s] === 1) || (st.parent[s] >= 0 && st.parentSerial[s] === st.serial[r] && st.alive[r] === 1) || (st.parent[r] >= 0 && st.parentSerial[r] === st.parentSerial[s]));

const bondA = new Float64Array(CIVS);
const xenoA = new Float64Array(CIVS);
const kinA = new Float64Array(CIVS);

function computeTrust(st: ReligionState): void {
  const sim = st.sim;
  st.trust.fill(0);
  if (!RELIGION.faithTrust) return;
  const living: number[] = [];
  for (let c = 1; c < sim.civSlots && c < CIVS; c++) {
    if (!sim.civs[c]) continue;
    living.push(c);
    let bond = 1;
    let xeno = 1;
    let kin = 0;
    for (let r = 0; r < MAXR; r++) {
      const s = st.share[c * MAXR + r];
      if (s <= 0 || !st.alive[r]) continue;
      for (let k = 0; k < SLOTS; k++) {
        const t = st.traitId[r * SLOTS + k];
        if (t === 0) continue;
        const d = TRAITS[t];
        const f = lf(st.traitLvl[r * SLOTS + k]) * RELIGION.effect * s;
        if (d.bond) bond *= Math.pow(d.bond, f);
        if (d.xeno) xeno *= Math.pow(d.xeno, f);
        if (d.kin) kin += d.kin * f;
      }
    }
    bondA[c] = bond;
    xenoA[c] = xeno;
    kinA[c] = Math.max(RELIGION.kinMin, Math.min(RELIGION.kinMax, kin));
  }
  const known = sim.diplomacy.known;
  for (const a of living) {
    for (const b of living) {
      if (a === b || !known[a * PAIRS + b]) continue;
      let sum = 0;
      for (let r = 0; r < MAXR; r++) {
        const sa = st.share[a * MAXR + r];
        if (sa <= 0) continue;
        for (let s = 0; s < MAXR; s++) {
          const sb = st.share[b * MAXR + s];
          if (sb <= 0) continue;
          const w = r === s ? RELIGION.trustSame * bondA[a] : kinOf(st, r, s) ? kinA[a] : RELIGION.trustForeign * xenoA[a];
          sum += sa * sb * w;
        }
      }
      st.trust[a * PAIRS + b] = Math.max(RELIGION.trustMin, Math.min(RELIGION.trustMax, sum));
    }
  }
}

// ---------------------------------------------------------------------------
// Holy war and faith rebellion

function hasTraitShare(st: ReligionState, r: number, t1: number, t2: number): boolean {
  return hasTrait(st, r, t1) >= 0 || hasTrait(st, r, t2) >= 0;
}

function holyOk(st: ReligionState, a: number, b: number): number {
  const r = st.major[a];
  const q = st.major[b];
  if (!RELIGION.holyWar || r < 0 || q < 0 || r === q || !st.alive[r]) return -1;
  if (!RELIGION.holyAll && !hasTraitShare(st, r, 1, 11)) return -1;
  if (year(st.sim) - st.lastHoly[r] < RELIGION.holyCooldown) return -1;
  return r;
}

function holyRatio(sim: Simulation, a: number, b: number, base: number): number {
  const st = ACTIVE!;
  if (a >= CIVS || b >= CIVS) return base;
  return holyOk(st, a, b) >= 0 ? Math.min(base, RELIGION.holyRatio) : base;
}

function addEvent(st: ReligionState, civ: number, kind: number, n = 1): void {
  if (civ >= CIVS) return;
  st.civYear[civ * NK + kind] += n;
}

function warStarted(sim: Simulation, att: number, def: number, s: number): void {
  const st = ACTIVE!;
  st.stats.wars++;
  addEvent(st, att, K.War);
  addEvent(st, def, K.War);
  addEvent(st, att, K.Aggr);
  const r = holyOk(st, att, def);
  if (s < 64) {
    st.holyWar[s] = r >= 0 ? 1 : 0;
    st.holyAge[s] = 0;
  }
  if (r >= 0) {
    st.stats.holyWars++;
    st.lastHoly[r] = year(sim);
    const k = hasTrait(st, r, 1);
    if (k >= 0) st.traitProg[r * SLOTS + k] += 10;
  }
}

function joinSide(sim: Simulation, s: number, p: number): number {
  const st = ACTIVE!;
  const w = sim.war;
  if (p >= CIVS) return -1;
  const att = w.wAtt[s];
  const def = w.wDef[s];
  const dip = sim.diplomacy;
  const trust = (a: number, b: number) => dip.trust[a * PAIRS + b];
  if (w.wRebel[s] === 0) {
    if (st.holyWar[s] !== 1) return -1;
    const r = st.major[att];
    if (r >= 0 && st.major[p] === r && trust(p, att) >= RELIGION.joinTrust) {
      st.stats.holyJoins++;
      return 0;
    }
    return -1;
  }
  const daughter = st.rebelFaith[att] - 1;
  if (daughter < 0) return -1;
  const mother = st.rebelMother[att];
  const cap = sim.civs[p];
  if (!cap || p >= CIVS) return -1;
  const forRebels = st.share[p * MAXR + daughter] > RELIGION.joinShare && dip.known[p * PAIRS + def] === 1 && trust(p, def) >= RELIGION.joinTrust;
  const forMother = mother >= 0 && st.share[p * MAXR + mother] > RELIGION.joinShare && trust(p, att) >= RELIGION.joinTrust;
  if (forRebels === forMother) return -1;
  if (forMother) {
    st.stats.faithJoinsMother++;
    return 0;
  }
  const strength = sim.military.strength;
  let mine = 0;
  let theirs = 0;
  for (let q = 1; q <= dip.maxId; q++) {
    const side = w.side[s * PAIRS + q];
    if (side === 1) mine += strength[q] ?? 0;
    else if (side === 0) theirs += strength[q] ?? 0;
  }
  if (mine + (strength[p] ?? 0) <= theirs) return -1;
  st.stats.faithJoinsRebel++;
  return 1;
}

/** Called by the tool's uprising hook: a rebellion of `parent`'s settlements is declared; over faith when "Heresy" weighs worst. */
export function onUprising(sim: Simulation, cells: readonly number[], parent: number, labelOf: (cell: number) => string): boolean {
  const st = ACTIVE;
  if (st === null || parent >= CIVS) return false;
  let heresy = 0;
  for (const c of cells) if (labelOf(c) === 'Heresy') heresy++;
  if (heresy * 2 < cells.length || st.heresyYear[parent] < 0) return false;
  st.stats.faithRebellions++;
  st.rebelFaith[parent] = st.heresyDaughter[parent] + 1;
  st.rebelMother[parent] = st.heresyMother[parent];
  // A rebellion ends the link of the schism once (counted per schism).
  if (st.heresyAbs[parent] !== 0) {
    st.stats.schismRebels++;
    st.heresyAbs[parent] = 0;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The yearly step

function creditEvents(st: ReligionState): void {
  const sim = st.sim;
  const y = year(sim);
  const slot = y % 10;
  // Experiences of the leaders, rulers, foreign faith and pressure, per people.
  for (let c = 1; c < CIVS && c < sim.civSlots; c++) {
    const civ = sim.civs[c] ?? null;
    if (civ !== st.civObj[c]) {
      st.civObj[c] = civ;
      st.seenEv.fill(0, c * EVENTS, c * EVENTS + EVENTS);
      st.seenCounter[c] = 0;
      st.civHist.fill(0, c * NK * 10, (c + 1) * NK * 10);
      st.heresyYear[c] = -1;
      st.heresy[c] = 0;
      st.major[c] = -1;
      st.foundStreak[c] = 0;
      st.secFlag.forEach((_, i) => { if (i % CIVS === c) st.secFlag[i] = 0; });
      if (civ) {
        for (let k = 0; k < EVENTS; k++) st.seenEv[c * EVENTS + k] = sim.leaders.events[c * EVENTS + k];
        st.seenCounter[c] = sim.leaders.counter[c];
      }
    }
    if (!civ) continue;
    for (const [ek, kind] of LEADER_KIND) {
      const now = sim.leaders.events[c * EVENTS + ek];
      const d = now - st.seenEv[c * EVENTS + ek];
      st.seenEv[c * EVENTS + ek] = now;
      if (d > 0) addEvent(st, c, kind, d);
    }
    if (sim.leaders.counter[c] !== st.seenCounter[c]) {
      if (st.seenCounter[c] !== 0) addEvent(st, c, K.Succession);
      st.seenCounter[c] = sim.leaders.counter[c];
    }
    // Foreign faith of at least 20 % in the people.
    let top = 0;
    let other = 0;
    for (let r = 0; r < MAXR; r++) {
      const s = st.share[c * MAXR + r];
      if (s > top) {
        other = Math.max(other, top);
        top = s;
      } else if (s > other) other = s;
    }
    if (other >= 0.2) addEvent(st, c, K.Foreign);
  }
  // Per people history (10 years), then credited to the religions with >= eventShare in the people.
  for (let c = 1; c < CIVS; c++) {
    for (let k = 0; k < NK; k++) {
      const n = Math.min(255, st.civYear[c * NK + k]);
      st.civHist[(c * NK + k) * 10 + slot] = n;
    }
  }
  for (let r = 0; r < MAXR; r++) {
    for (let k = 0; k < NK; k++) st.evHist[(r * NK + k) * 10 + slot] = 0;
    st.yev.fill(0, r * NK, r * NK + NK);
  }
  for (let c = 1; c < CIVS; c++) {
    for (let r = 0; r < MAXR; r++) {
      if (!st.alive[r] || st.share[c * MAXR + r] < RELIGION.eventShare) continue;
      for (let k = 0; k < NK; k++) {
        const n = st.civYear[c * NK + k];
        if (n > 0) st.yev[r * NK + k] += n;
      }
    }
  }
  // Pressure: a religion that lost >= 5 % of its believers to others.
  for (let r = 0; r < MAXR; r++) {
    if (st.alive[r] && st.startTotal[r] > 0 && st.lostOut[r] >= 0.05 * st.startTotal[r]) st.yev[r * NK + K.Pressure]++;
    for (let k = 0; k < NK; k++) st.evHist[(r * NK + k) * 10 + slot] = Math.min(255, st.yev[r * NK + k]);
    if (st.yev[r * NK + K.Uprising] > 0) st.lastUprising[r] = y;
    st.lostOut[r] = 0;
  }
  st.civYear.fill(0);
}

function growTraits(st: ReligionState): void {
  const sim = st.sim;
  const y = year(sim);
  for (let r = 0; r < MAXR; r++) {
    if (!st.alive[r]) continue;
    const age = y - st.founded[r];
    for (let k = 0; k < SLOTS; k++) {
      const t = st.traitId[r * SLOTS + k];
      if (t === 0) continue;
      const d = TRAITS[t];
      let n = 0;
      for (const kind of d.src) n += st.yev[r * NK + kind];
      if (t === 21 && age > 40) n++;
      let delta = n > 0 ? Math.min(RELIGION.gainMax, n * RELIGION.gain) : RELIGION.idle;
      let opposed = false;
      if (d.counter >= 0) opposed = st.yev[r * NK + d.counter] > 0;
      else if (d.counter === -2) opposed = y - st.lastUprising[r] >= 20;
      if (opposed) delta += RELIGION.counter;
      const i = r * SLOTS + k;
      st.traitProg[i] += delta;
      if (st.traitProg[i] >= 100) {
        if (st.traitLvl[i] < 3) {
          st.traitLvl[i]++;
          st.traitProg[i] = 40;
          st.stats.levelUp++;
        } else st.traitProg[i] = 100;
      } else if (st.traitProg[i] < 0) {
        if (st.traitLvl[i] > 1) {
          st.traitLvl[i]--;
          st.traitProg[i] = 60;
          st.stats.levelDown++;
        } else {
          st.stats.traitLose[t]++;
          st.traitId[i] = 0;
          st.traitLvl[i] = 0;
          st.traitProg[i] = 0;
        }
      }
    }
    // A new trait every newEvery years.
    if (y - st.newClock[r] >= RELIGION.newEvery) {
      st.newClock[r] = y;
      if (traitCount(st, r) < slotsOf(st, r)) {
        const t = drawTrait(st, r, st.evHist, r * NK * 10, RELIGION.newFromEvents);
        if (t) addTrait(st, r, t, 1);
      } else {
        const kind = topKind(st.evHist, r * NK * 10, () => true);
        let n = 0;
        if (kind >= 0) for (let q = 0; q < 10; q++) n += st.evHist[(r * NK + kind) * 10 + q];
        if (kind >= 0 && n >= RELIGION.replaceEvents && st.rng() < RELIGION.replaceChance) {
          let weakest = -1;
          for (let k = 0; k < SLOTS; k++) {
            const i = r * SLOTS + k;
            if (st.traitId[i] !== 0 && st.traitLvl[i] === 1 && (weakest < 0 || st.traitProg[i] < st.traitProg[r * SLOTS + weakest])) weakest = k;
          }
          if (weakest >= 0) {
            const t = pickTrait(st, r, (x) => TRAITS[x].src.includes(kind));
            if (t) {
              st.stats.traitLose[st.traitId[r * SLOTS + weakest]]++;
              st.traitId[r * SLOTS + weakest] = 0;
              addTrait(st, r, t, 1);
              st.stats.traitReplace++;
            }
          }
        }
      }
    }
  }
}

function followHysteresis(st: ReligionState): void {
  for (let c = 1; c < CIVS; c++) {
    let m = st.major[c];
    if (m >= 0 && (!st.alive[m] || st.share[c * MAXR + m] < RELIGION.followEnd)) m = -1;
    for (let r = 0; r < MAXR; r++) if (r !== m && st.alive[r] && st.share[c * MAXR + r] >= RELIGION.followStart) m = r;
    st.major[c] = m;
  }
}

function setReligion(st: ReligionState, from: number, to: number, civ: number): number {
  const pop = st.sim.pop;
  const rel = FAITH.rel;
  let n = 0;
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i] || rel[i] !== from || (civ >= 0 && pop.civ[i] !== civ)) continue;
    rel[i] = to;
    n++;
  }
  return n;
}

function die(st: ReligionState, r: number): void {
  const sim = st.sim;
  setReligion(st, r, 255, -1);
  st.alive[r] = 0;
  st.stats.died++;
  st.stats.lifeSum += year(sim) - st.founded[r];
  // A daughter's heresy ends with it.
  for (let c = 1; c < CIVS; c++) if (st.heresyDaughter[c] === r) st.heresyYear[c] = -1;
}

function folkFaiths(st: ReligionState): void {
  const sim = st.sim;
  for (let c = 1; c < sim.civSlots && c < CIVS; c++) {
    if (!sim.civs[c]) continue;
    const pop = st.popC[c];
    if (pop >= RELIGION.foundMinPop && st.wav[c] >= RELIGION.foundShare * pop) st.foundStreak[c] = Math.min(255, st.foundStreak[c] + 1);
    else st.foundStreak[c] = 0;
    if (st.foundStreak[c] < RELIGION.foundYears || st.rng() >= RELIGION.foundChance) continue;
    if (st.wav[c] < RELIGION.minBelievers) continue;
    const r = freeSlot(st);
    if (r < 0) {
      st.stats.blockedFull++;
      continue;
    }
    // Everyone without a religion or wavering in this people takes it.
    const rel = FAITH.rel;
    const popArr = sim.pop;
    found(st, r, c, -1, 1);
    let n = 0;
    for (let i = 0; i < popArr.end; i++) {
      if (!popArr.alive[i] || popArr.civ[i] !== c) continue;
      if (rel[i] === 255 || popArr.faith[i] < BELIEVER_FAITH) {
        const old = rel[i];
        if (old !== 255 && old !== r) st.lostOut[old]++;
        rel[i] = r;
        popArr.faith[i] = RELIGION.foundFaith;
        n++;
      }
    }
    st.stats.folk++;
    st.foundStreak[c] = 0;
    void n;
    st.founderCiv[r] = c;
  }
}

/** Unique living peoples with >= schismBelievers believers of religion r. */
function peoplesOf(st: ReligionState, r: number, out: number[]): void {
  out.length = 0;
  for (let c = 1; c < CIVS; c++) if (st.cnt[c * MAXR + r] >= RELIGION.schismBelievers) out.push(c);
}

const tmp: number[] = [];
function schisms(st: ReligionState): void {
  const sim = st.sim;
  const y = year(sim);
  const w = sim.war;
  for (let r = 0; r < MAXR; r++) {
    if (!st.alive[r]) continue;
    peoplesOf(st, r, tmp);
    const peoples = tmp.slice();
    let inc = 0;
    for (let i = 0; i < peoples.length; i++) {
      for (let j = i + 1; j < peoples.length; j++) if (w.foe[peoples[i] * PAIRS + peoples[j]] > 0) inc += RELIGION.tensionWar;
      const c = peoples[i];
      if ((sim.civs[c]?.parentName ?? null) !== null && !st.secFlag[r * CIVS + c]) {
        st.secFlag[r * CIVS + c] = 1;
        inc += RELIGION.tensionSecession;
      }
    }
    // Different stories: the dominant event kind of each people over 10 years; every distinct kind beyond the first counts.
    if (peoples.length >= 2) {
      const kinds = new Set<number>();
      for (const c of peoples) {
        const k = topKind(st.civHist, c * NK * 10, (x) => x !== K.Foreign && x !== K.Aggr);
        if (k >= 0) kinds.add(k);
      }
      inc += Math.max(0, kinds.size - 1) * RELIGION.tensionStory;
    }
    if (peoples.length >= RELIGION.sizeFrom) inc += RELIGION.tensionSize;
    st.tension[r] = Math.max(0, Math.min(100, st.tension[r] + (inc > 0 ? inc : -RELIGION.tensionDecay)));
    if (r === 0 && st.tension[r] > st.stats.maxTension0) st.stats.maxTension0 = st.tension[r];
    if (peoples.length < RELIGION.schismPeoples) continue;
    const chance = Math.min(RELIGION.schismCap, (RELIGION.schismBase + Math.max(0, (st.tension[r] - 40) / 10) * RELIGION.schismPer10) * st.rSchism[r]);
    if (st.rng() >= chance) continue;
    const slot = freeSlot(st);
    if (slot < 0) {
      st.stats.blockedFull++;
      continue;
    }
    // The people with the weakest tie to the majority: at war with its people, else seceded, else the smallest.
    let majorCiv = peoples[0];
    for (const c of peoples) if (st.cnt[c * MAXR + r] > st.cnt[majorCiv * MAXR + r]) majorCiv = c;
    let pick = -1;
    for (const c of peoples) if (c !== majorCiv && w.foe[c * PAIRS + majorCiv] > 0 && (pick < 0 || st.cnt[c * MAXR + r] < st.cnt[pick * MAXR + r])) pick = c;
    if (pick < 0) for (const c of peoples) if (c !== majorCiv && st.secFlag[r * CIVS + c] && (pick < 0 || st.cnt[c * MAXR + r] < st.cnt[pick * MAXR + r])) pick = c;
    if (pick < 0) for (const c of peoples) if (c !== majorCiv && (pick < 0 || st.cnt[c * MAXR + r] < st.cnt[pick * MAXR + r])) pick = c;
    if (pick < 0) continue;
    if (RELIGION.schismMinSettlements > 1) {
      let n = 0;
      for (let c = 0; c < sim.world.cellCount; c++) if (sim.world.owner[c] === pick && sim.cellPop[c] > 0) n++;
      if (n < RELIGION.schismMinSettlements) continue;
    }
    splitOff(st, r, slot, pick);
    st.tension[r] = 0;
    st.stats.schism++;
    if (r === 0) st.stats.schismsOf0++;
    void y;
  }
}

function splitOff(st: ReligionState, r: number, slot: number, civ: number): void {
  const sim = st.sim;
  const y = year(sim);
  setReligion(st, r, slot, civ);
  found(st, slot, civ, r, 2);
  // The mother's traits, one swapped: the weakest falls, one from the people's events (level 1).
  for (let k = 0; k < SLOTS; k++) {
    st.traitId[slot * SLOTS + k] = st.traitId[r * SLOTS + k];
    st.traitLvl[slot * SLOTS + k] = st.traitLvl[r * SLOTS + k];
    st.traitProg[slot * SLOTS + k] = st.traitProg[r * SLOTS + k];
  }
  let weakest = -1;
  for (let k = 0; k < SLOTS; k++) {
    const i = slot * SLOTS + k;
    if (st.traitId[i] === 0) continue;
    if (weakest < 0 || st.traitLvl[i] < st.traitLvl[slot * SLOTS + weakest] || (st.traitLvl[i] === st.traitLvl[slot * SLOTS + weakest] && st.traitProg[i] < st.traitProg[slot * SLOTS + weakest])) weakest = k;
  }
  if (weakest >= 0 && traitCount(st, slot) > 1) {
    st.stats.traitLose[st.traitId[slot * SLOTS + weakest]]++;
    st.traitId[slot * SLOTS + weakest] = 0;
    st.traitLvl[slot * SLOTS + weakest] = 0;
  }
  const t = drawTrait(st, slot, st.civHist, civ * NK * 10, RELIGION.secondFromEvents);
  if (t) addTrait(st, slot, t, 1);
  // Heresy in the founding people (a new split renews it).
  st.heresyYear[civ] = y;
  st.heresyDaughter[civ] = slot;
  st.heresyMother[civ] = r;
  st.heresyAbs[civ] = 1;
  let settlements = 0;
  for (let c = 0; c < sim.world.cellCount; c++) if (sim.world.owner[c] === civ && sim.cellPop[c] > 0) settlements++;
  st.stats.schismSettlements += settlements;
  if (settlements >= 2) st.stats.schismMulti++;
  st.stats.heresyStarts++;
  if (r === 0) st.stats.tensionAtSchism0 += st.tension[0];
}

function merges(st: ReligionState): void {
  const sim = st.sim;
  const w = sim.war;
  for (let a = 0; a < MAXR; a++) {
    if (!st.alive[a]) continue;
    for (let b = a + 1; b < MAXR; b++) {
      if (!st.alive[b]) continue;
      let both = false;
      for (let c = 1; c < CIVS && !both; c++) both = st.share[c * MAXR + a] >= RELIGION.mergeShare && st.share[c * MAXR + b] >= RELIGION.mergeShare;
      const k = a * MAXR + b;
      st.mergeYears[k] = both ? Math.min(255, st.mergeYears[k] + 1) : 0;
      if (!both || st.mergeYears[k] < RELIGION.mergeYears) continue;
      const m = st.rMerge[a] * st.rMerge[b];
      if (m <= 0 || st.rng() >= RELIGION.mergeChance * m) continue;
      // Not between religions whose peoples are at war.
      let war = false;
      for (let c = 1; c < CIVS && !war; c++) {
        if (st.cnt[c * MAXR + a] < RELIGION.schismBelievers) continue;
        for (let d = 1; d < CIVS && !war; d++) if (d !== c && st.cnt[d * MAXR + b] >= RELIGION.schismBelievers && w.foe[c * PAIRS + d] > 0) war = true;
      }
      if (war) continue;
      let keep = st.total[a] >= st.total[b] ? a : b;
      if (b === 0) keep = 0;
      if (a === 0) keep = 0;
      const lose = keep === a ? b : a;
      // The larger keeps its traits and takes one of the smaller's (level 1, no exclusions broken, a free slot).
      const free = traitCount(st, keep) < RELIGION.slotsMax + 2 && traitCount(st, keep) < SLOTS;
      if (free) {
        const t = pickTrait(st, keep, (x) => hasTrait(st, lose, x) >= 0);
        if (t) addTrait(st, keep, t, 1);
      }
      const ss = hasTrait(st, keep, 16);
      if (ss >= 0) st.traitProg[keep * SLOTS + ss] += 10;
      // Heresy ends when a daughter merges with its mother.
      for (let c = 1; c < CIVS; c++) if ((st.heresyDaughter[c] === lose && st.heresyMother[c] === keep) || (st.heresyDaughter[c] === keep && st.heresyMother[c] === lose)) st.heresyYear[c] = -1;
      setReligion(st, lose, keep, -1);
      st.alive[lose] = 0;
      st.stats.merged++;
      st.stats.lifeSum += year(sim) - st.founded[lose];
      if (keep === 0 || lose === 0) st.stats.merge0++;
      st.mergeYears[a * MAXR + b] = 0;
      for (let q = 0; q < MAXR; q++) {
        st.mergeYears[lose * MAXR + q] = 0;
        st.mergeYears[q * MAXR + lose] = 0;
      }
      for (let c = 1; c < CIVS; c++) if (st.heresyDaughter[c] === lose) st.heresyDaughter[c] = keep;
      return;
    }
  }
}

function deaths(st: ReligionState): void {
  const sim = st.sim;
  const y = year(sim);
  const world = sim.pop.count;
  for (let r = 1; r < MAXR; r++) {
    if (!st.alive[r] || y - st.founded[r] < RELIGION.grace) continue;
    if (st.total[r] < RELIGION.deathMin || st.total[r] < RELIGION.deathShare * world) st.below[r]++;
    else st.below[r] = 0;
    if (st.below[r] >= RELIGION.deathYears) die(st, r);
  }
}

/** The yearly religion step; call after every year's last tick (`sim.tick % TICKS_PER_YEAR === 0`). */
export function religionYear(sim: Simulation): void {
  const st = ACTIVE;
  if (st === null || st.sim !== sim) return;
  const y = year(sim);
  st.year = y;
  const s = st.stats;
  countAll(st);
  for (let r = 0; r < MAXR; r++) st.startTotal[r] = st.total[r];
  followHysteresis(st);
  creditEvents(st);
  growTraits(st);
  computeRLevers(st);
  deaths(st);
  folkFaiths(st);
  countAll(st);
  followHysteresis(st);
  schisms(st);
  countAll(st);
  followHysteresis(st);
  merges(st);
  countAll(st);
  followHysteresis(st);
  // War ages (holy wars; the longest war of all).
  const w = sim.war;
  for (let k = 0; k < 24; k++) {
    if (!w.wLive[k]) {
      if (st.holyWar[k] === 1) {
        s.holyEnded++;
        s.holyYears += st.holyAge[k];
        s.holyLongest = Math.max(s.holyLongest, st.holyAge[k]);
        st.holyWar[k] = 0;
      }
      continue;
    }
    st.holyAge[k]++;
    const age = (sim.tick - w.wStart[k]) / TICKS_PER_YEAR;
    if (age > s.maxWarAge) s.maxWarAge = age;
  }
  st.rebelFaith.fill(0);
  computeRLevers(st);
  computeHeresy(st);
  computeCivLevers(st);
  computeTrust(st);
  // Statistics.
  let alive = 0;
  let aliveNoGod = 0;
  for (let r = 0; r < MAXR; r++) {
    if (!st.alive[r]) continue;
    alive++;
    if (r === 0) continue;
    aliveNoGod++;
    const lim = [100, 150, 300];
    for (let k = 0; k < 3; k++) {
      st.awakeStreak[r * 3 + k] = st.total[r] >= lim[k] ? st.awakeStreak[r * 3 + k] + 1 : 0;
      if (st.awakeStreak[r * 3 + k] >= 15 && !st.awakeDone[r * 3 + k]) {
        st.awakeDone[r * 3 + k] = 1;
        if (k === 0) s.awake100++;
        else if (k === 1) s.awake150++;
        else s.awake300++;
      }
    }
  }
  void aliveNoGod;
  s.years++;
  s.aliveSum += alive;
  if (alive >= MAXR) s.yearsFull++;
  if (alive >= MAXR && s.reachedFull === 0) s.reachedFull = 1;
  if (y % 10 === 0) st.history.push({ year: y, alive, believers0: st.total[0] });
}

/** Number of living religions. */
export function aliveCount(st: ReligionState): number {
  let n = 0;
  for (let r = 0; r < MAXR; r++) n += st.alive[r];
  return n;
}

export { KIND_NAMES, SLOTS, CIVS };

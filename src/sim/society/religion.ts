import { DIRECTION_COUNT, hexDistance } from '../hex';
import { createRng, deriveSeed, type Rng } from '../rng';
import type { World } from '../world/world';
import { Culture } from './culture';
import { PAIRS } from './diplomacy';
import { ATTR_SLOTS, EVENTS, Ev, L, LEADER_CIVS, LEVERS, LEVER_KIND, combineLevers } from './leaders';
import { record, type Simulation } from './simulation';

// Religion, step 1 ("Design Documents/Requirement Religion.md", frozen set "ab"): up to 16 religions as objects
// with traits (24 in 8 themes, levels 1-3), one religion per inhabitant (`pop.religion`, its faith `pop.faith`),
// folk faiths, schism in one settlement and its contagion (6.1, 6.1a), merging, death, spread and conversion,
// the third lever layer "Glaube" (combined in combineLevers), the satisfaction part "Creed", the trust part
// "Faith" (6a), holy war (6b) and the leader's faith (Requirement Anführer 6a; the state faith).
//
// Running cost: the yearly step (simulation.ts: RELIGION_WEEK) runs in RELIGION_STEPS parts of a tick, each a
// pass over the inhabitants (counting) plus small loops over religions, peoples and settled hexes; the weekly
// faith step of an inhabitant (faithStep) is a few operations over the 16 religions. All state is flat typed
// arrays in `sim.religion` (saved with the game); random numbers only from its own sequence "faith".

/** The numbers of the frozen set "ab" (Requirement Religion sections 2-7, 6a, 6b). */
export const RELIGION = {
  /** Folk faith: a people of >= foundMinPop with >= foundShare unaffiliated or wavering, foundYears in a row, foundChance a year; they take it at foundFaith. */
  foundMinPop: 100,
  foundShare: 0.3,
  foundYears: 5,
  foundChance: 0.05,
  foundFaith: 0.6,
  /** Believers a founding needs; death below deathMin believers or deathShare of the world's people deathYears in a row, after `grace` years. */
  minBelievers: 20,
  deathMin: 20,
  deathShare: 0.005,
  deathYears: 2,
  grace: 5,
  /** A people follows a religion from followStart of its people, and stops below followEnd. */
  followStart: 0.55,
  followEnd: 0.45,
  /** Yearly pull of the faith to the hex's faith of the religion; pressure needed to convert, faith taken, faith below which the religion is lost; fading per year. */
  pull: 0.1,
  convert: 0.2,
  convertFaith: 0.5,
  lose: 0.2,
  fading: 0.005,
  /** Inquisition: faith other religions lose a year in a people that follows it (level 2). */
  suppress: 0.03,
  /** Devotion of a followed religion's believers: culture Devout x this. */
  devout: 0.02,
  /** Trait slots: at founding, years per extra slot, natural maximum (the god gives up to SLOTS). */
  slotsBase: 2,
  slotYears: 20,
  slotsMax: 5,
  /** Level factors (1..3) on a trait's deviation. */
  level1: 0.5,
  level2: 1,
  level3: 1.5,
  /** Progress per event (at most gainMax a year), per year without one, per opposing event; a new trait's progress. */
  gain: 10,
  gainMax: 25,
  idle: -0.5,
  counter: -4,
  newProgress: 60,
  /** A new trait every newEvery years: from events with newFromEvents, a full religion replaces its weakest level-1 trait with replaceChance when a kind had >= replaceEvents events in 10 years. */
  newEvery: 10,
  newFromEvents: 0.6,
  replaceChance: 0.5,
  replaceEvents: 10,
  /** Founding: the first trait from the leader's attribute with firstFromAttr (else the culture), the second from events with secondFromEvents. */
  firstFromAttr: 0.5,
  secondFromEvents: 0.6,
  /** A people's events count for every religion with at least this share of it. */
  eventShare: 0.25,
  /**
   * New settlements in a year from which they count as events (one per settlement). The requirement's text (4.5)
   * says "ab 2 im Jahr"; the simulated set "ab" counted every new settlement (1): its numbers hold with 1.
   */
  settledFrom: 1,
  /**
   * Scale of the halved traits' (Divine Mandate, Alms and Mercy, Sacred Tithe, Ancestral Wisdom) satisfaction part.
   * The requirement's table (4.2) shows it halved (0.5); the simulated set "ab" halved only their levers (1).
   */
  halfCreed: 1,
  /** Tension: per war pair, once per seceded people, per extra distinct story, per year from sizeFrom peoples; decay; schism chance base + per 10 over 40, cap; peoples needed with schismBelievers. */
  tensionWar: 5,
  tensionSecession: 10,
  tensionStory: 2,
  tensionSize: 1,
  sizeFrom: 4,
  tensionDecay: 3,
  tense: 70,
  schismBase: 0.005,
  schismPer10: 0.01,
  schismCap: 0.15,
  schismPeoples: 2,
  schismBelievers: 20,
  /** Schism in one settlement (6.1): >= seedMin believers of the mother, seedShare of them take the daughter; mother's tension drop; young daughters per mother; years young; daughters' grace; years only "< 20 believers" counts; merge ban. */
  seedMin: 40,
  seedShare: 0.5,
  tensionDrop: 30,
  maxYoung: 2,
  youngYears: 30,
  daughterGrace: 15,
  daughterNoWorld: 40,
  mergeBan: 30,
  /** A young daughter's hold factor (her believers don't fade during daughterGrace). */
  youngHold: 2,
  /** Contagion 6.1a: kappa, radius in hexes, share of a source, share below which the daughter vanishes in a settlement. */
  kappa: 0.1,
  contRadius: 8,
  contSrc: 0.1,
  contVanish: 0.05,
  /** Merge: both with mergeShare in one people mergeYears in a row, chance per year. */
  mergeShare: 0.25,
  mergeYears: 10,
  mergeChance: 0.03,
  /** Cap of the satisfaction part "Creed" (+-). */
  creedCap: 8,
  /** Scale on the trade and build levers of the traits (merchant load, trip range, agreement amount, losses, toll asked, build cost and time). */
  tradeScale: 0.5,
  /** Faith in trust (6a): same religion, foreign religion, caps of the part and of `kin`. */
  trustSame: 4,
  trustForeign: -8,
  trustMin: -16,
  trustMax: 12,
  kinMin: -16,
  kinMax: 8,
  /** Holy war (6b): strength ratio, years between two of a religion, trust to join, give-up shift; conquest: faith lost, pull of the conqueror's faith, years. */
  holyRatio: 1.5,
  holyCooldown: 30,
  joinTrust: 40,
  holyGiveUp: -0.1,
  conquestFaith: -0.3,
  conquestPull: 0.15,
  conquestYears: 10,
  /** Share of a people's population that holds the faith for a faith rebellion's joins (6.4a). */
  joinShare: 0.5,
  /** Traders carry faith: pressure per trade leg and year at the partner's capital, x the religion's carry. */
  carryVisit: 0.05,
  /** Omen Readers: faith gained at a disaster (level 2). */
  omen: 0.05,
};

export const MAXR = 16;
/** Trait slots per religion (natural 5, the god up to 7). */
export const SLOTS = 7;
const CIVS = LEADER_CIVS;
const NK = 14;
/** Event kinds (K). */
export const EVENT_KINDS = NK;
const TICKS_PER_YEAR = 52;
/** Faith from which an inhabitant counts as a believer (simulation.ts BELIEVER_FAITH). */
const BELIEVER = 0.5;
export const NO_RELIGION = 255;
/** Steps of the yearly religion update (one part of a tick each). */
export const RELIGION_STEPS = 5;

/** Event kinds (Requirement 4.5; Aggr = declared a war). */
export const K = { War: 0, WarWon: 1, WarLost: 2, Uprising: 3, Hardship: 4, Trade: 5, Pact: 6, Settled: 7, Peace: 8, Disaster: 9, Foreign: 10, Pressure: 11, Succession: 12, Aggr: 13 } as const;
export const KIND_NAMES = ['war', 'war won', 'war lost', 'uprising', 'hardship', 'trade', 'pact', 'new settlements', 'peace', 'disaster', 'foreign faith', 'pressure', 'succession', 'declared war'] as const;
/** Experience counters of the leaders that map onto event kinds. */
const LEADER_KIND: readonly (readonly [number, number])[] = [[Ev.WarWon, K.WarWon], [Ev.WarLost, K.WarLost], [Ev.Uprising, K.Uprising], [Ev.Hardship, K.Hardship], [Ev.Trade, K.Trade], [Ev.Pact, K.Pact], [Ev.Settled, K.Settled], [Ev.Peace, K.Peace]];

type Eff = readonly [lever: number, value: number];
export type TraitDef = {
  name: string;
  theme: number;
  /** Lever effects at level 2 (additive: the deviation; multiplicative: the factor). */
  lev: readonly Eff[];
  /** Satisfaction deviation (part "Creed"). */
  sat: number;
  /** "Wirkung halbiert" (Requirement 4.2): levers and satisfaction at half the deviation. */
  half?: boolean;
  /** R-levers of the religion itself: pull, hold, carry, merge, schism (factors), devotion (add), suppress (1 = RELIGION.suppress). */
  pull?: number;
  hold?: number;
  carry?: number;
  devotion?: number;
  suppress?: number;
  merge?: number;
  schism?: number;
  /** Faith in trust (6a): bond factor, kin shift, xeno factor; Heresy factor in the loyalty (Mandat 8). */
  bond?: number;
  kin?: number;
  xeno?: number;
  heresy?: number;
  /** Event kinds that feed it; the kind that harms it (-1 none, -2 Divine Mandate's 20 years without an uprising). */
  src: readonly number[];
  counter: number;
  /** Leader attributes of a founder that bring it. */
  attrs: readonly number[];
  /** One line about it for the panel. */
  about: string;
};
export const THEMES = ['War', 'Fertility', 'Order', 'Mission', 'Openness', 'Asceticism', 'Ancestors', 'Sea & Wandering'] as const;

/** Trait ids (index into TRAITS, 1..24). Stored per religion: append only. */
export const Trait = {
  HolyWar: 1,
  Peacemakers: 2,
  MartyrsCreed: 3,
  FertilityRites: 4,
  HarvestCovenant: 5,
  HearthBlessing: 6,
  DivineMandate: 7,
  AlmsAndMercy: 8,
  SacredTithe: 9,
  MissionaryZeal: 10,
  Inquisition: 11,
  SteadfastFlock: 12,
  OpenGates: 13,
  PilgrimRoads: 14,
  SyncreticSpirit: 15,
  AsceticVows: 16,
  TempleSplendor: 17,
  StoicEndurance: 18,
  AncestorVeneration: 19,
  SpiritGuardians: 20,
  AncestralWisdom: 21,
  SeaGods: 22,
  WayfarersFaith: 23,
  OmenReaders: 24,
} as const;
export const TRAIT_COUNT = 24;

/** The pool (Requirement 4.2), effects at level 2. */
export const TRAITS: readonly TraitDef[] = [
  { name: '', theme: 0, lev: [], sat: 0, src: [], counter: -1, attrs: [], about: '' },
  { name: 'Holy War', theme: 0, lev: [[L.warChance, 0.1], [L.strength, 1.1]], sat: -1, bond: 1.2, kin: -10, xeno: 1.5, heresy: 1.3, src: [K.War, K.WarWon, K.Foreign], counter: K.Peace, attrs: [1], about: 'Wars for the faith; may declare holy wars.' },
  { name: 'Peacemakers', theme: 0, lev: [[L.warChanceMul, 0.6], [L.openTrust, -5]], sat: 1, kin: 3, xeno: 0.7, src: [K.Peace], counter: K.Aggr, attrs: [2], about: 'Seeks peace and opens borders early.' },
  { name: "Martyrs' Creed", theme: 0, lev: [[L.lossTaken, 0.8], [L.giveUp, -0.1], [L.sold, 0.9], [L.exhaust, 2]], sat: 0, src: [K.WarLost], counter: K.Peace, attrs: [4], about: 'Fights on against the odds.' },
  { name: 'Fertility Rites', theme: 1, lev: [[L.birth, 1.08]], sat: 1, src: [K.Peace, K.Settled], counter: K.Hardship, attrs: [], about: 'Blesses many children.' },
  { name: 'Harvest Covenant', theme: 1, lev: [[L.food, 1.08]], sat: 0, src: [K.Hardship], counter: K.Hardship, attrs: [], about: 'Richer harvests.' },
  { name: 'Hearth Blessing', theme: 1, lev: [[L.travel, 1.2], [L.birth, 1.03]], sat: 2, src: [K.Hardship, K.Peace], counter: -1, attrs: [19], about: 'Keeps families at home.' },
  { name: 'Divine Mandate', theme: 2, lev: [[L.rebel, 1.4], [L.income, 0.05]], sat: -1, half: true, src: [K.Uprising], counter: -2, attrs: [21, 22], about: 'The ruler is chosen by the gods.' },
  { name: 'Alms and Mercy', theme: 2, lev: [[L.margin, 5]], sat: 3, half: true, src: [K.Hardship, K.Peace], counter: -1, attrs: [13, 20], about: 'Cares for the poor; mild taxes.' },
  { name: 'Sacred Tithe', theme: 2, lev: [[L.income, 0.1]], sat: -2, half: true, src: [K.Trade], counter: K.Hardship, attrs: [14], about: 'The temple takes its share.' },
  { name: 'Missionary Zeal', theme: 3, lev: [[L.warChance, 0.03]], sat: 0, pull: 1.5, carry: 2, src: [K.Settled, K.Trade, K.Pact, K.WarWon], counter: K.Pressure, attrs: [24], about: 'Spreads the faith; may declare holy wars.' },
  { name: 'Inquisition', theme: 3, lev: [[L.rebel, 1.2], [L.tollAsk, 1.5]], sat: -3, suppress: 1, merge: 0, schism: 0.7, kin: -14, xeno: 1.5, heresy: 0.5, src: [K.Uprising, K.Foreign, K.War], counter: -1, attrs: [22], about: 'Persecutes other faiths.' },
  { name: 'Steadfast Flock', theme: 3, lev: [[L.closeTrust, 5]], sat: 1, hold: 1.6, merge: 0, schism: 0.7, bond: 1.3, kin: -6, xeno: 1.3, heresy: 1.2, src: [K.Pressure], counter: -1, attrs: [8], about: 'Keeps the faith against all others.' },
  { name: 'Open Gates', theme: 4, lev: [[L.openTrust, -5]], sat: 1, hold: 0.8, kin: 3, xeno: 0.5, heresy: 0.5, src: [K.Trade, K.Pact, K.Peace], counter: K.Pressure, attrs: [7], about: 'Welcomes strangers and their gods.' },
  { name: 'Pilgrim Roads', theme: 4, lev: [[L.load, 1.15], [L.tripRange, 1.15], [L.dealAmount, 1.2]], sat: 0, carry: 1.5, kin: 1, xeno: 0.8, src: [K.Trade], counter: -1, attrs: [12], about: 'Pilgrims and merchants travel far.' },
  { name: 'Syncretic Spirit', theme: 4, lev: [], sat: 1, merge: 3, schism: 0.5, kin: 6, xeno: 0.5, heresy: 0.5, src: [K.Foreign], counter: -1, attrs: [], about: 'Takes in other faiths.' },
  { name: 'Ascetic Vows', theme: 5, lev: [[L.upkeepAll, 0.85], [L.reserve, 1.5], [L.birth, 0.95]], sat: -1, devotion: 0.01, src: [K.Hardship], counter: -1, attrs: [16], about: 'Lives frugally and devoutly.' },
  { name: 'Temple Splendor', theme: 5, lev: [[L.upkeepAll, 1.1], [L.capitalFirst, 1]], sat: 3, devotion: 0.01, src: [K.Trade], counter: K.Hardship, attrs: [15], about: 'Builds great temples in the capital.' },
  { name: 'Stoic Endurance', theme: 5, lev: [[L.exhaust, 3], [L.rebel, 1.2]], sat: 0, src: [K.Hardship, K.WarLost], counter: -1, attrs: [], about: 'Bears hardship and long wars.' },
  { name: 'Ancestor Veneration', theme: 6, lev: [[L.inherit, 0.3]], sat: 2, hold: 1.3, schism: 0.8, src: [K.Succession, K.Peace], counter: -1, attrs: [], about: 'Honors the ancestors and their ways.' },
  { name: 'Spirit Guardians', theme: 6, lev: [[L.defExtra, 0.2], [L.strength, 1.05]], sat: 1, src: [K.WarLost], counter: -1, attrs: [], about: 'The spirits guard the homeland.' },
  { name: 'Ancestral Wisdom', theme: 6, lev: [[L.buildCost, 0.9], [L.buildTime, 0.9]], sat: 0, half: true, src: [K.Succession, K.Peace], counter: -1, attrs: [], about: 'Builds the way the elders did.' },
  { name: 'Sea Gods', theme: 7, lev: [[L.tripRange, 1.15], [L.lossTrade, 0.7]], sat: 0, src: [K.Trade], counter: -1, attrs: [], about: 'The sea carries its merchants.' },
  { name: "Wayfarers' Faith", theme: 7, lev: [[L.settleOver, 0.97], [L.travel, 0.85]], sat: -1, carry: 1.5, src: [K.Settled], counter: -1, attrs: [18], about: 'Always on the move.' },
  { name: 'Omen Readers', theme: 7, lev: [], sat: 2, src: [K.Disaster], counter: -1, attrs: [], about: 'Reads the will of the gods in disasters.' },
];

/** Exclusion pairs (Requirement 4.3). */
const EXCLUDE: readonly (readonly [number, number])[] = [[1, 2], [2, 3], [4, 16], [6, 23], [8, 9], [10, 12], [11, 13], [11, 15], [12, 13], [16, 17]];
const excludes = new Uint8Array(25 * 25);
for (const [a, b] of EXCLUDE) {
  excludes[a * 25 + b] = 1;
  excludes[b * 25 + a] = 1;
}
/** Levers the trade scale halves. */
const TRADE_LEVERS = new Uint8Array(LEVERS);
for (const k of [L.load, L.tripRange, L.dealAmount, L.lossTrade, L.tollAsk, L.buildCost, L.buildTime]) TRADE_LEVERS[k] = 1;
/** Themes a culture brings (index Culture). */
const CULTURE_THEMES: readonly (readonly number[])[] = [[7], [0], [1], [7], [3, 5]];
/** Kinds of trait source per trait: bit mask over K (for the draws). */
const SRC_MASK = new Int32Array(25);
for (let t = 1; t <= TRAIT_COUNT; t++) for (const k of TRAITS[t].src) SRC_MASK[t] |= 1 << k;

export type ReligionStats = {
  start: number;
  folk: number;
  schism: number;
  spark: number;
  merged: number;
  died: number;
  blockedFull: number;
  lifeSum: number;
  levelUp: number;
  levelDown: number;
  traitReplace: number;
  traitGain: Int32Array;
  traitLose: Int32Array;
  schismsOf0: number;
  maxTension0: number;
  /** Daughters seeded (believers), ended (died / merged), won by succession / conversion / rebellion. */
  seeded: number;
  dDied: number;
  dMerged: number;
  dWon: Int32Array;
  /** Faith rebellions (independence over faith) and the daughters that led to one (independence / vassal). */
  faithRebellions: number;
  schismRebels: number;
  schismVassals: number;
  faithJoinsRebel: number;
  faithJoinsMother: number;
  wars: number;
  holyWars: number;
  holyJoins: number;
  holyLost: number;
  conquests: number;
  carryVisits: number;
  disasters: number;
  yearsFull: number;
  stateSucc: number;
  stateConv: number;
  stateDeath: number;
  stateToDaughter: number;
};

export type Religions = {
  rng: Rng;
  /** 1 = the religions act on the peoples (levers, Creed, Faith in trust, holy war); 0 only in test fixtures of the base rules (dismissFaithLayer). */
  enabled: number;
  /** 1 for a living religion (slots 0..15; 0 = the player's). */
  alive: Uint8Array;
  /** A number per founding (kin relations survive reused slots), the next one. */
  serial: Int32Array;
  next: number;
  name: string[];
  /** Names used so far and how often ("Faith of the X", "... II"). */
  names: Map<string, number>;
  founded: Int32Array;
  founderCiv: Int16Array;
  /** Mother religion (-1 none) and its serial. */
  parent: Int16Array;
  parentSerial: Int32Array;
  /** Traits: religion * SLOTS + slot: id (0 empty), level 1..3, progress 0..100, year it came, 1 if given by the god. */
  traitId: Uint8Array;
  traitLvl: Uint8Array;
  traitProg: Float32Array;
  traitBorn: Int32Array;
  traitGod: Uint8Array;
  tension: Float32Array;
  /** 1 while the player's religion is "Tense" (the warning came). */
  tenseWarned: Uint8Array;
  newClock: Int32Array;
  /** Believers per religion, years in a row below the death line, last uprising, last holy war. */
  total: Int32Array;
  below: Uint8Array;
  lastUprising: Int32Array;
  lastHoly: Int32Array;
  mergeYears: Uint8Array;
  /** 1 once a seceded people counted for a religion's tension: religion * CIVS + people. */
  secFlag: Uint8Array;
  /** Event histograms: religion x kind x 10 years, the year's counts; per people the same. */
  evHist: Uint8Array;
  yev: Int16Array;
  civHist: Uint8Array;
  civYear: Int16Array;
  /** Believers lost to other religions this year, believers at the year's start. */
  lostOut: Int32Array;
  startTotal: Int32Array;
  /** Believers per (people, religion), people, unaffiliated or wavering per people, share per (people, religion). */
  cnt: Int32Array;
  popC: Int32Array;
  wav: Int32Array;
  share: Float32Array;
  /** The religion a people follows (-1 none), years in a row a folk faith could be founded. */
  major: Int16Array;
  foundStreak: Uint8Array;
  /** Holy war conquest: the conqueror's religion presses on the hex until the year (bonusRel 255 = none). */
  bonusUntil: Int32Array;
  bonusRel: Uint8Array;
  /** R-levers per religion. */
  rPull: Float32Array;
  rHold: Float32Array;
  rCarry: Float32Array;
  rDev: Float32Array;
  rSup: Float32Array;
  rMerge: Float32Array;
  rSchism: Float32Array;
  /** Omen Readers' level factor (0 = none). */
  rOmen: Float32Array;
  /** Last counts of the leaders' experiences and rulers, per people. */
  seenEv: Int32Array;
  seenCounter: Int32Array;
  /** Per hex x religion: mean faith of the religion's inhabitants over the hex's people, pressure, believers. */
  cellFs: Float32Array;
  press: Float32Array;
  cellBel: Float32Array;
  /** The lever layer "Glaube" (people x LEVERS), Creed per people, Faith in trust per pair (a * PAIRS + b). */
  lev: Float32Array;
  creed: Float32Array;
  trust: Float32Array;
  /** Per war slot: 1 for a holy war, the attacker's religion. */
  holyWar: Uint8Array;
  holyRel: Int16Array;
  /** Per war slot: daughter religion + 1 of a rebellion over faith (0 none). */
  faithWar: Uint8Array;
  /** A daughter's mother (-1 none), 1 once it led to a rebellion, how it won (0 not yet, 1 succession, 2 conversion, 3 rebellion). */
  herMother: Int16Array;
  herRebelled: Uint8Array;
  wonBy: Uint8Array;
  /** A rebellion over faith being declared by realm (mother): daughter + 1 (0 none) and the mother religion. */
  rebelFaith: Int16Array;
  rebelMother: Int16Array;
  /** The majority religion of each people's capital (255 none), from the last count. */
  capMajor: Uint8Array;
  /** For the map (yearly): per hex the religion with the most believers (255 none), its share and the player's religion's share, 0..100. */
  hexRel: Uint8Array;
  hexShare: Uint8Array;
  hexOwn: Uint8Array;
  /** Increases whenever the yearly count changed the map's arrays. */
  version: number;
  stats: ReligionStats;
};

function newStats(): ReligionStats {
  return {
    start: 0, folk: 0, schism: 0, spark: 0, merged: 0, died: 0, blockedFull: 0, lifeSum: 0, levelUp: 0, levelDown: 0, traitReplace: 0,
    traitGain: new Int32Array(25), traitLose: new Int32Array(25), schismsOf0: 0, maxTension0: 0,
    seeded: 0, dDied: 0, dMerged: 0, dWon: new Int32Array(4), faithRebellions: 0, schismRebels: 0, schismVassals: 0, faithJoinsRebel: 0, faithJoinsMother: 0,
    wars: 0, holyWars: 0, holyJoins: 0, holyLost: 0, conquests: 0, carryVisits: 0, disasters: 0, yearsFull: 0,
    stateSucc: 0, stateConv: 0, stateDeath: 0, stateToDaughter: 0,
  };
}

export function createReligions(world: World): Religions {
  const cells = world.cellCount;
  const lev = new Float32Array(CIVS * LEVERS);
  for (let c = 0; c < CIVS; c++) for (let k = 0; k < LEVERS; k++) lev[c * LEVERS + k] = LEVER_KIND[k];
  return {
    rng: createRng(deriveSeed(world.seed, 'faith')),
    enabled: 1,
    alive: new Uint8Array(MAXR),
    serial: new Int32Array(MAXR),
    next: 1,
    name: new Array<string>(MAXR).fill(''),
    names: new Map(),
    founded: new Int32Array(MAXR),
    founderCiv: new Int16Array(MAXR),
    parent: new Int16Array(MAXR).fill(-1),
    parentSerial: new Int32Array(MAXR),
    traitId: new Uint8Array(MAXR * SLOTS),
    traitLvl: new Uint8Array(MAXR * SLOTS),
    traitProg: new Float32Array(MAXR * SLOTS),
    traitBorn: new Int32Array(MAXR * SLOTS),
    traitGod: new Uint8Array(MAXR * SLOTS),
    tension: new Float32Array(MAXR),
    tenseWarned: new Uint8Array(MAXR),
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
    cnt: new Int32Array(CIVS * MAXR),
    popC: new Int32Array(CIVS),
    wav: new Int32Array(CIVS),
    share: new Float32Array(CIVS * MAXR),
    major: new Int16Array(CIVS).fill(-1),
    foundStreak: new Uint8Array(CIVS),
    bonusUntil: new Int32Array(cells),
    bonusRel: new Uint8Array(cells).fill(NO_RELIGION),
    rPull: new Float32Array(MAXR).fill(1),
    rHold: new Float32Array(MAXR).fill(1),
    rCarry: new Float32Array(MAXR).fill(1),
    rDev: new Float32Array(MAXR),
    rSup: new Float32Array(MAXR),
    rMerge: new Float32Array(MAXR).fill(1),
    rSchism: new Float32Array(MAXR).fill(1),
    rOmen: new Float32Array(MAXR),
    seenEv: new Int32Array(CIVS * EVENTS),
    seenCounter: new Int32Array(CIVS),
    cellFs: new Float32Array(cells * MAXR),
    press: new Float32Array(cells * MAXR),
    cellBel: new Float32Array(cells * MAXR),
    lev,
    creed: new Float32Array(CIVS),
    trust: new Float32Array(PAIRS * PAIRS),
    holyWar: new Uint8Array(32),
    holyRel: new Int16Array(32).fill(-1),
    faithWar: new Uint8Array(32),
    herMother: new Int16Array(MAXR).fill(-1),
    herRebelled: new Uint8Array(MAXR),
    wonBy: new Uint8Array(MAXR),
    rebelFaith: new Int16Array(CIVS),
    rebelMother: new Int16Array(CIVS).fill(-1),
    capMajor: new Uint8Array(CIVS).fill(NO_RELIGION),
    hexRel: new Uint8Array(cells).fill(NO_RELIGION),
    hexShare: new Uint8Array(cells),
    hexOwn: new Uint8Array(cells),
    version: 0,
    stats: newStats(),
  };
}

const year = (sim: Simulation) => Math.floor(sim.tick / TICKS_PER_YEAR);
const lf = (level: number) => (level <= 1 ? RELIGION.level1 : level === 2 ? RELIGION.level2 : RELIGION.level3);
const isDaughter = (st: Religions, r: number) => st.parent[r] >= 0 && st.wonBy[r] === 0;
const isYoung = (sim: Simulation, st: Religions, r: number) => isDaughter(st, r) && year(sim) - st.founded[r] < RELIGION.youngYears;

/**
 * Religion 0 for the start people (createSimulation, after its inhabitants): all of them hold it; its traits
 * from the people's culture (no leader yet, no events).
 */
export function initReligions(sim: Simulation, startCiv: number): void {
  const st = sim.religion;
  const pop = sim.pop;
  for (let i = 0; i < pop.end; i++) if (pop.alive[i]) pop.religion[i] = 0;
  found(sim, 0, startCiv, -1);
  st.stats.start++;
  countAll(sim);
}

/** A people founded under id `civ` (also a reused one): its religion data start over. */
export function resetFaithCiv(sim: Simulation, civ: number): void {
  const st = sim.religion;
  if (civ <= 0 || civ >= CIVS) return;
  for (let k = 0; k < EVENTS; k++) st.seenEv[civ * EVENTS + k] = sim.leaders.events[civ * EVENTS + k];
  st.seenCounter[civ] = sim.leaders.counter[civ];
  st.civHist.fill(0, civ * NK * 10, (civ + 1) * NK * 10);
  st.civYear.fill(0, civ * NK, (civ + 1) * NK);
  st.major[civ] = -1;
  st.foundStreak[civ] = 0;
  st.creed[civ] = 0;
  st.rebelFaith[civ] = 0;
  st.rebelMother[civ] = -1;
  st.capMajor[civ] = NO_RELIGION;
  for (let r = 0; r < MAXR; r++) st.secFlag[r * CIVS + civ] = 0;
  for (let k = 0; k < LEVERS; k++) st.lev[civ * LEVERS + k] = LEVER_KIND[k];
  for (let b = 0; b < PAIRS; b++) {
    st.trust[civ * PAIRS + b] = 0;
    st.trust[b * PAIRS + civ] = 0;
  }
}

// ---------------------------------------------------------------------------
// Inhabitants

/** A new inhabitant in `slot`: a child takes its parent's religion, anyone else (a soldier coming home, a new tribe) the hex's strongest. */
export function addedInhabitant(sim: Simulation, slot: number, parent: number, cell: number): void {
  const pop = sim.pop;
  if (parent >= 0) {
    pop.religion[slot] = pop.religion[parent];
    return;
  }
  const st = sim.religion;
  let best = NO_RELIGION;
  let bestV = 0.05;
  for (let r = 0; r < MAXR; r++) {
    const v = st.cellFs[cell * MAXR + r];
    if (v > bestV) {
      bestV = v;
      best = r;
    }
  }
  pop.religion[slot] = best;
}

/**
 * The yearly faith step of inhabitant `i` (simulation.ts updateInhabitant): its faith follows the hex's faith in
 * its religion, devotion where its people follows it, fading elsewhere, suppression; a wavering or unaffiliated
 * one takes the religion with the strongest pressure. Returns the new faith; its religion may change.
 */
export function faithStep(sim: Simulation, i: number, civId: number, cell: number, before: number): number {
  const st = sim.religion;
  const pop = sim.pop;
  const r = pop.religion[i];
  const base = cell * MAXR;
  if (r === NO_RELIGION || !st.alive[r]) {
    pop.religion[i] = NO_RELIGION;
    let top = -1;
    let topV = RELIGION.convert;
    for (let q = 0; q < MAXR; q++) {
      const v = st.press[base + q] * st.rPull[q];
      if (v >= topV && st.alive[q]) {
        topV = v;
        top = q;
      }
    }
    if (top >= 0) {
      pop.religion[i] = top;
      return RELIGION.convertFaith;
    }
    return 0;
  }
  const civ = sim.civs[civId]!;
  const y = year(sim);
  let f = before + (st.cellFs[base + r] - before) * RELIGION.pull;
  const major = st.major[civId];
  if (major === r) f += civ.culture[Culture.Devout] * RELIGION.devout + sim.leaders.lev[civId * LEVERS + L.devotion] + st.rDev[r];
  else if (!(isDaughter(st, r) && y - st.founded[r] < RELIGION.daughterGrace)) f -= RELIGION.fading;
  // The god's layer: Prophet's Light on the player's religion, Doubt on all (Omen Readers feel it half).
  if (r === 0) f += sim.gacha.godLight[civId];
  f -= sim.gacha.godDoubt[civId] * (st.rOmen[r] > 0 ? 0.5 : 1);
  if (major >= 0 && major !== r) f -= st.rSup[major];
  if (f < RELIGION.lose) {
    pop.religion[i] = NO_RELIGION;
    return 0;
  }
  if (f >= 1) f = 1;
  if (f < BELIEVER) {
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
      pop.religion[i] = top;
      st.lostOut[r]++;
      return RELIGION.convertFaith;
    }
  }
  return f;
}

// ---------------------------------------------------------------------------
// Counting

/** Believers per (people, religion), the hexes' faith and pressure (one pass over the inhabitants), the map arrays. */
function countAll(sim: Simulation): void {
  const st = sim.religion;
  const pop = sim.pop;
  const cells = sim.world.cellCount;
  st.cnt.fill(0);
  st.popC.fill(0);
  st.wav.fill(0);
  st.total.fill(0);
  st.cellFs.fill(0);
  st.cellBel.fill(0);
  const rel = pop.religion;
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i]) continue;
    const c = pop.civ[i];
    st.popC[c]++;
    const r = rel[i];
    if (r === NO_RELIGION) {
      st.wav[c]++;
      continue;
    }
    const f = pop.faith[i];
    const k = pop.cell[i] * MAXR + r;
    st.cellFs[k] += f;
    if (f >= BELIEVER) {
      st.cnt[c * MAXR + r]++;
      st.total[r]++;
      st.cellBel[k]++;
    } else st.wav[c]++;
  }
  for (let c = 0; c < cells; c++) {
    const n = sim.cellPop[c];
    if (n > 0) for (let r = 0; r < MAXR; r++) st.cellFs[c * MAXR + r] /= n;
  }
  // Pressure: believers in the hex and its neighbors over their people.
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
  const y = year(sim);
  for (let c = 0; c < cells; c++) {
    const b = st.bonusRel[c];
    if (b !== NO_RELIGION && st.bonusUntil[c] > y && sim.cellPop[c] > 0 && st.alive[b]) st.press[c * MAXR + b] += RELIGION.conquestPull;
  }
  // Traders carry the faith their people follows to the partner's capital (a visit per trade leg and year).
  for (const t of sim.diplomacy.agreements) {
    for (let d = 0; d < 2; d++) {
      const from = d === 0 ? t.a : t.b;
      const to = d === 0 ? t.b : t.a;
      const r = st.major[from];
      const cap = sim.civs[to]?.capital ?? -1;
      if (r < 0 || cap < 0 || !st.alive[r] || sim.cellPop[cap] === 0) continue;
      st.press[cap * MAXR + r] += RELIGION.carryVisit * st.rCarry[r] * t.legs.length;
      st.stats.carryVisits += t.legs.length;
    }
  }
  for (let c = 0; c < CIVS; c++) {
    const n = st.popC[c];
    for (let r = 0; r < MAXR; r++) st.share[c * MAXR + r] = n > 0 ? st.cnt[c * MAXR + r] / n : 0;
  }
  // The map: strongest religion per hex and the player's share.
  for (let c = 0; c < cells; c++) {
    const n = sim.cellPop[c];
    let best = NO_RELIGION;
    let bestN = 0;
    if (n > 0) for (let r = 0; r < MAXR; r++) if (st.cellBel[c * MAXR + r] > bestN) {
      bestN = st.cellBel[c * MAXR + r];
      best = r;
    }
    st.hexRel[c] = best;
    st.hexShare[c] = n > 0 ? Math.round((100 * bestN) / n) : 0;
    st.hexOwn[c] = n > 0 ? Math.round((100 * st.cellBel[c * MAXR]) / n) : 0;
  }
  st.version++;
}

/** A people follows a religion from followStart of its people and stops below followEnd. */
function followHysteresis(sim: Simulation): void {
  const st = sim.religion;
  for (let c = 1; c < CIVS; c++) {
    let m = st.major[c];
    const before = m;
    if (m >= 0 && (!st.alive[m] || st.share[c * MAXR + m] < RELIGION.followEnd)) m = -1;
    for (let r = 0; r < MAXR; r++) if (r !== m && st.alive[r] && st.share[c * MAXR + r] >= RELIGION.followStart) m = r;
    st.major[c] = m;
    const civ = sim.civs[c];
    if (m >= 0 && m !== before && civ) record(sim, `The ${civ.name} follow the ${st.name[m]}.`, civ.capital, false);
  }
}

// ---------------------------------------------------------------------------
// Traits

export function traitCount(st: Religions, r: number): number {
  let n = 0;
  for (let k = 0; k < SLOTS; k++) if (st.traitId[r * SLOTS + k] !== 0) n++;
  return n;
}

/** The slot of trait `t` in religion `r`, -1 if it hasn't it. */
export function hasTrait(st: Religions, r: number, t: number): number {
  for (let k = 0; k < SLOTS; k++) if (st.traitId[r * SLOTS + k] === t) return k;
  return -1;
}

/** Whether religion `r` can't take trait `t` (has it, or one that excludes it). */
export function excluded(st: Religions, r: number, t: number): boolean {
  for (let k = 0; k < SLOTS; k++) {
    const o = st.traitId[r * SLOTS + k];
    if (o === t || (o !== 0 && excludes[o * 25 + t])) return true;
  }
  return false;
}

/** Natural trait slots of religion `r` by its age. */
export function slotsOf(sim: Simulation, r: number): number {
  const st = sim.religion;
  return Math.min(RELIGION.slotsMax, RELIGION.slotsBase + Math.floor((year(sim) - st.founded[r]) / RELIGION.slotYears));
}

function addTrait(sim: Simulation, r: number, t: number, level: number, god = false): boolean {
  const st = sim.religion;
  for (let k = 0; k < SLOTS; k++) {
    const i = r * SLOTS + k;
    if (st.traitId[i] !== 0) continue;
    st.traitId[i] = t;
    st.traitLvl[i] = level;
    st.traitProg[i] = level === 1 ? RELIGION.newProgress : 40;
    st.traitBorn[i] = year(sim);
    st.traitGod[i] = god ? 1 : 0;
    st.stats.traitGain[t]++;
    return true;
  }
  return false;
}

function removeTrait(sim: Simulation, r: number, k: number): void {
  const st = sim.religion;
  const i = r * SLOTS + k;
  st.stats.traitLose[st.traitId[i]]++;
  st.traitId[i] = 0;
  st.traitLvl[i] = 0;
  st.traitProg[i] = 0;
  st.traitGod[i] = 0;
}

/** A trait at random among those allowed (bit mask over the kinds, or `forbid` per founder) and not excluded; 0 if none. */
function pickTrait(sim: Simulation, r: number, kindMask: number, forbidA: number, forbidB: number, rng: Rng): number {
  const st = sim.religion;
  let n = 0;
  for (let t = 1; t <= TRAIT_COUNT; t++) if ((kindMask === -1 || SRC_MASK[t] & kindMask) && t !== forbidA && t !== forbidB && !excluded(st, r, t)) n++;
  if (n === 0) return 0;
  let k = Math.floor(rng() * n);
  for (let t = 1; t <= TRAIT_COUNT; t++) {
    if ((kindMask === -1 || SRC_MASK[t] & kindMask) && t !== forbidA && t !== forbidB && !excluded(st, r, t)) {
      if (k === 0) return t;
      k--;
    }
  }
  return 0;
}

/** The event kind with the most events in the 10-year histogram `h` at `base`, -1 if none (ties: the later kind); `usable` filters (bit mask). */
function topKind(h: Uint8Array, base: number, usable: number): number {
  let best = -1;
  let bestN = 0;
  for (let k = 0; k < NK; k++) {
    if (!(usable & (1 << k))) continue;
    let n = 0;
    for (let y = 0; y < 10; y++) n += h[base + k * 10 + y];
    if (n >= bestN && n > 0) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

/** Kinds (bit mask) that feed a trait religion `r` can still take. */
function feedable(st: Religions, r: number, forbidA: number, forbidB: number): number {
  let mask = 0;
  for (let t = 1; t <= TRAIT_COUNT; t++) if (t !== forbidA && t !== forbidB && !excluded(st, r, t)) mask |= SRC_MASK[t];
  return mask;
}

/** Draws a trait for religion `r` from the events in histogram `h` at `base` (share `fromEvents`) or at random. */
function drawTrait(sim: Simulation, r: number, h: Uint8Array, base: number, fromEvents: number, forbidA = 0, forbidB = 0): number {
  const st = sim.religion;
  if (st.rng() < fromEvents) {
    const kind = topKind(h, base, feedable(st, r, forbidA, forbidB));
    if (kind >= 0) {
      const t = pickTrait(sim, r, 1 << kind, forbidA, forbidB, st.rng);
      if (t) return t;
    }
  }
  return pickTrait(sim, r, -1, forbidA, forbidB, st.rng);
}

function strongestCulture(sim: Simulation, civ: number): number {
  const c = sim.civs[civ];
  if (!c) return Culture.Farming;
  let best = 0;
  for (let k = 1; k < c.culture.length; k++) if (c.culture[k] > c.culture[best]) best = k;
  return best;
}

const ROMAN: readonly (readonly [number, string])[] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function numbered(base: string, n: number): string {
  if (n <= 1) return base;
  let roman = '';
  let k = n;
  for (const [v, s] of ROMAN) while (k >= v) {
    roman += s;
    k -= v;
  }
  return `${base} ${roman}`;
}

/** Founds religion `r` (a free slot) for people `civ`; with a mother (`parent` >= 0) without traits (the caller copies them), else 2 traits by rule 4.5. */
function found(sim: Simulation, r: number, civ: number, parent: number): void {
  const st = sim.religion;
  const y = year(sim);
  st.alive[r] = 1;
  st.serial[r] = st.next++;
  st.founded[r] = y;
  st.founderCiv[r] = civ;
  st.parent[r] = parent;
  st.parentSerial[r] = parent >= 0 ? st.serial[parent] : 0;
  const base = `Faith of the ${sim.civs[civ]?.name ?? 'Wanderers'}`;
  const n = (st.names.get(base) ?? 0) + 1;
  st.names.set(base, n);
  st.name[r] = numbered(base, n);
  st.traitId.fill(0, r * SLOTS, r * SLOTS + SLOTS);
  st.traitLvl.fill(0, r * SLOTS, r * SLOTS + SLOTS);
  st.traitProg.fill(0, r * SLOTS, r * SLOTS + SLOTS);
  st.traitGod.fill(0, r * SLOTS, r * SLOTS + SLOTS);
  st.tension[r] = 0;
  st.tenseWarned[r] = 0;
  st.below[r] = 0;
  st.newClock[r] = y;
  st.lastUprising[r] = y;
  st.lastHoly[r] = -1000;
  st.mergeYears.fill(0, r * MAXR, r * MAXR + MAXR);
  for (let q = 0; q < MAXR; q++) st.mergeYears[q * MAXR + r] = 0;
  st.secFlag.fill(0, r * CIVS, r * CIVS + CIVS);
  st.evHist.fill(0, r * NK * 10, (r + 1) * NK * 10);
  st.yev.fill(0, r * NK, (r + 1) * NK);
  st.lostOut[r] = 0;
  st.herMother[r] = parent;
  st.herRebelled[r] = 0;
  st.wonBy[r] = 0;
  if (parent >= 0) return;
  // First trait: the leader's attribute or the strongest culture, level 2; never the opposite of the founder's attribute.
  const hasAttr = (a: number) => {
    for (let k = 0; k < ATTR_SLOTS; k++) if (sim.leaders.attr[civ * ATTR_SLOTS + k] === a) return true;
    return false;
  };
  const pacifist = hasAttr(2);
  const forbidA = pacifist ? Trait.HolyWar : hasAttr(1) ? Trait.Peacemakers : 0;
  const forbidB = pacifist ? Trait.Inquisition : 0;
  let first = 0;
  if (st.rng() < RELIGION.firstFromAttr && sim.leaders.has[civ]) {
    let n = 0;
    for (let t = 1; t <= TRAIT_COUNT; t++) if (t !== forbidA && t !== forbidB && TRAITS[t].attrs.some(hasAttr)) n++;
    if (n > 0) {
      let k = Math.floor(st.rng() * n);
      for (let t = 1; t <= TRAIT_COUNT && !first; t++) {
        if (t === forbidA || t === forbidB || !TRAITS[t].attrs.some(hasAttr)) continue;
        if (k === 0) first = t;
        k--;
      }
    }
  }
  if (!first) {
    const themes = CULTURE_THEMES[strongestCulture(sim, civ)] ?? [1];
    const theme = themes[Math.floor(st.rng() * themes.length)];
    let n = 0;
    for (let t = 1; t <= TRAIT_COUNT; t++) if (TRAITS[t].theme === theme && t !== forbidA && t !== forbidB) n++;
    let k = Math.floor(st.rng() * n);
    for (let t = 1; t <= TRAIT_COUNT && !first; t++) {
      if (TRAITS[t].theme !== theme || t === forbidA || t === forbidB) continue;
      if (k === 0) first = t;
      k--;
    }
  }
  if (first) addTrait(sim, r, first, 2);
  // Second: from the founding people's events (60 %) or at random, level 1.
  const second = drawTrait(sim, r, st.civHist, civ * NK * 10, RELIGION.secondFromEvents, forbidA, forbidB);
  if (second) addTrait(sim, r, second, 1);
}

function freeSlot(st: Religions): number {
  for (let r = 0; r < MAXR; r++) if (!st.alive[r]) return r;
  return -1;
}

// ---------------------------------------------------------------------------
// Levers: the religions' own, the peoples' layer, Creed, Heresy factor, Faith in trust

function computeRLevers(sim: Simulation): void {
  const st = sim.religion;
  for (let r = 0; r < MAXR; r++) {
    st.rPull[r] = 1;
    st.rHold[r] = 1;
    st.rCarry[r] = 1;
    st.rDev[r] = 0;
    st.rSup[r] = 0;
    st.rMerge[r] = 1;
    st.rSchism[r] = 1;
    st.rOmen[r] = 0;
    if (!st.alive[r]) continue;
    for (let k = 0; k < SLOTS; k++) {
      const t = st.traitId[r * SLOTS + k];
      if (t === 0) continue;
      const d = TRAITS[t];
      const f = lf(st.traitLvl[r * SLOTS + k]);
      if (d.pull) st.rPull[r] *= Math.pow(d.pull, f);
      if (d.hold) st.rHold[r] *= Math.pow(d.hold, f);
      if (d.carry) st.rCarry[r] *= Math.pow(d.carry, f);
      if (d.devotion) st.rDev[r] += d.devotion * f;
      if (d.suppress) st.rSup[r] += RELIGION.suppress * f;
      if (d.merge === 0) st.rMerge[r] = 0;
      else if (d.merge) st.rMerge[r] *= Math.pow(d.merge, f);
      if (d.schism) st.rSchism[r] *= Math.pow(d.schism, f);
      if (t === Trait.OmenReaders) st.rOmen[r] = f;
    }
    if (isYoung(sim, st, r)) st.rHold[r] *= RELIGION.youngHold;
  }
}

const logs = new Float64Array(LEVERS);
const adds = new Float64Array(LEVERS);

/** The lever layer "Glaube" and Creed of every people from its religions' shares and traits (4.4), then its combined lever set. */
function computeCivLevers(sim: Simulation): void {
  const st = sim.religion;
  if (!st.enabled) return;
  for (let c = 1; c < sim.civSlots && c < CIVS; c++) {
    if (!sim.civs[c]) continue;
    logs.fill(0);
    adds.fill(0);
    let creed = 0;
    for (let r = 0; r < MAXR; r++) {
      const s = st.share[c * MAXR + r];
      if (s <= 0 || !st.alive[r]) continue;
      for (let k = 0; k < SLOTS; k++) {
        const t = st.traitId[r * SLOTS + k];
        if (t === 0) continue;
        const d = TRAITS[t];
        const g = lf(st.traitLvl[r * SLOTS + k]) * s * (d.half ? 0.5 : 1);
        creed += d.sat * (d.half ? g * 2 * RELIGION.halfCreed : g);
        for (const [lever, v] of d.lev) {
          const g2 = TRADE_LEVERS[lever] ? g * RELIGION.tradeScale : g;
          if (LEVER_KIND[lever]) logs[lever] += g2 * Math.log(v);
          else adds[lever] += v * g2;
        }
      }
    }
    const o = c * LEVERS;
    for (let k = 0; k < LEVERS; k++) st.lev[o + k] = LEVER_KIND[k] ? Math.exp(logs[k]) : adds[k];
    st.creed[c] = Math.max(-RELIGION.creedCap, Math.min(RELIGION.creedCap, creed));
    combineLevers(sim, c);
  }
}

/** The factor the traits of people `c`'s religions give the weight of the loyalty part "Faith" (Heresy, Mandat 8), mixed by share. */
export function heresyFactor(sim: Simulation, c: number): number {
  const st = sim.religion;
  let factor = 1;
  for (let r = 0; r < MAXR; r++) {
    const s = st.share[c * MAXR + r];
    if (s <= 0 || !st.alive[r]) continue;
    for (let k = 0; k < SLOTS; k++) {
      const t = st.traitId[r * SLOTS + k];
      const h = t !== 0 ? TRAITS[t].heresy : undefined;
      if (h !== undefined) factor *= Math.pow(h, s * lf(st.traitLvl[r * SLOTS + k]));
    }
  }
  return factor;
}

/** Whether religions `r` and `s` are kin (mother and daughter, sisters of one mother). */
export function kinOf(st: Religions, r: number, s: number): boolean {
  return (
    r !== s &&
    ((st.parent[r] >= 0 && st.parentSerial[r] === st.serial[s] && st.alive[s] === 1) ||
      (st.parent[s] >= 0 && st.parentSerial[s] === st.serial[r] && st.alive[r] === 1) ||
      (st.parent[r] >= 0 && st.parent[s] >= 0 && st.parentSerial[r] === st.parentSerial[s]))
  );
}

const bondA = new Float64Array(CIVS);
const xenoA = new Float64Array(CIVS);
const kinA = new Float64Array(CIVS);
const livingTmp = new Int32Array(CIVS);

/** The trust part "Faith" (6a) of every known pair. */
function computeTrust(sim: Simulation): void {
  const st = sim.religion;
  st.trust.fill(0);
  if (!st.enabled) return;
  let n = 0;
  for (let c = 1; c < sim.civSlots && c < CIVS; c++) {
    if (!sim.civs[c]) continue;
    livingTmp[n++] = c;
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
        const f = lf(st.traitLvl[r * SLOTS + k]) * s;
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
  for (let i = 0; i < n; i++) {
    const a = livingTmp[i];
    for (let j = 0; j < n; j++) {
      const b = livingTmp[j];
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

/** Recounts and recomputes all levers at once (after a god's intervention on a religion). */
export function refreshReligions(sim: Simulation): void {
  countAll(sim);
  followHysteresis(sim);
  computeRLevers(sim);
  computeCivLevers(sim);
  computeTrust(sim);
}

// ---------------------------------------------------------------------------
// Holy war (6b), war events, faith joins (6.4a)

/** The religion people `a` may wage a holy war for against `b` (its followed religion has Holy War, Inquisition or Missionary Zeal; `b` follows another; cooldown), -1 if none. */
function holyFor(sim: Simulation, a: number, b: number): number {
  const st = sim.religion;
  if (!st.enabled || a >= CIVS || b >= CIVS) return -1;
  const r = st.major[a];
  const q = st.major[b];
  if (r < 0 || q < 0 || r === q || !st.alive[r]) return -1;
  if (hasTrait(st, r, Trait.HolyWar) < 0 && hasTrait(st, r, Trait.Inquisition) < 0 && hasTrait(st, r, Trait.MissionaryZeal) < 0) return -1;
  if (year(sim) - st.lastHoly[r] < RELIGION.holyCooldown) return -1;
  return r;
}

/** The strength ratio `a` needs over `b` to declare war: RELIGION.holyRatio for a holy war, else `base`. */
export function holyRatio(sim: Simulation, a: number, b: number, base: number): number {
  return holyFor(sim, a, b) >= 0 ? Math.min(base, RELIGION.holyRatio) : base;
}

/** Whether war slot `s` is a holy war (the attacker gives up later). */
export function isHolyWar(sim: Simulation, s: number): boolean {
  return sim.religion.holyWar[s] === 1;
}

function addEvent(st: Religions, civ: number, kind: number, n = 1): void {
  if (civ > 0 && civ < CIVS) st.civYear[civ * NK + kind] += n;
}

/** War `s` was declared by `att` on `def` (war.ts startWar): events, a holy war if the attacker's faith calls for it. */
export function warStarted(sim: Simulation, att: number, def: number, s: number): void {
  const st = sim.religion;
  st.stats.wars++;
  addEvent(st, att, K.War);
  addEvent(st, def, K.War);
  addEvent(st, att, K.Aggr);
  const r = holyFor(sim, att, def);
  st.holyWar[s] = r >= 0 ? 1 : 0;
  st.holyRel[s] = r;
  st.faithWar[s] = 0;
  if (r < 0) return;
  st.stats.holyWars++;
  st.lastHoly[r] = year(sim);
  const civ = sim.civs[att];
  if (civ) record(sim, `The ${civ.name} wage a holy war for the ${st.name[r]}.`, civ.capital, false);
  const k = hasTrait(st, r, Trait.HolyWar);
  if (k >= 0) st.traitProg[r * SLOTS + k] += RELIGION.gain;
}

/** War `s` ended with `type` (war.ts EndType; 1 = the attacker gave up): a lost holy war feeds Steadfast Flock or Martyrs' Creed. */
export function warEnded(sim: Simulation, s: number, attackerLost: boolean): void {
  const st = sim.religion;
  const r = st.holyRel[s];
  if (st.holyWar[s] === 1 && attackerLost && r >= 0 && st.alive[r]) {
    st.stats.holyLost++;
    const a = hasTrait(st, r, Trait.SteadfastFlock);
    const b = hasTrait(st, r, Trait.MartyrsCreed);
    const k = a >= 0 && b >= 0 ? (st.rng() < 0.5 ? a : b) : a >= 0 ? a : b;
    if (k >= 0) st.traitProg[r * SLOTS + k] += RELIGION.gain;
  }
  st.holyWar[s] = 0;
  st.holyRel[s] = -1;
  st.faithWar[s] = 0;
}

/** A holy war's conquest (6b): other faiths in the district lose faith, the conqueror's faith presses on it for years. */
export function conquered(sim: Simulation, s: number, mask: Uint8Array, att: number): void {
  const st = sim.religion;
  if (st.holyWar[s] !== 1) return;
  const r = st.major[att];
  if (r < 0) return;
  const pop = sim.pop;
  const until = year(sim) + RELIGION.conquestYears;
  for (let c = 0; c < mask.length; c++) if (mask[c]) {
    st.bonusUntil[c] = until;
    st.bonusRel[c] = r;
  }
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i] || !mask[pop.cell[i]] || pop.religion[i] === r || pop.religion[i] === NO_RELIGION) continue;
    pop.faith[i] = Math.max(0, pop.faith[i] + RELIGION.conquestFaith);
  }
  st.stats.conquests++;
}

/**
 * Which side (0 the attacker's, 1 the defender's, -1 none) people `p` joins war `s` for its faith (war.ts, at the
 * declaration): a holy war's attacker gets the peoples of its faith that trust it (6b); a rebellion over faith
 * those holding the daughter (with the strength rule) or the mother religion (6.4a).
 */
export function faithJoinSide(sim: Simulation, s: number, p: number): number {
  const st = sim.religion;
  const w = sim.war;
  if (p >= CIVS || !sim.civs[p]) return -1;
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
  const daughter = st.faithWar[s] - 1;
  if (daughter < 0) return -1;
  const mother = st.rebelMother[att];
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

/** A rebellion of realm `mother` over faith is being declared (mandate.ts): the daughter the rebels hold. */
export function markFaithRebellion(sim: Simulation, mother: number, daughter: number, motherRel: number): void {
  const st = sim.religion;
  st.rebelFaith[mother] = daughter + 1;
  st.rebelMother[mother] = motherRel;
  st.stats.faithRebellions++;
  if (!st.herRebelled[daughter]) {
    st.herRebelled[daughter] = 1;
    st.stats.schismRebels++;
  }
}

/** The rebel war `s` of `mother` began (war.ts startRebelWar): a rebellion over faith keeps its daughter for the joins. */
export function rebelWarStarted(sim: Simulation, mother: number, s: number): void {
  const st = sim.religion;
  st.holyWar[s] = 0;
  st.holyRel[s] = -1;
  st.faithWar[s] = st.rebelFaith[mother];
  st.rebelFaith[mother] = 0;
}

/** The rebel war `s` ended; the rebels stayed independent (`rebelsWon`): its daughter won by rebellion. */
export function rebelWarEnded(sim: Simulation, s: number, rebelsWon: boolean): void {
  const st = sim.religion;
  const d = st.faithWar[s] - 1;
  if (rebelsWon && d >= 0 && st.alive[d] && isDaughter(st, d)) win(sim, d, 3, -1);
  st.faithWar[s] = 0;
}

/** Daughter `r` wins (6.1b): by succession (1), conversion in office (2) or rebellion (3), as the faith of people `civ`. */
function win(sim: Simulation, r: number, how: number, civ: number): void {
  const st = sim.religion;
  st.wonBy[r] = how;
  st.stats.dWon[how]++;
  const people = civ > 0 ? sim.civs[civ] : null;
  record(sim, people ? `The ${st.name[r]} becomes the faith of the ${people.name}.` : `The ${st.name[r]} won its freedom.`, people?.capital ?? -1, true);
}

/** A disaster on hex `cell` (the god's fire, drought, flood or another intervention on the land): an event of its people; Omen Readers gain faith. */
export function faithDisaster(sim: Simulation, cell: number): void {
  const st = sim.religion;
  const owner = sim.world.owner[cell];
  if (owner > 0 && owner < CIVS) {
    if (st.civYear[owner * NK + K.Disaster] < 1) st.stats.disasters++;
    // One event per people and year from the same cause is enough to feed the trait.
    if (st.civYear[owner * NK + K.Disaster] < 3) st.civYear[owner * NK + K.Disaster]++;
  }
  if (sim.cellPop[cell] === 0) return;
  let omen = false;
  for (let r = 0; r < MAXR; r++) if (st.rOmen[r] > 0) omen = true;
  if (!omen) return;
  const pop = sim.pop;
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i] || pop.cell[i] !== cell) continue;
    const r = pop.religion[i];
    if (r !== NO_RELIGION && st.rOmen[r] > 0) pop.faith[i] = Math.min(1, pop.faith[i] + RELIGION.omen * st.rOmen[r]);
  }
}

// ---------------------------------------------------------------------------
// The yearly step

function creditEvents(sim: Simulation): void {
  const st = sim.religion;
  const y = year(sim);
  const slot = y % 10;
  for (let c = 1; c < CIVS && c < sim.civSlots; c++) {
    if (!sim.civs[c]) continue;
    for (const [ek, kind] of LEADER_KIND) {
      const now = sim.leaders.events[c * EVENTS + ek];
      const d = now - st.seenEv[c * EVENTS + ek];
      st.seenEv[c * EVENTS + ek] = now;
      // New settlements count from RELIGION.settledFrom a year (Requirement 4.5).
      if (d > 0 && (kind !== K.Settled || d >= RELIGION.settledFrom)) addEvent(st, c, kind, d);
    }
    if (sim.leaders.counter[c] !== st.seenCounter[c]) {
      if (st.seenCounter[c] !== 0) addEvent(st, c, K.Succession);
      st.seenCounter[c] = sim.leaders.counter[c];
    }
    // Foreign faith: a second religion with at least 20 % of the people.
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
  for (let c = 1; c < CIVS; c++) for (let k = 0; k < NK; k++) st.civHist[(c * NK + k) * 10 + slot] = Math.min(255, st.civYear[c * NK + k]);
  st.yev.fill(0);
  for (let c = 1; c < CIVS; c++) {
    for (let r = 0; r < MAXR; r++) {
      if (!st.alive[r] || st.share[c * MAXR + r] < RELIGION.eventShare) continue;
      for (let k = 0; k < NK; k++) {
        const n = st.civYear[c * NK + k];
        if (n > 0) st.yev[r * NK + k] += n;
      }
    }
  }
  for (let r = 0; r < MAXR; r++) {
    if (st.alive[r] && st.startTotal[r] > 0 && st.lostOut[r] >= 0.05 * st.startTotal[r]) st.yev[r * NK + K.Pressure]++;
    for (let k = 0; k < NK; k++) st.evHist[(r * NK + k) * 10 + slot] = Math.min(255, st.yev[r * NK + k]);
    if (st.yev[r * NK + K.Uprising] > 0) st.lastUprising[r] = y;
    st.lostOut[r] = 0;
  }
  st.civYear.fill(0);
}

function growTraits(sim: Simulation): void {
  const st = sim.religion;
  const y = year(sim);
  const s = st.stats;
  for (let r = 0; r < MAXR; r++) {
    if (!st.alive[r]) continue;
    for (let k = 0; k < SLOTS; k++) {
      const i = r * SLOTS + k;
      const t = st.traitId[i];
      if (t === 0) continue;
      const d = TRAITS[t];
      let n = 0;
      for (const kind of d.src) n += st.yev[r * NK + kind];
      let delta = n > 0 ? Math.min(RELIGION.gainMax, n * RELIGION.gain) : RELIGION.idle;
      const opposed = d.counter >= 0 ? st.yev[r * NK + d.counter] > 0 : d.counter === -2 ? y - st.lastUprising[r] >= 20 : false;
      if (opposed) delta += RELIGION.counter;
      st.traitProg[i] += delta;
      if (st.traitProg[i] >= 100) {
        if (st.traitLvl[i] < 3) {
          st.traitLvl[i]++;
          st.traitProg[i] = 40;
          s.levelUp++;
        } else st.traitProg[i] = 100;
      } else if (st.traitProg[i] < 0) {
        if (st.traitLvl[i] > 1) {
          st.traitLvl[i]--;
          st.traitProg[i] = 60;
          s.levelDown++;
        } else {
          traitChronicle(sim, r, `The ${st.name[r]} loses ${d.name}.`);
          removeTrait(sim, r, k);
        }
      }
    }
    // A new trait every newEvery years.
    if (y - st.newClock[r] < RELIGION.newEvery) continue;
    st.newClock[r] = y;
    if (traitCount(st, r) < slotsOf(sim, r)) {
      const t = drawTrait(sim, r, st.evHist, r * NK * 10, RELIGION.newFromEvents);
      if (t && addTrait(sim, r, t, 1)) traitChronicle(sim, r, `The ${st.name[r]} gains ${TRAITS[t].name}.`);
      continue;
    }
    const kind = topKind(st.evHist, r * NK * 10, -1);
    let n = 0;
    if (kind >= 0) for (let q = 0; q < 10; q++) n += st.evHist[(r * NK + kind) * 10 + q];
    if (kind < 0 || n < RELIGION.replaceEvents || st.rng() >= RELIGION.replaceChance) continue;
    let weakest = -1;
    for (let k = 0; k < SLOTS; k++) {
      const i = r * SLOTS + k;
      if (st.traitId[i] !== 0 && st.traitLvl[i] === 1 && (weakest < 0 || st.traitProg[i] < st.traitProg[r * SLOTS + weakest])) weakest = k;
    }
    if (weakest < 0) continue;
    const t = pickTrait(sim, r, 1 << kind, 0, 0, st.rng);
    if (!t) continue;
    traitChronicle(sim, r, `The ${st.name[r]} loses ${TRAITS[st.traitId[r * SLOTS + weakest]].name} and gains ${TRAITS[t].name}.`);
    removeTrait(sim, r, weakest);
    addTrait(sim, r, t, 1);
    s.traitReplace++;
  }
}

function traitChronicle(sim: Simulation, r: number, text: string): void {
  const civ = sim.civs[sim.religion.founderCiv[r]];
  record(sim, text, civ?.capital ?? -1, false);
}

function setReligion(sim: Simulation, from: number, to: number): void {
  const pop = sim.pop;
  for (let i = 0; i < pop.end; i++) if (pop.alive[i] && pop.religion[i] === from) pop.religion[i] = to;
}

function die(sim: Simulation, r: number): void {
  const st = sim.religion;
  setReligion(sim, r, NO_RELIGION);
  st.alive[r] = 0;
  st.stats.died++;
  st.stats.lifeSum += year(sim) - st.founded[r];
  const daughter = isDaughter(st, r);
  if (daughter) st.stats.dDied++;
  const civ = sim.civs[st.founderCiv[r]];
  const mother = st.herMother[r];
  record(sim, daughter ? `The ${st.name[r]} heresy fades.` : `The ${st.name[r]} has died out.`, civ?.capital ?? -1, daughter && mother === 0);
}

function deaths(sim: Simulation): boolean {
  const st = sim.religion;
  const y = year(sim);
  const world = sim.pop.count;
  let changed = false;
  for (let r = 1; r < MAXR; r++) {
    if (!st.alive[r]) continue;
    const daughter = isDaughter(st, r);
    if (y - st.founded[r] < (daughter ? RELIGION.daughterGrace : RELIGION.grace)) continue;
    const young = daughter && y - st.founded[r] < RELIGION.daughterNoWorld;
    if (st.total[r] < RELIGION.deathMin || (!young && st.total[r] < RELIGION.deathShare * world)) st.below[r]++;
    else st.below[r] = 0;
    if (st.below[r] >= RELIGION.deathYears) {
      die(sim, r);
      changed = true;
    }
  }
  return changed;
}

function folkFaiths(sim: Simulation): boolean {
  const st = sim.religion;
  const pop = sim.pop;
  let changed = false;
  for (let c = 1; c < sim.civSlots && c < CIVS; c++) {
    const civ = sim.civs[c];
    if (!civ) continue;
    const n = st.popC[c];
    if (n >= RELIGION.foundMinPop && st.wav[c] >= RELIGION.foundShare * n) st.foundStreak[c] = Math.min(255, st.foundStreak[c] + 1);
    else st.foundStreak[c] = 0;
    if (st.foundStreak[c] < RELIGION.foundYears || st.rng() >= RELIGION.foundChance) continue;
    if (st.wav[c] < RELIGION.minBelievers) continue;
    const r = freeSlot(st);
    if (r < 0) {
      st.stats.blockedFull++;
      continue;
    }
    // Everyone without a religion or wavering in this people takes it.
    found(sim, r, c, -1);
    for (let i = 0; i < pop.end; i++) {
      if (!pop.alive[i] || pop.civ[i] !== c) continue;
      const old = pop.religion[i];
      if (old === NO_RELIGION || pop.faith[i] < BELIEVER) {
        if (old !== NO_RELIGION && old !== r) st.lostOut[old]++;
        pop.religion[i] = r;
        pop.faith[i] = RELIGION.foundFaith;
      }
    }
    st.stats.folk++;
    st.foundStreak[c] = 0;
    changed = true;
    record(sim, `A new faith arises among the ${civ.name}: the ${st.name[r]}.`, civ.capital, true);
  }
  return changed;
}

const peoplesTmp = new Int32Array(CIVS);
const kindsTmp = new Uint8Array(NK);

function schisms(sim: Simulation): boolean {
  const st = sim.religion;
  const w = sim.war;
  let changed = false;
  for (let r = 0; r < MAXR; r++) {
    if (!st.alive[r]) continue;
    let np = 0;
    for (let c = 1; c < CIVS; c++) if (st.cnt[c * MAXR + r] >= RELIGION.schismBelievers) peoplesTmp[np++] = c;
    let inc = 0;
    for (let i = 0; i < np; i++) {
      for (let j = i + 1; j < np; j++) if (w.foe[peoplesTmp[i] * PAIRS + peoplesTmp[j]] > 0) inc += RELIGION.tensionWar;
      const c = peoplesTmp[i];
      if ((sim.civs[c]?.parentName ?? null) !== null && !st.secFlag[r * CIVS + c]) {
        st.secFlag[r * CIVS + c] = 1;
        inc += RELIGION.tensionSecession;
      }
    }
    // Different stories: the dominant event kind of each people over 10 years; every distinct kind beyond the first counts.
    if (np >= 2) {
      kindsTmp.fill(0);
      let kinds = 0;
      const usable = ~((1 << K.Foreign) | (1 << K.Aggr));
      for (let i = 0; i < np; i++) {
        const k = topKind(st.civHist, peoplesTmp[i] * NK * 10, usable);
        if (k >= 0 && !kindsTmp[k]) {
          kindsTmp[k] = 1;
          kinds++;
        }
      }
      inc += Math.max(0, kinds - 1) * RELIGION.tensionStory;
    }
    if (np >= RELIGION.sizeFrom) inc += RELIGION.tensionSize;
    st.tension[r] = Math.max(0, Math.min(100, st.tension[r] + (inc > 0 ? inc : -RELIGION.tensionDecay)));
    if (r === 0) {
      if (st.tension[0] > st.stats.maxTension0) st.stats.maxTension0 = st.tension[0];
      if (st.tension[0] >= RELIGION.tense && !st.tenseWarned[0]) {
        st.tenseWarned[0] = 1;
        record(sim, 'Unrest in your faith: its peoples drift apart.', sim.civs[st.founderCiv[0]]?.capital ?? -1, false);
      } else if (st.tension[0] < RELIGION.tense - 10) st.tenseWarned[0] = 0;
    }
    if (np < RELIGION.schismPeoples) continue;
    const chance = Math.min(RELIGION.schismCap, (RELIGION.schismBase + Math.max(0, (st.tension[r] - 40) / 10) * RELIGION.schismPer10) * st.rSchism[r]);
    if (st.rng() >= chance) continue;
    const slot = freeSlot(st);
    if (slot < 0) {
      st.stats.blockedFull++;
      continue;
    }
    let young = 0;
    for (let q = 0; q < MAXR; q++) if (st.alive[q] && st.parent[q] === r && st.parentSerial[q] === st.serial[r] && isYoung(sim, st, q)) young++;
    if (young >= RELIGION.maxYoung) continue;
    const cell = pickSeedCell(sim, r);
    if (cell < 0) continue;
    splitOff(sim, r, slot, cell);
    st.tension[r] = Math.max(0, st.tension[r] - RELIGION.tensionDrop);
    changed = true;
  }
  return changed;
}

/** Daughter `slot` of religion `r` begins in settlement `cell` (6.1): the mother's traits with one swapped, the seed. */
function splitOff(sim: Simulation, r: number, slot: number, cell: number): void {
  const st = sim.religion;
  const civ = sim.world.owner[cell];
  found(sim, slot, civ, r);
  for (let k = 0; k < SLOTS; k++) {
    st.traitId[slot * SLOTS + k] = st.traitId[r * SLOTS + k];
    st.traitLvl[slot * SLOTS + k] = st.traitLvl[r * SLOTS + k];
    st.traitProg[slot * SLOTS + k] = st.traitProg[r * SLOTS + k];
    st.traitBorn[slot * SLOTS + k] = st.traitBorn[r * SLOTS + k];
  }
  // One swapped: the weakest falls, one from this people's events comes (level 1).
  let weakest = -1;
  for (let k = 0; k < SLOTS; k++) {
    const i = slot * SLOTS + k;
    if (st.traitId[i] === 0) continue;
    const wi = slot * SLOTS + weakest;
    if (weakest < 0 || st.traitLvl[i] < st.traitLvl[wi] || (st.traitLvl[i] === st.traitLvl[wi] && st.traitProg[i] < st.traitProg[wi])) weakest = k;
  }
  if (weakest >= 0 && traitCount(st, slot) > 1) removeTrait(sim, slot, weakest);
  const t = drawTrait(sim, slot, st.civHist, civ * NK * 10, RELIGION.secondFromEvents);
  if (t) addTrait(sim, slot, t, 1);
  st.stats.schism++;
  if (r === 0) st.stats.schismsOf0++;
  seedHeresy(sim, r, slot, cell);
  const people = sim.civs[civ];
  record(sim, `A heresy arises in a settlement of the ${people?.name ?? 'wanderers'}: the ${st.name[slot]}.`, cell, r === 0 || (people?.worshipsPlayer ?? false));
}

const seedCells = new Int32Array(1024);
const settledTmp = new Int32Array(4096);
const seedWeights = new Float64Array(1024);

/** The settlement the daughter starts in (6.1): weighted by believers, distance to the capital, foreign contact and unrest; never a capital. -1 if none. */
function pickSeedCell(sim: Simulation, r: number): number {
  const st = sim.religion;
  const w = sim.world;
  const loyalty = sim.mandate.loyalty;
  let n = 0;
  let total = 0;
  let ns = 0;
  for (let c = 0; c < w.cellCount && ns < settledTmp.length; c++) if (sim.cellPop[c] > 0 && w.owner[c] !== 0) settledTmp[ns++] = c;
  for (let c = 0; c < w.cellCount && n < seedCells.length; c++) {
    if (sim.cellPop[c] === 0) continue;
    const bel = st.cellBel[c * MAXR + r];
    const o = w.owner[c];
    const civ = sim.civs[o];
    if (bel < RELIGION.seedMin || o === 0 || !civ || civ.capital === c) continue;
    const dist = hexDist(w, c, civ.capital);
    let foreign = 0;
    for (let k = 0; k < ns; k++) {
      const x = settledTmp[k];
      if (w.owner[x] !== o && hexDist(w, c, x) <= 8) {
        foreign = 1;
        break;
      }
    }
    const loy = loyalty[c];
    const low = (loy >= 0 && loy < 50) || civ.parentName !== null || sim.war.conqTick[c] > 0 ? 1 : 0;
    const wt = Math.min(3, bel / 40) * (1 + Math.min(2, dist / 6) + foreign + low);
    seedCells[n] = c;
    seedWeights[n] = wt;
    n++;
    total += wt;
  }
  if (n === 0) return -1;
  let pick = st.rng() * total;
  for (let i = 0; i < n; i++) {
    pick -= seedWeights[i];
    if (pick <= 0) return seedCells[i];
  }
  return seedCells[n - 1];
}

/** The seed (6.1): RELIGION.seedShare of the mother's believers in the settlement and its 6 neighbors take the daughter, the weakest in faith first. */
function seedHeresy(sim: Simulation, r: number, slot: number, cell: number): number {
  const w = sim.world;
  const pop = sim.pop;
  const inSeed = (c: number) => {
    if (c === cell) return true;
    for (let d = 0; d < DIRECTION_COUNT; d++) if (w.neighbors[cell * DIRECTION_COUNT + d] === c) return true;
    return false;
  };
  const list: number[] = [];
  for (let i = 0; i < pop.end; i++) if (pop.alive[i] && pop.religion[i] === r && pop.faith[i] >= BELIEVER && inSeed(pop.cell[i])) list.push(i);
  list.sort((a, b) => pop.faith[a] - pop.faith[b] || a - b);
  const n = Math.floor(RELIGION.seedShare * list.length);
  for (let k = 0; k < n; k++) {
    pop.religion[list[k]] = slot;
    pop.faith[list[k]] = RELIGION.foundFaith;
  }
  sim.religion.stats.seeded += n;
  return n;
}

/** Merges religion `lose` into `keep` (6.2): its believers change over, `keep` takes one of its traits (level 1, room permitting). */
function mergeInto(sim: Simulation, keep: number, lose: number, rng: Rng): void {
  const st = sim.religion;
  if (traitCount(st, keep) < SLOTS) {
    let n = 0;
    for (let k = 0; k < SLOTS; k++) {
      const t = st.traitId[lose * SLOTS + k];
      if (t !== 0 && !excluded(st, keep, t)) n++;
    }
    if (n > 0) {
      let pick = Math.floor(rng() * n);
      for (let k = 0; k < SLOTS; k++) {
        const t = st.traitId[lose * SLOTS + k];
        if (t === 0 || excluded(st, keep, t)) continue;
        if (pick === 0) {
          addTrait(sim, keep, t, 1);
          break;
        }
        pick--;
      }
    }
  }
  const ss = hasTrait(st, keep, Trait.SyncreticSpirit);
  if (ss >= 0) st.traitProg[keep * SLOTS + ss] += RELIGION.gain;
  setReligion(sim, lose, keep);
  st.alive[lose] = 0;
  st.stats.merged++;
  if (isDaughter(st, lose)) st.stats.dMerged++;
  st.stats.lifeSum += year(sim) - st.founded[lose];
  for (let q = 0; q < MAXR; q++) {
    st.mergeYears[lose * MAXR + q] = 0;
    st.mergeYears[q * MAXR + lose] = 0;
  }
  // A daughter of the lost religion is now one of the kept (its heresy goes on against it).
  for (let q = 0; q < MAXR; q++) if (st.alive[q] && st.herMother[q] === lose) st.herMother[q] = keep;
  const civ = sim.civs[st.founderCiv[keep]];
  record(sim, `The ${st.name[lose]} merged into the ${st.name[keep]}.`, civ?.capital ?? -1, true);
}

function merges(sim: Simulation): boolean {
  const st = sim.religion;
  const w = sim.war;
  const y = year(sim);
  for (let a = 0; a < MAXR; a++) {
    if (!st.alive[a]) continue;
    for (let b = a + 1; b < MAXR; b++) {
      if (!st.alive[b]) continue;
      let both = false;
      for (let c = 1; c < CIVS && !both; c++) both = st.share[c * MAXR + a] >= RELIGION.mergeShare && st.share[c * MAXR + b] >= RELIGION.mergeShare;
      // Mother and daughter don't merge by themselves for mergeBan years.
      if ((st.parent[b] >= 0 && st.parentSerial[b] === st.serial[a] && y - st.founded[b] < RELIGION.mergeBan) || (st.parent[a] >= 0 && st.parentSerial[a] === st.serial[b] && y - st.founded[a] < RELIGION.mergeBan)) continue;
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
      const keep = a === 0 || b === 0 ? 0 : st.total[a] >= st.total[b] ? a : b;
      mergeInto(sim, keep, keep === a ? b : a, st.rng);
      st.mergeYears[k] = 0;
      return true;
    }
  }
  return false;
}

/** Hex distance like hex.ts hexDistance (the map wraps left/right), without allocating (hot loops). */
function hexDist(w: World, a: number, b: number): number {
  const width = w.width;
  const aq = a % width;
  const ar = Math.floor(a / width) - (aq - (aq & 1)) / 2;
  const bCol = b % width;
  const bRow = Math.floor(b / width);
  let best = Infinity;
  for (let k = -1; k <= 1; k++) {
    const bq = bCol + k * width;
    const br = bRow - (bq - (bq & 1)) / 2;
    const dq = aq - bq;
    const dr = ar - br;
    const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    if (d < best) best = d;
  }
  return best;
}

/** Hexes within `radius` of each hex (any land or water), cached per world and radius (geometry only). */
const withinCache = new WeakMap<World, Map<number, (Int32Array | undefined)[]>>();
export function within(w: World, c: number, radius: number): Int32Array {
  let byRadius = withinCache.get(w);
  if (!byRadius) {
    byRadius = new Map();
    withinCache.set(w, byRadius);
  }
  let list = byRadius.get(radius);
  if (!list) {
    list = new Array(w.cellCount);
    byRadius.set(radius, list);
  }
  const hit = list[c];
  if (hit) return hit;
  const seen = new Set<number>([c]);
  let frontier = [c];
  for (let r = 0; r < radius; r++) {
    const next: number[] = [];
    for (const a of frontier) for (let d = 0; d < DIRECTION_COUNT; d++) {
      const x = w.neighbors[a * DIRECTION_COUNT + d];
      if (x >= 0 && !seen.has(x)) {
        seen.add(x);
        next.push(x);
      }
    }
    frontier = next;
  }
  seen.delete(c);
  const out = Int32Array.from(seen);
  list[c] = out;
  return out;
}

let planR = new Int8Array(0);
let planP = new Float32Array(0);
let back = new Float32Array(0);
let domR = new Int8Array(0);
let bestD = new Float32Array(0);
let srcSum = new Float32Array(0);
let srcN = new Uint16Array(0);
const touchedTmp = new Int32Array(4096);

/**
 * The daughters' contagion (6.1a), inflow only: a settlement's daughter share moves towards the mean of the
 * sources (settlements within contRadius hexes with >= contSrc), x kappa x min(1, sources / 2) x pull, held back
 * by the dominant religion's hold (Open Gates halves it); shares below contVanish vanish; the state faith's
 * suppress cures. The inhabitants change over by chance.
 */
function contagion(sim: Simulation): void {
  const st = sim.religion;
  const w = sim.world;
  const cells = w.cellCount;
  if (planR.length !== cells) {
    planR = new Int8Array(cells);
    planP = new Float32Array(cells);
    back = new Float32Array(cells * MAXR);
  }
  planR.fill(-1);
  planP.fill(0);
  back.fill(0);
  let any = false;
  for (let r = 1; r < MAXR; r++) if (st.alive[r] && st.parent[r] >= 0) any = true;
  if (!any) return;
  // The dominant religion and the state faith per settled hex; the vanishing and the suppression of daughters.
  if (domR.length !== cells) {
    domR = new Int8Array(cells);
    bestD = new Float32Array(cells);
    srcSum = new Float32Array(cells);
    srcN = new Uint16Array(cells);
  }
  bestD.fill(0);
  for (let c = 0; c < cells; c++) {
    domR[c] = -1;
    const people = sim.cellPop[c];
    if (people === 0) continue;
    let domN = 0;
    for (let r = 0; r < MAXR; r++) if (st.alive[r] && st.cellBel[c * MAXR + r] > domN) {
      domN = st.cellBel[c * MAXR + r];
      domR[c] = r;
    }
    const o = w.owner[c];
    const sf = o > 0 ? stateFaith(sim, o) : -1;
    for (let r = 1; r < MAXR; r++) {
      if (!st.alive[r] || st.parent[r] < 0) continue;
      const own = st.cellBel[c * MAXR + r] / people;
      if (own > 0 && own < RELIGION.contVanish) back[c * MAXR + r] = 1;
      if (own > 0 && sf >= 0 && sf !== r && st.rSup[sf] > 0) back[c * MAXR + r] = Math.max(back[c * MAXR + r], st.rSup[sf] / Math.max(own, 1e-6));
    }
  }
  // Per daughter: the sources (settlements with >= contSrc of it, few) pour into the settlements within contRadius.
  for (let r = 1; r < MAXR; r++) {
    if (!st.alive[r] || st.parent[r] < 0) continue;
    let touched = 0;
    for (let x = 0; x < cells; x++) {
      const n = sim.cellPop[x];
      if (n === 0 || st.cellBel[x * MAXR + r] / n < RELIGION.contSrc) continue;
      const share = st.cellBel[x * MAXR + r] / n;
      const near = within(w, x, RELIGION.contRadius);
      for (let k = 0; k < near.length; k++) {
        const y = near[k];
        if (sim.cellPop[y] === 0) continue;
        if (srcN[y] === 0 && touched < touchedTmp.length) touchedTmp[touched++] = y;
        srcSum[y] += share;
        srcN[y]++;
      }
    }
    for (let t = 0; t < touched; t++) {
      const c = touchedTmp[t];
      const people = sim.cellPop[c];
      const k = srcN[c];
      const sum = srcSum[c];
      srcSum[c] = 0;
      srcN[c] = 0;
      const dom = domR[c];
      if (dom === r) continue;
      const own = st.cellBel[c * MAXR + r] / people;
      let d = RELIGION.kappa * st.rPull[r] * Math.max(0, sum / k - own) * Math.min(1, k / 2);
      if (dom >= 0) {
        d /= st.rHold[dom];
        if (hasTrait(st, dom, Trait.OpenGates) >= 0) d *= 0.5;
      }
      if (d > bestD[c]) {
        bestD[c] = d;
        planR[c] = r;
        planP[c] = Math.min(1, (d * people) / Math.max(1, people - st.cellBel[c * MAXR + r]));
      }
    }
  }
  const pop = sim.pop;
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i]) continue;
    const c = pop.cell[i];
    const r0 = pop.religion[i];
    if (r0 > 0 && r0 !== NO_RELIGION && back[c * MAXR + r0] > 0 && st.rng() < back[c * MAXR + r0]) {
      pop.religion[i] = NO_RELIGION;
      pop.faith[i] = 0;
      st.lostOut[r0]++;
      continue;
    }
    const r = planR[c];
    if (r < 0 || r0 === r || st.rng() >= planP[c]) continue;
    if (r0 !== NO_RELIGION) st.lostOut[r0]++;
    pop.religion[i] = r;
    pop.faith[i] = RELIGION.convertFaith;
  }
}

// ---------------------------------------------------------------------------
// The leader's faith and the state faith (Requirement Anführer 6a, Mandat 8)

/** The state faith of people `civ`: its leader's faith, else the majority religion of its capital; -1 if none. */
export function stateFaith(sim: Simulation, civ: number): number {
  if (civ <= 0 || civ >= CIVS) return -1;
  const st = sim.religion;
  const f = sim.leaders.faith[civ];
  if (f !== NO_RELIGION && st.alive[f]) return f;
  const m = st.capMajor[civ];
  if (m !== NO_RELIGION && st.alive[m]) return m;
  // Not counted yet (a new people): the strongest religion of its capital at the last count.
  const cap = sim.civs[civ]?.capital ?? -1;
  const h = cap >= 0 ? st.hexRel[cap] : NO_RELIGION;
  return h !== NO_RELIGION && st.alive[h] ? h : -1;
}

/** The leaders' faith: drawn at a succession, the capital's majority for a first leader or when the faith died, rarely changed in office. */
function updateLeaderFaith(sim: Simulation): void {
  const st = sim.religion;
  const s = sim.leaders;
  const M = MANDATE_FAITH;
  const rng = sim.mandate.rng;
  for (let c = 1; c < CIVS && c < sim.civSlots; c++) {
    const civ = sim.civs[c];
    if (!civ) continue;
    const cap = civ.capital;
    const capPop = cap >= 0 ? sim.cellPop[cap] : 0;
    const capShare = (r: number) => (capPop > 0 ? st.cellBel[cap * MAXR + r] / capPop : 0);
    let capMajor = -1;
    let best = 0;
    for (let r = 0; r < MAXR; r++) {
      if (!st.alive[r]) continue;
      const v = capPop > 0 ? capShare(r) : st.share[c * MAXR + r];
      if (v > best) {
        best = v;
        capMajor = r;
      }
    }
    st.capMajor[c] = capMajor >= 0 ? capMajor : NO_RELIGION;
    if (!s.has[c]) continue;
    const draw = s.faithDraw[c];
    s.faithDraw[c] = 0;
    const cur = s.faith[c] !== NO_RELIGION && st.alive[s.faith[c]] ? s.faith[c] : -1;
    if (cur < 0 || draw === 3) {
      // A first leader (a new people) or a faith that died: the capital's majority.
      if (capMajor >= 0) setLeaderFaith(sim, c, capMajor, draw !== 3 && s.faith[c] !== NO_RELIGION ? 3 : 0);
      continue;
    }
    if (draw === 1) {
      // Succession: weighted by the shares in capital and realm, the predecessor's faith x predecessor.
      let total = 0;
      for (let r = 0; r < MAXR; r++) if (st.alive[r]) total += (M.capWeight * capShare(r) + (1 - M.capWeight) * st.share[c * MAXR + r]) * (r === cur ? M.predecessor : 1);
      if (total <= 0) continue;
      let pick = rng() * total;
      for (let r = 0; r < MAXR; r++) {
        if (!st.alive[r]) continue;
        const wt = (M.capWeight * capShare(r) + (1 - M.capWeight) * st.share[c * MAXR + r]) * (r === cur ? M.predecessor : 1);
        pick -= wt;
        if (pick <= 0 && wt > 0) {
          setLeaderFaith(sim, c, r, 1);
          break;
        }
      }
      continue;
    }
    // Dynasty's Heir (draw 2) keeps the predecessor's faith. In office: a rival faith with a majority of the capital.
    if (draw === 2) continue;
    let rival = -1;
    for (let r = 0; r < MAXR; r++) if (st.alive[r] && r !== cur && capShare(r) >= M.convertShare) rival = r;
    if (rival < 0) continue;
    let never = false;
    let flexible = 0;
    for (let k = 0; k < ATTR_SLOTS; k++) {
      const a = s.attr[c * ATTR_SLOTS + k];
      if (a === 24 || a === 4 || a === 22 || a === 21) never = true;
      else if (a === 10) flexible = Math.max(flexible, M.opportunist);
      else if (a === 23) flexible = Math.max(flexible, M.weakHand);
    }
    if (!never && flexible > 0 && rng() < flexible) setLeaderFaith(sim, c, rival, 2);
  }
}

/** The leader's faith numbers (Requirement Anführer 6a). */
export const MANDATE_FAITH = { capWeight: 0.7, predecessor: 1.5, convertShare: 0.55, opportunist: 0.03, weakHand: 0.02 };

/** The leader of `civ` takes faith `r`: cause 0 first leader, 1 succession, 2 conversion in office, 3 the faith died. */
function setLeaderFaith(sim: Simulation, civ: number, r: number, cause: number): void {
  const st = sim.religion;
  const s = sim.leaders;
  const before = s.faith[civ];
  if (before === r) return;
  s.faith[civ] = r;
  const people = sim.civs[civ];
  if (cause === 1) st.stats.stateSucc++;
  else if (cause === 2) st.stats.stateConv++;
  else if (cause === 3) st.stats.stateDeath++;
  if (st.parent[r] >= 0) st.stats.stateToDaughter++;
  // A daughter that takes a throne has won (6.1b): by succession or conversion, or as the first faith of a rebel people.
  if (isDaughter(st, r)) win(sim, r, cause === 2 ? 2 : cause === 0 && people?.parentName ? 3 : 1, civ);
  if (cause !== 0 && people) {
    const important = r === 0 || before === 0 || people.worshipsPlayer;
    record(sim, `The ruler of the ${people.name} adopts the ${st.name[r]}.`, people.capital, important);
  }
}

/**
 * One step of the yearly religion update (simulation.ts: RELIGION_WEEK, one part of a tick each); returns the
 * next step, -1 after the last. Steps: events, traits, deaths, folk faiths; schisms; merges; contagion; the
 * levers, trust and the leaders' faith.
 */
export function religionYearStep(sim: Simulation, step: number): number {
  const st = sim.religion;
  if (step === 0) {
    countAll(sim);
    st.startTotal.set(st.total);
    followHysteresis(sim);
    creditEvents(sim);
    growTraits(sim);
    computeRLevers(sim);
    deaths(sim);
    folkFaiths(sim);
    return 1;
  }
  if (step === 1) {
    countAll(sim);
    followHysteresis(sim);
    schisms(sim);
    return 2;
  }
  if (step === 2) {
    countAll(sim);
    followHysteresis(sim);
    merges(sim);
    return 3;
  }
  if (step === 3) {
    countAll(sim);
    contagion(sim);
    return 4;
  }
  countAll(sim);
  followHysteresis(sim);
  let alive = 0;
  for (let r = 0; r < MAXR; r++) alive += st.alive[r];
  if (alive >= MAXR) st.stats.yearsFull++;
  computeRLevers(sim);
  computeCivLevers(sim);
  computeTrust(sim);
  updateLeaderFaith(sim);
  return -1;
}

/** The whole yearly update at once (tests). */
export function religionYear(sim: Simulation): void {
  for (let step = 0; step >= 0; step = religionYearStep(sim, step));
}

/** Number of living religions. */
export function aliveCount(sim: Simulation): number {
  let n = 0;
  for (let r = 0; r < MAXR; r++) n += sim.religion.alive[r];
  return n;
}

// ---------------------------------------------------------------------------
// The god's interventions (Requirement Religion 8: abilities 26-30)

/** Whether religion `r` lives. */
export const religionAlive = (sim: Simulation, r: number) => r >= 0 && r < MAXR && sim.religion.alive[r] === 1;

/** Traits Blessed Doctrine could give religion `r` (none it has, none excluded). */
export function blessable(sim: Simulation, r: number): number {
  const st = sim.religion;
  if (!religionAlive(sim, r) || traitCount(st, r) >= SLOTS) return 0;
  let n = 0;
  for (let t = 1; t <= TRAIT_COUNT; t++) if (!excluded(st, r, t)) n++;
  return n;
}

/** Blessed Doctrine: a random trait at level 2, beyond the natural slots (up to SLOTS). Returns the trait. */
export function blessDoctrine(sim: Simulation, r: number, rng: Rng): number {
  const t = pickTrait(sim, r, -1, 0, 0, rng);
  if (t && addTrait(sim, r, t, 2, true)) {
    traitChronicle(sim, r, `The ${sim.religion.name[r]} gains ${TRAITS[t].name} by the god.`);
    refreshReligions(sim);
  }
  return t;
}

/** Lost Doctrine: a random trait of religion `r` goes (it keeps at least one). Returns the trait. */
export function loseDoctrine(sim: Simulation, r: number, rng: Rng): number {
  const st = sim.religion;
  const n = traitCount(st, r);
  if (n < 2) return 0;
  let pick = Math.floor(rng() * n);
  for (let k = 0; k < SLOTS; k++) {
    const t = st.traitId[r * SLOTS + k];
    if (t === 0) continue;
    if (pick === 0) {
      traitChronicle(sim, r, `The ${st.name[r]} loses ${TRAITS[t].name} by the god.`);
      removeTrait(sim, r, k);
      refreshReligions(sim);
      return t;
    }
    pick--;
  }
  return 0;
}

/** The religion with the most believers in settlement `cell` (the last count), -1 if none. */
export function strongestAt(sim: Simulation, cell: number): number {
  const r = sim.religion.hexRel[cell];
  return r !== NO_RELIGION && sim.religion.alive[r] ? r : -1;
}

/** Whether Sunder the Faith may seed a daughter in settlement `cell`: a free slot, >= 20 believers of its strongest religion. */
export function canSunder(sim: Simulation, cell: number): boolean {
  const st = sim.religion;
  if (cell < 0 || cell >= sim.world.cellCount || sim.cellPop[cell] === 0 || sim.world.owner[cell] === 0) return false;
  const r = strongestAt(sim, cell);
  return r >= 0 && freeSlot(st) >= 0 && st.cellBel[cell * MAXR + r] >= RELIGION.minBelievers;
}

/** Sunder the Faith: a daughter of the settlement's strongest religion begins there at once (6.1, capitals too). Returns its slot, -1 if none. */
export function sunderFaith(sim: Simulation, cell: number): number {
  const st = sim.religion;
  const r = strongestAt(sim, cell);
  const slot = freeSlot(st);
  if (r < 0 || slot < 0) return -1;
  splitOff(sim, r, slot, cell);
  refreshReligions(sim);
  return slot;
}

/** Whether Spark of a New Faith may found a religion in people `civ` (a free slot, >= 80 inhabitants). */
export function canSpark(sim: Simulation, civ: number): boolean {
  return civ > 0 && civ < CIVS && !!sim.civs[civ] && sim.civs[civ]!.population >= 80 && freeSlot(sim.religion) >= 0;
}

/** Spark of a New Faith: a religion of people `civ` at once; a quarter of its people take it (the unaffiliated and wavering first, then around the capital). */
export function sparkFaith(sim: Simulation, civ: number): number {
  const st = sim.religion;
  const r = freeSlot(st);
  const people = sim.civs[civ];
  if (r < 0 || !people) return -1;
  found(sim, r, civ, -1);
  st.stats.spark++;
  const pop = sim.pop;
  let want = Math.floor(0.25 * people.population);
  for (let i = 0; i < pop.end && want > 0; i++) {
    if (!pop.alive[i] || pop.civ[i] !== civ || (pop.religion[i] !== NO_RELIGION && pop.faith[i] >= BELIEVER)) continue;
    pop.religion[i] = r;
    pop.faith[i] = RELIGION.foundFaith;
    want--;
  }
  // Then the hexes around the capital, nearest first.
  const w = sim.world;
  for (let ring = 0; ring <= 12 && want > 0 && people.capital >= 0; ring++) {
    for (let i = 0; i < pop.end && want > 0; i++) {
      if (!pop.alive[i] || pop.civ[i] !== civ || pop.religion[i] === r) continue;
      if (hexDistance(w, pop.cell[i], people.capital) !== ring) continue;
      pop.religion[i] = r;
      pop.faith[i] = RELIGION.foundFaith;
      want--;
    }
  }
  record(sim, `A new faith arises among the ${people.name}: the ${st.name[r]}.`, people.capital, true);
  refreshReligions(sim);
  return r;
}

/** Covenant of One: religions `a` and `b` merge at once (the larger stays; with the player's, the player's stays). */
export function covenant(sim: Simulation, a: number, b: number, rng: Rng): void {
  const st = sim.religion;
  if (!religionAlive(sim, a) || !religionAlive(sim, b) || a === b) return;
  const keep = a === 0 || b === 0 ? 0 : st.total[a] >= st.total[b] ? a : b;
  mergeInto(sim, keep, keep === a ? b : a, rng);
  refreshReligions(sim);
}

/**
 * Tests: from now on the faith's layer of every people is neutral (no lever effects, no Creed, no Faith in trust, no
 * holy war; the religions still spread), so a fixture can check the base rules or the leaders' numbers alone.
 */
export function dismissFaithLayer(sim: Simulation): void {
  const st = sim.religion;
  st.enabled = 0;
  for (let c = 0; c < CIVS; c++) {
    for (let k = 0; k < LEVERS; k++) st.lev[c * LEVERS + k] = LEVER_KIND[k];
    st.creed[c] = 0;
    if (c > 0) combineLevers(sim, c);
  }
  st.trust.fill(0);
}

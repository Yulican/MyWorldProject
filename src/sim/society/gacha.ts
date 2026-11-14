import { DIRECTION_COUNT } from '../hex';
import { createRng, deriveSeed, type Rng } from '../rng';
import { BIOMES, Biome, RESOURCE_COUNT, Resource, isWaterBiome } from '../world/biomes';
import { clamp } from '../world/climate';
import { DEPOSITS, Deposit } from '../world/deposits';
import { resourceCapacityTerms } from '../world/features';
import { sumTerms } from '../terms';
import { SlotState, growSlots, takenSlots } from './buildings';
import { biomeSlots, updateCellSupply, usableSlots } from './economy';
import { ATTRS, canRerollGoal, giveGodTrait, godTraitChoices, honeTrait, rerollGoal, traitCount } from './leaderRules';
import { L, LEADER, LEADER_CIVS, LEVERS, combineLevers, leaderName, setIdentity } from './leaders';
import { updateTradeBuildings } from './trade';
import { BELIEVER_FAITH, TickPart, killInhabitant, type Simulation } from './simulation';

// Gacha and the god's abilities ("Design Documents/Requirement Gacha.md"). The player's state (Faith, pulls,
// charges, the random numbers "gacha") and the god layer: timed effects in one list (section 7.1), the fires
// of Wild Fire (7.3), the one-time land changes (Great River 7.2, Biome Shift 7.4, slots 7.5), the people's
// "Divine" satisfaction part (7.6), devotion of Prophet's Light / Doubt and worship (7.7), the interventions on
// leaders (7.8, in leaderRules.ts).
//
// Running cost: per tick one multiplication (Faith), one compare (the earliest effect's end) and, while a fire
// burns, its list (<= GACHA.maxFires hexes) plus one pass over the inhabitants for the burnt ones. Casting is a
// one-off that touches <= 37 hexes (or 12 path hexes, or one people's inhabitants). All state is flat typed
// arrays; nothing is allocated per tick. Random numbers only from `sim.gacha.rng`.

/** Gods with a faith of their own: the player's now, rival gods later (Game Design section 8). */
export const GODS = 1;
export const PLAYER_GOD = 0;

/** Tunable numbers (Requirement sections 2-7; durations and strengths are preliminary starting values). */
export const GACHA = {
  /** Faith per believer of the god and tick (week). */
  faithPerBeliever: 0.001,
  /** Price of the n-th pull: round(priceBase * n^priceExp). */
  priceBase: 75,
  priceExp: 1.8,
  /** Abilities per pull. */
  perPull: 3,
  /** Tier weights (Common, Rare, Epic, Legendary), percent. */
  tierWeights: [50, 30, 15, 5] as readonly number[],
  /** A people starts worshipping a god from this share of believers and stops below `worshipEnd`. */
  worshipStart: 0.55,
  worshipEnd: 0.45,
  /** Cap of the "Divine" satisfaction part (+- per people). */
  divineCap: 15,
  /** Wild Fire: weeks a hex burns, chance per week to light each burnable neighbor, hexes per fire, danger while burning, inhabitants lost per week, game left. */
  fireWeeks: 6,
  fireSpread: 0.15,
  fireMaxHexes: 40,
  fireDanger: 0.3,
  fireDeaths: 0.03,
  fireGame: 0.3,
  /** Great River: longest path, river flow of a new stream (1 = the smallest river of the generator). */
  riverMax: 12,
  streamFlow: 1,
  /** Prophet's Light / Doubt: one-time change of every inhabitant's faith. */
  faithOnce: 0.15,
};

/** At most this many timed effects at once (Requirement 7.1), and burning hexes (7.3). */
export const MAX_EFFECTS = 256;
export const MAX_FIRES = 64;
/** Hexes of the largest area (radius 3). */
const MAX_AREA = 37;
/** Casts that wait for the next tick's start (a cast while a tick runs in parts). */
const MAX_PENDING = 64;
/** Changed hexes the map can ask for (ring buffer, see landChanges). */
export const LAND_CHANGES = 512;

export const Tier = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 } as const;
export const TIER_NAMES = ['Common', 'Rare', 'Epic', 'Legendary'] as const;
export const Category = { Land: 0, People: 1, Leader: 2 } as const;
export const CATEGORY_NAMES = ['Land', 'Peoples', 'Leaders'] as const;
/** What a charge is cast on: a hex (its center), a people, a people's leader. */
export const TargetKind = { Hex: 0, People: 1, Leader: 2 } as const;

/** Ability ids (Requirement section 6, number - 1). Stored as charges per id: append only. */
export const Ab = {
  FertileBlessing: 0,
  ExhaustedSoil: 1,
  WideFoundations: 2,
  CrampedGround: 3,
  Drought: 4,
  RichVein: 5,
  GreatRiver: 6,
  WildFire: 7,
  BiomeShift: 8,
  FruitfulWaters: 9,
  LeanYears: 10,
  GratefulHearts: 11,
  RestlessSpirits: 12,
  Wanderlust: 13,
  ProphetsLight: 14,
  Doubt: 15,
  GoldenHarvest: 16,
  GiftOfTrait: 17,
  MarkOfWeakness: 18,
  LongLife: 19,
  BrittleCrown: 20,
  RerollDestiny: 21,
  YoungHeir: 22,
  HonedMind: 23,
  DynastysHeir: 24,
} as const;
export const ABILITY_COUNT = 25;

export type Ability = {
  id: number;
  name: string;
  tier: number;
  category: number;
  target: number;
  /** Radius of the area around the target hex (0 = the hex, 1 = 7 hexes, 3 = 37); -1 for other shapes (river, fire). */
  radius: number;
  /** Years a timed effect lasts; 0 = at once / permanent. */
  years: number;
  /** One line for the inventory, with the numbers. */
  about: string;
};

/** The 25 abilities (Requirement section 6). Index = id. */
export const ABILITIES: readonly Ability[] = [
  { id: 0, name: 'Fertile Blessing', tier: Tier.Common, category: Category.Land, target: TargetKind.Hex, radius: 1, years: 20, about: 'Fertility of 7 hexes rises to its capacity, and the capacity ×1.25 (at most 1) for 20 years.' },
  { id: 1, name: 'Exhausted Soil', tier: Tier.Common, category: Category.Land, target: TargetKind.Hex, radius: 0, years: 0, about: 'All resources of a hex fall to 10 % of their amount.' },
  { id: 2, name: 'Wide Foundations', tier: Tier.Rare, category: Category.Land, target: TargetKind.Hex, radius: 0, years: 0, about: '+1 building slot on a hex, for good.' },
  { id: 3, name: 'Cramped Ground', tier: Tier.Rare, category: Category.Land, target: TargetKind.Hex, radius: 0, years: 0, about: '−1 building slot on a hex, for good; never below the slots in use.' },
  { id: 4, name: 'Drought', tier: Tier.Rare, category: Category.Land, target: TargetKind.Hex, radius: 3, years: 20, about: 'Moisture −0.25 on 37 hexes for 20 years: less rain water.' },
  { id: 5, name: 'Rich Vein', tier: Tier.Rare, category: Category.Land, target: TargetKind.Hex, radius: 0, years: 0, about: 'A metal or mineral deposit fitting the land appears on a hex without one.' },
  { id: 6, name: 'Great River', tier: Tier.Legendary, category: Category.Land, target: TargetKind.Hex, radius: -1, years: 0, about: 'A river springs from a land hex and flows downhill, up to 12 hexes; in a basin it ends in a lake.' },
  { id: 7, name: 'Wild Fire', tier: Tier.Epic, category: Category.Land, target: TargetKind.Hex, radius: -1, years: 0, about: 'A forest, jungle or savanna burns and the fire spreads (up to 40 hexes): wood gone, buildings ruined, the land turns to plains.' },
  { id: 8, name: 'Biome Shift', tier: Tier.Legendary, category: Category.Land, target: TargetKind.Hex, radius: 1, years: 0, about: 'The land of 7 hexes turns one step wetter or drier.' },
  { id: 9, name: 'Fruitful Waters', tier: Tier.Common, category: Category.People, target: TargetKind.People, radius: 0, years: 30, about: 'Birth rate +10 % for 30 years.' },
  { id: 10, name: 'Lean Years', tier: Tier.Common, category: Category.People, target: TargetKind.People, radius: 0, years: 30, about: 'Birth rate −10 % for 30 years.' },
  { id: 11, name: 'Grateful Hearts', tier: Tier.Common, category: Category.People, target: TargetKind.People, radius: 0, years: 30, about: 'Satisfaction +3 for 30 years.' },
  { id: 12, name: 'Restless Spirits', tier: Tier.Common, category: Category.People, target: TargetKind.People, radius: 0, years: 30, about: 'Satisfaction −3 for 30 years.' },
  { id: 13, name: 'Wanderlust', tier: Tier.Common, category: Category.People, target: TargetKind.People, radius: 0, years: 15, about: 'Settlers set out earlier (overload factor −0.05) and travel farther (travel cost ×0.8) for 15 years.' },
  { id: 14, name: "Prophet's Light", tier: Tier.Rare, category: Category.People, target: TargetKind.People, radius: 0, years: 10, about: 'Faith in you +0.15 for everyone at once, and devotion +0.03 a year for 10 years.' },
  { id: 15, name: 'Doubt', tier: Tier.Rare, category: Category.People, target: TargetKind.People, radius: 0, years: 10, about: 'Faith in all gods −0.15 for everyone at once, and −0.03 a year for 10 years.' },
  { id: 16, name: 'Golden Harvest', tier: Tier.Epic, category: Category.People, target: TargetKind.People, radius: 0, years: 20, about: 'Yield of mines and deposits and merchant load +15 % for 20 years.' },
  { id: 17, name: 'Gift of Trait', tier: Tier.Epic, category: Category.Leader, target: TargetKind.Leader, radius: 0, years: 0, about: 'The leader gains a random trait, beyond the 3.' },
  { id: 18, name: 'Mark of Weakness', tier: Tier.Epic, category: Category.Leader, target: TargetKind.Leader, radius: 0, years: 0, about: 'The leader gains a random weakening trait: Craven, Weak Hand, Tyrant, Tax Hawk, Xenophobe or Stubborn.' },
  { id: 19, name: 'Long Life', tier: Tier.Rare, category: Category.Leader, target: TargetKind.Leader, radius: 0, years: 0, about: 'The leader dies later: death is rolled as if 10 years younger.' },
  { id: 20, name: 'Brittle Crown', tier: Tier.Rare, category: Category.Leader, target: TargetKind.Leader, radius: 0, years: 0, about: 'The leader dies earlier: death is rolled as if 10 years older.' },
  { id: 21, name: 'Reroll Destiny', tier: Tier.Rare, category: Category.Leader, target: TargetKind.Leader, radius: 0, years: 0, about: 'The leader follows a new goal; its progress starts over.' },
  { id: 22, name: 'Young Heir', tier: Tier.Rare, category: Category.Leader, target: TargetKind.Leader, radius: 0, years: 0, about: 'The next successor takes office at 20.' },
  { id: 23, name: 'Honed Mind', tier: Tier.Epic, category: Category.Leader, target: TargetKind.Leader, radius: 0, years: 0, about: "One of the leader's traits at random acts 1.5 times as strongly." },
  { id: 24, name: "Dynasty's Heir", tier: Tier.Epic, category: Category.Leader, target: TargetKind.Leader, radius: 0, years: 0, about: "The next successor surely inherits one of the leader's traits." },
];

/** Ability ids per tier, for the draw. */
const BY_TIER: number[][] = [[], [], [], []];
for (const a of ABILITIES) BY_TIER[a.tier].push(a.id);

/** Weakening attributes of Mark of Weakness (leaderRules.ts ATTRS ids): Craven, Weak Hand, Tyrant, Tax Hawk, Xenophobe, Stubborn. */
export const WEAKENING: readonly number[] = [5, 23, 21, 14, 8, 4];
/** Deposits Rich Vein can lay (Requirement 6.1). */
const VEINS: readonly number[] = [Deposit.Copper, Deposit.Tin, Deposit.Iron, Deposit.Gold, Deposit.Salt, Deposit.Flint, Deposit.Marble, Deposit.Gems];
/** Burnable biomes (Wild Fire). */
const burnable = (biome: number) => biome === Biome.Forest || biome === Biome.Jungle || biome === Biome.Savanna;
const MYSTIC = (deposit: number) => deposit === Deposit.HolySpring || deposit === Deposit.SacredGrove || deposit === Deposit.Meteorite || deposit === Deposit.AncientRuins;

/** Biome Shift: the wetter (option 0) and drier (option 1) neighbor of each biome, -1 = stays (Requirement 7.4). */
export const SHIFT_WETTER = 0;
export const SHIFT_DRIER = 1;
const SHIFT = new Int8Array(2 * 13).fill(-1);

/**
 * The chains Desert - Savanna - Plains - Forest - Jungle - Swamp, Tundra - Plains, Hills - Mountains,
 * Hills - Plains: "wetter" is one step towards Swamp, "drier" one step towards Desert, along the shortest
 * way in these chains (so Tundra and Hills step to Plains and Mountains to Hills either way); at a chain's
 * end the hex stays.
 */
function buildShift(): void {
  const edges: [number, number][] = [
    [Biome.Desert, Biome.Savanna],
    [Biome.Savanna, Biome.Plains],
    [Biome.Plains, Biome.Forest],
    [Biome.Forest, Biome.Jungle],
    [Biome.Jungle, Biome.Swamp],
    [Biome.Tundra, Biome.Plains],
    [Biome.Hills, Biome.Mountains],
    [Biome.Hills, Biome.Plains],
  ];
  const dist = (from: number) => {
    const d = new Int8Array(13).fill(-1);
    d[from] = 0;
    for (let changed = true; changed; ) {
      changed = false;
      for (const [a, b] of edges) {
        if (d[a] >= 0 && d[b] < 0) d[b] = d[a] + 1;
        else if (d[b] >= 0 && d[a] < 0) d[a] = d[b] + 1;
        else continue;
        changed = true;
      }
    }
    return d;
  };
  const toSwamp = dist(Biome.Swamp);
  const toDesert = dist(Biome.Desert);
  for (let opt = 0; opt < 2; opt++) {
    const to = opt === SHIFT_WETTER ? toSwamp : toDesert;
    for (let b = 0; b < 13; b++) {
      if (to[b] <= 0) continue;
      for (const [x, y] of edges) {
        const other = x === b ? y : y === b ? x : -1;
        if (other >= 0 && to[other] === to[b] - 1) SHIFT[opt * 13 + b] = other;
      }
    }
  }
}
buildShift();

/** The biome a hex of `biome` shifts to (-1 = stays). */
export function shiftedBiome(biome: number, option: number): number {
  return biome < 13 ? SHIFT[option * 13 + biome] : -1;
}

export type Gacha = {
  rng: Rng;
  /** The player's Faith (no cap) and pulls so far (the price of the next). */
  faith: number;
  pulls: number;
  /** Charges per ability (inventory, no cap). */
  charges: Int32Array;
  /** Peoples worshipping each god: civ * GODS + god (Requirement 7.7, derived with hysteresis). */
  worship: Uint8Array;
  /** The god's lever set, people x LEVERS (neutral 0 / 1 like the leader's), combined into sim.leaders.lev. */
  godLev: Float32Array;
  /** Devotion the god layer adds per year to every inhabitant's faith in each god: civ * GODS + god. */
  godDevotion: Float32Array;
  /** Satisfaction part "Divine" per people, within +-GACHA.divineCap. */
  divine: Float32Array;
  /** Timed effects (Requirement 7.1): ability (-1 = free entry), target (hex center or people), end tick, hexes touched and the amount each got. */
  effAbility: Int8Array;
  effTarget: Int32Array;
  effEnd: Int32Array;
  effCount: Uint8Array;
  effCells: Int32Array;
  effDelta: Float32Array;
  /** Tick at which the earliest effect ends (Infinity: none). */
  nextEnd: number;
  /** Burning hexes (Requirement 7.3): hex, weeks left, fire, the danger it got; `burning` per hex marks them for the map. */
  fireCell: Int32Array;
  fireWeeks: Uint8Array;
  fireId: Uint8Array;
  fireDanger: Float32Array;
  fireCount: number;
  /** Hexes per fire so far (fire ids 0..MAX_FIRES-1). */
  fireSize: Uint8Array;
  burning: Uint8Array;
  /** Casts waiting for the next tick's start: ability, target, option. */
  pendAbility: Int8Array;
  pendTarget: Int32Array;
  pendOption: Int8Array;
  pendCount: number;
  /**
   * Changes of the land the map draws (biome, river, ruins, fire): `landVersion` counts them; the last
   * LAND_CHANGES changed hexes are in `landChanged` (ring, index landTotal % LAND_CHANGES). The map redraws only
   * those hexes, or everything when it fell more than LAND_CHANGES behind.
   */
  landVersion: number;
  landTotal: number;
  landChanged: Int32Array;
  /** Scratch: hexes of an area (BFS stamp per hex). */
  stamp: Uint32Array;
  stampNow: number;
};

export function createGacha(seed: number, cellCount: number): Gacha {
  const godLev = new Float32Array(LEADER_CIVS * LEVERS);
  for (let c = 0; c < LEADER_CIVS; c++) setIdentity(godLev, c);
  return {
    rng: createRng(deriveSeed(seed, 'gacha')),
    faith: 0,
    pulls: 0,
    charges: new Int32Array(ABILITY_COUNT),
    worship: new Uint8Array(LEADER_CIVS * GODS),
    godLev,
    godDevotion: new Float32Array(LEADER_CIVS * GODS),
    divine: new Float32Array(LEADER_CIVS),
    effAbility: new Int8Array(MAX_EFFECTS).fill(-1),
    effTarget: new Int32Array(MAX_EFFECTS),
    effEnd: new Int32Array(MAX_EFFECTS),
    effCount: new Uint8Array(MAX_EFFECTS),
    effCells: new Int32Array(MAX_EFFECTS * MAX_AREA),
    effDelta: new Float32Array(MAX_EFFECTS * MAX_AREA),
    nextEnd: Infinity,
    fireCell: new Int32Array(MAX_FIRES),
    fireWeeks: new Uint8Array(MAX_FIRES),
    fireId: new Uint8Array(MAX_FIRES),
    fireDanger: new Float32Array(MAX_FIRES),
    fireCount: 0,
    fireSize: new Uint8Array(MAX_FIRES),
    burning: new Uint8Array(cellCount),
    pendAbility: new Int8Array(MAX_PENDING),
    pendTarget: new Int32Array(MAX_PENDING),
    pendOption: new Int8Array(MAX_PENDING),
    pendCount: 0,
    landVersion: 0,
    landTotal: 0,
    landChanged: new Int32Array(LAND_CHANGES),
    stamp: new Uint32Array(cellCount),
    stampNow: 0,
  };
}

const TICKS_PER_YEAR = 52;

// ---------------------------------------------------------------------------
// Faith, price, pull

/** Price of the n-th pull of the game (n from 1). */
export function pullPrice(n: number): number {
  return Math.round(GACHA.priceBase * Math.pow(n, GACHA.priceExp));
}

/** Price of the next pull. */
export function nextPullPrice(sim: Simulation): number {
  return pullPrice(sim.gacha.pulls + 1);
}

/** Per tick: Faith from the god's believers in all peoples (the last count, sim.believers). */
export function accrueFaith(sim: Simulation): void {
  sim.gacha.faith += GACHA.faithPerBeliever * sim.believers;
}

/** Draws one ability: a tier by weight, then uniformly within it. */
export function drawAbility(rng: Rng): number {
  const w = GACHA.tierWeights;
  let sum = 0;
  for (let t = 0; t < w.length; t++) sum += w[t];
  let r = rng() * sum;
  let tier = w.length - 1;
  for (let t = 0; t < w.length; t++) {
    r -= w[t];
    if (r < 0) {
      tier = t;
      break;
    }
  }
  const list = BY_TIER[tier];
  return list[Math.floor(rng() * list.length)];
}

/**
 * A pull (Requirement section 3): pays the next price and puts GACHA.perPull abilities into the inventory.
 * Returns their ids in drawing order, or null without enough Faith.
 */
export function pullGacha(sim: Simulation): number[] | null {
  const g = sim.gacha;
  const price = nextPullPrice(sim);
  if (g.faith < price) return null;
  g.faith -= price;
  g.pulls++;
  const out: number[] = [];
  for (let i = 0; i < GACHA.perPull; i++) {
    const a = drawAbility(g.rng);
    g.charges[a]++;
    out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Worship (Requirement 7.7)

/** Whether people `civ` worships `god`. */
export function worships(sim: Simulation, civ: number, god = PLAYER_GOD): boolean {
  return civ > 0 && civ < LEADER_CIVS && sim.gacha.worship[civ * GODS + god] === 1;
}

/** Sets the worship of `civ` for `god` (the player's also in `civ.worshipsPlayer`). */
export function setWorship(sim: Simulation, civ: number, god: number, on: boolean): void {
  sim.gacha.worship[civ * GODS + god] = on ? 1 : 0;
  const people = sim.civs[civ];
  if (people && god === PLAYER_GOD) people.worshipsPlayer = on;
}

/** Yearly (with the peoples' year): a people worships the god from GACHA.worshipStart of believers on and stops below GACHA.worshipEnd. */
export function updateWorship(sim: Simulation): void {
  for (let id = 1; id < sim.civs.length; id++) {
    const civ = sim.civs[id];
    if (!civ || civ.population <= 0) continue;
    const share = civ.believers / civ.population;
    const now = worships(sim, id, PLAYER_GOD);
    if (!now && share >= GACHA.worshipStart) setWorship(sim, id, PLAYER_GOD, true);
    else if (now && share < GACHA.worshipEnd) setWorship(sim, id, PLAYER_GOD, false);
  }
}

// ---------------------------------------------------------------------------
// Targets

/** Hexes within `radius` of `center` into g.areaOut (BFS); returns the count. Land only unless `water`. */
const areaOut = new Int32Array(MAX_AREA);
const frontierA = new Int32Array(MAX_AREA);
function area(sim: Simulation, center: number, radius: number, water: boolean): number {
  const g = sim.gacha;
  const w = sim.world;
  g.stampNow = (g.stampNow + 1) >>> 0;
  if (g.stampNow === 0) {
    g.stamp.fill(0);
    g.stampNow = 1;
  }
  const stamp = g.stamp;
  let n = 0;
  let head = 0;
  let tail = 0;
  frontierA[tail++] = center;
  stamp[center] = g.stampNow;
  // Ring by ring: the frontier holds ring r between `ringStart` and `tail`.
  for (let r = 0; r <= radius; r++) {
    const ringEnd = tail;
    for (; head < ringEnd; head++) {
      const c = frontierA[head];
      if (water || !isWaterBiome(w.biome[c])) areaOut[n++] = c;
      if (r === radius) continue;
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const nb = w.neighbors[c * DIRECTION_COUNT + d];
        if (nb < 0 || stamp[nb] === g.stampNow) continue;
        stamp[nb] = g.stampNow;
        frontierA[tail++] = nb;
      }
    }
  }
  return n;
}

const isLand = (sim: Simulation, cell: number) => cell >= 0 && cell < sim.world.cellCount && !isWaterBiome(sim.world.biome[cell]);
const livingPeople = (sim: Simulation, civ: number) => civ > 0 && civ < sim.civs.length && sim.civs[civ] !== null;
const hasLeader = (sim: Simulation, civ: number) => livingPeople(sim, civ) && civ < LEADER_CIVS && sim.leaders.has[civ] === 1;

/** Deposits Rich Vein could lay on `cell` (weights by frequency), into veinPick; returns the count. */
const veinPick = new Int32Array(8);
function veinChoices(sim: Simulation, cell: number): number {
  const b = sim.world.biome[cell];
  let n = 0;
  for (const d of VEINS) if (DEPOSITS[d].biomes.includes(b as never)) veinPick[n++] = d;
  return n;
}

/** Whether Cramped Ground may take a slot of `cell`: one above the slots in use in each part. */
function slotTaken(sim: Simulation, cell: number): number {
  return Math.max(takenSlots(sim.economy, cell, 0), takenSlots(sim.economy, cell, 1));
}

/** Room left in the timed-effect list (a replaced effect frees its own entry). */
function effectRoom(sim: Simulation, ability: number, target: number): boolean {
  const g = sim.gacha;
  for (let i = 0; i < MAX_EFFECTS; i++) if (g.effAbility[i] < 0 || (g.effAbility[i] === ability && g.effTarget[i] === target)) return true;
  return false;
}

/**
 * Whether a charge of `ability` may be cast on `target` (a hex for land abilities, a people id for people and
 * leader abilities); `option` is Biome Shift's direction (SHIFT_WETTER / SHIFT_DRIER). Invalid targets are shown
 * grey and cost no charge (Requirement section 5).
 */
export function canCast(sim: Simulation, ability: number, target: number, option = 0): boolean {
  const g = sim.gacha;
  const w = sim.world;
  switch (ability) {
    case Ab.FertileBlessing:
    case Ab.Drought:
      return isLand(sim, target) && effectRoom(sim, ability, target);
    case Ab.ExhaustedSoil:
    case Ab.GreatRiver:
      return isLand(sim, target);
    case Ab.WideFoundations:
      return isLand(sim, target) && usableSlots(sim, target) + 1 - biomeSlots(w.biome[target]) <= 127;
    case Ab.CrampedGround: {
      if (!isLand(sim, target)) return false;
      const u = usableSlots(sim, target);
      return u > slotTaken(sim, target) && u - 1 - biomeSlots(w.biome[target]) >= -128;
    }
    case Ab.RichVein:
      return isLand(sim, target) && w.deposit[target] === Deposit.None && veinChoices(sim, target) > 0;
    case Ab.WildFire:
      return isLand(sim, target) && burnable(w.biome[target]) && g.burning[target] === 0 && g.fireCount < MAX_FIRES && freeFireId(sim) >= 0;
    case Ab.BiomeShift: {
      if (!isLand(sim, target) || (option !== SHIFT_WETTER && option !== SHIFT_DRIER)) return false;
      const n = area(sim, target, 1, false);
      for (let i = 0; i < n; i++) if (shiftable(sim, areaOut[i]) && shiftedBiome(w.biome[areaOut[i]], option) >= 0) return true;
      return false;
    }
    case Ab.FruitfulWaters:
    case Ab.LeanYears:
    case Ab.GratefulHearts:
    case Ab.RestlessSpirits:
    case Ab.Wanderlust:
    case Ab.ProphetsLight:
    case Ab.Doubt:
    case Ab.GoldenHarvest:
      return livingPeople(sim, target) && target < LEADER_CIVS && effectRoom(sim, ability, target);
    case Ab.GiftOfTrait:
      return hasLeader(sim, target) && godTraitChoices(sim, target, null) > 0;
    case Ab.MarkOfWeakness:
      return hasLeader(sim, target) && godTraitChoices(sim, target, WEAKENING) > 0;
    case Ab.LongLife:
    case Ab.BrittleCrown:
    case Ab.YoungHeir:
    case Ab.DynastysHeir:
      return hasLeader(sim, target);
    case Ab.HonedMind:
      return hasLeader(sim, target) && traitCount(sim, target) > 0;
    case Ab.RerollDestiny:
      return hasLeader(sim, target) && canRerollGoal(sim, target);
  }
  return false;
}

/** Biome Shift leaves sea, lakes, ice and hexes with a mystic deposit as they are. */
function shiftable(sim: Simulation, cell: number): boolean {
  const b = sim.world.biome[cell];
  return !isWaterBiome(b) && b !== Biome.Ice && !MYSTIC(sim.world.deposit[cell]);
}

/** Valid targets of `ability` (hexes, or people ids), for the target choice; allocates (UI only). */
export function validTargets(sim: Simulation, ability: number, option = 0): number[] {
  const out: number[] = [];
  const a = ABILITIES[ability];
  if (!a) return out;
  if (a.target === TargetKind.Hex) {
    for (let c = 0; c < sim.world.cellCount; c++) if (canCast(sim, ability, c, option)) out.push(c);
  } else for (let id = 1; id < sim.civs.length; id++) if (canCast(sim, ability, id, option)) out.push(id);
  return out;
}

/**
 * Casts a charge of `ability` on `target` (Requirement section 5): checks the target, uses the charge and
 * starts the effect, at once between ticks, else at the start of the next tick. Returns false (no charge
 * used) without a charge or for an invalid target.
 */
export function castAbility(sim: Simulation, ability: number, target: number, option = 0): boolean {
  const g = sim.gacha;
  if (ability < 0 || ability >= ABILITY_COUNT || g.charges[ability] <= 0) return false;
  if (!canCast(sim, ability, target, option)) return false;
  // A cast in the middle of a tick (the game clock runs it in parts) waits for the next tick's start.
  if (sim.part !== TickPart.Start) {
    if (g.pendCount >= MAX_PENDING) return false;
    g.charges[ability]--;
    g.pendAbility[g.pendCount] = ability;
    g.pendTarget[g.pendCount] = target;
    g.pendOption[g.pendCount] = option;
    g.pendCount++;
    return true;
  }
  g.charges[ability]--;
  applyAbility(sim, ability, target, option);
  return true;
}

/** Casts that waited for this tick's start; one that turned invalid meanwhile gives its charge back. */
function runPending(sim: Simulation): void {
  const g = sim.gacha;
  for (let i = 0; i < g.pendCount; i++) {
    const a = g.pendAbility[i];
    if (canCast(sim, a, g.pendTarget[i], g.pendOption[i])) applyAbility(sim, a, g.pendTarget[i], g.pendOption[i]);
    else g.charges[a]++;
  }
  g.pendCount = 0;
}

// ---------------------------------------------------------------------------
// The tick

/** Start of every tick (simulation.ts, TickPart.Start, before the inhabitants): waiting casts. */
export function startGodTick(sim: Simulation): void {
  if (sim.gacha.pendCount > 0) runPending(sim);
}

/** After the week's inhabitants (simulation.ts): Faith, effects that end, the fires. */
export function advanceGod(sim: Simulation): void {
  const g = sim.gacha;
  accrueFaith(sim);
  if (sim.tick >= g.nextEnd) expireEffects(sim);
  if (g.fireCount > 0) advanceFires(sim);
}

// ---------------------------------------------------------------------------
// Effects

function chronicleCast(sim: Simulation, ability: number, target: number): void {
  const a = ABILITIES[ability];
  let on = '';
  let cell = -1;
  if (a.target === TargetKind.Hex) {
    on = `the ${BIOMES[sim.world.biome[target]].name.toLowerCase()}`;
    cell = target;
  } else {
    const civ = sim.civs[target];
    cell = civ?.capital ?? -1;
    on = a.target === TargetKind.Leader ? `${leaderName(sim.leaders.stem[target], sim.leaders.counter[target])}, leader of the ${civ?.name ?? '?'}` : `the ${civ?.name ?? '?'}`;
  }
  sim.chronicle.push({ tick: sim.tick, text: `You cast ${a.name} on ${on}.`, cell, important: false });
}

function applyAbility(sim: Simulation, ability: number, target: number, option: number): void {
  const g = sim.gacha;
  const w = sim.world;
  // The chronicle names the hex's biome before the change.
  chronicleCast(sim, ability, target);
  switch (ability) {
    case Ab.FertileBlessing:
    case Ab.Drought:
    case Ab.FruitfulWaters:
    case Ab.LeanYears:
    case Ab.GratefulHearts:
    case Ab.RestlessSpirits:
    case Ab.Wanderlust:
    case Ab.ProphetsLight:
    case Ab.Doubt:
    case Ab.GoldenHarvest:
      startEffect(sim, ability, target);
      if (ability === Ab.ProphetsLight) faithOnce(sim, target, GACHA.faithOnce);
      if (ability === Ab.Doubt) faithOnce(sim, target, -GACHA.faithOnce);
      return;
    case Ab.ExhaustedSoil: {
      for (let r = 0; r < RESOURCE_COUNT; r++) w.resources[target * RESOURCE_COUNT + r] *= 0.1;
      updateCellSupply(sim, target);
      return;
    }
    case Ab.WideFoundations:
    case Ab.CrampedGround: {
      const eco = sim.economy;
      const u = usableSlots(sim, target) + (ability === Ab.WideFoundations ? 1 : -1);
      eco.slotMod[target] = u - biomeSlots(w.biome[target]);
      if (eco.slotFloor[target] > u) eco.slotFloor[target] = u;
      if (u > eco.half) growSlots(eco, u);
      return;
    }
    case Ab.RichVein: {
      const n = veinChoices(sim, target);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += DEPOSITS[veinPick[i]].frequency;
      let r = g.rng() * sum;
      let d = veinPick[n - 1];
      for (let i = 0; i < n; i++) {
        r -= DEPOSITS[veinPick[i]].frequency;
        if (r < 0) {
          d = veinPick[i];
          break;
        }
      }
      w.deposit[target] = d;
      refreshCapacity(sim, target);
      updateCellSupply(sim, target);
      landChanged(sim, target);
      return;
    }
    case Ab.GreatRiver:
      greatRiver(sim, target);
      return;
    case Ab.WildFire: {
      const id = freeFireId(sim);
      g.fireSize[id] = 0;
      ignite(sim, target, id);
      return;
    }
    case Ab.BiomeShift: {
      const n = area(sim, target, 1, false);
      // areaOut is reused by setBiome's helpers: copy first.
      for (let i = 0; i < n; i++) shiftCells[i] = areaOut[i];
      for (let i = 0; i < n; i++) {
        const c = shiftCells[i];
        if (!shiftable(sim, c)) continue;
        const to = shiftedBiome(w.biome[c], option);
        if (to >= 0) setBiome(sim, c, to);
      }
      return;
    }
    case Ab.GiftOfTrait:
      giveGodTrait(sim, target, null, g.rng);
      return;
    case Ab.MarkOfWeakness:
      giveGodTrait(sim, target, WEAKENING, g.rng);
      return;
    case Ab.LongLife:
    case Ab.BrittleCrown:
      sim.leaders.ageShift[target] = ability === Ab.LongLife ? -LEADER.ageShift : LEADER.ageShift;
      return;
    case Ab.RerollDestiny:
      rerollGoal(sim, target, g.rng);
      return;
    case Ab.YoungHeir:
      sim.leaders.youngHeir[target] = 1;
      return;
    case Ab.DynastysHeir:
      sim.leaders.heirInherits[target] = 1;
      return;
    case Ab.HonedMind:
      honeTrait(sim, target, g.rng);
      return;
  }
}
const shiftCells = new Int32Array(7);

/** A timed effect starts: the same ability on the same target replaces the running one (its duration starts over). */
function startEffect(sim: Simulation, ability: number, target: number): void {
  const g = sim.gacha;
  let slot = -1;
  for (let i = 0; i < MAX_EFFECTS; i++) {
    if (g.effAbility[i] === ability && g.effTarget[i] === target) {
      endEffect(sim, i);
      slot = i;
      break;
    }
  }
  if (slot < 0) for (let i = 0; i < MAX_EFFECTS && slot < 0; i++) if (g.effAbility[i] < 0) slot = i;
  if (slot < 0) return;
  g.effAbility[slot] = ability;
  g.effTarget[slot] = target;
  g.effEnd[slot] = sim.tick + ABILITIES[ability].years * TICKS_PER_YEAR;
  g.effCount[slot] = 0;
  if (g.effEnd[slot] < g.nextEnd) g.nextEnd = g.effEnd[slot];
  if (ability === Ab.FertileBlessing || ability === Ab.Drought) applyLand(sim, slot);
  else recomputeGod(sim, target);
}

/** Land effect of entry `slot` begins: each hex's change is kept, so its end takes exactly that off again. */
function applyLand(sim: Simulation, slot: number): void {
  const g = sim.gacha;
  const w = sim.world;
  const ability = g.effAbility[slot];
  const n = area(sim, g.effTarget[slot], ABILITIES[ability].radius, false);
  const o = slot * MAX_AREA;
  for (let i = 0; i < n; i++) {
    const c = areaOut[i];
    g.effCells[o + i] = c;
    if (ability === Ab.FertileBlessing) {
      const k = c * RESOURCE_COUNT + Resource.Fertility;
      const before = w.resourceCapacity[k];
      w.resourceCapacity[k] = Math.min(1, before * 1.25);
      g.effDelta[o + i] = w.resourceCapacity[k] - before;
      // Fertility at once up to the (new) capacity.
      w.resources[k] = w.resourceCapacity[k];
    } else {
      const before = w.moisture[c];
      w.moisture[c] = before - 0.25;
      g.effDelta[o + i] = w.moisture[c] - before;
    }
    updateCellSupply(sim, c);
  }
  g.effCount[slot] = n;
}

/** Ends entry `slot`: land changes are taken off, a people's god layer is recomputed. */
function endEffect(sim: Simulation, slot: number): void {
  const g = sim.gacha;
  const w = sim.world;
  const ability = g.effAbility[slot];
  if (ability < 0) return;
  g.effAbility[slot] = -1;
  if (ability === Ab.FertileBlessing || ability === Ab.Drought) {
    const o = slot * MAX_AREA;
    for (let i = 0; i < g.effCount[slot]; i++) {
      const c = g.effCells[o + i];
      if (ability === Ab.FertileBlessing) {
        const k = c * RESOURCE_COUNT + Resource.Fertility;
        w.resourceCapacity[k] = Math.max(0, w.resourceCapacity[k] - g.effDelta[o + i]);
        // The fertility stays within its natural capacity.
        if (w.resources[k] > w.resourceCapacity[k]) w.resources[k] = w.resourceCapacity[k];
      } else w.moisture[c] -= g.effDelta[o + i];
      updateCellSupply(sim, c);
    }
    g.effCount[slot] = 0;
  } else recomputeGod(sim, g.effTarget[slot]);
}

function expireEffects(sim: Simulation): void {
  const g = sim.gacha;
  let next = Infinity;
  for (let i = 0; i < MAX_EFFECTS; i++) {
    if (g.effAbility[i] < 0) continue;
    if (g.effEnd[i] <= sim.tick) endEffect(sim, i);
    else if (g.effEnd[i] < next) next = g.effEnd[i];
  }
  g.nextEnd = next;
}

/** The god layer of people `civ` from its running effects: levers, devotion, the "Divine" part; then its combined lever set. */
function recomputeGod(sim: Simulation, civ: number): void {
  const g = sim.gacha;
  if (civ <= 0 || civ >= LEADER_CIVS) return;
  const o = civ * LEVERS;
  setIdentity(g.godLev, civ);
  let light = 0;
  let doubt = 0;
  let divine = 0;
  for (let i = 0; i < MAX_EFFECTS; i++) {
    const a = g.effAbility[i];
    if (a < 0 || g.effTarget[i] !== civ) continue;
    if (a === Ab.FruitfulWaters) g.godLev[o + L.birth] *= 1.1;
    else if (a === Ab.LeanYears) g.godLev[o + L.birth] *= 0.9;
    else if (a === Ab.GratefulHearts) divine += 3;
    else if (a === Ab.RestlessSpirits) divine -= 3;
    else if (a === Ab.Wanderlust) {
      g.godLev[o + L.settleOver] *= 0.95;
      g.godLev[o + L.travel] *= 0.8;
    } else if (a === Ab.ProphetsLight) light += 0.03;
    else if (a === Ab.Doubt) doubt += 0.03;
    else if (a === Ab.GoldenHarvest) {
      g.godLev[o + L.harvest] *= 1.15;
      g.godLev[o + L.load] *= 1.15;
    }
  }
  // Prophet's Light belongs to the casting god (the player's); Doubt acts on every god.
  for (let god = 0; god < GODS; god++) g.godDevotion[civ * GODS + god] = -doubt + (god === PLAYER_GOD ? light : 0);
  g.divine[civ] = clamp(divine, -GACHA.divineCap, GACHA.divineCap);
  combineLevers(sim, civ);
}

/** Prophet's Light (+) or Doubt (-): every inhabitant's faith of people `civ` changes once, booked in the faith ledger. */
function faithOnce(sim: Simulation, civ: number, amount: number): void {
  const pop = sim.pop;
  const people = sim.civs[civ];
  if (!people) return;
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i] || pop.civ[i] !== civ) continue;
    const before = pop.faith[i];
    pop.faith[i] = clamp(before + amount, 0, 1);
    const was = before >= BELIEVER_FAITH;
    const is = pop.faith[i] >= BELIEVER_FAITH;
    if (!was && is) people.faithYear.divineLight++;
    else if (was && !is) people.faithYear.divineDoubt++;
  }
}

/** A people founded under id `civ` (also a reused one): no god effects, no worship. */
export function resetGodCiv(sim: Simulation, civ: number): void {
  const g = sim.gacha;
  if (civ <= 0 || civ >= LEADER_CIVS) return;
  for (let i = 0; i < MAX_EFFECTS; i++) {
    if (g.effAbility[i] < 0 || g.effTarget[i] !== civ || ABILITIES[g.effAbility[i]].target === TargetKind.Hex) continue;
    g.effAbility[i] = -1;
  }
  for (let god = 0; god < GODS; god++) g.worship[civ * GODS + god] = 0;
  recomputeGod(sim, civ);
}

// ---------------------------------------------------------------------------
// The land

function landChanged(sim: Simulation, cell: number): void {
  const g = sim.gacha;
  g.landChanged[g.landTotal % LAND_CHANGES] = cell;
  g.landTotal++;
  g.landVersion++;
}

/** Natural capacities of `cell` from its biome and terrain (like generation), with the running Fertile Blessings on it. */
function refreshCapacity(sim: Simulation, cell: number): void {
  const g = sim.gacha;
  const w = sim.world;
  for (let r = 0; r < RESOURCE_COUNT; r++) w.resourceCapacity[cell * RESOURCE_COUNT + r] = sumTerms(resourceCapacityTerms(w, cell, r));
  for (let i = 0; i < MAX_EFFECTS; i++) {
    if (g.effAbility[i] !== Ab.FertileBlessing) continue;
    const o = i * MAX_AREA;
    for (let k = 0; k < g.effCount[i]; k++) {
      if (g.effCells[o + k] !== cell) continue;
      const j = cell * RESOURCE_COUNT + Resource.Fertility;
      w.resourceCapacity[j] = Math.min(1, w.resourceCapacity[j] + g.effDelta[o + k]);
    }
  }
}

/**
 * Hex `cell` gets biome `biome` (Biome Shift, a burnt-out fire, a lake): capacities, danger and travel cost
 * anew from the biome table (Requirement 7.4); current resources, moisture, temperature, roads, buildings,
 * owner and people stay. Its usable slots never drop below the ones in use.
 */
export function setBiome(sim: Simulation, cell: number, biome: number): void {
  const w = sim.world;
  const g = sim.gacha;
  const eco = sim.economy;
  w.biome[cell] = biome;
  refreshCapacity(sim, cell);
  const info = BIOMES[biome];
  w.danger[cell] = clamp(info.danger * (1.3 - w.terrainVariation[cell] * 0.5), 0, 1);
  for (let i = 0; i < g.fireCount; i++) if (g.fireCell[i] === cell) w.danger[cell] += g.fireDanger[i];
  w.moveCost[cell] = info.moveCost;
  const taken = slotTaken(sim, cell);
  if (taken > eco.slotFloor[cell]) eco.slotFloor[cell] = taken;
  updateCellSupply(sim, cell);
  // Neighbors fish in a lake and drink from it.
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = w.neighbors[cell * DIRECTION_COUNT + d];
    if (nb >= 0) updateCellSupply(sim, nb);
  }
  landChanged(sim, cell);
}

/** Standing buildings (and repairs) of `cell` fall to ruins (fire, flood). */
function ruinBuildings(sim: Simulation, cell: number): void {
  const eco = sim.economy;
  let any = false;
  for (let s = cell * eco.slots, end = s + eco.slots; s < end; s++) {
    if (eco.state[s] !== SlotState.Standing && eco.state[s] !== SlotState.Repair) continue;
    eco.state[s] = SlotState.Ruin;
    eco.work[s] = 0;
    eco.unpaid[s] = 0;
    any = true;
  }
  if (!any) return;
  updateTradeBuildings(sim, cell);
  updateCellSupply(sim, cell);
  sim.world.buildings[cell] = 0;
  landChanged(sim, cell);
}

/** The next path hex of Great River from `cell`: the lowest lower neighbor (tie: more moisture), -1 = none. */
function downhill(sim: Simulation, cell: number): number {
  const w = sim.world;
  let best = -1;
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = w.neighbors[cell * DIRECTION_COUNT + d];
    if (nb < 0 || w.elevation[nb] >= w.elevation[cell]) continue;
    if (best < 0 || w.elevation[nb] < w.elevation[best] || (w.elevation[nb] === w.elevation[best] && w.moisture[nb] > w.moisture[best])) best = nb;
  }
  return best;
}

const pathCells = new Int32Array(16);

/**
 * Great River (Requirement 7.2): from the target downhill until the sea, a lake or a river (it flows into it);
 * a target on a river extends it from its end. Without an outlet (no lower neighbor, or GACHA.riverMax hexes)
 * the last hex becomes a lake, flooding a settlement on it (its buildings fall to ruins).
 */
function greatRiver(sim: Simulation, target: number): void {
  const w = sim.world;
  let start = target;
  // A river through the target: its end downstream.
  for (let guard = 0; w.riverFlow[start] > 0 && guard < w.cellCount; guard++) {
    const d = w.riverDir[start];
    const next = d >= 0 ? w.neighbors[start * DIRECTION_COUNT + d] : -1;
    if (next < 0 || isWaterBiome(w.biome[next])) break;
    start = next;
  }
  let n = 0;
  let outlet = -1;
  if (w.riverFlow[start] > 0) {
    // The river's end already flows into the sea or a lake: nothing to extend.
    return;
  }
  let c = start;
  while (n < GACHA.riverMax) {
    pathCells[n++] = c;
    const next = downhill(sim, c);
    if (next < 0) break;
    if (isWaterBiome(w.biome[next]) || w.riverFlow[next] > 0) {
      outlet = next;
      break;
    }
    c = next;
  }
  const last = n - 1;
  for (let i = 0; i < n; i++) {
    const cell = pathCells[i];
    const to = i < last ? pathCells[i + 1] : outlet;
    if (to < 0) break;
    w.riverFlow[cell] = GACHA.streamFlow;
    w.riverDir[cell] = directionTo(sim, cell, to);
    refreshCapacity(sim, cell);
    updateCellSupply(sim, cell);
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = w.neighbors[cell * DIRECTION_COUNT + d];
      if (nb >= 0) updateCellSupply(sim, nb);
    }
    landChanged(sim, cell);
  }
  if (outlet < 0) {
    // A basin: the last hex becomes a lake.
    const lake = pathCells[last];
    w.riverFlow[lake] = 0;
    w.riverDir[lake] = -1;
    ruinBuildings(sim, lake);
    setBiome(sim, lake, Biome.Lake);
  }
}

function directionTo(sim: Simulation, cell: number, to: number): number {
  for (let d = 0; d < DIRECTION_COUNT; d++) if (sim.world.neighbors[cell * DIRECTION_COUNT + d] === to) return d;
  return -1;
}

// ---------------------------------------------------------------------------
// Wild Fire (Requirement 7.3)

function freeFireId(sim: Simulation): number {
  const g = sim.gacha;
  for (let id = 0; id < MAX_FIRES; id++) {
    let used = false;
    for (let i = 0; i < g.fireCount && !used; i++) if (g.fireId[i] === id) used = true;
    if (!used) return id;
  }
  return -1;
}

function ignite(sim: Simulation, cell: number, id: number): void {
  const g = sim.gacha;
  const w = sim.world;
  if (g.fireCount >= MAX_FIRES || g.fireSize[id] >= GACHA.fireMaxHexes) return;
  const i = g.fireCount++;
  g.fireCell[i] = cell;
  g.fireWeeks[i] = GACHA.fireWeeks;
  g.fireId[i] = id;
  const before = w.danger[cell];
  w.danger[cell] = before + GACHA.fireDanger;
  g.fireDanger[i] = w.danger[cell] - before;
  g.fireSize[id]++;
  g.burning[cell] = 1;
  landChanged(sim, cell);
}

/** A week of the fires: inhabitants of burning hexes die, the fire spreads, burnt-out hexes turn to plains. */
function advanceFires(sim: Simulation): void {
  const g = sim.gacha;
  const w = sim.world;
  const pop = sim.pop;
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i] || g.burning[pop.cell[i]] === 0) continue;
    if (g.rng() < GACHA.fireDeaths) killInhabitant(sim, i);
  }
  // Spread from the hexes burning at the week's start (new ones start next week).
  const count = g.fireCount;
  for (let i = 0; i < count; i++) {
    const c = g.fireCell[i];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = w.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || g.burning[nb] || !burnable(w.biome[nb])) continue;
      if (g.rng() < GACHA.fireSpread) ignite(sim, nb, g.fireId[i]);
    }
  }
  for (let i = 0; i < g.fireCount; ) {
    if (--g.fireWeeks[i] > 0) {
      i++;
      continue;
    }
    const c = g.fireCell[i];
    w.danger[c] -= g.fireDanger[i];
    // Remove entry i (the last one moves here) before the biome changes, so setBiome adds no danger for it.
    const last = --g.fireCount;
    g.fireCell[i] = g.fireCell[last];
    g.fireWeeks[i] = g.fireWeeks[last];
    g.fireId[i] = g.fireId[last];
    g.fireDanger[i] = g.fireDanger[last];
    g.burning[c] = 0;
    burnOut(sim, c);
  }
}

/** A hex burnt out: no wood, little game, plains; standing buildings are ruins. */
function burnOut(sim: Simulation, cell: number): void {
  const w = sim.world;
  w.resources[cell * RESOURCE_COUNT + Resource.Wood] = 0;
  w.resources[cell * RESOURCE_COUNT + Resource.Game] *= GACHA.fireGame;
  ruinBuildings(sim, cell);
  setBiome(sim, cell, Biome.Plains);
}

// ---------------------------------------------------------------------------
// What the app reads

/** A running god effect for the panels: the ability, years left (rounded up; 0 for one that lasts until a successor). */
export type GodEffect = { ability: number; name: string; yearsLeft: number };

/** Timed effects on people `civ` (the people's panel). Allocates (UI only). */
export function peopleEffects(sim: Simulation, civ: number): GodEffect[] {
  const g = sim.gacha;
  const out: GodEffect[] = [];
  for (let i = 0; i < MAX_EFFECTS; i++) {
    const a = g.effAbility[i];
    if (a < 0 || g.effTarget[i] !== civ || ABILITIES[a].target !== TargetKind.People) continue;
    out.push({ ability: a, name: ABILITIES[a].name, yearsLeft: Math.ceil((g.effEnd[i] - sim.tick) / TICKS_PER_YEAR) });
  }
  return out;
}

/** Timed effects on hex `cell` (Fertile Blessing, Drought; a fire burning there as Wild Fire with 0 years). Allocates (UI only). */
export function hexEffects(sim: Simulation, cell: number): GodEffect[] {
  const g = sim.gacha;
  const out: GodEffect[] = [];
  for (let i = 0; i < MAX_EFFECTS; i++) {
    const a = g.effAbility[i];
    if (a < 0 || ABILITIES[a].target !== TargetKind.Hex) continue;
    const o = i * MAX_AREA;
    for (let k = 0; k < g.effCount[i]; k++) {
      if (g.effCells[o + k] !== cell) continue;
      out.push({ ability: a, name: ABILITIES[a].name, yearsLeft: Math.ceil((g.effEnd[i] - sim.tick) / TICKS_PER_YEAR) });
      break;
    }
  }
  if (g.burning[cell]) out.push({ ability: Ab.WildFire, name: ABILITIES[Ab.WildFire].name, yearsLeft: 0 });
  return out;
}

/** God interventions on the leader of `civ` that the panel may show (not the death age: Requirement 7.8). Allocates (UI only). */
export function leaderEffects(sim: Simulation, civ: number): GodEffect[] {
  const s = sim.leaders;
  const out: GodEffect[] = [];
  if (civ <= 0 || civ >= LEADER_CIVS) return out;
  if (s.youngHeir[civ]) out.push({ ability: Ab.YoungHeir, name: ABILITIES[Ab.YoungHeir].name, yearsLeft: 0 });
  if (s.heirInherits[civ]) out.push({ ability: Ab.DynastysHeir, name: ABILITIES[Ab.DynastysHeir].name, yearsLeft: 0 });
  return out;
}

/**
 * Hexes the map must redraw since it saw `seenTotal` changes (Gacha.landTotal): into `out`, returns the
 * count, or -1 when it fell more than LAND_CHANGES behind (redraw everything). No allocation.
 */
export function landChanges(sim: Simulation, seenTotal: number, out: Int32Array): number {
  const g = sim.gacha;
  const behind = g.landTotal - seenTotal;
  if (behind > LAND_CHANGES || behind > out.length) return -1;
  for (let k = 0; k < behind; k++) out[k] = g.landChanged[(seenTotal + k) % LAND_CHANGES];
  return behind;
}

/** Name of the attribute (for Gift of Trait / Mark of Weakness results). */
export const traitName = (a: number) => ATTRS[a]?.name ?? '';

import type { Term } from '../terms';
import { RESOURCE_COUNT, Resource } from '../world/biomes';
import { Deposit } from '../world/deposits';
import type { World } from '../world/world';
import { SUPPLY_KINDS, type SupplyModifier } from './supply';

// Buildings and the wood and stone that pay for them (design doc, section 5).
// Every settled hex harvests wood and stone from its own land into a stock
// of its own; buildings raise its food, water or space, or its harvest. All
// state lives in flat typed arrays per cell and slot.

/**
 * What a building improves. The first three are the hex's supplies
 * (SupplyKind), wood and stone its yearly harvest. Comfort serves `amount`
 * people (satisfaction.ts), Seat makes the hex a seat of government, and
 * the luxury goods are harvested from a special deposit (units per year).
 * Merchants and Harbor give a settlement merchants (trade.ts); a harbor also
 * opens the water next to it for trade. Grain and water barrels turn food or
 * water the hex doesn't need into goods to trade (units per year).
 */
export const Good = {
  Food: 0,
  Water: 1,
  Space: 2,
  Wood: 3,
  Stone: 4,
  Comfort: 5,
  Seat: 6,
  Salt: 7,
  Spices: 8,
  Gems: 9,
  Gold: 10,
  Marble: 11,
  Horses: 12,
  Merchants: 13,
  Harbor: 14,
  Grain: 15,
  Barrels: 16,
} as const;
export const GOOD_COUNT = 17;
export const GOOD_NAMES = [
  'Food',
  'Water',
  'Space',
  'Wood',
  'Stone',
  'Comfort',
  'Seat of government',
  'Salt',
  'Spices',
  'Gems',
  'Gold',
  'Marble',
  'Horses',
  'Merchants',
  'Harbor',
  'Grain',
  'Water barrels',
] as const;
/** Luxury goods are Good.Salt .. Good.Horses; `Economy.luxury` holds them in this order. */
export const FIRST_LUXURY = Good.Salt;
export const LUXURY_COUNT = 6;
export const isLuxury = (good: number) => good >= FIRST_LUXURY && good < FIRST_LUXURY + LUXURY_COUNT;
/** Wood or stone: the goods that pay for buildings. */
export const isMaterial = (good: number) => good === Good.Wood || good === Good.Stone;

/** Building materials, as stored in `Economy.stock`. */
export const Material = { Wood: 0, Stone: 1 } as const;
export const MATERIAL_COUNT = 2;

export type BuildingType = {
  name: string;
  good: number;
  /** Absolute effect: people for supplies, units per year for harvests. */
  amount: number;
  /** Percentage effect (0.5 = +50 %); applies after all absolute effects, percentages multiply. */
  percent: number;
  wood: number;
  stone: number;
  /** Paid from the stock once a year. */
  upkeepWood: number;
  upkeepStone: number;
  /** Construction time in years. */
  years: number;
  /** Only on a hex with this special deposit (luxury goods). */
  deposit?: number;
  /** Only where the hex has this much more water than its people need. */
  waterSurplus?: number;
  /** Takes `amount` of this supply (SupplyKind) away from the hex to make its goods. */
  converts?: number;
  /** Only on a hex next to the sea or a lake. */
  coast?: boolean;
};

/**
 * The catalog. Ids are stored per slot in an Int8Array, so the order is part
 * of the save format: append, never reorder. Percentage buildings cost more
 * and pay off on rich land; absolute ones help poor land most.
 */
export const BUILDINGS: readonly BuildingType[] = [
  { name: 'Hut', good: Good.Space, amount: 25, percent: 0, wood: 12, stone: 0, upkeepWood: 1, upkeepStone: 0, years: 1 },
  { name: 'Stone houses', good: Good.Space, amount: 0, percent: 0.5, wood: 20, stone: 30, upkeepWood: 0, upkeepStone: 1, years: 2 },
  { name: 'Fields', good: Good.Food, amount: 25, percent: 0, wood: 15, stone: 0, upkeepWood: 1, upkeepStone: 0, years: 1 },
  { name: 'Irrigation', good: Good.Food, amount: 0, percent: 0.5, wood: 20, stone: 25, upkeepWood: 0, upkeepStone: 1, years: 2 },
  { name: 'Well', good: Good.Water, amount: 25, percent: 0, wood: 5, stone: 12, upkeepWood: 0, upkeepStone: 1, years: 1 },
  { name: 'Cistern', good: Good.Water, amount: 0, percent: 0.5, wood: 15, stone: 30, upkeepWood: 0, upkeepStone: 1, years: 2 },
  { name: 'Lumber camp', good: Good.Wood, amount: 5, percent: 0, wood: 8, stone: 2, upkeepWood: 0, upkeepStone: 1, years: 1 },
  { name: 'Sawmill', good: Good.Wood, amount: 0, percent: 1, wood: 20, stone: 20, upkeepWood: 0, upkeepStone: 1, years: 2 },
  { name: 'Quarry', good: Good.Stone, amount: 5, percent: 0, wood: 10, stone: 0, upkeepWood: 1, upkeepStone: 0, years: 1 },
  { name: 'Stonemason', good: Good.Stone, amount: 0, percent: 1, wood: 20, stone: 20, upkeepWood: 1, upkeepStone: 0, years: 2 },
  // Satisfaction (satisfaction.ts): comfort for this many people, a seat of
  // government, and the luxury goods of special deposits.
  { name: 'Meeting place', good: Good.Comfort, amount: 50, percent: 0, wood: 15, stone: 0, upkeepWood: 1, upkeepStone: 0, years: 1 },
  { name: 'Bathhouse', good: Good.Comfort, amount: 100, percent: 0, wood: 10, stone: 30, upkeepWood: 0, upkeepStone: 1, years: 2, waterSurplus: 25 },
  { name: 'Seat of government', good: Good.Seat, amount: 0, percent: 0, wood: 40, stone: 60, upkeepWood: 2, upkeepStone: 2, years: 3 },
  { name: 'Salt works', good: Good.Salt, amount: 25, percent: 0, wood: 15, stone: 5, upkeepWood: 1, upkeepStone: 0, years: 1, deposit: Deposit.Salt },
  { name: 'Spice garden', good: Good.Spices, amount: 25, percent: 0, wood: 15, stone: 0, upkeepWood: 1, upkeepStone: 0, years: 1, deposit: Deposit.Spices },
  { name: 'Gem mine', good: Good.Gems, amount: 25, percent: 0, wood: 15, stone: 10, upkeepWood: 1, upkeepStone: 0, years: 2, deposit: Deposit.Gems },
  { name: 'Gold mine', good: Good.Gold, amount: 25, percent: 0, wood: 15, stone: 10, upkeepWood: 1, upkeepStone: 0, years: 2, deposit: Deposit.Gold },
  { name: 'Marble quarry', good: Good.Marble, amount: 25, percent: 0, wood: 15, stone: 0, upkeepWood: 1, upkeepStone: 0, years: 1, deposit: Deposit.Marble },
  { name: 'Horse ranch', good: Good.Horses, amount: 25, percent: 0, wood: 20, stone: 0, upkeepWood: 1, upkeepStone: 0, years: 1, deposit: Deposit.WildHorses },
  // Trade (trade.ts): merchants, a harbor with merchants of its own, and
  // food or water the hex can spare turned into goods.
  { name: 'Trade center', good: Good.Merchants, amount: 4, percent: 0, wood: 25, stone: 15, upkeepWood: 1, upkeepStone: 1, years: 2 },
  { name: 'Harbor', good: Good.Harbor, amount: 4, percent: 0, wood: 30, stone: 10, upkeepWood: 1, upkeepStone: 1, years: 2, coast: true },
  { name: 'Granary', good: Good.Grain, amount: 25, percent: 0, wood: 15, stone: 5, upkeepWood: 1, upkeepStone: 0, years: 1, converts: 0 },
  { name: 'Water carriers', good: Good.Barrels, amount: 25, percent: 0, wood: 10, stone: 5, upkeepWood: 1, upkeepStone: 0, years: 1, converts: 1 },
];

/** Building slots per hex (later changed by modifiers). */
export const SLOTS = 4;
/** Repairing a ruin costs this share of the building's cost and time. */
export const REPAIR_SHARE = 0.5;
/** Years a building survives unpaid upkeep before it becomes a ruin. */
export const UPKEEP_GRACE_YEARS = 2;
/** Harvest without buildings ("foraging") per year: a base plus the hex's wood or stone (0..1) times this. */
const FORAGE_BASE = 1;
const FORAGE_PER_RESOURCE = 10;

export const SlotState = { Empty: 0, Construction: 1, Standing: 2, Ruin: 3, Repair: 4 } as const;

/** Wood and stone stock and building slots of every hex. */
export type Economy = {
  /** cell * MATERIAL_COUNT + material. Stays on the ground when a hex is lost. */
  stock: Float32Array;
  /** Building type per slot (cell * SLOTS + slot), -1 = empty. */
  type: Int8Array;
  state: Uint8Array;
  /** Construction or repair: years of work left. */
  work: Float32Array;
  /** Standing: years in a row the upkeep wasn't paid. */
  unpaid: Uint8Array;
  /** Luxury goods in stock: cell * LUXURY_COUNT + (good - FIRST_LUXURY). Stays on the ground like `stock`. */
  luxury: Float32Array;
  /** Money in stock (trade.ts). */
  money: Float32Array;
  /** Grain and water barrels in stock: cell * 2 + (0 grain, 1 water). They feed and water the hex's people. */
  provisions: Float32Array;
  /** Wood and stone the hex saves up for (cell * MATERIAL_COUNT + material), 0 = nothing; buyers ask for the rest. */
  goal: Float32Array;
  /** Bit per luxury good whose yearly need the stock covered at the last year's end. */
  luxuryCovered: Uint8Array;
};

export function createEconomy(cellCount: number): Economy {
  return {
    stock: new Float32Array(cellCount * MATERIAL_COUNT),
    type: new Int8Array(cellCount * SLOTS).fill(-1),
    state: new Uint8Array(cellCount * SLOTS),
    work: new Float32Array(cellCount * SLOTS),
    unpaid: new Uint8Array(cellCount * SLOTS),
    luxury: new Float32Array(cellCount * LUXURY_COUNT),
    money: new Float32Array(cellCount),
    provisions: new Float32Array(cellCount * 2),
    goal: new Float32Array(cellCount * MATERIAL_COUNT),
    luxuryCovered: new Uint8Array(cellCount),
  };
}

/** Wood or stone a hex yields per year by foraging alone. */
export function forageYield(world: World, cell: number, good: number): number {
  return FORAGE_BASE + FORAGE_PER_RESOURCE * world.resources[cell * RESOURCE_COUNT + resourceOf(good)];
}

const resourceOf = (good: number) => (good === Good.Wood ? Resource.Wood : Resource.Stone);

/**
 * A good's value with the hex's standing buildings plus up to two extra
 * types (-1 = none) treated as standing, from its value without buildings:
 * (base + absolute effects) × the product of (1 + percentage). The same
 * calculation as the terms (supplyTerms, harvestTerms), without allocating.
 */
export function withBuildings(eco: Economy, cell: number, good: number, base: number, extraA = -1, extraB = -1): number {
  let add = 0;
  let mul = 1;
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (eco.state[s] !== SlotState.Standing) continue;
    const b = BUILDINGS[eco.type[s]];
    if (b.converts === good) add -= b.amount;
    if (b.good !== good) continue;
    add += b.amount;
    mul *= 1 + b.percent;
  }
  if (extraA >= 0 && BUILDINGS[extraA].converts === good) add -= BUILDINGS[extraA].amount;
  if (extraB >= 0 && BUILDINGS[extraB].converts === good) add -= BUILDINGS[extraB].amount;
  if (extraA >= 0 && BUILDINGS[extraA].good === good) {
    add += BUILDINGS[extraA].amount;
    mul *= 1 + BUILDINGS[extraA].percent;
  }
  if (extraB >= 0 && BUILDINGS[extraB].good === good) {
    add += BUILDINGS[extraB].amount;
    mul *= 1 + BUILDINGS[extraB].percent;
  }
  return Math.max(0, base + add) * mul;
}

/** The standing buildings' effects on food, water and space, as supply modifiers. */
export function buildingSupplyModifiers(eco: Economy, cell: number): SupplyModifier[] {
  const mods: SupplyModifier[] = [];
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (eco.state[s] !== SlotState.Standing) continue;
    const b = BUILDINGS[eco.type[s]];
    if (b.converts !== undefined) mods.push({ kind: b.converts, label: b.name, amount: -b.amount });
    if (b.good >= SUPPLY_KINDS) continue;
    if (b.amount) mods.push({ kind: b.good, label: b.name, amount: b.amount });
    if (b.percent) mods.push({ kind: b.good, label: `${b.name} +${Math.round(b.percent * 100)} %`, amount: b.percent, percent: true });
  }
  return mods;
}

/** How the hex's yearly wood or stone harvest comes about (Good.Wood or Good.Stone). */
export function harvestTerms(world: World, eco: Economy, cell: number, good: number, factor = 1): Term[] {
  const resource = world.resources[cell * RESOURCE_COUNT + resourceOf(good)];
  const terms: Term[] = [
    { label: 'Foraging', value: FORAGE_BASE },
    { label: `${GOOD_NAMES[good]} ${resource.toFixed(2)} × ${FORAGE_PER_RESOURCE}`, value: FORAGE_PER_RESOURCE * resource },
  ];
  let total = forageYield(world, cell, good);
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    const b = BUILDINGS[eco.type[s]];
    if (eco.state[s] === SlotState.Standing && b.good === good && b.amount) {
      terms.push({ label: b.name, value: b.amount });
      total += b.amount;
    }
  }
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    const b = BUILDINGS[eco.type[s]];
    if (eco.state[s] === SlotState.Standing && b.good === good && b.percent) {
      terms.push({ label: `${b.name} +${Math.round(b.percent * 100)} %`, value: total * b.percent });
      total *= 1 + b.percent;
    }
  }
  if (factor !== 1) {
    const pct = Math.round((factor - 1) * 100);
    terms.push({ label: `Satisfaction ${pct < 0 ? '−' : '+'}${Math.abs(pct)} %`, value: total * (factor - 1) });
  }
  return terms;
}

/** Counts a hex's slots in one state. */
export function countSlots(eco: Economy, cell: number, state: number): number {
  let n = 0;
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) if (eco.state[s] === state) n++;
  return n;
}

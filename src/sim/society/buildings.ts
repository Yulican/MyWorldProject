import type { Term } from '../terms';
import { RESOURCE_COUNT, Resource } from '../world/biomes';
import type { World } from '../world/world';
import { SUPPLY_KINDS, type SupplyModifier } from './supply';

// Buildings and the wood and stone that pay for them (design doc, section 5).
// Every settled hex harvests wood and stone from its own land into a stock
// of its own; buildings raise its food, water or space, or its harvest. All
// state lives in flat typed arrays per cell and slot.

/**
 * What a building improves. The first three are the hex's supplies
 * (SupplyKind), the last two its yearly harvest.
 */
export const Good = { Food: 0, Water: 1, Space: 2, Wood: 3, Stone: 4 } as const;
export const GOOD_COUNT = 5;
export const GOOD_NAMES = ['Food', 'Water', 'Space', 'Wood', 'Stone'] as const;

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
};

export function createEconomy(cellCount: number): Economy {
  return {
    stock: new Float32Array(cellCount * MATERIAL_COUNT),
    type: new Int8Array(cellCount * SLOTS).fill(-1),
    state: new Uint8Array(cellCount * SLOTS),
    work: new Float32Array(cellCount * SLOTS),
    unpaid: new Uint8Array(cellCount * SLOTS),
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
    if (b.good !== good) continue;
    add += b.amount;
    mul *= 1 + b.percent;
  }
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
    if (b.good >= SUPPLY_KINDS) continue;
    if (b.amount) mods.push({ kind: b.good, label: b.name, amount: b.amount });
    if (b.percent) mods.push({ kind: b.good, label: `${b.name} +${Math.round(b.percent * 100)} %`, amount: b.percent, percent: true });
  }
  return mods;
}

/** How the hex's yearly wood or stone harvest comes about (Good.Wood or Good.Stone). */
export function harvestTerms(world: World, eco: Economy, cell: number, good: number): Term[] {
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
  return terms;
}

/** Counts a hex's slots in one state. */
export function countSlots(eco: Economy, cell: number, state: number): number {
  let n = 0;
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) if (eco.state[s] === state) n++;
  return n;
}

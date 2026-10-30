import { DIRECTION_COUNT } from '../hex';
import { clampTerms, sumTerms, type Term } from '../terms';
import { BIOMES, Biome, RESOURCE_COUNT, Resource, isWaterBiome } from '../world/biomes';
import { clamp } from '../world/climate';
import type { World } from '../world/world';

// What a hex provides to live on: food, water and space, each measured in
// people it supports (every inhabitant needs one unit of each). The scarcest
// of the three limits how many people the hex holds (design doc, section 6).
// Each supply is the sum of named terms (see terms.ts), so the hex info can
// show exactly how it was calculated.

/** People one unit of food (fertility, game, fish) can feed. */
const PEOPLE_PER_FOOD = 80;
/** Share of a food resource that turns into food units. */
const GAME_FOOD = 0.5;
const FISH_FOOD = 0.6;
const NEARBY_FISH_FOOD = 0.4;
/** People rain alone supplies with water at full moisture. */
const RAIN_WATER = 90;
/** Extra water from a river through the hex or a lake or river next to it. */
const FRESH_WATER = 70;
/** Extra water per river size step (1 = smallest river), up to RIVER_STEPS. */
const RIVER_WATER = 10;
const RIVER_STEPS = 6;

/** People per hex the land has room for, by biome (0 = uninhabitable). */
const SPACE: Partial<Record<number, number>> = {
  [Biome.Plains]: 150,
  [Biome.Savanna]: 140,
  [Biome.Desert]: 120,
  [Biome.Tundra]: 100,
  [Biome.Hills]: 80,
  [Biome.Forest]: 70,
  [Biome.Jungle]: 50,
  [Biome.Swamp]: 40,
  [Biome.Mountains]: 25,
  [Biome.Ice]: 10,
};

export const SupplyKind = { Food: 0, Water: 1, Space: 2 } as const;
export const SUPPLY_KINDS = 3;
export const SUPPLY_NAMES = ['Food', 'Water', 'Space'] as const;

/**
 * A change to one supply of one hex from outside nature's defaults, e.g. an
 * ability or depleted land (none exist yet). Shown as its own term.
 */
export type SupplyModifier = { kind: number; label: string; amount: number };
/** Modifiers by cell. */
export type SupplyModifiers = ReadonlyMap<number, readonly SupplyModifier[]>;

const NO_MODIFIERS: readonly SupplyModifier[] = [];

/**
 * Fills `supply` (cell * SUPPLY_KINDS + kind) with each hex's food, water and
 * space, in people: the sums of `supplyTerms`.
 */
export function computeSupply(world: World, modifiers: SupplyModifiers, supply: Float32Array): void {
  for (let c = 0; c < world.cellCount; c++) {
    const terms = supplyTerms(world, c, modifiers.get(c) ?? NO_MODIFIERS);
    for (let k = 0; k < SUPPLY_KINDS; k++) supply[c * SUPPLY_KINDS + k] = sumTerms(terms[k]);
  }
}

/** People the hex supports: its scarcest supply. */
export function supportedPeople(supply: Float32Array, cell: number): number {
  const base = cell * SUPPLY_KINDS;
  return Math.min(supply[base], supply[base + 1], supply[base + 2]);
}

/**
 * How a hex's food, water and space come about, indexed by SupplyKind. Water
 * hexes supply nothing (nobody lives there).
 */
export function supplyTerms(world: World, cell: number, modifiers: readonly SupplyModifier[]): Term[][] {
  if (isWaterBiome(world.biome[cell])) return [[], [], []];
  const terms = [foodTerms(world, cell), waterTerms(world, cell), spaceTerms(world, cell)];
  for (const m of modifiers) terms[m.kind].push({ label: m.label, value: m.amount });
  return terms.map((t) => clampTerms(t, 0, Infinity));
}

/** Fertility, game and fish of the hex, plus fish from the sea or lake next door. */
function foodTerms(world: World, c: number): Term[] {
  const r = c * RESOURCE_COUNT;
  const terms: Term[] = [];
  const add = (name: string, amount: number, share: number) => {
    if (amount > 0) {
      const factor = share === 1 ? '' : ` ×${share}`;
      terms.push({ label: `${name} ${amount.toFixed(2)}${factor} × ${PEOPLE_PER_FOOD}`, value: amount * share * PEOPLE_PER_FOOD });
    }
  };
  add('Fertility', world.resources[r + Resource.Fertility], 1);
  add('Game', world.resources[r + Resource.Game], GAME_FOOD);
  add('Fish', world.resources[r + Resource.Fish], FISH_FOOD);
  let nearbyFish = 0;
  let nearbyBiome = '';
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = world.neighbors[c * DIRECTION_COUNT + d];
    if (nb < 0 || !isWaterBiome(world.biome[nb])) continue;
    const fish = world.resources[nb * RESOURCE_COUNT + Resource.Fish];
    if (fish > nearbyFish) {
      nearbyFish = fish;
      nearbyBiome = BIOMES[world.biome[nb]].name.toLowerCase();
    }
  }
  add(`Fish nearby (${nearbyBiome})`, nearbyFish, NEARBY_FISH_FOOD);
  return terms;
}

/** Rain, plus fresh water from rivers and lakes; sea water doesn't count. */
function waterTerms(world: World, c: number): Term[] {
  const moisture = clamp(world.moisture[c], 0, 1);
  const terms: Term[] = [{ label: `Rain (moisture ${Math.round(moisture * 100)} %)`, value: RAIN_WATER * moisture }];
  const flow = world.riverFlow[c];
  if (flow > 0) {
    terms.push({ label: 'River', value: FRESH_WATER });
    terms.push({ label: `River size ${flow.toFixed(1)}`, value: RIVER_WATER * Math.min(flow, RIVER_STEPS) });
    return terms;
  }
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = world.neighbors[c * DIRECTION_COUNT + d];
    if (nb < 0) continue;
    if (world.biome[nb] === Biome.Lake) {
      terms.push({ label: 'Lake next door', value: FRESH_WATER });
      return terms;
    }
    if (world.riverFlow[nb] > 0) {
      terms.push({ label: 'River next door', value: FRESH_WATER });
      return terms;
    }
  }
  return terms;
}

function spaceTerms(world: World, c: number): Term[] {
  return [{ label: BIOMES[world.biome[c]].name, value: SPACE[world.biome[c]] ?? 0 }];
}

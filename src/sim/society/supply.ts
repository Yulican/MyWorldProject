import { DIRECTION_COUNT } from '../hex';
import { Biome, RESOURCE_COUNT, Resource, isWaterBiome } from '../world/biomes';
import { clamp } from '../world/climate';
import type { World } from '../world/world';

// What a hex provides to live on: food, water and space, each measured in
// people it supports (every inhabitant needs one unit of each). The scarcest
// of the three limits how many people the hex holds (design doc, section 6).

/** People one unit of food (fertility, game, fish) can feed. */
const PEOPLE_PER_FOOD = 80;
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
 * Fills `supply` (cell * SUPPLY_KINDS + kind) with each hex's food, water and
 * space, in people, from its current natural resources. Water hexes supply
 * nothing (nobody lives there).
 */
export function computeSupply(world: World, supply: Float32Array): void {
  for (let c = 0; c < world.cellCount; c++) {
    const base = c * SUPPLY_KINDS;
    if (isWaterBiome(world.biome[c])) {
      supply[base] = supply[base + 1] = supply[base + 2] = 0;
      continue;
    }
    supply[base + SupplyKind.Food] = food(world, c);
    supply[base + SupplyKind.Water] = water(world, c);
    supply[base + SupplyKind.Space] = SPACE[world.biome[c]] ?? 0;
  }
}

/** People the hex supports: its scarcest supply. */
export function supportedPeople(supply: Float32Array, cell: number): number {
  const base = cell * SUPPLY_KINDS;
  return Math.min(supply[base], supply[base + 1], supply[base + 2]);
}

/** Fertility, game and fish, plus fish from the sea or lake next door. */
function food(world: World, c: number): number {
  const r = c * RESOURCE_COUNT;
  let nearbyFish = 0;
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = world.neighbors[c * DIRECTION_COUNT + d];
    if (nb >= 0 && isWaterBiome(world.biome[nb])) {
      nearbyFish = Math.max(nearbyFish, world.resources[nb * RESOURCE_COUNT + Resource.Fish]);
    }
  }
  const units =
    world.resources[r + Resource.Fertility] +
    world.resources[r + Resource.Game] * 0.5 +
    world.resources[r + Resource.Fish] * 0.6 +
    nearbyFish * 0.4;
  return units * PEOPLE_PER_FOOD;
}

/** Rain, plus fresh water from rivers and lakes; sea water doesn't count. */
function water(world: World, c: number): number {
  let fresh = 0;
  const flow = world.riverFlow[c];
  if (flow > 0) {
    fresh = FRESH_WATER + RIVER_WATER * Math.min(flow, RIVER_STEPS);
  } else {
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb >= 0 && (world.biome[nb] === Biome.Lake || world.riverFlow[nb] > 0)) {
        fresh = FRESH_WATER;
        break;
      }
    }
  }
  return RAIN_WATER * clamp(world.moisture[c], 0, 1) + fresh;
}

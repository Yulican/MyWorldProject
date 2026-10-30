// Biome catalogue. Ids are stored per hex in a Uint8Array, so the order here
// is part of the save format: append new biomes, never reorder.

export const Biome = {
  DeepOcean: 0,
  ShallowSea: 1,
  Lake: 2,
  Ice: 3,
  Tundra: 4,
  Plains: 5,
  Forest: 6,
  Hills: 7,
  Mountains: 8,
  Desert: 9,
  Savanna: 10,
  Jungle: 11,
  Swamp: 12,
} as const;
export type BiomeId = (typeof Biome)[keyof typeof Biome];
export const BIOME_COUNT = 13;

/** Natural resources tracked per hex, see `World.resources`. */
export const Resource = {
  Fertility: 0,
  Game: 1,
  Fish: 2,
  Wood: 3,
  Stone: 4,
  Ore: 5,
} as const;
export type ResourceId = (typeof Resource)[keyof typeof Resource];
export const RESOURCE_COUNT = 6;
export const RESOURCE_NAMES = ['Fertility', 'Game', 'Fish', 'Wood', 'Stone', 'Ore'] as const;

export type BiomeInfo = {
  name: string;
  water: boolean;
  /** Natural resource capacity 0..1, indexed by `Resource`. */
  resources: readonly [number, number, number, number, number, number];
  /** Base danger 0..1 (predators, disease, harsh climate, storms). */
  danger: number;
  /** Relative travel cost; plains = 1. Water costs assume boats. */
  moveCost: number;
};

//                     fert  game  fish  wood  stone ore
export const BIOMES: readonly BiomeInfo[] = [
  { name: 'Deep ocean', water: true, resources: [0, 0, 0.3, 0, 0, 0], danger: 0.6, moveCost: 6 },
  { name: 'Coast', water: true, resources: [0, 0, 0.8, 0, 0, 0], danger: 0.1, moveCost: 2 },
  { name: 'Lake', water: true, resources: [0, 0.1, 0.6, 0, 0, 0], danger: 0.05, moveCost: 2 },
  { name: 'Ice', water: false, resources: [0, 0.1, 0, 0, 0.2, 0.05], danger: 0.8, moveCost: 4 },
  { name: 'Tundra', water: false, resources: [0.1, 0.35, 0, 0.05, 0.2, 0.1], danger: 0.5, moveCost: 2 },
  { name: 'Plains', water: false, resources: [0.8, 0.5, 0, 0.1, 0.15, 0.05], danger: 0.1, moveCost: 1 },
  { name: 'Forest', water: false, resources: [0.35, 0.7, 0, 0.9, 0.15, 0.05], danger: 0.35, moveCost: 2 },
  { name: 'Hills', water: false, resources: [0.35, 0.35, 0, 0.25, 0.6, 0.4], danger: 0.25, moveCost: 2 },
  { name: 'Mountains', water: false, resources: [0.05, 0.2, 0, 0.1, 0.9, 0.7], danger: 0.6, moveCost: 4 },
  { name: 'Desert', water: false, resources: [0.05, 0.1, 0, 0, 0.35, 0.15], danger: 0.6, moveCost: 2 },
  { name: 'Savanna', water: false, resources: [0.5, 0.8, 0, 0.2, 0.15, 0.05], danger: 0.35, moveCost: 1 },
  { name: 'Jungle', water: false, resources: [0.45, 0.6, 0, 1, 0.05, 0.05], danger: 0.7, moveCost: 3 },
  { name: 'Swamp', water: false, resources: [0.55, 0.45, 0.3, 0.4, 0, 0], danger: 0.75, moveCost: 3 },
];

export function isWaterBiome(biome: number): boolean {
  return BIOMES[biome].water;
}

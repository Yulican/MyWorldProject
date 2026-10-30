import type { DepositCategory } from '../sim';

// Map colors. Index = biome id (see sim/world/biomes.ts).
export const BIOME_COLORS: readonly string[] = [
  '#1d3f6e', // deep ocean
  '#3a74a8', // coast
  '#4f8fc0', // lake
  '#e8eef2', // ice
  '#a9b39a', // tundra
  '#9cc566', // plains
  '#3f7f3a', // forest
  '#a99c5e', // hills
  '#867b70', // mountains
  '#ecd9a0', // desert
  '#b9b452', // savanna
  '#21693f', // jungle
  '#5d7a55', // swamp
];

export const DEPOSIT_COLORS: Record<DepositCategory, string> = {
  metal: '#d9a441',
  mineral: '#f2f2f2',
  bounty: '#e85d9c',
  mystic: '#b57cff',
};

export const RIVER_COLOR = '#4a8fd6';
export const START_COLOR = '#ff4d4d';
export const SELECTION_COLOR = '#ffffff';

/** Civilization colors, indexed by `Civilization.color` (CIV_COLOR_COUNT entries). The player's tribe gets the first. */
export const CIV_COLORS: readonly string[] = [
  '#ff4d4d',
  '#3fc6ff',
  '#ffd23f',
  '#b57cff',
  '#ff8c42',
  '#3ddc84',
  '#ff6ec7',
  '#f2f2f2',
];

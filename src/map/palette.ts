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

// Map mode scales (Requirement Kartenmodi 3): one fixed color per bucket.
// The bucket edges are in mapModes.ts.

/** Satisfaction, 10 buckets: four reds below 0, then yellow-green to dark green. */
export const SATISFACTION_SCALE: readonly string[] = [
  '#a50026',
  '#d73027',
  '#f46d43',
  '#fdae61',
  '#e6f598',
  '#c2e384',
  '#94d16f',
  '#5fb45c',
  '#2b9447',
  '#006837',
];
/** Supply load, 8 buckets: greens below 70 %, yellow 85-105 %, dark red from 120 %. */
export const SUPPLY_SCALE: readonly string[] = [
  '#006837',
  '#1a9850',
  '#66bd63',
  '#d9ef8b',
  '#fee08b',
  '#fdcf5a',
  '#f46d43',
  '#a50026',
];
/** Sequential light to dark purple, 10 buckets. */
export const POPULATION_SCALE: readonly string[] = [
  '#f4ebf8',
  '#e2cdee',
  '#cfafe3',
  '#bb91d7',
  '#a774ca',
  '#9259bb',
  '#7c41a8',
  '#652d92',
  '#4e1d78',
  '#38105c',
];
/** Sequential scales per Fertility sub-mode (Food 9, Water 9, Wood 8, Stone 8 buckets). */
export const FERTILITY_SCALES: readonly (readonly string[])[] = [
  ['#fbf6d5', '#f1f1ae', '#dde682', '#bfdc63', '#97cc4f', '#6db543', '#469a37', '#277a2b', '#0e581f'],
  ['#f1f8fd', '#d6e9f7', '#b4d6ef', '#8bbee5', '#62a3d8', '#3f86c8', '#2668b1', '#164c92', '#0a326b'],
  ['#f5eee2', '#e2d2b1', '#c9b07f', '#a98e57', '#7f8a43', '#5a7a35', '#3b6328', '#22471b'],
  ['#f4f4f4', '#dddddd', '#c3c3c3', '#a7a7a7', '#8a8a8a', '#6d6d6d', '#505050', '#333333'],
];
/** Fill-mode overlays: terrain dimmed to ~50 % (Deposits only lightly), the mode color on top, numbers. */
export const MODE_DIM = 'rgba(0,0,0,0.5)';
export const MODE_DIM_LIGHT = 'rgba(0,0,0,0.25)';
export const MODE_FILL_ALPHA = 0.6;
export const MODE_LABEL_COLOR = '#ffffff';
export const MODE_LABEL_OUTLINE = '#111111';
export const MODE_REBEL_COLOR = '#ff2a2a';
/** Roads and hex icons (city, harbor, ruins) in fill modes. */
export const MODE_ICON_ALPHA = 0.35;

/** `#rrggbb` with an alpha, as an rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}

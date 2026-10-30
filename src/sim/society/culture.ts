import { DIRECTION_COUNT } from '../hex';
import { Biome, RESOURCE_COUNT, Resource } from '../world/biomes';
import { clamp } from '../world/climate';
import type { World } from '../world/world';

// Culture: "terrain shapes culture, culture shapes behavior" (design doc,
// section 5). Each civilization has a few values 0..1 that drift towards what
// its land suggests, and that steer where it settles and how restless it is.

export const Culture = {
  /** Lives off the sea, crosses water to settle. */
  Seafaring: 0,
  /** Hardened by danger and rough land; braves hostile hexes. */
  Warlike: 1,
  /** Tills fertile soil; prefers rich farmland. */
  Farming: 2,
  /** Moves on readily instead of crowding together. */
  Wandering: 3,
  /** Turns to the gods in hardship; faith in the player grows faster. */
  Devout: 4,
} as const;
export const CULTURE_COUNT = 5;
export const CULTURE_NAMES = ['Seafaring', 'Warlike', 'Farming', 'Wandering', 'Devout'] as const;

/** Fraction of the gap to the land's culture closed per year. */
const CULTURE_DRIFT_PER_YEAR = 0.05;

/**
 * The culture a people would develop on the given cells, weighted per cell
 * (usually by population). Writes CULTURE_COUNT values into `out`.
 */
export function landCulture(world: World, cells: ArrayLike<number>, weights: ArrayLike<number>, out: Float32Array): void {
  let total = 0;
  let coast = 0;
  let rugged = 0;
  let open = 0;
  let danger = 0;
  let fertility = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const w = weights[i];
    if (w <= 0) continue;
    total += w;
    const biome = world.biome[c];
    if (isCoastal(world, c)) coast += w;
    if (biome === Biome.Hills || biome === Biome.Mountains || biome === Biome.Ice) rugged += w;
    if (biome === Biome.Plains || biome === Biome.Savanna || biome === Biome.Desert || biome === Biome.Tundra) open += w;
    danger += world.danger[c] * w;
    fertility += world.resourceCapacity[c * RESOURCE_COUNT + Resource.Fertility] * w;
  }
  if (total === 0) {
    out.fill(0.5);
    return;
  }
  coast /= total;
  rugged /= total;
  open /= total;
  danger /= total;
  fertility /= total;
  out[Culture.Seafaring] = clamp(coast * 1.1, 0, 1);
  out[Culture.Warlike] = clamp(danger * 0.8 + rugged * 0.6, 0, 1);
  out[Culture.Farming] = clamp(fertility * 1.2, 0, 1);
  out[Culture.Wandering] = clamp(open * 0.6 + (1 - fertility) * 0.4, 0, 1);
  out[Culture.Devout] = clamp(danger * 0.6 + (1 - fertility) * 0.4, 0, 1);
}

/** Moves `culture` one year's step towards `target`. */
export function driftCulture(culture: Float32Array, target: Float32Array): void {
  for (let k = 0; k < CULTURE_COUNT; k++) culture[k] += (target[k] - culture[k]) * CULTURE_DRIFT_PER_YEAR;
}

/** Land next to sea or lake. */
export function isCoastal(world: World, cell: number): boolean {
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = world.neighbors[cell * DIRECTION_COUNT + d];
    if (nb < 0) continue;
    const b = world.biome[nb];
    if (b === Biome.ShallowSea || b === Biome.Lake || b === Biome.DeepOcean) return true;
  }
  return false;
}

/**
 * How attractive a land cell is to settle for a people with this culture,
 * ignoring how crowded it is. Roughly 0..1.5; higher is better.
 */
export function terrainAppeal(world: World, culture: Float32Array, cell: number): number {
  const base = cell * RESOURCE_COUNT;
  const fertility = world.resourceCapacity[base + Resource.Fertility];
  const biome = world.biome[cell];
  let score = fertility * (0.3 + 0.5 * culture[Culture.Farming]);
  score += world.resourceCapacity[base + Resource.Game] * 0.2;
  score += world.resourceCapacity[base + Resource.Fish] * 0.2;
  if (isCoastal(world, cell)) score += 0.3 * culture[Culture.Seafaring];
  if (biome === Biome.Hills || biome === Biome.Mountains) score += 0.2 * culture[Culture.Warlike];
  score -= world.danger[cell] * (0.6 - 0.4 * culture[Culture.Warlike]);
  score -= (world.moveCost[cell] - 1) * 0.05;
  return score;
}

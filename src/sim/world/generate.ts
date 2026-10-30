import { classifyLand } from './classify';
import { generateMoisture, generateTemperature } from './climate';
import { computeHexStats, pickStartCell, placeDeposits } from './features';
import { classifyWater, generateRivers } from './hydrology';
import { computeLatitude, generateElevation, pickShape } from './terrain';
import { allocateWorld, type World } from './world';

export type WorldOptions = {
  seed: number;
  /** Hex columns; must be even so the map can wrap. */
  width?: number;
  height?: number;
};

export const DEFAULT_WORLD_WIDTH = 64;
export const DEFAULT_WORLD_HEIGHT = 64;

/**
 * Generates a complete world from a seed. Deterministic: the same seed and
 * size always produce the same world.
 */
export function generateWorld(options: WorldOptions): World {
  const seed = options.seed >>> 0;
  const world = allocateWorld(
    options.width ?? DEFAULT_WORLD_WIDTH,
    options.height ?? DEFAULT_WORLD_HEIGHT,
    seed,
    pickShape(seed),
  );
  const latitude = computeLatitude(world);

  generateElevation(world, latitude);
  classifyWater(world);
  generateTemperature(world, latitude);
  generateMoisture(world, latitude);
  generateRivers(world);
  classifyLand(world);
  placeDeposits(world);
  computeHexStats(world);
  world.startCell = pickStartCell(world);
  return world;
}

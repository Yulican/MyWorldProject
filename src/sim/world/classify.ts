import { Biome, type BiomeId } from './biomes';
import type { World } from './world';

/** Land elevation (0..1) from which hexes count as hills / mountains. */
export const HILLS_ELEVATION = 0.55;
export const MOUNTAIN_ELEVATION = 0.8;

/** Picks the land biome from temperature, moisture and elevation. Water biomes are already set. */
export function classifyLand(world: World): void {
  for (let c = 0; c < world.cellCount; c++) {
    if (world.elevation[c] < 0 || world.biome[c] === Biome.Lake) continue;
    world.biome[c] = landBiome(world.elevation[c], world.temperature[c], world.moisture[c]);
  }
}

export function landBiome(e: number, t: number, m: number): BiomeId {
  // Mountains stay mountains when cold; the map draws them with snow caps.
  if (e >= MOUNTAIN_ELEVATION) return Biome.Mountains;
  if (t < -10) return Biome.Ice;
  if (t < -2) return Biome.Tundra;
  if (e >= HILLS_ELEVATION) return Biome.Hills;
  if (m > 0.78 && e < 0.12 && t > 4) return Biome.Swamp;
  if (t >= 20) return m < 0.2 ? Biome.Desert : m < 0.5 ? Biome.Savanna : Biome.Jungle;
  if (t >= 6) return m < 0.18 ? Biome.Desert : m < 0.42 ? Biome.Plains : Biome.Forest;
  return m < 0.35 ? Biome.Plains : Biome.Forest;
}

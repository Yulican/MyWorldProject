import { createHexGrid, type HexGrid } from '../hex';
import { RESOURCE_COUNT } from './biomes';

// The world as a "struct of arrays": one flat typed array per stat, indexed by
// cell. Cheap to update in bulk, compact to save, and maps 1:1 to the planned
// C++ core.

export type WorldShape = 'continents' | 'pangaea' | 'archipelago';

export type World = HexGrid & {
  /** Format version, bumped when the layout below changes (for save games). */
  version: number;
  seed: number;
  shape: WorldShape;

  // Terrain
  biome: Uint8Array;
  /** Land: 0 (sea level) .. 1 (highest peak). Water: -1 (deepest) .. 0. */
  elevation: Float32Array;
  /** Average temperature in °C. */
  temperature: Float32Array;
  /** 0 (arid) .. 1 (soaked). */
  moisture: Float32Array;

  // Rivers flow through hexes from cell to cell.
  /** Water volume flowing through the hex; 0 = no river. */
  riverFlow: Float32Array;
  /** Direction (0..5, see hex.ts) to the next hex downstream; -1 = none. */
  riverDir: Int8Array;

  // Natural stats. Resources are interleaved per cell: index cell * RESOURCE_COUNT + resource.
  /** Current amounts 0..1. Change during play (depletion, regrowth, disasters). */
  resources: Float32Array;
  /** Natural capacity 0..1 that current amounts regrow towards. */
  resourceCapacity: Float32Array;
  /** Danger 0..1 (predators, disease, harsh climate). */
  danger: Float32Array;
  /** Travel cost relative to plains (= 1). */
  moveCost: Float32Array;
  /** Special deposit id, 0 = none. */
  deposit: Uint8Array;

  // Society snapshot, filled once inhabitants exist.
  /** Owning civilization id, 0 = nobody. */
  owner: Uint8Array;
  population: Float32Array;
  /** Average faith in the player 0..1. */
  faith: Float32Array;

  /** Where the player's starting tribe settles. */
  startCell: number;
};

export const WORLD_VERSION = 1;

/** Allocates an empty world; generation fills it in. */
export function allocateWorld(width: number, height: number, seed: number, shape: WorldShape): World {
  const grid = createHexGrid(width, height);
  const n = grid.cellCount;
  return {
    ...grid,
    version: WORLD_VERSION,
    seed,
    shape,
    biome: new Uint8Array(n),
    elevation: new Float32Array(n),
    temperature: new Float32Array(n),
    moisture: new Float32Array(n),
    riverFlow: new Float32Array(n),
    riverDir: new Int8Array(n).fill(-1),
    resources: new Float32Array(n * RESOURCE_COUNT),
    resourceCapacity: new Float32Array(n * RESOURCE_COUNT),
    danger: new Float32Array(n),
    moveCost: new Float32Array(n),
    deposit: new Uint8Array(n),
    owner: new Uint8Array(n),
    population: new Float32Array(n),
    faith: new Float32Array(n),
    startCell: -1,
  };
}

export function resourceAt(world: World, cell: number, resource: number): number {
  return world.resources[cell * RESOURCE_COUNT + resource];
}

/** Elevation in meters for display (water depth is negative). */
export function elevationMeters(world: World, cell: number): number {
  const e = world.elevation[cell];
  return Math.round(e >= 0 ? e * 5000 : e * 4000);
}

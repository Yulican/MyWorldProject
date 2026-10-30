import { DIRECTION_COUNT } from '../hex';
import { MinHeap } from '../minHeap';
import { isWaterBiome } from './biomes';
import type { World } from './world';

// Roads connect neighboring hexes. They are stored per hex as a bitmask of
// the six directions, so a road is set on both of its ends.

/** Travel along a road costs this share of the terrain's cost. */
export const ROAD_TRAVEL_FACTOR = 0.5;

/** The direction pointing back: directions are ordered around the hex. */
export function oppositeDirection(dir: number): number {
  return (dir + DIRECTION_COUNT / 2) % DIRECTION_COUNT;
}

export function hasRoad(world: World, cell: number, dir: number): boolean {
  return (world.roads[cell] & (1 << dir)) !== 0;
}

/** Builds a road from `cell` to its neighbor in direction `dir`. */
export function addRoad(world: World, cell: number, dir: number): void {
  const nb = world.neighbors[cell * DIRECTION_COUNT + dir];
  if (nb < 0) return;
  world.roads[cell] |= 1 << dir;
  world.roads[nb] |= 1 << oppositeDirection(dir);
}

/**
 * Cost of moving from `cell` to its neighbor in direction `dir`: the mean of
 * both hexes' terrain cost, cheaper along a road. Infinity beyond the poles.
 */
export function stepCost(world: World, cell: number, dir: number): number {
  const nb = world.neighbors[cell * DIRECTION_COUNT + dir];
  if (nb < 0) return Infinity;
  const terrain = (world.moveCost[cell] + world.moveCost[nb]) / 2;
  return hasRoad(world, cell, dir) ? terrain * ROAD_TRAVEL_FACTOR : terrain;
}

/**
 * Cheapest travel cost from `from` to every land hex (Dijkstra; roads make
 * steps cheaper, see roads.ts). Infinity beyond `maxCost` or over water.
 */
export function travelCostField(world: World, from: number, maxCost: number): Float32Array {
  const cost = new Float32Array(world.cellCount).fill(Infinity);
  const heap = new MinHeap(256);
  cost[from] = 0;
  heap.push(from, 0);
  while (heap.size > 0) {
    const c = heap.pop();
    const here = cost[c];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || isWaterBiome(world.biome[nb])) continue;
      const next = here + stepCost(world, c, d);
      if (next < cost[nb] && next <= maxCost) {
        cost[nb] = next;
        heap.push(nb, next);
      }
    }
  }
  return cost;
}

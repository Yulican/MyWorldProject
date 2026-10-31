import { DIRECTION_COUNT } from '../hex';
import { MinHeap } from '../minHeap';
import { Biome } from './biomes';
import type { World } from './world';

/** Share of land hexes (by water flow) that carry a river. */
const RIVER_SHARE = 0.07;
/** A river's bed sinks at least this much (elevation units, ~0.5 m) from one hex to the next. */
const RIVER_CUT = 1e-4;
/** How deep a land depression must be (in elevation units) to fill up as a lake. */
const LAKE_DEPTH = 0.05;

/**
 * Splits water into deep ocean, shallow sea (coast) and lakes. Small water
 * bodies cut off from the ocean become lakes. Writes `world.biome` for water
 * cells only.
 */
export function classifyWater(world: World): void {
  const { cellCount: n, neighbors, elevation, biome } = world;
  const lakeMaxSize = Math.max(6, Math.round(n * 0.004));

  // Connected water bodies.
  const component = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (elevation[start] >= 0 || component[start] !== -1) continue;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    component[start] = start;
    const members: number[] = [];
    while (top > 0) {
      const c = stack[--top];
      members.push(c);
      size++;
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const nb = neighbors[c * DIRECTION_COUNT + d];
        if (nb < 0 || elevation[nb] >= 0 || component[nb] !== -1) continue;
        component[nb] = start;
        stack[top++] = nb;
      }
    }
    if (size <= lakeMaxSize) for (const c of members) biome[c] = Biome.Lake;
    else for (const c of members) biome[c] = Biome.DeepOcean;
  }

  // Ocean near land is shallow: hex distance to land via breadth-first search.
  const dist = landDistance(world);
  for (let c = 0; c < n; c++) {
    if (biome[c] !== Biome.DeepOcean || elevation[c] >= 0) continue;
    if (dist[c] <= 1 || (dist[c] <= 2 && elevation[c] > -0.15)) biome[c] = Biome.ShallowSea;
  }
}

/** Hex distance of every cell to the nearest land cell (0 for land). */
export function landDistance(world: World): Int32Array {
  const { cellCount: n, neighbors, elevation } = world;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let c = 0; c < n; c++) {
    if (elevation[c] >= 0) {
      dist[c] = 0;
      queue[tail++] = c;
    }
  }
  while (head < tail) {
    const c = queue[head++];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || dist[nb] !== -1) continue;
      dist[nb] = dist[c] + 1;
      queue[tail++] = nb;
    }
  }
  return dist;
}

/**
 * Routes rain water downhill to the sea and carves rivers where enough water
 * collects. Uses "priority flood": starting from all water, land is visited
 * from low to high, so every land cell gets a downstream neighbor and
 * depressions are filled instead of trapping water. Deep enough filled
 * depressions become lakes.
 *
 * Needs `world.moisture` and the water biomes from `classifyWater`.
 */
export function generateRivers(world: World): void {
  const { cellCount: n, neighbors, elevation, moisture, biome } = world;
  const filled = new Float64Array(n);
  const downstream = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  const order = new Int32Array(n); // land cells from low to high
  let orderCount = 0;

  const heap = new MinHeap(n);
  for (let c = 0; c < n; c++) {
    if (elevation[c] < 0) {
      filled[c] = elevation[c];
      visited[c] = 1;
      heap.push(c, filled[c]);
    }
  }
  while (heap.size > 0) {
    const c = heap.pop();
    if (elevation[c] >= 0) order[orderCount++] = c;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || visited[nb]) continue;
      visited[nb] = 1;
      // The tiny increment keeps a strict downhill path through filled areas.
      filled[nb] = Math.max(elevation[nb], filled[c] + 1e-6);
      downstream[nb] = c;
      heap.push(nb, filled[nb]);
    }
  }

  // Depressions that had to be filled a lot become lakes.
  for (let i = 0; i < orderCount; i++) {
    const c = order[i];
    if (filled[c] - elevation[c] > LAKE_DEPTH) biome[c] = Biome.Lake;
  }

  // Accumulate flow from the highest cells down.
  const flow = new Float32Array(n);
  for (let i = orderCount - 1; i >= 0; i--) {
    const c = order[i];
    flow[c] += 0.2 + moisture[c];
    const ds = downstream[c];
    if (ds >= 0 && elevation[ds] >= 0) flow[ds] += flow[c];
  }

  const landFlows = new Float32Array(orderCount);
  for (let i = 0; i < orderCount; i++) landFlows[i] = flow[order[i]];
  landFlows.sort();
  const threshold = landFlows[Math.floor(orderCount * (1 - RIVER_SHARE))] ?? Infinity;

  for (let i = 0; i < orderCount; i++) {
    const c = order[i];
    if (flow[c] < threshold || biome[c] === Biome.Lake) continue;
    world.riverFlow[c] = flow[c] / threshold; // 1 = smallest river
    const ds = downstream[c];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      if (neighbors[c * DIRECTION_COUNT + d] === ds) {
        world.riverDir[c] = d;
        break;
      }
    }
  }

  // Rivers flow downhill: where a filled depression made the next hex
  // downstream higher, the river cuts its bed into it. From the highest
  // river hexes down, so a cut carries on downstream.
  for (let i = orderCount - 1; i >= 0; i--) {
    const c = order[i];
    if (world.riverFlow[c] <= 0) continue;
    const ds = downstream[c];
    if (ds < 0 || elevation[ds] < 0 || biome[ds] === Biome.Lake) continue;
    if (elevation[ds] >= elevation[c]) elevation[ds] = Math.max(0, elevation[c] - RIVER_CUT);
  }
}

/** True if the cell has a river or borders a lake or river. */
export function hasFreshWater(world: World, cell: number): boolean {
  if (world.riverFlow[cell] > 0) return true;
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = world.neighbors[cell * DIRECTION_COUNT + d];
    if (nb < 0) continue;
    if (world.biome[nb] === Biome.Lake || world.riverFlow[nb] > 0) return true;
  }
  return false;
}

import { DIRECTION_COUNT, hexCenterX, hexCenterY, wrapWidth } from '../hex';
import { createNoise3, cylinderPoint, fbm } from '../noise';
import { createRng, deriveSeed } from '../rng';
import { BIOMES, Biome, RESOURCE_COUNT, Resource, isWaterBiome } from './biomes';
import { clamp } from './climate';
import { DEPOSITS } from './deposits';
import { hasFreshWater } from './hydrology';
import type { World } from './world';

/** Deposits keep at least this many hexes between each other. */
const DEPOSIT_SPACING = 2;

/** Places special deposits by their frequency on suitable hexes. */
export function placeDeposits(world: World): void {
  const rng = createRng(deriveSeed(world.seed, 'deposits'));
  let landCount = 0;
  for (let c = 0; c < world.cellCount; c++) if (!isWaterBiome(world.biome[c])) landCount++;

  // One shuffled cell order, walked once per deposit type.
  const order = new Int32Array(world.cellCount);
  for (let i = 0; i < order.length; i++) order[i] = i;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }

  for (let id = 1; id < DEPOSITS.length; id++) {
    const info = DEPOSITS[id];
    const expected = (info.frequency * landCount) / 1000;
    // Random rounding keeps rare deposits possible on small maps.
    let remaining = Math.floor(expected) + (rng() < expected % 1 ? 1 : 0);
    const offset = Math.floor(rng() * order.length);
    for (let k = 0; k < order.length && remaining > 0; k++) {
      const c = order[(k + offset) % order.length];
      if (world.deposit[c] !== 0) continue;
      if (!info.biomes.includes(world.biome[c] as never)) continue;
      if (info.needsRiver && world.riverFlow[c] <= 0) continue;
      if (info.needsFreshWater && !hasFreshWater(world, c)) continue;
      if (depositNearby(world, c, DEPOSIT_SPACING)) continue;
      world.deposit[c] = id;
      remaining--;
    }
  }
}

function depositNearby(world: World, cell: number, radius: number): boolean {
  // Small breadth-first search; radius is tiny so plain arrays are fine.
  let frontier = [cell];
  const seen = new Set(frontier);
  for (let r = 0; r < radius; r++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const nb = world.neighbors[c * DIRECTION_COUNT + d];
        if (nb < 0 || seen.has(nb)) continue;
        if (world.deposit[nb] !== 0) return true;
        seen.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return false;
}

/**
 * Natural resource capacity, danger and travel cost per hex: biome defaults,
 * varied by noise, adjusted by rivers, climate and deposits. Current
 * resources start at capacity.
 */
export function computeHexStats(world: World): void {
  const noise = createNoise3(deriveSeed(world.seed, 'resources'));
  const ww = wrapWidth(world);
  const p = new Float64Array(3);
  for (let c = 0; c < world.cellCount; c++) {
    const biome = world.biome[c];
    const info = BIOMES[biome];
    const col = c % world.width;
    const row = (c - col) / world.width;
    cylinderPoint(hexCenterX(col), hexCenterY(col, row), ww, 9 / ww, p);
    const variation = 0.8 + 0.4 * (fbm(noise, p[0], p[1], p[2], 2) * 0.5 + 0.5);

    const base = c * RESOURCE_COUNT;
    for (let r = 0; r < RESOURCE_COUNT; r++) {
      world.resourceCapacity[base + r] = info.resources[r] * variation;
    }

    if (!info.water) {
      // Too cold or too hot land grows less.
      const t = world.temperature[c];
      const climate = clamp((t + 5) / 20, 0.2, 1) * (t > 32 ? 0.7 : 1);
      world.resourceCapacity[base + Resource.Fertility] *= climate;
      const flow = world.riverFlow[c];
      if (flow > 0) {
        world.resourceCapacity[base + Resource.Fertility] += 0.15 + 0.1 * Math.min(1, flow / 4);
        world.resourceCapacity[base + Resource.Fish] += 0.3;
      }
    }

    const deposit = DEPOSITS[world.deposit[c]];
    if (deposit.bonus) world.resourceCapacity[base + deposit.bonus.resource] += deposit.bonus.amount;

    for (let r = 0; r < RESOURCE_COUNT; r++) {
      const v = clamp(world.resourceCapacity[base + r], 0, 1);
      world.resourceCapacity[base + r] = v;
      world.resources[base + r] = v;
    }

    world.danger[c] = clamp(info.danger * (1.3 - variation * 0.5), 0, 1);
    world.moveCost[c] = info.moveCost;
  }
}

/**
 * Picks the start hex for the player's tribe: fertile, fresh water nearby,
 * mild climate, not too dangerous, on a landmass big enough to grow on.
 */
export function pickStartCell(world: World): number {
  const rng = createRng(deriveSeed(world.seed, 'start'));
  const landmass = landmassSizes(world);
  const minLandmass = Math.max(20, Math.round(world.cellCount * 0.02));
  const allowed: number[] = [Biome.Plains, Biome.Savanna, Biome.Forest, Biome.Hills];

  let best = -1;
  let bestScore = -Infinity;
  for (let c = 0; c < world.cellCount; c++) {
    if (!allowed.includes(world.biome[c])) continue;
    if (landmass[c] < minLandmass) continue;
    let food = 0;
    let danger = world.danger[c];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0) continue;
      const nbBase = nb * RESOURCE_COUNT;
      food +=
        world.resources[nbBase + Resource.Fertility] +
        world.resources[nbBase + Resource.Game] * 0.5 +
        world.resources[nbBase + Resource.Fish] * 0.5;
      danger += world.danger[nb] / 6;
    }
    const base = c * RESOURCE_COUNT;
    food += world.resources[base + Resource.Fertility] * 2 + world.resources[base + Resource.Game];
    const water = hasFreshWater(world, c) ? 1.5 : 0;
    const climate = -Math.abs(world.temperature[c] - 17) / 10;
    const score = food * 0.5 + water + climate - danger * 1.5 + rng() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Size of the connected landmass each land cell belongs to (0 for water). */
function landmassSizes(world: World): Int32Array {
  const n = world.cellCount;
  const size = new Int32Array(n);
  const stack = new Int32Array(n);
  const members: number[] = [];
  for (let start = 0; start < n; start++) {
    if (size[start] !== 0 || isWaterBiome(world.biome[start])) continue;
    members.length = 0;
    let top = 0;
    stack[top++] = start;
    size[start] = -1;
    while (top > 0) {
      const c = stack[--top];
      members.push(c);
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const nb = world.neighbors[c * DIRECTION_COUNT + d];
        if (nb < 0 || size[nb] !== 0 || isWaterBiome(world.biome[nb])) continue;
        size[nb] = -1;
        stack[top++] = nb;
      }
    }
    for (const c of members) size[c] = members.length;
  }
  return size;
}

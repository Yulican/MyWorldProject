import { hexCenterX, hexCenterY, mapHeight, wrapWidth } from '../hex';
import { createNoise3, cylinderPoint, fbm, ridged } from '../noise';
import { createRng, deriveSeed } from '../rng';
import type { World, WorldShape } from './world';

/** Share of the map that is land. */
export const LAND_RATIO = 0.5;

/**
 * Normalized latitude per cell: 0 at the equator (map middle), 1 at the poles
 * (top and bottom edge).
 */
export function computeLatitude(world: World): Float32Array {
  const lat = new Float32Array(world.cellCount);
  const h = mapHeight(world);
  for (let c = 0; c < world.cellCount; c++) {
    const col = c % world.width;
    const row = (c - col) / world.width;
    const v = hexCenterY(col, row) / h;
    lat[c] = Math.min(1, Math.abs(v * 2 - 1));
  }
  return lat;
}

export function pickShape(seed: number): WorldShape {
  const r = createRng(deriveSeed(seed, 'shape'))();
  return r < 0.45 ? 'continents' : r < 0.75 ? 'pangaea' : 'archipelago';
}

/**
 * Fills `world.elevation`: exactly LAND_RATIO of the cells end up above sea
 * level (0). Land rises 0..1 and water sinks -1..0, both distributed by rank
 * so every seed gets a similar mix of lowlands, hills and peaks.
 */
export function generateElevation(world: World, latitude: Float32Array): void {
  const n = world.cellCount;
  const seed = world.seed;
  const base = createNoise3(deriveSeed(seed, 'elevation'));
  const detail = createNoise3(deriveSeed(seed, 'detail'));
  const ridges = createNoise3(deriveSeed(seed, 'ridges'));
  const rng = createRng(deriveSeed(seed, 'terrain'));
  const ww = wrapWidth(world);
  const p = new Float64Array(3);
  const raw = new Float32Array(n);

  // Pangaea: one landmass around a random center.
  const centerAngle = rng() * Math.PI * 2;
  const centerY = mapHeight(world) * (0.4 + rng() * 0.2);
  const radius = ww / (Math.PI * 2);

  // Features per wrap width: low = few big landmasses, high = many small ones.
  const shapeScale = world.shape === 'archipelago' ? 7 : world.shape === 'continents' ? 2.6 : 2;

  for (let c = 0; c < n; c++) {
    const col = c % world.width;
    const row = (c - col) / world.width;
    const x = hexCenterX(col);
    const y = hexCenterY(col, row);

    cylinderPoint(x, y, ww, shapeScale / ww, p);
    let e = fbm(base, p[0], p[1], p[2], 4);

    cylinderPoint(x, y, ww, (shapeScale * 4) / ww, p);
    e += fbm(detail, p[0], p[1], p[2], 4) * 0.35;

    if (world.shape === 'pangaea') {
      const angle = (x / ww) * Math.PI * 2;
      const dx = Math.cos(angle) * radius - Math.cos(centerAngle) * radius;
      const dz = Math.sin(angle) * radius - Math.sin(centerAngle) * radius;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius; // 0 center .. ~2 far side
      e += 0.55 - dist * 0.55;
    }

    // Mountain chains along ridges, mostly inside landmasses.
    cylinderPoint(x, y, ww, 5 / ww, p);
    const r = ridged(ridges, p[0], p[1], p[2], 4);
    e += Math.max(0, r - 0.55) * 1.4 * smoothstep(-0.1, 0.25, e);

    // Push the poles down so land isn't cut off by the map edge.
    e -= smoothstep(0.82, 1, latitude[c]) * 0.6;

    raw[c] = e;
  }

  rankNormalize(raw, world.elevation, 1 - LAND_RATIO);
}

/**
 * Writes elevations by rank: the lowest `seaShare` of cells become water
 * (-1..0), the rest land (0..1) with a curve that keeps most land low.
 */
function rankNormalize(raw: Float32Array, out: Float32Array, seaShare: number): void {
  const n = raw.length;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => raw[a] - raw[b]);
  const seaCount = Math.round(n * seaShare);
  const landCount = n - seaCount;
  for (let i = 0; i < n; i++) {
    const c = order[i];
    if (i < seaCount) {
      const p = i / Math.max(1, seaCount - 1); // 0 deepest .. 1 shallowest
      out[c] = -Math.pow(1 - p, 1.5) * 0.999 - 0.001;
    } else {
      const p = (i - seaCount) / Math.max(1, landCount - 1); // 0 lowest .. 1 highest
      out[c] = 0.9 * Math.pow(p, 2.2) + 0.1 * p;
    }
  }
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

import { hexCenterX, hexCenterY, wrapWidth } from '../hex';
import { createNoise3, cylinderPoint, fbm } from '../noise';
import { deriveSeed } from '../rng';
import type { World } from './world';

/** Temperature drop per meter of altitude (°C). */
const LAPSE_RATE = 0.004;

/**
 * Average temperature from latitude (hot equator, cold poles) and altitude,
 * plus some noise. Water is milder than land.
 */
export function generateTemperature(world: World, latitude: Float32Array): void {
  const noise = createNoise3(deriveSeed(world.seed, 'temperature'));
  const ww = wrapWidth(world);
  const p = new Float64Array(3);
  for (let c = 0; c < world.cellCount; c++) {
    const col = c % world.width;
    const row = (c - col) / world.width;
    cylinderPoint(hexCenterX(col), hexCenterY(col, row), ww, 6 / ww, p);
    let t = 30 - 45 * Math.pow(latitude[c], 1.6) + fbm(noise, p[0], p[1], p[2], 3) * 6;
    const e = world.elevation[c];
    if (e > 0) t -= e * 5000 * LAPSE_RATE;
    else t = t * 0.85 + 2;
    world.temperature[c] = t;
  }
}

/**
 * Moisture from prevailing winds: air picks up water over the sea and rains
 * it out over land, most of all when it is pushed up slopes. Lands behind
 * mountains stay dry (rain shadow). The dry belts around 30° latitude and
 * the wet equator follow the real global circulation.
 */
export function generateMoisture(world: World, latitude: Float32Array): void {
  const { width, height, elevation, temperature } = world;
  const rain = new Float32Array(world.cellCount);

  for (let row = 0; row < height; row++) {
    const lat = latitude[row * width];
    // Trade winds and polar easterlies blow west, mid latitudes blow east.
    const step = lat < 0.33 || lat > 0.7 ? -1 : 1;
    let carry = 0.5;
    let prevE = 0;
    // Two laps around the wrapping row; the first one only warms up `carry`.
    for (let i = 0; i < width * 2; i++) {
      const col = (((step > 0 ? i : -i) % width) + width) % width;
      const c = row * width + col;
      const e = elevation[c];
      if (e < 0) {
        const evaporation = 0.15 * clamp((temperature[c] + 10) / 40, 0.1, 1);
        carry += (1 - carry) * evaporation;
        prevE = 0;
        continue;
      }
      const rise = Math.max(0, e - prevE);
      const rate = Math.min(0.8, 0.06 + rise * 3 + e * 0.05);
      const r = carry * rate;
      carry -= r * 0.6; // plants give some of it back
      prevE = e;
      if (i >= width) rain[c] = r;
    }
  }

  // Scale so that the wettest land is about 1.
  const landRain: number[] = [];
  for (let c = 0; c < world.cellCount; c++) if (elevation[c] >= 0) landRain.push(rain[c]);
  landRain.sort((a, b) => a - b);
  const wet = landRain[Math.floor(landRain.length * 0.8)] || 1;

  const noise = createNoise3(deriveSeed(world.seed, 'moisture'));
  const ww = wrapWidth(world);
  const p = new Float64Array(3);
  for (let c = 0; c < world.cellCount; c++) {
    if (elevation[c] < 0) {
      world.moisture[c] = 1;
      continue;
    }
    const col = c % width;
    const row = (c - col) / width;
    cylinderPoint(hexCenterX(col), hexCenterY(col, row), ww, 5 / ww, p);
    const lat = latitude[c];
    let m =
      (rain[c] / wet) * 0.55 +
      (fbm(noise, p[0], p[1], p[2], 3) * 0.5 + 0.5) * 0.3 +
      0.35 * bell(lat, 0, 0.18) + // rising warm air: rain at the equator even far inland
      0.15 * bell(lat, 0.6, 0.15) - // storm tracks of the mid latitudes
      0.06;
    m *= 1 - 0.4 * bell(lat, 0.3, 0.1); // subtropical dry belt
    world.moisture[c] = clamp(m, 0, 1);
  }
}

function bell(x: number, center: number, width: number): number {
  const d = (x - center) / width;
  return Math.exp(-d * d);
}

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

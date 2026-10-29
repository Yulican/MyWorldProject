import { createRng } from './rng';

// Seeded 3D gradient noise (improved Perlin). The map samples it on the
// surface of a cylinder, which makes every noise field wrap left/right
// without a seam.

export type Noise3 = (x: number, y: number, z: number) => number;

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Returns a noise function with values roughly in -1..1. */
export function createNoise3(seed: number): Noise3 {
  const rng = createRng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const grad = (hash: number, x: number, y: number, z: number) => {
    const g = (hash % 12) * 3;
    return GRAD3[g] * x + GRAD3[g + 1] * y + GRAD3[g + 2] * z;
  };

  return (x, y, z) => {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const zf = Math.floor(z);
    const X = xf & 255;
    const Y = yf & 255;
    const Z = zf & 255;
    x -= xf;
    y -= yf;
    z -= zf;
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
        lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u),
        v,
      ),
      lerp(
        lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  };
}

/** Fractal noise: several octaves of noise added together, roughly -1..1. */
export function fbm(
  noise: Noise3,
  x: number,
  y: number,
  z: number,
  octaves: number,
  lacunarity = 2,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * f, y * f, z * f) * amp;
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/** Ridged fractal noise (sharp crests, good for mountain chains), 0..1. */
export function ridged(noise: Noise3, x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise(x * f, y * f, z * f));
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Maps a hex position (in hex-size units) to a point on a cylinder whose
 * circumference is the map's wrap width, so noise sampled there tiles
 * horizontally. `scale` = noise features per hex-size unit.
 */
export function cylinderPoint(
  x: number,
  y: number,
  wrapWidth: number,
  scale: number,
  out: Float64Array,
): void {
  const angle = (x / wrapWidth) * Math.PI * 2;
  const radius = (wrapWidth / (Math.PI * 2)) * scale;
  out[0] = Math.cos(angle) * radius;
  out[1] = Math.sin(angle) * radius;
  out[2] = y * scale;
}

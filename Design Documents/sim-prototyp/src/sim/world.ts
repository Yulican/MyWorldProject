import type { Rng } from './rng';

// Hexkarte im "odd-r"-Layout (ungerade Zeilen nach rechts versetzt).
export type World = {
  width: number;
  height: number;
  cellCount: number;
  food: Float32Array; // Nahrungsertrag 0..1
  danger: Float32Array; // Gefahr 0..1
  civ: Uint8Array; // 0 = niemand, 1..n = Zivilisation
  neighbors: Int32Array; // 6 Nachbarn je Zelle, -1 = außerhalb
};

const EVEN_ROW: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1],
];
const ODD_ROW: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1],
];

export function createWorld(
  width: number,
  height: number,
  civCount: number,
  rng: Rng,
): World {
  const cellCount = width * height;
  const food = new Float32Array(cellCount);
  const danger = new Float32Array(cellCount);
  const civ = new Uint8Array(cellCount);
  const neighbors = new Int32Array(cellCount * 6).fill(-1);

  for (let y = 0; y < height; y++) {
    const offsets = y % 2 === 0 ? EVEN_ROW : ODD_ROW;
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      food[c] = 0.25 + 0.75 * rng();
      danger[c] = 0.4 * rng();
      for (let d = 0; d < 6; d++) {
        const nx = x + offsets[d][0];
        const ny = y + offsets[d][1];
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          neighbors[c * 6 + d] = ny * width + nx;
        }
      }
    }
  }

  // Zivilisationen: Zentren würfeln, Zellen dem nächsten Zentrum im Radius zuordnen.
  const centers: Array<[number, number]> = [];
  for (let i = 0; i < civCount; i++) {
    centers.push([Math.floor(rng() * width), Math.floor(rng() * height)]);
  }
  const radius = Math.max(6, Math.floor(Math.min(width, height) / (civCount + 1)));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = 0;
      let bestDist = radius * radius;
      for (let i = 0; i < civCount; i++) {
        const dx = x - centers[i][0];
        const dy = y - centers[i][1];
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = i + 1;
        }
      }
      civ[y * width + x] = best;
    }
  }

  return { width, height, cellCount, food, danger, civ, neighbors };
}

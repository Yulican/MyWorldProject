// Hex grid geometry: flat-top hexes in "odd-q" offset layout (odd columns are
// shifted down by half a hex). The map wraps left/right like a globe and has
// hard edges at the top and bottom (the poles).
//
// Cells are addressed by a single index `cell = row * width + col`, so every
// per-hex stat can live in a flat typed array.

export const SQRT3 = Math.sqrt(3);

/**
 * Neighbor directions, in this order: SE, NE, N, NW, SW, S.
 * `dir` and `(dir + 3) % 6` are opposite directions.
 */
export const DIRECTION_COUNT = 6;
const AXIAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

/** Offset from a hex center to its neighbor's center per direction, in hex-size units. */
export const DIRECTION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1.5, Math.sqrt(3) / 2], [1.5, -Math.sqrt(3) / 2], [0, -Math.sqrt(3)],
  [-1.5, -Math.sqrt(3) / 2], [-1.5, Math.sqrt(3) / 2], [0, Math.sqrt(3)],
];

export type HexGrid = {
  width: number;
  height: number;
  cellCount: number;
  /** 6 neighbor cells per cell in direction order, -1 beyond the poles. */
  neighbors: Int32Array;
};

export function createHexGrid(width: number, height: number): HexGrid {
  // An odd width would break the column parity across the wrap seam.
  if (width % 2 !== 0) throw new Error('Hex grid width must be even to wrap.');
  const cellCount = width * height;
  const neighbors = new Int32Array(cellCount * DIRECTION_COUNT).fill(-1);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const q = col;
      const r = row - (col - (col & 1)) / 2;
      const c = row * width + col;
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const nq = q + AXIAL_DIRS[d][0];
        const nr = r + AXIAL_DIRS[d][1];
        const nRow = nr + (nq - (nq & 1)) / 2;
        if (nRow < 0 || nRow >= height) continue;
        const nCol = ((nq % width) + width) % width;
        neighbors[c * DIRECTION_COUNT + d] = nRow * width + nCol;
      }
    }
  }
  return { width, height, cellCount, neighbors };
}

export function cellCol(grid: HexGrid, cell: number): number {
  return cell % grid.width;
}

export function cellRow(grid: HexGrid, cell: number): number {
  return Math.floor(cell / grid.width);
}

/** Hex center in units of the hex size (center-to-corner distance = 1). */
export function hexCenterX(col: number): number {
  return 1.5 * col;
}

export function hexCenterY(col: number, row: number): number {
  return SQRT3 * (row + 0.5 * (col & 1));
}

/** Horizontal distance after which the map repeats, in hex-size units. */
export function wrapWidth(grid: HexGrid): number {
  return 1.5 * grid.width;
}

/** Total map height in hex-size units (including the half-hex shift). */
export function mapHeight(grid: HexGrid): number {
  return SQRT3 * (grid.height + 0.5);
}

/**
 * Finds the cell under a point given in hex-size units. The x coordinate may
 * be outside the map; it is wrapped. Returns -1 above or below the map.
 */
export function cellAtPoint(grid: HexGrid, x: number, y: number): number {
  // Pixel to fractional axial coordinates (flat-top), then cube rounding.
  const fq = (2 / 3) * x;
  const fr = (-1 / 3) * x + (SQRT3 / 3) * y;
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  const row = r + (q - (q & 1)) / 2;
  if (row < 0 || row >= grid.height) return -1;
  const col = ((q % grid.width) + grid.width) % grid.width;
  return row * grid.width + col;
}

/** Hex distance between two cells, taking the left/right wrap into account. */
export function hexDistance(grid: HexGrid, a: number, b: number): number {
  const aq = cellCol(grid, a);
  const ar = cellRow(grid, a) - (aq - (aq & 1)) / 2;
  const bCol = cellCol(grid, b);
  const bRow = cellRow(grid, b);
  let best = Infinity;
  // Compare against the copies of b one map width to the left and right.
  for (const shift of [-grid.width, 0, grid.width]) {
    const bq = bCol + shift;
    const br = bRow - (bq - (bq & 1)) / 2;
    const dq = aq - bq;
    const dr = ar - br;
    const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    if (d < best) best = d;
  }
  return best;
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DIRECTION_COUNT,
  cellAtPoint,
  createHexGrid,
  hexCenterX,
  hexCenterY,
  hexDistance,
  wrapWidth,
} from './hex';

const grid = createHexGrid(16, 12);

test('neighbors are symmetric: if b is a neighbor of a in dir d, a is b’s neighbor in the opposite dir', () => {
  for (let c = 0; c < grid.cellCount; c++) {
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = grid.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0) continue;
      assert.equal(grid.neighbors[nb * DIRECTION_COUNT + ((d + 3) % 6)], c);
    }
  }
});

test('the map wraps left/right but not top/bottom', () => {
  const leftEdge = 5 * grid.width; // row 5, col 0
  const westNeighbors = [3, 4].map((d) => grid.neighbors[leftEdge * DIRECTION_COUNT + d]);
  for (const nb of westNeighbors) assert.equal(nb % grid.width, grid.width - 1);
  assert.equal(grid.neighbors[0 * DIRECTION_COUNT + 2], -1); // north of the top row
});

test('cellAtPoint finds the cell at its own center, also one wrap width away', () => {
  for (let c = 0; c < grid.cellCount; c++) {
    const col = c % grid.width;
    const row = Math.floor(c / grid.width);
    const x = hexCenterX(col);
    const y = hexCenterY(col, row);
    assert.equal(cellAtPoint(grid, x, y), c);
    assert.equal(cellAtPoint(grid, x + wrapWidth(grid), y), c);
    assert.equal(cellAtPoint(grid, x - wrapWidth(grid), y), c);
  }
});

test('hexDistance is 1 for neighbors and uses the shorter way around', () => {
  const c = 3 * grid.width + 7;
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    assert.equal(hexDistance(grid, c, grid.neighbors[c * DIRECTION_COUNT + d]), 1);
  }
  assert.equal(hexDistance(grid, 2 * grid.width, 2 * grid.width + grid.width - 1), 1);
});

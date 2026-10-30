import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHUNK_H, CHUNK_W } from './mapGeometry';
import { DETAIL_OFF, DETAIL_ON, pickTier, viewTiles, visibleTiles, type ViewTiles } from './viewport';

// A 64x64 world: one map copy is 64 * 1.5 * 24 px wide, 16x17 tiles.
const width = 64 * 1.5 * 24;
const grid = { width, chunkCols: Math.ceil(width / CHUNK_W), chunkRows: 17 };
const detailed: ViewTiles = { x0: 0, x1: 0, y0: 0, y1: 0, detail: true, tier: 0 };

test('zoomed out draws no tiles (the overview image is enough)', () => {
  const view = viewTiles(0, 0, DETAIL_OFF * 0.9, 400, 800, null);
  assert.equal(visibleTiles(view, grid).length, 0);
});

test('detail switches on and off at different zooms, so it does not flicker', () => {
  const between = (DETAIL_ON + DETAIL_OFF) / 2;
  assert.equal(viewTiles(0, 0, between, 400, 800, null).detail, false);
  assert.equal(viewTiles(0, 0, between, 400, 800, detailed).detail, true);
  assert.equal(viewTiles(0, 0, DETAIL_ON, 400, 800, null).detail, true);
  assert.equal(viewTiles(0, 0, DETAIL_OFF * 0.99, 400, 800, detailed).detail, false);
});

test('zoomed in draws only the tiles under the screen', () => {
  // Screen of exactly 2x3 tiles at scale 1, top-left of the map.
  const tiles = visibleTiles(viewTiles(0, 0, 1, 2 * CHUNK_W - 1, 3 * CHUNK_H - 1, detailed), grid);
  assert.deepEqual(
    tiles.map((t) => t.chunk).sort((a, b) => a - b),
    [0, 1, grid.chunkCols, grid.chunkCols + 1, 2 * grid.chunkCols, 2 * grid.chunkCols + 1],
  );
});

test('a margin adds the ring of tiles around the screen', () => {
  const view = viewTiles(-5 * CHUNK_W, -5 * CHUNK_H, 1, CHUNK_W - 1, CHUNK_H - 1, detailed);
  assert.equal(visibleTiles(view, grid).length, 1);
  assert.equal(visibleTiles(view, grid, 1).length, 9);
});

test('at the wrap seam, tiles come from the end of one copy and the start of the next', () => {
  // View starts 100 px before the end of the first map copy.
  const tiles = visibleTiles(viewTiles(-(width - 100), 0, 1, 200, CHUNK_H - 1, detailed), grid);
  const byCopy = tiles.map((t) => `${t.offsetX === 0 ? 'a' : 'b'}${t.col}`).sort();
  assert.deepEqual(byCopy, [`a${grid.chunkCols - 1}`, 'b0']);
});

test('rows above and below the map are skipped', () => {
  const tiles = visibleTiles(viewTiles(0, 500, 1, 300, 600, detailed), grid, 1);
  assert.ok(tiles.every((t) => t.row >= 0 && t.row < grid.chunkRows));
});

test('each zoom gets the tier rendered for it, with hysteresis at the borders', () => {
  assert.equal(pickTier(0.8, -1), 0);
  assert.equal(pickTier(2, -1), 1);
  assert.equal(pickTier(3, -1), 2);
  assert.equal(pickTier(1.2, 0), 0); // just past tier 0's range: stays
  assert.equal(pickTier(1.4, 0), 1);
  assert.equal(pickTier(2.2, 1), 1);
  assert.equal(viewTiles(0, 0, 3, 400, 800, { ...detailed, tier: 0 }, true).tier, 0); // held while pinching
});

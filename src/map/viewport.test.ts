import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHUNK_W } from './mapGeometry';
import { DETAIL_SCALE, viewTiles, visibleTiles } from './viewport';

// A 64x64 world: 4x4 tiles, one map copy is 64 * 1.5 * 24 px wide.
const grid = { width: 64 * 1.5 * 24, chunkCols: 4, chunkRows: 4 };

test('zoomed out draws no tiles (the overview image is enough)', () => {
  const view = viewTiles(0, 0, DETAIL_SCALE * 0.9, 400, 800);
  assert.equal(visibleTiles(view, grid).length, 0);
});

test('zoomed in draws only the tiles under the screen', () => {
  // Screen 400x800 at scale 1, top-left of the map: 1 column x 2 rows of tiles.
  const tiles = visibleTiles(viewTiles(0, 0, 1, 400, 800), grid);
  assert.deepEqual(tiles.map((t) => t.chunk).sort(), [0, 4]);
});

test('at the wrap seam, tiles come from the end of one copy and the start of the next', () => {
  // View starts 100 px before the end of the first map copy.
  const tx = -(grid.width - 100);
  const tiles = visibleTiles(viewTiles(tx, 0, 1, 400, 400), grid);
  const byCopy = tiles.map((t) => `${t.offsetX === 0 ? 'a' : 'b'}${t.chunk}`).sort();
  assert.deepEqual(byCopy, ['a3', 'b0']);
  assert.ok(tiles.every((t) => t.offsetX === 0 || t.offsetX === grid.width));
});

test('rows above and below the map are skipped', () => {
  const tiles = visibleTiles(viewTiles(0, 500, 1, 300, 600), grid);
  assert.ok(tiles.every((t) => t.chunk >= 0 && t.chunk < 16));
  assert.ok(tiles.length > 0 && tiles.length <= Math.ceil(300 / CHUNK_W) + 1);
});

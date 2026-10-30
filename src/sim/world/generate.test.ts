import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRECTION_COUNT } from '../hex';
import { BIOMES, BIOME_COUNT, Biome, isWaterBiome } from './biomes';
import { DEPOSITS } from './deposits';
import { generateWorld } from './generate';

const SEEDS = [1, 2, 3, 42, 1234, 99999];

test('same seed gives the same world', () => {
  const a = generateWorld({ seed: 42 });
  const b = generateWorld({ seed: 42 });
  assert.deepEqual(a.biome, b.biome);
  assert.deepEqual(a.elevation, b.elevation);
  assert.deepEqual(a.resources, b.resources);
  assert.equal(a.startCell, b.startCell);
});

test('different seeds give different worlds', () => {
  assert.notDeepEqual(generateWorld({ seed: 1 }).biome, generateWorld({ seed: 2 }).biome);
});

for (const seed of SEEDS) {
  test(`seed ${seed}: valid, playable world`, () => {
    const w = generateWorld({ seed });

    let land = 0;
    for (let c = 0; c < w.cellCount; c++) {
      assert.ok(w.biome[c] < BIOME_COUNT);
      assert.ok(w.deposit[c] < DEPOSITS.length);
      if (w.elevation[c] >= 0) land++;
      // Water biomes and negative elevation agree (lakes may sit above sea level).
      if (w.elevation[c] < 0) assert.ok(isWaterBiome(w.biome[c]));
      for (let i = 0; i < 6; i++) {
        const v = w.resources[c * 6 + i];
        assert.ok(v >= 0 && v <= 1, `resource out of range: ${v}`);
      }
    }
    assert.equal(land, w.cellCount / 2, 'half of the map is land or lake basins');

    // Every river flows into its downstream neighbor, ending in water.
    for (let c = 0; c < w.cellCount; c++) {
      if (w.riverFlow[c] <= 0) continue;
      const dir = w.riverDir[c];
      assert.ok(dir >= 0 && dir < DIRECTION_COUNT);
      const next = w.neighbors[c * DIRECTION_COUNT + dir];
      assert.ok(next >= 0);
      assert.ok(w.riverFlow[next] > 0 || isWaterBiome(w.biome[next]), 'river ends on dry land');
    }

    // The tribe starts on hospitable land.
    assert.ok(w.startCell >= 0);
    const startBiome = w.biome[w.startCell];
    assert.ok(
      [Biome.Plains, Biome.Savanna, Biome.Forest, Biome.Hills].includes(startBiome as never),
      `start on ${BIOMES[startBiome].name}`,
    );
  });
}

test('a large map generates fast enough', () => {
  const t0 = performance.now();
  generateWorld({ seed: 7, width: 256, height: 256 });
  const ms = performance.now() - t0;
  assert.ok(ms < 5000, `256x256 took ${ms.toFixed(0)} ms`);
});

test('rivers always flow downhill, into lower land, a lake or the sea', () => {
  for (const seed of [1, 7, 42, 99, 2024]) {
    const world = generateWorld({ seed });
    for (let c = 0; c < world.cellCount; c++) {
      if (world.riverFlow[c] <= 0 || world.riverDir[c] < 0) continue;
      const next = world.neighbors[c * DIRECTION_COUNT + world.riverDir[c]];
      if (next < 0 || isWaterBiome(world.biome[next])) continue;
      assert.ok(world.elevation[next] < world.elevation[c], `seed ${seed}: river at ${c} flows uphill`);
    }
  }
});

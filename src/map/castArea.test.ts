import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ab, generateWorld } from '../sim';
import { castArea, hexesWithin, peopleHexes } from './castArea';

test('a cast covers 1, 7 or 37 hexes by its radius, a people ability the whole people', () => {
  const world = generateWorld({ seed: 3 });
  const center = Math.floor(world.height / 2) * world.width + Math.floor(world.width / 2);
  assert.equal(hexesWithin(world, center, 0).length, 1);
  assert.equal(hexesWithin(world, center, 1).length, 7);
  assert.equal(hexesWithin(world, center, 3).length, 37);
  assert.equal(new Set(hexesWithin(world, center, 3)).size, 37);
  assert.equal(castArea(world, Ab.ExhaustedSoil, center).length, 1);
  assert.equal(castArea(world, Ab.BiomeShift, center).length, 7);
  assert.equal(castArea(world, Ab.Drought, center).length, 37);
  assert.equal(castArea(world, Ab.WildFire, center).length, 1);
  assert.deepEqual(castArea(world, Ab.BiomeShift, -1), []);
  world.owner[center] = 4;
  world.owner[center + 1] = 4;
  assert.deepEqual(castArea(world, Ab.GratefulHearts, 4), peopleHexes(world, [4]));
  assert.equal(peopleHexes(world, [4]).length, 2);
});

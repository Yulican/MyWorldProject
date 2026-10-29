import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWaterBiome } from '../world/biomes';
import { generateWorld } from '../world/generate';
import { MAX_CIVS } from './civilizations';
import {
  BELIEVER_FAITH,
  TICKS_PER_YEAR,
  createSimulation,
  livingCivilizations,
  stepSimulation,
  type Simulation,
} from './simulation';

function runYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR; t++) stepSimulation(sim);
}

test('the game starts with the player tribe of 20 believers on the start hex', () => {
  const world = generateWorld({ seed: 42 });
  const sim = createSimulation(world);
  const civs = livingCivilizations(sim);
  assert.equal(civs.length, 1);
  assert.equal(civs[0].origin, 'start');
  assert.ok(civs[0].worshipsPlayer);
  assert.equal(sim.pop.count, 20);
  assert.equal(sim.believers, 20);
  assert.equal(world.population[world.startCell], 20);
  assert.equal(world.owner[world.startCell], civs[0].id);
});

test('same seed gives the same history', () => {
  const a = createSimulation(generateWorld({ seed: 7 }));
  const b = createSimulation(generateWorld({ seed: 7 }));
  runYears(a, 120);
  runYears(b, 120);
  assert.equal(a.pop.count, b.pop.count);
  assert.deepEqual(a.world.owner, b.world.owner);
  assert.deepEqual(a.chronicle, b.chronicle);
});

for (const seed of [1, 3, 1234]) {
  test(`seed ${seed}: after 200 years the bookkeeping is consistent`, () => {
    const sim = createSimulation(generateWorld({ seed }));
    runYears(sim, 200);
    const { pop, world } = sim;

    assert.ok(!sim.gameOver, 'the player still has believers');
    assert.ok(pop.count > 1000, `population grew to ${pop.count}`);
    const civs = livingCivilizations(sim);
    assert.ok(civs.length > 1 && civs.length <= MAX_CIVS, `${civs.length} civilizations`);

    const cellPop = new Int32Array(world.cellCount);
    let alive = 0;
    let believers = 0;
    for (let i = 0; i < pop.end; i++) {
      if (!pop.alive[i]) continue;
      alive++;
      const cell = pop.cell[i];
      cellPop[cell]++;
      assert.ok(!isWaterBiome(world.biome[cell]), 'nobody lives on water');
      assert.ok(sim.civs[pop.civ[i]], 'everyone belongs to a living civilization');
      if (pop.faith[i] >= BELIEVER_FAITH) believers++;
    }
    assert.equal(alive, pop.count);
    assert.deepEqual(cellPop, sim.cellPop);
    // The snapshot is at most one refresh old; 200 years end on a refresh tick.
    assert.equal(believers, sim.believers);
    for (const civ of civs) {
      assert.ok(civ.population > 0);
      assert.ok(world.owner[civ.capital] === civ.id || civ.population < 50, `${civ.name} holds its capital`);
    }
  });
}

test('100 years of a grown world simulate fast enough', () => {
  const sim = createSimulation(generateWorld({ seed: 99 }));
  runYears(sim, 150);
  const t0 = performance.now();
  runYears(sim, 100);
  const ms = performance.now() - t0;
  // Hermes on a phone is about 13x slower than Node; this keeps headroom.
  assert.ok(ms < 1500, `100 years with ${sim.pop.count} inhabitants took ${ms.toFixed(0)} ms`);
});

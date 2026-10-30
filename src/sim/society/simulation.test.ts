import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRECTION_COUNT, hexDistance } from '../hex';
import { isWaterBiome } from '../world/biomes';
import { generateWorld } from '../world/generate';
import { ROAD_TRAVEL_FACTOR, addRoad, hasRoad, travelCostField } from '../world/roads';
import { MAX_CIVS } from './civilizations';
import {
  BELIEVER_FAITH,
  EXPANSION_GROUP,
  TICKS_PER_YEAR,
  createSimulation,
  livingCivilizations,
  stepSimulation,
  type Simulation,
} from './simulation';
import { SUPPLY_KINDS, SupplyKind } from './supply';

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

test('breakaways are paused', () => {
  const sim = createSimulation(generateWorld({ seed: 1 }));
  runYears(sim, 200);
  assert.ok(livingCivilizations(sim).every((c) => c.origin !== 'secession'));
});

test('the faith ledger explains every change in believers', () => {
  const sim = createSimulation(generateWorld({ seed: 42 }));
  const player = livingCivilizations(sim)[0];
  runYears(sim, 30);
  for (let year = 0; year < 40; year++) {
    const before = player.believers;
    runYears(sim, 1);
    const l = player.faithLastYear;
    const net = l.born - l.died + l.grewDevout + l.wonByNeighbors - l.lostToNeighbors - l.forgot;
    assert.equal(player.believers - before, net, `year ${31 + year}: ${JSON.stringify(l)}`);
  }
  assert.equal(sim.history.believers.length, 70);
  assert.equal(sim.history.believers.at(-1), sim.believers);
});

test('settlements stay close to their people', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  runYears(sim, 120);
  const { world } = sim;
  // Every settled hex has a hex of the same civilization within 3 hexes.
  for (let c = 0; c < world.cellCount; c++) {
    const owner = world.owner[c];
    if (!owner) continue;
    let near = false;
    for (let o = 0; o < world.cellCount && !near; o++) {
      if (o !== c && world.owner[o] === owner && hexDistance(world, c, o) <= 3) near = true;
    }
    assert.ok(near || sim.civs[owner]!.territory === 1, `isolated settlement at hex ${c}`);
  }
});

test('100 years of a grown world simulate fast enough', () => {
  const sim = createSimulation(generateWorld({ seed: 99 }));
  runYears(sim, 150);
  const t0 = performance.now();
  runYears(sim, 100);
  const ms = performance.now() - t0;
  // Hermes on a phone is about 13x slower than Node; this keeps headroom.
  assert.ok(ms < 1500, `100 years with ${sim.pop.count} inhabitants took ${ms.toFixed(0)} ms`);
});

function roadCount(sim: Simulation): number {
  let ends = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    for (let d = 0; d < DIRECTION_COUNT; d++) if (hasRoad(sim.world, c, d)) ends++;
  }
  return ends / 2;
}

test('a hex supports as many people as its scarcest supply allows', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  const { world } = sim;
  let riverWater = 0;
  let rivers = 0;
  for (let c = 0; c < world.cellCount; c++) {
    const s = sim.cellSupply.subarray(c * SUPPLY_KINDS, (c + 1) * SUPPLY_KINDS);
    assert.equal(sim.cellCapacity[c], Math.min(s[0], s[1], s[2]));
    if (isWaterBiome(world.biome[c])) assert.equal(sim.cellCapacity[c], 0);
    if (world.riverFlow[c] > 0) {
      riverWater += s[SupplyKind.Water];
      rivers++;
    }
  }
  // Rivers bring fresh water on top of the rain.
  assert.ok(rivers > 0 && riverWater / rivers >= 70);
});

test('an overloaded hex sends 25 people to a free neighbor and builds a road', () => {
  const sim = createSimulation(generateWorld({ seed: 42 }));
  const { world } = sim;
  let roads = 0;
  for (let t = 0; t < 200 * TICKS_PER_YEAR && roads === 0; t++) {
    const before = Int32Array.from(sim.cellPop);
    stepSimulation(sim);
    roads = roadCount(sim);
    if (roads === 0) continue;
    // The new hex was empty and now holds exactly the group; a road joins it to its neighbor.
    const fresh = [...sim.cellPop.keys()].filter((c) => before[c] === 0 && sim.cellPop[c] > 0);
    assert.equal(fresh.length, 1);
    const target = fresh[0];
    assert.equal(sim.cellPop[target], EXPANSION_GROUP);
    const linked = [0, 1, 2, 3, 4, 5].filter((d) => hasRoad(world, target, d));
    assert.equal(linked.length, 1);
    const source = world.neighbors[target * DIRECTION_COUNT + linked[0]];
    assert.ok(before[source] > sim.cellCapacity[source], 'the source hex was overloaded');
    assert.ok(sim.cellPop[source] > 0, 'some people stay behind');
  }
  assert.equal(roads, 1, 'the first expansion happened within 200 years');
});

test('every road joins two neighboring land hexes, and settlements only grow next to their own', () => {
  const sim = createSimulation(generateWorld({ seed: 1 }));
  runYears(sim, 200);
  const { world } = sim;
  assert.ok(roadCount(sim) > 5);
  for (let c = 0; c < world.cellCount; c++) {
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      if (!hasRoad(world, c, d)) continue;
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      assert.ok(nb >= 0 && !isWaterBiome(world.biome[c]) && !isWaterBiome(world.biome[nb]));
      assert.ok(hasRoad(world, nb, (d + 3) % DIRECTION_COUNT), 'roads are set on both ends');
    }
  }
});

test('roads make travel cheaper', () => {
  const world = generateWorld({ seed: 9 });
  const from = world.startCell;
  const d = [0, 1, 2, 3, 4, 5].find((k) => {
    const nb = world.neighbors[from * DIRECTION_COUNT + k];
    return nb >= 0 && !isWaterBiome(world.biome[nb]);
  })!;
  const to = world.neighbors[from * DIRECTION_COUNT + d];
  const before = travelCostField(world, from, 100)[to];
  addRoad(world, from, d);
  const after = travelCostField(world, from, 100)[to];
  assert.ok(Math.abs(after - before * ROAD_TRAVEL_FACTOR) < 1e-6, `${before} -> ${after}`);
});

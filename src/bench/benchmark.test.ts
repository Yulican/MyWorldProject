import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BENCHMARK, SCENARIOS, evaluateSwipe, scenarioFromUrl, summarizeBenchmark, swipePlan, type SwipeResult } from './benchmark';

test('the plan has 10 swipes in each of the 8 directions at 1500 pt/s', () => {
  const plan = swipePlan();
  assert.equal(plan.length, 80);
  const perDirection = new Map<string, number>();
  for (const s of plan) perDirection.set(s.direction, (perDirection.get(s.direction) ?? 0) + 1);
  assert.equal(perDirection.size, 8);
  for (const n of perDirection.values()) assert.equal(n, 10);
  for (const s of plan) {
    const speed = Math.hypot(s.dx, s.dy) / (s.durationMs / 1000);
    assert.ok(Math.abs(speed - BENCHMARK.speed) < 1e-6);
  }
});

test('the plan returns to where it started, so it never runs into the map edge', () => {
  const plan = swipePlan();
  const x = plan.reduce((sum, s) => sum + s.dx, 0);
  const y = plan.reduce((sum, s) => sum + s.dy, 0);
  assert.ok(Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6);
});

test('a swipe passes only with >= 60 fps and no frame over 25 ms', () => {
  assert.equal(evaluateSwipe({ frames: 30, timeMs: 500.5, worstMs: 17 }).pass, true); // 59.9 fps on 60 Hz
  assert.equal(evaluateSwipe({ frames: 28, timeMs: 500, worstMs: 20 }).pass, false); // 56 fps
  assert.equal(evaluateSwipe({ frames: 60, timeMs: 500, worstMs: 26 }).pass, false); // one long frame
});

test('the benchmark passes only when all 400 swipes pass', () => {
  const ok: SwipeResult = { world: 0, seed: 1, direction: 'N', fps: 60, worstMs: 17, pass: true };
  const all = Array.from({ length: 400 }, () => ({ ...ok }));
  assert.equal(summarizeBenchmark(all).pass, true);
  all[123] = { ...ok, fps: 40, pass: false };
  assert.equal(summarizeBenchmark(all).pass, false);
  assert.equal(summarizeBenchmark(all.slice(0, 399)).pass, false);
});

test('the benchmark link picks the scenario, young by default', () => {
  assert.equal(scenarioFromUrl('myworld://benchmark'), 'young');
  assert.equal(scenarioFromUrl('myworld://benchmark?scenario=aged'), 'aged');
  assert.equal(scenarioFromUrl('myworld://benchmark?scenario=cities'), 'cities');
  assert.equal(scenarioFromUrl('myworld://benchmark?scenario=bogus'), 'young');
});

test('the cities scenario fills every settled hex with buildings and puts ruins beside them', async () => {
  const { createSimulation, generateWorld, TICKS_PER_YEAR, stepSimulation } = await import('../sim');
  const { fillWithBuildings } = await import('./fillBuildings');
  const sim = createSimulation(generateWorld({ seed: 5 }));
  for (let t = 0; t < 60 * TICKS_PER_YEAR; t++) stepSimulation(sim);
  fillWithBuildings(sim);
  const { world } = sim;
  let cities = 0;
  let ruins = 0;
  for (let c = 0; c < world.cellCount; c++) {
    if (sim.cellPop[c] > 0) {
      assert.equal(world.buildings[c], 4);
      cities++;
    }
    if (world.ruins[c] > 0) ruins++;
  }
  assert.ok(cities > 0 && ruins > 0);
  assert.equal(SCENARIOS.cities.buildings, true);
});

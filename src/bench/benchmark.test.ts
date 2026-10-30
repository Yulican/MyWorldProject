import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BENCHMARK, evaluateSwipe, summarizeBenchmark, swipePlan, type SwipeResult } from './benchmark';

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

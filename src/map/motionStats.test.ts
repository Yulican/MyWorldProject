import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addFrame, newMotionStats, summarize, wrappedDelta } from './motionStats';

test('smooth frames count as 0% missed', () => {
  const s = newMotionStats();
  for (let i = 0; i < 120; i++) addFrame(s, 1000 / 120, 10, 1200);
  const sum = summarize(s);
  assert.equal(Math.round(sum.fps), 120);
  assert.equal(Math.round(sum.missedPct), 0);
  assert.equal(Math.round(sum.avgSpeed), 1200);
});

test('a long frame counts the refresh slots it covered as missed', () => {
  const s = newMotionStats();
  for (let i = 0; i < 9; i++) addFrame(s, 10, 0, 0);
  addFrame(s, 50, 0, 0); // covers 5 refresh slots, 4 of them missed
  const sum = summarize(s);
  assert.equal(sum.worstMs, 50);
  assert.equal(Math.round(sum.missedPct), 29); // 4 of 14 expected frames
});

test('the wrap of the map offset is not counted as movement', () => {
  assert.equal(wrappedDelta(-5, 1000), -5);
  assert.equal(wrappedDelta(995, 1000), -5);
  assert.equal(wrappedDelta(-995, 1000), 5);
});

test('a known refresh rate counts missed frames even when every frame was slow', () => {
  const s = newMotionStats();
  for (let i = 0; i < 30; i++) addFrame(s, 1000 / 30, 0, 0); // 30 fps on a 120 Hz display
  assert.equal(Math.round(summarize(s).missedPct), 0); // unknown refresh: looks smooth
  assert.equal(Math.round(summarize(s, 1000 / 120).missedPct), 75);
});

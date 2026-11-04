import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markTimeline, timelineBetween, TimelineKind } from './perfStats';

test('the timeline sums JS work in a time window and keeps the longest JS gap', () => {
  const from = Date.now();
  markTimeline(TimelineKind.sim, 2.5);
  markTimeline(TimelineKind.sim, 1.5);
  markTimeline(TimelineKind.tiles, 3);
  markTimeline(TimelineKind.jsGap, 30);
  markTimeline(TimelineKind.jsGap, 45);
  const near = timelineBetween(from, Date.now());
  assert.equal(near.sim, 4);
  assert.equal(near.tiles, 3);
  assert.equal(near.jsGap, 45);
  assert.equal(near.snapshot, 0);
  assert.deepEqual(timelineBetween(from - 10_000, from - 5_000), { sim: 0, snapshot: 0, tiles: 0, handover: 0, jsGap: 0, tileMs: 0, handoverMs: 0, publishMs: 0 });
});

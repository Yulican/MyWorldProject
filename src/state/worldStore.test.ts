import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acknowledgeChronicle,
  advanceYears,
  closeAllChronicle,
  createNewWorld,
  getGameState,
  nextShown,
  setResumeSpeed,
  shownAfter,
} from './worldStore';

// The store's clock runs on requestAnimationFrame, which Node lacks: no frames here.
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0;

test('"Close all" closes every waiting chronicle dialog at once and resumes at the chosen speed', () => {
  createNewWorld(42);
  advanceYears(40);
  const { sim, chronicleSeen } = getGameState();
  assert.ok(sim);
  const length = sim.chronicle.length;
  const waiting = shownAfter(sim, chronicleSeen);
  assert.ok(waiting >= 2, `several dialogs waiting (${waiting})`);
  assert.equal(getGameState().speed, 0);

  // "Next" shows the following one and stays paused.
  acknowledgeChronicle();
  const next = getGameState().chronicleSeen;
  assert.equal(next, nextShown(sim, chronicleSeen + 1));
  assert.equal(shownAfter(sim, next), waiting - 1);
  assert.equal(getGameState().speed, 0);

  setResumeSpeed(3);
  closeAllChronicle();
  const after = getGameState();
  assert.equal(after.chronicleSeen, length);
  assert.equal(nextShown(sim, after.chronicleSeen), length, 'no dialog left');
  assert.equal(after.speed, 3);
  assert.equal(sim.chronicle.length, length, 'entries stay in the chronicle list');
});

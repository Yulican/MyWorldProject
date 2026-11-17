import assert from 'node:assert/strict';
import test from 'node:test';
import { ABILITIES, serializeWorld, stepSimulation, TICKS_PER_YEAR, validTargets } from '../sim';
import { APP_SAVE_VERSION, asciiBytes, readSaveFile, saveTrailer } from './saveFormat';
import {
  AUTOSAVE_MS,
  answerOverwrite,
  checkAutosave,
  closeMenu,
  continueAfterTap,
  getSaveState,
  loadFromMenu,
  memorySlot,
  newWorldFromMenu,
  onAppActive,
  onAppBackground,
  openMenu,
  openSave,
  resetSaveGame,
  saveFromMenu,
  startSaveGame,
} from './saveGame';
import { MapModeId, POLITICAL } from '../map/mapModes';
import {
  advanceSlicedSave,
  advanceYears,
  castCharge,
  closeAllChronicle,
  finishSlicedSaveNow,
  getGameState,
  getMapMode,
  mapMode,
  requestSlicedSave,
  setMapMode,
  setSpeed,
} from './worldStore';

// The store's clock runs on requestAnimationFrame, which Node lacks: no frames here.
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0;

/** Lets the slot's write promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An autosave that is due now runs to its end (the sliced save without frames). */
async function autosaveNow() {
  checkAutosave(Number.MAX_SAFE_INTEGER / 2);
  finishSlicedSaveNow();
  await settle();
}

test('the save file keeps the world and the app state beside it', () => {
  const meta = { v: APP_SAVE_VERSION, year: 12, savedAt: 1_700_000_000_000, speed: 2, resumeSpeed: 1, chronicleSeen: 7 };
  const world = new Uint8Array([1, 2, 3, 4, 5]);
  const tail = asciiBytes(saveTrailer(meta));
  const file = new Uint8Array(world.length + tail.length);
  file.set(world);
  file.set(tail, world.length);
  const read = readSaveFile(file);
  assert.ok(read.ok);
  assert.deepEqual(read.meta, meta);
  assert.deepEqual([...read.world], [...world]);
  assert.equal(readSaveFile(file.subarray(0, file.length - 3)).ok, false, 'cut off');
  assert.equal(readSaveFile(new Uint8Array([1, 2, 3])).ok, false, 'not a save');
  const bad = file.slice();
  bad[world.length + 3] = 0x7b; // the JSON broken
  assert.equal(readSaveFile(bad).ok, false, 'damaged');
});

test('no save: a new world starts and the autosave writes it once the game ran 2 minutes', async () => {
  resetSaveGame();
  const slot = memorySlot();
  startSaveGame(slot, { timerless: true });
  assert.equal(getSaveState().saved, null);
  assert.equal(getSaveState().message, null);
  setSpeed(1);
  checkAutosave(AUTOSAVE_MS - 1);
  finishSlicedSaveNow();
  await settle();
  assert.equal(slot.writes, 0, 'not due yet');
  await autosaveNow();
  assert.equal(slot.writes, 1);
  assert.equal(getSaveState().saved?.year, 1);
  // Unchanged since: not written again.
  await autosaveNow();
  assert.equal(slot.writes, 1);
});

test('app start continues the saved world exactly, paused until the first tap, chronicle state included', async () => {
  resetSaveGame();
  const slot = memorySlot();
  startSaveGame(slot, { timerless: true });
  advanceYears(30);
  closeAllChronicle();
  setSpeed(3);
  await autosaveNow();
  const saved = getGameState();
  assert.ok(saved.sim);
  const tick = saved.sim.tick;
  const seen = saved.chronicleSeen;
  // What the saved world does next, on a copy that keeps running.
  const copy = openSave(slot.bytes!);
  assert.ok(copy.ok);

  resetSaveGame();
  startSaveGame(slot, { timerless: true });
  const game = getGameState();
  assert.ok(game.sim && game.sim !== saved.sim);
  assert.equal(game.sim.tick, tick);
  assert.equal(game.chronicleSeen, seen);
  assert.equal(game.speed, 0, 'paused until the first tap');
  assert.equal(getSaveState().waitingForTap, true);
  continueAfterTap();
  assert.equal(getGameState().speed, 3);
  for (let t = 0; t < TICKS_PER_YEAR; t++) {
    stepSimulation(game.sim);
    stepSimulation(copy.sim);
  }
  assert.deepEqual(serializeWorld(game.sim), serializeWorld(copy.sim), 'continues as the saved world would');
});

test('chronicle entries still waiting are saved: after loading the game stays paused on them', async () => {
  resetSaveGame();
  const slot = memorySlot();
  startSaveGame(slot, { timerless: true });
  const first = getGameState();
  assert.ok(first.sim && first.chronicleSeen < first.sim.chronicle.length, 'the first entry waits');
  // The background save takes it as it is (the periodic one waits for the game to run).
  onAppBackground();
  assert.equal(slot.writes, 1);
  resetSaveGame();
  startSaveGame(slot, { timerless: true });
  const game = getGameState();
  assert.equal(game.chronicleSeen, first.chronicleSeen);
  assert.equal(game.speed, 0);
  assert.equal(getSaveState().waitingForTap, false, 'the dialog holds the game, no tap needed');
});

test('an invalid save starts a new world with a message and stays in place', () => {
  resetSaveGame();
  const slot = memorySlot();
  slot.bytes = new Uint8Array([9, 9, 9, 9]);
  startSaveGame(slot, { timerless: true });
  assert.ok(getGameState().sim);
  assert.equal(getSaveState().message, 'Saved world could not be loaded. A new world was started.');
  assert.equal(getSaveState().saved, null);
  assert.deepEqual([...slot.bytes!], [9, 9, 9, 9]);
});

test('after New World the first autosave asks; "Keep old save" turns autosave off until a manual Save', async () => {
  resetSaveGame();
  const slot = memorySlot();
  startSaveGame(slot, { timerless: true });
  setSpeed(1);
  await autosaveNow();
  assert.equal(slot.writes, 1);

  openMenu();
  assert.equal(getGameState().speed, 0, 'the menu pauses');
  assert.ok(await newWorldFromMenu(false));
  assert.equal(getSaveState().menuOpen, false);
  assert.equal(getSaveState().autosave, 'ask');
  setSpeed(2);
  // A background switch while the question is due saves nothing; the question comes on return.
  onAppBackground();
  assert.equal(slot.writes, 1);
  onAppActive();
  assert.equal(getSaveState().askOverwrite, true);
  assert.equal(getGameState().speed, 0, 'paused while asking');
  answerOverwrite(false);
  assert.equal(getSaveState().autosave, 'off');
  assert.equal(getGameState().speed, 2);
  await autosaveNow();
  onAppBackground();
  assert.equal(slot.writes, 1, 'no autosave after "Keep old save"');

  // A manual Save overwrites without asking and turns autosave on.
  openMenu();
  const save = saveFromMenu();
  finishSlicedSaveNow();
  assert.ok(await save);
  closeMenu();
  assert.equal(slot.writes, 2);
  assert.equal(getSaveState().autosave, 'on');
  assert.equal(getGameState().speed, 2, 'continues at the speed from before the menu');
});

test('"Overwrite" saves the new world and autosave runs normally; the background save covers changes made while paused', async () => {
  resetSaveGame();
  const slot = memorySlot();
  startSaveGame(slot, { timerless: true });
  assert.ok(await newWorldFromMenu(false));
  setSpeed(1);
  checkAutosave(Number.MAX_SAFE_INTEGER / 2);
  assert.equal(getSaveState().askOverwrite, true);
  answerOverwrite(true);
  finishSlicedSaveNow();
  await settle();
  assert.equal(slot.writes, 1);
  assert.equal(getSaveState().autosave, 'on');

  // Paused: no periodic autosave; a change (a cast) is saved when the app goes to the background.
  setSpeed(0);
  await autosaveNow();
  assert.equal(slot.writes, 1);
  onAppBackground();
  assert.equal(slot.writes, 1, 'unchanged: not written');
  const sim = getGameState().sim!;
  const ability = ABILITIES.findIndex((_, a) => validTargets(sim, a).length > 0);
  assert.ok(ability >= 0, 'something to cast');
  sim.gacha.charges[ability]++;
  assert.notEqual(castCharge(ability, validTargets(sim, ability)[0]), 'invalid');
  onAppBackground();
  assert.equal(slot.writes, 2);
});

test('Load restores the save at once; an invalid save keeps the running world', async () => {
  resetSaveGame();
  const slot = memorySlot();
  startSaveGame(slot, { timerless: true });
  closeAllChronicle();
  setSpeed(2);
  await autosaveNow();
  const savedTick = getGameState().sim!.tick;
  advanceYears(5);
  openMenu();
  assert.ok(await loadFromMenu());
  assert.equal(getGameState().sim!.tick, savedTick);
  assert.equal(getGameState().speed, 2, 'runs at the saved speed');
  assert.equal(getSaveState().menuOpen, false);

  const running = getGameState().sim;
  slot.bytes = slot.bytes!.slice(0, 100);
  openMenu();
  assert.equal(await loadFromMenu(), false);
  assert.equal(getGameState().sim, running);
  assert.equal(getSaveState().message, 'Saved world could not be loaded.');
  closeMenu();
});

test('a change outside the ticks (a cast) during a sliced save starts it over, so the save holds one consistent state', () => {
  resetSaveGame();
  startSaveGame(memorySlot(), { timerless: true });
  const sim = getGameState().sim!;
  let saved: Uint8Array | null = null;
  assert.ok(requestSlicedSave((bytes) => (saved = bytes)));
  assert.equal(requestSlicedSave(() => {}), false, 'one at a time');
  advanceSlicedSave(); // the save's start
  advanceSlicedSave(); // a slice
  const ability = ABILITIES.findIndex((_, a) => validTargets(sim, a).length > 0);
  sim.gacha.charges[ability] += 2;
  assert.notEqual(castCharge(ability, validTargets(sim, ability)[0]), 'invalid');
  finishSlicedSaveNow();
  assert.ok(saved);
  const loaded = deserialize(saved);
  assert.equal(loaded.tick, sim.tick);
  assert.equal(loaded.gacha.charges[ability], sim.gacha.charges[ability], 'the cast is in the save');
  assert.deepEqual(serializeWorld(loaded), serializeWorld(sim));
});

function deserialize(bytes: Uint8Array) {
  const meta = saveTrailer({ v: APP_SAVE_VERSION, year: 1, savedAt: 0, speed: 1, resumeSpeed: 1, chronicleSeen: 0 });
  const tail = asciiBytes(meta);
  const file = new Uint8Array(bytes.length + tail.length);
  file.set(bytes);
  file.set(tail, bytes.length);
  const opened = openSave(file);
  assert.ok(opened.ok);
  return opened.sim;
}

test('the map mode is saved in the app trailer and restored on load; an old save or New World gives Political', async () => {
  resetSaveGame();
  const slot = memorySlot();
  startSaveGame(slot, { timerless: true });
  closeAllChronicle();
  setMapMode({ id: MapModeId.Supply, sub: 1 });
  await autosaveNow();
  const read = readSaveFile(slot.bytes!);
  assert.ok(read.ok);
  assert.equal(read.meta.mapMode, 'supply.water');

  setMapMode(POLITICAL);
  openMenu();
  assert.ok(await loadFromMenu());
  assert.deepEqual(getMapMode(), { id: MapModeId.Supply, sub: 1 }, 'restored with the world');
  assert.equal(mapMode.bucket.length, getGameState().sim!.world.cellCount, 'buffer filled from the loaded world');

  // A save without the field (older version) or with an unknown mode loads in Political.
  for (const mode of [undefined, 'weather.rain']) {
    const tail = asciiBytes(saveTrailer({ ...read.meta, mapMode: mode }));
    const file = new Uint8Array(read.world.length + tail.length);
    file.set(read.world);
    file.set(tail, read.world.length);
    slot.bytes = file;
    setMapMode({ id: MapModeId.Population, sub: 0 });
    openMenu();
    assert.ok(await loadFromMenu());
    assert.deepEqual(getMapMode(), POLITICAL, String(mode));
  }

  setMapMode({ id: MapModeId.Satisfaction, sub: 0 });
  assert.ok(await newWorldFromMenu(false));
  assert.deepEqual(getMapMode(), POLITICAL, 'New World starts in Political');
});

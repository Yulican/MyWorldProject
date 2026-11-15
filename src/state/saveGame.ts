import { useSyncExternalStore } from 'react';
import { deserializeWorld, simulationYear, type Simulation } from '../sim';
import { APP_SAVE_VERSION, asciiBytes, readSaveFile, saveTrailer, type SaveMeta } from './saveFormat';
import {
  appState,
  cancelSave,
  createNewWorld,
  getGameState,
  loadSimulation,
  requestSlicedSave,
  runningMs,
  saveNow,
  setSpeed,
  worldStamp,
} from './worldStore';

// Saving and loading the world (Requirement Speichern und Laden): one slot,
// written by the Save button and the autosave (when the app goes to the
// background and every 2 minutes of running game time), the menu panel's
// actions, the start with the saved world and the protection of the save
// after "New World" ("Overwrite saved world?"). The world's bytes come from
// the store (worldStore: sliced save, saveNow) and go to a SaveSlot (the
// file in saveSlot.ts; memory in tests). Plain TypeScript: the screen wires
// the app's state changes (AppState) and the slot.

/** Real time of running game between two autosaves. */
export const AUTOSAVE_MS = 2 * 60 * 1000;
/** How often the store checks whether an autosave is due. */
const CHECK_MS = 1000;

/** Where the save game lives: written atomically (a crash never destroys the old save). */
export type SaveSlot = {
  /** The save file's bytes; null when there is none. */
  read(): Promise<Uint8Array | null>;
  readSync(): Uint8Array | null;
  /** Writes the world's bytes and the trailer as the new save, replacing the old one only once complete. */
  write(world: Uint8Array, trailer: string): Promise<void>;
  writeSync(world: Uint8Array, trailer: string): void;
};

/**
 * Autosave: 'on'; 'ask' after "New World" until the player answered
 * "Overwrite saved world?" (no autosave meanwhile); 'off' after "Keep old
 * save" until a manual Save.
 */
export type Autosave = 'on' | 'ask' | 'off';

export type SaveState = {
  /** The saved world as the menu panel shows it; null without a (valid) save. */
  saved: { year: number; savedAt: number } | null;
  autosave: Autosave;
  /** "Overwrite saved world?" is open (the game pauses). */
  askOverwrite: boolean;
  /** A save is under way (the Save button waits). */
  busy: boolean;
  /** The last autosave failed: a small hint in the menu panel. */
  autosaveFailed: boolean;
  /** A world continued at app start waits for the first tap. */
  waitingForTap: boolean;
  /** The menu panel is open (the game pauses). */
  menuOpen: boolean;
  /** A short message for the player (start or load failed, could not save); null when none. */
  message: string | null;
};

let state: SaveState = {
  saved: null,
  autosave: 'on',
  askOverwrite: false,
  busy: false,
  autosaveFailed: false,
  waitingForTap: false,
  menuOpen: false,
  message: null,
};
const listeners = new Set<() => void>();
let slot: SaveSlot | null = null;
/** The world as last saved (or loaded): unchanged, it isn't written again. */
let savedStamp: ReturnType<typeof worldStamp> | null = null;
/** Running time (runningMs) at the last autosave, load or new world. */
let lastSaveRun = 0;
/** The speed the game continues at after the menu, the overwrite question or the first tap. */
let menuResume = 0;
let promptResume = 0;
let tapSpeed = 0;
/** The app went to the background while autosave was 'ask': the question comes when the player returns. */
let askOnReturn = false;
/** The benchmark runs: it never reads or writes the slot and doesn't autosave. */
let benchmark = false;
let timer: ReturnType<typeof setInterval> | null = null;
/** An autosave is under way (kept out of SaveState: the screen needn't render for it). */
let autosaving = false;

function update(changes: Partial<SaveState>) {
  state = { ...state, ...changes };
  listeners.forEach((l) => l());
}

/** The save state for React. */
export function useSaveState(): SaveState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** The save state outside React (tests). */
export function getSaveState(): SaveState {
  return state;
}

/** Tests: starts over (no slot, no timer). */
export function resetSaveGame() {
  stopSaveGame();
  cancelSave();
  autosaving = false;
  slot = null;
  savedStamp = null;
  askOnReturn = false;
  benchmark = false;
  state = { saved: null, autosave: 'on', askOverwrite: false, busy: false, autosaveFailed: false, waitingForTap: false, menuOpen: false, message: null };
}

/**
 * App start (Requirement 5): continues the saved world, paused until the
 * first tap; without a save a new world starts; with an invalid one a new
 * world starts and a message says so (the file stays until the next save).
 * `skipSave` (the app was opened by the benchmark link): the slot isn't read.
 * Starts the autosave check unless `timerless` (tests).
 */
export function startSaveGame(saveSlot: SaveSlot, options: { skipSave?: boolean; timerless?: boolean } = {}) {
  slot = saveSlot;
  let bytes: Uint8Array | null = null;
  let readFailed = false;
  if (!options.skipSave) {
    try {
      bytes = saveSlot.readSync();
    } catch {
      readFailed = true;
    }
  }
  const loaded = bytes ? openSave(bytes) : null;
  if (loaded?.ok) {
    loadSimulation(loaded.sim, { ...loaded.meta, speed: 0 });
    const game = getGameState();
    // A chronicle entry waiting pauses the game anyway (its dialog shows); otherwise the first tap continues.
    const dialog = game.sim !== null && game.chronicleSeen < game.sim.chronicle.length;
    tapSpeed = loaded.meta.speed;
    markSaved(loaded.meta);
    update({ autosave: 'on', waitingForTap: !dialog });
  } else {
    createNewWorld();
    savedStamp = null;
    update({
      saved: null,
      autosave: 'on',
      message: bytes || readFailed ? 'Saved world could not be loaded. A new world was started.' : null,
    });
  }
  lastSaveRun = runningMs();
  if (!options.timerless && timer === null) timer = setInterval(() => checkAutosave(), CHECK_MS);
}

/** Stops the autosave check. */
export function stopSaveGame() {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

/** The first tap on a world continued at app start: the game runs at its saved speed (or the one the player chose in the time controls). */
export function continueAfterTap(speed: number = tapSpeed) {
  if (!state.waitingForTap) return;
  update({ waitingForTap: false });
  if (!state.menuOpen && !state.askOverwrite) setSpeed(speed);
  else if (state.menuOpen) menuResume = speed;
  else promptResume = speed;
}

/** The message was shown. */
export function dismissSaveMessage() {
  update({ message: null });
}

/** The benchmark starts (true) or ended (false); after it the world shown is a benchmark world, so autosave asks first. */
export function setSaveBenchmark(running: boolean) {
  benchmark = running;
  if (running) {
    cancelSave();
    update({ waitingForTap: false, askOverwrite: false });
    return;
  }
  lastSaveRun = runningMs();
  update({ autosave: state.autosave === 'off' ? 'off' : 'ask' });
}

// ---------------------------------------------------------------- autosave

/**
 * Runs every second: an autosave once the game has run AUTOSAVE_MS since the
 * last one (only while it runs, so changes made while paused wait for the
 * background save), or after "New World" the question first.
 */
export function checkAutosave(now: number = runningMs()) {
  if (!slot || benchmark || autosaving || state.busy || state.menuOpen || state.askOverwrite || state.waitingForTap) return;
  if (now - lastSaveRun < AUTOSAVE_MS || getGameState().speed === 0) return;
  if (state.autosave === 'off') return;
  if (state.autosave === 'ask') {
    openOverwriteQuestion();
    return;
  }
  lastSaveRun = now;
  if (unchanged()) return;
  void slicedSave(false);
}

function openOverwriteQuestion() {
  const game = getGameState();
  promptResume = game.speed;
  update({ askOverwrite: true });
  setSpeed(0);
}

/** The answer to "Overwrite saved world?": "Overwrite" (true) saves now and autosaves from then on; "Keep old save" turns autosave off for this world. */
export function answerOverwrite(overwrite: boolean) {
  if (!state.askOverwrite) return;
  update({ askOverwrite: false, autosave: overwrite ? 'on' : 'off' });
  lastSaveRun = runningMs();
  if (overwrite) void slicedSave(false);
  setSpeed(promptResume);
}

/**
 * The app goes to the background (or closes): the world is saved at once
 * (a running tick completed first), unless it is unchanged, autosave is off,
 * or the overwrite question is due (it comes when the player returns).
 */
export function onAppBackground() {
  if (!slot || benchmark || state.askOverwrite) return;
  if (state.autosave === 'ask') {
    askOnReturn = true;
    return;
  }
  if (state.autosave === 'off' || unchanged()) return;
  try {
    const bytes = saveNow();
    if (!bytes) return;
    const meta = currentMeta();
    slot.writeSync(bytes, saveTrailer(meta));
    markSaved(meta);
    update({ autosaveFailed: false });
  } catch {
    update({ autosaveFailed: true });
  }
}

/** The app is in the foreground again: the overwrite question skipped in the background comes now. */
export function onAppActive() {
  if (!askOnReturn || benchmark) return;
  askOnReturn = false;
  if (state.autosave === 'ask' && !state.askOverwrite) openOverwriteQuestion();
}

function unchanged(): boolean {
  const now = worldStamp();
  return savedStamp !== null && savedStamp.sim === now.sim && savedStamp.tick === now.tick && savedStamp.outside === now.outside;
}

function currentMeta(): SaveMeta {
  const sim = getGameState().sim as Simulation;
  const app = appState();
  // While the menu (or the question) pauses the game, its speed is the one it continues at.
  const speed = state.menuOpen ? menuResume : state.askOverwrite ? promptResume : state.waitingForTap ? tapSpeed : app.speed;
  return { v: APP_SAVE_VERSION, year: simulationYear(sim), savedAt: Date.now(), ...app, speed };
}

function markSaved(meta: SaveMeta) {
  savedStamp = worldStamp();
  update({ saved: { year: meta.year, savedAt: meta.savedAt } });
}

/** A sliced save of the current world into the slot; true once written. */
function slicedSave(manual: boolean): Promise<boolean> {
  const target = slot;
  if (!target) return Promise.resolve(false);
  // A save under way (an autosave) gives way to this one.
  cancelSave();
  const busy = (on: boolean) => {
    if (manual) update({ busy: on });
    else autosaving = on;
  };
  busy(true);
  return new Promise((resolve) => {
    const started = requestSlicedSave((bytes) => {
      if (!bytes) {
        busy(false);
        resolve(false);
        return;
      }
      const meta = currentMeta();
      const stamp = worldStamp();
      target.write(bytes, saveTrailer(meta)).then(
        () => {
          savedStamp = stamp;
          busy(false);
          update({ autosaveFailed: false, saved: { year: meta.year, savedAt: meta.savedAt } });
          resolve(true);
        },
        () => {
          busy(false);
          update(manual ? { message: 'Could not save.' } : { autosaveFailed: true });
          resolve(false);
        },
      );
    });
    if (!started) {
      busy(false);
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------- menu

/** Opens the menu panel: the game pauses until it closes. */
export function openMenu() {
  if (state.menuOpen) return;
  menuResume = getGameState().speed;
  update({ menuOpen: true });
  setSpeed(0);
}

/** Closes the menu panel: the game continues at its speed from before. */
export function closeMenu() {
  if (!state.menuOpen) return;
  update({ menuOpen: false });
  if (!state.waitingForTap) setSpeed(menuResume);
}

/** "Save": overwrites the slot without asking and turns autosave (back) on. True once saved. */
export async function saveFromMenu(): Promise<boolean> {
  if (!slot || benchmark) return false;
  update({ autosave: 'on', autosaveFailed: false });
  askOnReturn = false;
  lastSaveRun = runningMs();
  return slicedSave(true);
}

/**
 * "Load" (after the player confirmed): the saved world replaces the current
 * one and runs at once at its saved speed; autosave runs normally. An invalid
 * save keeps the current world (false, with the message).
 */
export async function loadFromMenu(): Promise<boolean> {
  if (!slot || benchmark) return false;
  let bytes: Uint8Array | null = null;
  try {
    bytes = await slot.read();
  } catch {
    bytes = null;
  }
  const loaded = bytes ? openSave(bytes) : null;
  if (!loaded?.ok) {
    update({ message: 'Saved world could not be loaded.' });
    return false;
  }
  loadSimulation(loaded.sim, loaded.meta);
  markSaved(loaded.meta);
  lastSaveRun = runningMs();
  askOnReturn = false;
  update({ menuOpen: false, autosave: 'on', waitingForTap: false, askOverwrite: false });
  return true;
}

/**
 * "New World" ("Save & New World" with `saveFirst`): a new world replaces the
 * current one; its first autosave asks first. If saving first fails, the
 * current world stays (false).
 */
export async function newWorldFromMenu(saveFirst: boolean): Promise<boolean> {
  if (saveFirst && !(await saveFromMenu())) {
    update({ message: 'Could not save.' });
    return false;
  }
  startNewWorld();
  update({ menuOpen: false });
  return true;
}

/** A new world without saving (also after game over): autosave asks before overwriting the save. */
export function startNewWorld() {
  cancelSave();
  createNewWorld();
  lastSaveRun = runningMs();
  askOnReturn = false;
  update({ autosave: 'ask', waitingForTap: false, askOverwrite: false });
}

// ---------------------------------------------------------------- reading

type Opened = { ok: true; sim: Simulation; meta: SaveMeta } | { ok: false; message: string };

/** The world and app state a save file holds, or why it can't be loaded (another version, damaged). */
export function openSave(bytes: Uint8Array): Opened {
  const file = readSaveFile(bytes);
  if (!file.ok) return file;
  const result = deserializeWorld(file.world);
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, sim: result.sim, meta: file.meta };
}

/** A slot in memory (tests). */
export function memorySlot(): SaveSlot & { bytes: Uint8Array | null; writes: number } {
  const s = {
    bytes: null as Uint8Array | null,
    writes: 0,
    read: async () => s.bytes,
    readSync: () => s.bytes,
    write: async (world: Uint8Array, trailer: string) => s.writeSync(world, trailer),
    writeSync: (world: Uint8Array, trailer: string) => {
      const tail = asciiBytes(trailer);
      const out = new Uint8Array(world.length + tail.length);
      out.set(world);
      out.set(tail, world.length);
      s.bytes = out;
      s.writes++;
    },
  };
  return s;
}

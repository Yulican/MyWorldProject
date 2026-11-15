import { APP_SAVE_VERSION, saveTrailer } from '../state/saveFormat';
import { openSave, type SaveSlot } from '../state/saveGame';
import { appState, cancelSave, getGameState, loadSimulation, requestSlicedSave } from '../state/worldStore';
import { simulationYear } from '../sim';

// The "save" benchmark scenario (Requirement Speichern und Laden 6): on an
// aged world the autosave runs over and over during the swipes. Each sliced
// save (the game clock stands still in its frames, as in the real autosave)
// is followed, once the clock has completed a tick, by the next one, and
// each finished save is written to the benchmark's own file (never the
// player's slot; a write still under way skips the next one). Once per world,
// while the map rests, `loadLatest` reads that file back, loads it the way
// "Load" does (the map is built anew) and checks that it is the world saved.

export type BenchSaves = {
  /** Stops saving (a save under way is dropped). */
  stop(): void;
  /** Reads the last save written and shows it in place of the current world; what happened, for the log. */
  loadLatest(): Promise<{ ok: boolean; ms: number; bytes: number; message?: string }>;
  /** Saves finished, written and skipped (a write was still under way) so far. */
  counts(): { saves: number; written: number; skipped: number };
};

export function startBenchSaves(slot: SaveSlot): BenchSaves {
  let running = true;
  let writing = false;
  let saves = 0;
  let written = 0;
  let skipped = 0;
  /** The tick and people of the last save written, to check the load. */
  let lastTick = -1;
  let lastPeople = -1;
  let pending: Promise<void> = Promise.resolve();
  let poll: number | null = null;

  const request = () => {
    poll = null;
    if (!running) return;
    requestSlicedSave(onSaved);
  };
  /** The next save once the clock has completed a tick after this one. */
  const next = (tick: number) => {
    if (!running) return;
    const wait = () => {
      poll = null;
      if (!running) return;
      if (getGameState().sim?.tick !== tick) request();
      else poll = requestAnimationFrame(wait);
    };
    poll = requestAnimationFrame(wait);
  };
  function onSaved(bytes: Uint8Array | null) {
    const sim = getGameState().sim;
    if (!bytes || !sim) {
      if (running && sim) next(-1);
      return;
    }
    saves++;
    const tick = sim.tick;
    if (writing) skipped++;
    else {
      writing = true;
      const people = sim.pop.count;
      const trailer = saveTrailer({ v: APP_SAVE_VERSION, year: simulationYear(sim), savedAt: Date.now(), ...appState() });
      pending = slot.write(bytes, trailer).then(
        () => {
          written++;
          lastTick = tick;
          lastPeople = people;
          writing = false;
        },
        () => {
          writing = false;
        },
      );
    }
    next(tick);
  }
  request();

  return {
    stop() {
      running = false;
      if (poll !== null) cancelAnimationFrame(poll);
      poll = null;
      cancelSave();
    },
    async loadLatest() {
      // No save may run while the world is replaced; the saves go on with the loaded world.
      const wasRunning = running;
      running = false;
      if (poll !== null) cancelAnimationFrame(poll);
      poll = null;
      cancelSave();
      await pending;
      const t0 = performance.now();
      const bytes = await slot.read();
      const opened = bytes ? openSave(bytes) : null;
      const ms = performance.now() - t0;
      const size = bytes?.length ?? 0;
      let result: { ok: boolean; ms: number; bytes: number; message?: string };
      if (!opened) result = { ok: false, ms, bytes: size, message: 'no save written' };
      else if (!opened.ok) result = { ok: false, ms, bytes: size, message: opened.message };
      else if (opened.sim.tick !== lastTick || opened.sim.pop.count !== lastPeople) {
        result = { ok: false, ms, bytes: size, message: `loaded tick ${opened.sim.tick}/${opened.sim.pop.count} people, saved ${lastTick}/${lastPeople}` };
      } else {
        loadSimulation(opened.sim, opened.meta);
        result = { ok: true, ms, bytes: size };
      }
      running = wasRunning;
      if (running) request();
      return result;
    },
    counts: () => ({ saves, written, skipped }),
  };
}

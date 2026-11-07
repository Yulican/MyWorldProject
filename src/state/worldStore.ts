import { useSyncExternalStore } from 'react';
import {
  MAX_ARMIES,
  TICKS_PER_YEAR,
  TICK_PARTS,
  createSimulation,
  generateWorld,
  randomSeed,
  stepSimulation,
  stepSimulationPart,
  TickPart,
  type Simulation,
  type World,
} from '../sim';
import type { ExtraArmies } from '../bench/armyDecoys';
import { countEvent, recordSimWork } from './perfStats';

// Holds the current world and its simulation outside React (see design doc:
// simulation state lives outside React, components subscribe to what they
// need) and runs the game clock.

/** Simulation ticks (weeks) per second for each speed level; 0 = paused. */
export const SPEEDS = [0, 6, 26, 104] as const;
const DEFAULT_SPEED = 1;
/**
 * Simulation time per frame for each speed level, so the UI stays smooth
 * even at top speed. Slower speeds need far less, so a long tick is spread
 * over several frames there (one part of it per frame at least, see
 * stepSimulationPart) instead of costing one frame its smoothness.
 */
const FRAME_BUDGET_MS = [0, 3, 4, 8] as const;
/** React is told about new map snapshots at most this often. */
const NOTIFY_INTERVAL_MS = 400;
/** The map's army markers follow the armies (they move weekly) at most this often. */
const ARMY_INTERVAL_MS = 250;

/**
 * The war as the territory layer draws it, copied from the simulation with
 * every map snapshot (so borders, sieges and owners always match): per people
 * the people it is at war with (0 = none), per cell 1 while besieged.
 * Arrays are reused; only a new world replaces `siege`.
 */
export const mapWar = { enemy: new Uint8Array(256), siege: new Uint8Array(0) };

/**
 * The map's army markers: `count` armies, each on hex `cell[i]` with the
 * people `civ[i]` (its flag color) and its state `state[i]`. Filled in place, never reallocated.
 */
export const mapArmies = {
  count: 0,
  cell: new Int32Array(MAX_ARMIES),
  civ: new Uint8Array(MAX_ARMIES),
  /** ArmyState: marching, gathering, retreating (the marker's shield color). */
  state: new Uint8Array(MAX_ARMIES),
  version: 0,
};

export type GameState = {
  sim: Simulation | null;
  speed: number;
  /** Changes with every map snapshot the UI hasn't seen yet. */
  version: number;
  /**
   * Chronicle entries the player has seen; while there are more, the game
   * is paused and the chronicle dialog shows the next one.
   */
  chronicleSeen: number;
  /** Speed the game continues at once the chronicle dialog is closed (chosen meanwhile in the time controls). */
  resumeSpeed: number;
  /** Off while the benchmark runs: no dialogs, no pauses. */
  chronicleDialogs: boolean;
};

let state: GameState = {
  sim: null,
  speed: DEFAULT_SPEED,
  version: 0,
  chronicleSeen: 0,
  resumeSpeed: DEFAULT_SPEED,
  chronicleDialogs: true,
};
const listeners = new Set<() => void>();

let frame: number | null = null;
let lastFrameTime = 0;
let pendingTicks = 0;
let lastNotify = 0;
let notifiedSnapshot = -1;
let lastArmyNotify = 0;
let syncedWar = -1;
let syncedTick = -1;
/** Benchmark only: extra army markers up to the world cap (see bench/armyDecoys.ts); null in the game. */
let extraArmies: ExtraArmies | null = null;
const armyListeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Takes the war data the territory layer draws (with a new map snapshot). */
function syncMapWar(sim: Simulation) {
  const w = sim.war;
  if (mapWar.siege.length !== sim.world.cellCount) mapWar.siege = new Uint8Array(sim.world.cellCount);
  mapWar.enemy.set(w.enemy.subarray(0, mapWar.enemy.length));
  mapWar.siege.set(w.siege);
}

/** Takes the armies' places and peoples; tells the map's army layer only if a marker changed. */
function syncArmies(sim: Simulation) {
  const w = sim.war;
  syncedWar = w.version;
  syncedTick = sim.tick;
  let k = 0;
  let changed = false;
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a]) continue;
    if (mapArmies.cell[k] !== w.aCell[a] || mapArmies.civ[k] !== w.aCiv[a] || mapArmies.state[k] !== w.aState[a]) changed = true;
    mapArmies.cell[k] = w.aCell[a];
    mapArmies.civ[k] = w.aCiv[a];
    mapArmies.state[k] = w.aState[a];
    k++;
  }
  if (extraArmies) {
    // Benchmark decoys move every week: their markers are recorded again with every sync.
    k = extraArmies.fill(sim, mapArmies, k);
    changed = true;
  }
  if (k !== mapArmies.count) changed = true;
  mapArmies.count = k;
  if (!changed) return;
  mapArmies.version++;
  armyListeners.forEach((l) => l());
}

/** A new map snapshot is shown: the war data and armies come along. */
function syncSnapshot(sim: Simulation) {
  notifiedSnapshot = sim.snapshotVersion;
  syncMapWar(sim);
  syncArmies(sim);
}

function publish(changes: Partial<GameState>) {
  state = { ...state, ...changes, version: state.version + 1 };
  listeners.forEach((l) => l());
}

/** Generates a new world (random seed if none given), settles the tribe and starts the clock. */
export function createNewWorld(seed: number = randomSeed()): World {
  const sim = createSimulation(generateWorld({ seed }));
  syncSnapshot(sim);
  pendingTicks = 0;
  const seen = state.chronicleDialogs ? nextShown(sim, 0) : sim.chronicle.length;
  publish({
    sim,
    speed: seen < sim.chronicle.length ? 0 : DEFAULT_SPEED,
    chronicleSeen: seen,
    resumeSpeed: DEFAULT_SPEED,
  });
  startClock();
  return sim.world;
}

/**
 * Simulates the current world for `years` at once (for the benchmark's aged
 * scenarios), applies `prepare` (e.g. a benchmark's extra state) and shows
 * the result.
 */
export function advanceYears(years: number, prepare?: (sim: Simulation) => void) {
  const { sim } = state;
  if (!sim) return;
  for (let t = 0; t < years * TICKS_PER_YEAR && !sim.gameOver; t++) stepSimulation(sim);
  prepare?.(sim);
  syncSnapshot(sim);
  publish(state.chronicleDialogs ? {} : { chronicleSeen: sim.chronicle.length });
}

export function setSpeed(speed: number) {
  publish({ speed });
  if (SPEEDS[speed] > 0) startClock();
}

/** The speed chosen in the chronicle dialog, applied when it closes. */
export function setResumeSpeed(resumeSpeed: number) {
  publish({ resumeSpeed });
}

/**
 * The player saw the current chronicle entry: shows the next one, or closes
 * the dialog and continues at the chosen speed.
 */
export function acknowledgeChronicle() {
  const { sim, chronicleSeen, resumeSpeed } = state;
  if (!sim) return;
  const seen = nextShown(sim, chronicleSeen + 1);
  publish({ chronicleSeen: seen });
  if (seen >= sim.chronicle.length) setSpeed(resumeSpeed);
}

/** Benchmark only: extra army markers on the map (the war scenario's worst case), null to stop. */
export function setExtraArmies(extra: ExtraArmies | null) {
  extraArmies = extra;
}

/** Turns the chronicle dialogs off (and back on) for the benchmark. */
export function setChronicleDialogs(enabled: boolean) {
  publish({ chronicleDialogs: enabled, chronicleSeen: state.sim?.chronicle.length ?? 0 });
}

/**
 * The first entry from `from` the dialog shows: the game-over entry has its
 * own screen and is skipped.
 */
function nextShown(sim: Simulation, from: number): number {
  let i = from;
  while (i < sim.chronicle.length && sim.chronicle[i].cell < 0) i++;
  return i;
}

/** Simulation, speed and a version that changes whenever the map snapshot does. */
export function useGameState(): GameState {
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * The society snapshot as an external store for the map: changes only when a
 * new snapshot is shown, not on speed changes or other updates.
 */
export const snapshotStore = {
  subscribe,
  getVersion: (): number => notifiedSnapshot,
};

/** The army markers as an external store: notifies when a marker moved, appeared or is gone (see mapArmies). */
export const armyStore = {
  subscribe: (listener: () => void): (() => void) => {
    armyListeners.add(listener);
    return () => armyListeners.delete(listener);
  },
  getVersion: (): number => mapArmies.version,
};

function startClock() {
  if (frame !== null) return;
  lastFrameTime = performance.now();
  frame = requestAnimationFrame(runFrame);
}

/**
 * The longest recent run of each tick part (ms, decaying), by part and week
 * of the year (the yearly plans differ by week), to stop before a part that
 * would overrun the frame budget.
 */
const partMs = new Float64Array(TICK_PARTS * TICKS_PER_YEAR);
const partKey = (sim: Simulation) => sim.part * TICKS_PER_YEAR + (sim.tick % TICKS_PER_YEAR);

/**
 * Runs as many ticks as the speed asks for, within the frame budget, part
 * by part: a long tick continues in the next frame. A tick that has begun is
 * always finished, also after pausing. A new map snapshot is handed to the
 * map and React in a frame without simulation work. Stops itself while
 * paused or after game over; the clock doesn't run in the background, so
 * there is no offline progress (design doc, section 3).
 */
function runFrame(now: number) {
  frame = null;
  const { sim, speed } = state;
  if (!sim) return;
  const ticksPerSecond = SPEEDS[speed];
  const betweenTicks = sim.part === TickPart.Start;

  // Cap the step after long pauses (e.g. the app was in the background).
  const seconds = Math.min(0.25, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  // A new snapshot (complete after its tick) gets a frame of its own.
  if (betweenTicks && sim.snapshotVersion !== notifiedSnapshot && (sim.gameOver || now - lastNotify >= NOTIFY_INTERVAL_MS)) {
    syncSnapshot(sim);
    lastNotify = now;
    lastArmyNotify = now;
    countEvent('snapshots');
    pendingTicks += ticksPerSecond * seconds;
    publish({});
    if (!sim.gameOver && ticksPerSecond > 0) frame = requestAnimationFrame(runFrame);
    return;
  }
  // Moved armies get a frame of their own too (the map records their markers again).
  if (betweenTicks && (sim.war.version !== syncedWar || (extraArmies && sim.tick !== syncedTick)) && now - lastArmyNotify >= ARMY_INTERVAL_MS) {
    lastArmyNotify = now;
    pendingTicks += ticksPerSecond * seconds;
    syncArmies(sim);
    if (!sim.gameOver && ticksPerSecond > 0) frame = requestAnimationFrame(runFrame);
    return;
  }
  if (betweenTicks && (ticksPerSecond === 0 || sim.gameOver)) return;

  pendingTicks += ticksPerSecond * seconds;
  const start = performance.now();
  const budget = Math.max(FRAME_BUDGET_MS[speed], FRAME_BUDGET_MS[1]);
  let ticks = 0;
  let parts = 0;
  const entries = sim.chronicle.length;
  for (;;) {
    // A new tick only while the speed asks for one and nothing notable happened in this frame (or is waiting to be shown).
    if (sim.part === TickPart.Start) {
      if (pendingTicks < 1 || sim.gameOver || ticksPerSecond === 0 || sim.chronicle.length !== entries) break;
      if (state.chronicleDialogs && nextShown(sim, state.chronicleSeen) < sim.chronicle.length) break;
    }
    const key = partKey(sim);
    const partStart = performance.now();
    if (parts > 0 && partStart - start + partMs[key] > budget) break;
    if (sim.part === TickPart.Start) pendingTicks--;
    const done = stepSimulationPart(sim);
    const ms = performance.now() - partStart;
    partMs[key] = Math.max(ms, partMs[key] * 0.9);
    parts++;
    if (done) ticks++;
  }
  recordSimWork(performance.now() - start, ticks);
  // Drop what didn't fit instead of piling up a backlog.
  pendingTicks = Math.min(pendingTicks, 2);

  // Something notable happened: pause and show it (the chronicle dialog) once its tick is complete.
  if (state.chronicleDialogs && sim.part === TickPart.Start) {
    const seen = nextShown(sim, state.chronicleSeen);
    if (seen < sim.chronicle.length) {
      syncSnapshot(sim);
      pendingTicks = 0;
      publish({ chronicleSeen: seen, speed: 0, resumeSpeed: speed });
      return;
    }
  }

  // Game over: the last snapshot is still shown in the next frame.
  const more = sim.gameOver ? sim.snapshotVersion !== notifiedSnapshot : ticksPerSecond > 0;
  if (sim.part !== TickPart.Start || more) frame = requestAnimationFrame(runFrame);
}

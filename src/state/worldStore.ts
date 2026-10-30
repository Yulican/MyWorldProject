import { useSyncExternalStore } from 'react';
import {
  TICKS_PER_YEAR,
  createSimulation,
  generateWorld,
  randomSeed,
  stepSimulation,
  type Simulation,
  type World,
} from '../sim';
import { countEvent, recordSimWork } from './perfStats';

// Holds the current world and its simulation outside React (see design doc:
// simulation state lives outside React, components subscribe to what they
// need) and runs the game clock.

/** Simulation ticks (weeks) per second for each speed level; 0 = paused. */
export const SPEEDS = [0, 6, 26, 104] as const;
const DEFAULT_SPEED = 1;
/** Simulation time per frame, so the UI stays smooth even at top speed. */
const FRAME_BUDGET_MS = 8;
/** React is told about new map snapshots at most this often. */
const NOTIFY_INTERVAL_MS = 400;

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
  /** Speed the game continues at once the chronicle dialog is closed. */
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

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(changes: Partial<GameState>) {
  state = { ...state, ...changes, version: state.version + 1 };
  listeners.forEach((l) => l());
}

/** Generates a new world (random seed if none given), settles the tribe and starts the clock. */
export function createNewWorld(seed: number = randomSeed()): World {
  const sim = createSimulation(generateWorld({ seed }));
  notifiedSnapshot = sim.snapshotVersion;
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
  notifiedSnapshot = sim.snapshotVersion;
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

function startClock() {
  if (frame !== null) return;
  lastFrameTime = performance.now();
  frame = requestAnimationFrame(runFrame);
}

/**
 * Runs as many ticks as the speed asks for, within the frame budget. Stops
 * itself while paused or after game over; the clock doesn't run in the
 * background, so there is no offline progress (design doc, section 3).
 */
function runFrame(now: number) {
  frame = null;
  const { sim, speed } = state;
  const ticksPerSecond = SPEEDS[speed];
  if (!sim || ticksPerSecond === 0 || sim.gameOver) return;

  // Cap the step after long pauses (e.g. the app was in the background).
  const seconds = Math.min(0.25, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  pendingTicks += ticksPerSecond * seconds;
  const start = performance.now();
  const deadline = start + FRAME_BUDGET_MS;
  let ticks = 0;
  const entries = sim.chronicle.length;
  while (pendingTicks >= 1 && !sim.gameOver && performance.now() < deadline && sim.chronicle.length === entries) {
    stepSimulation(sim);
    pendingTicks--;
    ticks++;
  }
  recordSimWork(performance.now() - start, ticks);
  // Drop what didn't fit instead of piling up a backlog.
  pendingTicks = Math.min(pendingTicks, 2);

  // Something notable happened: pause and show it (the chronicle dialog).
  if (state.chronicleDialogs && sim.chronicle.length > entries) {
    const seen = nextShown(sim, state.chronicleSeen);
    if (seen < sim.chronicle.length) {
      notifiedSnapshot = sim.snapshotVersion;
      pendingTicks = 0;
      publish({ chronicleSeen: seen, speed: 0, resumeSpeed: speed });
      return;
    }
  }

  if (sim.snapshotVersion !== notifiedSnapshot && (sim.gameOver || now - lastNotify >= NOTIFY_INTERVAL_MS)) {
    notifiedSnapshot = sim.snapshotVersion;
    lastNotify = now;
    countEvent('snapshots');
    publish({});
  }
  if (!sim.gameOver) frame = requestAnimationFrame(runFrame);
}

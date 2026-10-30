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
};

let state: GameState = { sim: null, speed: DEFAULT_SPEED, version: 0 };
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
  publish({ sim, speed: DEFAULT_SPEED });
  startClock();
  return sim.world;
}

/**
 * Simulates the current world for `years` at once (for the benchmark's aged
 * scenario) and shows the result.
 */
export function advanceYears(years: number) {
  const { sim } = state;
  if (!sim) return;
  for (let t = 0; t < years * TICKS_PER_YEAR && !sim.gameOver; t++) stepSimulation(sim);
  notifiedSnapshot = sim.snapshotVersion;
  publish({});
}

export function setSpeed(speed: number) {
  publish({ speed });
  if (SPEEDS[speed] > 0) startClock();
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
  while (pendingTicks >= 1 && !sim.gameOver && performance.now() < deadline) {
    stepSimulation(sim);
    pendingTicks--;
    ticks++;
  }
  recordSimWork(performance.now() - start, ticks);
  // Drop what didn't fit instead of piling up a backlog.
  pendingTicks = Math.min(pendingTicks, 2);

  if (sim.snapshotVersion !== notifiedSnapshot && (sim.gameOver || now - lastNotify >= NOTIFY_INTERVAL_MS)) {
    notifiedSnapshot = sim.snapshotVersion;
    lastNotify = now;
    countEvent('snapshots');
    publish({});
  }
  if (!sim.gameOver) frame = requestAnimationFrame(runFrame);
}

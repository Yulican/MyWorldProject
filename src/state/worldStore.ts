import { useSyncExternalStore } from 'react';
import {
  MAX_ARMIES,
  TICKS_PER_YEAR,
  TICK_PARTS,
  TICK_PART_NAMES,
  createSimulation,
  generateWorld,
  randomSeed,
  stepSimulation,
  stepSimulationPart,
  TickPart,
  type ChronicleEntry,
  type Simulation,
  type World,
} from '../sim';
import type { ExtraArmies } from '../bench/armyDecoys';
import { countEvent, logWork, recordSimWork, workLogging } from './perfStats';

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
 * While the map moves, a tick part expected to take longer than this (its
 * longest recent run) and a new map snapshot wait until the map rests, at
 * most HOLD_MS: such a part costs a frame of the movement on its own. The
 * ticks that pile up meanwhile are caught up afterwards, so the simulation
 * keeps its speed.
 */
const MOVING_PART_MS = 6;
const HOLD_MS = 750;

/**
 * The war as the territory layer draws it, copied from the simulation with
 * every map snapshot (so borders, sieges and owners always match): per people
 * pair (a * 256 + b) the wars they fight on opposite sides (allies too), per
 * cell 1 while besieged.
 * Arrays are reused; only a new world replaces `siege`.
 */
export const mapWar = { foe: new Uint8Array(256 * 256), siege: new Uint8Array(0) };

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
/**
 * After a new world appears, the previous world is garbage once the map has
 * let go of it (its tiles are disposed when it re-renders). A forced
 * collection then, while the new world loads, frees it at once; left to the
 * collector, freeing it came during the first minute of panning the new
 * world and cost single frames of 30+ ms (the benchmark's second world).
 * Shorter than the benchmark's settle time (useBenchmark WORLD_SETTLE_MS).
 */
const OLD_WORLD_GC_DELAY_MS = 800;
/**
 * A full garbage collection also runs when the map comes to rest, at most
 * this often. Left to the collector, the garbage of a minute of play (tile
 * images, pictures, the simulation's lists) is freed in one collection of
 * 40+ ms whenever it decides to, also in the middle of a movement, where it
 * costs a frame (the war benchmark: one swipe late in a world). Collected
 * every few seconds while nothing moves, it stays small and costs no frame.
 */
const REST_GC_INTERVAL_MS = 6000;

export type GameState = {
  sim: Simulation | null;
  speed: number;
  /** Changes with every map snapshot the UI hasn't seen yet. */
  version: number;
  /**
   * Chronicle entries the player has seen; while an important one follows,
   * the game is paused and the chronicle dialog shows it. Other entries are
   * counted as seen right away (they only go into the chronicle list).
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
/** The map moves (WorldMap tells, see setMapMoving); since when work has been held back for it (0 = nothing held). */
let mapMoving = false;
let heldSince = 0;
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
  mapWar.foe.set(w.foe.subarray(0, mapWar.foe.length));
  mapWar.siege.set(w.siege);
  // Benchmark only: siege-frame decoys on real seats of peoples at war (bench/armyDecoys.ts).
  extraArmies?.sieges(sim, mapWar.siege);
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
  collectOldWorld();
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
  // Simulating years at once leaves garbage of its own.
  collectOldWorld();
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

/** The map started moving (true) or rests again (false): long tick parts and snapshots wait while it moves. */
export function setMapMoving(moving: boolean) {
  mapMoving = moving;
  if (moving) return;
  heldSince = 0;
  collectAtRest();
}

/** Whether work expected to take `ms` (or a snapshot, Infinity) should wait for the map to rest; starts the hold. */
function holdForMap(now: number, ms: number): boolean {
  if (!mapMoving || ms <= MOVING_PART_MS) return false;
  if (heldSince === 0) heldSince = now;
  return now - heldSince < HOLD_MS;
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
 * Whether the chronicle dialog shows an entry: only important ones, and not
 * the game-over entry, which has its own screen. The others only go into the
 * chronicle list.
 */
export function shownInDialog(entry: ChronicleEntry): boolean {
  return entry.important && entry.cell >= 0;
}

/** The first entry from `from` the dialog shows (the chronicle length if none). */
export function nextShown(sim: Simulation, from: number): number {
  let i = from;
  while (i < sim.chronicle.length && !shownInDialog(sim.chronicle[i])) i++;
  return i;
}

/** How many entries after `seen` the dialog still shows. */
export function shownAfter(sim: Simulation, seen: number): number {
  let n = 0;
  for (let i = seen + 1; i < sim.chronicle.length; i++) if (shownInDialog(sim.chronicle[i])) n++;
  return n;
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
let gcTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Runs a full garbage collection shortly after a world was created or
 * simulated ahead (see OLD_WORLD_GC_DELAY_MS), on the JS thread while the map
 * keeps running on the UI thread. Hermes provides gc(); elsewhere a no-op.
 */
function collectOldWorld() {
  if (gcTimer !== null) clearTimeout(gcTimer);
  gcTimer = setTimeout(() => {
    gcTimer = null;
    lastFullGc = performance.now();
    (globalThis as { gc?: () => void }).gc?.();
  }, OLD_WORLD_GC_DELAY_MS);
}

let lastFullGc = 0;

/** The map came to rest: a full collection now, if the last one is REST_GC_INTERVAL_MS ago (Hermes; elsewhere a no-op). */
function collectAtRest() {
  const now = performance.now();
  if (now - lastFullGc < REST_GC_INTERVAL_MS) return;
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) return;
  lastFullGc = now;
  gc();
  logWork('GC at rest (forced)', now, performance.now() - now);
}

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
/** Which parts (by key) have run, and the longest recent run of each kind of part (any week), to estimate a part that hasn't run yet. */
const partSeen = new Uint8Array(TICK_PARTS * TICKS_PER_YEAR);
const partTypeMs = new Float64Array(TICK_PARTS).fill(-1);

/**
 * The expected time of the next part: its own longest recent run, or for a
 * part that hasn't run yet the longest recent run of its kind, or for a kind
 * that hasn't run yet more than MOVING_PART_MS (it waits while the map moves).
 */
function expectedMs(key: number, part: number): number {
  if (partSeen[key]) return partMs[key];
  return partTypeMs[part] >= 0 ? partTypeMs[part] : MOVING_PART_MS + 1;
}

/** "sim Plan@47#3": a tick part by name, week of the year and step (benchmark diagnostics). */
const partLabel = (sim: Simulation) =>
  `sim ${TICK_PART_NAMES[sim.part]}@${sim.tick % TICKS_PER_YEAR}${sim.planStep > 0 ? `#${sim.planStep}` : ''}`;

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

  // A new snapshot (complete after its tick) gets a frame of its own, once the map rests (or has waited long enough).
  if (
    betweenTicks &&
    sim.snapshotVersion !== notifiedSnapshot &&
    (sim.gameOver || (now - lastNotify >= NOTIFY_INTERVAL_MS && !holdForMap(now, Infinity)))
  ) {
    heldSince = 0;
    const t0 = performance.now();
    syncSnapshot(sim);
    lastNotify = now;
    lastArmyNotify = now;
    countEvent('snapshots');
    pendingTicks += ticksPerSecond * seconds;
    publish({});
    logWork('snapshot', t0, performance.now() - t0);
    if (!sim.gameOver && ticksPerSecond > 0) frame = requestAnimationFrame(runFrame);
    return;
  }
  // Moved armies get a frame of their own too (the map records their markers again).
  if (betweenTicks && (sim.war.version !== syncedWar || (extraArmies && sim.tick !== syncedTick)) && now - lastArmyNotify >= ARMY_INTERVAL_MS) {
    lastArmyNotify = now;
    pendingTicks += ticksPerSecond * seconds;
    const t0 = performance.now();
    syncArmies(sim);
    logWork('army sync', t0, performance.now() - t0);
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
    const part = sim.part;
    const expected = expectedMs(key, part);
    if (parts > 0 && partStart - start + expected > budget) break;
    if (holdForMap(now, expected)) break;
    if (expected > MOVING_PART_MS) heldSince = 0;
    if (sim.part === TickPart.Start) pendingTicks--;
    const label = workLogging() ? partLabel(sim) : '';
    const done = stepSimulationPart(sim);
    const ms = performance.now() - partStart;
    logWork(label, partStart, ms);
    partMs[key] = Math.max(ms, partMs[key] * 0.9);
    partSeen[key] = 1;
    partTypeMs[part] = Math.max(ms, partTypeMs[part] * 0.99);
    parts++;
    if (done) ticks++;
  }
  recordSimWork(performance.now() - start, ticks);
  // Drop what didn't fit instead of piling up a backlog (but keep what waited for the map to rest).
  pendingTicks = Math.min(pendingTicks, heldSince > 0 ? 2 + (ticksPerSecond * HOLD_MS) / 1000 : 2);

  // Something notable happened: pause and show it (the chronicle dialog) once its tick is complete.
  // Other entries only go into the chronicle list: mark them seen silently.
  if (state.chronicleDialogs && sim.part === TickPart.Start) {
    const seen = nextShown(sim, state.chronicleSeen);
    if (seen < sim.chronicle.length) {
      syncSnapshot(sim);
      pendingTicks = 0;
      publish({ chronicleSeen: seen, speed: 0, resumeSpeed: speed });
      return;
    }
    if (seen !== state.chronicleSeen) publish({ chronicleSeen: seen });
  }

  // Game over: the last snapshot is still shown in the next frame.
  const more = sim.gameOver ? sim.snapshotVersion !== notifiedSnapshot : ticksPerSecond > 0;
  if (sim.part !== TickPart.Start || more) frame = requestAnimationFrame(runFrame);
}

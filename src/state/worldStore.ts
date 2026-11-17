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
  castAbility,
  continueSave,
  landChanges,
  pullGacha,
  saveBytes,
  serializeWorld,
  startSave,
  type ChronicleEntry,
  type SaveJob,
  type Simulation,
  type World,
} from '../sim';
import type { ExtraArmies } from '../bench/armyDecoys';
import { MapModeId, POLITICAL, createModeData, fillModeData, modeKey, parseModeKey, type MapMode } from '../map/mapModes';
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
export const mapWar = { foe: new Uint8Array(256 * 256), siege: new Uint8Array(0), burning: new Uint8Array(0) };

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
  if (mapWar.burning.length !== sim.world.cellCount) mapWar.burning = new Uint8Array(sim.world.cellCount);
  mapWar.foe.set(w.foe.subarray(0, mapWar.foe.length));
  mapWar.siege.set(w.siege);
  // Burning hexes (Wild Fire) come with the same snapshot: the territory tiles draw them.
  mapWar.burning.set(sim.gacha.burning);
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

/** A new map snapshot is shown: the war data, armies, land changes and the map mode's values come along. */
function syncSnapshot(sim: Simulation) {
  notifiedSnapshot = sim.snapshotVersion;
  syncMapWar(sim);
  syncArmies(sim);
  syncLand(sim);
  // Only outside Political (Requirement Kartenmodi 9); the map sees the new version with the snapshot.
  if (mapMode.id !== MapModeId.Political && fillModeData(sim, mapMode)) mapMode.version++;
}

/**
 * The active map mode (Requirement Kartenmodi) and its per-hex buffer
 * (bucket, number, marks), filled with every snapshot while a mode other
 * than Political is active. UI state, kept here beside the snapshot it is
 * made from; saved in the app trailer.
 */
export const mapMode = createModeData();
const modeListeners = new Set<() => void>();

/** Switches the map mode: the buffer is filled at once, the map redraws its tiles once it rests. */
export function setMapMode(mode: MapMode) {
  if (mode.id === mapMode.id && mode.sub === mapMode.sub) return;
  mapMode.id = mode.id;
  mapMode.sub = mode.sub;
  if (state.sim) fillModeData(state.sim, mapMode);
  mapMode.version++;
  modeListeners.forEach((l) => l());
}

export function getMapMode(): MapMode {
  return { id: mapMode.id, sub: mapMode.sub };
}

/** The map mode as an external store: notifies on a switch (snapshots change `version` silently, see syncSnapshot). */
export const modeStore = {
  subscribe: (listener: () => void): (() => void) => {
    modeListeners.add(listener);
    return () => modeListeners.delete(listener);
  },
  getVersion: (): number => mapMode.version,
  data: mapMode,
};

/** The active mode for React (a new object only on a switch). */
export function useMapMode(): MapMode {
  return useSyncExternalStore(modeStore.subscribe, () => modeSnapshot);
}
let modeSnapshot: MapMode = POLITICAL;
modeListeners.add(() => {
  if (modeSnapshot.id !== mapMode.id || modeSnapshot.sub !== mapMode.sub) modeSnapshot = getMapMode();
});

/**
 * Changes of the land the terrain layer draws (the god's abilities: biome,
 * rivers, lakes, deposits; Requirement Gacha 8): the map checks its terrain
 * tiles when this version changes, which happens with a snapshot (or a
 * cast) after the simulation's change counter `gacha.landTotal` moved.
 */
let landVersion = 0;
let syncedLand = -1;
let landSim: Simulation | null = null;
const landListeners = new Set<() => void>();
function syncLand(sim: Simulation) {
  if (landSim === sim && sim.gacha.landTotal === syncedLand) return;
  const fresh = landSim !== sim;
  landSim = sim;
  syncedLand = sim.gacha.landTotal;
  landVersion++;
  // A new world's map is built from its current land: nothing to redraw.
  if (!fresh) landListeners.forEach((l) => l());
}

/** The land changes as an external store for the map's terrain (see syncLand). */
export const landStore = {
  subscribe: (listener: () => void): (() => void) => {
    landListeners.add(listener);
    return () => landListeners.delete(listener);
  },
  getVersion: (): number => landVersion,
  /** The simulation's change counter as of the last notice, and the hexes changed since `seen` (count, -1: redraw all; see landChanges). */
  total: (): number => syncedLand,
  changes: (seen: number, out: Int32Array): number => (landSim ? landChanges(landSim, seen, out) : -1),
};

function publish(changes: Partial<GameState>) {
  state = { ...state, ...changes, version: state.version + 1 };
  listeners.forEach((l) => l());
}

/** Generates a new world (random seed if none given), settles the tribe and starts the clock. */
export function createNewWorld(seed: number = randomSeed()): World {
  cancelSave();
  const sim = createSimulation(generateWorld({ seed }));
  // A new world starts in the standard map (Requirement Kartenmodi 7).
  setMapMode(POLITICAL);
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

/**
 * "Close all" in the chronicle dialog: every waiting entry counts as seen
 * (they stay in the chronicle list) and the game continues at the chosen
 * speed, as when the last one is closed.
 */
export function closeAllChronicle() {
  const { sim, resumeSpeed } = state;
  if (!sim) return;
  publish({ chronicleSeen: sim.chronicle.length });
  setSpeed(resumeSpeed);
}

/** The current game state outside React (tests). */
export function getGameState(): GameState {
  return state;
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

/**
 * A gacha pull (Requirement Gacha 3): pays the next price and returns the 3
 * abilities drawn (now charges in the inventory), or null without enough Faith.
 */
export function pullCharges(): number[] | null {
  const { sim } = state;
  if (!sim || sim.gameOver) return null;
  const drawn = pullGacha(sim);
  if (drawn) {
    noteOutsideChange();
    publish({});
  }
  return drawn;
}

/**
 * Casts a charge (Requirement Gacha 5): 'now' when it took effect at once
 * (between ticks), 'next' when it waits for the next tick's start (a tick
 * is running in parts), 'invalid' when the target isn't valid (no charge used).
 */
export function castCharge(ability: number, target: number, option = 0): 'now' | 'next' | 'invalid' {
  const { sim } = state;
  if (!sim || sim.gameOver) return 'invalid';
  const between = sim.part === TickPart.Start;
  if (!castAbility(sim, ability, target, option)) return 'invalid';
  noteOutsideChange();
  if (between) {
    // It took effect at once: the map shows it now (also while paused), the fire with the territories and the land in the terrain.
    sim.snapshotVersion++;
    syncSnapshot(sim);
  }
  publish({});
  return between ? 'now' : 'next';
}

/**
 * Benchmark only: called after every complete tick (between ticks, so casts
 * take effect at once), e.g. the gacha scenario's new fires and biome shifts
 * during the swipes (bench/castGacha.ts); null to stop.
 */
export function setBenchTick(hook: ((sim: Simulation) => void) | null) {
  benchTick = hook;
}
let benchTick: ((sim: Simulation) => void) | null = null;

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

  // A save in progress (or wanted, once the running tick is complete) has the frame to itself: the game clock stands still.
  if (saveRequest && betweenTicks) {
    lastFrameTime = now;
    stepSave(sim, now);
    frame = requestAnimationFrame(runFrame);
    return;
  }

  // Cap the step after long pauses (e.g. the app was in the background).
  const seconds = Math.min(0.25, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  if (ticksPerSecond > 0 && !sim.gameOver) runMs += seconds * 1000;

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
  let parts = 0;
  const entries = sim.chronicle.length;
  for (;;) {
    // A new tick only while the speed asks for one and nothing notable happened in this frame (or is waiting to be shown).
    if (sim.part === TickPart.Start) {
      if (pendingTicks < 1 || sim.gameOver || ticksPerSecond === 0 || sim.chronicle.length !== entries || saveRequest) break;
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
    if (done) {
      if (benchTick) {
        const h0 = performance.now();
        benchTick(sim);
        logWork('bench gacha casts', h0, performance.now() - h0);
      }
    }
  }
  recordSimWork(performance.now() - start);
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
  if (sim.part !== TickPart.Start || more || saveRequest) frame = requestAnimationFrame(runFrame);
}

// ---------------------------------------------------------------- saving
// (Requirement Speichern und Laden 3, 6.) The autosave is a sliced save:
// at a tick boundary the store takes the simulation's small data at once
// (startSave) and then encodes its arrays a slice per frame (continueSave);
// in those frames the game clock stands still, so the state stays
// consistent. The policy (when to save, the slot, the dialogs) is in saveGame.ts.

/** JS time a save slice aims at per frame (ms); the slice size follows the measured speed. */
const SAVE_SLICE_MS = 2;
const SAVE_MIN_UNITS = 4096;
const SAVE_MAX_UNITS = 1 << 18;
/** Work units per slice (see continueSave), adapted to SAVE_SLICE_MS. */
let saveUnits = 16384;
/**
 * The longest recent startSave (ms, decaying). It isn't sliced: while it is
 * expected to take longer than a tick part may while the map moves, it waits
 * for the map to rest (at most HOLD_MS), like a long tick part. Unknown at first.
 */
let saveStartMs = MOVING_PART_MS + 1;

/** The sliced save's result: the save game, or null when it was cancelled (a new world, a load) or failed (`error`). */
export type SaveCallback = (bytes: Uint8Array | null, error?: unknown) => void;
let saveRequest: SaveCallback | null = null;
let saveJob: SaveJob | null = null;
/** Changes to the simulation outside its ticks (casts, pulls): a save in progress begins again. */
let outsideChanges = 0;
/** Real time the game clock has run (ms, speed above pause), for the periodic autosave. */
let runMs = 0;

function noteOutsideChange() {
  outsideChanges++;
  // Its copy would mix the state before and after the change.
  saveJob = null;
}

/**
 * Asks for a sliced save of the current world (the autosave): it begins at
 * the next tick boundary (a running tick is completed first, also while
 * paused) and takes about 20 frames, in which the simulation doesn't run.
 * False if a save is already under way.
 */
export function requestSlicedSave(done: SaveCallback): boolean {
  if (saveRequest || !state.sim) return false;
  saveRequest = done;
  startClock();
  return true;
}

/** Whether a sliced save is wanted or under way. */
export function saving(): boolean {
  return saveRequest !== null;
}

/** Drops a sliced save in progress (its callback gets null). */
export function cancelSave() {
  const done = saveRequest;
  saveRequest = null;
  saveJob = null;
  done?.(null);
}

function finishSave(bytes: Uint8Array | null, error?: unknown) {
  const done = saveRequest;
  saveRequest = null;
  saveJob = null;
  done?.(bytes, error);
}

/** One frame of the sliced save: its start, or a slice. */
function stepSave(sim: Simulation, now: number) {
  if (!saveJob) {
    if (holdForMap(now, saveStartMs)) return;
    if (saveStartMs > MOVING_PART_MS) heldSince = 0;
    const t0 = performance.now();
    try {
      saveJob = startSave(sim);
    } catch (e) {
      finishSave(null, e);
      return;
    }
    const ms = performance.now() - t0;
    saveStartMs = Math.max(ms, saveStartMs * 0.9);
    logWork('save start', t0, ms);
    return;
  }
  const t0 = performance.now();
  let done: boolean;
  try {
    done = continueSave(saveJob, saveUnits);
  } catch (e) {
    finishSave(null, e);
    return;
  }
  const ms = performance.now() - t0;
  countEvent('saveSlices');
  logWork('save slice', t0, ms);
  if (!done && ms > 0.05) {
    const factor = Math.min(2, Math.max(0.5, SAVE_SLICE_MS / ms));
    saveUnits = Math.min(SAVE_MAX_UNITS, Math.max(SAVE_MIN_UNITS, Math.round(saveUnits * factor)));
  }
  if (!done) return;
  countEvent('saves');
  finishSave(saveBytes(saveJob));
}

/**
 * Tests: runs the sliced save wanted (requestSlicedSave) to its end without
 * frames, as the clock would between ticks; the map counts as resting.
 */
export function finishSlicedSaveNow() {
  while (advanceSlicedSave());
}

/** Tests: one frame's worth of the sliced save wanted (a running tick is completed first); false once none is under way. */
export function advanceSlicedSave(): boolean {
  const sim = state.sim;
  if (!sim || !saveRequest) return false;
  while (sim.part !== TickPart.Start) stepSimulationPart(sim);
  const moving = mapMoving;
  mapMoving = false;
  stepSave(sim, performance.now());
  mapMoving = moving;
  return saveRequest !== null;
}

/**
 * The current world as a save game, in one call (the app goes to the
 * background, Requirement 3): a running tick is completed first, a sliced
 * save in progress is dropped. Null without a world.
 */
export function saveNow(): Uint8Array | null {
  const sim = state.sim;
  if (!sim) return null;
  cancelSave();
  while (sim.part !== TickPart.Start) stepSimulationPart(sim);
  return serializeWorld(sim);
}

/** What a save of now would hold, to skip saving an unchanged world: the simulation, its tick and the changes outside ticks. */
export function worldStamp(): { sim: Simulation | null; tick: number; outside: number } {
  return { sim: state.sim, tick: state.sim?.tick ?? -1, outside: outsideChanges };
}

/** Real time the game clock has run at a speed above pause (ms). */
export function runningMs(): number {
  return runMs;
}

/** What the app stores alongside the simulation in a save (GameState). */
export type SavedAppState = {
  speed: number;
  resumeSpeed: number;
  chronicleSeen: number;
  /** The map mode (mapModes.modeKey, e.g. "supply.water"); missing in older saves: Political. */
  mapMode?: string;
};

/** The app part of the current game state, for a save. */
export function appState(): SavedAppState {
  return {
    speed: state.speed,
    resumeSpeed: state.resumeSpeed,
    chronicleSeen: state.chronicleSeen,
    mapMode: modeKey(mapMode),
  };
}

/**
 * Shows a loaded simulation (a save game) in place of the current world:
 * the store's caches start over (snapshot, war, armies, land, benchmark
 * hooks), the map builds its tiles and overview anew for the new world, and
 * the game continues at `app.speed` (paused while a chronicle entry waits).
 */
export function loadSimulation(sim: Simulation, app: SavedAppState) {
  cancelSave();
  notifiedSnapshot = -1;
  syncedWar = -1;
  syncedTick = -1;
  landSim = null;
  syncedLand = -1;
  extraArmies = null;
  benchTick = null;
  pendingTicks = 0;
  heldSince = 0;
  lastNotify = 0;
  lastArmyNotify = 0;
  // The mode saved with the world (Political when missing or unknown); filled from the loaded world by the snapshot.
  const mode = parseModeKey(app.mapMode);
  mapMode.id = mode.id;
  mapMode.sub = mode.sub;
  mapMode.version++;
  syncSnapshot(sim);
  const speed = clampSpeed(app.speed);
  const resumeSpeed = clampSpeed(app.resumeSpeed);
  const from = Math.max(0, Math.min(sim.chronicle.length, Math.floor(app.chronicleSeen) || 0));
  const seen = state.chronicleDialogs ? nextShown(sim, from) : sim.chronicle.length;
  const waiting = seen < sim.chronicle.length;
  publish({ sim, speed: waiting ? 0 : speed, resumeSpeed: waiting && speed > 0 ? speed : resumeSpeed, chronicleSeen: seen });
  modeListeners.forEach((l) => l());
  startClock();
  collectOldWorld();
}

const clampSpeed = (speed: number) => (Number.isInteger(speed) && speed >= 0 && speed < SPEEDS.length ? speed : DEFAULT_SPEED);

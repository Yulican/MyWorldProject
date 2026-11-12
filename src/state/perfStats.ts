// Performance counters for the on-screen FPS meter. Plain mutable numbers,
// written from hot paths without triggering React; the meter polls them.

let simMs = 0;
let ticks = 0;
let lastMapBuildMs = 0;

/**
 * Running totals of work that might cost frames, for the benchmark to report
 * what happened during a swipe (see useBenchmark).
 */
export const perfEvents = {
  /** JS milliseconds spent simulating. */
  simMs: 0,
  /** New society snapshots shown on the map. */
  snapshots: 0,
  terrainTiles: 0,
  territoryTiles: 0,
  /** Renders of the map's tile layer (each sends new drawing commands to the UI thread). */
  tileLayerRenders: 0,
  territoryOverviews: 0,
  /** Army marker pictures recorded (an army moved, appeared or is gone). */
  armyPictures: 0,
  /** Text updates of the on-screen performance meter. */
  meterUpdates: 0,
};
export type PerfEvents = typeof perfEvents;

export function countEvent(event: Exclude<keyof PerfEvents, 'simMs'>) {
  perfEvents[event]++;
}

/** Called by the game clock after each frame's simulation work. */
export function recordSimWork(ms: number, tickCount: number) {
  simMs += ms;
  ticks += tickCount;
  perfEvents.simMs += ms;
}

/** Called after the territory map layers were rebuilt. */
export function recordMapBuild(ms: number) {
  lastMapBuildMs = ms;
}

/** Simulation time and ticks since the last call, plus the latest map rebuild time. */
export function takePerfSample(): { simMs: number; ticks: number; mapBuildMs: number } {
  const sample = { simMs, ticks, mapBuildMs: lastMapBuildMs };
  simMs = 0;
  ticks = 0;
  return sample;
}

// ---------------------------------------------------------------------------
// Work log for the benchmark: what ran on the JS thread when, so a swipe's
// worst frame can be attributed (useBenchmark: worstFrameWork). A ring of
// preallocated slots; logging allocates nothing but the label strings the
// callers pass (constants or a few per second).

const LOG_SIZE = 512;
const logStart = new Float64Array(LOG_SIZE);
const logMs = new Float64Array(LOG_SIZE);
const logLabel: string[] = new Array(LOG_SIZE).fill('');
let logNext = 0;
let logCount = 0;
/** Only while the benchmark runs. */
let logging = false;

export function setWorkLogging(on: boolean) {
  logging = on;
  logCount = 0;
}

export function workLogging(): boolean {
  return logging;
}

/** JS work `label` from `start` (performance.now()) for `ms`. */
export function logWork(label: string, start: number, ms: number) {
  if (!logging) return;
  logStart[logNext] = start;
  logMs[logNext] = ms;
  logLabel[logNext] = label;
  logNext = (logNext + 1) % LOG_SIZE;
  if (logCount < LOG_SIZE) logCount++;
}

/** Logged work that overlaps [from, to] (performance.now() times), merged by label: "label ms (n×)", longest first. */
export function workBetween(from: number, to: number): string[] {
  const total = new Map<string, { ms: number; n: number }>();
  for (let k = 0; k < logCount; k++) {
    const i = (logNext - 1 - k + LOG_SIZE) % LOG_SIZE;
    const start = logStart[i];
    const end = start + logMs[i];
    if (end < from || start > to) continue;
    const t = total.get(logLabel[i]) ?? { ms: 0, n: 0 };
    t.ms += logMs[i];
    t.n++;
    total.set(logLabel[i], t);
  }
  return [...total]
    .sort((a, b) => b[1].ms - a[1].ms)
    .map(([label, t]) => `${label} ${t.ms.toFixed(1)}ms${t.n > 1 ? ` (${t.n}×)` : ''}`);
}

/** Hermes garbage collections so far and their time (ms); zeros elsewhere. */
export function gcTotals(): { count: number; ms: number } {
  const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } }).HermesInternal;
  const stats = hermes?.getInstrumentedStats?.();
  return { count: stats?.js_numGCs ?? 0, ms: (stats?.js_gcTime ?? 0) * 1000 };
}

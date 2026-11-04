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

/**
 * Garbage collections of the calling runtime's JS engine so far and their
 * time in ms (Hermes; zeros elsewhere). A worklet, so the benchmark can also
 * read the UI runtime's collector, which runs on the thread that draws the
 * frames and isn't covered by the JS runtime's numbers.
 */
export function gcStats(): { gcCount: number; gcMs: number } {
  'worklet';
  const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } })
    .HermesInternal;
  const stats = hermes?.getInstrumentedStats?.();
  // Hermes reports the GC time in seconds.
  return { gcCount: stats?.js_numGCs ?? 0, gcMs: (stats?.js_gcTime ?? 0) * 1000 };
}

/**
 * What the JS thread did recently, with wall-clock times (Date.now(), the
 * same clock on the UI thread), so the benchmark can line it up with a
 * swipe's slowest UI frame. A fixed ring buffer: recording allocates nothing.
 */
export const TimelineKind = {
  /** Simulation work in one game-clock frame (value: ms). */
  sim: 0,
  /** A new society snapshot handed to the map and React. */
  snapshot: 1,
  /** A slice of tile images rendered (value: tiles). */
  tiles: 2,
  /** A tile set handed to the UI thread (value: 1). */
  handover: 3,
  /** A gap between two game-clock frames over 20 ms: the JS thread was busy or stalled (value: ms). */
  jsGap: 4,
  /** JS time of a slice of tile images, ms. */
  tileMs: 5,
  /** JS time of handing a tile set to the UI thread (building and sending it), ms. */
  handoverMs: 6,
  /** JS time of publishing a new snapshot to the map and React subscribers, including React's render, ms. */
  publishMs: 7,
} as const;
const KIND_NAMES = ['sim', 'snapshot', 'tiles', 'handover', 'jsGap', 'tileMs', 'handoverMs', 'publishMs'] as const;
const TIMELINE_SIZE = 2048;
const timelineAt = new Float64Array(TIMELINE_SIZE);
const timelineKind = new Uint8Array(TIMELINE_SIZE);
const timelineValue = new Float64Array(TIMELINE_SIZE);
let timelineNext = 0;
let timelineCount = 0;

export function markTimeline(kind: (typeof TimelineKind)[keyof typeof TimelineKind], value: number) {
  timelineAt[timelineNext] = Date.now();
  timelineKind[timelineNext] = kind;
  timelineValue[timelineNext] = value;
  timelineNext = (timelineNext + 1) % TIMELINE_SIZE;
  if (timelineCount < TIMELINE_SIZE) timelineCount++;
}

/**
 * Sums of the timeline's values per kind between two Date.now() times
 * (inclusive); `jsGap` is the longest gap instead of a sum.
 */
export function timelineBetween(from: number, to: number): Record<(typeof KIND_NAMES)[number], number> {
  const out = { sim: 0, snapshot: 0, tiles: 0, handover: 0, jsGap: 0, tileMs: 0, handoverMs: 0, publishMs: 0 };
  for (let n = 0; n < timelineCount; n++) {
    const i = (timelineNext - 1 - n + TIMELINE_SIZE) % TIMELINE_SIZE;
    const at = timelineAt[i];
    if (at < from) break;
    if (at > to) continue;
    const name = KIND_NAMES[timelineKind[i]];
    out[name] = name === 'jsGap' ? Math.max(out[name], timelineValue[i]) : out[name] + timelineValue[i];
  }
  return out;
}

/** The largest single value of one kind between two Date.now() times (inclusive). */
export function timelineMax(kind: (typeof TimelineKind)[keyof typeof TimelineKind], from: number, to: number): number {
  let max = 0;
  for (let n = 0; n < timelineCount; n++) {
    const i = (timelineNext - 1 - n + TIMELINE_SIZE) % TIMELINE_SIZE;
    const at = timelineAt[i];
    if (at < from) break;
    if (at <= to && timelineKind[i] === kind && timelineValue[i] > max) max = timelineValue[i];
  }
  return max;
}

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

// Performance counters for the on-screen FPS meter. Plain mutable numbers,
// written from hot paths without triggering React; the meter polls them.

let simMs = 0;
let ticks = 0;
let lastMapBuildMs = 0;

/** Called by the game clock after each frame's simulation work. */
export function recordSimWork(ms: number, tickCount: number) {
  simMs += ms;
  ticks += tickCount;
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

// The mandatory map performance benchmark: what it does and when it passes.
// Plain TypeScript so the rules are testable in Node. The app runs it (see
// useBenchmark) and CI fails when it doesn't pass (scripts/run-benchmark.sh).

export const BENCHMARK = {
  worlds: 5,
  zoom: 2,
  /** Map speed during a swipe, in screen points per second. */
  speed: 1500,
  /** Length of one swipe in screen points (0.5 s at 1500 pt/s). */
  swipeLength: 750,
  swipesPerDirection: 10,
  /** Every single swipe must reach this frame rate... */
  minFps: 60,
  /** ...and no frame in it may take longer than this. */
  maxWorstMs: 25,
} as const;

/** The eight directions, as unit vectors in screen space (y down). */
const D = Math.SQRT1_2;
export const DIRECTIONS = [
  { name: 'N', x: 0, y: -1 },
  { name: 'NE', x: D, y: -D },
  { name: 'E', x: 1, y: 0 },
  { name: 'SE', x: D, y: D },
  { name: 'S', x: 0, y: 1 },
  { name: 'SW', x: -D, y: D },
  { name: 'W', x: -1, y: 0 },
  { name: 'NW', x: -D, y: -D },
] as const;

export type Swipe = { direction: string; dx: number; dy: number; durationMs: number };

/**
 * The swipes for one world. Each direction alternates with its opposite, so
 * the view moves back and forth instead of running into the map's top or
 * bottom edge.
 */
export function swipePlan(): Swipe[] {
  const { swipeLength, speed, swipesPerDirection } = BENCHMARK;
  const durationMs = (swipeLength / speed) * 1000;
  const swipes: Swipe[] = [];
  for (let d = 0; d < 4; d++) {
    const a = DIRECTIONS[d];
    const b = DIRECTIONS[d + 4];
    for (let i = 0; i < swipesPerDirection; i++) {
      for (const dir of [a, b]) {
        swipes.push({ direction: dir.name, dx: dir.x * swipeLength, dy: dir.y * swipeLength, durationMs });
      }
    }
  }
  return swipes;
}

/** Frames measured during one swipe. */
export type SwipeStats = { frames: number; timeMs: number; worstMs: number };

export type SwipeResult = {
  world: number;
  seed: number;
  direction: string;
  fps: number;
  worstMs: number;
  pass: boolean;
  /** What else happened in the app during the swipe (see perfStats.perfEvents), to find what costs frames. */
  events?: Record<string, number>;
};

export function evaluateSwipe(stats: SwipeStats): { fps: number; worstMs: number; pass: boolean } {
  const fps = stats.timeMs > 0 ? (stats.frames * 1000) / stats.timeMs : 0;
  // Rounded like the on-screen meter: a 60 Hz display reports 59.9 fps for a perfect swipe.
  const pass = Math.round(fps) >= BENCHMARK.minFps && stats.worstMs <= BENCHMARK.maxWorstMs;
  return { fps, worstMs: stats.worstMs, pass };
}

export type BenchmarkSummary = {
  pass: boolean;
  swipes: number;
  failed: number;
  minFps: number;
  medianFps: number;
  worstMs: number;
  seeds: number[];
};

export function summarizeBenchmark(results: SwipeResult[]): BenchmarkSummary {
  const fps = results.map((r) => r.fps).sort((a, b) => a - b);
  const failed = results.filter((r) => !r.pass).length;
  return {
    pass: results.length === BENCHMARK.worlds * DIRECTIONS.length * BENCHMARK.swipesPerDirection && failed === 0,
    swipes: results.length,
    failed,
    minFps: fps.length ? fps[0] : 0,
    medianFps: fps.length ? fps[Math.floor(fps.length / 2)] : 0,
    worstMs: results.reduce((m, r) => Math.max(m, r.worstMs), 0),
    seeds: [...new Set(results.map((r) => r.seed))],
  };
}

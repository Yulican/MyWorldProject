import { useCallback, useRef, useState } from 'react';
import type { MapController } from '../map/WorldMap';
import { randomSeed } from '../sim';
import { perfEvents } from '../state/perfStats';
import { advanceYears, createNewWorld, setChronicleDialogs } from '../state/worldStore';
import { fillWithBuildings } from './fillBuildings';
import {
  BENCHMARK,
  SCENARIOS,
  evaluateSwipe,
  summarizeBenchmark,
  swipePlan,
  type BenchmarkSummary,
  type ScenarioName,
  type SwipeResult,
} from './benchmark';

/** Log prefix CI looks for in logcat (scripts/run-benchmark.sh). */
const LOG = 'MYWORLD_BENCH';
/** Time for a new world's map layers to be built and laid out. */
const WORLD_SETTLE_MS = 1500;
const ZOOM_SETTLE_MS = 500;
const PAUSE_MS = 250;

export type BenchmarkStatus =
  | { running: true; scenario: ScenarioName; world: number; swipe: number; failed: number }
  | { running: false; summary: BenchmarkSummary };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the map benchmark (see benchmark.ts) on the live map: for each of five
 * random worlds (simulated first for the scenario's years), zoom in, run one
 * unmeasured warm-up swipe, then the 80 measured swipes. Every swipe and the
 * summary go to the log.
 */
export function useBenchmark(controller: { current: MapController | null }) {
  const [status, setStatus] = useState<BenchmarkStatus | null>(null);
  const running = useRef(false);

  const run = useCallback(async (scenario: ScenarioName = 'young') => {
    if (running.current) return;
    running.current = true;
    // Chronicle dialogs would pause the game; the benchmark keeps it running.
    setChronicleDialogs(false);
    const plan = swipePlan();
    const results: SwipeResult[] = [];
    console.log(`${LOG}_START ${JSON.stringify({ ...BENCHMARK, scenario })}`);
    for (let world = 0; world < BENCHMARK.worlds; world++) {
      const seed = randomSeed();
      createNewWorld(seed);
      advanceYears(SCENARIOS[scenario].years, SCENARIOS[scenario].buildings ? fillWithBuildings : undefined);
      setStatus({ running: true, scenario, world, swipe: 0, failed: results.filter((r) => !r.pass).length });
      await delay(WORLD_SETTLE_MS);
      const map = controller.current;
      if (!map) throw new Error('Benchmark: the map is not ready.');
      map.zoomToCenter(BENCHMARK.zoom);
      await delay(ZOOM_SETTLE_MS);
      await map.swipe(plan[0]);
      for (let i = 0; i < plan.length; i++) {
        await delay(PAUSE_MS);
        const before = { ...perfEvents, ...gcStats() };
        const stats = await map.swipe(plan[i]);
        const events: Record<string, number> = {};
        for (const [k, v] of Object.entries({ ...perfEvents, ...gcStats() })) {
          events[k] = Math.round((v - before[k as keyof typeof before]) * 10) / 10;
        }
        const result = { world, seed, direction: plan[i].direction, ...evaluateSwipe(stats), events };
        results.push(result);
        console.log(`${LOG}_SWIPE ${JSON.stringify(result)}`);
        setStatus({ running: true, scenario, world, swipe: i + 1, failed: results.filter((r) => !r.pass).length });
      }
    }
    const summary = { ...summarizeBenchmark(results), scenario };
    console.log(`${LOG}_DONE ${JSON.stringify(summary)}`);
    setStatus({ running: false, summary });
    setChronicleDialogs(true);
    running.current = false;
  }, [controller]);

  return { status, run };
}

/**
 * Garbage collections of the JS engine so far and their time in ms (Hermes;
 * zeros elsewhere). The collector also runs on other threads, so it can cost
 * frames without any app work.
 */
function gcStats(): { gcCount: number; gcMs: number } {
  const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } })
    .HermesInternal;
  const stats = hermes?.getInstrumentedStats?.();
  // Hermes reports the GC time in seconds.
  return { gcCount: stats?.js_numGCs ?? 0, gcMs: (stats?.js_gcTime ?? 0) * 1000 };
}

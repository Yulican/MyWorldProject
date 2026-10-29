import { Simulation, TICKS_PER_YEAR } from '../src/sim';

const WARMUP = TICKS_PER_YEAR; // 1 Jahr Einlaufen (JIT)
const MEASURE = TICKS_PER_YEAR * 10; // 10 Jahre messen

function pct(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function run(agentCount: number) {
  const sim = new Simulation({ seed: 42, agentCount, personalityCount: 300 });
  const start = sim.alive;
  for (let i = 0; i < WARMUP; i++) sim.step();
  const times: number[] = [];
  for (let i = 0; i < MEASURE; i++) {
    const t0 = performance.now();
    sim.step();
    times.push(performance.now() - t0);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    agents: agentCount,
    start,
    end: sim.alive,
    avg,
    p50: pct(sorted, 0.5),
    p95: pct(sorted, 0.95),
    max: sorted[sorted.length - 1],
    mb: sim.memoryBytes / 1024 / 1024,
    prayersPerTick: sim.influence / (WARMUP + MEASURE),
  };
}

const sizes = [10_000, 20_000, 50_000];
console.log(`Runtime: ${typeof (globalThis as any).HermesInternal !== 'undefined' ? 'Hermes' : 'V8/Node ' + process.version}`);
console.log('| Agenten | Ende | Ø ms/Tick | p50 | p95 | max (Jahrestick) | Ticks/s max | Speicher MB |');
console.log('|---|---|---|---|---|---|---|---|');
for (const n of sizes) {
  const r = run(n);
  console.log(
    `| ${r.agents} | ${r.end} | ${r.avg.toFixed(2)} | ${r.p50.toFixed(2)} | ${r.p95.toFixed(2)} | ${r.max.toFixed(2)} | ${(1000 / r.avg).toFixed(0)} | ${r.mb.toFixed(1)} |`,
  );
}

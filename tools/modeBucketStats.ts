// Distributions behind the map-mode color buckets (Requirement Kartenmodi, round 1).
// Usage: npx tsx tools/modeBucketStats.ts [worlds=12] [years=20,300]
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation } from '../src/sim';
import { RESOURCE_COUNT, Resource, isWaterBiome } from '../src/sim/world/biomes';
import { SUPPLY_KINDS } from '../src/sim/society/supply';

const worlds = Number(process.argv[2] ?? 12);
const years = (process.argv[3] ?? '20,300').split(',').map(Number);
const acc = new Map<string, Map<number, number[]>>();
const add = (mode: string, y: number, v: number) => {
  if (!acc.has(mode)) acc.set(mode, new Map());
  const m = acc.get(mode)!;
  if (!m.has(y)) m.set(y, []);
  m.get(y)!.push(v);
};
for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  for (const y of years) {
    while (sim.tick < y * TICKS_PER_YEAR && !sim.gameOver) stepSimulation(sim);
    const w = sim.world;
    for (let c = 0; c < w.cellCount; c++) {
      const land = !isWaterBiome(w.biome[c]);
      if (land) {
        add('soil.fertility(0-1)', y, w.resources[c * RESOURCE_COUNT + Resource.Fertility]);
        add('soil.wood(0-1)', y, w.resources[c * RESOURCE_COUNT + Resource.Wood]);
        add('soil.stone(0-1)', y, w.resources[c * RESOURCE_COUNT + Resource.Stone]);
        add('soil.baseFood(people)', y, sim.baseSupply[c * SUPPLY_KINDS]);
        add('soil.baseWater(people)', y, sim.baseSupply[c * SUPPLY_KINDS + 1]);
      }
      const p = sim.cellPop[c];
      if (p <= 0) continue;
      add('pop', y, p);
      add('satisfaction', y, sim.satisfaction[c]);
      add('load.min%', y, (100 * p) / Math.max(1e-6, sim.cellCapacity[c]));
      for (const [k, n] of [[0, 'food'], [1, 'water'], [2, 'space']] as const) add(`load.${n}%`, y, (100 * p) / Math.max(1e-6, sim.cellSupply[c * SUPPLY_KINDS + k]));
    }
  }
}
for (const [mode, m] of acc) for (const [y, v] of m) {
  v.sort((a, b) => a - b);
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  const f = (x: number) => x.toFixed(Math.abs(x) < 2 ? 2 : 1);
  console.log(`${mode.padEnd(24)} y${String(y).padEnd(4)} n=${String(v.length).padEnd(6)} min ${f(v[0])} p5 ${f(q(.05))} p25 ${f(q(.25))} p50 ${f(q(.5))} p75 ${f(q(.75))} p95 ${f(q(.95))} max ${f(v[v.length - 1])}`);
}

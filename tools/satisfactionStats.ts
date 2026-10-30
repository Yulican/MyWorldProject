// Key figures of the satisfaction feature over many worlds, to calibrate its
// numbers (see "Design Documents/Requirement Zufriedenheit.md", Abnahme).
// Usage: npx tsx tools/satisfactionStats.ts [worlds=12] [years=100,200,300]
import { performance } from 'node:perf_hooks';
import { BUILDINGS, Good, SLOTS, TICKS_PER_YEAR, createSimulation, generateWorld, isLuxury, stepSimulation } from '../src/sim';
import { SlotState } from '../src/sim/society/buildings';

const worlds = Number(process.argv[2] ?? 12);
const checkpoints = (process.argv[3] ?? '100,200,300').split(',').map(Number);

type Row = Record<string, number>;
const rows = new Map<number, Row[]>();

for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  let ms = 0;
  let years = 0;
  for (const year of checkpoints) {
    const t0 = performance.now();
    while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) stepSimulation(sim);
    ms += performance.now() - t0;
    years = year;
    const moods: number[] = [];
    let seats = 0;
    let comfort = 0;
    let luxury = 0;
    let buildings = 0;
    for (let c = 0; c < sim.world.cellCount; c++) {
      if (sim.cellPop[c] > 0) moods.push(sim.satisfaction[c]);
      for (let s = c * SLOTS; s < (c + 1) * SLOTS; s++) {
        if (sim.economy.state[s] !== SlotState.Standing) continue;
        const good = BUILDINGS[sim.economy.type[s]].good;
        buildings++;
        if (good === Good.Seat) seats++;
        else if (good === Good.Comfort) comfort++;
        else if (isLuxury(good)) luxury++;
      }
    }
    moods.sort((a, b) => a - b);
    const q = (p: number) => (moods.length ? moods[Math.min(moods.length - 1, Math.floor(p * moods.length))] : 0);
    const revolts = sim.chronicle.filter((e) => e.text.includes('rose up'));
    const leagueSizes = revolts.map((e) => (e.text.startsWith('A settlement') ? 1 : Number(e.text.split(' ')[0])));
    const row: Row = {
      people: sim.pop.count,
      settlements: moods.length,
      peoples: sim.civs.filter(Boolean).length,
      revolutions: revolts.length,
      leagueMean: leagueSizes.length ? leagueSizes.reduce((a, b) => a + b, 0) / leagueSizes.length : 0,
      cutOff: sim.chronicle.filter((e) => e.text.includes('cut off from')).length,
      migrations: sim.migrations.groups,
      abroad: sim.migrations.abroad,
      p10: q(0.1),
      median: q(0.5),
      p90: q(0.9),
      belowZero: moods.length ? moods.filter((m) => m < 0).length / moods.length : 0,
      buildings,
      seats,
      comfort,
      luxury,
      msPerYear: ms / years,
    };
    if (!rows.has(year)) rows.set(year, []);
    rows.get(year)!.push(row);
  }
}

for (const [year, list] of rows) {
  const keys = Object.keys(list[0]);
  const mean = (k: string) => list.reduce((s, r) => s + r[k], 0) / list.length;
  const range = (k: string) => `${Math.min(...list.map((r) => r[k])).toFixed(1)}..${Math.max(...list.map((r) => r[k])).toFixed(1)}`;
  console.log(`\nYear ${year} (${list.length} worlds): mean [min..max]`);
  for (const k of keys) console.log(`  ${k.padEnd(12)} ${mean(k).toFixed(k === 'belowZero' ? 2 : 1).padStart(8)}  [${range(k)}]`);
}

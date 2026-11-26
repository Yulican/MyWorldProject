// Wood supply and demand over many worlds (analysis of the planBuilding fix and compensation variants).
// Usage: npx tsx tools/woodStats.ts [worlds=12] [years=300,500] [key=value ...]
//   woodBiomes=Plains,Savanna,Hills  more biomes whose hexes harvest wood (adds the lumber camp/sawmill there too!)
//   forage=Plains,Savanna  like woodBiomes, but lumber camp and sawmill stay on Forest/Jungle (own copy of their list)
//   woodRes=Plains:0.4,Savanna:0.4   wood capacity per biome in BIOMES (only effective in woodBiomes or Forest/Jungle)
//   campAmount=8       lumber camp yield (default 5)
//   woodCost=0.7       factor on the wood cost of all buildings
//   upkeepWood=0.7     factor on the wood upkeep of all buildings
// Pre-fix baseline: run the same tool in a worktree of the commit before 77ac941.
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation } from '../src/sim';
import { Biome, BIOMES, BIOME_COUNT, Resource } from '../src/sim/world/biomes';
import { BUILDINGS, SlotState, WOOD_BIOMES, forageYield, withBuildings } from '../src/sim/society/buildings';
import { setBiomeObserver } from '../src/sim/society/biomes';
import { Good } from '../src/sim/society/buildings';

const worlds = Number(process.argv[2] ?? 12);
const checkpoints = (process.argv[3] ?? '300,500').split(',').map(Number);
const o = Object.fromEntries(process.argv.slice(4).map((a) => a.split('=') as [string, string]));
const bid = (n: string) => (Biome as Record<string, number>)[n];
const campBiomes = [...WOOD_BIOMES];
if (o.forage) {
  for (const b of BUILDINGS as unknown as { good: number; biomes?: readonly number[] }[]) if (b.good === Good.Wood && b.biomes) b.biomes = campBiomes;
  for (const n of o.forage.split(',')) (WOOD_BIOMES as number[]).push((Biome as Record<string, number>)[n]);
}
if (o.woodBiomes) for (const n of o.woodBiomes.split(',')) (WOOD_BIOMES as number[]).push(bid(n));
if (o.woodRes) for (const p of o.woodRes.split(',')) { const [n, v] = p.split(':'); (BIOMES[bid(n)].resources as unknown as number[])[Resource.Wood] = Number(v); }
for (const b of BUILDINGS as unknown as { name: string; amount: number; wood: number; upkeepWood: number }[]) {
  if (o.campAmount && b.name === 'Lumber camp') b.amount = Number(o.campAmount);
  if (o.woodCost) b.wood *= Number(o.woodCost);
  if (o.upkeepWood) b.upkeepWood *= Number(o.upkeepWood);
}
let bChanges = 0, bRev = 0;
const lastFrom = new Map<number, number>();
setBiomeObserver((sim, c, from, to) => {
  bChanges++;
  const l = lastFrom.get(c);
  if (l !== undefined && (l >> 16) === to && sim.tick - (l & 0xffff) * 52 < 50 * TICKS_PER_YEAR) bRev++;
  lastFrom.set(c, (from << 16) | Math.min(0xffff, Math.floor(sim.tick / 52)));
});
const names = Object.keys(Biome);
const rows = new Map<number, Record<string, number>[]>();
for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  bChanges = 0; bRev = 0; lastFrom.clear();
  for (const year of checkpoints) {
    while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) stepSimulation(sim);
    const eco = sim.economy;
    const byBiome = new Array(BIOME_COUNT).fill(0);
    let n = 0, woodSet = 0, harvest = 0, upkeep = 0, stock = 0, low = 0, saving = 0, camps = 0, saws = 0, noCamp = 0, pop = 0, merch = 0, nonWoodHarv = 0;
    const demandByType = new Map<string, number>();
    for (let c = 0; c < sim.world.cellCount; c++) {
      if (sim.cellPop[c] <= 0) continue;
      n++; pop += sim.cellPop[c];
      const b = sim.world.biome[c];
      byBiome[b]++;
      const inWood = WOOD_BIOMES.includes(b);
      if (inWood) woodSet++;
      const h = withBuildings(eco, c, Good.Wood, forageYield(sim.world, c, Good.Wood));
      harvest += h; if (!inWood) nonWoodHarv += h;
      let up = 0, hasCamp = false;
      for (let s = c * eco.slots; s < c * eco.slots + eco.half; s++) {
        if (eco.state[s] !== SlotState.Standing) continue;
        const t = BUILDINGS[eco.type[s]];
        up += t.upkeepWood;
        if (t.upkeepWood) demandByType.set(t.name, (demandByType.get(t.name) ?? 0) + t.upkeepWood);
        if (t.name === 'Lumber camp') { camps++; hasCamp = true; }
        if (t.name === 'Sawmill') saws++;
      }
      if (inWood && !hasCamp) noCamp++;
      upkeep += up;
      const st = eco.stock[c * 2];
      stock += st;
      if (st < 5) low++;
      if (eco.goal[c * 2] > st) saving++;
      merch += sim.trade.merchants[c];
    }
    const text = (s: string) => sim.chronicle.filter((e) => e.text.includes(s)).length;
    const row: Record<string, number> = {
      people: sim.pop.count, settlements: n, 'wood stock/settl': stock / n, 'harvest/settl': harvest / n, 'upkeep/settl': upkeep / n,
      'in Forest/Jungle %': (100 * woodSet) / n, 'harvest outside wood biome/settl': nonWoodHarv / n, 'wood stock<5 %': (100 * low) / n,
      'saving for material %': (100 * saving) / n, camps, sawmills: saws, 'wood hex w/o camp %': (100 * noCamp) / Math.max(1, woodSet),
      woodTraded: sim.trade.delivered[0], allTraded: sim.trade.delivered.reduce((s, v) => s + v, 0), merchants: merch, uprisings: text('rose up'),
      buildings: 0, 'biome changes/yr': bChanges / year, 'reversals <50y %': (100 * bRev) / Math.max(1, bChanges),
    };
    for (let b = 0; b < BIOME_COUNT; b++) if (byBiome[b]) row['biome ' + names[b] + ' %'] = (100 * byBiome[b]) / n;
    for (const [k, v] of demandByType) row['upkeepWood ' + k] = v / n;
    if (!rows.has(year)) rows.set(year, []);
    rows.get(year)!.push(row);
  }
}
console.log(`${worlds} worlds`, process.argv.slice(4).join(' '));
for (const [year, list] of rows) {
  console.log(`Year ${year}`);
  const keys = new Set<string>(); for (const r of list) for (const k of Object.keys(r)) keys.add(k);
  for (const k of keys) if (k !== 'buildings') console.log(`  ${k.padEnd(34)} ${(list.reduce((s, r) => s + (r[k] ?? 0), 0) / list.length).toFixed(1)}`);
}

// Wood and stone by settlement group: Forest/Jungle (wood biome), Hills/Mountains (stone biome), others.
// Usage: npx tsx tools/woodGroups.ts [worlds=12] [years=500] [key=value ...]
//   forestRes=1.5     wood capacity of Forest and Jungle in BIOMES (default 0.9/1.0; forage = 2 + 5 x capacity)
//   hillRes=0.9       stone capacity of Hills and Mountains (default 0.6/0.9)
//   price0=1 price1=1.5   trade price of wood/stone (steers which trips are worth it)
//   woodCost=1 upkeepWood=1 stoneCost=1 upkeepStone=1  factors on all buildings
// Samples every 10 years from year 100 and averages per settlement; the last row block is the end state.
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation } from '../src/sim';
import { Biome, BIOMES, Resource } from '../src/sim/world/biomes';
import { BUILDINGS, Good, SlotState, STONE_BIOMES, WOOD_BIOMES } from '../src/sim/society/buildings';
import { PRICE } from '../src/sim/society/trade';

const worlds = Number(process.argv[2] ?? 12);
const years = Number(process.argv[3] ?? 500);
const o = Object.fromEntries(process.argv.slice(4).map((a) => a.split('=') as [string, string]));
if (o.forestRes) for (const b of [Biome.Forest, Biome.Jungle]) (BIOMES[b].resources as number[])[Resource.Wood] = Number(o.forestRes);
if (o.hillRes) for (const b of [Biome.Hills, Biome.Mountains]) (BIOMES[b].resources as number[])[Resource.Stone] = Number(o.hillRes);
if (o.price0) PRICE[0] = Number(o.price0);
if (o.price1) PRICE[1] = Number(o.price1);
for (const b of BUILDINGS as { wood: number; stone: number; upkeepWood: number; upkeepStone: number }[]) {
  if (o.woodCost) b.wood *= Number(o.woodCost);
  if (o.stoneCost) b.stone *= Number(o.stoneCost);
  if (o.upkeepWood) b.upkeepWood *= Number(o.upkeepWood);
  if (o.upkeepStone) b.upkeepStone *= Number(o.upkeepStone);
}
const G = ['wood biome', 'stone biome', 'other'];
const acc = G.map(() => ({ n: 0, pop: 0, crowd: 0, wStock: 0, sStock: 0, wLow: 0, sLow: 0, wSave: 0, sSave: 0, bld: 0, big: 0, camp: 0, quarry: 0, wSur: 0, wWant: 0, sSur: 0, sWant: 0, wHarv: 0 }));
const tot = { people: 0, settlements: 0, traded: 0, woodTraded: 0, stoneTraded: 0, merchants: 0, uprisings: 0, campsOff: 0, quarriesOff: 0 };
let samples = 0;
for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  const eco = sim.economy;
  const TG = sim.trade.want.length / sim.world.cellCount;
  for (let y = 100; y <= years; y += 10) {
    while (sim.tick < y * TICKS_PER_YEAR && !sim.gameOver) stepSimulation(sim);
    samples++;
    for (let c = 0; c < sim.world.cellCount; c++) {
      if (sim.cellPop[c] <= 0) continue;
      const b = sim.world.biome[c];
      const a = acc[WOOD_BIOMES.includes(b) ? 0 : STONE_BIOMES.includes(b) ? 1 : 2];
      a.n++; a.pop += sim.cellPop[c]; a.crowd += sim.cellPop[c] / Math.max(1, sim.cellCapacity[c]);
      a.wStock += eco.stock[c * 2]; a.sStock += eco.stock[c * 2 + 1];
      if (eco.stock[c * 2] < 5) a.wLow++;
      if (eco.stock[c * 2 + 1] < 5) a.sLow++;
      if (eco.goal[c * 2] > eco.stock[c * 2]) a.wSave++;
      if (eco.goal[c * 2 + 1] > eco.stock[c * 2 + 1]) a.sSave++;
      a.big += sim.world.cityTier[c];
      let camp = 0, quarry = 0, bld = 0;
      for (let s = c * eco.slots; s < c * eco.slots + eco.half; s++) {
        if (eco.state[s] !== SlotState.Standing) continue;
        bld++;
        const t = BUILDINGS[eco.type[s]];
        if (t.name === 'Lumber camp') camp++;
        if (t.name === 'Quarry') quarry++;
      }
      a.bld += bld; a.camp += camp ? 1 : 0; a.quarry += quarry ? 1 : 0;
      a.wSur += sim.trade.surplus[c * TG]; a.wWant += sim.trade.want[c * TG];
      a.sSur += sim.trade.surplus[c * TG + 1]; a.sWant += sim.trade.want[c * TG + 1];
      tot.merchants += sim.trade.merchants[c] / 1;
      if (y === years) {
        if (camp && !WOOD_BIOMES.includes(b)) tot.campsOff++;
        if (quarry && !STONE_BIOMES.includes(b)) tot.quarriesOff++;
      }
    }
  }
  tot.people += sim.pop.count; tot.settlements += sim.civs.length ? acc.reduce((s, _) => s, 0) : 0;
  tot.traded += sim.trade.delivered.reduce((s, v) => s + v, 0);
  tot.woodTraded += sim.trade.delivered[0]; tot.stoneTraded += sim.trade.delivered[1];
  tot.uprisings += sim.chronicle.filter((e) => e.text.includes('rose up')).length;
}
const f = (v: number, d = 1) => v.toFixed(d);
console.log(`${worlds} worlds x ${years} y`, process.argv.slice(4).join(' '));
const allN = acc.reduce((s, a) => s + a.n, 0);
console.log(`settlements/world (mean of samples) ${f(allN / samples)}  people(end) ${f(tot.people / worlds, 0)}  traded ${f(tot.traded / worlds, 0)} (wood ${f(tot.woodTraded / worlds, 0)}, stone ${f(tot.stoneTraded / worlds, 0)})  merchants ${f(tot.merchants / samples)}  uprisings ${f(tot.uprisings / worlds)}  campsOff ${tot.campsOff} quarriesOff ${tot.quarriesOff}`);
console.log('group'.padEnd(12) + ['share%', 'pop', 'pop/cap', 'woodSt', 'stoneSt', 'wood<5%', 'stone<5%', 'wSave%', 'sSave%', 'bld', 'tier', 'camp%', 'quarry%', 'wSpare', 'wWant', 'sSpare', 'sWant'].map((s) => s.padStart(8)).join(''));
G.forEach((g, i) => {
  const a = acc[i], n = Math.max(1, a.n);
  console.log(g.padEnd(12) + [100 * a.n / allN, a.pop / n, a.crowd / n, a.wStock / n, a.sStock / n, 100 * a.wLow / n, 100 * a.sLow / n, 100 * a.wSave / n, 100 * a.sSave / n, a.bld / n, a.big / n, 100 * a.camp / n, 100 * a.quarry / n, a.wSur / n, a.wWant / n, a.sSur / n, a.sWant / n].map((v) => f(v, 1).padStart(8)).join(''));
});

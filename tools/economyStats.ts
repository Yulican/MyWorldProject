// Settlement growth, trade and diplomacy over many worlds, for one variant of
// the material rules (see "Design Documents/Requirement Regionale Rohstoffe.md").
// Usage: npx tsx tools/economyStats.ts [key=value ...]
//   worlds=12 years=300,500
//   regional=1  wood only from woods, stone only from hills and mountains
//   base=2      wood and stone every hex forages outside them
//   cost=1.5    factor on wood and stone cost and upkeep of the buildings in `scope`
//   scope=advanced  all = every building; advanced = all but the basic ones a new settlement needs
//   otherHub=0  another settlement with the goods takes over a delivery the hub couldn't make
//   period=1    years over which trade agreement deliveries are judged
import { performance } from 'node:perf_hooks';
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation } from '../src/sim';
import * as buildings from '../src/sim/society/buildings';
import { BUILDINGS, SLOTS, SlotState } from '../src/sim/society/buildings';
import * as diplomacy from '../src/sim/society/diplomacy';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const worlds = Number(args.worlds ?? 12);
const checkpoints = (args.years ?? '300,500').split(',').map(Number);
const regional = (args.regional ?? '1') === '1';
const base = Number(args.base ?? 2);
const cost = Number(args.cost ?? 1.5);
const scope = args.scope ?? 'advanced';
const otherHub = args.otherHub === '1';
const period = Number(args.period ?? 1);
const BASIC = ['Hut', 'Fields', 'Well', 'Lumber camp', 'Quarry', 'Trade center', 'Harbor', 'Granary', 'Water carriers', 'Meeting place'];

// The tuning objects exist only during the simulation phase (older code has none).
const tuning = (buildings as unknown as { MATERIAL_TUNING?: { regional: boolean; base: number } }).MATERIAL_TUNING;
if (tuning) {
  tuning.regional = regional;
  tuning.base = base;
}
const agreements = (diplomacy as unknown as { AGREEMENT_TUNING?: { otherHub: boolean; periodYears: number } }).AGREEMENT_TUNING;
if (agreements) {
  agreements.otherHub = otherHub;
  agreements.periodYears = period;
}
for (const b of BUILDINGS as unknown as { name: string; wood: number; stone: number; upkeepWood: number; upkeepStone: number }[]) {
  if (scope === 'advanced' && BASIC.includes(b.name)) continue;
  b.wood *= cost;
  b.stone *= cost;
  b.upkeepWood *= cost;
  b.upkeepStone *= cost;
}

type Row = Record<string, number>;
const rows = new Map<number, Row[]>();

for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  let ms = 0;
  for (const year of checkpoints) {
    const t0 = performance.now();
    while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) stepSimulation(sim);
    ms += performance.now() - t0;
    let settlements = 0;
    let towns = 0;
    let cities = 0;
    let standing = 0;
    let ruins = 0;
    for (let c = 0; c < sim.world.cellCount; c++) {
      const pop = sim.cellPop[c];
      if (pop > 0) settlements++;
      if (pop >= 50) towns++;
      if (pop >= 150) cities++;
      for (let s = c * SLOTS; s < (c + 1) * SLOTS; s++) {
        if (sim.economy.state[s] === SlotState.Standing) standing++;
        if (sim.economy.state[s] === SlotState.Ruin) ruins++;
      }
    }
    const text = (s: string) => sim.chronicle.filter((e) => e.text.includes(s)).length;
    let abroad = 0;
    for (const v of sim.trade.abroad) abroad += v;
    let money = 0;
    for (const v of sim.economy.money) money += v;
    const row: Row = {
      people: sim.pop.count,
      peoples: sim.civs.filter(Boolean).length,
      settlements,
      'towns (50+)': towns,
      'cities (150+)': cities,
      buildings: standing,
      ruins,
      woodTraded: sim.trade.delivered[0],
      stoneTraded: sim.trade.delivered[1],
      allTraded: sim.trade.delivered.reduce((s, v) => s + v, 0),
      deliveredAbroad: abroad,
      money,
      known: sim.chronicle.filter((e) => e.text.endsWith(' met.')).length,
      openBorders: text('opened their borders'),
      agreementsOneSided: text('agreed to deliver'),
      agreementsTwoSided: text('agreed to trade'),
      broken: text('broke: too little'),
      endedTooLittle: text('too little could be delivered'),
      running: sim.diplomacy.agreements.length,
      ranOut: text('ran out.'),
      uprisings: text('rose up'),
      msPerYear: ms / year,
    };
    if (!rows.has(year)) rows.set(year, []);
    rows.get(year)!.push(row);
  }
}

console.log(process.argv.slice(2).join(' ') || 'defaults', `(${worlds} worlds)`);
for (const [year, list] of rows) {
  const keys = Object.keys(list[0]);
  const mean = (k: string) => list.reduce((s, r) => s + r[k], 0) / list.length;
  const range = (k: string) => `${Math.min(...list.map((r) => r[k])).toFixed(0)}..${Math.max(...list.map((r) => r[k])).toFixed(0)}`;
  console.log(`\nYear ${year}: mean [min..max]`);
  for (const k of keys) console.log(`  ${k.padEnd(20)} ${mean(k).toFixed(1).padStart(9)}  [${range(k)}]`);
}

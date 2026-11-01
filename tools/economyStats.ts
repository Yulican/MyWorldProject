// Settlement growth, trade and diplomacy over many worlds, to calibrate the
// economy (see "Design Documents/Requirement Regionale Rohstoffe.md").
// Usage: npx tsx tools/economyStats.ts [worlds=12] [years=300,500] [transit=1] [counterVia=1] [open=0]
//   open=1: from year 300 every people knows, trusts and trades freely with every other (the diplomacy benchmark scenario)
import { performance } from 'node:perf_hooks';
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation } from '../src/sim';
import { openDiplomacy } from '../src/bench/openDiplomacy';
import { SLOTS, SlotState } from '../src/sim/society/buildings';
import * as diplomacy from '../src/sim/society/diplomacy';

const worlds = Number(process.argv[2] ?? 12);
const checkpoints = (process.argv[3] ?? '300,500').split(',').map(Number);
const options = Object.fromEntries(process.argv.slice(4).map((a) => a.split('=') as [string, string]));
// Simulation phase of the transit trade (older code has no switches).
const tuning = (diplomacy as unknown as { TRANSIT_TUNING?: { on: boolean; counterVia: boolean } }).TRANSIT_TUNING;
if (tuning) {
  tuning.on = (options.transit ?? '1') === '1';
  tuning.counterVia = (options.counterVia ?? '1') === '1';
}
const open = options.open === '1';

type Row = Record<string, number>;
const rows = new Map<number, Row[]>();

for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  let ms = 0;
  for (const year of checkpoints) {
    const t0 = performance.now();
    while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) {
      stepSimulation(sim);
      if (open && sim.tick === 300 * TICKS_PER_YEAR) openDiplomacy(sim);
    }
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
      transit: (sim.trade as { transit?: number }).transit ?? 0,
      freeTrade: countFreeTrade(sim),
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

console.log(`${worlds} worlds`, process.argv.slice(4).join(' '));
for (const [year, list] of rows) {
  const keys = Object.keys(list[0]);
  const mean = (k: string) => list.reduce((s, r) => s + r[k], 0) / list.length;
  const range = (k: string) => `${Math.min(...list.map((r) => r[k])).toFixed(0)}..${Math.max(...list.map((r) => r[k])).toFixed(0)}`;
  console.log(`\nYear ${year}: mean [min..max]`);
  for (const k of keys) console.log(`  ${k.padEnd(20)} ${mean(k).toFixed(1).padStart(9)}  [${range(k)}]`);
}

function countFreeTrade(sim: ReturnType<typeof createSimulation>): number {
  let n = 0;
  for (let a = 1; a < sim.civs.length; a++) for (let b = a + 1; b < sim.civs.length; b++) n += sim.diplomacy.freeTrade[a * diplomacy.PAIRS + b];
  return n;
}

// War phases 0 and 1 (soldiers without combat; "Design Documents/Requirement
// Krieg.md", section 10) over many worlds: growth, soldiers, pay, strategic
// goods, trade, satisfaction, diplomacy (danger from strength) and sim time.
// Usage: npx tsx tools/warStats.ts [worlds=12] [years=300,500] [variant ...]
//   A variant is "name:key=value,key=value" with the keys of MIL (src/sim/society/military.ts), e.g.
//   npx tsx tools/warStats.ts 12 300,500 "off:enabled=0" "cap20:capacity=20,sold=0.1" "cap30:capacity=30,sold=0.1,saleDanger=50"
//   depositMul=2: iron and flint deposits 2x as frequent at world generation.
//   enabled=0: phase 0 only (mines, gold as money), no soldiers and danger from population.
//   Without variants one run with the defaults. Also accepts GOV_TUNING keys (incomeShare, ...).
// The same file runs on the code before the war work (no military.ts): then it prints only the shared figures.
import { performance } from 'node:perf_hooks';
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation, type Simulation } from '../src/sim';
import { BUILDINGS, SLOTS, SlotState } from '../src/sim/society/buildings';
import { GOV_TUNING } from '../src/sim/society/taxes';
import { DEPOSITS, Deposit } from '../src/sim/world/deposits';
import { PAIRS } from '../src/sim/society/diplomacy';
import { TRADE_GOOD_NAMES } from '../src/sim/society/trade';

type Mil = Record<string, number>;
let MIL: Mil | null = null;
let TROOP_TYPES = 3;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require('../src/sim/society/military') as typeof import('../src/sim/society/military');
  MIL = m.MIL as unknown as Mil;
  TROOP_TYPES = m.TROOP_TYPES;
} catch {
  MIL = null;
}
const defaults = MIL ? { ...MIL } : {};
const govDefaults = { ...GOV_TUNING };
const depositDefaults = { iron: DEPOSITS[Deposit.Iron].frequency, flint: DEPOSITS[Deposit.Flint].frequency };

const worlds = Number(process.argv[2] ?? 12);
const checkpoints = (process.argv[3] ?? '300,500').split(',').map(Number);
const variants = process.argv.slice(4).length ? process.argv.slice(4) : ['default:'];

type Row = Record<string, number>;
const goodIndex = (name: string) => TRADE_GOOD_NAMES.indexOf(name as never);

function soldiersAtCell(mil: Record<string, any>, c: number): number {
  return mil.soldiers[c * 3] + mil.soldiers[c * 3 + 1] + mil.soldiers[c * 3 + 2];
}

function measure(sim: Simulation, ms: number, year: number): Row {
  const w = sim.world;
  const mil = (sim as unknown as { military?: Record<string, any> }).military;
  let settlements = 0;
  let towns = 0;
  let satSum = 0;
  let satNeg = 0;
  let luxCov = 0;
  const built: Record<string, number> = {};
  let mines = 0;
  let treasuries = 0;
  for (let c = 0; c < w.cellCount; c++) {
    if (sim.cellPop[c] > 0) {
      settlements++;
      satSum += sim.satisfaction[c];
      if (sim.satisfaction[c] < 0) satNeg++;
      if (sim.economy.luxuryCovered[c]) luxCov++;
    }
    if (sim.cellPop[c] >= 50) towns++;
    treasuries += sim.government.treasury[c];
    if (!sim.hasBuildings[c]) continue;
    for (let s = c * SLOTS; s < (c + 1) * SLOTS; s++) {
      if (sim.economy.state[s] !== SlotState.Standing) continue;
      const name = BUILDINGS[sim.economy.type[s]].name;
      built[name] = (built[name] ?? 0) + 1;
      if (name === 'Iron mine' || name === 'Flint pit' || name === 'Gold mine') mines++;
    }
  }
  // Danger distribution over known ordered pairs.
  const dip = sim.diplomacy;
  const living = sim.civs.filter(Boolean).map((c) => c!.id);
  let known = 0;
  let low = 0;
  let mid = 0;
  let high = 0;
  let dangerSum = 0;
  let open = 0;
  for (const a of living) {
    for (const b of living) {
      if (a === b) continue;
      const k = a * PAIRS + b;
      if (!dip.known[k]) continue;
      known++;
      const d = dip.danger[k];
      dangerSum += d;
      if (d <= 40) low++;
      else if (d <= 60) mid++;
      else high++;
      open += dip.open[k];
    }
  }
  const text = (s: string) => sim.chronicle.filter((e) => e.text.includes(s)).length;
  let soldiers = 0;
  let strengthSum = 0;
  let coveredSoldiers = 0;
  const byType = [0, 0, 0];
  if (mil) {
    for (let c = 0; c < w.cellCount; c++) {
      for (let t = 0; t < TROOP_TYPES; t++) {
        const n = mil.soldiers[c * TROOP_TYPES + t];
        soldiers += n;
        byType[t] += n;
        if (mil.covered[c * TROOP_TYPES + t]) coveredSoldiers += n;
      }
    }
    for (const v of mil.strength) strengthSum += v;
  }
  // Soldiers per 1000 people of peoples with a standing gold mine and of those without.
  const goldCiv = new Set<number>();
  for (let c = 0; c < w.cellCount; c++) {
    if (!sim.hasBuildings[c] || !w.owner[c]) continue;
    for (let q = c * SLOTS; q < (c + 1) * SLOTS; q++) if (sim.economy.state[q] === SlotState.Standing && BUILDINGS[sim.economy.type[q]].name === 'Gold mine') goldCiv.add(w.owner[c]);
  }
  const grp = [[0, 0], [0, 0]];
  if (mil) {
    for (const id of living) {
      const g = goldCiv.has(id) ? 1 : 0;
      grp[g][0] += (mil.soldiersOf[id * TROOP_TYPES] ?? 0) + (mil.soldiersOf[id * TROOP_TYPES + 1] ?? 0) + (mil.soldiersOf[id * TROOP_TYPES + 2] ?? 0);
      grp[g][1] += sim.civs[id]!.population;
    }
  }
  const stockAt = [0, 0];
  if (mil) {
    for (let c = 0; c < w.cellCount; c++) {
      const has = soldiersAtCell(mil, c) > 0 ? 1 : 0;
      stockAt[has] += sim.economy.luxury[c * 7 + 5] + sim.economy.luxury[c * 7 + 6];
    }
  }
  let money = 0;
  for (const v of sim.economy.money) money += v;
  const del = sim.trade.delivered;
  const abroad = sim.trade.abroad;
  const row: Row = {
    people: sim.pop.count,
    peoples: living.length,
    settlements,
    'towns (50+)': towns,
    buildings: Object.values(built).reduce((a, b) => a + b, 0),
    'soldiers': soldiers,
    'soldiers % of people (of pop+soldiers)': (100 * soldiers) / Math.max(1, sim.pop.count + soldiers),
    melee: byType[0],
    ranged: byType[1],
    shock: byType[2],
    'soldiers with goods %': (100 * coveredSoldiers) / Math.max(1, soldiers),
    'strength (sum)': strengthSum,
    barracks: built['Barracks'] ?? 0,
    ranges: built['Shooting range'] ?? 0,
    stables: built['Stable'] ?? 0,
    'iron/flint/gold mines': mines,
    'desertion % of trained': mil?.trained ? (100 * mil.deserted) / mil.trained : 0,
    'soldiers/1000 gold peoples': (1000 * grp[1][0]) / Math.max(1, grp[1][1]),
    'soldiers/1000 other peoples': (1000 * grp[0][0]) / Math.max(1, grp[0][1]),
    'gold peoples': goldCiv.size,
    'iron+flint mined /yr': (mil?.goodsMined ?? 0) / year,
    'iron+flint needed /yr (melee+ranged)': (mil?.goodsNeeded ?? 0) / year,
    'iron+flint used by soldiers /yr': (mil?.goodsUsed ?? 0) / year,
    'bought by gov traders /yr': (mil?.goodsBought ?? 0) / year,
    'iron+flint stock at soldiers': stockAt[1],
    'iron+flint stock elsewhere': stockAt[0],
    'gold taxed (to treasuries)': mil?.goldTaxed ?? 0,
    'desertion: young peoples (<30y)': mil?.desNew ?? 0,
    'desertion: older peoples': mil?.desOld ?? 0,
    'desertion: rounding up': mil?.desRound ?? 0,
    'returned to population': mil?.returned ?? 0,
    'strategic agreements signed': sim.chronicle.filter((e) => /agreed to (deliver|trade).*\b(iron|flint|horses)\b/.test(e.text)).length,
    trained: mil?.trained ?? 0,
    deserted: mil?.deserted ?? 0,
    disbanded: mil?.disbanded ?? 0,
    'pay paid': mil?.paid ?? 0,
    'gold mined (money)': mil?.goldMined ?? 0,
    'goods used': mil?.goodsUsed ?? 0,
    treasuries,
    'gov spent': sim.government.spent,
    'taxes collected': sim.government.collected,
    'tax rate % (mean)': (() => {
      let r = 0;
      for (let c = 0; c < w.cellCount; c++) if (sim.cellPop[c] > 0) r += sim.government.cellRate[c];
      return (100 * r) / Math.max(1, settlements);
    })(),
    money,
    allTraded: del.reduce((s, v) => s + v, 0),
    deliveredAbroad: abroad.reduce((s, v) => s + v, 0),
    ironTraded: goodIndex('Iron') >= 0 ? del[goodIndex('Iron')] : 0,
    flintTraded: goodIndex('Flint') >= 0 ? del[goodIndex('Flint')] : 0,
    horsesTraded: goodIndex('Horses') >= 0 ? del[goodIndex('Horses')] : 0,
    ironAbroad: goodIndex('Iron') >= 0 ? abroad[goodIndex('Iron')] : 0,
    flintAbroad: goodIndex('Flint') >= 0 ? abroad[goodIndex('Flint')] : 0,
    horsesAbroad: goodIndex('Horses') >= 0 ? abroad[goodIndex('Horses')] : 0,
    'satisfaction mean': satSum / Math.max(1, settlements),
    'unhappy (<0) %': (100 * satNeg) / Math.max(1, settlements),
    'luxury covered %': (100 * luxCov) / Math.max(1, settlements),
    'known pairs': known,
    'danger mean': dangerSum / Math.max(1, known),
    'danger <=40 %': (100 * low) / Math.max(1, known),
    'danger 40-60 %': (100 * mid) / Math.max(1, known),
    'danger >60 %': (100 * high) / Math.max(1, known),
    'open borders now': open,
    'opened (total)': text('opened their borders'),
    'closed (total)': text('closed their borders'),
    'agreements running': dip.agreements.length,
    uprisings: text('rose up'),
    msPerYear: ms / year,
  };
  return row;
}

const results: { name: string; rows: Map<number, Row[]> }[] = [];
for (const spec of variants) {
  const [name, rest = ''] = spec.split(':');
  for (const [k, v] of Object.entries(defaults)) (MIL as Mil)[k] = v as number;
  Object.assign(GOV_TUNING, govDefaults);
  DEPOSITS[Deposit.Iron].frequency = depositDefaults.iron;
  DEPOSITS[Deposit.Flint].frequency = depositDefaults.flint;
  for (const kv of rest.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (k === 'depositMul') {
      DEPOSITS[Deposit.Iron].frequency = depositDefaults.iron * Number(v);
      DEPOSITS[Deposit.Flint].frequency = depositDefaults.flint * Number(v);
    } else if (MIL && k in MIL) MIL[k] = Number(v);
    else if (k in GOV_TUNING) (GOV_TUNING as Record<string, number>)[k] = Number(v);
    else throw new Error(`unknown key ${k}`);
  }
  const rows = new Map<number, Row[]>();
  for (let seed = 1; seed <= worlds; seed++) {
    const sim = createSimulation(generateWorld({ seed }));
    let ms = 0;
    for (const year of checkpoints) {
      const t0 = performance.now();
      while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) stepSimulation(sim);
      ms += performance.now() - t0;
      if (!rows.has(year)) rows.set(year, []);
      rows.get(year)!.push(measure(sim, ms, year));
    }
  }
  results.push({ name, rows });
}

for (const year of checkpoints) {
  console.log(`\n=== Year ${year}, ${worlds} worlds, mean [min..max] ===`);
  const keys = Object.keys(results[0].rows.get(year)![0]);
  console.log(['metric'.padEnd(34), ...results.map((r) => r.name.padStart(12))].join(' '));
  for (const k of keys) {
    const cells = results.map((r) => {
      const list = r.rows.get(year)!;
      const mean = list.reduce((s, x) => s + x[k], 0) / list.length;
      return (Math.abs(mean) >= 100 ? mean.toFixed(0) : mean.toFixed(1)).padStart(12);
    });
    console.log([k.padEnd(34), ...cells].join(' '));
  }
  console.log('people per world:');
  for (const r of results) console.log(`  ${r.name.padEnd(12)} ${r.rows.get(year)!.map((x) => String(x.people).padStart(6)).join('')}`);
}

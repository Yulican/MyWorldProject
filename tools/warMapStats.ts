// War phase 3 (war on the map: declaration, armies, march, battles, peace, siege, occupation, conquest;
// "Design Documents/Requirement Krieg.md", sections 4 to 6) over many worlds, against the state without war.
// Usage: npx tsx tools/warMapStats.ts [worlds=24] [years=300,500] [variant ...]
//   A variant is "name:key=value,key=value" with the numbers of WAR (src/sim/society/war.ts), e.g.
//   npx tsx tools/warMapStats.ts 24 300,500 "base:phase=0" "3a:phase=1" "3ab:phase=2" "malus80:phase=2,siegeMalus=80"
//   phase=0 is the state without war. Without variants: base, 3a, 3ab.
// Prints per year: growth, population, trade, diplomacy, uprisings, wars (started, ongoing, duration, end types,
// battles, armies), sieges and occupations (seat satisfaction at the first check), territory, and the cost of the
// war parts per week and year plus ms per simulated year.
import { performance } from 'node:perf_hooks';
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation, type Simulation } from '../src/sim';
import { PAIRS } from '../src/sim/society/diplomacy';
import { WAR, END_NAMES } from '../src/sim/society/war';
import { TRIBE_TUNING } from '../src/sim/society/simulation';

const worlds = Number(process.argv[2] ?? 24);
const checkpoints = (process.argv[3] ?? '300,500').split(',').map(Number);
const variants = process.argv.slice(4).length ? process.argv.slice(4) : ['base:phase=0', '3a:phase=1', '3ab:phase=2'];
const defaults = { ...WAR };
const tribeDefaults = { ...TRIBE_TUNING };
// Non-WAR keys of a variant: map size in hex columns/rows (default 64 x 64), maxCivs and chance of new tribes (TRIBE_TUNING).
const WORLD_KEYS = ['width', 'height'];

type Row = Record<string, number>;

function measure(sim: Simulation, ms: number, year: number): Row {
  const w = sim.world;
  const st = sim.war.stats;
  let settlements = 0;
  let satNeg = 0;
  let satSum = 0;
  for (let c = 0; c < w.cellCount; c++) {
    if (sim.cellPop[c] > 0) {
      settlements++;
      satSum += sim.satisfaction[c];
      if (sim.satisfaction[c] < 0) satNeg++;
    }
  }
  const dip = sim.diplomacy;
  const living = sim.civs.filter(Boolean).map((c) => c!.id);
  const adjPairs = new Set<number>();
  for (let c = 0; c < w.cellCount; c++) {
    const a = w.owner[c];
    if (!a || sim.cellPop[c] === 0) continue;
    for (let d = 0; d < 6; d++) {
      const nb = w.neighbors[c * 6 + d];
      const b = nb >= 0 ? w.owner[nb] : 0;
      if (b && b > a && sim.cellPop[nb] > 0) adjPairs.add(a * PAIRS + b);
    }
  }
  let knownPairs = 0;
  for (const a of living) for (const b of living) if (a < b && sim.diplomacy.known[a * PAIRS + b]) knownPairs++;
  let open = 0;
  let known = 0;
  for (const a of living) {
    for (const b of living) {
      if (a === b || !dip.known[a * PAIRS + b]) continue;
      known++;
      open += dip.open[a * PAIRS + b];
    }
  }
  const text = (s: string) => sim.chronicle.filter((e) => e.text.includes(s)).length;
  const del = sim.trade.delivered;
  const abroad = sim.trade.abroad;
  let soldiers = 0;
  for (let c = 0; c < w.cellCount * 3; c++) soldiers += sim.military.soldiers[c];
  const ended = st.ended.reduce((a, b) => a + b, 0);
  const dur = st.durations.reduce((a, b) => a + b, 0) / Math.max(1, st.durations.length) / TICKS_PER_YEAR;
  const row: Row = {
    settlements,
    people: sim.pop.count,
    peoples: living.length,
    soldiers,
    'trade volume (units)': del.reduce((s, v) => s + v, 0),
    'trade abroad (units)': abroad.reduce((s, v) => s + v, 0),
    'agreements running': dip.agreements.length,
    'open borders (share of pairs %)': (100 * open) / Math.max(1, known),
    'free trade pairs': dip.freeTrade.reduce((s, v) => s + v, 0) / 2,
    'satisfaction mean': satSum / Math.max(1, settlements),
    'unhappy (<0) %': (100 * satNeg) / Math.max(1, settlements),
    'uprisings (total)': text('rose up'),
    'cut off (total)': text('cut off from'),
    'known pairs': knownPairs,
    'neighbor pairs (adjacent)': adjPairs.size,
    'wars declared': st.declared,
    'wars vs established peoples': st.estDeclared,
    'wars vs own splinters': st.declared - st.estDeclared,
    'est.: battles': st.estBattles,
    'est.: sieges': st.estSieges,
    'est.: occupations': st.estOcc,
    'est.: whole people annexed': st.estAnnexed,
    'wars ongoing': sim.war.wars,
    'blocked by army cap': st.capBlocked,
    'annex-blocked goals (checks)': st.annexBlocked,
    'war duration (years)': dur,
    'end: goal conquered': st.ended[0],
    'end: defender gave up': st.ended[1],
    'end: exhaustion': st.ended[2],
    'end: attacker gave up': st.ended[3],
    'end: people vanished': st.ended[4],
    'wars without any battle': st.noBattle,
    'wars vs a people with 0 strength': st.zeroDefender,
    'wars at ratio > 2.5': st.ratioHigh,
    'conquest roads built': st.roads,
    'battles': st.battles,
    'battles per war': st.battles / Math.max(1, st.declared),
    'battle wins attacker/defender/draw': st.battleWins[0] + st.battleWins[1] * 0.001,
    'armies raised': st.armiesRaised,
    'armies at once (max)': st.maxArmies,
    'wars at once (max)': st.maxWars,
    sieges: st.sieges,
    'siege: first check, seat sat < 0': st.checksBelow,
    'siege: first checks': st.checks,
    'siege: mean seat sat at start': st.startSat / Math.max(1, st.sieges),
    'siege: mean seat sat at check': st.checkSat / Math.max(1, st.checks),
    'siege: mean seat target at check': st.checkTarget / Math.max(1, st.checks),
    'siege: occupations': st.occupations,
    'siege: broken (no besieger left)': st.siegeBroken,
    'siege: withdrawn': st.siegeWithdrew,
    'territory moved (settlements)': st.cellsMoved,
    'territory moved (people)': st.peopleMoved,
    'whole people annexed': st.annexed,
    'ms week war (mean)': st.weekMs / Math.max(1, st.weekCalls),
    'ms week war (worst)': st.weekMax,
    'ms year war (worst)': st.yearMax,
    'ms year war (mean)': st.yearMs / Math.max(1, st.yearCalls),
    msPerYear: ms / year,
  };
  void ended;
  return row;
}

const results: { name: string; rows: Map<number, Row[]>; extra: Map<number, string[]> }[] = [];
for (const spec of variants) {
  const [name, rest = ''] = spec.split(':');
  Object.assign(WAR, defaults);
  Object.assign(TRIBE_TUNING, tribeDefaults);
  const worldOpt: Record<string, number> = {};
  WAR.profile = 1;
  for (const kv of rest.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (WORLD_KEYS.includes(k)) worldOpt[k] = Number(v);
    else if (k in TRIBE_TUNING) (TRIBE_TUNING as Record<string, number>)[k] = Number(v);
    else if (!(k in WAR)) throw new Error(`unknown key ${k}`);
    else (WAR as Record<string, number>)[k] = Number(v);
  }
  const rows = new Map<number, Row[]>();
  const extra = new Map<number, string[]>();
  for (let seed = 1; seed <= worlds; seed++) {
    const sim = createSimulation(generateWorld({ seed, ...worldOpt }));
    let ms = 0;
    for (const year of checkpoints) {
      const t0 = performance.now();
      while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) stepSimulation(sim);
      ms += performance.now() - t0;
      if (!rows.has(year)) rows.set(year, []);
      rows.get(year)!.push(measure(sim, ms, year));
    }
  }
  results.push({ name, rows, extra });
}

for (const year of checkpoints) {
  console.log(`\n=== Year ${year}, ${worlds} worlds, mean per world (worst: max) ===`);
  const keys = Object.keys(results[0].rows.get(year)![0]);
  console.log(['metric'.padEnd(38), ...results.map((r) => r.name.padStart(12))].join(' '));
  for (const k of keys) {
    const cells = results.map((r) => {
      const list = r.rows.get(year)!;
      const worst = k.includes('worst') || k.includes('(max)');
      const v = worst ? Math.max(...list.map((x) => x[k])) : list.reduce((s, x) => s + x[k], 0) / list.length;
      return (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)).padStart(12);
    });
    console.log([k.padEnd(38), ...cells].join(' '));
  }
}
void END_NAMES;

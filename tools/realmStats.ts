// How soldiers and unhappiness are distributed inside the realms, and how new faiths spread (for the rebellion question):
// soldiers per people/settlement and their concentration, rebel vs mother strength (passed and blocked checks),
// satisfaction spread, clustering and duration of unhappy settlements, their main terms, growth of daughter faiths.
// Usage: npx tsx tools/realmStats.ts [worlds=12] [off|rects|m15f1] [key=value,...]   (extra keys of WAR or MIL, e.g. militia=0.1)   (checkpoints 100, 300, 500)
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation, type Simulation } from '../src/sim';
import { DIRECTION_COUNT } from '../src/sim/hex';
import { MIL, TROOP_TYPES } from '../src/sim/society/military';
import { WAR } from '../src/sim/society/war';
import { REBEL_CHECK, measureRebellion } from '../src/sim/society/rebellion';
import { satisfactionTerms } from '../src/sim/society/satisfaction';
import { UPRISING_HOOK } from '../src/sim/society/simulation';
import { FAITH_SCALE_TRAIT, MAXR, RELIGION, installReligion, onUprising, religionOf, religionYear, removeReligion } from '../src/sim/society/religion';

const worlds = Number(process.argv[2] ?? 12);
const variant = process.argv[3] ?? 'off';
const CP = [100, 300, 500];
const rects: Record<string, number> = { newProgress: 60, idle: -0.5, counter: -4, deathShare: 0.005, ageEvent: 0, holyMission: 1, holyForeign: 1, tradeScale: 0.5, heresyMode: 1, heresyRebel: 0.5 };
const m15: Record<string, number> = { ...rects, heresyRelative: 1, heresyMargin: -15, heresyRebel: 0.1 };
for (const kv of (process.argv[4] ?? '').split(',').filter(Boolean)) {
  const [key, v] = kv.split('=');
  if (key in WAR) (WAR as Record<string, number>)[key] = Number(v);
  else if (key in MIL) (MIL as Record<string, number>)[key] = Number(v);
}
if (variant !== 'off') {
  Object.assign(RELIGION, variant === 'm15f1' ? m15 : rects);
  for (const t of [7, 8, 9, 21]) FAITH_SCALE_TRAIT[t] = 0.5;
}

const acc = new Map<string, number[]>();
const add = (k: string, v: number) => {
  if (!Number.isFinite(v)) return;
  (acc.get(k) ?? acc.set(k, []).get(k)!).push(v);
};
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const q = (a: number[], p: number) => {
  const b = a.slice().sort((x, y) => x - y);
  return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN;
};
const gini = (a: number[]) => {
  const b = a.slice().sort((x, y) => x - y);
  const n = b.length;
  const sum = b.reduce((s, v) => s + v, 0);
  if (n < 2 || sum === 0) return 0;
  let w = 0;
  for (let i = 0; i < n; i++) w += (i + 1) * b[i];
  return (2 * w) / (n * sum) - (n + 1) / n;
};

let passed: number[] = [];
UPRISING_HOOK.fn = (sim: Simulation, cells: readonly number[], parent: number) => {
  passed.push(REBEL_CHECK.rebels / Math.max(1, REBEL_CHECK.mother));
  add('rebellions declared (per world, all years)', 1);
  const label = (cell: number): string => {
    let w = '';
    let wv = 0;
    for (const t of satisfactionTerms(sim, cell, sim.civs[parent] ?? null)) if (t.value < wv) { wv = t.value; w = t.label; }
    return w;
  };
  if (religionOf(sim)) onUprising(sim, cells, parent, label);
};

function sample(sim: Simulation, year: number, run: Int16Array, blocked: number[]): void {
  const w = sim.world;
  const n = w.cellCount;
  for (let c = 0; c < n; c++) {
    const o = w.owner[c];
    const un = sim.cellPop[c] > 0 && sim.satisfaction[c] < 0 && sim.civs[o]?.capital !== c;
    if (un) run[c]++;
    else if (run[c] > 0) {
      add('unhappy spell length (years)', run[c]);
      run[c] = 0;
    }
  }
  // Blocked rebel checks: peoples with unhappy settlements whose rebels would lose.
  for (let o = 1; o < sim.civs.length; o++) {
    if (!sim.civs[o]) continue;
    let un = 0;
    for (let c = 0; c < n; c++) if (w.owner[c] === o && run[c] > 0) un++;
    if (un === 0) continue;
    if (!measureRebellion(sim, o) && REBEL_CHECK.rebels > 0) blocked.push(REBEL_CHECK.rebels / Math.max(1, REBEL_CHECK.mother));
  }
}

function report(sim: Simulation, y: number, run: Int16Array): void {
  const w = sim.world;
  const n = w.cellCount;
  const m = sim.military;
  const k = (s: string) => `${y} ${s}`;
  let soldiers = 0;
  let militia = 0;
  let bld = 0;
  for (let c = 0; c < n; c++) {
    for (let t = 0; t < TROOP_TYPES; t++) {
      soldiers += m.soldiers[c * TROOP_TYPES + t];
      bld += m.cap[c * TROOP_TYPES + t] / 20;
    }
    militia += sim.war.militia[c];
  }
  add(k('population'), sim.pop.count);
  add(k('soldiers total'), soldiers);
  add(k('soldiers % of population'), (100 * soldiers) / Math.max(1, sim.pop.count));
  add(k('militia (rebel wars running)'), militia);
  add(k('military buildings standing'), bld);
  let settl = 0;
  let zero = 0;
  for (let o = 1; o < sim.civs.length; o++) {
    if (!sim.civs[o]) continue;
    const cells: number[] = [];
    for (let c = 0; c < n; c++) if (w.owner[o === 0 ? 0 : c] === o && sim.cellPop[c] > 0) cells.push(c);
    if (cells.length === 0) continue;
    const s = cells.map((c) => m.soldiers[c * 3] + m.soldiers[c * 3 + 1] + m.soldiers[c * 3 + 2]);
    settl += cells.length;
    zero += s.filter((v) => v === 0).length;
    const tot = s.reduce((a, b) => a + b, 0);
    if (cells.length >= 3) {
      add(k('peoples (>=3 settlements)'), 1);
      add(k('soldiers % of people (per people)'), (100 * tot) / Math.max(1, cells.reduce((a, c) => a + sim.cellPop[c], 0)));
      if (tot > 0) {
        const sorted = s.slice().sort((a, b) => b - a);
        const capSold = m.soldiers[sim.civs[o]!.capital * 3] + m.soldiers[sim.civs[o]!.capital * 3 + 1] + m.soldiers[sim.civs[o]!.capital * 3 + 2];
        add(k('soldiers: share in the capital %'), (100 * capSold) / tot);
        add(k('soldiers: share in top 1 settlement %'), (100 * sorted[0]) / tot);
        add(k('soldiers: share in top 3 settlements %'), (100 * (sorted[0] + sorted[1] + sorted[2])) / tot);
        add(k('soldiers: Gini over settlements'), gini(s));
        add(k('soldiers: settlements with 0 soldiers %'), (100 * s.filter((v) => v === 0).length) / s.length);
      }
      // Satisfaction spread.
      const sat = cells.filter((c) => sim.civs[o]!.capital !== c).map((c) => sim.satisfaction[c]);
      if (sat.length) {
        const mu = mean(sat);
        add(k('satisfaction mean (per people)'), mu);
        add(k('satisfaction std (per people)'), Math.sqrt(mean(sat.map((v) => (v - mu) * (v - mu)))));
        add(k('settlements below 0 % (per people)'), (100 * sat.filter((v) => v < 0).length) / sat.length);
        add(k('unhappy settlements at once (per people)'), sat.filter((v) => v < 0).length);
      }
    }
  }
  add(k('settlements with 0 soldiers % (all)'), (100 * zero) / Math.max(1, settl));
  // Clustering of unhappy settlements: unhappy neighbors of unhappy vs of happy settlements; largest connected bloc.
  let uu = 0, un = 0, hu = 0, hn = 0;
  const seen = new Uint8Array(n);
  let blocs = 0;
  let largest = 0;
  let unhappyTotal = 0;
  for (let c = 0; c < n; c++) {
    if (sim.cellPop[c] === 0) continue;
    const o = w.owner[c];
    const bad = sim.satisfaction[c] < 0 && sim.civs[o]?.capital !== c;
    let nb = 0, nbBad = 0;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const x = w.neighbors[c * DIRECTION_COUNT + d];
      if (x < 0 || sim.cellPop[x] === 0 || w.owner[x] !== o) continue;
      nb++;
      if (sim.satisfaction[x] < 0 && sim.civs[o]?.capital !== x) nbBad++;
    }
    if (nb === 0) continue;
    if (bad) { un += nb; uu += nbBad; unhappyTotal++; } else { hn += nb; hu += nbBad; }
    if (bad && !seen[c]) {
      blocs++;
      let size = 0;
      const stack = [c];
      seen[c] = 1;
      while (stack.length) {
        const a = stack.pop()!;
        size++;
        for (let d = 0; d < DIRECTION_COUNT; d++) {
          const x = w.neighbors[a * DIRECTION_COUNT + d];
          if (x >= 0 && !seen[x] && sim.cellPop[x] > 0 && w.owner[x] === o && sim.satisfaction[x] < 0 && sim.civs[o]?.capital !== x) { seen[x] = 1; stack.push(x); }
        }
      }
      largest = Math.max(largest, size);
    }
  }
  add(k('neighbors unhappy | settlement unhappy %'), un ? (100 * uu) / un : NaN);
  add(k('neighbors unhappy | settlement happy %'), hn ? (100 * hu) / hn : NaN);
  add(k('unhappy settlements (world)'), unhappyTotal);
  add(k('unhappy blocs (connected)'), blocs);
  add(k('largest unhappy bloc'), largest);
  // Main (worst) term of unhappy settlements.
  const main = new Map<string, number>();
  let count = 0;
  for (let c = 0; c < n; c++) {
    if (sim.cellPop[c] === 0 || sim.satisfaction[c] >= 0 || sim.civs[w.owner[c]]?.capital === c) continue;
    let worst = '';
    let wv = 0;
    for (const t of satisfactionTerms(sim, c, sim.civs[w.owner[c]] ?? null)) if (t.value < wv) { wv = t.value; worst = t.label.replace(/[\d.]+/g, '#').replace(/^(Luxury|Comfort).*/, '$1'); }
    main.set(worst, (main.get(worst) ?? 0) + 1);
    count++;
  }
  for (const [label, v] of main) add(`${y} main term: ${label} (settlements per world)`, v);
  void count;
  void run;
}

for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  const st = variant === 'off' ? null : installReligion(sim);
  const run = new Int16Array(sim.world.cellCount);
  const blocked: number[] = [];
  passed = [];
  const spread = new Map<number, number[][]>();
  const cellsHist: Record<string, number[]> = {};
  void cellsHist;
  while (sim.tick < 500 * TICKS_PER_YEAR && !sim.gameOver) {
    stepSimulation(sim);
    if (sim.tick % TICKS_PER_YEAR !== 0) continue;
    if (st) religionYear(sim);
    const y = sim.tick / TICKS_PER_YEAR;
    sample(sim, y, run, blocked);
    if (st && y % 1 === 0) {
      // Daughter faiths (with a mother): believers, cells they hold a majority in, cells they are present in, clustering.
      for (let r = 1; r < MAXR; r++) {
        if (!st.alive[r] || st.parent[r] < 0) continue;
        const age = y - st.founded[r];
        if (age !== 1 && age !== 5 && age !== 10 && age !== 20 && age !== 30) continue;
        let present = 0, maj = 0, nbPresent = 0, civs = 0;
        const w = sim.world;
        for (let c = 0; c < w.cellCount; c++) {
          if (st.cellBel[c * MAXR + r] < 1) continue;
          present++;
          if (st.cellBel[c * MAXR + r] * 2 > sim.cellPop[c]) maj++;
          for (let d = 0; d < DIRECTION_COUNT; d++) {
            const x = w.neighbors[c * DIRECTION_COUNT + d];
            if (x >= 0 && st.cellBel[x * MAXR + r] >= 1) { nbPresent++; break; }
          }
        }
        for (let c = 1; c < 256; c++) if (st.cnt[c * MAXR + r] >= 20) civs++;
        add(`daughter faith age ${age}: believers`, st.total[r]);
        add(`daughter faith age ${age}: settlements present`, present);
        add(`daughter faith age ${age}: settlements majority`, maj);
        add(`daughter faith age ${age}: present with a present neighbor %`, present ? (100 * nbPresent) / present : NaN);
        add(`daughter faith age ${age}: peoples with >=20 believers`, civs);
      }
    }
    if (CP.includes(y)) report(sim, y, run);
  }
  void spread;
  add('rebel check passed: ratio rebels/mother', 0);
  acc.get('rebel check passed: ratio rebels/mother')!.pop();
  for (const v of passed) add('rebel check passed: ratio rebels/mother', v);
  for (const v of blocked) add('rebel check blocked (year samples): ratio rebels/mother', v);
  add('rebels declared per world', passed.length);
  if (st) removeReligion();
  process.stderr.write(`seed ${seed}\n`);
}
console.log(`== ${variant}, ${worlds} worlds (means over samples; "per world" = per world)`);
for (const [key, vals] of [...acc].sort((a, b) => a[0].localeCompare(b[0]))) {
  const ratio = key.includes('ratio');
  const perWorldSum = key.includes('per world') && !key.includes('rebels declared') ? vals.length / worlds : NaN;
  console.log(`${key.padEnd(72)} n=${String(vals.length).padStart(5)} mean ${mean(vals).toFixed(2).padStart(8)}${ratio || key.includes('spell') ? `  median ${q(vals, 0.5).toFixed(2)} p10 ${q(vals, 0.1).toFixed(2)} p90 ${q(vals, 0.9).toFixed(2)}` : ''}${Number.isNaN(perWorldSum) ? '' : `  (events/world ${perWorldSum.toFixed(1)})`}`);
}

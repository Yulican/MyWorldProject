// Gacha calibration (see "Design Documents/Requirement Gacha.md"): believers of the player god over time,
// Faith accrual, price curve and rarity statistics, modelled on top of the unchanged simulation.
// Usage: npx tsx tools/gachaStats.ts [worlds=12] [years=500] [cache=path.json]
//   Without effects of abilities (current faith rules). Believers are read every tick (sim.believers).
//   Price models: exp (a*g^(n-1)), lin (a*(1+b*(n-1))), pow (a*n^k); each with accrual factor f (Faith/believer/tick).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation } from '../src/sim';

const worlds = Number(process.argv[2] ?? 12);
const years = Number(process.argv[3] ?? 500);
const cache = process.argv[4];
const TPS = 6; // default speed, weeks per real second (SPEEDS in src/state/worldStore.ts: 6/26/104)
const TARGET_TICKS = 300 * TPS; // 5 real minutes at default speed

// ---- believers per tick per world ----
let bel: number[][];
if (cache && existsSync(cache)) bel = JSON.parse(readFileSync(cache, 'utf8'));
else {
  bel = [];
  for (let seed = 1; seed <= worlds; seed++) {
    const sim = createSimulation(generateWorld({ seed }));
    const a: number[] = [];
    while (a.length < years * TICKS_PER_YEAR) {
      if (!sim.gameOver) stepSimulation(sim);
      a.push(sim.gameOver ? 0 : sim.believers);
    }
    bel.push(a);
  }
  if (cache) writeFileSync(cache, JSON.stringify(bel));
}

const q = (v: number[], p: number) => {
  const s = [...v].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};
const f1 = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1));
const pad = (s: string, n = 10) => s.padStart(n);

// 1. believers over time
console.log('Gläubige (Spieler-Gott) nach Jahr: Median [p10 .. p90] min max');
for (const y of [0, 25, 50, 100, 200, 300, 400, 500].filter((y) => y * TICKS_PER_YEAR < bel[0].length)) {
  const v = bel.map((a) => a[Math.min(a.length - 1, y * TICKS_PER_YEAR)]);
  console.log(`  J${String(y).padEnd(4)} ${pad(f1(q(v, 0.5)))} [${f1(q(v, 0.1))} .. ${f1(q(v, 0.9))}] ${Math.min(...v)} ${Math.max(...v)}`);
}

// 2. pulls
type Model = { name: string; f: number; price: (n: number) => number };
/** Pull times (ticks) of one world: pull whenever stock >= price(n). */
function pullTicks(a: number[], m: Model): number[] {
  const out: number[] = [];
  let stock = 0;
  let n = 1;
  for (let t = 0; t < a.length; t++) {
    stock += a[t] * m.f;
    for (let p = m.price(n); stock >= p; p = m.price(n)) {
      stock -= p;
      out.push(t);
      n++;
    }
  }
  return out;
}
function report(m: Model, speeds = [6]) {
  const per = bel.map((a) => pullTicks(a, m));
  console.log(`\n${m.name}  f=${m.f}`);
  const marks = [1, 5, 10, 20, 40, 80, 150];
  console.log('  Minuten (Default) zwischen Ziehungen n-1 -> n: Median [p10 .. p90]; Welten mit Ziehung n');
  for (const n of marks) {
    const v: number[] = [];
    for (const p of per) if (p.length >= n) v.push((p[n - 1] - (n > 1 ? p[n - 2] : 0)) / TPS / 60);
    if (v.length) console.log(`  n=${String(n).padEnd(4)} ${pad(f1(q(v, 0.5)), 7)} [${f1(q(v, 0.1))} .. ${f1(q(v, 0.9))}]  (${v.length}/${bel.length})`);
  }
  // minutes per pull in game-year windows
  console.log('  Ziehungen je Echtstunde (Default) in Jahresfenstern, Median [p10..p90]:');
  for (const [y0, y1] of [[0, 25], [25, 50], [50, 100], [100, 200], [200, 300], [300, 400], [400, 500]]) {
    if (y1 * TICKS_PER_YEAR > bel[0].length) continue;
    const v = per.map((p) => (p.filter((t) => t >= y0 * TICKS_PER_YEAR && t < y1 * TICKS_PER_YEAR).length / ((y1 - y0) * TICKS_PER_YEAR / TPS / 3600)));
    console.log(`   J${y0}-${y1}: ${f1(q(v, 0.5))} [${f1(q(v, 0.1))} .. ${f1(q(v, 0.9))}]  = alle ${f1(60 / Math.max(0.01, q(v, 0.5)))} min`);
  }
  const tot = per.map((p) => p.length);
  console.log(`  Ziehungen gesamt (${years} J): Median ${q(tot, 0.5)} [${q(tot, 0.1)} .. ${q(tot, 0.9)}]; Preis der letzten: ${f1(m.price(q(tot, 0.5)))}`);
  // Faith and price depend on game time only: at 26 / 104 weeks/s the pulls per real minute are 4.3x / 17.3x the default ones.
}

const expModel = (f: number, a: number, g: number): Model => ({ name: `exp ${a}*${g}^(n-1)`, f, price: (n) => a * Math.pow(g, n - 1) });
const linModel = (f: number, a: number, b: number): Model => ({ name: `lin ${a}*(1+${b}*(n-1))`, f, price: (n) => a * (1 + b * (n - 1)) });
const powModel = (f: number, a: number, k: number): Model => ({ name: `pow ${a}*n^${k}`, f, price: (n) => a * Math.pow(n, k) });
const models: Model[] = [expModel(0.0005, 20, 1.25)];
for (const arg of process.argv.slice(5)) {
  const [kind, ...p] = arg.split(':');
  const x = p.map(Number);
  if (kind === 'exp') models.push(expModel(x[0], x[1], x[2]));
  if (kind === 'lin') models.push(linModel(x[0], x[1], x[2]));
  if (kind === 'pow') models.push(powModel(x[0], x[1], x[2]));
}
if (process.env.FIT) {
  // grid search: start price a (f fixed = FIT) and shape, minimising mean squared log deviation of the pull intervals from the 5 minute target
  const f = Number(process.env.FIT);
  const loss = (m: Model) => {
    let sum = 0;
    let c = 0;
    for (const a of bel) {
      const p = pullTicks(a, m);
      for (let i = 0; i < p.length; i++) {
        const d = Math.log(Math.max(1, p[i] - (i ? p[i - 1] : 0)) / TARGET_TICKS);
        sum += d * d;
        c++;
      }
      // a world that never pulls again is penalised by the time since its last pull
      const since = a.length - (p.length ? p[p.length - 1] : 0);
      if (since > 2 * TARGET_TICKS) { sum += Math.pow(Math.log(since / TARGET_TICKS), 2); c++; }
    }
    return sum / c;
  };
  const best: Record<string, [number, string]> = {};
  const consider = (k: string, l: number, d: string) => { if (!best[k] || l < best[k][0]) best[k] = [l, d]; };
  for (let a = 2; a <= 400; a *= 1.15) {
    for (let g = 1.02; g <= 1.6; g += 0.02) consider('exp', loss(expModel(f, a, g)), `a=${a.toFixed(1)} g=${g.toFixed(2)}`);
    for (let b = 0.1; b <= 20; b *= 1.2) consider('lin', loss(linModel(f, a, b)), `a=${a.toFixed(1)} b=${b.toFixed(2)}`);
    for (let k = 0.6; k <= 2.6; k += 0.1) consider('pow', loss(powModel(f, a, k)), `a=${a.toFixed(1)} k=${k.toFixed(1)}`);
  }
  console.log(`\nFit (f=${f}):`);
  for (const [k, [l, d]] of Object.entries(best)) console.log(`  ${k}: rms log dev ${Math.sqrt(l).toFixed(2)}  ${d}`);
}
for (const m of models) report(m);

// 3. rarity (tools/gachaStats uses the requirement's tiers, weights via env W=60,28,10,2)
const tiers = { Common: 7, Rare: 10, Epic: 6, Legendary: 2 };
const w = (process.env.W ?? '60,28,10,2').split(',').map(Number);
const sw = w.reduce((a, b) => a + b, 0);
const cnt = Object.values(tiers);
console.log(`\nSeltenheit, Gewichte ${w.join('/')}: Wahrscheinlichkeit je Fähigkeit und Ziehung (3 Fähigkeiten je Pull)`);
let i = 0;
for (const [name, c] of Object.entries(tiers)) {
  const pAb = w[i] / sw / c; // per single ability draw
  const pTier = w[i] / sw;
  const first1 = 1 / (1 - Math.pow(1 - pTier, 3)); // expected pulls to first of tier
  console.log(`  ${name.padEnd(10)} ${c} Fähigkeiten, Stufe ${(100 * pTier).toFixed(1)}%, je Fähigkeit ${(100 * pAb).toFixed(2)}%/Slot, ${(3 * pAb).toFixed(3)} je Pull, erwartete Pulls bis erste Stufe: ${first1.toFixed(1)}, bis bestimmte Fähigkeit: ${(1 / (1 - Math.pow(1 - pAb, 3))).toFixed(1)}`);
  i++;
}

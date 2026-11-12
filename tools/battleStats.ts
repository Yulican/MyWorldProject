// War phase 2: the battle function (src/sim/society/battle.ts) on real armies
// of neighboring peoples and on synthetic compositions.
// Usage: npx tsx tools/battleStats.ts [worlds=24] [years=300,500]
// Prints: win rate and losses by strength ratio and defense situation (field, seat +25 %, seat with army +50 %),
// rounds and retreats, the strength metric vs composition, and the cost per battle. Numbers are the fixed BATTLE.
import { performance } from 'node:perf_hooks';
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation } from '../src/sim';
import { PAIRS } from '../src/sim/society/diplomacy';
import { MIL, TROOP_TYPES } from '../src/sim/society/military';
import { BATTLE, BO, Defense, fightBattle, givesUp } from '../src/sim/society/battle';

const worlds = Number(process.argv[2] ?? 24);
const years = (process.argv[3] ?? '300,500').split(',').map(Number);
let seedState = 12345;
function rnd(): number {
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** An army: counts [m, r, s] and factors [m, r, s]. */
type Army = { n: number[]; f: number[] };
const strengthOf = (a: Army) => a.n[0] * a.f[0] + a.n[1] * a.f[1] + a.n[2] * a.f[2];
const soldiersOf = (a: Army) => a.n[0] + a.n[1] + a.n[2];
const scaled = (a: Army, k: number): Army => ({ n: a.n.map((x) => x * k), f: a.f });

const inp = new Float64Array(12);
const out = new Float64Array(BO.SIZE);
function fight(a: Army, b: Army, bonus: Defense): number {
  for (let t = 0; t < 3; t++) {
    inp[t] = a.n[t];
    inp[3 + t] = a.f[t];
    inp[6 + t] = b.n[t];
    inp[9 + t] = b.f[t];
  }
  return fightBattle(inp, bonus, out);
}

// ---------- Real armies ----------
const real: { year: number; a: Army; b: Army }[] = [];
for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  for (const year of years) {
    while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) stepSimulation(sim);
    const m = sim.military;
    const w = sim.world;
    const cov = new Float64Array(sim.civSlots * TROOP_TYPES);
    for (let c = 0; c < w.cellCount; c++) {
      const civ = w.owner[c];
      if (!civ) continue;
      for (let t = 0; t < TROOP_TYPES; t++) if (m.covered[c * TROOP_TYPES + t]) cov[civ * TROOP_TYPES + t] += m.soldiers[c * TROOP_TYPES + t];
    }
    const armyOf = (civ: number): Army => {
      const n = [0, 0, 0];
      const f = [1, 1, 1];
      for (let t = 0; t < 3; t++) {
        n[t] = m.soldiersOf[civ * TROOP_TYPES + t];
        if (n[t] > 0) f[t] = 1 + (MIL.factor - 1) * (cov[civ * TROOP_TYPES + t] / n[t]);
      }
      return { n, f };
    };
    const living = sim.civs.filter(Boolean).map((c) => c!.id);
    for (const a of living) {
      for (const b of living) {
        if (a >= b || !sim.diplomacy.known[a * PAIRS + b]) continue;
        if (!(sim.diplomacy.distance[a * PAIRS + b] < 10)) continue;
        const x = armyOf(a);
        const y = armyOf(b);
        if (strengthOf(x) <= 0 || strengthOf(y) <= 0) continue;
        real.push(strengthOf(x) >= strengthOf(y) ? { year, a: x, b: y } : { year, a: y, b: x });
      }
    }
  }
}

// ---------- Synthetic compositions ----------
const COMPS: [string, number[]][] = [
  ['melee', [1, 0, 0]],
  ['ranged', [0, 1, 0]],
  ['shock', [0, 0, 1]],
  ['M+R', [0.5, 0.5, 0]],
  ['M+S', [0.5, 0, 0.5]],
  ['R+S', [0, 0.5, 0.5]],
  ['mix', [0.34, 0.33, 0.33]],
  ['mel-heavy', [0.6, 0.2, 0.2]],
  ['rng-heavy', [0.2, 0.6, 0.2]],
  ['shk-heavy', [0.2, 0.2, 0.6]],
];
/** An army of the given composition with exactly the given strength, supplied (all types factor 1.5) or not. */
function synth(shares: number[], strength: number, supplied: boolean): Army {
  const f = supplied ? MIL.factor : 1;
  // soldiers n with shares s: strength = n * f
  const n = strength / f;
  return { n: shares.map((s) => s * n), f: [f, f, f] };
}

// ---------- Aggregation ----------
type Agg = { n: number; win: number; lossA: number; lossB: number; rounds: number; undecided: number; strLossA: number; strLossB: number; retreat: number; lossW: number; lossL: number };
const newAgg = (): Agg => ({ n: 0, win: 0, lossA: 0, lossB: 0, rounds: 0, undecided: 0, strLossA: 0, strLossB: 0, retreat: 0, lossW: 0, lossL: 0 });
/** A is the (stronger) attacker, B the defender with `bonus`. Undecided: the loser kept more than `Y` of its strength. */
function add(g: Agg, a: Army, b: Army, bonus: Defense, Y: number): void {
  const r = fight(a, b, bonus);
  g.n++;
  g.win += r > 0 ? 1 : r === 0 ? 0.5 : 0;
  g.lossA += out[BO.lostA] / Math.max(1e-9, soldiersOf(a));
  g.lossB += out[BO.lostB] / Math.max(1e-9, soldiersOf(b));
  g.strLossA += out[BO.strLostA] / out[BO.startA];
  g.strLossB += out[BO.strLostB] / out[BO.startB];
  g.rounds += out[BO.rounds];
  if (out[BO.retreat]) g.retreat++;
  const lA = out[BO.lostA] / Math.max(1e-9, soldiersOf(a));
  const lB = out[BO.lostB] / Math.max(1e-9, soldiersOf(b));
  g.lossW += r >= 0 ? lA : lB;
  g.lossL += r >= 0 ? lB : lA;
  const loserShare = r >= 0 ? out[BO.remB] / out[BO.startB] : out[BO.remA] / out[BO.startA];
  if (loserShare > Y) g.undecided++;
}
const pct = (x: number, n: number) => ((100 * x) / Math.max(1, n)).toFixed(0).padStart(4);
function line(label: string, g: Agg): string {
  return `${label.padEnd(26)} n=${String(g.n).padStart(5)} win ${pct(g.win, g.n)}%  lossA ${pct(g.lossA, g.n)}%  lossB ${pct(g.lossB, g.n)}%  lossWinner ${pct(g.lossW, g.n)}%  lossLoser ${pct(g.lossL, g.n)}%  rounds ${(g.rounds / Math.max(1, g.n)).toFixed(1)}  retreat ${pct(g.retreat, g.n)}%  undecided ${pct(g.undecided, g.n)}%`;
}

const RATIOS = [1, 1.5, 2, 3];
const BONUSES: [string, Defense][] = [['field', Defense.Field], ['seat +25%', Defense.Seat], ['seat+army +50%', Defense.SeatArmy]];

function synthTable(title: string, Y = 0.5, supplied = false): void {
  console.log(`\n--- ${title} (synthetic, all ${COMPS.length}x${COMPS.length} composition pairs, ${supplied ? 'supplied' : 'unsupplied'}, attacker = stronger) ---`);
  for (const [bn, bonus] of BONUSES) {
    for (const ratio of RATIOS) {
      const g = newAgg();
      for (const [, ca] of COMPS) for (const [, cb] of COMPS) add(g, synth(ca, 1000 * ratio, supplied), synth(cb, 1000, supplied), bonus, Y);
      console.log(line(`${bn} ${ratio}:1`, g));
    }
  }
}

console.log(`BATTLE: ${JSON.stringify(BATTLE)}; ${real.length} real neighbor pairs from ${worlds} worlds at years ${years.join(',')}`);

// Real armies.
{
  const tot = real.reduce((s, p) => s + soldiersOf(p.a) + soldiersOf(p.b), 0) / (2 * real.length);
  const comp = [0, 0, 0];
  for (const p of real) for (let t = 0; t < 3; t++) comp[t] += p.a.n[t] + p.b.n[t];
  const cs = comp[0] + comp[1] + comp[2];
  console.log(`Real armies: mean ${tot.toFixed(1)} soldiers/people, melee ${pct(comp[0], cs)}% ranged ${pct(comp[1], cs)}% shock ${pct(comp[2], cs)}%`);
  console.log('\n--- real (whole armies, attacker = stronger) by strength ratio ---');
  const bins: [string, number, number][] = [['1-1.25', 1, 1.25], ['1.25-1.75', 1.25, 1.75], ['1.75-2.5', 1.75, 2.5], ['2.5-4', 2.5, 4], ['>4', 4, 1e9]];
  for (const [bn, bonus] of BONUSES) {
    for (const [name, lo, hi] of bins) {
      const g = newAgg();
      for (const p of real) {
        const r = strengthOf(p.a) / strengthOf(p.b);
        if (r >= lo && r < hi) add(g, p.a, p.b, bonus, 0.5);
      }
      if (g.n) console.log(line(`${bn} ${name}`, g));
    }
  }
  console.log('\n--- real, partial armies (random 30-100% of each) ---');
  for (const [bn, bonus] of BONUSES) {
    const g = newAgg();
    const gs = newAgg();
    for (const p of real) {
      const a = scaled(p.a, 0.3 + 0.7 * rnd());
      const b = scaled(p.b, 0.3 + 0.7 * rnd());
      const [x, y] = strengthOf(a) >= strengthOf(b) ? [a, b] : [b, a];
      add(g, x, y, bonus, 0.5);
      if (strengthOf(x) / strengthOf(y) >= 2) add(gs, x, y, bonus, 0.5);
    }
    console.log(line(`${bn} all`, g));
    console.log(line(`${bn} ratio>=2`, gs));
  }
}

synthTable('unsupplied');
synthTable('supplied', 0.5, true);

// Give-up check (war phase 3): share of real neighbor pairs where the weaker side would give up.
{
  let n = 0;
  for (const p of real) if (givesUp(strengthOf(p.b), strengthOf(p.a))) n++;
  console.log(`\nReal neighbor pairs where the weaker gives up (< ${BATTLE.giveUp * 100}% of the stronger): ${pct(n, real.length)}%`);
}

// Does the strength metric predict? Random compositions at random strength ratio.
console.log('\n--- metric vs composition: stronger (by metric) wins, random compositions, ratio 1.0-1.5 / 1.5-2 / 2-3 ---');
const randComp = (): number[] => {
  const x = [rnd() ** 2, rnd() ** 2, rnd() ** 2];
  const s = x[0] + x[1] + x[2] || 1;
  return x.map((v) => v / s);
};
const samples: { a: Army; b: Army }[] = [];
for (let i = 0; i < 6000; i++) {
  const ratio = 1 + 2 * rnd();
  const supA = rnd() < 0.3;
  const supB = rnd() < 0.3;
  samples.push({ a: synth(randComp(), 1000 * ratio, supA), b: synth(randComp(), 1000, supB) });
}
for (const [lo, hi] of [[1, 1.5], [1.5, 2], [2, 3]]) {
  for (const [bn, bonus] of BONUSES.slice(0, 2)) {
    const g = newAgg();
    for (const s of samples) {
      const r = strengthOf(s.a) / strengthOf(s.b);
      if (r >= lo && r < hi) add(g, s.a, s.b, bonus, 0.5);
    }
    console.log(line(`${bn} ratio ${lo}-${hi}`, g));
  }
}
// Composition vs composition at equal strength (row wins against column in % of battles, no bonus, unsupplied).
console.log('\nEqual strength, row (attacker) wins vs column, %, no bonus:');
console.log(''.padEnd(10) + COMPS.map(([n]) => n.slice(0, 8).padStart(9)).join(''));
for (const [na, ca] of COMPS) {
  let row = na.padEnd(10);
  for (const [, cb] of COMPS) {
    const r = fight(synth(ca, 1000, false), synth(cb, 1000, false), Defense.Field);
    row += (r > 0 ? '100' : r === 0 ? '50' : '0').padStart(9);
  }
  console.log(row);
}
console.log('Pure types: margin (remaining strength share of winner) at equal strength, no bonus:');
for (const [na, ca] of COMPS.slice(0, 3)) {
  let row = na.padEnd(10);
  for (const [, cb] of COMPS.slice(0, 3)) {
    fight(synth(ca, 1000, false), synth(cb, 1000, false), Defense.Field);
    row += `${(out[BO.remA] / 1000).toFixed(2)}/${(out[BO.remB] / 1000).toFixed(2)}`.padStart(12);
  }
  console.log(row);
}

// Fit per-type weights of the strength metric: strength' = sum w_t * n_t * f_t. Accuracy = stronger' wins.
{
  const accOf = (w: number[], bonus: Defense): number => {
    let ok = 0;
    let tot = 0;
    for (const s of samples) {
      const a = s.a.n[0] * s.a.f[0] * w[0] + s.a.n[1] * s.a.f[1] * w[1] + s.a.n[2] * s.a.f[2] * w[2];
      const b = s.b.n[0] * s.b.f[0] * w[0] + s.b.n[1] * s.b.f[1] * w[1] + s.b.n[2] * s.b.f[2] * w[2];
      const r = fight(s.a, s.b, bonus);
      // Only count battles with a clear result (margin of remaining shares over 10 points).
      const sh = out[BO.remA] / out[BO.startA] - out[BO.remB] / out[BO.startB];
      if (Math.abs(sh) < 0.1) continue;
      tot++;
      if ((a >= b) === r > 0) ok++;
    }
    return ok / tot;
  };
  // Samples with equal metric ratio window would hide the effect: use all samples with ratio < 3 and also a pairwise-equal set.
  console.log('\nMetric weights (melee, ranged, shock) -> share of clear battles where the higher weighted strength wins (no bonus):');
  let best = [1, 1, 1];
  let bestAcc = 0;
  for (const wr of [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5]) for (const ws of [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5]) {
    const acc = accOf([1, wr, ws], Defense.Field);
    if (acc > bestAcc) { bestAcc = acc; best = [1, wr, ws]; }
    if (wr === 1 && ws === 1) console.log(`  w=1,1,1: ${(100 * acc).toFixed(1)}%`);
  }
  console.log(`  best grid w=${best.join(',')}: ${(100 * bestAcc).toFixed(1)}%`);
  // Equal-metric test: compositions with metric ratio within 1.0-1.15 (true outcome depends on composition).
  const g = newAgg();
  const eq: { a: Army; b: Army }[] = [];
  for (let i = 0; i < 4000; i++) eq.push({ a: synth(randComp(), 1000 * (1 + 0.15 * rnd()), false), b: synth(randComp(), 1000, false) });
  for (const s of eq) add(g, s.a, s.b, Defense.Field, 0.5);
  console.log(`  metric ratio 1.0-1.15 random compositions: stronger wins ${pct(g.win, g.n)}%`);
}

// Composition multiplier: strength a composition needs to beat 1000 of a reference composition.
function tieStrength(shares: number[], ref: number[], bonus: Defense): number {
  let lo = 200;
  let hi = 5000;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const r = fight(synth(shares, mid, false), synth(ref, 1000, false), bonus);
    if (r > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
console.log('\nStrength an army needs to beat 1000 of: pure melee | mix(1/3 each) | mel-heavy (metric says 1000 = equal):');
for (const [n, c] of COMPS) {
  console.log(`  ${n.padEnd(10)} ${COMPS.slice(0, 1).concat(COMPS.slice(6, 8)).map(([, ref]) => tieStrength(c, ref, Defense.Field).toFixed(0).padStart(6)).join('')}`);
}
// Worst-case ratio over all composition pairs at which the stronger always wins (flip point), by defender bonus.
console.log('Ratio needed so the attacker wins vs ANY composition (max over 10x10 pairs) / vs 95 % of pairs:');
for (const [bn, bonus] of BONUSES) {
  const need: number[] = [];
  for (const [, ca] of COMPS) for (const [, cb] of COMPS) {
    need.push(tieStrength(ca, cb, bonus) / 1000);
  }
  need.sort((x, y) => x - y);
  console.log(`  ${bn}: max ${need[need.length - 1].toFixed(2)}  p95 ${need[Math.floor(need.length * 0.95)].toFixed(2)}  median ${need[need.length >> 1].toFixed(2)}`);
}

// Cost.
{
  const a = synth(COMPS[6][1], 2000, true);
  const b = synth(COMPS[7][1], 1000, false);
  const N = 300000;
  const t0 = performance.now();
  let sink = 0;
  for (let i = 0; i < N; i++) sink += fight(a, b, Defense.Seat);
  const us = ((performance.now() - t0) * 1000) / N;
  console.log(`\nCost: ${us.toFixed(2)} us per battle (5 rounds, ${N} battles, sink ${sink})`);
}

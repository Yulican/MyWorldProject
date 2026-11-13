// Leaders (Requirement "Anführer"): the game without leaders (enabled=0, tools only) against the game with them, over
// many worlds, and the leaders themselves (terms, goals, attributes, caps, how much opposite attributes differ).
// Usage: npx tsx tools/leaderStats.ts [worlds=12] [years=300] [variant ...]
//   A variant is "name:key=value,key=value" with numbers of LEADER (src/sim/society/leaders.ts: enabled, attrScale,
//   goalScale, deathBase, experience, expansionFactor, ...), WAR, ALLY, MIL, GOV_TUNING or TRIBE_TUNING, e.g.
//   npx tsx tools/leaderStats.ts 12 300 "off:enabled=0" "on:enabled=1" "half:enabled=1,attrScale=0.5,goalScale=0.5"
//   Special keys: forceAttr=N (every new leader starts with attribute N, 1..25: one attribute against another on the same
//   worlds), mute=lever+lever (the named levers of leaders.ts: L have no effect, to find which one causes a difference).
//   "a18.travel=0.7" / "g1.settleOver=0.95": change one effect of attribute 18 / goal 1 (lever names: leaders.ts L; attribute and goal numbers: leaderRules.ts).
//   The word "brief" prints the world numbers as one line per variant (many variants) and skips the leader tables.
//   Default variants: off (enabled=0, the simulation without leaders) and on (enabled=1, the game).
//   Same seeds in every variant; the leaders draw from their own random sequence ("leader").
// Prints: 1. world numbers per variant (growth, trade, diplomacy, wars, uprisings, satisfaction, peoples);
//   2. per variant with leaders: terms, goals and completion, attributes, caps; 3. per attribute: how the peoples that
//   held it behaved (per people-year), against all peoples, and the opposite pairs side by side.
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation, type Simulation } from '../src/sim';
import { PAIRS } from '../src/sim/society/diplomacy';
import { GOV_TUNING } from '../src/sim/society/taxes';
import { MIL } from '../src/sim/society/military';
import { ALLY } from '../src/sim/society/pacts';
import { TRIBE_TUNING } from '../src/sim/society/simulation';
import { EndType, WAR } from '../src/sim/society/war';
import { ATTRS, GOAL_FX, leaderTerms } from '../src/sim/society/leaderRules';
import { EVENT_NAMES, GOALS, L, LEADER, MEASURES, MEASURE_NAMES, MUTE, M, type TermRecord } from '../src/sim/society/leaders';

const worlds = Number(process.argv[2] ?? 12);
const checkpoints = (process.argv[3] ?? '300').split(',').map(Number);
const brief = process.argv.includes('brief');
const variants = process.argv.slice(4).filter((a) => a !== 'brief');
if (variants.length === 0) variants.push('off:enabled=0', 'on:enabled=1');

const tables: Record<string, Record<string, number>> = { LEADER, WAR, ALLY, MIL, GOV_TUNING, TRIBE_TUNING };
const defaults = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, { ...v }]));
// The effect tables (attributes, goals) can be changed per variant: "a18.travel=0.7" sets the travel lever of attribute 18 to 0.7
// (it is added to the effects if the attribute has none), "g1.settleOver=0.95" likewise for goal 1.
const effectDefaults = [...ATTRS.map((a) => a.fx.map((e) => [...e])), ...GOAL_FX.map((f) => f.map((e) => [...e]))];
function resetEffects(): void {
  ATTRS.forEach((a, i) => (a.fx = effectDefaults[i].map((e) => [e[0], e[1]] as [number, number])));
  GOAL_FX.forEach((_, i) => (GOAL_FX[i] = effectDefaults[ATTRS.length + i].map((e) => [e[0], e[1]] as [number, number])));
}
function setEffect(spec: string, value: number): boolean {
  const m = /^([ag])(\d+)\.(\w+)$/.exec(spec);
  if (!m) return false;
  if (!(m[3] in L)) throw new Error(`unknown lever ${m[3]}`);
  const lever = L[m[3] as keyof typeof L];
  const list = m[1] === 'a' ? ATTRS[Number(m[2])].fx : GOAL_FX[Number(m[2])];
  const found = list.find((e) => e[0] === lever);
  if (found) found[1] = value;
  else list.push([lever, value]);
  return true;
}

type Row = Record<string, number>;

function worldRow(sim: Simulation): Row {
  const w = sim.world;
  const st = sim.war.stats;
  const dip = sim.diplomacy;
  let settlements = 0;
  let towns = 0;
  let cities = 0;
  let satSum = 0;
  let satNeg = 0;
  for (let c = 0; c < w.cellCount; c++) {
    const pop = sim.cellPop[c];
    if (pop <= 0) continue;
    settlements++;
    satSum += sim.satisfaction[c];
    if (sim.satisfaction[c] < 0) satNeg++;
    if (pop >= 50) towns++;
    if (pop >= 150) cities++;
  }
  let standing = 0;
  for (let i = 0; i < sim.economy.state.length; i++) if (sim.economy.state[i] === 2) standing++;
  let treasury = 0;
  for (let c = 0; c < w.cellCount; c++) treasury += sim.government.treasury[c];
  let roads = 0;
  for (let c = 0; c < w.cellCount; c++) if (w.roads[c] !== 0) roads++;
  const living = sim.civs.filter(Boolean).map((c) => c!.id);
  let open = 0;
  let known = 0;
  let pacts = 0;
  let alliances = 0;
  for (const a of living) {
    for (const b of living) {
      if (a === b) continue;
      if (dip.known[a * PAIRS + b]) {
        known++;
        open += dip.open[a * PAIRS + b];
      }
      if (a < b) {
        if (sim.war.pact[a * PAIRS + b] === 1) pacts++;
        else if (sim.war.pact[a * PAIRS + b] === 2) alliances++;
      }
    }
  }
  const text = (s: string) => sim.chronicle.filter((e) => e.text.includes(s)).length;
  const ended = st.ended.reduce((a, b) => a + b, 0);
  let freeTrade = 0;
  for (const a of living) for (const b of living) if (a < b) freeTrade += dip.freeTrade[a * PAIRS + b];
  let value = 0;
  for (let c = 1; c < 256; c++) value += sim.leaders.tradeLast[c];
  let soldiers = 0;
  for (let c = 0; c < w.cellCount * 3; c++) soldiers += sim.military.soldiers[c];
  return {
    settlements,
    'towns (50+)': towns,
    'cities (150+)': cities,
    people: sim.pop.count,
    'peoples at the end': living.length,
    soldiers,
    'trade volume (units, total)': sim.trade.delivered.reduce((s, v) => s + v, 0),
    'trade abroad (units, total)': sim.trade.abroad.reduce((s, v) => s + v, 0),
    'trade value last year (money, sum of peoples)': value,
    'trade agreements running': dip.agreements.length,
    'free trade pairs': freeTrade,
    'open borders (% of known pairs)': (100 * open) / Math.max(1, known),
    'pacts now': pacts,
    'alliances now': alliances,
    'pacts signed (total)': st.pactsSigned,
    'alliances signed (total)': st.alliancesSigned,
    'wars declared': st.declared,
    'war duration (years)': st.durationSum / Math.max(1, ended) / TICKS_PER_YEAR,
    'end: defender gave up (conquest)': st.ended[EndType.GaveUp],
    'end: attacker gave up': st.ended[EndType.AttackerGaveUp],
    'end: exhaustion': st.ended[EndType.Exhausted],
    'districts conquered (settlements moved)': st.cellsMoved,
    'whole peoples annexed': st.annexed,
    'battles': st.battles,
    'allies joined': st.joins,
    'REBELLIONS declared': st.rebDeclared,
    'rebellions: exhaustion (rebels stay free)': st.rebExhausted,
    'uprisings (settlement leagues, total)': text('rose up'),
    'cut off (total)': text('cut off from'),
    'new tribes (total)': text('A new people, the'),
    'satisfaction mean': satSum / Math.max(1, settlements),
    'unhappy (<0) %': (100 * satNeg) / Math.max(1, settlements),
    'game over (nobody prays, worlds)': sim.gameOver ? 1 : 0,
    'wars on an earlier victor (revenge)': sim.leaders.stats.revengeWars,
    'buildings standing': standing,
    'government treasuries (sum)': treasury,
    'hexes with roads': roads,
    'iron+flint mined (units)': sim.military.goodsMined,
    'gold mined': sim.military.goldMined,
  };
}

type Run = { name: string; rows: Map<number, Row[]>; terms: TermRecord[][]; sims: { all: Float64Array; attrM: Float64Array; goalM: Float64Array; stats: Simulation['leaders']['stats'] }[]; enabled: boolean };
const runs: Run[] = [];

for (const spec of variants) {
  const [name, rest = ''] = spec.split(':');
  for (const [k, v] of Object.entries(tables)) Object.assign(v, defaults[k]);
  MUTE.fill(0);
  // The tool keeps a sample of every term (the game does not).
  LEADER.records = 1;
  resetEffects();
  for (const kv of rest.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (k === 'mute') {
      for (const n of v.split('+')) {
        if (!(n in L)) throw new Error(`unknown lever ${n}`);
        MUTE[L[n as keyof typeof L]] = 1;
      }
      continue;
    }
    if (setEffect(k, Number(v))) continue;
    const table = Object.values(tables).find((t) => k in t);
    if (!table) throw new Error(`unknown key ${k}`);
    table[k] = Number(v);
  }
  const run: Run = { name, rows: new Map(), terms: [], sims: [], enabled: LEADER.enabled === 1 };
  for (let seed = 1; seed <= worlds; seed++) {
    const sim = createSimulation(generateWorld({ seed }));
    for (const year of checkpoints) {
      while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) stepSimulation(sim);
      if (!run.rows.has(year)) run.rows.set(year, []);
      run.rows.get(year)!.push(worldRow(sim));
    }
    run.terms.push(leaderTerms(sim));
    run.sims.push({ all: sim.leaders.all, attrM: sim.leaders.attrM, goalM: sim.leaders.goalM, stats: sim.leaders.stats });
  }
  runs.push(run);
}

function stderr(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, xs.length - 1) / xs.length);
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

// 1. World numbers.
const BRIEF = [
  'settlements',
  'people',
  'peoples at the end',
  'trade value last year (money, sum of peoples)',
  'free trade pairs',
  'open borders (% of known pairs)',
  'pacts now',
  'alliances now',
  'wars declared',
  'districts conquered (settlements moved)',
  'REBELLIONS declared',
  'uprisings (settlement leagues, total)',
  'satisfaction mean',
  'game over (nobody prays, worlds)',
];
const SHORT = ['settl', 'people', 'peoples', 'trade$', 'free', 'open%', 'pacts', 'allies', 'wars', 'conq', 'rebel', 'upris', 'sat', 'over'];
if (brief) {
  for (const year of checkpoints) {
    console.log(`\n=== Year ${year}, ${worlds} worlds, mean per world ===`);
    console.log('variant'.padEnd(26) + SHORT.map((h) => h.padStart(8)).join(''));
    for (const r of runs) console.log(r.name.padEnd(26) + BRIEF.map((k) => fmt(r.rows.get(year)!.reduce((s, x) => s + x[k], 0) / worlds).padStart(8)).join(''));
    // Worlds drift apart chaotically: the standard error of a mean over the worlds says what a difference must exceed.
    console.log('(standard error, first)'.padEnd(26) + BRIEF.map((k) => fmt(stderr(runs[0].rows.get(year)!.map((x) => x[k]))).padStart(8)).join(''));
  }
}
for (const year of brief ? [] : checkpoints) {
  console.log(`\n=== Year ${year}, ${worlds} worlds, mean per world ===`);
  const keys = Object.keys(runs[0].rows.get(year)![0]);
  console.log(['metric'.padEnd(46), ...runs.map((r) => r.name.padStart(15))].join(' '));
  for (const k of keys) {
    console.log([k.padEnd(46), ...runs.map((r) => `${fmt(r.rows.get(year)!.reduce((s, x) => s + x[k], 0) / worlds)} ±${fmt(stderr(r.rows.get(year)!.map((x) => x[k])))}`.padStart(15))].join(' '));
  }
}

// 2. The leaders.
const pct = (a: number, b: number) => (b > 0 ? ((100 * a) / b).toFixed(0) + ' %' : '-');
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
for (const run of brief ? [] : runs) {
  if (!run.enabled) continue;
  const terms = run.terms.flat();
  const ended = terms.filter((t) => t.end !== 2);
  const byDeath = terms.filter((t) => t.end === 0);
  const st = run.sims.map((s) => s.stats);
  const sum = (f: (s: (typeof st)[0]) => number) => st.reduce((a, s) => a + f(s), 0);
  const dynasties = sum((s) => s.dynasties);
  console.log(`\n=== Leaders (${run.name}), ${worlds} worlds, year ${checkpoints[checkpoints.length - 1]} ===`);
  console.log(`terms ${terms.length} (ended by death ${byDeath.length}, people gone ${terms.filter((t) => t.end === 1).length}, still ruling ${terms.filter((t) => t.end === 2).length}); peoples ever ${dynasties}; leaders per people ${(terms.length / Math.max(1, dynasties)).toFixed(1)}`);
  console.log(`term length (years): mean ${mean(byDeath.map((t) => t.years)).toFixed(1)}, median ${median(byDeath.map((t) => t.years)).toFixed(0)}, min ${Math.min(...byDeath.map((t) => t.years)).toFixed(0)}, max ${Math.max(...byDeath.map((t) => t.years)).toFixed(0)} (deaths only); all terms mean ${mean(terms.map((t) => t.years)).toFixed(1)}`);
  console.log(`2nd attribute (10 years in office): ${pct(terms.filter((t) => t.attrs.length >= 2).length, terms.length)} of all terms, ${pct(byDeath.filter((t) => t.attrs.length >= 2).length, byDeath.length)} of terms ended by death; 3 attributes: ${pct(terms.filter((t) => t.attrs.length >= 3).length, terms.length)} / ${pct(byDeath.filter((t) => t.attrs.length >= 3).length, byDeath.length)}`);
  console.log(`1st attribute inherited: ${pct(sum((s) => s.inherited), sum((s) => s.inheritChances))} of ${sum((s) => s.inheritChances)} successions; 2nd attribute from experience ${pct(sum((s) => s.secondFromExperience), sum((s) => s.attrDrawn.reduce((a, b) => a + b, 0)))} (of all draws, rough)`);
  console.log(`caps binding (share of people-years): satisfaction +-${LEADER.capSatisfaction} ${pct(sum((s) => s.capSat), sum((s) => s.capYears))}, 2x threshold floor ${LEADER.capRatioMin} ${pct(sum((s) => s.capRatio), sum((s) => s.capYears))}, war roll cap ${LEADER.capWarChance * 100} % ${pct(sum((s) => s.capChance), sum((s) => s.capYears))}; exclusion breaks: ${sum((s) => s.exclusionBreaks)}`);
  console.log('goal         chosen    reached(death-ended)   reached(all terms)  within 15y  within 30y  mean years to goal (median)');
  for (let g = 1; g <= 4; g++) {
    const all = terms.filter((t) => t.goal === g);
    const dead = byDeath.filter((t) => t.goal === g);
    const doneAll = all.filter((t) => t.doneYears >= 0);
    const doneDead = dead.filter((t) => t.doneYears >= 0);
    // Share of terms that were long enough (>= 15 / 30 years in office) and reached the goal by then.
    const long15 = all.filter((t) => t.years >= 15);
    const long30 = all.filter((t) => t.years >= 30);
    console.log(
      `${GOALS[g].padEnd(10)} ${String(all.length).padStart(7)} (${pct(all.length, terms.length).padStart(5)}) ${pct(doneDead.length, dead.length).padStart(10)} ${pct(doneAll.length, all.length).padStart(20)} ${pct(long15.filter((t) => t.doneYears >= 0 && t.doneYears <= 15).length, long15.length).padStart(11)} ${pct(long30.filter((t) => t.doneYears >= 0 && t.doneYears <= 30).length, long30.length).padStart(10)} ${mean(doneAll.map((t) => t.doneYears)).toFixed(1).padStart(10)} (${median(doneAll.map((t) => t.doneYears)).toFixed(0)})`,
    );
  }
  const part = (i: number) => sum((s) => s.parts[i]);
  console.log(`why goals fail (share of active-goal years where the part held): Wealth value x${LEADER.wealthFactor} ${pct(part(1), part(0))}, Wealth partners >= ${LEADER.wealthPartners} ${pct(part(2), part(0))}; Security calm (danger <= ${LEADER.securityDanger}, no loss) ${pct(part(4), part(3))}, a pact ${pct(part(5), part(3))}; Glory war won as attacker ${pct(part(7), part(6))} (with a conquered district ${pct(part(9), part(6))}), capital tier up ${pct(part(8), part(6))}`);
  const reached = terms.filter((t) => t.doneYears >= 0);
  console.log(`goal reached at all: ${pct(reached.length, terms.length)} of terms; of those within 15-30 years in office: ${pct(reached.filter((t) => t.doneYears >= 15 && t.doneYears <= 30).length, reached.length)}`);
  // Attribute frequency (held at the end of a term or now).
  const freq = new Int32Array(26);
  for (const t of terms) for (const a of t.attrs) freq[a]++;
  const total = freq.reduce((a, b) => a + b, 0);
  console.log('attribute frequency (share of all attribute slots): ' + Array.from({ length: 25 }, (_, i) => `${ATTRS[i + 1].name} ${((100 * freq[i + 1]) / total).toFixed(1)}`).join(', '));
}

// 3. Attribute and goal behavior.
function measuresOf(run: Run, pick: (s: Run['sims'][0]) => Float64Array, offset: number): number[] {
  const out = new Array<number>(MEASURES).fill(0);
  for (const s of run.sims) {
    const a = pick(s);
    for (let m = 0; m < MEASURES; m++) out[m] += a[offset + m];
  }
  return out;
}
function line(label: string, m: number[]): string {
  const y = Math.max(1, m[M.years]);
  const cells = [
    String(Math.round(m[M.years])).padStart(7),
    ((100 * m[M.declared]) / y).toFixed(2).padStart(7),
    ((100 * m[M.war]) / y).toFixed(1).padStart(7),
    ((100 * m[M.open]) / y).toFixed(1).padStart(7),
    (m[M.deals] / y).toFixed(2).padStart(6),
    (m[M.pacts] / y).toFixed(2).padStart(6),
    (m[M.tradeValue] / y).toFixed(0).padStart(7),
    (m[M.settlements] / y).toFixed(1).padStart(7),
    (m[M.growth] / y).toFixed(2).padStart(7),
    (m[M.satisfaction] / y).toFixed(1).padStart(6),
    ((100 * m[M.rebellions]) / y).toFixed(1).padStart(7),
  ];
  return label.padEnd(22) + cells.join(' ');
}
const header = 'peoples that held...'.padEnd(22) + ['years', 'war/100y', 'at war%', 'open%', 'deals', 'pacts', 'trade$', 'settl.', 'grow/y', 'sat', 'reb/100y'].map((h) => h.padStart(7)).join(' ');
for (const run of brief ? [] : runs) {
  if (!run.enabled) continue;
  console.log(`\n=== Behavior per attribute and goal (${run.name}): per people-year over all worlds ===`);
  console.log(header);
  console.log(line('ALL peoples', measuresOf(run, (s) => s.all, 0)));
  for (let a = 1; a <= 25; a++) console.log(line(`${a} ${ATTRS[a].name}`, measuresOf(run, (s) => s.attrM, a * MEASURES)));
  console.log(header.replace('peoples that held...', 'by goal (active)'));
  for (let g = 1; g <= 4; g++) {
    console.log(line(`${GOALS[g]} (active)`, measuresOf(run, (s) => s.goalM, g * MEASURES)));
    console.log(line(`${GOALS[g]} (reached)`, measuresOf(run, (s) => s.goalM, (g + 5) * MEASURES)));
  }
  console.log('\nOpposite pairs (the same measure, ratio first/second):');
  const pairs: [number, number][] = [[1, 2], [18, 19], [7, 8], [13, 14], [15, 16], [20, 21], [22, 23], [4, 5]];
  for (const [a, b] of pairs) {
    const ma = measuresOf(run, (s) => s.attrM, a * MEASURES);
    const mb = measuresOf(run, (s) => s.attrM, b * MEASURES);
    const per = (m: number[], i: number) => m[i] / Math.max(1, m[M.years]);
    const r = (i: number) => (per(mb, i) !== 0 ? (per(ma, i) / per(mb, i)).toFixed(2) : '-');
    console.log(
      `${ATTRS[a].name} vs ${ATTRS[b].name}: wars declared x${r(M.declared)}, at war x${r(M.war)}, open borders x${r(M.open)}, trade partners x${r(M.deals)}, pacts x${r(M.pacts)}, trade value x${r(M.tradeValue)}, settlement growth ${per(ma, M.growth).toFixed(2)} vs ${per(mb, M.growth).toFixed(2)} /y, satisfaction ${per(ma, M.satisfaction).toFixed(1)} vs ${per(mb, M.satisfaction).toFixed(1)}, rebellions x${r(M.rebellions)}  (years ${Math.round(ma[M.years])} / ${Math.round(mb[M.years])})`,
    );
  }
}
void MEASURE_NAMES;
void EVENT_NAMES;

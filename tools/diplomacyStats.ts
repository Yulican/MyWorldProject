// Key figures of diplomacy over many worlds, to calibrate its numbers (see
// "Design Documents/Requirement Diplomatie.md", Abnahme).
// Usage: npx tsx tools/diplomacyStats.ts [worlds=12] [years=100,200,300]
import { performance } from 'node:perf_hooks';
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation } from '../src/sim';
import { PAIRS } from '../src/sim/society/diplomacy';

const worlds = Number(process.argv[2] ?? 12);
const checkpoints = (process.argv[3] ?? '100,200,300').split(',').map(Number);

type Row = Record<string, number>;
const rows = new Map<number, Row[]>();
const samples: string[] = [];

for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  let ms = 0;
  for (const year of checkpoints) {
    const t0 = performance.now();
    while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) stepSimulation(sim);
    ms += performance.now() - t0;
    const dip = sim.diplomacy;
    const living = sim.civs.filter(Boolean).map((c) => c!.id);
    let pairs = 0;
    let known = 0;
    let open = 0;
    let freeTrade = 0;
    let migration = 0;
    let trust = 0;
    let danger = 0;
    for (const a of living) {
      for (const b of living) {
        if (a === b) continue;
        pairs++;
        const k = a * PAIRS + b;
        if (!dip.known[k]) continue;
        known++;
        trust += dip.trust[k];
        danger += dip.danger[k];
        open += dip.open[k];
        if (a < b) {
          freeTrade += dip.freeTrade[k];
          migration += dip.migration[k];
        }
      }
    }
    const text = (s: string) => sim.chronicle.filter((e) => e.text.includes(s)).length;
    const diplomatic = ['met.', 'opened their borders', 'closed their borders', 'free trade', 'settle with each other', 'migration agreement', 'agreed to deliver', 'agreed to trade', 'trade agreement for'];
    const entries = sim.chronicle.filter((e) => diplomatic.some((s) => e.text.includes(s))).length;
    let abroad = 0;
    for (const v of sim.trade.abroad) abroad += v;
    const row: Row = {
      people: sim.pop.count,
      peoples: living.length,
      knownPairs: known / Math.max(1, pairs),
      meetings: text('met.'),
      openBorders: open,
      opened: text('opened their borders'),
      closed: text('closed their borders'),
      freeTrade,
      migration,
      tradeAgreements: dip.agreements.length,
      twoSidedNow: dip.agreements.filter((t) => t.legs.length === 2).length,
      oneSidedMade: text('agreed to deliver'),
      twoSidedMade: text('agreed to trade'),
      agreementsBroken: text('broke: too little'),
      agreementsRanOut: text('ran out.'),
      meanTrust: known ? trust / known : 0,
      meanDanger: known ? danger / known : 0,
      deliveredAbroad: abroad,
      tollPaid: dip.tollPaid,
      migrationsAbroad: sim.migrations.abroad,
      diplomacyEntries: entries,
      entriesPerYear: entries / year,
      msPerYear: ms / year,
    };
    if (!rows.has(year)) rows.set(year, []);
    rows.get(year)!.push(row);
    if (year === checkpoints.at(-1) && seed <= 2) {
      samples.push(`seed ${seed}: ` + sim.chronicle.filter((e) => diplomatic.some((s) => e.text.includes(s))).slice(0, 12).map((e) => `${Math.floor(e.tick / TICKS_PER_YEAR) + 1}: ${e.text}`).join('\n  '));
    }
  }
}

for (const [year, list] of rows) {
  const keys = Object.keys(list[0]);
  const mean = (k: string) => list.reduce((s, r) => s + r[k], 0) / list.length;
  const range = (k: string) => `${Math.min(...list.map((r) => r[k])).toFixed(1)}..${Math.max(...list.map((r) => r[k])).toFixed(1)}`;
  console.log(`\nYear ${year} (${list.length} worlds): mean [min..max]`);
  for (const k of keys) console.log(`  ${k.padEnd(18)} ${mean(k).toFixed(2).padStart(9)}  [${range(k)}]`);
}
console.log('\n' + samples.join('\n'));

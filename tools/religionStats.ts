// Religion prototype, step 1 (Design Documents/Requirement Religion.md): the game without religions ("off") against the
// religion layer (src/sim/society/religion.ts; hooks in faithHooks.ts) over many worlds.
// Usage: npx tsx tools/religionStats.ts [worlds=12] [years=100,300,500] [variant ...] [out=file.json]
//        npx tsx tools/religionStats.ts report=a.json,b.json   (side by side)
//   A variant is "name:key=value,key=value" with the numbers of RELIGION (religion.ts), e.g.
//   "on" (the requirement's start values), "weak:effect=0.5", "nofound:foundChance=0", "notrust:faithTrust=0".
//   "off" = no religion layer (the current game). Default variants: off, on.
//   Same seeds in every variant; the layer draws from its own random sequence "faith".
// Prints per checkpoint year: growth, population, trade, diplomacy, wars (holy share), rebellions; the religions
// (number alive, founding paths, traits, levels, spread between peoples), the player's faith, heresy, awakening thresholds.
import { writeFileSync, readFileSync } from 'node:fs';
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation, type Simulation } from '../src/sim';
import { PAIRS } from '../src/sim/society/diplomacy';
import { LEVERS, L } from '../src/sim/society/leaders';
import { satisfactionTerms } from '../src/sim/society/satisfaction';
import { UPRISING_HOOK } from '../src/sim/society/simulation';
import { FAITH_MUTE, FAITH_MUTE_TRAIT, FAITH_SCALE_TRAIT, MAXR, RELIGION, TRAITS, TRAIT_COUNT, installReligion, onUprising, religionOf, religionYear, removeReligion, type ReligionState } from '../src/sim/society/religion';
import { FAITH } from '../src/sim/society/faithHooks';
import { EndType } from '../src/sim/society/war';

// Outcomes of rebel wars per world, faith rebellions (F) apart from normal ones (N).
type Rw = { n: number; mother: number; indep: number; years: number; retaken: number; kept: number; peoples: number; civs: { id: number; obj: object }[] };
const newRw = (): Rw => ({ n: 0, mother: 0, indep: 0, years: 0, retaken: 0, kept: 0, peoples: 0, civs: [] });
const rw = { F: newRw(), N: newRw() };
FAITH.rebelEnd = (sim: Simulation, s: number, type: number) => {
  const w = sim.war;
  const mother = w.wAtt[s];
  const st = religionOf(sim);
  const r = st && st.faithFlag[mother] ? rw.F : rw.N;
  const won = type === EndType.Crushed || type === EndType.GaveUp;
  let cells = 0;
  const groups: number[] = [];
  for (let p = 1; p <= sim.diplomacy.maxId; p++) if (w.side[s * PAIRS + p] === 1 && w.rebelMother[p] === mother) groups.push(p);
  for (let c = 0; c < sim.world.cellCount; c++) if (sim.cellPop[c] > 0 && groups.includes(sim.world.owner[c])) cells++;
  r.n++;
  r.years += (sim.tick - w.wStart[s]) / TICKS_PER_YEAR;
  if (won) {
    r.mother++;
    r.retaken += cells;
  } else {
    r.indep++;
    r.kept += cells;
    for (const p of groups) if (sim.civs[p]) r.civs.push({ id: p, obj: sim.civs[p]! });
  }
};

type Row = Record<string, number>;
type Result = { variant: string; worlds: number; rows: Record<string, Row[]>; };

function report(files: string[]): void {
  const results: Result[] = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const years = [...new Set(results.flatMap((r) => Object.keys(r.rows)))];
  for (const y of years) {
    console.log(`\nYear ${y} (mean over ${results[0].worlds} worlds)   ${results.map((r) => r.variant.padStart(10)).join(' ')}`);
    const keys = [...new Set(results.flatMap((r) => Object.keys(r.rows[y]?.[0] ?? {})))];
    for (const k of keys) {
      const vals = results.map((r) => {
        const list = (r.rows[y] ?? []).filter((row) => k in row);
        return list.length ? list.reduce((s, row) => s + row[k], 0) / list.length : NaN;
      });
      if (vals.every((v) => Number.isNaN(v))) continue;
      console.log(`  ${k.padEnd(40)} ${vals.map((v) => (Number.isNaN(v) ? '-' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)).padStart(10)).join(' ')}`);
    }
  }
}

const args = process.argv.slice(2);
const reportArg = args.find((a) => a.startsWith('report='));
if (reportArg) {
  report(reportArg.slice(7).split(','));
  process.exit(0);
}
const outArg = args.find((a) => a.startsWith('out='));
const rest = args.filter((a) => !a.startsWith('out='));
const worlds = Number(rest[0] ?? 12);
const checkpoints = (rest[1] ?? '100,300,500').split(',').map(Number);
const variants = rest.slice(2).length ? rest.slice(2) : ['off', 'on'];
const defaults = { ...RELIGION };

// Rebellions: how many are declared and whether they are over faith (Heresy the worst term).
let rebellions = 0;
let rebelCells = 0;
let current: Simulation | null = null;
UPRISING_HOOK.fn = (sim: Simulation, cells: readonly number[], parent: number) => {
  rebellions++;
  rebelCells += cells.length;
  if (!FAITH.on) return;
  const label = (cell: number): string => {
    let worst = '';
    let worstValue = 0;
    for (const t of satisfactionTerms(sim, cell, sim.civs[parent] ?? null)) {
      if (t.value < worstValue) {
        worstValue = t.value;
        worst = t.label;
      }
    }
    return worst;
  };
  onUprising(sim, cells, parent, label);
};

function stdev(list: number[]): number {
  if (list.length < 2) return 0;
  const m = list.reduce((a, b) => a + b, 0) / list.length;
  return Math.sqrt(list.reduce((a, b) => a + (b - m) * (b - m), 0) / list.length);
}

function measure(sim: Simulation, st: ReligionState | null, year: number, overYear: number): Row {
  const w = sim.war.stats;
  const living: number[] = [];
  for (let c = 1; c < sim.civs.length; c++) if (sim.civs[c]) living.push(c);
  let settlements = 0;
  let satSum = 0;
  let neg = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (sim.cellPop[c] > 0) {
      settlements++;
      satSum += sim.satisfaction[c];
      if (sim.satisfaction[c] < 0) neg++;
    }
  }
  let traded = 0;
  for (const v of sim.trade.delivered) traded += v;
  let abroad = 0;
  for (const v of sim.trade.abroad) abroad += v;
  let freeTrade = 0;
  let open = 0;
  let pacts = 0;
  let alliances = 0;
  let pactSame = 0;
  let pactForeign = 0;
  let trustSum = 0;
  let trustN = 0;
  let faithSum = 0;
  let faithPos = 0;
  let faithNeg = 0;
  let flatSum = 0;
  let closeKin = 0;
  const dip = sim.diplomacy;
  for (const a of living) {
    for (const b of living) {
      if (a === b || !dip.known[a * PAIRS + b]) continue;
      trustSum += dip.trust[a * PAIRS + b];
      trustN++;
      if (st) {
        const f = st.trust[a * PAIRS + b];
        faithSum += f;
        if (f > 0.5) faithPos++;
        if (f < -0.5) faithNeg++;
        flatSum += st.lev[a * LEVERS + L.trust];
        if (f < -8.5) closeKin++;
      }
      if (a < b) {
        freeTrade += dip.freeTrade[a * PAIRS + b];
        if (dip.open[a * PAIRS + b] && dip.open[b * PAIRS + a]) open++;
        const p = Math.max(sim.war.pact[a * PAIRS + b], sim.war.pact[b * PAIRS + a]);
        if (p > 0) {
          if (p === 2) alliances++;
          else pacts++;
          if (st) {
            if (st.major[a] >= 0 && st.major[a] === st.major[b]) pactSame++;
            else pactForeign++;
          }
        }
      }
    }
  }
  const ended = w.ended.reduce((a: number, b: number) => a + b, 0);
  const live = { F: 0, N: 0 };
  for (let k = 0; k < 24; k++) if (sim.war.wLive[k] && sim.war.wRebel[k]) live[st && st.faithFlag[sim.war.wAtt[k]] ? 'F' : 'N']++;
  const row: Row = {
    ...Object.fromEntries((['F', 'N'] as const).flatMap((k) => [
      [`rebel wars ${k}: ended`, rw[k].n], [`rebel wars ${k}: mother won`, rw[k].mother], [`rebel wars ${k}: rebels independent`, rw[k].indep],
      [`rebel wars ${k}: running`, live[k]], [`rebel wars ${k}: mean length (years)`, rw[k].n ? rw[k].years / rw[k].n : 0],
      [`rebel wars ${k}: settlements retaken`, rw[k].retaken], [`rebel wars ${k}: settlements independent`, rw[k].kept],
      [`rebel wars ${k}: independent peoples alive now`, rw[k].civs.filter((c) => sim.civs[c.id] === c.obj).length], [`rebel wars ${k}: independent peoples founded`, rw[k].civs.length],
    ])),
    people: sim.pop.count,
    peoples: living.length,
    settlements,
    'satisfaction (mean)': satSum / Math.max(1, settlements),
    'settlements below 0 %': (100 * neg) / Math.max(1, settlements),
    'goods traded (total)': traded,
    'delivered abroad': abroad,
    'free trade pairs': freeTrade,
    'open border pairs': open,
    'pacts (now)': pacts,
    'alliances (now)': alliances,
    'pacts signed (total)': w.pactsSigned,
    'alliances signed (total)': w.alliancesSigned,
    'trust (mean, known pairs)': trustSum / Math.max(1, trustN),
    'wars declared (total)': w.declared,
    'wars running': sim.war.wars,
    'war duration (years, ended)': w.durationSum / Math.max(1, ended) / TICKS_PER_YEAR,
    'REBELLIONS (total)': w.rebDeclared,
    'rebel settlements (total)': rebelCells,
    'allies joined (total)': w.joins,
    'game over (1 = no believers)': overYear > 0 ? 1 : 0,
    'player believers': sim.believers,
    'player believers % of people': (100 * sim.believers) / Math.max(1, sim.pop.count),
    'peoples following the player': living.filter((c) => sim.civs[c]!.worshipsPlayer).length,
  };
  if (st) {
    const s = st.stats;
    let alive = 0;
    let traitsN = 0;
    const lv = [0, 0, 0];
    const present = new Array(25).fill(0);
    let full = 0;
    for (let r = 0; r < MAXR; r++) {
      if (!st.alive[r]) continue;
      alive++;
      let n = 0;
      for (let k = 0; k < 7; k++) {
        const t = st.traitId[r * 7 + k];
        if (t) {
          n++;
          lv[st.traitLvl[r * 7 + k] - 1]++;
          present[t]++;
        }
      }
      traitsN += n;
      if (st.total[r] > 0) full++;
    }
    const ages: number[] = [];
    const removed = s.lifetimes.slice().sort((a, b) => a - b);
    for (let r = 0; r < MAXR; r++) if (st.alive[r]) for (let k = 0; k < 7; k++) if (st.traitId[r * 7 + k]) ages.push(Math.floor(sim.tick / TICKS_PER_YEAR) - st.traitBorn[r * 7 + k]);
    const all = removed.concat(ages).sort((a, b) => a - b);
    const q = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
    const awakeNow = [0, 0, 0];
    for (let r = 1; r < MAXR; r++) if (st.alive[r]) for (let k = 0; k < 3; k++) awakeNow[k] += st.awakeDone[r * 3 + k];
    const warAdd: number[] = [];
    const birth: number[] = [];
    const creed: number[] = [];
    const food: number[] = [];
    const sat: number[] = [];
    for (const c of living) {
      warAdd.push(st.lev[c * LEVERS + L.warChance]);
      birth.push(st.lev[c * LEVERS + L.birth]);
      food.push(st.lev[c * LEVERS + L.food]);
      creed.push(st.creed[c]);
      sat.push(sim.leaders.sat[c]);
    }
    const range = (a: number[]) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
    Object.assign(row, {
      'RELIGIONS alive': alive,
      'religions founded: start': s.start,
      'founded: folk faith': s.folk,
      'founded: schism': s.schism,
      'merged': s.merged,
      'died': s.died,
      'life of dead (years)': (s.lifeSum) / Math.max(1, s.died + s.merged),
      'blocked by cap (tries)': s.blockedFull,
      'years with 16/16': s.yearsFull,
      'traits per religion': traitsN / Math.max(1, alive),
      'trait life removed: n': removed.length,
      'trait life removed: median': q(removed, 0.5),
      'trait life removed: p10': q(removed, 0.1),
      'trait life removed: p90': q(removed, 0.9),
      'trait life incl. alive: median': q(all, 0.5),
      'trait life incl. alive: p10': q(all, 0.1),
      'trait life incl. alive: p90': q(all, 0.9),
      'conquests with conversion': s.conquests,
      'trade visits carrying faith': s.carryVisits,
      'disaster events': s.disasters,
      'trait level 1 %': (100 * lv[0]) / Math.max(1, traitsN),
      'trait level 2 %': (100 * lv[1]) / Math.max(1, traitsN),
      'trait level 3 %': (100 * lv[2]) / Math.max(1, traitsN),
      'trait gained (total)': s.traitGain.reduce((a, b) => a + b, 0),
      'trait lost (total)': s.traitLose.reduce((a, b) => a + b, 0),
      'level ups': s.levelUp,
      'level downs': s.levelDown,
      'trait replaced': s.traitReplace,
      'peoples: war chance add std': stdev(warAdd),
      'peoples: war chance add range': range(warAdd),
      'peoples: birth lever std': stdev(birth),
      'peoples: birth lever range': range(birth),
      'peoples: food lever range': range(food),
      'peoples: Creed mean': creed.reduce((a, b) => a + b, 0) / Math.max(1, creed.length),
      'peoples: Creed max |x|': Math.max(0, ...creed.map(Math.abs)),
      'peoples: Creed range': range(creed),
      'Faith trust mean': faithSum / Math.max(1, trustN),
      'Faith trust > 0 % of pairs': (100 * faithPos) / Math.max(1, trustN),
      'Faith trust < 0 % of pairs': (100 * faithNeg) / Math.max(1, trustN),
      'Faith trust <= -8.5 (kin/hostile) %': (100 * closeKin) / Math.max(1, trustN),
      'flat trait trust (lever, mean)': flatSum / Math.max(1, trustN),
      'pacts+alliances same faith': pactSame,
      'pacts+alliances other faith': pactForeign,
      'player religion: schisms': s.schismsOf0,
      'player religion: max tension': s.maxTension0,
      'schisms (total)': s.schism,
      'heresy starts': s.heresyStarts,
      'schism: settlements of the seceding people': s.schismSettlements / Math.max(1, s.schism),
      'schism: seceding people has >= 2 settlements %': (100 * s.schismMulti) / Math.max(1, s.schism),
      'faith rebellions (Heresy worst)': s.faithRebellions,
      'schisms leading to a rebellion %': (100 * s.schismRebels) / Math.max(1, s.schism),
      'faith rebellion joins: rebels': s.faithJoinsRebel,
      'faith rebellion joins: mother': s.faithJoinsMother,
      'HOLY WARS': s.holyWars,
      'holy wars % of wars': (100 * s.holyWars) / Math.max(1, s.wars),
      'holy war joins': s.holyJoins,
      'holy war length (years, ended)': s.holyYears / Math.max(1, s.holyEnded),
      'longest holy war (years)': s.holyLongest,
      'longest war seen (years)': s.maxWarAge,
      'would awaken >=100/15y': s.awake100,
      'would awaken >=150/15y': s.awake150,
      'would awaken >=300/15y': s.awake300,
      'awake now (alive) >=100': awakeNow[0],
      'awake now (alive) >=150': awakeNow[1],
      'awake now (alive) >=300': awakeNow[2],
      'religions with believers': full,
    });
    for (let t = 1; t <= TRAIT_COUNT; t++) row[`trait ${String(t).padStart(2)} ${TRAITS[t].name}`] = present[t];
    for (let t = 1; t <= TRAIT_COUNT; t++) row[`  gained ${String(t).padStart(2)} ${TRAITS[t].name}`] = s.traitGain[t];
  }
  void year;
  return row;
}

for (const variant of variants) {
  const [name, spec] = variant.split(':');
  Object.assign(RELIGION, defaults);
  FAITH_MUTE.fill(0);
  FAITH_MUTE_TRAIT.fill(0);
  FAITH_SCALE_TRAIT.fill(1);
  if (spec) for (const kv of spec.split(',')) {
    const [k, v] = kv.split('=');
    if (k === 'halve') {
      for (const t of v.split('+')) FAITH_SCALE_TRAIT[Number(t)] = 0.5;
      continue;
    }
    if (k === 'muteTrait') {
      for (const t of v.split('+')) FAITH_MUTE_TRAIT[Number(t)] = 1;
      continue;
    }
    if (k === 'mute') {
      for (const lever of v.split('+')) FAITH_MUTE[(L as Record<string, number>)[lever]] = 1;
      continue;
    }
    if (!(k in RELIGION)) throw new Error(`unknown RELIGION key ${k}`);
    (RELIGION as Record<string, number>)[k] = Number(v);
  }
  const on = name !== 'off';
  const rows: Record<string, Row[]> = {};
  const series: number[][] = [];
  const t0 = Date.now();
  for (let seed = 1; seed <= worlds; seed++) {
    const sim = createSimulation(generateWorld({ seed }));
    current = sim;
    rebellions = 0;
    rebelCells = 0;
    rw.F = newRw();
    rw.N = newRw();
    const st = on ? installReligion(sim) : null;
    let overYear = 0;
    const line: number[] = [];
    for (const year of checkpoints) {
      while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) {
        stepSimulation(sim);
        if (st && sim.tick % TICKS_PER_YEAR === 0) {
          religionYear(sim);
          if (sim.tick % (50 * TICKS_PER_YEAR) === 0) line.push(sim.believers);
        } else if (!st && sim.tick % (50 * TICKS_PER_YEAR) === 0) line.push(sim.believers);
      }
      if (sim.gameOver && overYear === 0) overYear = Math.floor(sim.tick / TICKS_PER_YEAR);
      (rows[year] ??= []).push(measure(sim, st, year, overYear));
    }
    series.push(line);
    if (st) removeReligion();
    process.stderr.write(`${name} seed ${seed} done${overYear ? ` (game over year ${overYear})` : ''} ${(Date.now() - t0) / 1000}s\n`);
  }
  void religionOf;
  void current;
  const result: Result = { variant: name, worlds, rows };
  console.log(`\n== ${variant}: ${worlds} worlds, ${(Date.now() - t0) / 1000} s`);
  const last = rows[checkpoints[checkpoints.length - 1]];
  const mean = (k: string) => last.reduce((s, r) => s + (r[k] ?? 0), 0) / last.length;
  console.log(`year ${checkpoints[checkpoints.length - 1]}: people ${mean('people').toFixed(0)}, settlements ${mean('settlements').toFixed(0)}, wars ${mean('wars declared (total)').toFixed(1)}, rebellions ${mean('REBELLIONS (total)').toFixed(2)}, game over ${mean('game over (1 = no believers)').toFixed(2)}`);
  console.log(`player believers every 50 years (mean, ended worlds count as 0): ${[...Array(Math.floor(checkpoints[checkpoints.length - 1] / 50)).keys()].map((i) => Math.round(series.reduce((s, l) => s + (l[i] ?? 0), 0) / series.length)).join(' ')}`);
  if (outArg) writeFileSync(outArg.slice(4).replace(/\.json$/, `-${name}.json`), JSON.stringify(result));
}

// Religion and Mandate (Design Documents/Requirement Religion.md, Requirement Mandat.md) over many worlds: the game
// as it runs (religions, traits, schisms and their contagion, the leaders' faith, holy wars, Faith in trust;
// loyalty, countdowns, independence, vassals), with variants over the numbers.
// Usage: npx tsx tools/religionStats.ts [worlds=12] [years=100,300,500] [variant ...] [out=file.json]
//        npx tsx tools/religionStats.ts report=a.json,b.json   (side by side)
//   A variant is "name:key=value,key=value" over RELIGION (religion.ts) or, with "mandate.", MANDATE (mandate.ts),
//   e.g. "game" (the numbers as they are), "weakfaith:mandate.faithWeight=30", "nofolk:foundChance=0".
//   Default variant: game. Same seeds in every variant; the religions draw from "faith", the Mandate from "mandate".
// Prints per checkpoint year: growth, population, trade, diplomacy, wars (holy share), rebellions; the religions
// (alive, founding paths, traits, levels), schisms and their ends, the player's faith; the Mandate's countdowns,
// outcomes, vassals and loyalty. The keys match the prototype's report (the "ab" set) for a direct comparison.
import { writeFileSync, readFileSync } from 'node:fs';
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation, type Simulation } from '../src/sim';
import { PAIRS } from '../src/sim/society/diplomacy';
import { LEVERS, L } from '../src/sim/society/leaders';
import { MAXR, RELIGION, SLOTS, TRAITS, TRAIT_COUNT } from '../src/sim/society/religion';
import { BLOCS, MANDATE } from '../src/sim/society/mandate';

type Row = Record<string, number>;
type Result = { variant: string; worlds: number; rows: Record<string, Row[]> };

function report(files: string[]): void {
  const results: Result[] = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const years = [...new Set(results.flatMap((r) => Object.keys(r.rows)))];
  for (const y of years) {
    console.log(`\nYear ${y} (mean over ${results[0].worlds} worlds)   ${results.map((r) => r.variant.slice(0, 10).padStart(10)).join(' ')}`);
    const keys = [...new Set(results.flatMap((r) => Object.keys(r.rows[y]?.[0] ?? {})))];
    for (const k of keys) {
      const vals = results.map((r) => {
        const list = (r.rows[y] ?? []).filter((row) => k in row);
        return list.length ? list.reduce((s, row) => s + row[k], 0) / list.length : NaN;
      });
      if (vals.every((v) => Number.isNaN(v))) continue;
      console.log(`  ${k.padEnd(48)} ${vals.map((v) => (Number.isNaN(v) ? '-' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)).padStart(10)).join(' ')}`);
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
const variants = rest.slice(2).length ? rest.slice(2) : ['game'];
const religionDefaults = { ...RELIGION };
const mandateDefaults = { ...MANDATE };

function measure(sim: Simulation, overYear: number): Row {
  const w = sim.war.stats;
  const st = sim.religion;
  const md = sim.mandate;
  const living: number[] = [];
  for (let c = 1; c < sim.civs.length; c++) if (sim.civs[c]) living.push(c);
  let settlements = 0;
  let satSum = 0;
  let neg = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (sim.cellPop[c] === 0) continue;
    settlements++;
    satSum += sim.satisfaction[c];
    if (sim.satisfaction[c] < 0) neg++;
  }
  let traded = 0;
  for (const v of sim.trade.delivered) traded += v;
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
  const dip = sim.diplomacy;
  for (const a of living) {
    for (const b of living) {
      if (a === b || !dip.known[a * PAIRS + b]) continue;
      trustSum += dip.trust[a * PAIRS + b];
      trustN++;
      const f = st.trust[a * PAIRS + b];
      faithSum += f;
      if (f > 0.5) faithPos++;
      if (f < -0.5) faithNeg++;
      if (a < b) {
        freeTrade += dip.freeTrade[a * PAIRS + b];
        if (dip.open[a * PAIRS + b] && dip.open[b * PAIRS + a]) open++;
        const p = Math.max(sim.war.pact[a * PAIRS + b], sim.war.pact[b * PAIRS + a]);
        if (p > 0) {
          if (p === 2) alliances++;
          else pacts++;
          if (st.major[a] >= 0 && st.major[a] === st.major[b]) pactSame++;
          else pactForeign++;
        }
      }
    }
  }
  const s = st.stats;
  let alive = 0;
  let traitsN = 0;
  const lv = [0, 0, 0];
  const present = new Array(TRAIT_COUNT + 1).fill(0);
  let daughtersAlive = 0;
  for (let r = 0; r < MAXR; r++) {
    if (!st.alive[r]) continue;
    alive++;
    if (st.parent[r] >= 0 && st.wonBy[r] === 0) daughtersAlive++;
    for (let k = 0; k < SLOTS; k++) {
      const t = st.traitId[r * SLOTS + k];
      if (!t) continue;
      traitsN++;
      lv[st.traitLvl[r * SLOTS + k] - 1]++;
      present[t]++;
    }
  }
  const creed: number[] = [];
  const warAdd: number[] = [];
  for (const c of living) {
    creed.push(st.creed[c]);
    warAdd.push(st.lev[c * LEVERS + L.warChance]);
  }
  const range = (a: number[]) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
  let loySum = 0;
  let loyN = 0;
  let restless = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (md.loyalty[c] < 0 || sim.cellPop[c] === 0 || sim.civs[sim.world.owner[c]]?.capital === c) continue;
    loySum += md.loyalty[c];
    loyN++;
    restless += md.restless[c];
  }
  let running = 0;
  for (let k = 0; k < BLOCS; k++) running += md.blocActive[k];
  let vassals = 0;
  for (const c of living) if (md.vassalOf[c] >= 0) vassals++;
  const ms = md.stats;
  const ends = ms.independence + ms.autonomy + ms.reconcile + ms.dissolved;
  const row: Row = {
    people: sim.pop.count,
    peoples: living.length,
    settlements,
    'satisfaction (mean)': satSum / Math.max(1, settlements),
    'settlements below 0 %': (100 * neg) / Math.max(1, settlements),
    'goods traded (total)': traded,
    'free trade pairs': freeTrade,
    'open border pairs': open,
    'pacts (now)': pacts,
    'alliances (now)': alliances,
    'pacts signed (total)': w.pactsSigned,
    'alliances signed (total)': w.alliancesSigned,
    'trust (mean, known pairs)': trustSum / Math.max(1, trustN),
    'wars declared (total)': w.declared,
    'wars running': sim.war.wars,
    'REBELLIONS (total)': w.rebDeclared,
    'allies joined (total)': w.joins,
    'game over (1 = no believers)': overYear > 0 ? 1 : 0,
    'player believers': sim.believers,
    'player believers % of people': (100 * sim.believers) / Math.max(1, sim.pop.count),
    'peoples following the player': living.filter((c) => sim.civs[c]!.worshipsPlayer).length,
    'RELIGIONS alive': alive,
    'religions founded: start': s.start,
    'founded: folk faith': s.folk,
    'founded: schism': s.schism,
    merged: s.merged,
    died: s.died,
    'life of dead (years)': s.lifeSum / Math.max(1, s.died + s.merged),
    'blocked by cap (tries)': s.blockedFull,
    'years with 16/16': s.yearsFull,
    'traits per religion': traitsN / Math.max(1, alive),
    'trait level 1 %': (100 * lv[0]) / Math.max(1, traitsN),
    'trait level 2 %': (100 * lv[1]) / Math.max(1, traitsN),
    'trait level 3 %': (100 * lv[2]) / Math.max(1, traitsN),
    'trait gained (total)': s.traitGain.reduce((a, b) => a + b, 0),
    'trait lost (total)': s.traitLose.reduce((a, b) => a + b, 0),
    'level ups': s.levelUp,
    'level downs': s.levelDown,
    'trait replaced': s.traitReplace,
    'peoples: war chance add range': range(warAdd),
    'peoples: Creed mean': creed.reduce((a, b) => a + b, 0) / Math.max(1, creed.length),
    'peoples: Creed max |x|': Math.max(0, ...creed.map(Math.abs)),
    'Faith trust mean': faithSum / Math.max(1, trustN),
    'Faith trust > 0 % of pairs': (100 * faithPos) / Math.max(1, trustN),
    'Faith trust < 0 % of pairs': (100 * faithNeg) / Math.max(1, trustN),
    'pacts+alliances same faith': pactSame,
    'pacts+alliances other faith': pactForeign,
    'conquests with conversion': s.conquests,
    'trade visits carrying faith': s.carryVisits,
    'disaster events': s.disasters,
    'player religion: schisms': s.schismsOf0,
    'player religion: max tension': s.maxTension0,
    'schisms (total)': s.schism,
    'heresies: seeded believers (mean)': s.seeded / Math.max(1, s.schism),
    'heresies: died': s.dDied,
    'heresies: merged back': s.dMerged,
    'heresies: won by succession': s.dWon[1],
    'heresies: won by conversion': s.dWon[2],
    'heresies: won by rebellion': s.dWon[3],
    'heresies: alive now (not won)': daughtersAlive,
    'faith rebellions (Heresy worst)': s.faithRebellions,
    'schisms leading to a rebellion %': (100 * s.schismRebels) / Math.max(1, s.schism),
    'schisms leading to a vassal %': (100 * s.schismVassals) / Math.max(1, s.schism),
    'faith rebellion joins: rebels': s.faithJoinsRebel,
    'faith rebellion joins: mother': s.faithJoinsMother,
    'HOLY WARS': s.holyWars,
    'holy wars % of wars': (100 * s.holyWars) / Math.max(1, s.wars),
    'holy war joins': s.holyJoins,
    'holy wars lost': s.holyLost,
    'MANDATE loyalty mean': loyN ? loySum / loyN : 0,
    'loyalty: restless share %': loyN ? (100 * restless) / loyN : 0,
    'restless settlements': restless,
    'countdowns running': running,
    'countdowns started': ms.countdowns,
    'countdowns over faith': ms.faithCountdowns,
    'outcome: independence': ms.independence,
    'outcome: autonomy (vassal)': ms.autonomy,
    'outcome: reconciliation': ms.reconcile,
    'outcome: bloc dissolved': ms.dissolved,
    'outcome: rebellion failed to start': ms.failedStart,
    'reconciliation % of outcomes': (100 * (ms.reconcile + ms.dissolved)) / Math.max(1, ends),
    'countdown length (mean years, ended)': ms.countdownYears / Math.max(1, ends),
    'independence over faith': ms.faithIndependence,
    agitations: ms.agitations,
    'state faith changes: succession': s.stateSucc,
    'state faith changes: conversion in office': s.stateConv,
    'state faith changes: faith died': s.stateDeath,
    'state faith changed to a daughter': s.stateToDaughter,
    'VASSALS now': vassals,
    'vassals made': ms.vassalsMade,
    'vassal ends: independence peaceful': ms.vassalIndepPeace,
    'vassal ends: independence by war': ms.vassalIndepWar,
    'vassal ends: re-integrated': ms.vassalReintegrated,
    'vassal ends: mother gone': ms.vassalFreed,
    'tribute paid (money, total)': ms.tribute,
  };
  for (let t = 1; t <= TRAIT_COUNT; t++) row[`trait ${String(t).padStart(2)} ${TRAITS[t].name}`] = present[t];
  return row;
}

for (const variant of variants) {
  const [name, spec] = variant.split(':');
  Object.assign(RELIGION, religionDefaults);
  Object.assign(MANDATE, mandateDefaults);
  if (spec) for (const kv of spec.split(',')) {
    const [k, v] = kv.split('=');
    if (k.startsWith('mandate.')) {
      const key = k.slice(8);
      if (!(key in MANDATE)) throw new Error(`unknown MANDATE key ${key}`);
      (MANDATE as Record<string, number>)[key] = Number(v);
    } else {
      if (!(k in RELIGION)) throw new Error(`unknown RELIGION key ${k}`);
      (RELIGION as Record<string, number>)[k] = Number(v);
    }
  }
  const rows: Record<string, Row[]> = {};
  const series: number[][] = [];
  const t0 = Date.now();
  for (let seed = 1; seed <= worlds; seed++) {
    const sim = createSimulation(generateWorld({ seed }));
    let overYear = 0;
    const line: number[] = [];
    for (const year of checkpoints) {
      while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) {
        stepSimulation(sim);
        if (sim.tick % (50 * TICKS_PER_YEAR) === 0) line.push(sim.believers);
      }
      if (sim.gameOver && overYear === 0) overYear = Math.floor(sim.tick / TICKS_PER_YEAR);
      (rows[year] ??= []).push(measure(sim, overYear));
    }
    series.push(line);
    process.stderr.write(`${name} seed ${seed} done${overYear ? ` (game over year ${overYear})` : ''} ${(Date.now() - t0) / 1000}s\n`);
  }
  const result: Result = { variant: name, worlds, rows };
  console.log(`\n== ${variant}: ${worlds} worlds, ${(Date.now() - t0) / 1000} s`);
  const last = rows[checkpoints[checkpoints.length - 1]];
  const mean = (k: string) => last.reduce((s, r) => s + (r[k] ?? 0), 0) / last.length;
  console.log(`year ${checkpoints[checkpoints.length - 1]}: people ${mean('people').toFixed(0)}, peoples ${mean('peoples').toFixed(1)}, settlements ${mean('settlements').toFixed(0)}, wars ${mean('wars declared (total)').toFixed(1)}, alliances ${mean('alliances signed (total)').toFixed(1)}, rebellions ${mean('REBELLIONS (total)').toFixed(2)}, schisms ${mean('schisms (total)').toFixed(2)} (to a rebellion ${mean('schisms leading to a rebellion %').toFixed(1)} %), game over ${mean('game over (1 = no believers)').toFixed(2)}`);
  console.log(`player believers every 50 years (mean, ended worlds count as 0): ${[...Array(Math.floor(checkpoints[checkpoints.length - 1] / 50)).keys()].map((i) => Math.round(series.reduce((s, l) => s + (l[i] ?? 0), 0) / series.length)).join(' ')}`);
  if (outArg) writeFileSync(outArg.slice(4).replace(/\.json$/, `-${name}.json`), JSON.stringify(result));
}

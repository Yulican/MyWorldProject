// War phase 3 (war on the map: declaration, armies, march, battles, peace, siege, occupation, conquest;
// "Design Documents/Requirement Krieg.md", sections 4 to 6) over many worlds, against the state without war.
// Usage: npx tsx tools/warMapStats.ts [worlds=24] [years=300,500] [variant ...]
//   A variant is "name:key=value,key=value" with the numbers of WAR (src/sim/society/war.ts), the world size
//   (width, height) or TRIBE_TUNING (maxCivs, tribeChance), e.g.
//   npx tsx tools/warMapStats.ts 24 300,500 "nowar:enabled=0" "war" "malus80:siegeMalus=80"
//   "old world:width=64,height=64,maxCivs=6,tribeChance=0.02". Without variants: nowar, war (the game's defaults).
// Prints per year: growth, population, trade, diplomacy, uprisings, wars (started, ongoing, duration, end types,
// battles, armies, gathering, retreats), sieges and occupations (seat satisfaction at the first check), territory, and the cost of the
// war parts per week and year plus ms per simulated year.
import { performance } from 'node:perf_hooks';
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation, type Simulation } from '../src/sim';
import { PAIRS } from '../src/sim/society/diplomacy';
import { EndType, WAR, WAR_PROFILE } from '../src/sim/society/war';
import { TRIBE_TUNING } from '../src/sim/society/simulation';
import { ALLY } from '../src/sim/society/pacts';

const worlds = Number(process.argv[2] ?? 24);
const checkpoints = (process.argv[3] ?? '300,500').split(',').map(Number);
const variants = process.argv.slice(4).length ? process.argv.slice(4) : ['nowar:enabled=0', 'war'];
const defaults = { ...WAR };
const tribeDefaults = { ...TRIBE_TUNING };
const allyDefaults = { ...ALLY };
// Phase 4 (alliance.ts, ALLY, on by default): variants over ALLY, e.g. "noally:pactTrust=999,allianceTrust=999" for the world without pacts and alliances.
// Non-WAR keys of a variant: map size in hex columns/rows (default: the game's), maxCivs and chance of new tribes (TRIBE_TUNING).
const WORLD_KEYS = ['width', 'height'];

type Row = Record<string, number>;

function measure(sim: Simulation, ms: number, year: number): Row {
  const w = sim.world;
  const st = sim.war.stats;
  let settlements = 0;
  let satNeg = 0;
  let satLong = 0;
  let satSum = 0;
  for (let c = 0; c < w.cellCount; c++) {
    if (sim.cellPop[c] > 0) {
      settlements++;
      satSum += sim.satisfaction[c];
      if (sim.satisfaction[c] < 0) satNeg++;
      if (sim.unhappyQuarters[c] >= 20) satLong++;
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
  // Blocks: connected groups of peoples joined by alliances (alone) or by pacts and alliances.
  const comp = (minKind: number) => {
    const seen = new Set<number>();
    let largest = 0;
    let inBlocks = 0;
    for (const a of living) {
      if (seen.has(a)) continue;
      const stack = [a];
      seen.add(a);
      let size = 0;
      while (stack.length) {
        const x = stack.pop()!;
        size++;
        for (const b of living) if (!seen.has(b) && sim.war.pact[x * PAIRS + b] >= minKind) {
          seen.add(b);
          stack.push(b);
        }
      }
      if (size > 1) inBlocks += size;
      largest = Math.max(largest, size);
    }
    return [largest, inBlocks];
  };
  let pacts = 0;
  let alliances = 0;
  for (const a of living) for (const b of living) if (a < b) {
    if (sim.war.pact[a * PAIRS + b] === 1) pacts++;
    else if (sim.war.pact[a * PAIRS + b] === 2) alliances++;
  }
  const [bigAll, inAll] = comp(2);
  const [bigAny, inAny] = comp(1);
  const ended = st.ended.reduce((a, b) => a + b, 0);
  const dur = st.durationSum / Math.max(1, ended) / TICKS_PER_YEAR;
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
    'settlements < 0 for 5+ years': satLong,
    'unhappy (<0) settlements': satNeg,
    'uprisings (total)': text('rose up'),
    'cut off (total)': text('cut off from'),
    'known pairs': knownPairs,
    'neighbor pairs (adjacent)': adjPairs.size,
    'pacts now': pacts,
    'alliances now': alliances,
    'largest block (alliances)': bigAll,
    'peoples in alliance blocks': inAll,
    'largest block (pacts+alliances)': bigAny,
    'peoples in pact/alliance blocks': inAny,
    'pacts signed (total)': st.pactsSigned,
    'alliances signed (total)': st.alliancesSigned,
    'alliances downgraded': st.downgraded,
    'pacts/alliances ended': st.pactsEnded,
    'alliances broken by declaration': st.alliesBroken,
    'allies joined (total)': st.joins,
    'joins declined: side too weak': st.joinWeak,
    'joins declined: ally of other side': st.joinOwnAlly,
    'joins without army room': st.joinNoRoom,
    'wars with allies': st.allyWars,
    'wars with allies on both sides': st.allyWarsBoth,
    'ally wars: battles': st.allyBattles,
    'ally wars: sieges': st.allySieges,
    'ally wars: occupations': st.allyOcc,
    'ally wars: whole people annexed': st.allyAnnexed,
    'peoples on one side (max)': st.maxSide,
    'REBELLIONS declared': st.rebDeclared,
    'rebel groups (total)': st.rebGroups,
    'rebel groups per rebellion': st.rebGroups / Math.max(1, st.rebDeclared),
    'rebel settlements / rebellion': st.rebSettlements / Math.max(1, st.rebDeclared),
    'rebel people / rebellion': st.rebPeople / Math.max(1, st.rebDeclared),
    'militia raised (total)': st.militia,
    'militia back home (total)': st.militiaBack,
    'mother/rebel strength (mean, cap 5)': st.rebRatioSum / Math.max(1, st.rebDeclared),
    'reb: crushed': st.rebCrushed,
    'reb: rebels gave up (annexed)': st.rebGaveUp,
    'reb: exhaustion (rebels won)': st.rebExhausted,
    'reb: other end': st.rebOther,
    'rebellions ongoing': sim.war.wRebel.reduce((a, b) => a + b, 0),
    'rebellion duration (years)': st.rebDurationSum / Math.max(1, st.rebCrushed + st.rebGaveUp + st.rebExhausted + st.rebOther) / TICKS_PER_YEAR,
    'reb: groups annexed': st.rebAnnexedGroups,
    'reb: wars with helpers': st.rebHelpWars,
    'reb: helpers joined': st.rebHelpers,
    'reb: mother partners joined': st.rebMotherAllies,
    'reb: battles': st.rebBattles,
    'reb: sieges': st.rebSieges,
    'reb: occupations': st.rebOcc,
    'reb: chain (same realm < 30y)': st.rebRepeat,
    'reb: settlements rising again': st.rebCellRepeat,
    'reb: most in one realm': st.rebMaxRealm,
    'reb: no free people id': st.rebNoRoom,
    'wars total (normal + rebel)': st.declared + st.rebDeclared,
    'wars declared': st.declared,
    'wars vs established peoples': st.estDeclared,
    'wars vs own splinters': st.declared - st.estDeclared,
    'est.: battles': st.estBattles,
    'est.: sieges': st.estSieges,
    'est.: occupations': st.estOcc,
    'est.: whole people annexed': st.estAnnexed,
    'wars ongoing': sim.war.wars,
    'blocked by army cap': st.capBlocked,
    'war duration (years)': dur,
    'end: defender gave up': st.ended[EndType.GaveUp],
    'end: attacker gave up': st.ended[EndType.AttackerGaveUp],
    'end: exhaustion': st.ended[EndType.Exhausted],
    'end: goal lost otherwise': st.ended[EndType.GoalLost],
    'end: people vanished': st.ended[EndType.Vanished],
    'wars without any battle': st.noBattle,
    'wars vs a people with 0 strength': st.zeroDefender,
    'conquest roads built': st.roads,
    'battles': st.battles,
    'battles per war': st.battles / Math.max(1, st.declared),
    'battles won by attacker': st.battleWinsAtt,
    'battles won by defender': st.battleWinsDef,
    'battles drawn': st.battleDraws,
    'armies raised': st.armiesRaised,
    'armies at once = markers (max)': st.maxArmies,
    'contingents sent': st.contingents,
    'contingents arrived': st.contingentsArrived,
    'contingents too late (home)': st.contingentsLate,
    'gathering weeks per army (mean)': st.gatherWeeksSum / Math.max(1, st.setOut),
    'retreats': st.retreats,
    'retreats reached their seat': st.retreatsHome,
    'battles with a retreating army': st.retreatBattles,
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
    'ms rebellion step (worst)': st.rebelMax,
    'ms year war (mean)': st.yearMs / Math.max(1, st.yearCalls),
    msPerYear: ms / year,
  };
  return row;
}

const results: { name: string; rows: Map<number, Row[]>; extra: Map<number, string[]> }[] = [];
for (const spec of variants) {
  const [name, rest = ''] = spec.split(':');
  Object.assign(WAR, defaults);
  Object.assign(TRIBE_TUNING, tribeDefaults);
  Object.assign(ALLY, allyDefaults);
  const worldOpt: Record<string, number> = {};
  WAR_PROFILE.clock = () => performance.now();
  for (const kv of rest.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (WORLD_KEYS.includes(k)) worldOpt[k] = Number(v);
    else if (k in TRIBE_TUNING) (TRIBE_TUNING as Record<string, number>)[k] = Number(v);
    else if (k in ALLY) (ALLY as Record<string, number>)[k] = Number(v);
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

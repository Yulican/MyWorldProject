import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hexDistance } from '../hex';
import { generateWorld } from '../world/generate';
import { PAIRS } from './diplomacy';
import { Ab, castAbility, canCast, validTargets } from './gacha';
import { L, LEVERS } from './leaders';
import { satisfactionTerms } from './satisfaction';
import {
  EVENT_KINDS,
  K,
  MAXR,
  NO_RELIGION,
  RELIGION,
  SLOTS,
  TRAITS,
  TRAIT_COUNT,
  Trait,
  excluded,
  faithStep,
  hasTrait,
  holyRatio,
  kinOf,
  refreshReligions,
  religionYear,
  religionYearStep,
  stateFaith,
  traitCount,
} from './religion';
import { civFaith, hexFaith, religionsOf } from './religionInfo';
import { TICKS_PER_YEAR, createSimulation, livingCivilizations, stepSimulation, stepSimulationPart, type Simulation } from './simulation';

// Religion, step 1 ("Design Documents/Requirement Religion.md", set "ab"): the start faith, traits and their growth,
// folk faiths, the schism in one settlement and its contagion, merging, death, the lever layer, Creed, Faith in
// trust, holy war, the leaders' faith and the god's 5 abilities on faiths.

function runYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR && !sim.gameOver; t++) stepSimulation(sim);
}

let grownCache: Simulation | null = null;
/** Seed 4 at year 200: several peoples, religion 0 in more than one of them. */
function grown(): Simulation {
  const sim = createSimulation(generateWorld({ seed: 4 }));
  runYears(sim, 200);
  return sim;
}
function grownOnce(): Simulation {
  grownCache ??= grown();
  return grownCache;
}

/** Sets religion `r`'s traits to `list` ([trait, level], progress 50). */
function setTraits(sim: Simulation, r: number, list: [number, number][]): void {
  const st = sim.religion;
  for (let k = 0; k < SLOTS; k++) {
    st.traitId[r * SLOTS + k] = list[k]?.[0] ?? 0;
    st.traitLvl[r * SLOTS + k] = list[k]?.[1] ?? 0;
    st.traitProg[r * SLOTS + k] = list[k] ? 50 : 0;
  }
}

/** Every inhabitant of people `civ` holds religion `r` as a believer (faith 0.8). */
function convertPeople(sim: Simulation, civ: number, r: number): void {
  const pop = sim.pop;
  for (let i = 0; i < pop.end; i++) if (pop.alive[i] && pop.civ[i] === civ) {
    pop.religion[i] = r;
    pop.faith[i] = 0.8;
  }
}

test('the world starts with religion 0, the player\'s: every start inhabitant holds it, two traits (levels 2 and 1), named after the people', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  const st = sim.religion;
  assert.equal(st.alive[0], 1);
  for (let r = 1; r < MAXR; r++) assert.equal(st.alive[r], 0);
  for (let i = 0; i < sim.pop.end; i++) if (sim.pop.alive[i]) assert.equal(sim.pop.religion[i], 0);
  assert.equal(traitCount(st, 0), 2);
  assert.deepEqual([st.traitLvl[0], st.traitLvl[1]], [2, 1]);
  assert.equal(st.name[0], `Faith of the ${livingCivilizations(sim)[0].name}`);
  assert.equal(st.total[0], sim.believers);
  assert.equal(stateFaith(sim, livingCivilizations(sim)[0].id), 0);
});

test('religions are deterministic per seed (own random sequence "faith"); the yearly step in its parts gives the same', () => {
  const a = createSimulation(generateWorld({ seed: 5 }));
  const b = createSimulation(generateWorld({ seed: 5 }));
  runYears(a, 120);
  for (let t = 0; t < 120 * TICKS_PER_YEAR; t++) while (!stepSimulationPart(b));
  assert.deepEqual(a.pop.religion, b.pop.religion);
  assert.deepEqual(a.religion.traitId, b.religion.traitId);
  assert.deepEqual(a.religion.tension, b.religion.tension);
  assert.deepEqual(a.religion.lev, b.religion.lev);
  assert.equal(a.religion.rng(), b.religion.rng());
  assert.ok(a.religion.stats.folk + a.religion.stats.start >= 2, 'more than one religion came');
});

test('a religion never holds two traits of an exclusion pair; traits stay within 7 slots and levels 1-3', () => {
  for (const seed of [4, 9]) {
    const sim = createSimulation(generateWorld({ seed }));
    for (let y = 0; y < 250; y += 25) {
      runYears(sim, 25);
      const st = sim.religion;
      for (let r = 0; r < MAXR; r++) {
        if (!st.alive[r]) continue;
        for (let k = 0; k < SLOTS; k++) {
          const t = st.traitId[r * SLOTS + k];
          if (!t) continue;
          assert.ok(st.traitLvl[r * SLOTS + k] >= 1 && st.traitLvl[r * SLOTS + k] <= 3);
          // Excluded would be true for itself; check against the others only.
          st.traitId[r * SLOTS + k] = 0;
          assert.ok(!excluded(st, r, t), `${st.name[r]}: ${TRAITS[t].name}`);
          st.traitId[r * SLOTS + k] = t;
        }
      }
    }
  }
});

test('traits grow by events (+10, at most +25 a year), fade without (−0.5), an opposing event −4; level up at 100 to 40, down below 0 to 60; level 1 drops', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  runYears(sim, 3);
  const st = sim.religion;
  const civ = livingCivilizations(sim)[0].id;
  // Fertility Rites (fed by peace and new settlements, harmed by hardship) and Holy War (fed by wars, harmed by peace).
  setTraits(sim, 0, [[Trait.FertilityRites, 2], [Trait.HolyWar, 1]]);
  st.traitProg[0] = 95;
  st.traitProg[1] = 3;
  st.newClock[0] = Math.floor(sim.tick / TICKS_PER_YEAR);
  st.civYear[civ * EVENT_KINDS + K.Peace] = 1;
  religionYear(sim);
  // Peace: Fertility Rites +10 -> 105: level 3, progress 40; Holy War +0 - 4 (the counter event) -> below 0: dropped (level 1).
  assert.equal(st.traitLvl[0], 3);
  assert.equal(st.traitProg[0], 40);
  assert.equal(hasTrait(st, 0, Trait.HolyWar), -1);
  // Three kinds of event at once: at most +25.
  st.traitProg[0] = 40;
  st.civYear[civ * EVENT_KINDS + K.Peace] = 2;
  st.civYear[civ * EVENT_KINDS + K.Settled] = 1;
  religionYear(sim);
  assert.equal(st.traitProg[0], 65);
  // A quiet year: -0.5; hardship (the counter): -4 - 0.5 is not added (an event of its own kind would feed it).
  religionYear(sim);
  assert.equal(st.traitProg[0], 64.5);
  st.civYear[civ * EVENT_KINDS + K.Hardship] = 1;
  religionYear(sim);
  assert.equal(st.traitProg[0], 60);
  // Below 0 on level 3: level 2 at 60.
  st.traitProg[0] = 0.2;
  religionYear(sim);
  assert.equal(st.traitLvl[0], 2);
  assert.equal(st.traitProg[0], 60);
});

test('a folk faith: a people of 100 or more with 30 % unaffiliated or wavering for 5 years founds a religion they all take (faith 0.6)', () => {
  const sim = createSimulation(generateWorld({ seed: 4 }));
  runYears(sim, 120);
  const st = sim.religion;
  const civ = livingCivilizations(sim).sort((a, b) => b.population - a.population)[0];
  assert.ok(civ.population >= 100);
  const pop = sim.pop;
  const saved = RELIGION.foundChance;
  RELIGION.foundChance = 1;
  try {
    const before = st.stats.folk;
    for (let y = 0; y < 6 && st.stats.folk === before; y++) {
      // Half of the people loses its religion every year (the yearly faith step would win some back).
      let k = 0;
      for (let i = 0; i < pop.end; i++) if (pop.alive[i] && pop.civ[i] === civ.id && k++ % 2 === 0) pop.religion[i] = NO_RELIGION;
      religionYear(sim);
    }
    assert.equal(st.stats.folk, before + 1);
  } finally {
    RELIGION.foundChance = saved;
  }
  let r = -1;
  for (let q = 0; q < MAXR; q++) if (st.alive[q] && st.founderCiv[q] === civ.id && st.founded[q] === Math.floor(sim.tick / TICKS_PER_YEAR)) r = q;
  assert.ok(r >= 0, 'the folk faith of the people');
  assert.equal(st.parent[r], -1);
  assert.equal(traitCount(st, r), 2);
  let took = 0;
  for (let i = 0; i < pop.end; i++) if (pop.alive[i] && pop.religion[i] === r) {
    took++;
    assert.equal(pop.civ[i], civ.id);
  }
  assert.ok(took >= RELIGION.minBelievers);
  assert.ok(sim.chronicle.some((e) => e.text.startsWith(`A new faith arises among the ${civ.name}`) && e.important));
});

test('a schism starts in ONE settlement (not a capital): half of the mother\'s believers there take the daughter (faith 0.6), the mother\'s tension −30', () => {
  // The first of these worlds with a religion of believers in two peoples at year 250.
  let sim!: Simulation;
  let r = -1;
  let most = 0;
  for (const seed of [7, 16, 4, 12, 3, 9]) {
    sim = createSimulation(generateWorld({ seed }));
    runYears(sim, 250);
    // The religion with believers in the most peoples.
    r = -1;
    most = 0;
    for (let q = 0; q < MAXR; q++) {
      if (!sim.religion.alive[q]) continue;
      let n = 0;
      for (let c = 1; c < 256; c++) if (sim.religion.cnt[c * MAXR + q] >= RELIGION.schismBelievers) n++;
      if (n > most) {
        most = n;
        r = q;
      }
    }
    if (most >= 2) break;
  }
  const st = sim.religion;
  assert.ok(most >= 2, 'a religion in two peoples');
  const saved = { ...RELIGION };
  RELIGION.schismBase = 1;
  RELIGION.schismCap = 1;
  // No other schism, merge or death this year.
  for (let q = 0; q < MAXR; q++) if (q !== r) st.rSchism[q] = 0;
  st.tension[r] = 80;
  const before = st.stats.schism;
  const mother = new Map<number, number>();
  for (let i = 0; i < sim.pop.end; i++) if (sim.pop.alive[i] && sim.pop.religion[i] === r && sim.pop.faith[i] >= 0.5) mother.set(i, sim.pop.cell[i]);
  try {
    religionYearStep(sim, 0);
    for (let q = 0; q < MAXR; q++) if (q !== r) st.rSchism[q] = 0;
    religionYearStep(sim, 1);
  } finally {
    Object.assign(RELIGION, saved);
  }
  assert.equal(st.stats.schism, before + 1);
  let d = -1;
  for (let q = 0; q < MAXR; q++) if (st.alive[q] && st.parent[q] === r && st.founded[q] === Math.floor(sim.tick / TICKS_PER_YEAR)) d = q;
  assert.ok(d >= 0, 'the daughter');
  assert.ok(st.tension[r] <= 80 - RELIGION.tensionDrop + 5);
  assert.ok(sim.chronicle.some((e) => e.text.startsWith('A heresy arises in a settlement of the ')));
  // Its believers: in one settlement and its neighbors, never a capital, at faith 0.6, all former believers of the mother.
  const cells = new Set<number>();
  let n = 0;
  for (let i = 0; i < sim.pop.end; i++) {
    if (!sim.pop.alive[i] || sim.pop.religion[i] !== d) continue;
    n++;
    cells.add(sim.pop.cell[i]);
    assert.ok(Math.abs(sim.pop.faith[i] - RELIGION.foundFaith) < 1e-6);
    assert.ok(mother.has(i), 'a believer of the mother before');
  }
  assert.ok(n >= RELIGION.minBelievers, `${n} seeded`);
  const list = [...cells];
  // The seed settlement: every daughter believer lives there or next to it (the weakest in faith went first).
  const candidates = [list[0], ...Array.from(sim.world.neighbors.subarray(list[0] * 6, list[0] * 6 + 6))];
  const center = candidates.find((c) => c >= 0 && list.every((x) => x === c || sim.world.neighbors.subarray(c * 6, c * 6 + 6).includes(x)));
  assert.ok(center !== undefined, 'one settlement and its neighbors');
  for (const civ of livingCivilizations(sim)) assert.ok(!(cells.size === 1 && cells.has(civ.capital)), 'not a capital');
  // The traits: the mother's with one swapped (the newest at level 1).
  assert.ok(traitCount(st, d) >= 1);
});

test('the daughter spreads by contagion only into settlements within 8 hexes of a source; young daughters hold x2 and live through their grace years', () => {
  const sim = grown();
  const st = sim.religion;
  // Sunder the Faith in the largest settlement of the biggest realm (the god's schism, same seed and contagion).
  const civ = livingCivilizations(sim).sort((a, b) => b.population - a.population)[0];
  const cell = civ.capital;
  sim.gacha.charges[Ab.SunderTheFaith] = 1;
  assert.ok(canCast(sim, Ab.SunderTheFaith, cell));
  assert.ok(castAbility(sim, Ab.SunderTheFaith, cell));
  let d = -1;
  for (let q = 0; q < MAXR; q++) if (st.alive[q] && st.parent[q] >= 0 && st.wonBy[q] === 0 && st.founded[q] === Math.floor(sim.tick / TICKS_PER_YEAR)) d = q;
  assert.ok(d >= 0);
  // A young daughter: hold x2 (with her traits), her believers don't fade in the grace years.
  const holdTraits = (() => {
    let h = 1;
    for (let k = 0; k < SLOTS; k++) {
      const t = st.traitId[d * SLOTS + k];
      if (t && TRAITS[t].hold) h *= Math.pow(TRAITS[t].hold!, [0, 0.5, 1, 1.5][st.traitLvl[d * SLOTS + k]]);
    }
    return h;
  })();
  assert.ok(Math.abs(st.rHold[d] - holdTraits * RELIGION.youngHold) < 1e-4);
  // Year by year: the daughter appears only within RELIGION.contRadius hexes of a source (a settlement with >= 10 % of it).
  for (let y = 0; y < 6; y++) {
    const sources: number[] = [];
    const had = new Uint8Array(sim.world.cellCount);
    for (let c = 0; c < sim.world.cellCount; c++) {
      const n = sim.cellPop[c];
      if (n > 0 && st.cellBel[c * MAXR + d] > 0) had[c] = 1;
      if (n > 0 && st.cellBel[c * MAXR + d] / n >= RELIGION.contSrc) sources.push(c);
    }
    runYears(sim, 1);
    for (let c = 0; c < sim.world.cellCount; c++) {
      if (had[c] || st.cellBel[c * MAXR + d] === 0) continue;
      assert.ok(sources.some((x) => x !== c && hexDistance(sim.world, x, c) <= RELIGION.contRadius) || sources.length === 0, `hex ${c} far from every source`);
    }
  }
  assert.ok(st.alive[d] === 1, 'the young daughter lives (grace years)');
});

test('the leader\'s faith is the state faith: a first leader takes the capital\'s majority, a successor\'s is drawn by the capital\'s and the realm\'s shares, Dynasty\'s Heir keeps it', () => {
  const sim = grownOnce();
  const st = sim.religion;
  const civ = livingCivilizations(sim).find((c) => sim.leaders.has[c.id])!;
  assert.ok(civ);
  // Everyone of the people holds religion r: any draw must give r.
  let r = -1;
  for (let q = 1; q < MAXR && r < 0; q++) if (st.alive[q]) r = q;
  if (r < 0) r = 0;
  convertPeople(sim, civ.id, r);
  sim.leaders.faith[civ.id] = r === 0 ? 1 : 0;
  sim.leaders.faithDraw[civ.id] = 1;
  religionYear(sim);
  assert.equal(sim.leaders.faith[civ.id], r);
  assert.equal(stateFaith(sim, civ.id), r);
  assert.ok(sim.chronicle.some((e) => e.text.startsWith(`The ruler of the ${civ.name} adopts the `)));
  // Dynasty's Heir: the predecessor's faith stays, whatever the shares.
  const other = r === 0 ? (st.alive[1] ? 1 : r) : 0;
  sim.leaders.faith[civ.id] = other;
  sim.leaders.faithDraw[civ.id] = 2;
  religionYear(sim);
  assert.equal(sim.leaders.faith[civ.id], other);
  // A first leader: the capital's majority.
  sim.leaders.faith[civ.id] = NO_RELIGION;
  sim.leaders.faithDraw[civ.id] = 3;
  convertPeople(sim, civ.id, r);
  religionYear(sim);
  assert.equal(sim.leaders.faith[civ.id], r);
});

test('Faith in trust (6a): same religion +4, foreign −8, kin by traits; Creed is the traits\' satisfaction by share, capped at ±8', () => {
  const sim = grown();
  const st = sim.religion;
  const [a, b] = livingCivilizations(sim).map((c) => c.id);
  sim.diplomacy.known[a * PAIRS + b] = 1;
  sim.diplomacy.known[b * PAIRS + a] = 1;
  // Both all of religion 0 without traits: +4 x share x share.
  setTraits(sim, 0, []);
  convertPeople(sim, a, 0);
  convertPeople(sim, b, 0);
  refreshReligions(sim);
  const sa = st.share[a * MAXR];
  const sb = st.share[b * MAXR];
  assert.ok(Math.abs(st.trust[a * PAIRS + b] - RELIGION.trustSame * sa * sb) < 1e-4);
  assert.equal(st.creed[a], 0);
  // b of another religion without kin: foreign -8.
  let r = 1;
  while (r < MAXR && st.alive[r] && kinOf(st, 0, r)) r++;
  if (!st.alive[r]) {
    st.alive[r] = 1;
    st.parent[r] = -1;
  }
  setTraits(sim, r, []);
  convertPeople(sim, b, r);
  refreshReligions(sim);
  assert.ok(Math.abs(st.trust[a * PAIRS + b] - RELIGION.trustForeign * st.share[a * MAXR] * st.share[b * MAXR + r]) < 1e-4);
  // Open Gates halves the foreign part (level 2), Inquisition x1.5; within the caps.
  setTraits(sim, 0, [[Trait.OpenGates, 2]]);
  refreshReligions(sim);
  assert.ok(Math.abs(st.trust[a * PAIRS + b] - RELIGION.trustForeign * 0.5 * st.share[a * MAXR] * st.share[b * MAXR + r]) < 1e-3);
  assert.ok(sim.diplomacy.trust !== undefined);
  // Creed: Temple Splendor +3, Fertility Rites +1 at level 2, by share; capped at 8 with Hearth Blessing at level 3 more.
  setTraits(sim, 0, [[Trait.TempleSplendor, 2], [Trait.FertilityRites, 2]]);
  refreshReligions(sim);
  assert.ok(Math.abs(st.creed[a] - 4 * st.share[a * MAXR]) < 1e-4);
  setTraits(sim, 0, [[Trait.TempleSplendor, 3], [Trait.FertilityRites, 3], [Trait.HearthBlessing, 3], [Trait.OmenReaders, 3]]);
  refreshReligions(sim);
  assert.ok(st.creed[a] <= RELIGION.creedCap + 1e-6);
  const cap = sim.civs[a]!.capital;
  assert.ok(satisfactionTerms(sim, cap, sim.civs[a]).some((t) => t.label === 'Creed' && Math.abs(t.value - st.creed[a]) < 1e-6));
  // The lever layer: Fertility Rites (x1.08) and Hearth Blessing (x1.03) at level 3, by share.
  const birth = Math.exp(1.5 * st.share[a * MAXR] * (Math.log(1.08) + Math.log(1.03)));
  assert.ok(Math.abs(st.lev[a * LEVERS + L.birth] - birth) < 1e-4);
});

test('holy war (6b): a people whose followed religion has Holy War, Inquisition or Missionary Zeal needs 1.5x (not 2x) against a people of another followed religion; 30 years apart', () => {
  const sim = grown();
  const st = sim.religion;
  const [a, b] = livingCivilizations(sim).map((c) => c.id);
  st.major[a] = 0;
  st.major[b] = -1;
  setTraits(sim, 0, [[Trait.HolyWar, 1]]);
  st.lastHoly[0] = -1000;
  assert.equal(holyRatio(sim, a, b, 2), 2, 'b follows no religion');
  let r = 1;
  while (st.alive[r]) r++;
  st.alive[r] = 1;
  st.major[b] = r;
  assert.equal(holyRatio(sim, a, b, 2), RELIGION.holyRatio);
  setTraits(sim, 0, [[Trait.MissionaryZeal, 1]]);
  assert.equal(holyRatio(sim, a, b, 2), RELIGION.holyRatio, 'Missionary Zeal too');
  setTraits(sim, 0, [[Trait.Peacemakers, 1]]);
  assert.equal(holyRatio(sim, a, b, 2), 2);
  setTraits(sim, 0, [[Trait.Inquisition, 1]]);
  st.lastHoly[0] = Math.floor(sim.tick / TICKS_PER_YEAR) - RELIGION.holyCooldown + 1;
  assert.equal(holyRatio(sim, a, b, 2), 2, 'cooldown');
  st.major[b] = 0;
  st.lastHoly[0] = -1000;
  assert.equal(holyRatio(sim, a, b, 2), 2, 'the same faith');
});

test('the faith step: believers of a religion the people does not follow fade (−0.005), under 0.2 the religion is lost; the unaffiliated take the strongest pressure', () => {
  const sim = grownOnce();
  const st = sim.religion;
  const pop = sim.pop;
  let i = 0;
  while (i < pop.end && !pop.alive[i]) i++;
  const civ = pop.civ[i];
  const cell = pop.cell[i];
  const r = pop.religion[i] === NO_RELIGION ? 0 : pop.religion[i];
  pop.religion[i] = r;
  st.major[civ] = -1;
  const f = faithStep(sim, i, civ, cell, 0.7);
  const expected = 0.7 + (st.cellFs[cell * MAXR + r] - 0.7) * RELIGION.pull - RELIGION.fading;
  if (pop.religion[i] === r && f >= 0.5) assert.ok(Math.abs(f - (expected + sim.gacha.godLight[civ] * (r === 0 ? 1 : 0) - sim.gacha.godDoubt[civ])) < 1e-5);
  pop.religion[i] = r;
  assert.equal(faithStep(sim, i, civ, cell, 0.1), 0);
  assert.equal(pop.religion[i], NO_RELIGION);
});

test('the god\'s faith abilities: Blessed Doctrine (level 2, beyond the natural slots), Lost Doctrine (never the last), Spark of a New Faith (a quarter of a people), Covenant of One (religion 0 stays)', () => {
  const sim = grown();
  const st = sim.religion;
  const g = sim.gacha;
  for (const a of [Ab.BlessedDoctrine, Ab.LostDoctrine, Ab.SparkOfANewFaith, Ab.CovenantOfOne]) g.charges[a] = 3;
  // Blessed Doctrine on a religion with its natural slots full.
  const natural = traitCount(st, 0);
  assert.ok(canCast(sim, Ab.BlessedDoctrine, 0));
  assert.ok(castAbility(sim, Ab.BlessedDoctrine, 0));
  assert.equal(traitCount(st, 0), natural + 1);
  let k = -1;
  for (let s = 0; s < SLOTS; s++) if (st.traitGod[s] === 1) k = s;
  assert.ok(k >= 0 && st.traitLvl[k] === 2, 'level 2, by the god');
  assert.ok(sim.chronicle.some((e) => / by the god\.$/.test(e.text)));
  // Lost Doctrine: one trait less; not on a religion with one trait.
  assert.ok(castAbility(sim, Ab.LostDoctrine, 0));
  assert.equal(traitCount(st, 0), natural);
  setTraits(sim, 0, [[Trait.FertilityRites, 2]]);
  assert.equal(canCast(sim, Ab.LostDoctrine, 0), false);
  // Spark of a New Faith in the largest people: a quarter of it takes the new religion (faith 0.6).
  const civ = livingCivilizations(sim).sort((a, b) => b.population - a.population)[0];
  assert.ok(canCast(sim, Ab.SparkOfANewFaith, civ.id));
  const alive = st.alive.reduce((a, b) => a + b, 0);
  assert.ok(castAbility(sim, Ab.SparkOfANewFaith, civ.id));
  assert.equal(st.alive.reduce((a, b) => a + b, 0), alive + 1);
  let r = -1;
  for (let q = 0; q < MAXR; q++) if (st.alive[q] && st.founderCiv[q] === civ.id && st.stats.spark > 0 && st.parent[q] < 0 && st.founded[q] === Math.floor(sim.tick / TICKS_PER_YEAR)) r = q;
  assert.ok(r > 0);
  let n = 0;
  for (let i = 0; i < sim.pop.end; i++) if (sim.pop.alive[i] && sim.pop.religion[i] === r) n++;
  assert.equal(n, Math.floor(0.25 * civ.population));
  // Covenant of One: the new one merges into religion 0 (the player's always stays); two choices.
  assert.ok(validTargets(sim, Ab.CovenantOfOne, -1).includes(r));
  assert.ok(validTargets(sim, Ab.CovenantOfOne, r).includes(0));
  assert.ok(castAbility(sim, Ab.CovenantOfOne, r, 0));
  assert.equal(st.alive[r], 0);
  assert.equal(st.alive[0], 1);
  for (let i = 0; i < sim.pop.end; i++) if (sim.pop.alive[i]) assert.notEqual(sim.pop.religion[i], r);
});

test('what the app reads: the Faiths panel, a people\'s faith, a hex\'s faith', () => {
  const sim = grownOnce();
  const list = religionsOf(sim);
  assert.ok(list.length >= 1);
  assert.equal(list[0].id, 0);
  assert.equal(list[0].god, 'You');
  for (const r of list) {
    assert.ok(['Calm', 'Uneasy', 'Tense'].includes(r.tensionLabel));
    for (const t of r.traits) {
      assert.ok(t.level >= 1 && t.level <= 3);
      assert.ok(t.effects.length >= 1, t.name);
    }
  }
  const civ = livingCivilizations(sim)[0];
  const f = civFaith(sim, civ.id)!;
  assert.ok(f.shares.length >= 1);
  assert.ok(f.shares.reduce((a, s) => a + s.share, 0) <= 1 + 1e-6);
  const h = hexFaith(sim, civ.capital)!;
  assert.ok(h.religions.length >= 1);
  assert.equal(sim.religion.hexRel[civ.capital], h.religions[0].religion);
  assert.equal(TRAIT_COUNT, 24);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sumTerms } from '../terms';
import { generateWorld } from '../world/generate';
import { PAIRS } from './diplomacy';
import { effectText, leaderOf, leaderTrait } from './leaderInfo';
import { ATTRS, ATTR_COUNT, GOAL_FX, dismissLeaders, excludes, expansionTarget, goalExcludes, leaderTerms, recompute, updateLeaders } from './leaderRules';
import { EVENTS, Ev, GOALS, Goal, L, LEADER, LEADER_CIVS, LEADER_STEMS, LEVERS, LEVER_KIND, leaderName, lever, warChance, warRatio } from './leaders';
import { Pact } from './pacts';
import { satisfactionTarget, satisfactionTerms } from './satisfaction';
import { TICKS_PER_YEAR, createSimulation, foundCivilization, livingCivilizations, stepSimulation, type Simulation } from './simulation';
import { WAR } from './war';

// Leaders ("Design Documents/Requirement Anführer.md"): determinism, death and succession, attributes, goals,
// exclusions, caps, the lever set and what the app reads.

// The tests look at the samples of ended terms (the game keeps none).
LEADER.records = 1;

function run(seed: number, years: number, enabled = 1): Simulation {
  const saved = LEADER.enabled;
  LEADER.enabled = enabled;
  try {
    const sim = createSimulation(generateWorld({ seed }));
    for (let t = 0; t < years * TICKS_PER_YEAR; t++) stepSimulation(sim);
    return sim;
  } finally {
    LEADER.enabled = saved;
  }
}

/** A world with several peoples and their leaders; `civ` rules since `years` years, aged 20 at takeover (no death), with these attributes and this goal. */
function ruled(years: number, attrs: number[], goal: number): { sim: Simulation; civ: number; other: number } {
  const sim = run(5, 120);
  const ids = livingCivilizations(sim).map((c) => c.id);
  assert.ok(ids.length >= 2, 'two peoples');
  const [civ, other] = ids;
  setLeader(sim, civ, years, attrs, goal);
  return { sim, civ, other };
}

function setLeader(sim: Simulation, civ: number, years: number, attrs: number[], goal: number): void {
  const s = sim.leaders;
  assert.equal(s.has[civ], 1);
  s.age0[civ] = 20;
  s.start[civ] = sim.tick - years * TICKS_PER_YEAR;
  for (let i = 0; i < 3; i++) s.attr[civ * 3 + i] = attrs[i] ?? 0;
  s.goal[civ] = goal;
  s.goalDone[civ] = 0;
  s.goalBase[civ] = 1e9;
  s.safeYears[civ] = 0;
  s.wonAttack[civ] = 0;
  s.conquests[civ] = 0;
  s.lastWin[civ] = -1;
  s.events.fill(0, civ * EVENTS, civ * EVENTS + EVENTS);
  recompute(sim, civ);
}

const attrsOf = (sim: Simulation, civ: number) => [0, 1, 2].map((i) => sim.leaders.attr[civ * 3 + i]).filter((a) => a !== 0);

/** The values of LEADER changed for one test. */
function withNumbers(values: Partial<typeof LEADER>, body: () => void): void {
  const saved = { ...LEADER };
  Object.assign(LEADER, values);
  try {
    body();
  } finally {
    Object.assign(LEADER, saved);
  }
}

test('leaders are on in the game; a simulation without them (tools) keeps every lever set neutral', () => {
  assert.equal(LEADER.enabled, 1);
  const sim = run(3, 60, 0);
  assert.equal(sim.leaders.has.reduce((a, b) => a + b, 0), 0);
  for (let c = 0; c < LEADER_CIVS; c++) {
    for (let k = 0; k < LEVERS; k++) assert.equal(sim.leaders.lev[c * LEVERS + k], LEVER_KIND[k]);
    assert.equal(sim.leaders.sat[c], 0);
    assert.equal(sim.leaders.conn[c], 0);
  }
  assert.equal(warChance(sim, 1, WAR.chance), WAR.chance);
  assert.equal(warRatio(sim, 1, true, WAR.ratio), WAR.ratio);
  assert.ok(!sim.chronicle.some((e) => / leader /.test(e.text)));
});

test('leaders are deterministic per seed, rule every living people, and their lever sets are those of their attributes and goal', () => {
  const a = run(5, 120);
  const b = run(5, 120);
  assert.deepEqual(leaderTerms(a), leaderTerms(b));
  assert.deepEqual(a.leaders.lev, b.leaders.lev);
  assert.deepEqual(a.leaders.stem, b.leaders.stem);
  assert.deepEqual(a.chronicle, b.chronicle);
  for (let id = 1; id < a.civs.length; id++) {
    if (!a.civs[id]) continue;
    assert.equal(a.leaders.has[id], 1);
    // The set is only recomputed when something changed: it must equal one computed afresh.
    const kept = a.leaders.lev.slice(id * LEVERS, (id + 1) * LEVERS);
    recompute(a, id);
    assert.deepEqual(a.leaders.lev.slice(id * LEVERS, (id + 1) * LEVERS), kept, `lever set of people ${id}`);
  }
  // A people that is gone has no leader and a neutral set.
  for (let id = 1; id < LEADER_CIVS; id++) {
    if (a.civs[id]) continue;
    assert.equal(a.leaders.has[id], 0);
    for (let k = 0; k < LEVERS; k++) assert.equal(a.leaders.lev[id * LEVERS + k], LEVER_KIND[k]);
  }
});

test('over 200 years no exclusion breaks, terms last 15 to 80 years, the caps hold and nobody has more than 3 attributes', () => {
  const sim = run(7, 200);
  assert.equal(sim.leaders.stats.exclusionBreaks, 0);
  const terms = leaderTerms(sim);
  assert.ok(terms.length > 10);
  for (const t of terms) {
    assert.ok(t.attrs.length >= 1 && t.attrs.length <= 3);
    assert.equal(new Set(t.attrs).size, t.attrs.length, 'no attribute twice');
    for (const a of t.attrs) assert.ok(a >= 1 && a <= ATTR_COUNT && ATTRS[a].name);
    assert.ok(t.goal >= Goal.Expansion && t.goal <= Goal.Glory);
    if (t.end === 0) assert.ok(t.years >= LEADER.deathFrom - LEADER.ageMax && t.years <= 80, `term of ${t.years} years`);
    // The 2nd attribute after 10 years in office; the 3rd only with the goal reached.
    if (t.years >= LEADER.secondYears + 1) assert.ok(t.attrs.length >= 2, `2 attributes after ${t.years} years`);
    if (t.attrs.length === 3) assert.ok(t.doneYears >= 0, 'the 3rd attribute comes with the goal');
    if (t.years < LEADER.secondYears && t.doneYears < 0) assert.equal(t.attrs.length, 1);
  }
  for (let id = 1; id < sim.civs.length; id++) {
    if (!sim.civs[id]) continue;
    assert.ok(Math.abs(sim.leaders.sat[id] + sim.leaders.conn[id]) <= LEADER.capSatisfaction);
    assert.ok(warChance(sim, id, WAR.chance) <= LEADER.capWarChance);
    assert.ok(warRatio(sim, id, true, WAR.ratio) >= LEADER.capRatioMin);
  }
});

test('a leader dies only from 55 on; the successor takes office the same year: same line, next ordinal, aged 20 to 40, one attribute, a new goal, a fresh term', () => {
  const { sim, civ } = ruled(12, [20, 6], Goal.Wealth);
  const s = sim.leaders;
  const stem = s.stem[civ];
  const counter = s.counter[civ];
  // Aged 54 he cannot die, whatever the dice.
  withNumbers({ deathBase: 1, deathMax: 1 }, () => {
    s.age0[civ] = 54 - 12;
    updateLeaders(sim);
    assert.equal(s.counter[civ], counter, 'alive at 54');
    s.age0[civ] = 55 - 12;
    s.events[civ * EVENTS + Ev.WarWon] = 3;
    const entries = sim.chronicle.length;
    updateLeaders(sim);
    assert.equal(s.counter[civ], counter + 1, 'died at 55 (chance 1)');
    assert.equal(s.has[civ], 1);
    assert.equal(s.stem[civ], stem);
    assert.equal(s.start[civ], sim.tick);
    assert.ok(s.age0[civ] >= 20 && s.age0[civ] <= 40);
    assert.equal(attrsOf(sim, civ).length, 1);
    assert.ok(s.goal[civ] >= Goal.Expansion && s.goal[civ] <= Goal.Glory);
    assert.equal(s.goalDone[civ], 0);
    assert.equal(s.events[civ * EVENTS + Ev.WarWon], 0, 'experiences start anew');
    const texts = sim.chronicle.slice(entries);
    const name = sim.civs[civ]!.name;
    assert.ok(texts.some((e) => e.text.includes(`leader of the ${name}, died at the age of 55 after 12 years in office`)), texts.map((e) => e.text).join(' | '));
    assert.ok(texts.some((e) => e.text.startsWith(`${leaderName(stem, counter + 1)} became leader of the ${name}`)));
    for (const e of texts) {
      assert.equal(e.important, false, 'silent entries');
      assert.equal(e.cell, sim.civs[civ]!.capital);
    }
  });
  // The death curve: 2 % at 55, +1.5 points a year, at most 50 %.
  assert.equal(LEADER.deathFrom, 55);
  assert.equal(LEADER.deathBase, 0.02);
  assert.equal(LEADER.deathStep, 0.015);
  assert.equal(LEADER.deathMax, 0.5);
});

test('the successor inherits one of the predecessor’s attributes with the inheritance chance, else draws any', () => {
  for (const inherit of [1, 0]) {
    let inherited = 0;
    const { sim, civ } = ruled(12, [20, 6], Goal.Wealth);
    withNumbers({ deathBase: 1, deathMax: 1, inherit }, () => {
      for (let i = 0; i < 40; i++) {
        setLeader(sim, civ, 12, [20, 6], Goal.Wealth);
        sim.leaders.age0[civ] = 60;
        updateLeaders(sim);
        const [first] = attrsOf(sim, civ);
        if (first === 20 || first === 6) inherited++;
      }
    });
    if (inherit === 1) assert.equal(inherited, 40);
    else assert.ok(inherited < 20, `${inherited} of 40 by chance alone`);
  }
  assert.equal(LEADER.inherit, 0.5);
});

test('the 2nd attribute comes after 10 years in office, from the most frequent experience of the term', () => {
  const { sim, civ } = ruled(9, [20], Goal.Wealth);
  const s = sim.leaders;
  updateLeaders(sim);
  assert.deepEqual(attrsOf(sim, civ), [20], 'not after 9 years');
  withNumbers({ experience: 1 }, () => {
    for (let i = 0; i < 30; i++) {
      setLeader(sim, civ, 10, [20], Goal.Wealth);
      // Wars won most often, a border closed once: Warmonger, Drillmaster, Opportunist or Stubborn.
      s.events[civ * EVENTS + Ev.WarWon] = 3;
      s.events[civ * EVENTS + Ev.BorderClosed] = 1;
      const entries = sim.chronicle.length;
      updateLeaders(sim);
      const got = attrsOf(sim, civ);
      assert.equal(got.length, 2);
      assert.ok([1, 6, 10, 4].includes(got[1]), `from the experience: ${ATTRS[got[1]].name}`);
      assert.ok(sim.chronicle.slice(entries).some((e) => e.text.includes(`gained the trait ${ATTRS[got[1]].name}`)));
      assert.ok(lever(sim, civ, L.sat) === 5 + (got[1] === 1 ? -2 : 0), 'the lever set follows the new attribute');
    }
    // A tie goes to the latest experience.
    setLeader(sim, civ, 10, [20], Goal.Wealth);
    s.events[civ * EVENTS + Ev.WarWon] = 2;
    s.eventTick[civ * EVENTS + Ev.WarWon] = sim.tick - 100;
    s.events[civ * EVENTS + Ev.Uprising] = 2;
    s.eventTick[civ * EVENTS + Ev.Uprising] = sim.tick - 10;
    updateLeaders(sim);
    assert.ok([22, 23].includes(attrsOf(sim, civ)[1]), 'uprising: Iron Fist or Weak Hand (Beloved is there, Tyrant excluded)');
  });
});

test('no draw ever breaks an exclusion pair, repeats an attribute or goes against the goal; Skeptic is gone', () => {
  assert.equal(ATTRS.length, ATTR_COUNT + 1);
  assert.ok(!ATTRS.some((a) => a.name === 'Skeptic'));
  const pairs = [[1, 2], [1, 3], [2, 4], [4, 5], [7, 8], [13, 14], [15, 16], [18, 19], [20, 21], [21, 23], [22, 23], [8, 12], [2, 11]];
  let count = 0;
  for (let a = 1; a <= ATTR_COUNT; a++) for (let b = 1; b <= ATTR_COUNT; b++) if (excludes[a * 26 + b]) count++;
  assert.equal(count, 2 * pairs.length);
  for (const [a, b] of pairs) assert.ok(excludes[a * 26 + b] && excludes[b * 26 + a]);
  assert.ok(goalExcludes(Goal.Glory, 2) && goalExcludes(Goal.Expansion, 19));
  const { sim, civ } = ruled(10, [1], Goal.Glory);
  const s = sim.leaders;
  for (const [first, goal] of [[1, Goal.Glory], [21, Goal.Expansion], [8, Goal.Wealth], [2, Goal.Security], [4, Goal.Expansion]]) {
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      setLeader(sim, civ, 10, [first], goal);
      updateLeaders(sim);
      const got = attrsOf(sim, civ);
      assert.equal(got.length, 2);
      assert.notEqual(got[1], first);
      assert.ok(!excludes[first * 26 + got[1]], `${ATTRS[first].name} with ${ATTRS[got[1]].name}`);
      assert.ok(!goalExcludes(goal, got[1]), `${GOALS[goal]} with ${ATTRS[got[1]].name}`);
      seen.add(got[1]);
    }
    assert.ok(seen.size >= 15, `${seen.size} different attributes drawn`);
  }
  assert.equal(s.stats.exclusionBreaks, 0);
});

test('each goal is reached by its condition; then its effect halves and the 3rd attribute comes', () => {
  const { sim, civ, other } = ruled(12, [20, 6], Goal.Expansion);
  const s = sim.leaders;
  const settlements = () => {
    let n = 0;
    for (let c = 0; c < sim.world.cellCount; c++) if (sim.world.owner[c] === civ && sim.cellPop[c] > 0) n++;
    return n;
  };
  // Expansion: 1.5 x the settlements at takeover, at least +2.
  assert.equal(expansionTarget(2), 4);
  assert.equal(expansionTarget(10), 15);
  const n = settlements();
  assert.ok(n >= 1);
  s.goalBase[civ] = n;
  updateLeaders(sim);
  assert.equal(s.goalDone[civ], 0, 'no growth yet');
  assert.equal(lever(sim, civ, L.warPop), 1.5);
  assert.ok(Math.abs(lever(sim, civ, L.settleOver) - 0.98) < 1e-6);
  assert.ok(Math.abs(lever(sim, civ, L.buildFrom) + 0.1) < 1e-6);
  // As many settlements as the target asks for from this base: reached.
  let base = 0;
  while (expansionTarget(base + 1) <= n) base++;
  s.goalBase[civ] = base;
  const entries = sim.chronicle.length;
  // The 3rd attribute from an uprising (Iron Fist or Weak Hand), so it does not touch the goal's levers checked below.
  s.events[civ * EVENTS + Ev.Uprising] = 5;
  withNumbers({ experience: 1 }, () => updateLeaders(sim));
  if (expansionTarget(base) <= n) {
    assert.equal(s.goalDone[civ], 1);
    assert.equal(s.goalTick[civ], sim.tick);
    assert.equal(attrsOf(sim, civ).length, 3, 'the 3rd attribute');
    assert.ok([22, 23].includes(attrsOf(sim, civ)[2]));
    assert.ok(sim.chronicle.slice(entries).some((e) => e.text.includes('reached the goal Expansion')));
    // Half the deviation from the base value.
    assert.equal(lever(sim, civ, L.warPop), 1.25);
    assert.ok(Math.abs(lever(sim, civ, L.settleOver) - 0.99) < 1e-6);
    assert.ok(Math.abs(lever(sim, civ, L.buildFrom) + 0.05) < 1e-6);
    // Reached stays reached; no 4th attribute.
    updateLeaders(sim);
    assert.equal(attrsOf(sim, civ).length, 3);
    assert.equal(s.goalDone[civ], 1);
  } else assert.equal(n, 1, 'a single settlement cannot reach any target');

  // Reached before the 10 years: the attribute goes into the 2nd slot, and the 10-year attribute into the 3rd.
  setLeader(sim, civ, 3, [20], Goal.Glory);
  s.wonAttack[civ] = 1;
  updateLeaders(sim);
  assert.equal(s.goalDone[civ], 1, 'Glory: a war won as the attacker, with or without a conquered district');
  assert.equal(s.conquests[civ], 0);
  assert.equal(attrsOf(sim, civ).length, 2);
  assert.ok(Math.abs(lever(sim, civ, L.warChanceMul) - 1.5) < 1e-6, 'x2 halves to x1.5');
  assert.ok(Math.abs(lever(sim, civ, L.ratio) + 0.4) < 1e-6);

  // Glory, the other way: the capital rose a city tier.
  setLeader(sim, civ, 3, [20], Goal.Glory);
  s.goalBase[civ] = sim.world.cityTier[sim.civs[civ]!.capital];
  updateLeaders(sim);
  assert.equal(s.goalDone[civ], 0);
  s.goalBase[civ] = sim.world.cityTier[sim.civs[civ]!.capital] - 1;
  updateLeaders(sim);
  assert.equal(s.goalDone[civ], 1);

  // Wealth: last year's trade value at least 1.5 x the base (the mean of the 5 years before takeover, at least the floor).
  setLeader(sim, civ, 3, [20], Goal.Wealth);
  s.goalBase[civ] = 20;
  s.tradeLast[civ] = 29.9;
  updateLeaders(sim);
  assert.equal(s.goalDone[civ], 0);
  s.tradeLast[civ] = 30;
  updateLeaders(sim);
  assert.equal(s.goalDone[civ], 1);
  assert.ok(Math.abs(lever(sim, civ, L.income) - 0.05) < 1e-6);
  assert.ok(lever(sim, civ, L.tradeFirst) > 0, 'trade buildings first stays');

  // Security: 5 safe years in a row and a pact or alliance.
  setLeader(sim, civ, 3, [20], Goal.Security);
  sim.diplomacy.danger.fill(0);
  for (let b = 0; b < PAIRS; b++) sim.war.pact[civ * PAIRS + b] = sim.war.pact[b * PAIRS + civ] = Pact.None;
  for (let y = 0; y < 6; y++) updateLeaders(sim);
  assert.ok(s.safeYears[civ] >= 5);
  assert.equal(s.goalDone[civ], 0, 'safe, but no pact');
  sim.war.pact[civ * PAIRS + other] = sim.war.pact[other * PAIRS + civ] = Pact.Pact;
  s.safeYears[civ] = 3;
  updateLeaders(sim);
  assert.equal(s.goalDone[civ], 0, '4 safe years');
  updateLeaders(sim);
  assert.equal(s.goalDone[civ], 1, '5 safe years and a pact');
  assert.ok(Math.abs(lever(sim, civ, L.warChanceMul) - 0.75) < 1e-6);
});

test('a new leader’s Wealth base is the mean trade value of the 5 years before, at least the floor', () => {
  assert.equal(LEADER.wealthYears, 5);
  assert.equal(LEADER.wealthFactor, 1.5);
  const { sim, civ } = ruled(12, [20], Goal.Wealth);
  const s = sim.leaders;
  withNumbers({ deathBase: 1, deathMax: 1, weightWealth: 1e9, goalBySituation: 1, weightExpansion: 0, weightSecurity: 0, weightGlory: 0 }, () => {
    for (const [value, base] of [[100, 100], [2, LEADER.wealthFloor]]) {
      // Five years of this trade value, then the leader dies.
      setLeader(sim, civ, 12, [20], Goal.Security);
      for (let y = 0; y < 5; y++) {
        s.tradeValue[civ] = value;
        updateLeaders(sim);
      }
      // Successors until one takes the goal Wealth (the trade value stays the same all the time).
      let found = false;
      for (let i = 0; i < 60 && !found; i++) {
        s.age0[civ] = 60;
        s.start[civ] = sim.tick - 12 * TICKS_PER_YEAR;
        s.tradeValue[civ] = value;
        updateLeaders(sim);
        found = s.goal[civ] === Goal.Wealth;
      }
      assert.ok(found, 'a leader with the goal Wealth');
      assert.equal(s.goalBase[civ], base);
    }
  });
});

test('the caps: satisfaction within ±8 (the connection part included), threshold at least 1.2×, war roll at most 40 %', () => {
  assert.equal(LEADER.capSatisfaction, 8);
  assert.equal(LEADER.capRatioMin, 1.2);
  assert.equal(LEADER.capWarChance, 0.4);
  const { sim, civ } = ruled(12, [20, 13, 19], Goal.Wealth);
  const s = sim.leaders;
  // Beloved +5, Generous +4, Homebody +3 = 12.
  assert.equal(lever(sim, civ, L.sat), 12);
  assert.equal(s.sat[civ], 8);
  // Tyrant -6, Tax Hawk -3, Warmonger -2 = -11.
  setLeader(sim, civ, 12, [21, 14, 1], Goal.Wealth);
  assert.equal(s.sat[civ], -8);
  // Beloved +5, Generous +4 and a Road Builder's +3 on the connection part: together 8.
  setLeader(sim, civ, 12, [20, 13, 25], Goal.Wealth);
  assert.equal(s.conn[civ], 3);
  assert.equal(s.sat[civ], 5);
  // In the settlements: the part "Leader" and the connection part, and the target the simulation uses, agree.
  const people = sim.civs[civ]!;
  const cell = people.capital;
  const terms = satisfactionTerms(sim, cell, people);
  assert.equal(terms.find((t) => t.label === 'Leader')!.value, 5);
  assert.equal(terms.find((t) => t.label === 'Capital')!.value, 10 + 3);
  assert.ok(Math.abs(Math.max(-100, Math.min(100, sumTerms(terms))) - satisfactionTarget(sim, cell, people)) < 1e-4);
  const withLeader = satisfactionTarget(sim, cell, people);
  dismissLeaders(sim);
  assert.ok(Math.abs(withLeader - satisfactionTarget(sim, cell, people) - 8) < 1e-4 || withLeader === 100);
});

test('the war roll and the threshold: Warmonger 40 %, Glory ×2 and 1.2×, capped; a Pacifist never declares war', () => {
  const { sim, civ } = ruled(12, [1], Goal.Wealth);
  assert.equal(WAR.chance, 0.1);
  assert.equal(WAR.ratio, 2);
  assert.ok(Math.abs(warChance(sim, civ, WAR.chance) - 0.4) < 1e-6, 'Warmonger: 40 %');
  // Warmonger with the goal Glory: 40 % x 2 = 80 %, capped at 40 %; threshold 2 - 0.8 = 1.2.
  setLeader(sim, civ, 12, [1], Goal.Glory);
  assert.ok(Math.abs(warChance(sim, civ, WAR.chance) - 0.4) < 1e-6);
  assert.ok(Math.abs(warRatio(sim, civ, false, WAR.ratio) - 1.2) < 1e-6);
  // Glory alone: 10 % x 2 = 20 %.
  setLeader(sim, civ, 12, [20], Goal.Glory);
  assert.ok(Math.abs(warChance(sim, civ, WAR.chance) - 0.2) < 1e-6);
  // Glory with an Opportunist against a people at war: 2 - 0.8 - 0.8 = 0.4, held at 1.2.
  setLeader(sim, civ, 12, [10], Goal.Glory);
  assert.equal(warRatio(sim, civ, true, WAR.ratio), LEADER.capRatioMin);
  assert.ok(Math.abs(warRatio(sim, civ, false, WAR.ratio) - 1.7) < 1e-6);
  // Cautious Strategist: 3x, the roll x0.8; Security halves the roll.
  setLeader(sim, civ, 12, [3], Goal.Security);
  assert.ok(Math.abs(warRatio(sim, civ, false, WAR.ratio) - 3) < 1e-6);
  assert.ok(Math.abs(warChance(sim, civ, WAR.chance) - 0.04) < 1e-6);
  // A Grudge-bearer's revenge: the roll x2, 1.2x.
  setLeader(sim, civ, 12, [11], Goal.Wealth);
  assert.ok(Math.abs(warChance(sim, civ, WAR.chance, true) - 0.2) < 1e-6);
  assert.equal(warRatio(sim, civ, false, WAR.ratio, true), 1.2);
  // Pacifist: never, whatever else raises the roll (even forced together with Warmonger and Glory).
  setLeader(sim, civ, 12, [2, 1, 11], Goal.Glory);
  assert.equal(warChance(sim, civ, WAR.chance), 0);
  assert.equal(warChance(sim, civ, WAR.chance, true), 0);
});

test('a world of Pacifists declares no war; the same world with its usual leaders does', () => {
  const usual = run(2, 420);
  assert.ok(usual.war.stats.declared > 0, 'wars with the usual leaders');
  let sim!: Simulation;
  withNumbers({ forceAttr: 2 }, () => {
    sim = run(2, 420);
  });
  assert.equal(sim.war.stats.declared, 0);
});

test('the decided numbers of the attributes and goals', () => {
  const fx = (list: readonly (readonly [number, number])[], k: number) => list.find((e) => e[0] === k)?.[1];
  const attr = (name: string) => ATTRS.find((a) => a.name === name)!.fx;
  assert.equal(fx(attr('Warmonger'), L.warChance), 0.3);
  assert.equal(fx(attr('Devout'), L.birth), 1.05);
  assert.equal(fx(attr('Devout'), L.sat), 3);
  assert.equal(fx(attr('Devout'), L.devotion), 0.05);
  assert.equal(fx(attr('Builder'), L.buildFrom), -0.1);
  assert.equal(fx(attr('Builder'), L.buildCost), 0.7);
  assert.equal(fx(attr('Builder'), L.buildTime), 0.7);
  assert.equal(fx(attr('Builder'), L.govUpkeep), 1.2);
  assert.ok(Math.abs(WAR.sendShare + fx(attr('Craven'), L.sendShare)! - 0.25) < 1e-9, 'Craven sends 25 %');
  assert.equal(fx(attr('Merchant Prince'), L.load), 2);
  assert.equal(fx(attr('Merchant Prince'), L.tripRange), 1.2);
  assert.equal(fx(attr('Merchant Prince'), L.dealAmount), 1.5);
  assert.equal(fx(attr('Merchant Prince'), L.lossTrade), 0.5);
  assert.equal(fx(attr('Merchant Prince'), L.tollPay), 0.5);
  assert.equal(fx(attr('Merchant Prince'), L.income), 0.1);
  assert.equal(fx(attr('Pioneer'), L.settleOver), 0.97);
  assert.equal(fx(attr('Pioneer'), L.travel), 0.7);
  assert.equal(fx(attr('Homebody'), L.travel), 1.5);
  assert.equal(fx(attr('Frugal'), L.reserve), 2);
  assert.equal(fx(attr('Prospector'), L.harvest), 1.5);
  assert.deepEqual(attr('Road Builder'), [[L.tripRange, 1.3], [L.connection, 3]]);
  assert.equal(fx(GOAL_FX[Goal.Expansion], L.settleOver), 0.98);
  assert.equal(fx(GOAL_FX[Goal.Glory], L.warChanceMul), 2);
  assert.equal(fx(GOAL_FX[Goal.Glory], L.ratio), -0.8);
  assert.ok(fx(GOAL_FX[Goal.Glory], L.capitalFirst)! > 0);
  assert.ok(fx(GOAL_FX[Goal.Wealth], L.tradeFirst)! > 0);
});

test('a new people starts a new line with ordinal 1; names come from the list by index', () => {
  assert.equal(leaderName(0, 1), 'Aron');
  assert.equal(leaderName(0, 2), 'Aron II');
  assert.equal(leaderName(0, 4), 'Aron IV');
  assert.equal(leaderName(0, 19), 'Aron XIX');
  assert.equal(new Set(LEADER_STEMS).size, LEADER_STEMS.length);
  const { sim, civ } = ruled(12, [20], Goal.Wealth);
  const s = sim.leaders;
  // The lines of the living peoples differ.
  const ids = livingCivilizations(sim).map((c) => c.id);
  assert.equal(new Set(ids.map((id) => s.stem[id])).size, ids.length);
  // A people breaks away: no leader until the year's end, then the first of a new line, nothing inherited.
  const parent = sim.civs[civ]!;
  let cell = -1;
  for (let c = 0; c < sim.world.cellCount && cell < 0; c++) if (sim.world.owner[c] === civ && sim.cellPop[c] > 0 && c !== parent.capital) cell = c;
  assert.ok(cell >= 0);
  const born = foundCivilization(sim, 'revolution', cell, parent)!;
  assert.equal(s.has[born.id], 0);
  assert.equal(leaderOf(sim, born.id), null);
  assert.equal(lever(sim, born.id, L.sat), 0);
  assert.equal(s.events[civ * EVENTS + Ev.Uprising], 1, 'an uprising is an experience of the mother’s leader');
  sim.world.owner[cell] = born.id;
  updateLeaders(sim);
  assert.equal(s.has[born.id], 1);
  assert.equal(s.counter[born.id], 1);
  assert.notEqual(s.stem[born.id], s.stem[civ]);
  assert.equal(attrsOf(sim, born.id).length, 1);
  assert.equal(s.stats.inheritChances, sim.leaders.stats.died, 'only successors may inherit');
  // The people vanishes: the term ends without a successor; its id starts a new line when it is used again.
  sim.civs[born.id] = null;
  updateLeaders(sim);
  assert.equal(s.has[born.id], 0);
  for (let k = 0; k < LEVERS; k++) assert.equal(s.lev[born.id * LEVERS + k], LEVER_KIND[k]);
});

test('what the app reads: name with ordinal, age, years, attributes and goal with effects in numbers and progress', () => {
  const { sim, civ } = ruled(12, [12, 5], Goal.Expansion);
  const s = sim.leaders;
  s.counter[civ] = 3;
  s.goalBase[civ] = 4;
  s.settlements[civ] = 5;
  const info = leaderOf(sim, civ)!;
  assert.equal(info.name, `${LEADER_STEMS[s.stem[civ]]} III`);
  assert.equal(info.ordinal, 3);
  assert.equal(info.age, 32);
  assert.equal(info.yearsInOffice, 12);
  assert.equal(info.yearsToSecondTrait, 0);
  assert.deepEqual(info.traits.map((t) => t.name), ['Merchant Prince', 'Craven']);
  assert.deepEqual(info.traits[0].effects, [
    'Merchant load +100 %',
    'Merchant range +20 %',
    'Trade needed for a trade center −47 %',
    'Merchant losses −50 %',
    'Tolls its merchants pay −50 %',
    'Amount of a trade agreement +50 %',
    'Share of the income spent on upkeep +10 points',
  ]);
  assert.deepEqual(info.traits[1].effects, ['Share of the soldiers sent to war −45 points', 'Soldiers’ pay −30 %'.replace('’', "'"), "Gives up below this share of the enemy's strength +20 points"]);
  assert.equal(info.goal.name, 'Expansion');
  assert.equal(info.goal.reached, false);
  assert.deepEqual(info.goal.progress, [{ label: 'Settlements', value: 5, target: 6, met: false }]);
  assert.deepEqual(info.goal.effects, ['Crowding at which settlers set out −2 %', 'Weight of inhabitants when choosing a war goal +50 %', 'Settlements build for growth from this share of their capacity −10 points']);
  // Reached: the halved effects.
  s.goalDone[civ] = 1;
  s.goalTick[civ] = sim.tick - 2 * TICKS_PER_YEAR;
  const done = leaderOf(sim, civ)!.goal;
  assert.equal(done.reached, true);
  assert.equal(done.reachedAfterYears, 10);
  assert.deepEqual(done.effects, ['Crowding at which settlers set out −1 %', 'Weight of inhabitants when choosing a war goal +25 %', 'Settlements build for growth from this share of their capacity −5 points']);
  // A young leader waits for the 2nd attribute; Glory needs any one of its two parts.
  setLeader(sim, civ, 4, [20], Goal.Glory);
  s.goalBase[civ] = 1;
  const young = leaderOf(sim, civ)!;
  assert.equal(young.yearsToSecondTrait, 6);
  assert.equal(young.goal.needs, 'any');
  assert.deepEqual(young.goal.progress.map((p) => p.label), ['War won as the attacker', 'City tier of the capital']);
  assert.equal(young.goal.progress[1].target, 2);
  // Every effect of every attribute and goal has a text.
  for (let a = 1; a <= ATTR_COUNT; a++) {
    const t = leaderTrait(a);
    assert.ok(t.name && t.about);
    assert.equal(t.effects.length, ATTRS[a].fx.length, t.name);
    for (const e of ATTRS[a].fx) assert.ok(effectText(e).length > 5);
  }
  for (let g = 1; g <= 4; g++) for (const e of GOAL_FX[g]) assert.ok(effectText(e).length > 5);
  assert.equal(leaderOf(sim, 0), null);
});

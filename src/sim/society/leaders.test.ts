import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../world/generate';
import { ATTRS, ATTR_COUNT, leaderTerms } from './leaderRules';
import { LEADER, LEVERS, LEVER_KIND, warChance, warRatio } from './leaders';
import { TICKS_PER_YEAR, createSimulation, stepSimulation, type Simulation } from './simulation';
import { WAR } from './war';

// Leaders (measuring prototype, "Design Documents/Requirement Anführer.md"): the switch, determinism, the rules that must always hold.

function run(seed: number, years: number, enabled: number): Simulation {
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

test('without leaders the lever sets stay neutral and nobody rules', () => {
  const sim = run(3, 60, 0);
  assert.equal(sim.leaders.has.reduce((a, b) => a + b, 0), 0);
  for (let c = 0; c < 256; c++) {
    for (let k = 0; k < LEVERS; k++) assert.equal(sim.leaders.lev[c * LEVERS + k], LEVER_KIND[k]);
    assert.equal(sim.leaders.sat[c], 0);
  }
  assert.equal(warChance(sim, 1, WAR.chance), WAR.chance);
  assert.equal(warRatio(sim, 1, true, WAR.ratio), WAR.ratio);
});

test('leaders are deterministic per seed and rule every living people', () => {
  const a = run(5, 120, 1);
  const b = run(5, 120, 1);
  assert.deepEqual(leaderTerms(a), leaderTerms(b));
  for (let id = 1; id < a.civs.length; id++) if (a.civs[id]) assert.equal(a.leaders.has[id], 1);
});

test('leaders never break an exclusion, a term lasts 15 to 80 years and the caps hold', () => {
  const sim = run(7, 200, 1);
  assert.equal(sim.leaders.stats.exclusionBreaks, 0);
  for (const t of leaderTerms(sim)) {
    assert.ok(t.attrs.length >= 1 && t.attrs.length <= 3);
    for (const a of t.attrs) assert.ok(a >= 1 && a <= ATTR_COUNT && ATTRS[a].name);
    if (t.end === 0) assert.ok(t.years >= LEADER.deathFrom - LEADER.ageMax && t.years <= 80, `term of ${t.years} years`);
  }
  for (let id = 1; id < sim.civs.length; id++) {
    if (!sim.civs[id]) continue;
    assert.ok(Math.abs(sim.leaders.sat[id]) <= LEADER.capSatisfaction);
    assert.ok(warChance(sim, id, WAR.chance) <= LEADER.capWarChance);
    assert.ok(warRatio(sim, id, true, WAR.ratio) >= LEADER.capRatioMin);
  }
});

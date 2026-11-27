import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../world/generate';
import { PAIRS, relationsOf, tollValue } from './diplomacy';
import { Ab, canCast, castAbility } from './gacha';
import { L, LEVERS } from './leaders';
import { BLOCS, MANDATE, beginMandateYear, loyaltyParts, makeVassal, mandateRealm, reachValue, restlessBelow, vassalOf } from './mandate';
import { Pact } from './pacts';
import { civMandate, hexLoyalty } from './religionInfo';
import { TICKS_PER_YEAR, createSimulation, livingCivilizations, stepSimulation, type Simulation } from './simulation';

// The Mandate ("Design Documents/Requirement Mandat.md", set "ab"): loyalty, legitimacy, blocs and countdowns,
// outcomes, vassals with tribute and their diplomacy through the mother, Decree of Grace.

function runYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR && !sim.gameOver; t++) stepSimulation(sim);
}

/** Seed 3 at year 220: a realm with several settlements. */
function grown(): Simulation {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  runYears(sim, 220);
  return sim;
}

const settledOf = (sim: Simulation, civ: number) => {
  const list: number[] = [];
  for (let c = 0; c < sim.world.cellCount; c++) if (sim.world.owner[c] === civ && sim.cellPop[c] > 0) list.push(c);
  return list;
};

/** The realm with the most settlements and them (its capital first). */
function biggest(sim: Simulation): { civ: number; cells: number[] } {
  const civ = livingCivilizations(sim).sort((a, b) => settledOf(sim, b.id).length - settledOf(sim, a.id).length)[0];
  const cells = settledOf(sim, civ.id).sort((a, b) => (a === civ.capital ? -1 : b === civ.capital ? 1 : a - b));
  return { civ: civ.id, cells };
}

/** The values the loyalty target sums (Mandat 2). */
function target(sim: Simulation, c: number): number {
  const p = loyaltyParts(sim, c);
  return Math.max(0, Math.min(100, MANDATE.base + p.reach + p.satisfaction + p.faith + p.legitimacy + p.garrison + p.reconciled + p.grace));
}

test('loyalty: 50 + reach + satisfaction + faith + legitimacy + garrison; a new settlement starts at its target, then it moves −6 / +2 a year; the capital is always 100', () => {
  const sim = grown();
  const m = sim.mandate;
  const { civ, cells } = biggest(sim);
  const [cap, c] = cells;
  assert.ok(c !== undefined, 'a settlement besides the capital');
  m.loyalty[c] = -1;
  m.rec[c] = 0;
  m.grace[c] = 0;
  beginMandateYear(sim);
  assert.equal(m.loyalty[cap], 100);
  assert.equal(m.restless[cap], 0);
  const p = loyaltyParts(sim, c);
  assert.ok(Math.abs(p.reach - reachValue(sim.seatCost[c])) < 1e-6);
  assert.ok(Math.abs(p.satisfaction - Math.max(MANDATE.satMin, Math.min(MANDATE.satMax, 0.5 * sim.satisfaction[c]))) < 1e-5);
  assert.ok(Math.abs(p.legitimacy - m.legit[civ]) < 1e-6);
  assert.ok(p.faith <= 0 && p.faith >= MANDATE.faithCap);
  assert.ok(p.garrison >= 0 && p.garrison <= MANDATE.garrisonCap);
  assert.ok(Math.abs(m.loyalty[c] - target(sim, c)) < 1e-4, `${m.loyalty[c]} vs ${target(sim, c)}`);
  // A crash of the satisfaction: the loyalty falls at most 6 a year.
  const before = m.loyalty[c];
  sim.satisfaction[c] = -100;
  beginMandateYear(sim);
  assert.ok(Math.abs(m.loyalty[c] - Math.max(target(sim, c), before - MANDATE.fall)) < 1e-4);
  // Back up: at most 2 a year.
  const low = m.loyalty[c];
  sim.satisfaction[c] = 100;
  beginMandateYear(sim);
  assert.ok(Math.abs(m.loyalty[c] - Math.min(target(sim, c), low + MANDATE.rise)) < 1e-4);
  // The reach: +15 near a seat, linear to −25 from cost 8.
  assert.equal(reachValue(0.5), 15);
  assert.equal(reachValue(8), -25);
  assert.equal(reachValue(Infinity), -25);
  assert.ok(Math.abs(reachValue(4.5) - (15 - 40 * (3.5 / 7))) < 1e-9);
});

test('restless below 45 / the rebel lever (Divine Mandate, Tyrant), calm again only at the threshold + 10', () => {
  const sim = grown();
  const m = sim.mandate;
  const { civ, cells } = biggest(sim);
  const c = cells[1];
  const o = civ * LEVERS + L.rebel;
  sim.leaders.lev[o] = 1;
  assert.equal(restlessBelow(sim, civ), 45);
  sim.leaders.lev[o] = 1.2;
  assert.ok(Math.abs(restlessBelow(sim, civ) - 37.5) < 1e-4);
  // Hold the loyalty at its target (no inertia), then move the threshold around it.
  m.loyalty[c] = -1;
  beginMandateYear(sim);
  const L0 = m.loyalty[c];
  const lever = (th: number) => {
    sim.leaders.lev[o] = MANDATE.threshold / th;
    m.loyalty[c] = -1;
    beginMandateYear(sim);
  };
  lever(L0 + 1);
  assert.equal(m.restless[c], 1, 'below the threshold');
  lever(L0 - 5);
  assert.equal(m.restless[c], 1, 'above it but below the threshold + 10: still restless');
  lever(L0 - 11);
  assert.equal(m.restless[c], 0, 'calm again');
  lever(L0 - 5);
  assert.equal(m.restless[c], 0, 'and stays calm above the threshold');
});

/** Makes settlements `cells` restless at loyalty `loyalty` (as if the year's loyalties were done). */
function unrest(sim: Simulation, cells: number[], loyalty: number): void {
  for (const c of cells) {
    sim.mandate.loyalty[c] = loyalty;
    sim.mandate.restless[c] = 1;
  }
}

test('a bloc of restless settlements outweighing half the loyal core starts a countdown of 5-10 years; it ends in reconciliation, or by the dice in independence or autonomy', () => {
  const sim = grown();
  const m = sim.mandate;
  const { civ, cells } = biggest(sim);
  const rest = cells.slice(1);
  assert.ok(rest.length >= 2);
  beginMandateYear(sim);
  m.blocActive.fill(0);
  unrest(sim, rest, 5);
  mandateRealm(sim, civ);
  let id = -1;
  for (let k = 0; k < BLOCS; k++) if (m.blocActive[k] && m.blocCiv[k] === civ) id = k;
  assert.ok(id >= 0, 'a countdown');
  assert.ok(m.blocLen[id] >= MANDATE.countdownMin && m.blocLen[id] <= MANDATE.countdownMin + MANDATE.countdownRoll);
  assert.ok(sim.chronicle.some((e) => e.important && e.text === `Unrest threatens to split the ${sim.civs[civ]!.name}.`));
  assert.ok(rest.some((c) => m.blocId[c] === id));
  // The app's view: "at the latest in N years".
  const h = hexLoyalty(sim, rest.find((c) => m.blocId[c] === id)!)!;
  assert.equal(h.latestIn, MANDATE.countdownMin + MANDATE.countdownRoll);
  assert.ok(h.restless);
  assert.equal(civMandate(sim, civ)!.countdowns.length, 1);
  // The bloc calms down (it weighs <= 0.8 x half the core): reconciliation, +10 loyalty fading, legitimacy +2.
  unrest(sim, rest, 99);
  const reconciled = m.stats.reconcile;
  mandateRealm(sim, civ);
  assert.equal(m.blocActive[id], 0);
  assert.equal(m.stats.reconcile, reconciled + 1);
  assert.ok(rest.every((c) => m.rec[c] === MANDATE.reconcileBonus));
  // A new countdown runs out: independence for sure with autonomy weighed 0 (the rebellion is declared in the war's year steps).
  unrest(sim, rest, 5);
  mandateRealm(sim, civ);
  for (let k = 0; k < BLOCS; k++) if (m.blocActive[k] && m.blocCiv[k] === civ) id = k;
  m.blocStart[id] -= m.blocLen[id];
  const saved = MANDATE.wAutonomy;
  MANDATE.wAutonomy = 0;
  try {
    unrest(sim, rest, 5);
    mandateRealm(sim, civ);
  } finally {
    MANDATE.wAutonomy = saved;
  }
  assert.equal(m.blocActive[id], 0);
  assert.equal(m.stats.independence, 1);
  assert.equal(sim.war.rebelStage, 1, 'the declaration begins');
  assert.equal(sim.war.rebelOf, civ);
});

test('autonomy: the bloc becomes a vassal — allied for good, a truce, trust 70; it pays tribute, its borders and trade follow the mother\'s, no toll between them, it declares no war', () => {
  const sim = grown();
  const m = sim.mandate;
  const { civ, cells } = biggest(sim);
  const rest = cells.slice(1);
  beginMandateYear(sim);
  m.blocActive.fill(0);
  unrest(sim, rest, 5);
  mandateRealm(sim, civ);
  let id = -1;
  for (let k = 0; k < BLOCS; k++) if (m.blocActive[k] && m.blocCiv[k] === civ) id = k;
  m.blocStart[id] -= m.blocLen[id];
  const saved = MANDATE.wAutonomy;
  MANDATE.wAutonomy = 1e9;
  const peoples = livingCivilizations(sim).length;
  try {
    unrest(sim, rest, 5);
    mandateRealm(sim, civ);
  } finally {
    MANDATE.wAutonomy = saved;
  }
  assert.equal(m.stats.autonomy, 1);
  const vassals = livingCivilizations(sim).filter((c) => vassalOf(sim, c.id) === civ);
  assert.ok(vassals.length >= 1 && vassals.length <= MANDATE.vassalMax);
  assert.ok(livingCivilizations(sim).length > peoples);
  const v = vassals[0].id;
  assert.equal(sim.war.pact[v * PAIRS + civ], Pact.Alliance);
  assert.ok(sim.war.truce[civ * PAIRS + v] > sim.tick);
  assert.equal(sim.diplomacy.trust[v * PAIRS + civ], MANDATE.vassalTrust);
  assert.ok(sim.chronicle.some((e) => e.important && e.text.endsWith('and became their vassal.')));
  // No toll between them; the diplomacy panel of the vassal shows only the mother.
  assert.equal(tollValue(sim, vassals[0].capital, v, civ, false), 0);
  assert.equal(tollValue(sim, sim.civs[civ]!.capital, civ, v, false), 0);
  // A year on: still allied whatever the trust, open borders and free trade with the mother, the third peoples' as the mother's.
  sim.diplomacy.trust[v * PAIRS + civ] = 0;
  runYears(sim, 1);
  if (sim.civs[v] && vassalOf(sim, v) === civ) {
    const dip = sim.diplomacy;
    assert.equal(sim.war.pact[v * PAIRS + civ], Pact.Alliance);
    assert.equal(dip.open[v * PAIRS + civ], 1);
    assert.equal(dip.freeTrade[v * PAIRS + civ], 1);
    for (const x of livingCivilizations(sim)) {
      if (x.id === v || x.id === civ) continue;
      assert.equal(dip.open[v * PAIRS + x.id], dip.open[civ * PAIRS + x.id]);
      assert.equal(dip.open[x.id * PAIRS + v], dip.open[x.id * PAIRS + civ]);
      assert.equal(dip.freeTrade[v * PAIRS + x.id], dip.freeTrade[civ * PAIRS + x.id]);
      assert.notEqual(sim.war.pact[v * PAIRS + x.id], Pact.Pact);
    }
    assert.ok(relationsOf(sim, v).every((r) => r.other === civ));
    const info = civMandate(sim, civ)!;
    assert.ok(info.vassals.some((x) => x.civ === v));
    assert.equal(info.tributeGot, info.vassals.reduce((a, x) => a + x.tribute, 0));
    assert.equal(civMandate(sim, v)!.vassalOf, civ);
  }
  // A vassal never declares a war.
  const declaredBy = () => {
    let n = 0;
    for (let s = 0; s < sim.war.wLive.length; s++) if (sim.war.wLive[s] && !sim.war.wRebel[s] && vassalOf(sim, sim.war.wAtt[s]) >= 0) n++;
    return n;
  };
  for (let y = 0; y < 10; y++) {
    runYears(sim, 1);
    assert.equal(declaredBy(), 0);
  }
});

test('legitimacy: tenure +1 per 3 years (at most 6), a new ruler −8 (an heir who inherited from the predecessor −4) fading x0.9, old age, worship +3', () => {
  const sim = grown();
  const m = sim.mandate;
  const s = sim.leaders;
  const civ = livingCivilizations(sim).find((c) => s.has[c.id])!.id;
  const legit = (heir: boolean) => {
    s.start[civ] = sim.tick - 9 * TICKS_PER_YEAR;
    s.age0[civ] = 30;
    m.legitEvents[civ] = 0;
    m.succ[civ] = 0;
    m.seenCounter[civ] = s.counter[civ] - 1;
    s.inheritedLast[civ] = heir ? 1 : 0;
    sim.gacha.godLegit[civ] = 0;
    beginMandateYear(sim);
    return m.legit[civ];
  };
  const worship = sim.civs[civ]!.worshipsPlayer ? MANDATE.worship : 0;
  // 9 years in office: +3; age 39: nothing.
  assert.ok(Math.abs(legit(false) - (3 + MANDATE.succession * MANDATE.successionFade + worship)) < 1e-5);
  assert.ok(Math.abs(legit(true) - (3 + MANDATE.dynasty * MANDATE.successionFade + worship)) < 1e-5);
  // Old: 70 years: −0.2 per year over 60, at most −4.
  s.age0[civ] = 61;
  m.succ[civ] = 0;
  m.legitEvents[civ] = 0;
  beginMandateYear(sim);
  assert.ok(Math.abs(m.legit[civ] - (3 - 2 + worship)) < 1e-5);
});

test('Decree of Grace (Mandat 9): only on a people with unrest; legitimacy +10 for 20 years, every settlement\'s loyalty +6 at once (fading)', () => {
  const sim = grown();
  const m = sim.mandate;
  const { civ, cells } = biggest(sim);
  beginMandateYear(sim);
  m.blocActive.fill(0);
  for (const c of cells) m.restless[c] = 0;
  sim.gacha.charges[Ab.DecreeOfGrace] = 2;
  assert.equal(canCast(sim, Ab.DecreeOfGrace, civ), false, 'no unrest');
  m.restless[cells[1]] = 1;
  assert.ok(canCast(sim, Ab.DecreeOfGrace, civ));
  const before = m.loyalty[cells[1]];
  assert.ok(castAbility(sim, Ab.DecreeOfGrace, civ));
  assert.equal(sim.gacha.godLegit[civ], 10);
  assert.equal(m.grace[cells[1]], MANDATE.grace);
  assert.ok(Math.abs(m.loyalty[cells[1]] - Math.min(100, before + MANDATE.grace)) < 1e-4);
  assert.equal(m.loyalty[cells[0]], 100, 'the capital stays at 100');
  beginMandateYear(sim);
  assert.ok(Math.abs(m.grace[cells[1]] - (MANDATE.grace - MANDATE.grace / MANDATE.graceYears)) < 1e-5);
  assert.ok(civMandate(sim, civ)!.legitimacyTerms.some((t) => t.label === 'Decree of Grace' && t.value === 10));
});

test('a vassal whose mother is gone is free; makeVassal links two peoples', () => {
  const sim = grown();
  const [a, b] = livingCivilizations(sim).map((c) => c.id);
  makeVassal(sim, b, a);
  assert.equal(vassalOf(sim, b), a);
  assert.equal(sim.war.pact[a * PAIRS + b], Pact.Alliance);
  // The mother vanishes: at the vassal's yearly roll it is free, silently.
  sim.civs[a] = null;
  sim.war.restless.fill(0);
  mandateRealm(sim, b);
  assert.equal(vassalOf(sim, b), -1);
  assert.equal(sim.mandate.stats.vassalFreed, 1);
});

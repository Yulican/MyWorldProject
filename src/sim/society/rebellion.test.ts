import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRECTION_COUNT, hexDistance } from '../hex';
import { generateWorld } from '../world/generate';
import { hasRoad } from '../world/roads';
import { BUILDINGS, GOV_SLOT, Good, SLOTS, SlotState } from './buildings';
import { PAIRS } from './diplomacy';
import { Pact } from './pacts';
import { MIL, TROOP_TYPES, Troop, updateMilitary } from './military';
import { MOOD_NEW_PEOPLE, MOOD_REVOLUTION_LOST, MOOD_REVOLUTION_WON, addMood, cellOwners, hasSeat } from './satisfaction';
import { TICKS_PER_YEAR, createSimulation, livingCivilizations, splitCutOffLand, stepSimulation, type Simulation } from './simulation';
import { REBEL_CHECK, checkRebellion, continueRebellion, countRestless, inRebellion, isDissatisfied, measureRebellion, militiaOf, startRebellion } from './rebellion';
import { ArmyState, EndType, MAX_ARMIES, MAX_GOALS, WAR, advanceWar, disbandArmy, endWar, finishGathering, rallyPoint, runWarYear, startWar } from './war';

// War phase 5 ("Design Documents/Requirement Krieg.md", section 8): uprisings as war.

const SEAT = BUILDINGS.findIndex((b) => b.good === Good.Seat);
const MOTHER = 1;

function runYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR; t++) stepSimulation(sim);
}

/** One week of war alone (no other part of the simulation runs). */
function week(sim: Simulation): void {
  sim.tick++;
  advanceWar(sim);
}

/** Seed 12 at year 200: no war yet; people 1 has 24 settlements in 4 road-joined groups around its capital. */
function grown(): Simulation {
  const sim = createSimulation(generateWorld({ seed: 12 }));
  runYears(sim, 200);
  assert.equal(sim.war.wars, 0);
  return sim;
}

const settledOf = (sim: Simulation, civ: number) => {
  const list: number[] = [];
  for (let c = 0; c < sim.world.cellCount; c++) if (sim.world.owner[c] === civ && sim.cellPop[c] > 0) list.push(c);
  return list;
};

function placeSeat(sim: Simulation, cell: number): void {
  for (let s = cell * SLOTS + GOV_SLOT; s < (cell + 1) * SLOTS; s++) {
    if (sim.economy.state[s] !== SlotState.Empty) continue;
    sim.economy.type[s] = SEAT;
    sim.economy.state[s] = SlotState.Standing;
    sim.hasBuildings[cell] = 1;
    return;
  }
  throw new Error('no free government slot');
}

/** The settlements of `civ` but `capital`, grouped by roads between them (as rebellion.ts groups them). */
function roadGroups(sim: Simulation, civ: number, capital: number): number[][] {
  const world = sim.world;
  const own = settledOf(sim, civ).filter((c) => c !== capital);
  const inSet = new Set(own);
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const start of own) {
    if (seen.has(start)) continue;
    const cells = [start];
    seen.add(start);
    for (let k = 0; k < cells.length; k++) {
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        if (!hasRoad(world, cells[k], d)) continue;
        const nb = world.neighbors[cells[k] * DIRECTION_COUNT + d];
        if (nb >= 0 && inSet.has(nb) && !seen.has(nb)) {
          seen.add(nb);
          cells.push(nb);
        }
      }
    }
    groups.push(cells);
  }
  return groups;
}

/** Makes the given settlements dissatisfied (satisfaction −10). */
function dissatisfy(sim: Simulation, cells: number[]): void {
  for (const c of cells) sim.satisfaction[c] = -10;
}

/** The rebel groups of rebellion `s`. */
function groupsOf(sim: Simulation, s: number): number[] {
  const list: number[] = [];
  for (let p = 1; p < sim.civs.length; p++) if (sim.civs[p] && sim.war.rebelMother[p] === sim.war.wAtt[s] && sim.war.side[s * PAIRS + p] === 1) list.push(p);
  return list;
}

/** Disbands every army of the rebel side of war `s`. */
function disbandRebels(sim: Simulation, s: number): void {
  const w = sim.war;
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a] && w.aWar[a] === s && w.side[s * PAIRS + w.aCiv[a]] === 1) disbandArmy(sim, a);
}

test('dissatisfied means satisfaction below 0 now: no years, no size, never the capital', () => {
  const sim = grown();
  const cap = sim.civs[MOTHER]!.capital;
  const c = settledOf(sim, MOTHER).find((x) => x !== cap)!;
  sim.unhappyQuarters[c] = 0;
  sim.satisfaction[c] = -0.5;
  assert.ok(isDissatisfied(sim, c, MOTHER));
  sim.satisfaction[c] = 0;
  assert.ok(!isDissatisfied(sim, c, MOTHER));
  sim.satisfaction[cap] = -90;
  assert.ok(!isDissatisfied(sim, cap, MOTHER));
  // The yearly count: one settlement of the mother.
  for (const x of settledOf(sim, MOTHER)) if (x !== cap) sim.satisfaction[x] = 10;
  sim.satisfaction[c] = -1;
  countRestless(sim);
  assert.equal(sim.war.restless[MOTHER], 1);
});

test('the rebels rise when their soldiers plus 2.5 % militia outweigh the mother without those soldiers but with her pacts and alliances', () => {
  const sim = grown();
  const m = sim.military;
  const cap = sim.civs[MOTHER]!.capital;
  const rebels = settledOf(sim, MOTHER).filter((c) => c !== cap).slice(0, 6);
  // Soldiers in two rebel settlements, one with its strategic good.
  for (const c of rebels) m.soldiers.fill(0, c * TROOP_TYPES, c * TROOP_TYPES + TROOP_TYPES);
  m.soldiers[rebels[0] * TROOP_TYPES + Troop.Melee] = 6;
  m.covered[rebels[0] * TROOP_TYPES + Troop.Melee] = 1;
  m.soldiers[rebels[1] * TROOP_TYPES + Troop.Ranged] = 4;
  m.covered[rebels[1] * TROOP_TYPES + Troop.Ranged] = 0;
  for (const c of settledOf(sim, MOTHER)) sim.satisfaction[c] = 10;
  dissatisfy(sim, rebels);
  let soldiers = 0;
  let militia = 0;
  for (const c of rebels) {
    for (let t = 0; t < TROOP_TYPES; t++) soldiers += m.soldiers[c * TROOP_TYPES + t] * (m.covered[c * TROOP_TYPES + t] ? MIL.factor : 1);
    militia += Math.min(Math.floor(0.025 * sim.cellPop[c]), sim.cellAdults[c]);
  }
  assert.equal(WAR.militia, 0.025);
  assert.ok(militia > 0);
  assert.equal(soldiers, 6 * MIL.factor + 4);
  // The mother: her strength without the rebels' soldiers.
  m.strength[MOTHER] = soldiers + soldiers + militia - 1;
  assert.equal(measureRebellion(sim, MOTHER), true);
  assert.equal(REBEL_CHECK.rebels, soldiers + militia);
  assert.equal(REBEL_CHECK.mother, soldiers + militia - 1);
  // Equal is not enough.
  m.strength[MOTHER] = soldiers + soldiers + militia;
  assert.equal(measureRebellion(sim, MOTHER), false);
  // A pact partner counts for the mother.
  m.strength[MOTHER] = soldiers + soldiers + militia - 1;
  const partner = 2;
  m.strength[partner] = 3;
  sim.war.pact[MOTHER * PAIRS + partner] = Pact.Pact;
  sim.war.pact[partner * PAIRS + MOTHER] = Pact.Pact;
  sim.war.pactCount++;
  assert.equal(measureRebellion(sim, MOTHER), false);
  assert.equal(REBEL_CHECK.mother, soldiers + militia + 2);
  assert.equal(checkRebellion(sim, MOTHER), false);
  // Without the pact: the rebellion begins.
  sim.war.pact[MOTHER * PAIRS + partner] = Pact.None;
  sim.war.pact[partner * PAIRS + MOTHER] = Pact.None;
  sim.war.pactCount--;
  assert.equal(checkRebellion(sim, MOTHER), true);
  // The declaration goes on in the next steps of the war's year: a people per group, the change of sides, the war.
  const groups = sim.war.rebelPicked;
  assert.ok(groups >= 1);
  for (let k = 0; k < groups; k++) {
    assert.equal(sim.war.rebelStage, 1);
    assert.equal(continueRebellion(sim), -1);
    assert.equal(sim.war.rebelCount, k + 1);
  }
  assert.equal(sim.war.rebelStage, 2);
  assert.equal(continueRebellion(sim), -1);
  assert.equal(sim.war.stats.rebDeclared, 1);
  for (const c of rebels) assert.notEqual(sim.world.owner[c], MOTHER);
  const s = continueRebellion(sim);
  assert.ok(s >= 0);
  assert.equal(sim.war.rebelStage, 0);
  assert.equal(sim.war.wRebel[s], 1);
  assert.equal(sim.war.raiseWar, s, 'its armies follow one side member per step');
});

test('one new people per road-joined group (the largest MAX_GOALS), allied with each other; capital: the seat with most people, else the largest settlement', () => {
  const sim = grown();
  const parent = sim.civs[MOTHER]!;
  const cap = parent.capital;
  const groups = roadGroups(sim, MOTHER, cap).sort((a, b) => b.reduce((n, c) => n + sim.cellPop[c], 0) - a.reduce((n, c) => n + sim.cellPop[c], 0));
  assert.ok(groups.length >= 2 && groups.length <= MAX_GOALS, `${groups.length} groups`);
  const seated = (c: number) => sim.hasBuildings[c] === 1 && hasSeat(sim.economy, c);
  // A seat in the smallest settlement of a group of several without one: it becomes that group's capital.
  const withSeat = groups.find((g) => g.length >= 2 && !g.some(seated))!;
  assert.ok(withSeat, 'a group without a seat');
  const small = [...withSeat].sort((a, b) => sim.cellPop[a] - sim.cellPop[b])[0];
  placeSeat(sim, small);
  assert.ok(withSeat.some((c) => sim.cellPop[c] > sim.cellPop[small]));
  const pop = new Map<number, number>();
  for (const g of groups) for (const c of g) pop.set(c, sim.cellPop[c]);
  dissatisfy(sim, groups.flat());
  const s = startRebellion(sim, MOTHER);
  assert.ok(s >= 0);
  const rebels = groupsOf(sim, s);
  assert.equal(rebels.length, groups.length);
  for (const g of groups) {
    const civ = sim.world.owner[g[0]];
    assert.ok(rebels.includes(civ));
    // The whole group went to one new people, and only it.
    for (const c of g) assert.equal(sim.world.owner[c], civ);
    assert.equal(settledOf(sim, civ).length, g.length);
    const rebel = sim.civs[civ]!;
    assert.equal(rebel.origin, 'revolution');
    assert.equal(rebel.parentName, parent.name);
    assert.ok(rebel.moods.some((x) => x.label === 'A new people' && x.value === MOOD_NEW_PEOPLE));
    // The seat with the most people, else the most populous settlement.
    const seats = g.filter(seated);
    const pool = seats.length > 0 ? seats : g;
    const most = Math.max(...pool.map((c) => pop.get(c)!));
    assert.ok(pool.includes(rebel.capital));
    assert.equal(pop.get(rebel.capital), most);
    if (g === withSeat) assert.equal(rebel.capital, small);
  }
  for (const a of rebels) for (const b of rebels) if (a !== b) assert.equal(sim.war.pact[a * PAIRS + b], Pact.Alliance);
  // The capital stays with the mother; one goal seat per group.
  assert.equal(sim.world.owner[cap], MOTHER);
  assert.equal(sim.war.wGoalN[s], groups.length);
  assert.ok(sim.chronicle.some((e) => e.text.startsWith('Rebellion: ') && e.text.includes(`rose up against the ${parent.name}`)));
});

test('the mother takes the rebel seats one by one, the nearest first; an occupied seat stays occupied; all taken: every group annexed with “Conquered” −15', () => {
  const sim = grown();
  const w = sim.war;
  const m = sim.military;
  const cap = sim.civs[MOTHER]!.capital;
  // A strong mother army.
  m.soldiers[cap * TROOP_TYPES + Troop.Melee] = 3000;
  m.covered[cap * TROOP_TYPES + Troop.Melee] = 1;
  m.strength[MOTHER] = 3000 * MIL.factor;
  const s = startRebellion(sim, MOTHER, true);
  assert.ok(s >= 0);
  const rebels = groupsOf(sim, s);
  const goals = Array.from(w.wGoals.subarray(s * MAX_GOALS, s * MAX_GOALS + w.wGoalN[s]));
  assert.ok(goals.length >= 2);
  for (let i = 0; i < goals.length; i++) assert.equal(sim.civs[sim.world.owner[goals[i]]]!.capital, goals[i]);
  // The first goal is the seat nearest the mother's capital.
  const nearest = [...goals].sort((a, b) => hexDistance(sim.world, cap, a) - hexDistance(sim.world, cap, b) || a - b)[0];
  assert.equal(w.wGoal[s], nearest);
  disbandRebels(sim, s);
  for (let a = 0; a < MAX_ARMIES; a++) {
    finishGathering(sim, a);
    if (w.live[a] && w.aWar[a] === s && w.aCiv[a] === MOTHER) w.aCell[a] = w.wGoal[s];
  }
  for (const g of goals) sim.satisfaction[g] = -50;
  const order = [w.wGoal[s]];
  let left = goals.filter((g) => g !== w.wGoal[s]);
  for (let t = 0; t < 400 * 52 && w.wLive[s]; t++) {
    disbandRebels(sim, s);
    week(sim);
    if (!w.wLive[s]) break;
    if (w.wGoal[s] !== order[order.length - 1]) {
      // The next goal is the nearest rebel seat left from the one just taken, which stays besieged.
      const prev = order[order.length - 1];
      const expect = [...left].sort((a, b) => hexDistance(sim.world, prev, a) - hexDistance(sim.world, prev, b) || a - b)[0];
      assert.equal(w.wGoal[s], expect);
      assert.equal(w.siege[prev], 1);
      order.push(w.wGoal[s]);
      left = left.filter((g) => g !== w.wGoal[s]);
    }
    for (const g of goals) sim.satisfaction[g] = -50;
    // An army that has nothing to do goes home; put the besiegers back on their way.
    if (w.armies === 0) break;
  }
  assert.equal(w.wLive[s], 0, 'the rebellion ended');
  assert.equal(order.length, goals.length, `${order.length} of ${goals.length} seats taken`);
  assert.equal(w.stats.rebCrushed, 1);
  for (const r of rebels) assert.equal(settledOf(sim, r).length, 0);
  for (const g of goals) {
    assert.equal(sim.world.owner[g], MOTHER);
    assert.equal(w.conqValue[g], -WAR.conqMalus);
    assert.equal(w.siege[g], 0);
    assert.equal(w.militia[g], 0);
  }
  assert.equal(w.motherBusy[MOTHER], 0);
  assert.ok(sim.chronicle.some((e) => e.text.includes('crushed the rebellion')));
  assert.ok(sim.chronicle.some((e) => e.text.includes('occupied the rebel seat')));
});

test('the mother never gives up; the rebels give up only once one of their seats is occupied, and are annexed then', () => {
  const sim = grown();
  const w = sim.war;
  const chance = WAR.chance;
  WAR.chance = 0;
  try {
    const s = startRebellion(sim, MOTHER, true);
    assert.ok(s >= 0);
    const rebels = groupsOf(sim, s);
    // The mother far weaker than the rebels: she fights on.
    sim.military.strength[MOTHER] = 0.01;
    for (const r of rebels) sim.military.strength[r] = 1000;
    runWarYear(sim);
    assert.equal(w.wLive[s], 1);
    // The rebels far weaker, no seat occupied yet: they fight on.
    sim.military.strength[MOTHER] = 1000;
    for (const r of rebels) sim.military.strength[r] = 0.01;
    runWarYear(sim);
    assert.equal(w.wLive[s], 1);
    // A seat occupied: they give up below 40 % and every group goes back to the mother.
    w.wOccupied[s] = 1;
    runWarYear(sim);
    assert.equal(w.wLive[s], 0);
    assert.equal(w.stats.rebGaveUp, 1);
    for (const r of rebels) assert.equal(settledOf(sim, r).length, 0);
    assert.ok(sim.chronicle.some((e) => e.text.startsWith('The rebels gave up')));
  } finally {
    WAR.chance = chance;
  }
});

test('10 years without an occupation: the rebels stay independent, “Won its revolution” +20, the mother “Lost a revolution” −5, trust −30, 20 years of truce', () => {
  const sim = grown();
  const w = sim.war;
  const chance = WAR.chance;
  WAR.chance = 0;
  try {
    const s = startRebellion(sim, MOTHER, true);
    const rebels = groupsOf(sim, s);
    const cells = new Map(rebels.map((r) => [r, settledOf(sim, r)]));
    w.wLastGain[s] = sim.tick - WAR.exhaustYears * TICKS_PER_YEAR;
    runWarYear(sim);
    assert.equal(w.wLive[s], 0);
    assert.equal(w.stats.rebExhausted, 1);
    const mother = sim.civs[MOTHER]!;
    assert.ok(mother.moods.some((x) => x.label === 'Lost a revolution' && x.value === MOOD_REVOLUTION_LOST));
    for (const r of rebels) {
      const civ = sim.civs[r]!;
      for (const c of cells.get(r)!) assert.equal(sim.world.owner[c], r);
      assert.ok(civ.moods.some((x) => x.label === 'Won its revolution' && x.value === MOOD_REVOLUTION_WON));
      assert.equal(w.rebelMother[r], 0);
      assert.equal(w.enemy[r], 0);
      assert.ok(sim.tick < w.truce[Math.min(r, MOTHER) * PAIRS + Math.max(r, MOTHER)]);
      assert.equal(w.truce[Math.min(r, MOTHER) * PAIRS + Math.max(r, MOTHER)], sim.tick + WAR.truceYears * TICKS_PER_YEAR);
      const moods = sim.diplomacy.moods.get(MOTHER * PAIRS + r) ?? [];
      assert.ok(moods.some((x) => x.label === 'War' && x.value === -WAR.trustLoss));
    }
    assert.equal(w.enemy[MOTHER], 0);
    assert.equal(w.motherBusy[MOTHER], 0);
  } finally {
    WAR.chance = chance;
  }
});

test('the militia fights unpaid, without goods or buildings, and goes back to the people at the war’s end', () => {
  const sim = grown();
  const w = sim.war;
  const m = sim.military;
  const cap = sim.civs[MOTHER]!.capital;
  const own = settledOf(sim, MOTHER).filter((c) => c !== cap);
  const before = new Map(own.map((c) => [c, { pop: sim.cellPop[c], melee: m.soldiers[c * TROOP_TYPES + Troop.Melee], militia: militiaOf(sim, c) }]));
  const s = startRebellion(sim, MOTHER, true);
  disbandRebels(sim, s);
  let raised = 0;
  for (const c of own) {
    const b = before.get(c)!;
    assert.equal(w.militia[c], b.militia);
    assert.equal(m.soldiers[c * TROOP_TYPES + Troop.Melee], b.melee + b.militia);
    assert.equal(sim.cellPop[c], b.pop - b.militia);
    raised += b.militia;
  }
  assert.ok(raised > 0);
  // The yearly military update keeps it without a building or pay; it counts once, without the strategic factor.
  const rebel = sim.world.owner[own[0]];
  for (const c of own) m.covered[c * TROOP_TYPES + Troop.Melee] = 1;
  updateMilitary(sim, sim.world.owner);
  for (const c of own) assert.ok(m.soldiers[c * TROOP_TYPES + Troop.Melee] >= w.militia[c]);
  let expect = 0;
  for (const c of own) {
    if (sim.world.owner[c] !== rebel) continue;
    for (let t = 0; t < TROOP_TYPES; t++) {
      const i = c * TROOP_TYPES + t;
      const mil = t === Troop.Melee ? w.militia[c] : 0;
      expect += (m.soldiers[i] - mil) * (m.covered[i] ? MIL.factor : 1) + mil;
    }
  }
  assert.ok(Math.abs(m.strength[rebel] - expect) < 1e-9);
  // Peace: back to the people.
  for (const c of own) m.release[c] = 0;
  const pops = new Map(own.map((c) => [c, sim.cellPop[c]]));
  endWar(sim, s, EndType.Exhausted);
  for (const c of own) {
    assert.equal(w.militia[c], 0);
    assert.equal(sim.cellPop[c], pops.get(c)! + before.get(c)!.militia);
  }
  assert.equal(w.stats.militiaBack, raised);
});

test('a people in a running rebellion (either side) sees no other rebellion', () => {
  const sim = grown();
  const s = startRebellion(sim, MOTHER);
  assert.equal(s, -1, 'nobody dissatisfied: no rebellion');
  const cap = sim.civs[MOTHER]!.capital;
  const groups = roadGroups(sim, MOTHER, cap);
  dissatisfy(sim, groups[0]);
  const s2 = startRebellion(sim, MOTHER);
  assert.ok(s2 >= 0);
  const rebel = sim.world.owner[groups[0][0]];
  assert.ok(inRebellion(sim, MOTHER) && inRebellion(sim, rebel));
  // Everyone dissatisfied now, on both sides, and far stronger than anyone.
  for (let c = 0; c < sim.world.cellCount; c++) sim.satisfaction[c] = -50;
  sim.military.strength[MOTHER] = 0;
  sim.military.strength[rebel] = 0;
  countRestless(sim);
  assert.equal(sim.war.restless[MOTHER], 0);
  assert.equal(sim.war.restless[rebel], 0);
  assert.equal(checkRebellion(sim, MOTHER), false);
  assert.equal(checkRebellion(sim, rebel), false);
  assert.equal(startRebellion(sim, MOTHER, true), -1);
  // A mother in a rebellion declares no other war (she may be attacked: see the two-front test).
  assert.equal(sim.war.motherBusy[MOTHER], 1);
});

test('the mother’s pacts and alliances join her; a third people that fears her, distrusts her and has no pact with her joins the rebels if that makes them the stronger', () => {
  const sim = grown();
  const w = sim.war;
  const dip = sim.diplomacy;
  const m = sim.military;
  const others = livingCivilizations(sim).map((c) => c.id).filter((p) => p !== MOTHER);
  assert.ok(others.length >= 3);
  const [ally, helper, weak] = others;
  // The mother's ally.
  w.pact[MOTHER * PAIRS + ally] = Pact.Alliance;
  w.pact[ally * PAIRS + MOTHER] = Pact.Alliance;
  w.pactCount++;
  // The helper fears the mother and distrusts her.
  const fear = (p: number, danger: number, trust: number) => {
    dip.known[p * PAIRS + MOTHER] = 1;
    dip.known[MOTHER * PAIRS + p] = 1;
    dip.danger[p * PAIRS + MOTHER] = danger;
    dip.trust[p * PAIRS + MOTHER] = trust;
  };
  fear(helper, 60, 20);
  fear(weak, 49, 20);
  fear(ally, 90, 0);
  m.strength[MOTHER] = 50;
  m.strength[ally] = 20;
  m.strength[helper] = 500;
  m.strength[weak] = 500;
  const cap = sim.civs[MOTHER]!.capital;
  const groups = roadGroups(sim, MOTHER, cap);
  dissatisfy(sim, groups.flat());
  const s = startRebellion(sim, MOTHER);
  assert.ok(s >= 0);
  assert.equal(w.side[s * PAIRS + ally], 0, 'the ally joins the mother');
  assert.equal(w.side[s * PAIRS + helper], 1, 'the helper joins the rebels');
  assert.equal(w.side[s * PAIRS + weak], -1, 'danger below 50: no help');
  assert.equal(w.stats.rebHelpers, 1);
  assert.equal(w.stats.rebMotherAllies, 1);
});

test('helpers stay out when the rebel side would still not be the stronger', () => {
  const sim = grown();
  const dip = sim.diplomacy;
  const m = sim.military;
  const helper = livingCivilizations(sim).map((c) => c.id).find((p) => p !== MOTHER)!;
  dip.known[helper * PAIRS + MOTHER] = 1;
  dip.danger[helper * PAIRS + MOTHER] = 80;
  dip.trust[helper * PAIRS + MOTHER] = 10;
  m.strength[MOTHER] = 1e6;
  m.strength[helper] = 1;
  const cap = sim.civs[MOTHER]!.capital;
  dissatisfy(sim, roadGroups(sim, MOTHER, cap).flat());
  const s = startRebellion(sim, MOTHER);
  assert.ok(s >= 0);
  assert.equal(sim.war.side[s * PAIRS + helper], -1);
});

test('rebellions come from the yearly check in the war’s year, one realm per step, and run the same for the same seed', () => {
  const run = () => {
    const sim = grown();
    const cap = sim.civs[MOTHER]!.capital;
    const own = settledOf(sim, MOTHER).filter((c) => c !== cap);
    for (const c of own) {
      sim.satisfaction[c] = -80;
      sim.moodSet[c] = 1;
    }
    addMood(sim.civs[MOTHER]!, 'Test hardship', -200, sim.tick);
    runYears(sim, 30);
    const w = sim.war;
    return {
      chronicle: sim.chronicle.map((e) => `${e.tick} ${e.text}`).join('\n'),
      owner: Array.from(sim.world.owner),
      stats: JSON.stringify({ ...w.stats, weekMs: 0, weekMax: 0, yearMs: 0, yearMax: 0 }),
      armies: Array.from(w.aCell),
      declared: w.stats.rebDeclared,
    };
  };
  const a = run();
  const b = run();
  assert.ok(a.declared >= 1, 'a rebellion was declared');
  assert.ok(a.chronicle.includes('Rebellion: '));
  assert.equal(a.chronicle, b.chronicle);
  assert.deepEqual(a.owner, b.owner);
  assert.equal(a.stats, b.stats);
  assert.deepEqual(a.armies, b.armies);
});

test('land cut off from its capital still splits off at once as its own people, without a war, dissatisfied or not', () => {
  const sim = grown();
  const world = sim.world;
  const cap = sim.civs[MOTHER]!.capital;
  const g = roadGroups(sim, MOTHER, cap).sort((a, b) => b.length - a.length)[0];
  const inG = new Set(g);
  // Cut the group's roads to everything outside it.
  for (const c of g) {
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || inG.has(nb) || !hasRoad(world, c, d)) continue;
      world.roads[c] &= ~(1 << d);
      for (let e = 0; e < DIRECTION_COUNT; e++) if (world.neighbors[nb * DIRECTION_COUNT + e] === c) world.roads[nb] &= ~(1 << e);
    }
  }
  dissatisfy(sim, g);
  sim.diplomacy.bordersVersion++;
  const owner = cellOwners(sim);
  splitCutOffLand(sim, owner);
  const civ = sim.civs[owner[g[0]]]!;
  assert.notEqual(civ.id, MOTHER);
  assert.equal(civ.origin, 'secession');
  for (const c of g) assert.equal(owner[c], civ.id);
  assert.equal(sim.war.wars, 0);
  assert.equal(sim.war.rebelMother[civ.id], 0);
  assert.ok(sim.chronicle.some((e) => e.text.includes(`cut off from the ${sim.civs[MOTHER]!.name}`)));
});

test('a mother in a rebellion can be attacked: two fronts within her 4 armies (1 against the rebels with a quarter of the share, 3 to defend), each war ends on its own', () => {
  const sim = grown();
  const w = sim.war;
  const m = sim.military;
  const cap = sim.civs[MOTHER]!.capital;
  const groups = roadGroups(sim, MOTHER, cap).sort((a, b) => b.length - a.length);
  // Seats in two settlements that stay with the mother, for her relief armies.
  const stay = groups.slice(1).flat();
  for (const c of stay.slice(0, 2)) placeSeat(sim, c);
  for (const c of settledOf(sim, MOTHER)) m.soldiers[c * TROOP_TYPES + Troop.Melee] += 40;
  dissatisfy(sim, groups[0]);
  const s = startRebellion(sim, MOTHER);
  assert.ok(s >= 0);
  const leader = w.wDef[s];
  const motherArmies = (war: number) => {
    let n = 0;
    let soldiers = 0;
    for (let a = 0; a < MAX_ARMIES; a++) {
      if (!w.live[a] || w.aCiv[a] !== MOTHER || w.aWar[a] !== war) continue;
      n++;
      for (let t = 0; t < TROOP_TYPES; t++) soldiers += w.aN[a * TROOP_TYPES + t];
    }
    return { n, soldiers };
  };
  for (let a = 0; a < MAX_ARMIES; a++) finishGathering(sim, a);
  const before = motherArmies(s);
  assert.equal(before.n, 1);
  assert.ok(before.soldiers > 0);
  // A rebel group is still no target; the mother is.
  const att = livingCivilizations(sim).map((c) => c.id).find((p) => p !== MOTHER && w.rebelMother[p] === 0)!;
  assert.equal(startWar(sim, att, sim.civs[leader]!.capital), -1);
  const s2 = startWar(sim, att, cap);
  assert.ok(s2 >= 0);
  assert.equal(w.stats.vsRebelMother, 1);
  assert.equal(w.enemy[MOTHER], att);
  assert.equal(w.civWar[MOTHER], s2);
  for (let a = 0; a < MAX_ARMIES; a++) finishGathering(sim, a);
  // The rebel front keeps a quarter of its army; the rest went home and defends in up to 3 relief armies.
  const rebelFront = motherArmies(s);
  const defense = motherArmies(s2);
  assert.equal(rebelFront.n, 1);
  assert.ok(Math.abs(rebelFront.soldiers - before.soldiers / 4) <= TROOP_TYPES, `${rebelFront.soldiers} of ${before.soldiers}`);
  // Her soldiers away against the rebels are not at home: she defends with what is there (here: the garrison).
  assert.ok(defense.n <= WAR.reliefArmies, `${defense.n} defending armies`);
  assert.ok(rebelFront.n + defense.n <= WAR.maxArmies);
  // The three quarters that left the rebel army walk home: away, not in any army, not available to defend yet.
  const walkers = () => {
    let n = 0;
    for (let c = 0; c < sim.world.cellCount; c++) if (sim.world.owner[c] === MOTHER) for (let t = 0; t < TROOP_TYPES; t++) n += w.homeN[c * TROOP_TYPES + t];
    return n;
  };
  const walking = walkers();
  assert.ok(Math.abs(walking - (before.soldiers - rebelFront.soldiers)) <= TROOP_TYPES, `${walking} walking`);
  // Soldiers count once: away = in the mother's armies + walking home.
  const awaySum = () => {
    let n = 0;
    for (let c = 0; c < sim.world.cellCount; c++) if (sim.world.owner[c] === MOTHER) for (let t = 0; t < TROOP_TYPES; t++) n += w.away[c * TROOP_TYPES + t];
    return n;
  };
  assert.ok(Math.abs(awaySum() - rebelFront.soldiers - defense.soldiers - walking) <= 2 * TROOP_TYPES);
  // A defending army raised now gets nothing of them; once home they are there again.
  for (let k = 0; k < 30 && w.homeward > 0; k++) {
    week(sim);
    disbandRebels(sim, s);
  }
  assert.equal(walkers(), 0, 'all arrived');
  assert.ok(Math.abs(awaySum() - motherArmies(s).soldiers - motherArmies(s2).soldiers) <= 2 * TROOP_TYPES);
  // Home now, they defend: the yearly re-raise gives her relief armies (3 at most, 4 in all).
  const chance = WAR.chance;
  WAR.chance = 0;
  w.wLastGain[s2] = sim.tick;
  sim.military.strength[MOTHER] = 1000;
  sim.military.strength[att] = 1000;
  try {
    runWarYear(sim);
  } finally {
    WAR.chance = chance;
  }
  assert.equal(w.wLive[s2], 1);
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a] && w.aWar[a] === s2) finishGathering(sim, a);
  const defended = motherArmies(s2);
  assert.ok(defended.n >= 1 && defended.n <= WAR.reliefArmies, `${defended.n} defending armies, ${defended.soldiers} vs ${defense.soldiers}`);
  assert.ok(defended.soldiers > defense.soldiers, `${defended.soldiers} vs ${defense.soldiers}`);
  assert.ok(motherArmies(s).n + defended.n <= WAR.maxArmies);
  // The outside war ends: the rebellion goes on and is her war again.
  disbandRebels(sim, s);
  const oldBefore = motherArmies(s).soldiers;
  const had = new Set<number>();
  for (let a = 0; a < MAX_ARMIES; a++) if (w.live[a] && w.aWar[a] === s && w.aCiv[a] === MOTHER) had.add(a);
  assert.equal(had.size, 1);
  endWar(sim, s2, EndType.AttackerGaveUp);
  assert.equal(w.wLive[s], 1);
  assert.equal(w.enemy[MOTHER], w.wDef[s]);
  assert.equal(w.civWar[MOTHER], s);
  // One front again: no soldier joins her army at once. A reinforcement army gathers at her rally point (its
  // contingents on their way) and then marches like any army; with it she is back at the full 70 % share.
  let old = -1;
  let fresh = -1;
  for (let a = 0; a < MAX_ARMIES; a++) {
    if (!w.live[a] || w.aCiv[a] !== MOTHER || w.aWar[a] !== s) continue;
    if (had.has(a)) old = a;
    else fresh = a;
  }
  assert.ok(old >= 0 && fresh >= 0, 'her army and a reinforcement');
  assert.equal(motherArmies(s).n, 2);
  assert.equal(motherArmies(s2).n, 0);
  const armyOf = (a: number) => w.aN[a * TROOP_TYPES] + w.aN[a * TROOP_TYPES + 1] + w.aN[a * TROOP_TYPES + 2];
  // Nobody joins the old army; the reinforcement starts at her rally point with only the soldiers already there,
  // the others walk to it as contingents.
  assert.equal(armyOf(old), oldBefore, 'nobody joined the old army');
  const rally = rallyPoint(sim, s, MOTHER);
  assert.equal(w.aCell[fresh], rally);
  let atRally = 0;
  for (let t = 0; t < TROOP_TYPES; t++) atRally += m.soldiers[rally * TROOP_TYPES + t];
  const atStart = armyOf(fresh);
  assert.ok(atStart <= atRally, `${atStart} at the start, ${atRally} soldiers at the rally point`);
  const waiting = w.aWait[fresh];
  disbandRebels(sim, s);
  let weeks = 0;
  while (w.live[fresh] && w.aState[fresh] === ArmyState.Gathering && weeks < WAR.gatherWeeks + 1) {
    week(sim);
    disbandRebels(sim, s);
    weeks++;
  }
  assert.ok(w.live[fresh] === 1 && w.aState[fresh] === ArmyState.Marching, 'it sets out');
  if (waiting > 0) {
    assert.ok(weeks >= 1, 'it waited for its contingents');
    assert.ok(armyOf(fresh) > atStart, 'they arrived after walking');
  }
  let share = 0;
  let awayNow = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (sim.world.owner[c] !== MOTHER) continue;
    for (let t = 0; t < TROOP_TYPES; t++) {
      share += Math.floor(WAR.sendShare * m.soldiers[c * TROOP_TYPES + t]);
      awayNow += w.away[c * TROOP_TYPES + t];
    }
  }
  const total = motherArmies(s).soldiers;
  assert.ok(total > oldBefore, `${total} after ${oldBefore}`);
  assert.ok(Math.abs(awayNow - total) <= 2 * TROOP_TYPES, 'soldiers counted once');
  assert.ok(total <= share + 2 * TROOP_TYPES);
  assert.equal(w.wLive[s], 1);
  // Attacked again, then the rebellion ends first: the outside war goes on.
  const s3 = startWar(sim, att, cap);
  assert.ok(s3 >= 0);
  endWar(sim, s, EndType.Exhausted);
  assert.equal(w.wLive[s3], 1);
  assert.equal(w.enemy[MOTHER], att);
  assert.equal(w.civWar[MOTHER], s3);
  assert.equal(w.motherBusy[MOTHER], 0);
});

test('the mother never gives up her rebellion while she is beaten on the other front', () => {
  const sim = grown();
  const w = sim.war;
  const chance = WAR.chance;
  WAR.chance = 0;
  try {
    const cap = sim.civs[MOTHER]!.capital;
    dissatisfy(sim, roadGroups(sim, MOTHER, cap)[0]);
    const s = startRebellion(sim, MOTHER);
    const att = livingCivilizations(sim).map((c) => c.id).find((p) => p !== MOTHER && w.rebelMother[p] === 0)!;
    const s2 = startWar(sim, att, cap);
    assert.ok(s >= 0 && s2 >= 0);
    // The goal occupied and the mother far weaker: she gives up the outside war, not the rebellion.
    w.wOccupied[s2] = 1;
    sim.military.strength[MOTHER] = 0.01;
    sim.military.strength[att] = 1000;
    for (let p = 1; p < sim.civs.length; p++) if (sim.civs[p] && w.rebelMother[p] === MOTHER) sim.military.strength[p] = 1000;
    runWarYear(sim);
    assert.equal(w.wLive[s2], 0);
    assert.equal(w.wLive[s], 1);
    assert.equal(w.civWar[MOTHER], s);
  } finally {
    WAR.chance = chance;
  }
});

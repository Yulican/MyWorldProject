import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../world/generate';
import { BUILDINGS, GOV_SLOT, Good, SLOTS, STORED_COUNT, SlotState } from './buildings';
import { PAIRS, SIGHT_RANGE, dangerValue } from './diplomacy';
import { updateGovernmentProjects } from './government';
import { MIL, TROOP_GOOD, TROOP_TYPES, Troop, mayBuyStrategic, soldiersAt, strengthSize, updateMilitary } from './military';
import { TICKS_PER_YEAR, createSimulation, livingCivilizations, runMilitaryYear, stepSimulation, type Simulation } from './simulation';
import { GOV_TUNING } from './taxes';

const typeOf = (good: number) => BUILDINGS.findIndex((b) => b.good === good);
const BARRACKS = typeOf(Good.Barracks);
const IRON = TROOP_GOOD[Troop.Melee];

function runYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR; t++) stepSimulation(sim);
}

/** Puts a standing building of `type` into a free slot of the cell. */
function place(sim: Simulation, cell: number, type: number): void {
  for (let s = cell * SLOTS; s < (cell + 1) * SLOTS; s++) {
    if (sim.economy.state[s] !== SlotState.Empty) continue;
    sim.economy.type[s] = type;
    sim.economy.state[s] = SlotState.Standing;
    sim.hasBuildings[cell] = 1;
    return;
  }
  throw new Error('no free slot');
}

/**
 * A grown world without any soldiers, military buildings, strategic goods or
 * money in the treasuries, and two settlements (a, b) of one district of at
 * least `minPop` people each. `seat` is their district's seat.
 */
function setup(minPop = 60): { sim: Simulation; a: number; b: number; seat: number; civ: number } {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  runYears(sim, 150);
  const { economy, government: gov, military: m } = sim;
  const n = sim.world.cellCount;
  m.soldiers.fill(0);
  m.faith.fill(0);
  gov.treasury.fill(0);
  for (let s = 0; s < n * SLOTS; s++) {
    if (economy.state[s] === SlotState.Empty || economy.state[s] === SlotState.Ruin) continue;
    if (BUILDINGS[economy.type[s]].good >= Good.Barracks) economy.state[s] = SlotState.Empty;
  }
  for (let c = 0; c < n; c++) for (let k = 0; k < 3; k++) economy.luxury[c * STORED_COUNT + TROOP_GOOD[k]] = 0;
  for (let a = 0; a < n; a++) {
    if (sim.cellPop[a] < minPop || gov.district[a] < 0) continue;
    for (let b = a + 1; b < n; b++) {
      if (sim.cellPop[b] >= minPop && gov.district[b] === gov.district[a]) return { sim, a, b, seat: gov.district[a], civ: sim.world.owner[a] };
    }
  }
  throw new Error('no district with two settlements');
}

test('a barracks trains a quarter of its 20 soldiers a year from the adults, while next year’s pay is covered', () => {
  const { sim, a, seat } = setup(100);
  place(sim, a, BARRACKS);
  sim.government.treasury[seat] = 100;
  const people = sim.cellPop[a];
  const count = sim.pop.count;
  runMilitaryYear(sim);
  assert.equal(MIL.capacity, 20);
  assert.equal(sim.military.soldiers[a * TROOP_TYPES + Troop.Melee], 5);
  assert.equal(sim.cellPop[a], people - 5, 'soldiers leave the population');
  assert.equal(sim.pop.count, count - 5);
  assert.ok(Math.abs(sim.government.reserve[seat] - 5 * MIL.sold) < 1e-6, 'next year’s pay is kept back');
  // Each year 5 more, up to the capacity, while soldiers stay within a tenth of the settlement's people.
  let expected = 5;
  let pay = 0;
  for (let year = 0; year < 5; year++) {
    pay += expected * MIL.sold;
    expected += Math.max(0, Math.min(20 - expected, 5, Math.floor(MIL.maxPopShare * (people - expected)) - expected));
    runMilitaryYear(sim);
    assert.equal(sim.military.soldiers[a * TROOP_TYPES + Troop.Melee], expected, `year ${year + 2}`);
  }
  assert.ok(expected > 5 && expected <= 20);
  assert.equal(sim.cellPop[a], people - expected);
  assert.ok(Math.abs(sim.government.treasury[seat] - (100 - pay)) < 1e-3, `treasury ${sim.government.treasury[seat]}`);
});

test('no training beyond what the treasuries can pay next year', () => {
  const { sim, a, seat } = setup();
  place(sim, a, BARRACKS);
  sim.government.treasury[seat] = 0.35;
  const trained = sim.military.trained;
  runMilitaryYear(sim);
  assert.equal(soldiersAt(sim, a), 3);
  sim.government.treasury[seat] = 0;
  const reserve = sim.military.soldiers.slice();
  updateMilitary(sim, sim.world.owner);
  assert.equal(sim.military.trained - trained, 3, 'nothing more without money');
  assert.ok(sim.military.soldiers.every((v, i) => v <= reserve[i]));
});

test('the people’s other seats pay what the district treasury lacks', () => {
  const { sim, a, seat, civ } = setup();
  place(sim, a, BARRACKS);
  sim.military.soldiers[a * TROOP_TYPES + Troop.Melee] = 20;
  // Another hex of the people with traders counts as one of its seats.
  let other = -1;
  for (let c = 0; c < sim.world.cellCount && other < 0; c++) if (c !== seat && sim.world.owner[c] === civ && sim.government.traders[c] === 0) other = c;
  sim.government.traders[other] = 1;
  sim.government.treasury[seat] = 0.5;
  sim.government.treasury[other] = 10;
  runMilitaryYear(sim);
  assert.equal(soldiersAt(sim, a), 20, 'all paid');
  assert.ok(Math.abs(sim.government.treasury[seat]) < 1e-4, 'the district’s money is spent first');
  assert.ok(Math.abs(sim.government.treasury[other] - (10 - 1.5)) < 1e-4, `the other seat lent 1.5: ${sim.government.treasury[other]}`);
  assert.equal(sim.military.dismissed, 0);
});

test('unpaid soldiers are dismissed exactly and go back to the population of their settlement', () => {
  const { sim, a, b, seat } = setup();
  place(sim, a, BARRACKS);
  place(sim, b, BARRACKS);
  const m = sim.military;
  m.soldiers[a * TROOP_TYPES + Troop.Melee] = 15;
  m.soldiers[b * TROOP_TYPES + Troop.Melee] = 5;
  m.faith[a] = 15 * 0.8;
  m.faith[b] = 5 * 0.2;
  for (let c = 0; c < sim.world.cellCount; c++) if (sim.world.owner[c] === sim.world.owner[seat]) sim.government.treasury[c] = 0;
  sim.government.treasury[seat] = 1; // pays 10 of 20
  const popA = sim.cellPop[a];
  const popB = sim.cellPop[b];
  const count = sim.pop.count;
  runMilitaryYear(sim);
  assert.equal(m.dismissed, 10, 'exactly the unpaid ones, no rounding up');
  assert.equal(soldiersAt(sim, a) + soldiersAt(sim, b), 10);
  // Half of each (7.5 and 2.5, rounded down), the one left from the first settlement.
  assert.equal(soldiersAt(sim, a), 7);
  assert.equal(soldiersAt(sim, b), 3);
  assert.equal(sim.cellPop[a], popA + 8);
  assert.equal(sim.cellPop[b], popB + 2);
  assert.equal(sim.pop.count, count + 10);
  // They bring their soldiers' mean faith back.
  let faith = 0;
  for (let i = 0; i < sim.pop.end; i++) if (sim.pop.alive[i] && sim.pop.cell[i] === a && sim.pop.age[i] === 30 && Math.abs(sim.pop.faith[i] - 0.8) < 1e-6) faith++;
  assert.ok(faith >= 8);
  assert.ok(Math.abs(m.faith[a] - 7 * 0.8) < 1e-4);
});

test('soldiers with their strategic good are 1.5 times as strong and use one unit per 20 a year', () => {
  const { sim, a, b, seat, civ } = setup();
  place(sim, a, BARRACKS);
  place(sim, b, BARRACKS);
  const m = sim.military;
  m.soldiers[a * TROOP_TYPES + Troop.Melee] = 20;
  m.soldiers[b * TROOP_TYPES + Troop.Melee] = 20;
  sim.government.treasury[seat] = 4; // pay for this year, nothing to buy goods with
  sim.economy.luxury[a * STORED_COUNT + IRON] = 3;
  sim.economy.luxury[b * STORED_COUNT + IRON] = 0.5;
  updateMilitary(sim, sim.world.owner);
  assert.equal(m.covered[a * TROOP_TYPES + Troop.Melee], 1);
  assert.equal(m.covered[b * TROOP_TYPES + Troop.Melee], 0);
  assert.ok(Math.abs(sim.economy.luxury[a * STORED_COUNT + IRON] - 2) < 1e-6, 'one unit used');
  assert.ok(Math.abs(sim.economy.luxury[b * STORED_COUNT + IRON] - 0.5) < 1e-6, 'not enough: nothing used');
  assert.equal(m.strength[civ], 20 * MIL.factor + 20);
  assert.equal(m.soldiersOf[civ * TROOP_TYPES + Troop.Melee], 40);
});

test('government traders buy the strategic good soldiers lack from the people’s settlements', () => {
  const { sim, a, b, seat, civ } = setup();
  place(sim, a, BARRACKS);
  const m = sim.military;
  m.soldiers[a * TROOP_TYPES + Troop.Melee] = 20;
  sim.government.treasury[seat] = 20;
  sim.economy.luxury[b * STORED_COUNT + IRON] = 10;
  const money = sim.economy.money[b];
  updateMilitary(sim, sim.world.owner);
  assert.equal(m.covered[a * TROOP_TYPES + Troop.Melee], 1, 'bought and brought');
  assert.ok(Math.abs(sim.economy.luxury[b * STORED_COUNT + IRON] - 9) < 1e-5);
  assert.ok(Math.abs(sim.economy.money[b] - money - 5) < 1e-4, 'paid at the trade price');
  assert.ok(Math.abs(sim.government.treasury[seat] - (20 - 2 - 5)) < 1e-4);
  assert.equal(m.strength[civ], 20 * MIL.factor);
});

test('danger: 50 × (their strength + 20) ÷ (ours + 20), at most 100, times nearness', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  runYears(sim, 150);
  const m = sim.military;
  m.strength = new Float64Array(sim.civSlots);
  const civs = livingCivilizations(sim).map((c) => c.id);
  assert.ok(civs.length >= 2);
  const [a, b] = civs;
  // Half the sight range apart: nearness 0.5.
  sim.diplomacy.distance[a * PAIRS + b] = SIGHT_RANGE / 2;
  sim.diplomacy.distance[b * PAIRS + a] = SIGHT_RANGE / 2;
  assert.equal(strengthSize(sim, a, b, 50), 50, 'nobody has soldiers: equal');
  m.strength[b] = 20;
  assert.equal(strengthSize(sim, a, b, 50), 100);
  m.strength[b] = 100;
  assert.equal(strengthSize(sim, a, b, 50), 100, 'at most 100');
  m.strength[b] = 0;
  m.strength[a] = 60;
  assert.equal(strengthSize(sim, a, b, 50), 12.5);
  // Nearness scales it.
  m.strength[a] = 0;
  assert.ok(Math.abs(dangerValue(sim, a, b) - 25) < 1e-6);
  m.strength[b] = 10;
  assert.ok(Math.abs(dangerValue(sim, a, b) - 37.5) < 1e-6);
});

test('strategic goods are sold only to peoples whose danger for the seller is at most 40', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  sim.diplomacy.danger[1 * PAIRS + 2] = 40;
  assert.equal(mayBuyStrategic(sim, 1, 2, PAIRS), true);
  sim.diplomacy.danger[1 * PAIRS + 2] = 41;
  assert.equal(mayBuyStrategic(sim, 1, 2, PAIRS), false);
});

test('government projects: seats > comfort > military > growth; arming only for a reason', () => {
  const { sim, a, seat, civ } = setup(MIL.minPop);
  const gov = sim.government;
  const owner = sim.world.owner;
  const military = (t: number) => t >= 0 && BUILDINGS[t].good >= Good.Barracks;
  const choose = () => {
    gov.projectSite.fill(-1);
    gov.stock.fill(0); // nothing starts, the choice stays as the project
    sim.seatSite.fill(0);
    gov.potential[seat] = 1000; // the income check passes
    updateGovernmentProjects(sim, owner);
    return gov.projectSite[seat] >= 0 ? gov.projectType[seat] : -1;
  };
  const calm = () => {
    for (let c = 0; c < sim.world.cellCount; c++) if (gov.district[c] === seat) sim.satisfaction[c] = GOV_TUNING.margin + 10;
    sim.diplomacy.danger.fill(0);
    gov.treasury[seat] = 0;
  };
  for (let c = 0; c < sim.world.cellCount; c++) for (let s = c * SLOTS + GOV_SLOT; s < (c + 1) * SLOTS; s++) if (gov.district[c] === seat) sim.economy.state[s] = SlotState.Empty;

  calm();
  assert.equal(military(choose()), false, 'no reason to arm');

  calm();
  gov.treasury[seat] = MIL.spareYears * MIL.capacity * MIL.sold;
  assert.equal(military(choose()), true, 'money to spare');

  calm();
  for (let other = 1; other < PAIRS; other++) if (other !== civ) sim.diplomacy.danger[civ * PAIRS + other] = MIL.threatDanger;
  assert.equal(military(choose()), true, 'a stronger people threatens');

  calm();
  sim.satisfaction[a] = -1;
  const t = choose();
  assert.equal(BUILDINGS[t].good, Good.Comfort, 'a dissatisfied settlement: comfort first');

  calm();
  gov.treasury[seat] = MIL.spareYears * MIL.capacity * MIL.sold;
  gov.projectSite.fill(-1);
  gov.stock.fill(0);
  sim.seatSite.fill(0);
  sim.seatSite[a] = 1;
  gov.potential[seat] = 1000;
  updateGovernmentProjects(sim, owner);
  assert.equal(BUILDINGS[gov.projectType[seat]].good, Good.Seat, 'a planned seat goes before arming');
});

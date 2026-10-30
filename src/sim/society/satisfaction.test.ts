import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sumTerms } from '../terms';
import { Deposit } from '../world/deposits';
import { generateWorld } from '../world/generate';
import { BUILDINGS, FIRST_LUXURY, Good, LUXURY_COUNT, SLOTS, SlotState } from './buildings';
import { runEconomy, updateCellSupply } from './economy';
import {
  CONNECTION_BEST,
  CONNECTION_FAR,
  CONNECTION_NEAR,
  CONNECTION_WORST,
  LUXURY_PER_PERSON,
  MOOD_NEW_PEOPLE,
  MOOD_REVOLUTION_LOST,
  MOOD_REVOLUTION_WON,
  UNHAPPY_QUARTERS,
  addMood,
  birthFactor,
  cellOwners,
  connectionValue,
  satisfactionTarget,
  satisfactionTerms,
  updateSatisfaction,
  yieldFactor,
} from './satisfaction';
import {
  LEAGUE_MIN_SETTLEMENTS,
  TICKS_PER_YEAR,
  createSimulation,
  livingCivilizations,
  stepSimulation,
  type Simulation,
} from './simulation';
import { SUPPLY_KINDS } from './supply';

const typeOf = (name: string) => BUILDINGS.findIndex((b) => b.name === name);

function runYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR; t++) stepSimulation(sim);
}

/** Runs to the next quarterly refresh. */
function runQuarter(sim: Simulation): void {
  do stepSimulation(sim);
  while (sim.tick % 13 !== 0);
}

function place(sim: Simulation, cell: number, type: number): number {
  for (let s = cell * SLOTS; s < (cell + 1) * SLOTS; s++) {
    if (sim.economy.state[s] !== SlotState.Empty) continue;
    sim.economy.type[s] = type;
    sim.economy.state[s] = SlotState.Standing;
    sim.hasBuildings[cell] = 1;
    updateCellSupply(sim, cell);
    return s;
  }
  throw new Error('no free slot');
}

test('the simulation uses the same satisfaction the hex info explains', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  runYears(sim, 250);
  const owner = cellOwners(sim);
  let settlements = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (sim.cellPop[c] === 0) continue;
    settlements++;
    const civ = sim.civs[owner[c]]!;
    const explained = Math.max(-100, Math.min(100, sumTerms(satisfactionTerms(sim, c, civ))));
    assert.ok(Math.abs(satisfactionTarget(sim, c, civ) - explained) < 1e-3, `hex ${c}`);
    assert.ok(sim.satisfaction[c] >= -100 && sim.satisfaction[c] <= 100);
  }
  assert.ok(settlements > 5);
});

test('connection: best near a seat of government, worst far away or without a road', () => {
  assert.equal(connectionValue(0), CONNECTION_BEST);
  assert.equal(connectionValue(CONNECTION_NEAR), CONNECTION_BEST);
  assert.equal(connectionValue(CONNECTION_FAR), CONNECTION_WORST);
  assert.equal(connectionValue(Infinity), CONNECTION_WORST);
  const mid = connectionValue((CONNECTION_NEAR + CONNECTION_FAR) / 2);
  assert.ok(Math.abs(mid - (CONNECTION_BEST + CONNECTION_WORST) / 2) < 1e-9);
  const sim = createSimulation(generateWorld({ seed: 5 }));
  const capital = livingCivilizations(sim)[0].capital;
  assert.equal(sim.seatCost[capital], 0);
  assert.ok(satisfactionTerms(sim, capital, sim.civs[1]).some((t) => t.label === 'Capital' && t.value === CONNECTION_BEST));
});

test('missing food, water or space and crowding lower the target', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  const cell = sim.world.startCell;
  const civ = sim.civs[1]!;
  const before = satisfactionTarget(sim, cell, civ);
  // Water for only half of the people: -50; at full capacity also crowded.
  sim.cellSupply[cell * SUPPLY_KINDS + 1] = sim.cellPop[cell] / 2;
  sim.cellCapacity[cell] = sim.cellPop[cell] / 2;
  const terms = satisfactionTerms(sim, cell, civ);
  const water = terms.find((t) => t.label.startsWith('Water missing'))!;
  assert.ok(Math.abs(water.value + 50) < 1e-6, water.label);
  assert.ok(terms.some((t) => t.label.startsWith('Crowded') && t.value === -5));
  assert.ok(Math.abs(satisfactionTarget(sim, cell, civ) - (before - 55)) < 1e-6);
});

test('satisfaction follows its target slowly; a new settlement starts at its target', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  const cell = sim.world.startCell;
  const owner = cellOwners(sim);
  const target = satisfactionTarget(sim, cell, sim.civs[1]);
  sim.satisfaction[cell] = target - 40;
  for (let q = 0; q < 4; q++) updateSatisfaction(sim, owner);
  // A quarter of the gap closes per year.
  assert.ok(Math.abs(target - sim.satisfaction[cell] - 30) < 1e-3, `${sim.satisfaction[cell]}`);
  sim.moodSet[cell] = 0;
  sim.satisfaction[cell] = -77;
  updateSatisfaction(sim, owner);
  assert.ok(Math.abs(sim.satisfaction[cell] - target) < 1e-3);
});

test('satisfied hexes have more children and harvest more, unhappy ones less', () => {
  assert.equal(birthFactor(0), 1);
  assert.equal(birthFactor(100), 1.25);
  assert.equal(birthFactor(-100), 0.75);
  assert.equal(yieldFactor(100), 1.2);
  assert.equal(yieldFactor(-100), 0.8);
});

test('every new people starts proud, and moods fade within ten years', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  const civ = sim.civs[1]!;
  const mood = () => satisfactionTerms(sim, civ.capital, civ).find((t) => t.label === 'A new people')?.value ?? 0;
  assert.equal(mood(), MOOD_NEW_PEOPLE);
  runYears(sim, 5);
  assert.ok(Math.abs(mood() - MOOD_NEW_PEOPLE / 2) < 0.1);
  runYears(sim, 6);
  assert.equal(mood(), 0);
  assert.equal(civ.moods.length, 0);
  // The same event again replaces the old mood instead of stacking.
  addMood(civ, 'Lost a revolution', -5, sim.tick);
  addMood(civ, 'Lost a revolution', -5, sim.tick);
  assert.equal(civ.moods.length, 1);
});

test('comfort buildings, luxury goods and seats of government raise satisfaction', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  const cell = sim.world.startCell;
  const civ = sim.civs[1]!;
  const people = sim.cellPop[cell];
  const before = satisfactionTarget(sim, cell, civ);
  place(sim, cell, typeOf('Meeting place'));
  const comfort = satisfactionTerms(sim, cell, civ).find((t) => t.label.startsWith('Comfort'))!;
  assert.ok(Math.abs(comfort.value - 15 * Math.min(1, 50 / people)) < 1e-6);

  // A year of salt from a salt works covers the people's need.
  sim.world.deposit[cell] = Deposit.Salt;
  place(sim, cell, typeOf('Salt works'));
  sim.satisfaction[cell] = 0;
  for (let q = 0; q < 3; q++) runEconomy(sim, false);
  runEconomy(sim, true);
  const salt = Good.Salt - FIRST_LUXURY;
  assert.equal(sim.economy.luxuryCovered[cell], 1 << salt);
  assert.ok(Math.abs(sim.economy.luxury[cell * LUXURY_COUNT + salt] - (10 - people * LUXURY_PER_PERSON)) < 1e-3);
  assert.ok(Math.abs(satisfactionTarget(sim, cell, civ) - before - comfort.value - 5) < 1e-6);

  // A seat of government in a settlement makes it as well connected as the capital.
  runYears(sim, 150);
  const owner = cellOwners(sim);
  const far = [...sim.seatCost.keys()].find((c) => owner[c] === civ.id && sim.seatCost[c] > CONNECTION_NEAR);
  if (far !== undefined) {
    place(sim, far, typeOf('Seat of government'));
    updateSatisfaction(sim, owner);
    assert.equal(sim.seatCost[far], 0);
  }
});

/** Makes every settlement of a people except its capital unhappy for years. */
function makeRestless(sim: Simulation, civId: number, cells: number[]): void {
  for (const c of cells) {
    sim.satisfaction[c] = -80;
    sim.moodSet[c] = 1;
    sim.unhappyQuarters[c] = UNHAPPY_QUARTERS - 1;
  }
  addMood(sim.civs[civId]!, 'Test hardship', -200, sim.tick);
}

test('a league of unhappy settlements joined by roads breaks away as a new people', () => {
  const sim = createSimulation(generateWorld({ seed: 1 }));
  runYears(sim, 200);
  const owner = cellOwners(sim);
  const parent = livingCivilizations(sim).sort((a, b) => b.territory - a.territory)[0];
  const cells = [...owner.keys()].filter((c) => owner[c] === parent.id && c !== parent.capital);
  assert.ok(cells.length >= LEAGUE_MIN_SETTLEMENTS, `${cells.length} settlements`);
  const faith = new Map<number, number>();
  for (let i = 0; i < sim.pop.end; i++) if (sim.pop.alive[i] && sim.pop.civ[i] === parent.id) faith.set(i, sim.pop.faith[i]);
  const capitalPeople = sim.cellCivPop[parent.capital * sim.civSlots + parent.id];
  const believersBefore = parent.faithYear.brokeAway;
  makeRestless(sim, parent.id, cells);
  runQuarter(sim);

  const rebels = livingCivilizations(sim).filter((c) => c.origin === 'revolution' && c.parentName === parent.name);
  assert.ok(rebels.length >= 1, 'a league broke away');
  const civ = rebels[0];
  assert.notEqual(civ.capital, parent.capital);
  assert.ok(!civ.worshipsPlayer);
  // The capital stays with its people; everyone keeps their faith.
  assert.equal(sim.cellCivPop[parent.capital * sim.civSlots + parent.id] > 0, true);
  assert.ok(capitalPeople > 0);
  for (let i = 0; i < sim.pop.end; i++) {
    if (!sim.pop.alive[i] || sim.pop.civ[i] !== civ.id || !faith.has(i)) continue;
    // Faith only changed by the yearly drift of the one quarter, never cut.
    assert.ok(Math.abs(sim.pop.faith[i] - faith.get(i)!) < 0.1);
  }
  assert.ok(parent.faithYear.brokeAway >= believersBefore);
  const moods = (c: typeof civ) => c.moods.map((m) => `${m.label} ${m.value}`);
  assert.ok(moods(civ).includes(`A new people ${MOOD_NEW_PEOPLE}`));
  assert.ok(moods(civ).includes(`Won its revolution ${MOOD_REVOLUTION_WON}`));
  assert.ok(moods(parent).includes(`Lost a revolution ${MOOD_REVOLUTION_LOST}`));
  const entry = sim.chronicle.find((e) => e.text.endsWith(`became the ${civ.name}.`))!;
  assert.ok(entry.text.includes(`rose up against the ${parent.name}`), entry.text);
  assert.equal(entry.cell, civ.capital);
});

test('a lone unhappy settlement does not break away but loses people', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  runYears(sim, 150);
  const owner = cellOwners(sim);
  // A settlement with fewer people than a league needs and no unhappy neighbors.
  const civ = sim.civs[owner[sim.world.startCell]]!;
  const lone = [...owner.keys()].find(
    (c) => owner[c] === civ.id && c !== civ.capital && sim.cellPop[c] > 40 && sim.cellPop[c] < 100,
  );
  assert.ok(lone !== undefined, 'found a small settlement');
  const peoples = livingCivilizations(sim).length;
  const groups = sim.migrations.groups;
  for (let q = 0; q < 16; q++) {
    sim.satisfaction[lone] = -100;
    sim.moodSet[lone] = 1;
    sim.unhappyQuarters[lone] = UNHAPPY_QUARTERS;
    runQuarter(sim);
  }
  assert.ok(livingCivilizations(sim).every((c) => c.origin !== 'revolution'));
  assert.ok(livingCivilizations(sim).length <= peoples + 1);
  assert.ok(sim.migrations.groups > groups, 'people moved away');
});

test('every chronicle entry says where it happened', () => {
  const sim = createSimulation(generateWorld({ seed: 24 }));
  runYears(sim, 135);
  assert.ok(sim.chronicle.length >= 2);
  assert.equal(sim.chronicle[0].cell, sim.world.startCell);
  for (const e of sim.chronicle) {
    if (e.text.startsWith('Nobody prays')) assert.equal(e.cell, -1);
    else assert.ok(e.cell >= 0 && e.cell < sim.world.cellCount, e.text);
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TICKS_PER_YEAR, createSimulation, generateWorld, governmentOf, livingCivilizations, stepSimulation, type Simulation } from '..';
import { BUILDINGS, GOV_SLOT, Good, MATERIAL_COUNT, SLOTS, SlotState } from './buildings';
import { usableSlots } from './economy';
import { updateGovernment, updateGovernmentUpkeep } from './government';
import { hexDistance } from '../hex';
import { seatsOf } from './satisfaction';
import { GOV_TUNING, TAX_MAX, TAX_NEUTRAL, goodsRateFor, goodsTaxValue, rateFor, taxValue } from './taxes';
import { TRADE_GOODS } from './trade';

// "Design Documents/Requirement Zentralregierung.md".

function runYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR; t++) stepSimulation(sim);
}

const noRecord = () => {};

test('both tax terms: +5 at 0 %, 0 at 10 %, -10 at 50 %; the rate for a term is its inverse', () => {
  for (const value of [taxValue, goodsTaxValue]) {
    assert.equal(value(0), 5);
    assert.equal(value(TAX_NEUTRAL), 0);
    assert.equal(value(TAX_MAX), -10);
    assert.equal(value(1), -10);
  }
  for (const [value, rate] of [
    [taxValue, rateFor],
    [goodsTaxValue, goodsRateFor],
  ] as const) {
    for (const r of [0, 0.05, 0.1, 0.3, 0.5]) assert.ok(Math.abs(rate(value(r)) - r) < 1e-9, `rate ${r}`);
    assert.equal(rate(6), 0, 'beyond the bonus: no tax at all');
  }
});

test('every settlement belongs to the district of its nearest seat of government', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  runYears(sim, 150);
  const owner = sim.world.owner;
  const seats = seatsOf(sim, owner);
  let settlements = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (!owner[c] || sim.cellPop[c] === 0) continue;
    const d = sim.government.district[c];
    if (d < 0) continue; // settled since the last yearly update
    settlements++;
    assert.equal(owner[d], owner[c], 'its own people');
    const nearest = Math.min(...seats[owner[c]].map((s) => hexDistance(sim.world, c, s)));
    assert.equal(hexDistance(sim.world, c, d), nearest, `hex ${c}`);
  }
  assert.ok(settlements > 10);
});

test('taxes go into the treasury of the district’s seat, and no rate goes beyond 50 %', () => {
  const sim = createSimulation(generateWorld({ seed: 1 }));
  runYears(sim, 150);
  const before = Float64Array.from(sim.government.treasury);
  const collected = sim.government.collected;
  updateGovernment(sim, sim.world.owner, noRecord);
  let gained = 0;
  for (let s = 0; s < sim.world.cellCount; s++) {
    gained += sim.government.treasury[s] - before[s];
    assert.ok(sim.government.rate[s] >= 0 && sim.government.rate[s] <= TAX_MAX);
    assert.ok(sim.government.goodsRate[s] >= 0 && sim.government.goodsRate[s] <= TAX_MAX);
  }
  assert.ok(sim.government.collected > collected, 'taxes were collected');
  assert.ok(Math.abs(gained - (sim.government.collected - collected)) < 1e-3 * Math.max(1, gained));
});

/** A settled hex of world 1 after 150 years with a free government slot and wood to spare. */
function siteWithWood(sim: Simulation): number {
  for (let c = 0; c < sim.world.cellCount; c++) {
    const s = sim.government.district[c];
    if (s < 0 || sim.cellPop[c] === 0 || sim.trade.surplus[c * TRADE_GOODS] < 5) continue;
    if (sim.economy.state[c * SLOTS + GOV_SLOT] === SlotState.Empty) return c;
  }
  throw new Error('no site');
}

test('a government building takes what its upkeep lacks from its own settlement (levy on site)', () => {
  const sim = createSimulation(generateWorld({ seed: 1 }));
  runYears(sim, 150);
  const c = siteWithWood(sim);
  const slot = c * SLOTS + GOV_SLOT;
  const type = BUILDINGS.findIndex((b) => b.good === Good.Comfort && b.upkeepStone === 0 && b.upkeepWood > 0);
  assert.ok(type >= 0);
  sim.economy.type[slot] = type;
  sim.economy.state[slot] = SlotState.Standing;
  sim.economy.unpaid[slot] = 0;
  sim.hasBuildings[c] = 1;
  sim.government.stock[c * MATERIAL_COUNT] = 0;
  const own = sim.economy.stock[c * MATERIAL_COUNT];
  updateGovernmentUpkeep(sim, sim.world.owner);
  assert.equal(sim.economy.unpaid[slot], 0, 'its upkeep was paid');
  assert.ok(sim.economy.stock[c * MATERIAL_COUNT] < own, 'from the settlement on its hex');
  assert.ok(sim.government.cellGoodsRate[c] > sim.government.goodsRate[sim.government.district[c]], 'as a goods tax there');
});

test('a government building without upkeep for more than two years falls to ruin', () => {
  const sim = createSimulation(generateWorld({ seed: 1 }));
  runYears(sim, 150);
  const c = siteWithWood(sim);
  const slot = c * SLOTS + GOV_SLOT;
  sim.economy.type[slot] = BUILDINGS.findIndex((b) => b.upkeepStone > 0);
  sim.economy.state[slot] = SlotState.Standing;
  sim.economy.unpaid[slot] = 0;
  sim.hasBuildings[c] = 1;
  for (let year = 1; year <= 3; year++) {
    // Nothing in stock and nothing to take: the settlement spares no stone.
    sim.government.stock[c * MATERIAL_COUNT + 1] = 0;
    sim.trade.surplus[c * TRADE_GOODS + 1] = 0;
    updateGovernmentUpkeep(sim, sim.world.owner);
    assert.equal(sim.economy.state[slot], year <= 2 ? SlotState.Standing : SlotState.Ruin, `year ${year}`);
  }
});

test('the government panel lists every district of a people with all its settlements', () => {
  const sim = createSimulation(generateWorld({ seed: 1 }));
  runYears(sim, 150);
  for (const civ of livingCivilizations(sim)) {
    const districts = governmentOf(sim, civ.id);
    assert.ok(districts.length > 0, civ.name);
    assert.equal(districts[0].seat, civ.capital, 'the capital first');
    let settlements = 0;
    for (let c = 0; c < sim.world.cellCount; c++) if (sim.government.district[c] >= 0 && sim.world.owner[c] === civ.id) settlements++;
    assert.equal(
      districts.reduce((n, d) => n + d.settlements, 0),
      settlements,
    );
    for (const d of districts) {
      assert.equal(sim.world.seats[d.seat] > 0, true, 'its seat is on the map');
      assert.ok(d.buildings.every((b) => sim.government.district[b.cell] === d.seat));
    }
  }
});

test('government slots are as many as settlement slots and seats only stand in them', () => {
  const sim = createSimulation(generateWorld({ seed: 8 }));
  runYears(sim, 200);
  let seats = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    for (let k = 0; k < SLOTS; k++) {
      const s = c * SLOTS + k;
      if (sim.economy.state[s] === SlotState.Empty) continue;
      const inGov = k >= GOV_SLOT;
      assert.ok((inGov ? k - GOV_SLOT : k) < usableSlots(sim, c), `hex ${c} slot ${k}`);
      if (BUILDINGS[sim.economy.type[s]].good === Good.Seat) {
        assert.ok(inGov, 'a seat of government is the government’s');
        seats++;
      }
    }
  }
  assert.ok(seats > 0);
  assert.equal(GOV_TUNING.incomeShare, 0.4);
});

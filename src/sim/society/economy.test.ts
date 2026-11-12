import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sumTerms } from '../terms';
import { yieldFactor } from './satisfaction';
import { Biome, isWaterBiome } from '../world/biomes';
import { generateWorld } from '../world/generate';
import {
  BUILDINGS,
  FIRST_LUXURY,
  CityTier,
  Good,
  LUXURY_COUNT,
  STORED_COUNT,
  MATERIAL_COUNT,
  Material,
  SETTLEMENT_SLOTS,
  SLOTS,
  SlotState,
  UPKEEP_GRACE_YEARS,
  cityTier,
  forageYield,
  harvestTerms,
  isLuxury,
  isStored,
  withBuildings,
} from './buildings';
import { MIL } from './military';
import { EXPANSION_GROUP, buildingFits, capacityAfterRepair, isSettlementTarget, runEconomy, updateCellSupply, usableSlots } from './economy';
import { Deposit } from '../world/deposits';
import { PAIRS } from './diplomacy';
import { MERCHANT_LOAD, TRADE_GOODS, TradeGood, updateTradeNeeds } from './trade';
import { TICKS_PER_YEAR, createSimulation, hexSupplyTerms, stepSimulation, type Simulation } from './simulation';
import { SUPPLY_KINDS, SupplyKind, supplyTerms } from './supply';

const typeOf = (name: string) => BUILDINGS.findIndex((b) => b.name === name);

function runYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR; t++) stepSimulation(sim);
}

/** Puts a finished building of the given type into the next free slot of a hex. */
function place(sim: Simulation, cell: number, type: number, state: number = SlotState.Standing): number {
  for (let s = cell * SLOTS; s < (cell + 1) * SLOTS; s++) {
    if (sim.economy.state[s] !== SlotState.Empty) continue;
    sim.economy.type[s] = type;
    sim.economy.state[s] = state;
    sim.hasBuildings[cell] = 1;
    updateCellSupply(sim, cell);
    return s;
  }
  throw new Error('no free slot');
}

/** A land hex nobody lives on, far from the start. */
function emptyLand(sim: Simulation): number {
  const { world } = sim;
  for (let c = 0; c < world.cellCount; c++) {
    if (!isWaterBiome(world.biome[c]) && sim.cellPop[c] === 0 && sim.cellCapacity[c] > 0) return c;
  }
  throw new Error('no empty land');
}

test('percentage modifiers come after absolute ones and multiply', () => {
  const world = generateWorld({ seed: 12 });
  const cell = world.startCell;
  const base = sumTerms(supplyTerms(world, cell, [])[SupplyKind.Food]);
  const food = supplyTerms(world, cell, [
    { kind: SupplyKind.Food, label: 'A', amount: 0.5, percent: true },
    { kind: SupplyKind.Food, label: 'B', amount: 10 },
    { kind: SupplyKind.Food, label: 'C', amount: 0.5, percent: true },
  ])[SupplyKind.Food];
  assert.ok(Math.abs(sumTerms(food) - (base + 10) * 1.5 * 1.5) < 1e-3);
  assert.deepEqual(food.slice(-3).map((t) => t.label), ['B', 'A', 'C']);
});

test('buildings change supply and harvest exactly as their terms explain', () => {
  const sim = createSimulation(generateWorld({ seed: 12 }));
  const cell = sim.world.startCell;
  for (const name of ['Fields', 'Irrigation', 'Lumber camp', 'Sawmill']) place(sim, cell, typeOf(name));
  const terms = hexSupplyTerms(sim, cell);
  assert.ok(terms[SupplyKind.Food].some((t) => t.label === 'Fields'));
  assert.ok(terms[SupplyKind.Food].some((t) => t.label === 'Irrigation +50 %'));
  for (let k = 0; k < SUPPLY_KINDS; k++) {
    const shown = sumTerms(terms[k]);
    assert.ok(Math.abs(shown - sim.cellSupply[cell * SUPPLY_KINDS + k]) < 1e-3);
    const planned = withBuildings(sim.economy, cell, k, sim.baseSupply[cell * SUPPLY_KINDS + k]);
    assert.ok(Math.abs(shown - planned) < 1e-3);
  }
  const wood = harvestTerms(sim.world, sim.economy, cell, Good.Wood);
  const expected = (forageYield(sim.world, cell, Good.Wood) + 5) * 2;
  assert.ok(Math.abs(sumTerms(wood) - expected) < 1e-4);
  assert.ok(Math.abs(withBuildings(sim.economy, cell, Good.Wood, forageYield(sim.world, cell, Good.Wood)) - expected) < 1e-4);
});

test('settled hexes harvest wood and stone into their own stock, more when satisfied', () => {
  const sim = createSimulation(generateWorld({ seed: 12 }));
  const cell = sim.world.startCell;
  const year = (satisfaction: number) => {
    sim.economy.stock[cell * MATERIAL_COUNT + Material.Wood] = 0;
    sim.satisfaction[cell] = satisfaction;
    for (let q = 0; q < 4; q++) runEconomy(sim, false);
    return sim.economy.stock[cell * MATERIAL_COUNT + Material.Wood];
  };
  const forage = forageYield(sim.world, cell, Good.Wood);
  assert.ok(Math.abs(year(0) - forage) < 1e-3);
  assert.ok(Math.abs(year(50) - forage * 1.1) < 1e-3);
  assert.ok(Math.abs(year(-100) - forage * 0.8) < 1e-3);
  const other = emptyLand(sim);
  assert.equal(sim.economy.stock[other * MATERIAL_COUNT + Material.Wood], 0);
});

test('unpaid upkeep turns a building into a ruin after the grace period', () => {
  const sim = createSimulation(generateWorld({ seed: 12 }));
  const cell = emptyLand(sim);
  const slot = place(sim, cell, typeOf('Well'));
  const withWell = sim.cellCapacity[cell];
  for (let year = 1; year <= UPKEEP_GRACE_YEARS; year++) {
    runEconomy(sim, true);
    assert.equal(sim.economy.state[slot], SlotState.Standing, `year ${year}`);
  }
  runEconomy(sim, true);
  assert.equal(sim.economy.state[slot], SlotState.Ruin);
  assert.ok(sim.cellCapacity[cell] <= withWell);
  assert.ok(Math.abs(capacityAfterRepair(sim, cell) - withWell) < 1e-3);
});

test('ruins make poor land worth settling', () => {
  const sim = createSimulation(generateWorld({ seed: 12 }));
  const { world } = sim;
  let cell = -1;
  for (let c = 0; c < world.cellCount && cell < 0; c++) {
    const cap = sim.cellCapacity[c];
    if (!isWaterBiome(world.biome[c]) && sim.cellPop[c] === 0 && cap > 15 && cap < EXPANSION_GROUP) cell = c;
  }
  assert.ok(cell >= 0);
  assert.equal(isSettlementTarget(sim, cell), false);
  for (const name of ['Hut', 'Fields', 'Well']) place(sim, cell, typeOf(name), SlotState.Ruin);
  assert.ok(capacityAfterRepair(sim, cell) >= EXPANSION_GROUP);
  assert.equal(isSettlementTarget(sim, cell), true);
});

test('a ruin is repaired for half the cost and half the time', () => {
  const sim = createSimulation(generateWorld({ seed: 7 }));
  runYears(sim, 60);
  const { economy } = sim;
  const cell = sim.world.startCell;
  // The building that raises the start hex's capacity most, standing...
  let type = -1;
  let gain = 0;
  for (const name of ['Hut', 'Fields', 'Well']) {
    const before = sim.cellCapacity[cell];
    const slot = place(sim, cell, typeOf(name));
    if (sim.cellCapacity[cell] - before > gain) {
      gain = sim.cellCapacity[cell] - before;
      type = typeOf(name);
    }
    economy.state[slot] = SlotState.Empty;
    economy.type[slot] = -1;
    updateCellSupply(sim, cell);
  }
  assert.ok(type >= 0 && gain > 1, 'a building raises the capacity');
  const slot = place(sim, cell, type);
  // ...falls to ruin.
  economy.state[slot] = SlotState.Ruin;
  updateCellSupply(sim, cell);
  assert.ok(sim.cellPop[cell] >= 0.5 * sim.cellCapacity[cell], 'the hex is full enough to build');
  const b = BUILDINGS[type];
  economy.stock[cell * MATERIAL_COUNT + Material.Wood] = 1000;
  economy.stock[cell * MATERIAL_COUNT + Material.Stone] = 1000;
  // Content enough that growth comes before comfort (satisfaction first only below 5).
  sim.satisfaction[cell] = 10;
  runEconomy(sim, false);
  assert.equal(economy.state[slot], SlotState.Repair);
  assert.ok(Math.abs(economy.work[slot] - b.years / 2) < 1e-6);
  const harvest = (good: number) =>
    (withBuildings(economy, cell, good, forageYield(sim.world, cell, good)) * yieldFactor(10)) / 4;
  assert.ok(Math.abs(economy.stock[cell * MATERIAL_COUNT + Material.Wood] - (1000 + harvest(Good.Wood) - b.wood / 2)) < 1e-2);
  assert.ok(Math.abs(economy.stock[cell * MATERIAL_COUNT + Material.Stone] - (1000 + harvest(Good.Stone) - b.stone / 2)) < 1e-2);
});

test('settlements build once they are boxed in, and pay for it from their stock', () => {
  // The first buildings go up around year 200, once settlements are boxed in.
  const sim = createSimulation(generateWorld({ seed: 7 }));
  runYears(sim, 220);
  const { economy, world } = sim;
  let standing = 0;
  for (let c = 0; c < world.cellCount; c++) {
    for (let s = c * SLOTS; s < (c + 1) * SLOTS; s++) if (economy.state[s] === SlotState.Standing) standing++;
    assert.ok(economy.stock[c * MATERIAL_COUNT] > -1e-3 && economy.stock[c * MATERIAL_COUNT + 1] > -1e-3, `stock of ${c}`);
    assert.equal(world.buildings[c] <= SLOTS, true);
    assert.equal(world.cityTier[c], cityTier(world.buildings[c], usableSlots(sim, c)), `city tier of ${c}`);
  }
  assert.ok(standing > 0, 'some hex built something');
  // Building lines appear in the supply of a hex that has them.
  const city = [...world.buildings.keys()].find((c) => {
    for (let s = c * SLOTS; s < (c + 1) * SLOTS; s++) {
      if (economy.state[s] === SlotState.Standing && BUILDINGS[economy.type[s]].good < SUPPLY_KINDS) return true;
    }
    return false;
  })!;
  const labels = hexSupplyTerms(sim, city).flat().map((t) => t.label);
  assert.ok(BUILDINGS.some((b) => labels.some((l) => l.startsWith(b.name))), labels.join(', '));
});

test('buildings and stock are the same for the same seed', () => {
  const run = () => {
    const sim = createSimulation(generateWorld({ seed: 7 }));
    runYears(sim, 120);
    return [Array.from(sim.economy.type), Array.from(sim.economy.state), Array.from(sim.economy.stock)];
  };
  assert.deepEqual(run(), run());
});

test('wood grows in woods and stone in hills and mountains; elsewhere only foraging, and no lumber camp or quarry', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  const first = (biome: number) => {
    for (let c = 0; c < sim.world.cellCount; c++) if (sim.world.biome[c] === biome) return c;
    throw new Error(`no biome ${biome}`);
  };
  const plains = first(Biome.Plains);
  const forest = first(Biome.Forest);
  const mountains = first(Biome.Mountains);
  const base = forageYield(sim.world, plains, Good.Wood);
  assert.equal(forageYield(sim.world, plains, Good.Stone), base, 'plains forage the same of both');
  assert.ok(forageYield(sim.world, forest, Good.Wood) > base * 3, 'woods give far more wood');
  assert.equal(forageYield(sim.world, forest, Good.Stone), base);
  assert.ok(forageYield(sim.world, mountains, Good.Stone) > base * 3, 'mountains give far more stone');
  assert.deepEqual(
    harvestTerms(sim.world, sim.economy, plains, Good.Wood).map((t) => t.label),
    ['Foraging'],
  );
  assert.ok(Math.abs(sumTerms(harvestTerms(sim.world, sim.economy, forest, Good.Wood)) - forageYield(sim.world, forest, Good.Wood)) < 1e-4);
  for (const name of ['Lumber camp', 'Sawmill']) {
    assert.equal(buildingFits(sim, plains, typeOf(name)), false, `${name} on plains`);
    assert.equal(buildingFits(sim, forest, typeOf(name)), true, `${name} in woods`);
  }
  for (const name of ['Quarry', 'Stonemason']) {
    assert.equal(buildingFits(sim, plains, typeOf(name)), false, `${name} on plains`);
    assert.equal(buildingFits(sim, mountains, typeOf(name)), true, `${name} in mountains`);
  }
});

test('plains have more building slots than other land', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  const first = (biome: number) => {
    for (let c = 0; c < sim.world.cellCount; c++) if (sim.world.biome[c] === biome) return c;
    throw new Error(`no biome ${biome}`);
  };
  assert.equal(usableSlots(sim, first(Biome.Plains)), SETTLEMENT_SLOTS);
  assert.equal(usableSlots(sim, first(Biome.Forest)), 4);
  assert.ok(SETTLEMENT_SLOTS > 4);
});

/** A settled hex of the first people after some years, cleared of buildings, with a happy population. */
function settledHex(seed: number): { sim: Simulation; cell: number; civ: number } {
  const sim = createSimulation(generateWorld({ seed }));
  runYears(sim, 40);
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (sim.cellPop[c] < 5 || !sim.world.owner[c]) continue;
    for (let s = c * SLOTS; s < (c + 1) * SLOTS; s++) {
      sim.economy.state[s] = SlotState.Empty;
      sim.economy.type[s] = -1;
    }
    sim.satisfaction[c] = 10;
    return { sim, cell: c, civ: sim.world.owner[c] };
  }
  throw new Error('no settlement');
}

test('a settlement on a luxury deposit mines it when its people lack the good, even if it is happy itself', () => {
  // Gems (gold is no luxury good any more since war phase 0: see the gold test below).
  const { sim, cell, civ } = settledHex(3);
  sim.world.deposit[cell] = Deposit.Gems;
  const gems = TradeGood.Luxury + Good.Gems - FIRST_LUXURY;
  sim.economy.stock[cell * MATERIAL_COUNT + Material.Wood] = 500;
  sim.economy.stock[cell * MATERIAL_COUNT + Material.Stone] = 500;
  sim.trade.civWant[civ * TRADE_GOODS + gems] = 0;
  sim.trade.civSpare[civ * TRADE_GOODS + gems] = 0;
  const mine = typeOf('Gem mine');
  const building = () => {
    for (let s = cell * SLOTS; s < (cell + 1) * SLOTS; s++) if (sim.economy.type[s] === mine && sim.economy.state[s] !== SlotState.Empty) return true;
    return false;
  };
  runEconomy(sim, false, cell, sim.world.cellCount);
  assert.equal(building(), false, 'nobody lacks gems: no mine');
  sim.trade.civWant[civ * TRADE_GOODS + gems] = 10;
  runEconomy(sim, false, cell, sim.world.cellCount);
  assert.equal(building(), true, 'its people lack gems: the mine goes up');
});

test('a settlement on an iron deposit mines it when its people lack iron, like a luxury good', () => {
  const { sim, cell, civ } = settledHex(3);
  sim.world.deposit[cell] = Deposit.Iron;
  const iron = TradeGood.Luxury + Good.Iron - FIRST_LUXURY;
  sim.economy.stock[cell * MATERIAL_COUNT + Material.Wood] = 500;
  sim.economy.stock[cell * MATERIAL_COUNT + Material.Stone] = 500;
  sim.trade.civWant[civ * TRADE_GOODS + iron] = 0;
  sim.trade.civSpare[civ * TRADE_GOODS + iron] = 0;
  const mine = typeOf('Iron mine');
  const building = () => {
    for (let s = cell * SLOTS; s < (cell + 1) * SLOTS; s++) if (sim.economy.type[s] === mine && sim.economy.state[s] !== SlotState.Empty) return true;
    return false;
  };
  runEconomy(sim, false, cell, sim.world.cellCount);
  assert.equal(building(), false, 'nobody lacks iron: no mine');
  sim.trade.civWant[civ * TRADE_GOODS + iron] = 10;
  runEconomy(sim, false, cell, sim.world.cellCount);
  assert.equal(building(), true, 'its people lack iron: the mine goes up');
  // Iron and flint are stored and traded, but no comfort.
  assert.equal(isLuxury(Good.Iron) || isLuxury(Good.Flint) || isLuxury(Good.Gold), false);
  assert.equal(isStored(Good.Iron) && isStored(Good.Flint), true);
  assert.equal(LUXURY_COUNT, 5);
});

test('a settlement on a gold deposit always mines it, and mined gold is money taxed for the district', () => {
  const { sim, cell, civ } = settledHex(3);
  sim.world.deposit[cell] = Deposit.Gold;
  sim.economy.stock[cell * MATERIAL_COUNT + Material.Wood] = 500;
  sim.economy.stock[cell * MATERIAL_COUNT + Material.Stone] = 500;
  for (let g = 0; g < TRADE_GOODS; g++) sim.trade.civWant[civ * TRADE_GOODS + g] = 0;
  const mine = typeOf('Gold mine');
  runEconomy(sim, false, cell, sim.world.cellCount);
  let slot = -1;
  for (let s = cell * SLOTS; s < (cell + 1) * SLOTS; s++) if (sim.economy.type[s] === mine && sim.economy.state[s] !== SlotState.Empty) slot = s;
  assert.ok(slot >= 0, 'nobody asks for gold, the mine goes up anyway');
  // Standing: a quarter's gold, MIL.goldRate money a unit; the district's money tax rate of it goes to the seat.
  sim.economy.state[slot] = SlotState.Standing;
  const seat = sim.government.district[cell];
  assert.ok(seat >= 0);
  sim.government.cellRate[cell] = 0.2;
  const money = sim.economy.money[cell];
  const treasury = sim.government.treasury[seat];
  const luxury = Array.from(sim.economy.luxury.subarray(cell * STORED_COUNT, (cell + 1) * STORED_COUNT));
  runEconomy(sim, false, cell, sim.world.cellCount);
  const gold = (BUILDINGS[mine].amount * yieldFactor(sim.satisfaction[cell]) * MIL.goldRate) / 4;
  assert.equal(MIL.goldRate, 5);
  assert.ok(Math.abs(sim.government.treasury[seat] - treasury - 0.2 * gold) < 1e-3, 'the tax share to the treasury');
  assert.ok(sim.economy.money[cell] - money >= 0.8 * gold - 1e-3, 'the rest is the settlement\'s money');
  assert.deepEqual(Array.from(sim.economy.luxury.subarray(cell * STORED_COUNT, (cell + 1) * STORED_COUNT)), luxury, 'no gold in stock');
});

test('a settlement trading in transit asks for what its partner lacks, up to a load, and does not use it up itself', () => {
  const { sim, cell, civ } = settledHex(3);
  const partner = civ === 1 ? 2 : 1;
  const salt = TradeGood.Luxury;
  sim.diplomacy.partners[civ] = [partner];
  sim.diplomacy.transitHub[civ * PAIRS + partner] = cell;
  sim.trade.civWant[partner * TRADE_GOODS + salt] = 100;
  sim.trade.civSpare[partner * TRADE_GOODS + salt] = 0;
  updateTradeNeeds(sim, cell, sim.cellAdults[cell], false, 4);
  const keep = MERCHANT_LOAD / 0.5;
  assert.equal(sim.trade.transitFor[cell * TRADE_GOODS + salt], 1);
  assert.equal(sim.trade.transitKeep[cell * TRADE_GOODS + salt], keep, 'a merchant load of salt');
  assert.ok(sim.trade.want[cell * TRADE_GOODS + salt] >= keep - 1e-3, 'asks for it');
  // Its people need salt too (luxury goods are used up where buildings stand), but the partner's stays.
  place(sim, cell, typeOf('Hut'));
  sim.economy.luxury[cell * STORED_COUNT] = keep;
  runEconomy(sim, true, cell, sim.world.cellCount);
  assert.ok(sim.economy.luxury[cell * STORED_COUNT] >= keep - 1e-3, `held for the partner: ${sim.economy.luxury[cell * STORED_COUNT]}`);
});

test('settlements do not build seats of government: a planned seat is for the government', () => {
  const { sim, cell } = settledHex(3);
  sim.economy.stock[cell * MATERIAL_COUNT + Material.Wood] = 1000;
  sim.economy.stock[cell * MATERIAL_COUNT + Material.Stone] = 1000;
  sim.seatSite[cell] = 1;
  runEconomy(sim, false, cell, sim.world.cellCount);
  for (let s = cell * SLOTS; s < (cell + 1) * SLOTS; s++) {
    assert.ok(sim.economy.state[s] === SlotState.Empty || BUILDINGS[sim.economy.type[s]].name !== 'Seat of government', `slot ${s - cell * SLOTS}`);
  }
});

test('a seat of government whose harvest lacks its upkeep orders ten years of it, before all other trips', () => {
  const { sim, cell } = settledHex(3);
  place(sim, cell, typeOf('Seat of government'));
  sim.economy.stock[cell * MATERIAL_COUNT + Material.Wood] = 0;
  sim.economy.stock[cell * MATERIAL_COUNT + Material.Stone] = 0;
  updateTradeNeeds(sim, cell, sim.cellAdults[cell], false, 4);
  const seat = BUILDINGS[typeOf('Seat of government')];
  for (const m of [Material.Wood, Material.Stone]) {
    const g = m === Material.Wood ? TradeGood.Wood : TradeGood.Stone;
    assert.ok(sim.trade.want[cell * TRADE_GOODS + g] >= 10 * (m === Material.Wood ? seat.upkeepWood - 2 : seat.upkeepStone - 2) - 1e-3, `asks for ${m}`);
    assert.ok(sim.trade.hubFocus[cell * TRADE_GOODS + g] > 3, 'those trips come first');
  }
});

test('city tier follows the share of used slots: 50 % small, 80 % big, no rounding', () => {
  // 6 slots (plains): 3 and 5 buildings are the thresholds.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((u) => cityTier(u, 6)), [0, 0, 0, 1, 1, 2, 2]);
  // 4 slots: 2 and 4.
  assert.deepEqual([0, 1, 2, 3, 4].map((u) => cityTier(u, 4)), [0, 0, 1, 1, 2]);
  assert.equal(cityTier(2, 6), CityTier.Tribe, '33 % is still a tribe');
  assert.equal(cityTier(3, 4), CityTier.SmallCity, '75 % is not yet a big city');
  // Government buildings push the share over 100 %: just a big city.
  assert.equal(cityTier(7, 4), CityTier.BigCity);
  assert.equal(cityTier(12, 6), CityTier.BigCity);
  // No buildings is always a tribe.
  assert.equal(cityTier(0, 4), CityTier.Tribe);
  assert.equal(cityTier(0, 0), CityTier.Tribe);
});

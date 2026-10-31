import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRECTION_COUNT } from '../hex';
import { sumTerms } from '../terms';
import { Biome, isWaterBiome } from '../world/biomes';
import { generateWorld } from '../world/generate';
import { addRoad } from '../world/roads';
import { BUILDINGS, SLOTS, SlotState } from './buildings';
import { updateCellSupply } from './economy';
import { TICKS_PER_YEAR, createSimulation, hexSupplyTerms, stepSimulation, type Simulation } from './simulation';
import { SUPPLY_KINDS, SupplyKind } from './supply';
import { PROVISIONS_MAX, TRADE_GOODS, TradeGood, travelOnWays, updateTradeBuildings } from './trade';

const typeOf = (name: string) => BUILDINGS.findIndex((b) => b.name === name);

function runYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR; t++) stepSimulation(sim);
}

function place(sim: Simulation, cell: number, type: number): void {
  for (let s = cell * SLOTS; s < (cell + 1) * SLOTS; s++) {
    if (sim.economy.state[s] !== SlotState.Empty) continue;
    sim.economy.type[s] = type;
    sim.economy.state[s] = SlotState.Standing;
    sim.hasBuildings[cell] = 1;
    updateTradeBuildings(sim, cell);
    updateCellSupply(sim, cell);
    return;
  }
  throw new Error('no free slot');
}

const neighbor = (sim: Simulation, cell: number, dir: number) => sim.world.neighbors[cell * DIRECTION_COUNT + dir];
const terrain = (sim: Simulation, a: number, b: number) => (sim.world.moveCost[a] + sim.world.moveCost[b]) / 2;

test('rivers are ways: downstream three times as fast as upstream', () => {
  const sim = createSimulation(generateWorld({ seed: 12 }));
  const { world } = sim;
  const from = [...world.riverFlow.keys()].find((c) => {
    if (world.riverFlow[c] <= 0 || world.riverDir[c] < 0) return false;
    const next = neighbor(sim, c, world.riverDir[c]);
    return next >= 0 && !isWaterBiome(world.biome[c]) && !isWaterBiome(world.biome[next]) && world.roads[c] === 0;
  })!;
  const to = neighbor(sim, from, world.riverDir[from]);
  world.owner[from] = 1;
  world.owner[to] = 1;
  const down = travelOnWays(sim, from, to);
  const up = travelOnWays(sim, to, from);
  assert.ok(Math.abs(down - terrain(sim, from, to) * 0.25) < 1e-6, `down ${down}`);
  assert.ok(Math.abs(up - terrain(sim, from, to) * 0.75) < 1e-6, `up ${up}`);
});

test('merchants only travel on ways, and never through another people', () => {
  const sim = createSimulation(generateWorld({ seed: 12 }));
  const { world } = sim;
  // Two neighboring dry land hexes without roads or rivers anywhere near.
  const dry = (c: number) => c >= 0 && !isWaterBiome(world.biome[c]) && world.riverFlow[c] === 0 && world.roads[c] === 0;
  let a = -1;
  let dir = -1;
  for (let c = 0; c < world.cellCount && a < 0; c++) {
    if (!dry(c)) continue;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const b = neighbor(sim, c, d);
      if (dry(b)) {
        a = c;
        dir = d;
        break;
      }
    }
  }
  const b = neighbor(sim, a, dir);
  world.owner[a] = 1;
  assert.equal(travelOnWays(sim, a, b), Infinity, 'no way without a road');
  addRoad(world, a, dir);
  assert.ok(Math.abs(travelOnWays(sim, a, b) - terrain(sim, a, b) * 0.5) < 1e-6, 'a road is a way');
  world.owner[b] = 2;
  assert.equal(travelOnWays(sim, a, b), Infinity, 'not into another people');
});

test('the sea is a way only between two harbors', () => {
  const sim = createSimulation(generateWorld({ seed: 12 }));
  const { world } = sim;
  // A coastal hex and another coastal hex a few water hexes away.
  const coast = (c: number) =>
    !isWaterBiome(world.biome[c]) && [0, 1, 2, 3, 4, 5].some((d) => {
      const nb = neighbor(sim, c, d);
      return nb >= 0 && world.biome[nb] === Biome.ShallowSea;
    });
  const coasts = [...world.biome.keys()].filter(coast);
  const a = coasts[0];
  world.owner[a] = 1;
  place(sim, a, typeOf('Harbor'));
  let b = -1;
  for (const c of coasts) {
    if (c === a) continue;
    world.owner[c] = 1;
    place(sim, c, typeOf('Harbor'));
    if (travelOnWays(sim, a, c) < Infinity) {
      b = c;
      break;
    }
  }
  assert.ok(b >= 0, 'two harbors connected by sea');
  const s = b * SLOTS + [0, 1, 2, 3].find((k) => sim.economy.type[b * SLOTS + k] === typeOf('Harbor'))!;
  sim.economy.state[s] = SlotState.Ruin;
  updateTradeBuildings(sim, b);
  assert.equal(travelOnWays(sim, a, b), Infinity, 'no landing without a harbor');
});

test('a granary turns spare food into grain, and grain in stock feeds people', () => {
  const sim = createSimulation(generateWorld({ seed: 12 }));
  const cell = sim.world.startCell;
  const food = sim.cellSupply[cell * SUPPLY_KINDS + SupplyKind.Food];
  place(sim, cell, typeOf('Granary'));
  assert.ok(Math.abs(sim.cellSupply[cell * SUPPLY_KINDS + SupplyKind.Food] - (food - 25)) < 1e-3);
  sim.economy.provisions[cell * 2] = 80;
  updateCellSupply(sim, cell);
  const terms = hexSupplyTerms(sim, cell)[SupplyKind.Food];
  assert.ok(terms.some((t) => t.label === 'Grain in stock' && t.value === PROVISIONS_MAX));
  assert.ok(Math.abs(sumTerms(terms) - sim.cellSupply[cell * SUPPLY_KINDS + SupplyKind.Food]) < 1e-3);
});

test('merchants trade within their people and lose a little on the way', () => {
  const sim = createSimulation(generateWorld({ seed: 7 }));
  runYears(sim, 300);
  const { trade } = sim;
  assert.ok(trade.trips > 20, `${trade.trips} trips`);
  let delivered = 0;
  let lost = 0;
  for (let g = 0; g < TRADE_GOODS; g++) {
    if (g === TradeGood.Money) continue;
    delivered += trade.delivered[g];
    lost += trade.lost[g];
  }
  assert.ok(delivered > 0 && lost > 0, `${delivered} delivered, ${lost} lost`);
  assert.ok(lost / (delivered + lost) < 0.05, 'losses stay a small share');
  for (let c = 0; c < sim.world.cellCount; c++) {
    assert.ok(sim.economy.money[c] > -1e-3, `money of ${c}`);
    assert.ok(trade.away[c] <= trade.merchants[c] || trade.merchants[c] === 0);
  }
});

test('trade is the same for the same seed', () => {
  const run = () => {
    const sim = createSimulation(generateWorld({ seed: 7 }));
    runYears(sim, 200);
    return [sim.trade.trips, Array.from(sim.trade.delivered), Array.from(sim.economy.money)];
  };
  assert.deepEqual(run(), run());
});

test('the simulation adds up supply exactly as the hex info shows it, in every hex', () => {
  const sim = createSimulation(generateWorld({ seed: 7 }));
  runYears(sim, 220);
  for (let c = 0; c < sim.world.cellCount; c++) {
    const terms = hexSupplyTerms(sim, c);
    for (let k = 0; k < SUPPLY_KINDS; k++) {
      const shown = sumTerms(terms[k]);
      assert.ok(Math.abs(shown - sim.cellSupply[c * SUPPLY_KINDS + k]) < 1e-3, `hex ${c} supply ${k}: ${shown} vs ${sim.cellSupply[c * SUPPLY_KINDS + k]}`);
    }
  }
});

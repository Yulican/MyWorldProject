import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../world/generate';
import {
  CLOSED_TRUST,
  SIGHT_RANGE,
  AGREEMENT_TRUST,
  EVENT_TRUST,
  GRACE_YEARS,
  LACK_TRUST,
  MIGRATION_LOSS,
  OPEN_TRUST,
  PAIRS,
  TOLL_BASE,
  TOLL_REDUCED,
  TRUST_BASE,
  closeBorders,
  dangerTerms,
  dangerValue,
  exchangeAmounts,
  mayPass,
  type TradeLeg,
  nearness,
  noteEmigration,
  payToll,
  tollValue,
  trustTerms,
  trustValue,
  updateDiplomacy,
} from './diplomacy';
import { DIRECTION_COUNT } from '../hex';
import { hasRoad } from '../world/roads';
import { TICKS_PER_YEAR, createSimulation, livingCivilizations, splitCutOffLand, stepSimulation, type Simulation } from './simulation';
import { MONEY_PER_ADULT, PRICE, TRADE_GOODS, TradeGood, addStock, stockOf } from './trade';

function runYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR; t++) stepSimulation(sim);
}

const sumTerms = (terms: { value: number }[]) => terms.reduce((s, t) => s + t.value, 0);
const pair = (a: number, b: number) => a * PAIRS + b;

/** World 17: the first two peoples meet in year 82. */
function metWorld(): { sim: Simulation; a: number; b: number } {
  const sim = createSimulation(generateWorld({ seed: 17 }));
  runYears(sim, 83);
  const met = sim.chronicle.find((e) => e.text.endsWith(' met.'));
  assert.ok(met, 'two peoples met');
  const [a, b] = livingCivilizations(sim)
    .filter((c) => met.text.includes(c.name))
    .map((c) => c.id);
  return { sim, a, b };
}

const noRecord = () => {};

test('peoples meet within reach, and trust and danger come from their terms', () => {
  const { sim, a, b } = metWorld();
  const dip = sim.diplomacy;
  assert.equal(dip.known[pair(a, b)], 1);
  assert.equal(dip.known[pair(b, a)], 1);
  assert.ok(dip.distance[pair(a, b)] <= SIGHT_RANGE);
  const trust = trustTerms(sim, a, b);
  assert.equal(trust[0].value, TRUST_BASE);
  assert.ok(Math.abs(dip.trust[pair(a, b)] - Math.max(0, Math.min(100, sumTerms(trust)))) < 1e-4);
  const danger = sumTerms(dangerTerms(sim, a, b));
  assert.ok(Math.abs(dip.danger[pair(a, b)] - Math.max(0, Math.min(100, danger))) < 1e-4);
  assert.equal(nearness(0), 1);
  assert.equal(nearness(SIGHT_RANGE), 0);
  assert.equal(nearness(Infinity), 0);
});

test('peaceful neighbors trust each other more every year, the nearer the faster', () => {
  const { sim, a, b } = metWorld();
  for (let year = 0; year < 3; year++) {
    const before = sim.diplomacy.peace[pair(a, b)];
    runYears(sim, 1);
    const grown = sim.diplomacy.peace[pair(a, b)] - before;
    assert.ok(Math.abs(grown - nearness(sim.diplomacy.distance[pair(a, b)])) < 1e-5, `year ${year}: ${grown}`);
  }
});

test('borders open with enough trust, and closing them ends every agreement', () => {
  const { sim, a, b } = metWorld();
  const dip = sim.diplomacy;
  const owner = sim.world.owner;
  // Years of peace: both trust each other enough for everything.
  dip.peace[pair(a, b)] = 40;
  dip.peace[pair(b, a)] = 40;
  const entries: string[] = [];
  updateDiplomacy(sim, owner, (text) => entries.push(text));
  assert.ok(dip.trust[pair(a, b)] >= OPEN_TRUST);
  if (dip.danger[pair(a, b)] <= 40) assert.equal(dip.open[pair(a, b)], 1, 'a opened to b');
  assert.ok(entries.some((e) => e.includes('opened their borders')), entries.join(' | '));
  assert.equal(mayPass(dip, b, a), dip.open[pair(a, b)] === 1);
  assert.ok(trustTerms(sim, b, a).some((t) => t.label === 'Opened their borders to us' && t.value === EVENT_TRUST) || !dip.open[pair(a, b)]);

  dip.open[pair(a, b)] = 1;
  dip.freeTrade[pair(a, b)] = dip.freeTrade[pair(b, a)] = 1;
  dip.migration[pair(a, b)] = dip.migration[pair(b, a)] = 1;
  closeBorders(sim, a, b, noRecord);
  assert.equal(dip.open[pair(a, b)], 0);
  assert.equal(dip.freeTrade[pair(a, b)], 0);
  assert.equal(dip.migration[pair(b, a)], 0);
  assert.equal(dip.peace[pair(b, a)], 0);
  assert.ok(trustTerms(sim, b, a).some((t) => t.label === 'Closed their borders to us' && t.value === CLOSED_TRUST));
  assert.equal(mayPass(dip, b, a), false);
  assert.equal(mayPass(dip, b, 0), true);
  assert.equal(mayPass(dip, b, b), true);
});

test('people leaving without a migration agreement cost trust, at most four groups worth', () => {
  const { sim, a, b } = metWorld();
  const loss = () => sumTerms(trustTerms(sim, a, b).filter((t) => t.label === 'Took our people'));
  noteEmigration(sim, a, b);
  assert.equal(loss(), MIGRATION_LOSS);
  for (let i = 0; i < 6; i++) noteEmigration(sim, a, b);
  assert.equal(loss(), 4 * MIGRATION_LOSS);
  // Not with an agreement, and never for the people that gains them.
  const { sim: sim2, a: a2, b: b2 } = metWorld();
  sim2.diplomacy.migration[pair(a2, b2)] = 1;
  noteEmigration(sim2, a2, b2);
  assert.equal(trustTerms(sim2, a2, b2).filter((t) => t.label === 'Took our people').length, 0);
  assert.equal(trustTerms(sim2, b2, a2).filter((t) => t.label === 'Took our people').length, 0);
});

test('toll: less with trust, double when the settlement is short, half for partners', () => {
  const { sim, a, b } = metWorld();
  const cell = livingCivilizations(sim).find((c) => c.id === a)!.capital;
  sim.economy.money[cell] = 1e6;
  sim.trade.want.fill(0, cell * TRADE_GOODS, (cell + 1) * TRADE_GOODS);
  sim.diplomacy.trust[pair(a, b)] = 50;
  assert.ok(Math.abs(tollValue(sim, cell, a, b, false) - TOLL_BASE * 0.5) < 1e-6);
  assert.ok(Math.abs(tollValue(sim, cell, a, b, true) - TOLL_BASE * 0.5 * TOLL_REDUCED) < 1e-6);
  sim.economy.money[cell] = 0;
  assert.ok(sim.cellAdults[cell] * MONEY_PER_ADULT > 0);
  assert.ok(Math.abs(tollValue(sim, cell, a, b, false) - TOLL_BASE) < 1e-6);
});

test('toll is paid in goods the settlement asks for first, the rest in money', () => {
  const { sim, a } = metWorld();
  const civA = livingCivilizations(sim).find((c) => c.id === a)!;
  const to = civA.capital;
  const payer = [...sim.world.owner.keys()].find((c) => sim.cellPop[c] > 0 && c !== to)!;
  const want = sim.trade.want;
  want.fill(0, to * TRADE_GOODS, (to + 1) * TRADE_GOODS);
  want[to * TRADE_GOODS + TradeGood.Wood] = 1;
  sim.economy.money[payer] = 10;
  const moneyTo = sim.economy.money[to];
  addStock(sim.economy, payer, TradeGood.Wood, 5 - stockOf(sim.economy, payer, TradeGood.Wood));
  const woodTo = stockOf(sim.economy, to, TradeGood.Wood);
  const ok = payToll(sim, to, 3, (g) => stockOf(sim.economy, payer, g), (g, u) => addStock(sim.economy, payer, g, -u), PRICE, payer);
  assert.ok(ok);
  assert.ok(Math.abs(stockOf(sim.economy, to, TradeGood.Wood) - woodTo - 1) < 1e-6, '1 wood it asked for');
  assert.ok(Math.abs(sim.economy.money[payer] - (10 - 2 * PRICE[TradeGood.Wood])) < 1e-6, 'the rest in money');
  assert.ok(Math.abs(sim.economy.money[to] - moneyTo - 2) < 1e-6);
  // Not enough: nothing is paid.
  sim.economy.money[payer] = 0;
  const before = stockOf(sim.economy, payer, TradeGood.Wood);
  assert.equal(payToll(sim, to, 1000, (g) => stockOf(sim.economy, payer, g), (g, u) => addStock(sim.economy, payer, g, -u), PRICE, payer), false);
  assert.equal(stockOf(sim.economy, payer, TradeGood.Wood), before);
});

/** Hexes of `civ` reachable by road from its capital through its own hexes, without `blocked`. */
function connected(sim: Simulation, owner: Uint8Array, civ: number, capital: number, blocked: number): Set<number> {
  const seen = new Set([capital]);
  const queue = [capital];
  for (let k = 0; k < queue.length; k++) {
    const c = queue[k];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = sim.world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || nb === blocked || seen.has(nb) || owner[nb] !== civ || !hasRoad(sim.world, c, d)) continue;
      seen.add(nb);
      queue.push(nb);
    }
  }
  return seen;
}

test('land cut off by a closed border gets a grace period before it breaks away', () => {
  const sim = createSimulation(generateWorld({ seed: 17 }));
  runYears(sim, 150);
  const owner = Uint8Array.from(sim.world.owner);
  // A people, a hex of it the rest of its land depends on, and another people.
  let civ = 0;
  let middle = -1;
  for (const c of livingCivilizations(sim)) {
    const all = connected(sim, owner, c.id, c.capital, -1);
    for (const m of all) {
      if (m === c.capital) continue;
      if (connected(sim, owner, c.id, c.capital, m).size < all.size - 1) {
        civ = c.id;
        middle = m;
        break;
      }
    }
    if (middle >= 0) break;
  }
  assert.ok(middle >= 0, 'found a hex the land depends on');
  const other = livingCivilizations(sim).find((c) => c.id !== civ)!.id;
  const dip = sim.diplomacy;
  // The middle hex now belongs to the other people, whose borders are open.
  owner[middle] = other;
  dip.open[pair(other, civ)] = 1;
  dip.bordersVersion++;
  const peoples = livingCivilizations(sim).length;
  splitCutOffLand(sim, owner);
  assert.equal(livingCivilizations(sim).length, peoples, 'connected through open land');
  // The border closes: grace first, then the land breaks away.
  dip.open[pair(other, civ)] = 0;
  dip.bordersVersion++;
  splitCutOffLand(sim, owner);
  assert.equal(livingCivilizations(sim).length, peoples, 'still in its grace period');
  assert.ok(Array.from(dip.cutOffSince).some((t) => t === sim.tick));
  sim.tick += GRACE_YEARS * TICKS_PER_YEAR;
  splitCutOffLand(sim, owner);
  assert.equal(livingCivilizations(sim).length, peoples + 1, 'broke away after the grace period');
});

test('every diplomatic event goes into the chronicle with a place', () => {
  const { sim } = metWorld();
  const met = sim.chronicle.find((e) => e.text.endsWith(' met.'))!;
  assert.ok(met.cell >= 0 && met.cell < sim.world.cellCount);
});

test('diplomacy keeps the history the same for the same seed', () => {
  const run = () => {
    const sim = createSimulation(generateWorld({ seed: 17 }));
    runYears(sim, 120);
    return [Array.from(sim.diplomacy.trust.subarray(0, 8 * PAIRS)), sim.chronicle.map((e) => e.text)];
  };
  assert.deepEqual(run(), run());
});

test('the simulation uses the same trust and danger the diplomacy panel explains', () => {
  const sim = createSimulation(generateWorld({ seed: 17 }));
  runYears(sim, 160);
  let pairs = 0;
  for (const a of livingCivilizations(sim)) {
    for (const b of livingCivilizations(sim)) {
      if (a === b || !sim.diplomacy.known[pair(a.id, b.id)]) continue;
      pairs++;
      const explained = (terms: { value: number }[]) => Math.max(0, Math.min(100, sumTerms(terms)));
      assert.ok(Math.abs(trustValue(sim, a.id, b.id) - explained(trustTerms(sim, a.id, b.id))) < 1e-4);
      assert.ok(Math.abs(dangerValue(sim, a.id, b.id) - explained(dangerTerms(sim, a.id, b.id))) < 1e-4);
    }
  }
  assert.ok(pairs > 0);
});

const leg = (supplier: number, buyer: number, good: number, amount: number, tick: number): TradeLeg => ({
  supplier,
  buyer,
  good,
  amount,
  delivered: 0,
  yearStart: tick,
  shortYears: 0,
  years: 1,
  hub: -1,
});

test('a one-sided trade agreement makes the receiver trust the giver more; a two-sided one both the same', () => {
  const { sim, a, b } = metWorld();
  const dip = sim.diplomacy;
  const label = (x: number, y: number, l: string) => trustTerms(sim, x, y).find((t) => t.label.startsWith(l))?.value ?? 0;
  dip.agreements = [{ a, b, since: sim.tick, legs: [leg(b, a, TradeGood.Grain, 10, sim.tick)] }];
  assert.equal(label(a, b, 'Trade agreements'), AGREEMENT_TRUST);
  assert.equal(label(b, a, 'Trade agreements'), AGREEMENT_TRUST);
  assert.equal(label(a, b, 'Delivers goods we lack'), LACK_TRUST, 'the receiver');
  assert.equal(label(b, a, 'Delivers goods we lack'), 0, 'not the giver');
  assert.ok(Math.abs(trustValue(sim, a, b) - Math.min(100, sumTerms(trustTerms(sim, a, b)))) < 1e-4);

  dip.agreements = [{ a, b, since: sim.tick, legs: [leg(b, a, TradeGood.Grain, 10, sim.tick), leg(a, b, TradeGood.Water, 10, sim.tick)] }];
  assert.equal(label(a, b, 'Delivers goods we lack'), 0);
  assert.equal(label(b, a, 'Delivers goods we lack'), 0);
  assert.equal(label(a, b, 'Trade agreements'), AGREEMENT_TRUST);
});

test('two-sided trade agreements: legs of equal value, limited by lack and spare', () => {
  const goods = TRADE_GOODS;
  const want = new Float32Array(3 * goods);
  const spare = new Float32Array(3 * goods);
  const salt = TradeGood.Luxury;
  // 1 lacks 30 grain, 2 spares 40; 2 asks for 3 salt, 1 spares 6.
  want[1 * goods + TradeGood.Grain] = 30;
  spare[2 * goods + TradeGood.Grain] = 40;
  want[2 * goods + salt] = 3;
  spare[1 * goods + salt] = 6;
  const [grain, back] = exchangeAmounts(want, spare, 2, 1, TradeGood.Grain, salt)!;
  assert.equal(back, 3, 'as much salt as 2 asks for');
  assert.equal(grain * PRICE[TradeGood.Grain], back * PRICE[salt], 'equal value');
  // Too little of the counter good for a worthwhile leg.
  want[2 * goods + salt] = 1;
  assert.equal(exchangeAmounts(want, spare, 2, 1, TradeGood.Grain, salt), null);
});

test('a two-sided agreement breaks when one leg delivers too little; only its receiver holds it against the other', () => {
  const { sim, a, b } = metWorld();
  const dip = sim.diplomacy;
  // Trust high enough to keep it; b still asks for water.
  dip.peace[pair(a, b)] = dip.peace[pair(b, a)] = 40;
  sim.trade.civWant[b * TRADE_GOODS + TradeGood.Water] = 10;
  const short = leg(a, b, TradeGood.Water, 10, sim.tick - TICKS_PER_YEAR);
  short.shortYears = 1;
  const full = leg(b, a, TradeGood.Grain, 10, sim.tick - TICKS_PER_YEAR);
  full.delivered = 10;
  dip.agreements = [{ a, b, since: sim.tick - TICKS_PER_YEAR, legs: [full, short] }];
  const entries: string[] = [];
  updateDiplomacy(sim, sim.world.owner, (text) => entries.push(text));
  assert.ok(entries.some((e) => e.includes('broke: too little water arrived')), entries.join(' | '));
  assert.ok(!dip.agreements.some((t) => t.legs.includes(short)));
  const broke = (x: number, y: number) => trustTerms(sim, x, y).some((t) => t.label === 'Broke a trade agreement with us');
  assert.ok(broke(b, a), 'b got too little water from a');
  assert.ok(!broke(a, b), 'a got its grain');
});

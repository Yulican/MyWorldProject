import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BENCHMARK, SCENARIOS, evaluateSwipe, scenarioFromUrl, summarizeBenchmark, swipePlan, type SwipeResult } from './benchmark';

test('the plan has 10 swipes in each of the 8 directions at 1500 pt/s', () => {
  const plan = swipePlan();
  assert.equal(plan.length, 80);
  const perDirection = new Map<string, number>();
  for (const s of plan) perDirection.set(s.direction, (perDirection.get(s.direction) ?? 0) + 1);
  assert.equal(perDirection.size, 8);
  for (const n of perDirection.values()) assert.equal(n, 10);
  for (const s of plan) {
    const speed = Math.hypot(s.dx, s.dy) / (s.durationMs / 1000);
    assert.ok(Math.abs(speed - BENCHMARK.speed) < 1e-6);
  }
});

test('the plan returns to where it started, so it never runs into the map edge', () => {
  const plan = swipePlan();
  const x = plan.reduce((sum, s) => sum + s.dx, 0);
  const y = plan.reduce((sum, s) => sum + s.dy, 0);
  assert.ok(Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6);
});

test('a swipe passes only with >= 60 fps and no frame over 25 ms', () => {
  assert.equal(evaluateSwipe({ frames: 30, timeMs: 500.5, worstMs: 17 }).pass, true); // 59.9 fps on 60 Hz
  assert.equal(evaluateSwipe({ frames: 28, timeMs: 500, worstMs: 20 }).pass, false); // 56 fps
  assert.equal(evaluateSwipe({ frames: 60, timeMs: 500, worstMs: 26 }).pass, false); // one long frame
});

test('the benchmark passes only when all 400 swipes pass', () => {
  const ok: SwipeResult = { world: 0, seed: 1, direction: 'N', fps: 60, worstMs: 17, pass: true };
  const all = Array.from({ length: 400 }, () => ({ ...ok }));
  assert.equal(summarizeBenchmark(all).pass, true);
  all[123] = { ...ok, fps: 40, pass: false };
  assert.equal(summarizeBenchmark(all).pass, false);
  assert.equal(summarizeBenchmark(all.slice(0, 399)).pass, false);
});

test('the benchmark link picks the scenario, young by default', () => {
  assert.equal(scenarioFromUrl('myworld://benchmark'), 'young');
  assert.equal(scenarioFromUrl('myworld://benchmark?scenario=aged'), 'aged');
  assert.equal(scenarioFromUrl('myworld://benchmark?scenario=cities'), 'cities');
  assert.equal(scenarioFromUrl('myworld://benchmark?scenario=unrest'), 'unrest');
  assert.equal(scenarioFromUrl('myworld://benchmark?scenario=trade'), 'trade');
  assert.equal(scenarioFromUrl('myworld://benchmark?scenario=government'), 'government');
  assert.equal(scenarioFromUrl('myworld://benchmark?scenario=war'), 'war');
  assert.equal(scenarioFromUrl('myworld://benchmark?scenario=bogus'), 'young');
});

test('the cities scenario fills every settled hex with buildings and puts ruins beside them', async () => {
  const { createSimulation, generateWorld, TICKS_PER_YEAR, stepSimulation } = await import('../sim');
  const { fillWithBuildings } = await import('./fillBuildings');
  const { usableSlots } = await import('../sim/society/economy');
  const sim = createSimulation(generateWorld({ seed: 5 }));
  for (let t = 0; t < 60 * TICKS_PER_YEAR; t++) stepSimulation(sim);
  fillWithBuildings(sim);
  const { world } = sim;
  let cities = 0;
  let ruins = 0;
  for (let c = 0; c < world.cellCount; c++) {
    if (sim.cellPop[c] > 0) {
      assert.equal(world.buildings[c], usableSlots(sim, c), 'every slot the hex has');
      cities++;
    }
    if (world.ruins[c] > 0) ruins++;
  }
  assert.ok(cities > 0 && ruins > 0);
  assert.equal(SCENARIOS.cities.buildings, true);
});

test('the unrest scenario makes every settlement but the capitals break away', async () => {
  const { createSimulation, generateWorld, livingCivilizations, stepSimulation, TICKS_PER_YEAR } = await import('../sim');
  const { stirUnrest } = await import('./stirUnrest');
  const sim = createSimulation(generateWorld({ seed: 5 }));
  for (let t = 0; t < 300 * TICKS_PER_YEAR; t++) stepSimulation(sim);
  stirUnrest(sim);
  const rebels = livingCivilizations(sim).filter((c) => c.origin === 'revolution');
  assert.ok(rebels.length > 0);
  // Most of the land changed hands: the rebels hold more hexes than the old peoples.
  const held = (civs: typeof rebels) => civs.reduce((n, c) => n + c.territory, 0);
  const old = livingCivilizations(sim).filter((c) => c.origin !== 'revolution');
  assert.ok(held(rebels) > held(old), `rebels ${held(rebels)} hexes, others ${held(old)}`);
  assert.equal(SCENARIOS.unrest.unrest, true);
});

test('the trade scenario opens trade everywhere and merchants set out', async () => {
  const { createSimulation, generateWorld, TICKS_PER_YEAR, stepSimulation } = await import('../sim');
  const { openTrade } = await import('./openTrade');
  const sim = createSimulation(generateWorld({ seed: 7 }));
  for (let t = 0; t < 150 * TICKS_PER_YEAR; t++) stepSimulation(sim);
  const before = sim.trade.trips;
  // Every settlement there is when trade opens (new ones may be founded in the half year after).
  const settled = [...Array(sim.world.cellCount).keys()].filter((c) => sim.cellPop[c] > 0);
  openTrade(sim);
  for (const c of settled) {
    if (sim.cellPop[c] > 0) assert.ok(sim.trade.merchants[c] >= 2, `merchants of ${c}`);
  }
  assert.ok(sim.trade.trips > before, 'merchants set out');
  assert.equal(SCENARIOS.trade.trade, true);
});

test('the trade scenario runs on in tick parts, as the game clock runs it, like whole ticks', async () => {
  const { createSimulation, generateWorld, TICKS_PER_YEAR, stepSimulation, stepSimulationPart } = await import('../sim');
  const { openTrade } = await import('./openTrade');
  const make = () => {
    const sim = createSimulation(generateWorld({ seed: 11 }));
    for (let t = 0; t < 150 * TICKS_PER_YEAR; t++) stepSimulation(sim);
    openTrade(sim);
    return sim;
  };
  const whole = make();
  const parts = make();
  // Two years: every yearly plan that runs in several parts (diplomacy, military, war) comes up twice.
  for (let t = 0; t < 2 * TICKS_PER_YEAR; t++) {
    stepSimulation(whole);
    while (!stepSimulationPart(parts));
  }
  assert.equal(parts.tick, whole.tick);
  assert.deepEqual(parts.world.owner, whole.world.owner);
  assert.deepEqual(parts.economy.stock, whole.economy.stock);
  assert.equal(JSON.stringify(parts.diplomacy.agreements), JSON.stringify(whole.diplomacy.agreements));
  assert.equal(parts.planStep, 0);
});

test('the diplomacy scenario opens every border and merchants travel abroad', async () => {
  const { createSimulation, generateWorld, livingCivilizations, stepSimulation, TICKS_PER_YEAR } = await import('../sim');
  const { openDiplomacy } = await import('./openDiplomacy');
  const { PAIRS } = await import('../sim/society/diplomacy');
  const sim = createSimulation(generateWorld({ seed: 5 }));
  for (let t = 0; t < 300 * TICKS_PER_YEAR; t++) stepSimulation(sim);
  openDiplomacy(sim);
  const ids = livingCivilizations(sim).map((c) => c.id);
  assert.ok(ids.length > 1);
  for (const a of ids) for (const b of ids) if (a !== b) assert.equal(sim.world.openBorders[a * PAIRS + b], 1);
  assert.equal(SCENARIOS.diplomacy.diplomacy, true);
});

test('the government scenario puts up seats and government buildings everywhere and sends traders out', async () => {
  const { createSimulation, generateWorld, stepSimulation, TICKS_PER_YEAR } = await import('../sim');
  const { empowerGovernment } = await import('./empowerGovernment');
  const sim = createSimulation(generateWorld({ seed: 5 }));
  for (let t = 0; t < 300 * TICKS_PER_YEAR; t++) stepSimulation(sim);
  const seatsBefore = sim.world.seats.reduce((n, v) => n + (v ? 1 : 0), 0);
  empowerGovernment(sim);
  const seats = sim.world.seats.reduce((n, v) => n + (v ? 1 : 0), 0);
  assert.ok(seats > seatsBefore + 5, `${seatsBefore} -> ${seats} seats`);
  let traders = 0;
  for (let c = 0; c < sim.world.cellCount; c++) traders += sim.government.traders[c];
  assert.ok(traders > 2 * seatsBefore, `${traders} government traders`);
  assert.ok(sim.government.tripCount > 0, 'government traders on their way');
  assert.equal(SCENARIOS.government.government, true);
});

test('the war scenario puts peoples at war in pairs with as many armies as the caps allow and sieges, two blocks of allies', async () => {
  const { ArmyState, createSimulation, generateWorld, stepSimulation, TICKS_PER_YEAR, WAR } = await import('../sim');
  const { declareWarsEverywhere } = await import('./declareWars');
  const sim = createSimulation(generateWorld({ seed: 5 }));
  for (let t = 0; t < 300 * TICKS_PER_YEAR; t++) stepSimulation(sim);
  declareWarsEverywhere(sim);
  const w = sim.war;
  assert.ok(w.wars >= 5, `${w.wars} wars`);
  // Per war and people: at most WAR.maxArmies; the attacker has its one main army (retreating ones aside).
  const all = new Map<number, number>();
  const main = new Map<number, number>();
  for (let a = 0; a < w.live.length; a++) {
    if (!w.live[a]) continue;
    const s = w.aWar[a];
    const key = s * 256 + w.aCiv[a];
    all.set(key, (all.get(key) ?? 0) + 1);
    if (w.aCiv[a] === w.wAtt[s] && w.aState[a] !== ArmyState.Retreating) main.set(s, (main.get(s) ?? 0) + 1);
    assert.notEqual(w.aState[a], ArmyState.Gathering, 'all gathered');
  }
  for (const k of all.values()) assert.ok(k <= WAR.maxArmies, `${k} armies of one people`);
  for (const k of main.values()) assert.equal(k, WAR.mainArmies);
  // 32 armies (WAR.worldArmies) are out of reach under the caps: one war per people, 1 + up to 3 armies per war.
  assert.ok(w.armies <= WAR.worldArmies);
  assert.ok(w.armies >= 10 && w.armies >= w.wars + 2, `${w.armies} armies in ${w.wars} wars`);
  const sieges = w.siege.reduce((n, v) => n + v, 0);
  assert.ok(sieges >= 1, `${sieges} sieges in ${w.wars} wars`);
  // Two blocks of allies: alliances formed, allies joined the wars with their armies.
  const { Pact, pactBetween } = await import('../sim');
  const { PAIRS } = await import('../sim/society/diplomacy');
  let alliances = 0;
  let allies = 0;
  let allyArmies = 0;
  for (let a = 1; a < sim.civs.length; a++) for (let b = a + 1; b < sim.civs.length; b++) if (pactBetween(sim, a, b) === Pact.Alliance) alliances++;
  for (let s = 0; s < w.wLive.length; s++) {
    if (!w.wLive[s]) continue;
    for (let p = 1; p < PAIRS; p++) if (p !== w.wAtt[s] && p !== w.wDef[s] && w.side[s * PAIRS + p] >= 0) allies++;
  }
  for (let a = 0; a < w.live.length; a++) if (w.live[a] && w.civWar[w.aCiv[a]] !== w.aWar[a]) allyArmies++;
  assert.ok(alliances >= 10, `${alliances} alliances`);
  assert.ok(allies >= w.wars, `${allies} allies in ${w.wars} wars`);
  assert.ok(allyArmies >= 2, `${allyArmies} ally armies`);
  assert.equal(SCENARIOS.war.war, true);
});

test('the war scenario draws 32 armies: real ones plus map-only decoys that keep moving', async () => {
  const { MAX_ARMIES, createSimulation, generateWorld, isWaterBiome, stepSimulation, TICKS_PER_YEAR } = await import('../sim');
  const { declareWarsEverywhere } = await import('./declareWars');
  const { armyDecoys } = await import('./armyDecoys');
  const sim = createSimulation(generateWorld({ seed: 5 }));
  for (let t = 0; t < 300 * TICKS_PER_YEAR; t++) stepSimulation(sim);
  declareWarsEverywhere(sim);
  const real = sim.war.armies;
  const markers = { cell: new Int32Array(MAX_ARMIES), civ: new Uint8Array(MAX_ARMIES), state: new Uint8Array(MAX_ARMIES) };
  const decoys = armyDecoys();
  assert.equal(decoys.fill(sim, markers, real), 32);
  const before = markers.cell.slice(real);
  for (let i = real; i < 32; i++) {
    assert.ok(!isWaterBiome(sim.world.biome[markers.cell[i]]), 'on land');
    assert.ok(sim.civs[markers.civ[i]], 'a living people');
  }
  for (let t = 0; t < 4; t++) stepSimulation(sim);
  assert.equal(decoys.fill(sim, markers, real), 32);
  let moved = 0;
  for (let i = 0; i < before.length; i++) if (markers.cell[real + i] !== before[i]) moved++;
  assert.ok(moved > 0, 'decoys march');
  assert.equal(sim.war.armies, real, 'decoys never enter the simulation');
});

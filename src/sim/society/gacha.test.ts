import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRECTION_COUNT } from '../hex';
import { Biome, RESOURCE_COUNT, Resource, isWaterBiome } from '../world/biomes';
import { Deposit } from '../world/deposits';
import { generateWorld } from '../world/generate';
import { SlotState, takenSlots } from './buildings';
import { usableSlots } from './economy';
import {
  ABILITIES,
  ABILITY_COUNT,
  Ab,
  GACHA,
  LAND_CHANGES,
  MAX_EFFECTS,
  SHIFT_DRIER,
  SHIFT_WETTER,
  Tier,
  WEAKENING,
  canCast,
  castAbility,
  drawAbility,
  hexEffects,
  landChanges,
  leaderEffects,
  nextPullPrice,
  peopleEffects,
  pullGacha,
  pullPrice,
  resetGodCiv,
  shiftedBiome,
  updateWorship,
  validTargets,
  worships,
} from './gacha';
import { ATTRS } from './leaderRules';
import { ATTR_SLOTS, Goal, L, LEADER, LEVERS, NATURAL_SLOTS } from './leaders';
import { satisfactionTarget, satisfactionTerms } from './satisfaction';
import { BELIEVER_FAITH, TICKS_PER_YEAR, hexSupplyTerms, TickPart, createSimulation, livingCivilizations, stepSimulation, stepSimulationPart, type Simulation } from './simulation';
import { createRng } from '../rng';
import { sumTerms } from '../terms';

// Gacha ("Design Documents/Requirement Gacha.md"): Faith, price, pulls, the 25 abilities with their targets,
// the god layer, worship, fire, river, lake, slots and leaders beyond 3 attributes.

function run(seed: number, years: number): Simulation {
  const sim = createSimulation(generateWorld({ seed }));
  for (let t = 0; t < years * TICKS_PER_YEAR; t++) stepSimulation(sim);
  return sim;
}

/** A world after 80 years (several peoples with leaders). */
const aged = () => run(5, 80);

function give(sim: Simulation, ability: number, n = 1): void {
  sim.gacha.charges[ability] += n;
}

function cast(sim: Simulation, ability: number, target: number, option = 0): void {
  give(sim, ability);
  assert.ok(castAbility(sim, ability, target, option), `${ABILITIES[ability].name} on ${target}`);
}

const cells = (sim: Simulation, ok: (c: number) => boolean) => {
  const out: number[] = [];
  for (let c = 0; c < sim.world.cellCount; c++) if (ok(c)) out.push(c);
  return out;
};
const firstCell = (sim: Simulation, ok: (c: number) => boolean) => {
  for (let c = 0; c < sim.world.cellCount; c++) if (ok(c)) return c;
  assert.fail('no such hex');
};
const neighbors = (sim: Simulation, c: number) => {
  const out: number[] = [];
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = sim.world.neighbors[c * DIRECTION_COUNT + d];
    if (nb >= 0) out.push(nb);
  }
  return out;
};
const startCiv = (sim: Simulation) => livingCivilizations(sim)[0].id;
const leaderAttrs = (sim: Simulation, civ: number) => {
  const out: number[] = [];
  for (let i = 0; i < ATTR_SLOTS; i++) if (sim.leaders.attr[civ * ATTR_SLOTS + i]) out.push(sim.leaders.attr[civ * ATTR_SLOTS + i]);
  return out;
};
/** Lets the effect in its list end with the next tick. */
function endEffectsNow(sim: Simulation): void {
  const g = sim.gacha;
  for (let i = 0; i < MAX_EFFECTS; i++) if (g.effAbility[i] >= 0) g.effEnd[i] = sim.tick + 1;
  g.nextEnd = sim.tick + 1;
  stepSimulation(sim);
}

// ---------------------------------------------------------------------------
// Faith, price, pull

test('Faith accrues every tick: 0.001 per believer of the god, from 0, without a cap', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  assert.equal(sim.gacha.faith, 0);
  for (let t = 0; t < 30; t++) {
    const before: number = sim.gacha.faith;
    const believers = sim.believers;
    stepSimulation(sim);
    assert.ok(Math.abs(sim.gacha.faith - (before + GACHA.faithPerBeliever * believers)) < 1e-9);
  }
  assert.ok(sim.gacha.faith > 0);
});

test('the n-th pull costs round(75 n^1.8) and the price only rises', () => {
  for (let n = 1; n <= 40; n++) assert.equal(pullPrice(n), Math.round(75 * Math.pow(n, 1.8)));
  assert.deepEqual([1, 2, 3, 4].map(pullPrice), [75, 261, 542, 909]);
  for (let n = 1; n < 100; n++) assert.ok(pullPrice(n + 1) > pullPrice(n));
});

test('a pull needs enough Faith, pays the price and puts 3 charges into the inventory', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  assert.equal(pullGacha(sim), null);
  sim.gacha.faith = 80;
  assert.equal(nextPullPrice(sim), 75);
  const got = pullGacha(sim)!;
  assert.equal(got.length, 3);
  assert.ok(Math.abs(sim.gacha.faith - 5) < 1e-9);
  assert.equal(sim.gacha.pulls, 1);
  assert.equal(nextPullPrice(sim), 261);
  let charges = 0;
  for (let a = 0; a < ABILITY_COUNT; a++) charges += sim.gacha.charges[a];
  assert.equal(charges, 3);
  for (const a of got) assert.ok(sim.gacha.charges[a] >= 1);
  assert.equal(pullGacha(sim), null, 'not enough for the second');
});

test('pulls are deterministic per seed and do not shift the world', () => {
  const a = createSimulation(generateWorld({ seed: 9 }));
  const b = createSimulation(generateWorld({ seed: 9 }));
  a.gacha.faith = b.gacha.faith = 1e6;
  const pa: number[][] = [];
  const pb: number[][] = [];
  for (let i = 0; i < 10; i++) {
    pa.push(pullGacha(a)!);
    pb.push(pullGacha(b)!);
  }
  assert.deepEqual(pa, pb);
  // Pulling in one of two equal worlds changes nothing of the world's history.
  const c = createSimulation(generateWorld({ seed: 9 }));
  for (let t = 0; t < 3 * TICKS_PER_YEAR; t++) {
    stepSimulation(a);
    stepSimulation(c);
  }
  assert.equal(a.pop.count, c.pop.count);
  assert.equal(a.believers, c.believers);
});

test('rarity: tiers by weight 50/30/15/5, uniform within a tier, every ability in the pool (31: Faiths and Decree of Grace appended)', () => {
  const rng = createRng(1234);
  const n = 60000;
  const byTier = [0, 0, 0, 0];
  const byAbility = new Array<number>(ABILITY_COUNT).fill(0);
  for (let i = 0; i < n; i++) {
    const a = drawAbility(rng);
    byTier[ABILITIES[a].tier]++;
    byAbility[a]++;
  }
  const weights = [0.5, 0.3, 0.15, 0.05];
  for (let t = 0; t < 4; t++) assert.ok(Math.abs(byTier[t] / n - weights[t]) < 0.01, `tier ${t}: ${byTier[t] / n}`);
  const count = [7, 12, 9, 3];
  for (let a = 0; a < ABILITY_COUNT; a++) {
    const t = ABILITIES[a].tier;
    const expected = (weights[t] / count[t]) * n;
    assert.ok(Math.abs(byAbility[a] - expected) < 0.12 * expected + 30, `${ABILITIES[a].name}: ${byAbility[a]} vs ${expected}`);
  }
  assert.deepEqual(count, [0, 1, 2, 3].map((t) => ABILITIES.filter((a) => a.tier === t).length));
  assert.equal(ABILITIES.filter((a) => a.category === 0).length, 9);
  assert.equal(ABILITIES.filter((a) => a.category === 1).length, 9);
  assert.equal(ABILITIES.filter((a) => a.category === 2).length, 8);
  assert.equal(ABILITIES.filter((a) => a.category === 3).length, 5);
  ABILITIES.forEach((a, i) => assert.equal(a.id, i));
  assert.equal(ABILITIES[Ab.GreatRiver].tier, Tier.Legendary);
});

test('a cast needs a charge and a valid target; an invalid target costs no charge', () => {
  const sim = aged();
  const water = firstCell(sim, (c) => isWaterBiome(sim.world.biome[c]));
  assert.equal(castAbility(sim, Ab.ExhaustedSoil, firstCell(sim, (c) => !isWaterBiome(sim.world.biome[c]))), false, 'no charge');
  give(sim, Ab.ExhaustedSoil);
  assert.equal(castAbility(sim, Ab.ExhaustedSoil, water), false);
  assert.equal(sim.gacha.charges[Ab.ExhaustedSoil], 1);
  assert.equal(castAbility(sim, Ab.FruitfulWaters, startCiv(sim)), false, 'no charge of it');
  assert.equal(castAbility(sim, Ab.FruitfulWaters, 250), false);
  const land = validTargets(sim, Ab.ExhaustedSoil);
  assert.equal(land.length, cells(sim, (c) => !isWaterBiome(sim.world.biome[c])).length);
  assert.deepEqual(validTargets(sim, Ab.FruitfulWaters), livingCivilizations(sim).map((c) => c.id));
});

test('a cast while a tick runs in parts takes effect at the next tick start', () => {
  const sim = aged();
  const civ = startCiv(sim);
  stepSimulationPart(sim);
  assert.notEqual(sim.part, TickPart.Start);
  cast(sim, Ab.FruitfulWaters, civ);
  assert.equal(sim.gacha.charges[Ab.FruitfulWaters], 0);
  // The leader's lever with the faith's layer on top (Requirement Religion 4.4), the god's not yet.
  const birth = sim.leaders.own[civ * LEVERS + L.birth] * sim.religion.lev[civ * LEVERS + L.birth];
  assert.ok(Math.abs(sim.leaders.lev[civ * LEVERS + L.birth] - birth) < 1e-6);
  while (!stepSimulationPart(sim));
  stepSimulationPart(sim);
  assert.ok(Math.abs(sim.gacha.godLev[civ * LEVERS + L.birth] - 1.1) < 1e-6);
});

// ---------------------------------------------------------------------------
// Land

test('Fertile Blessing: fertility of 7 hexes to capacity x1.25 (at most 1) for 20 years, then exactly back', () => {
  const sim = aged();
  const w = sim.world;
  const center = firstCell(sim, (c) => !isWaterBiome(w.biome[c]) && neighbors(sim, c).every((n) => !isWaterBiome(w.biome[n])) && w.resourceCapacity[c * RESOURCE_COUNT] < 0.7);
  const area = [center, ...neighbors(sim, center)];
  const cap0 = area.map((c) => w.resourceCapacity[c * RESOURCE_COUNT + Resource.Fertility]);
  cast(sim, Ab.FertileBlessing, center);
  area.forEach((c, i) => {
    const k = c * RESOURCE_COUNT + Resource.Fertility;
    assert.ok(Math.abs(w.resourceCapacity[k] - Math.min(1, cap0[i] * 1.25)) < 1e-6);
    assert.equal(w.resources[k], w.resourceCapacity[k]);
  });
  assert.equal(hexEffects(sim, center)[0].name, 'Fertile Blessing');
  assert.equal(hexEffects(sim, center)[0].yearsLeft, 20);
  // A second cast replaces the running one (no stacking).
  cast(sim, Ab.FertileBlessing, center);
  area.forEach((c, i) => assert.ok(Math.abs(w.resourceCapacity[c * RESOURCE_COUNT] - Math.min(1, cap0[i] * 1.25)) < 1e-6));
  endEffectsNow(sim);
  area.forEach((c, i) => {
    assert.equal(w.resourceCapacity[c * RESOURCE_COUNT], cap0[i]);
    assert.ok(w.resources[c * RESOURCE_COUNT] <= cap0[i]);
  });
  assert.equal(hexEffects(sim, center).length, 0);
});

test('Exhausted Soil: all resources of the hex to 10 %', () => {
  const sim = aged();
  const c = firstCell(sim, (x) => !isWaterBiome(sim.world.biome[x]) && sim.world.resources[x * RESOURCE_COUNT] > 0.2);
  const before = Array.from(sim.world.resources.slice(c * RESOURCE_COUNT, (c + 1) * RESOURCE_COUNT));
  const cap = sim.cellCapacity[c];
  cast(sim, Ab.ExhaustedSoil, c);
  before.forEach((v, r) => assert.ok(Math.abs(sim.world.resources[c * RESOURCE_COUNT + r] - v * 0.1) < 1e-6));
  assert.ok(sim.cellCapacity[c] < cap);
});

test('Drought: moisture -0.25 on 37 hexes for 20 years, then exactly back', () => {
  const sim = aged();
  const w = sim.world;
  const center = firstCell(sim, (c) => !isWaterBiome(w.biome[c]));
  const before = Float32Array.from(w.moisture);
  cast(sim, Ab.Drought, center);
  let changed = 0;
  for (let c = 0; c < w.cellCount; c++) {
    if (w.moisture[c] === before[c]) continue;
    changed++;
    assert.ok(Math.abs(w.moisture[c] - (before[c] - 0.25)) < 1e-6);
    assert.ok(!isWaterBiome(w.biome[c]));
  }
  assert.ok(changed > 0 && changed <= 37);
  endEffectsNow(sim);
  assert.deepEqual(w.moisture, before);
});

test('Wide Foundations and Cramped Ground: slots without a limit, never below those in use; the arrays grow', () => {
  const sim = aged();
  const eco = sim.economy;
  const w = sim.world;
  const c = firstCell(sim, (x) => w.biome[x] === Biome.Plains && sim.cellPop[x] > 0);
  // Fill all 6 settlement slots and one government slot.
  for (let k = 0; k < 6; k++) {
    eco.type[c * eco.slots + k] = 0;
    eco.state[c * eco.slots + k] = SlotState.Standing;
  }
  eco.type[c * eco.slots + eco.half] = 0;
  eco.state[c * eco.slots + eco.half] = SlotState.Ruin;
  sim.hasBuildings[c] = 1;
  assert.equal(usableSlots(sim, c), 6);
  give(sim, Ab.CrampedGround);
  assert.equal(canCast(sim, Ab.CrampedGround, c), false, 'all slots in use');
  assert.equal(castAbility(sim, Ab.CrampedGround, c), false);
  for (let i = 0; i < 3; i++) cast(sim, Ab.WideFoundations, c);
  assert.equal(usableSlots(sim, c), 9);
  assert.ok(eco.half >= 9);
  assert.equal(eco.slots, 2 * eco.half);
  assert.equal(takenSlots(eco, c, 0), 6, 'buildings kept');
  assert.equal(eco.state[c * eco.slots + eco.half], SlotState.Ruin, 'government slot moved along');
  assert.equal(eco.state[c * eco.slots + 6], SlotState.Empty);
  assert.equal(usableSlots(sim, firstCell(sim, (x) => w.biome[x] === Biome.Plains && x !== c)), 6, 'others unchanged');
  cast(sim, Ab.CrampedGround, c);
  assert.equal(usableSlots(sim, c), 8);
  // An empty forest hex goes down to 0 slots, then no further.
  const f = firstCell(sim, (x) => w.biome[x] === Biome.Forest && sim.cellPop[x] === 0 && !sim.hasBuildings[x]);
  for (let i = 0; i < 4; i++) cast(sim, Ab.CrampedGround, f);
  assert.equal(usableSlots(sim, f), 0);
  assert.equal(canCast(sim, Ab.CrampedGround, f), false);
  // The economy keeps running on the wider arrays.
  for (let t = 0; t < 2 * TICKS_PER_YEAR; t++) stepSimulation(sim);
});

test('Rich Vein: a fitting metal or mineral deposit on a land hex without one', () => {
  const sim = aged();
  const w = sim.world;
  const hill = firstCell(sim, (c) => w.biome[c] === Biome.Hills && w.deposit[c] === 0);
  cast(sim, Ab.RichVein, hill);
  assert.ok([Deposit.Copper, Deposit.Tin, Deposit.Iron, Deposit.Gold, Deposit.Flint, Deposit.Marble].includes(w.deposit[hill] as never));
  assert.equal(canCast(sim, Ab.RichVein, hill), false, 'has one now');
  // No vein fits a forest.
  assert.equal(canCast(sim, Ab.RichVein, firstCell(sim, (c) => w.biome[c] === Biome.Forest && w.deposit[c] === 0)), false);
  assert.equal(canCast(sim, Ab.RichVein, firstCell(sim, (c) => isWaterBiome(w.biome[c]))), false);
});

test('Great River: a stream downhill into the sea, a lake or a river', () => {
  const sim = aged();
  const w = sim.world;
  const start = firstCell(sim, (c) => !isWaterBiome(w.biome[c]) && w.riverFlow[c] === 0 && neighbors(sim, c).some((n) => w.elevation[n] < w.elevation[c]) && w.elevation[c] > 0.2);
  const total = sim.gacha.landTotal;
  cast(sim, Ab.GreatRiver, start);
  // Follow it.
  let c = start;
  let steps = 0;
  while (steps < 20 && !isWaterBiome(w.biome[c]) && w.riverDir[c] >= 0 && w.riverFlow[c] > 0) {
    const next = w.neighbors[c * DIRECTION_COUNT + w.riverDir[c]];
    assert.ok(w.elevation[next] < w.elevation[c] || isWaterBiome(w.biome[next]));
    c = next;
    steps++;
  }
  assert.ok(steps >= 1);
  assert.ok(isWaterBiome(w.biome[c]) || w.riverFlow[c] > 0, 'ends in water or a river');
  assert.ok(sim.gacha.landTotal > total, 'the map redraws the path');
  const out = new Int32Array(LAND_CHANGES);
  const n = landChanges(sim, total, out);
  assert.ok(n >= 1 && Array.from(out.subarray(0, n)).includes(start));
});

test('Great River in a basin: the last hex becomes a lake and floods the settlement there', () => {
  const sim = aged();
  const w = sim.world;
  const eco = sim.economy;
  const c = firstCell(sim, (x) => sim.cellPop[x] > 0 && w.riverFlow[x] === 0 && !isWaterBiome(w.biome[x]));
  // No lower neighbor: a basin.
  w.elevation[c] = Math.min(...neighbors(sim, c).map((n) => w.elevation[n])) - 0.01;
  eco.type[c * eco.slots] = 0;
  eco.state[c * eco.slots] = SlotState.Standing;
  sim.hasBuildings[c] = 1;
  cast(sim, Ab.GreatRiver, c);
  assert.equal(w.biome[c], Biome.Lake);
  assert.equal(eco.state[c * eco.slots], SlotState.Ruin);
  assert.equal(sim.cellCapacity[c], 0);
  assert.equal(sim.cellPop[c], 0, 'the flood kills everyone on the hex');
});

test('Great River on a river: flow +1 from the target down to the mouth, with its water', () => {
  const sim = aged();
  const w = sim.world;
  const c = firstCell(sim, (x) => w.riverFlow[x] > 0 && !isWaterBiome(w.biome[x]) && w.riverFlow[x] < 5);
  const path: number[] = [];
  for (let x = c; x >= 0 && w.riverFlow[x] > 0 && !isWaterBiome(w.biome[x]); x = w.riverDir[x] >= 0 ? w.neighbors[x * DIRECTION_COUNT + w.riverDir[x]] : -1) path.push(x);
  const flows = path.map((x) => w.riverFlow[x]);
  const water = sim.cellSupply[c * 3 + 1];
  const total = sim.gacha.landTotal;
  cast(sim, Ab.GreatRiver, c);
  path.forEach((x, i) => assert.ok(Math.abs(w.riverFlow[x] - flows[i] - 1) < 1e-6));
  assert.ok(sim.cellSupply[c * 3 + 1] > water, 'more river water');
  assert.equal(sim.gacha.landTotal - total, path.length, 'the map redraws the river');
});

test('Wild Fire: burns 6 weeks, spreads, at most 40 hexes; burnt land is plains without wood, buildings ruined', () => {
  const sim = run(7, 30);
  const w = sim.world;
  const forest = (c: number) => w.biome[c] === Biome.Forest || w.biome[c] === Biome.Jungle || w.biome[c] === Biome.Savanna;
  // A hex in the largest wood.
  let best = -1;
  let bestN = -1;
  for (let c = 0; c < w.cellCount; c++) {
    if (!forest(c)) continue;
    const n = neighbors(sim, c).filter(forest).length;
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  }
  assert.equal(canCast(sim, Ab.WildFire, firstCell(sim, (c) => w.biome[c] === Biome.Plains)), false);
  const eco = sim.economy;
  eco.type[best * eco.slots] = 0;
  eco.state[best * eco.slots] = SlotState.Standing;
  sim.hasBuildings[best] = 1;
  const danger = w.danger[best];
  cast(sim, Ab.WildFire, best);
  assert.equal(sim.gacha.burning[best], 1);
  assert.ok(Math.abs(w.danger[best] - danger - 0.3) < 1e-6);
  assert.equal(canCast(sim, Ab.WildFire, best), false, 'burns already');
  const burnt = new Set<number>();
  for (let t = 0; t < 400 && sim.gacha.fireCount > 0; t++) {
    for (let i = 0; i < sim.gacha.fireCount; i++) burnt.add(sim.gacha.fireCell[i]);
    assert.ok(sim.gacha.fireCount <= 64);
    stepSimulation(sim);
  }
  assert.equal(sim.gacha.fireCount, 0);
  assert.ok(burnt.size >= 1 && burnt.size <= GACHA.fireMaxHexes, `${burnt.size} hexes`);
  for (const c of burnt) {
    assert.equal(w.biome[c], Biome.Plains);
    // Burnt to nothing; the wood regrows from then on (Requirement Dynamische Biome 5), not set by the god.
    assert.ok(w.resources[c * RESOURCE_COUNT + Resource.Wood] < 0.02);
    assert.equal(sim.biomes.pinned[c], 0);
    assert.equal(sim.gacha.burning[c], 0);
  }
  assert.equal(eco.state[best * eco.slots], SlotState.Ruin);
  assert.ok(Math.abs(w.danger[best] - 0.1 * (1.3 - w.terrainVariation[best] * 0.5)) < 1e-6, 'plains danger, the fire\'s taken off');
});

test('Biome Shift: one step wetter or drier along the chains; water, ice and mystic deposits stay', () => {
  assert.equal(shiftedBiome(Biome.Plains, SHIFT_WETTER), Biome.Forest);
  assert.equal(shiftedBiome(Biome.Plains, SHIFT_DRIER), Biome.Savanna);
  assert.equal(shiftedBiome(Biome.Desert, SHIFT_DRIER), -1);
  assert.equal(shiftedBiome(Biome.Desert, SHIFT_WETTER), Biome.Savanna);
  assert.equal(shiftedBiome(Biome.Swamp, SHIFT_WETTER), -1);
  assert.equal(shiftedBiome(Biome.Jungle, SHIFT_WETTER), Biome.Swamp);
  assert.equal(shiftedBiome(Biome.Tundra, SHIFT_WETTER), Biome.Plains);
  assert.equal(shiftedBiome(Biome.Mountains, SHIFT_DRIER), Biome.Hills);
  assert.equal(shiftedBiome(Biome.Hills, SHIFT_WETTER), Biome.Plains);
  assert.equal(shiftedBiome(Biome.Lake, SHIFT_WETTER), -1);
  assert.equal(shiftedBiome(Biome.Ice, SHIFT_WETTER), -1);

  const sim = aged();
  const w = sim.world;
  const eco = sim.economy;
  const c = firstCell(sim, (x) => w.biome[x] === Biome.Plains && w.deposit[x] === 0 && sim.cellPop[x] > 0);
  for (let k = 0; k < 6; k++) {
    eco.type[c * eco.slots + k] = 0;
    eco.state[c * eco.slots + k] = SlotState.Standing;
  }
  sim.hasBuildings[c] = 1;
  const people = sim.cellPop[c];
  cast(sim, Ab.BiomeShift, c, SHIFT_WETTER);
  assert.equal(w.biome[c], Biome.Forest);
  assert.equal(usableSlots(sim, c), 6, 'never below the slots in use');
  assert.equal(w.moveCost[c], 2);
  assert.equal(sim.cellPop[c], people);
  assert.equal(w.resourceCapacity[c * RESOURCE_COUNT + Resource.Wood] > 0.5, true);
  // A mystic deposit keeps its hex.
  const m = firstCell(sim, (x) => !isWaterBiome(w.biome[x]) && w.biome[x] !== Biome.Ice && shiftedBiome(w.biome[x], SHIFT_DRIER) >= 0);
  const was = w.biome[m];
  w.deposit[m] = Deposit.SacredGrove;
  for (const n of neighbors(sim, m)) if (shiftedBiome(w.biome[n], SHIFT_DRIER) >= 0) w.deposit[n] = Deposit.AncientRuins;
  assert.equal(canCast(sim, Ab.BiomeShift, m, SHIFT_DRIER), false);
  assert.equal(w.biome[m], was);
});

// ---------------------------------------------------------------------------
// Peoples

test('Fruitful Waters, Lean Years, Wanderlust, Golden Harvest: the god layer combined with the leader, ended after their years', () => {
  const sim = aged();
  const civ = startCiv(sim);
  const o = civ * LEVERS;
  // The leader's own levers with the faith's layer (Requirement Religion 4.4): what the god's multiply.
  const own = Float32Array.from(sim.leaders.own.subarray(o, o + LEVERS));
  const faithLev = sim.religion.lev.subarray(o, o + LEVERS);
  for (let k = 0; k < LEVERS; k++) own[k] *= faithLev[k];
  cast(sim, Ab.FruitfulWaters, civ);
  cast(sim, Ab.Wanderlust, civ);
  cast(sim, Ab.GoldenHarvest, civ);
  const lev = sim.leaders.lev;
  assert.ok(Math.abs(lev[o + L.birth] - own[L.birth] * 1.1) < 1e-6);
  assert.ok(Math.abs(lev[o + L.settleOver] - own[L.settleOver] * 0.95) < 1e-6);
  assert.ok(Math.abs(lev[o + L.travel] - own[L.travel] * 0.8) < 1e-6);
  assert.ok(Math.abs(lev[o + L.harvest] - own[L.harvest] * 1.15) < 1e-6);
  assert.ok(Math.abs(lev[o + L.load] - own[L.load] * 1.15) < 1e-6);
  assert.ok(Math.abs(lev[o + L.food] - 1.15 * own[L.food]) < 1e-6);
  cast(sim, Ab.LeanYears, civ);
  assert.ok(Math.abs(lev[o + L.birth] - own[L.birth] * 1.1 * 0.9) < 1e-6);
  const fx = peopleEffects(sim, civ).map((e) => `${e.name} ${e.yearsLeft}`).sort();
  assert.deepEqual(fx, ['Fruitful Waters 30', 'Golden Harvest 20', 'Lean Years 30', 'Wanderlust 15']);
  endEffectsNow(sim);
  for (const k of [L.birth, L.settleOver, L.travel, L.harvest, L.load]) assert.ok(Math.abs(lev[o + k] - own[k]) < 1e-6);
  assert.equal(peopleEffects(sim, civ).length, 0);
});

test('Golden Harvest: food of the people\'s hexes +15 %, shown as a supply term, back after its years', () => {
  const sim = aged();
  const civ = startCiv(sim);
  const c = firstCell(sim, (x) => sim.world.owner[x] === civ && sim.cellPop[x] > 0 && sim.cellSupply[x * 3] > 0);
  const food = sim.cellSupply[c * 3];
  cast(sim, Ab.GoldenHarvest, civ);
  assert.ok(Math.abs(sim.cellSupply[c * 3] - food * 1.15) < 1e-3);
  const terms = hexSupplyTerms(sim, c)[0];
  assert.ok(terms.some((t) => t.label === 'Golden Harvest +15 %'));
  assert.ok(Math.abs(sumTerms(terms) - sim.cellSupply[c * 3]) < 1e-3, 'terms explain the supply');
  endEffectsNow(sim);
  assert.equal(sim.leaders.lev[civ * LEVERS + L.food], 1);
  assert.ok(!hexSupplyTerms(sim, c)[0].some((t) => t.label.startsWith('Golden Harvest')));
});

test('Grateful Hearts and Restless Spirits: the satisfaction part "Divine"', () => {
  const sim = aged();
  const civ = startCiv(sim);
  const c = firstCell(sim, (x) => sim.world.owner[x] === civ && sim.cellPop[x] > 0);
  const before = satisfactionTarget(sim, c, sim.civs[civ]);
  cast(sim, Ab.GratefulHearts, civ);
  assert.equal(sim.gacha.divine[civ], 3);
  assert.deepEqual(satisfactionTerms(sim, c, sim.civs[civ]).find((t) => t.label === 'Divine')?.value, 3);
  assert.ok(Math.abs(satisfactionTarget(sim, c, sim.civs[civ]) - Math.min(100, before + 3)) < 1e-4);
  cast(sim, Ab.RestlessSpirits, civ);
  assert.equal(sim.gacha.divine[civ], 0);
  assert.equal(satisfactionTerms(sim, c, sim.civs[civ]).find((t) => t.label === 'Divine'), undefined);
});

test("Prophet's Light raises the faith in the player's religion at once and by devotion; Doubt lowers every religion's", () => {
  const sim = aged();
  const other = livingCivilizations(sim).find((c) => !c.worshipsPlayer)!;
  assert.ok(other, 'a people that does not worship the player');
  const pop = sim.pop;
  const of = (civ: number) => {
    const f: { faith: number; rel: number }[] = [];
    for (let i = 0; i < pop.end; i++) if (pop.alive[i] && pop.civ[i] === civ) f.push({ faith: pop.faith[i], rel: pop.religion[i] });
    return f;
  };
  // Some of its people hold the player's religion (religion 0), to see the light act on them only.
  let k = 0;
  for (let i = 0; i < pop.end; i++) if (pop.alive[i] && pop.civ[i] === other.id && k++ % 2 === 0) {
    pop.religion[i] = 0;
    pop.faith[i] = 0.45;
  }
  const before = of(other.id);
  const believers = before.filter((p) => p.rel === 0 && p.faith >= BELIEVER_FAITH).length;
  cast(sim, Ab.ProphetsLight, other.id);
  const after = of(other.id);
  after.forEach((p, i) => assert.ok(Math.abs(p.faith - (before[i].rel === 0 ? Math.min(1, before[i].faith + 0.15) : before[i].faith)) < 1e-6));
  assert.equal(other.faithYear.divineLight, after.filter((p) => p.rel === 0 && p.faith >= BELIEVER_FAITH).length - believers);
  assert.ok(Math.abs(sim.gacha.godLight[other.id] - 0.03) < 1e-7);
  // Doubt on the player's own people: every religion's faith down (Omen Readers half), a yearly loss for 10 years.
  const own = startCiv(sim);
  const ownBefore = sim.civs[own]!.faithYear.divineDoubt;
  const ob = of(own);
  cast(sim, Ab.Doubt, own);
  const oa = of(own);
  oa.forEach((p, i) => {
    if (ob[i].rel === 255) assert.equal(p.faith, ob[i].faith);
    else assert.ok(p.faith < ob[i].faith || ob[i].faith === 0);
  });
  assert.ok(Math.abs(sim.gacha.godDoubt[own] - 0.03) < 1e-7);
  assert.ok(sim.civs[own]!.faithYear.divineDoubt >= ownBefore);
});

test('worship: from 55 % believers on, until below 45 % (hysteresis); the start tribe worships from the start', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  const civ = sim.civs[startCiv(sim)]!;
  assert.ok(worships(sim, civ.id) && civ.worshipsPlayer);
  civ.population = 100;
  civ.believers = 50;
  updateWorship(sim);
  assert.ok(civ.worshipsPlayer, 'stays above 45 %');
  civ.believers = 44;
  updateWorship(sim);
  assert.ok(!civ.worshipsPlayer && !worships(sim, civ.id));
  civ.believers = 54;
  updateWorship(sim);
  assert.ok(!civ.worshipsPlayer, 'not yet');
  civ.believers = 55;
  updateWorship(sim);
  assert.ok(civ.worshipsPlayer);
});

// ---------------------------------------------------------------------------
// Leaders

/** A people with a leader of these attributes (natural slots), aged `age`, in office for 0 years. */
function leader(sim: Simulation, attrs: number[], age = 30): number {
  const civ = startCiv(sim);
  const s = sim.leaders;
  assert.equal(s.has[civ], 1);
  s.attr.fill(0, civ * ATTR_SLOTS, (civ + 1) * ATTR_SLOTS);
  attrs.forEach((a, i) => (s.attr[civ * ATTR_SLOTS + i] = a));
  s.age0[civ] = age;
  s.start[civ] = sim.tick;
  s.goal[civ] = Goal.Wealth;
  s.goalDone[civ] = 0;
  return civ;
}

test('Gift of Trait and Mark of Weakness: random traits beyond 3, exclusions hold, until no slot is left', () => {
  const sim = aged();
  const civ = leader(sim, [20, 6, 12]); // Beloved, Drillmaster, Merchant Prince
  for (let i = 0; i < ATTR_SLOTS - NATURAL_SLOTS; i++) cast(sim, Ab.GiftOfTrait, civ);
  const attrs = leaderAttrs(sim, civ);
  assert.equal(attrs.length, ATTR_SLOTS);
  assert.equal(new Set(attrs).size, attrs.length, 'no trait twice');
  assert.ok(!attrs.includes(21), 'Tyrant excluded by Beloved');
  assert.ok(!attrs.includes(8), 'Xenophobe excluded by Merchant Prince');
  assert.equal(canCast(sim, Ab.GiftOfTrait, civ), false, 'all slots used');
  assert.equal(sim.leaders.stats.exclusionBreaks, 0);
  // Mark of Weakness: only from the list.
  const sim2 = aged();
  const c2 = leader(sim2, [3]); // Cautious Strategist
  for (let i = 0; i < 4; i++) cast(sim2, Ab.MarkOfWeakness, c2);
  const got = leaderAttrs(sim2, c2).slice(1);
  assert.equal(got.length, 4);
  for (const a of got) assert.ok(WEAKENING.includes(a), ATTRS[a].name);
  // Craven, Weak Hand, Tyrant, Tax Hawk, Xenophobe, Stubborn: Weak Hand and Tyrant exclude each other, so at most 5.
  const c3 = leader(sim2, [20]); // Beloved excludes Tyrant
  let n = 0;
  while (canCast(sim2, Ab.MarkOfWeakness, c3) && n < 10) {
    cast(sim2, Ab.MarkOfWeakness, c3);
    n++;
  }
  assert.ok(!leaderAttrs(sim2, c3).includes(21));
});

test('Honed Mind: one trait acts 1.5 times as strongly (a factor ^1.5)', () => {
  const sim = aged();
  const civ = leader(sim, [6]); // Drillmaster: strength x1.25, pay x1.3
  cast(sim, Ab.HonedMind, civ);
  assert.equal(sim.leaders.honed[civ], 1);
  const o = civ * LEVERS;
  // The goal (Wealth) touches neither lever.
  assert.ok(Math.abs(sim.leaders.own[o + L.strength] - Math.pow(1.25, 1.5)) < 1e-5);
  const c2 = leader(sim, [20]); // Beloved: satisfaction +5 -> 7.5, within the cap of 8
  cast(sim, Ab.HonedMind, c2);
  assert.ok(Math.abs(sim.leaders.own[c2 * LEVERS + L.sat] - 7.5) < 1e-5);
});

test('Long Life and Brittle Crown shift the age of the death roll; Young Heir and Dynasty\'s Heir act on the next successor', () => {
  const saved = { ...LEADER };
  try {
    // Certain death from 55 on.
    LEADER.deathBase = 1;
    LEADER.deathMax = 1;
    const sim = aged();
    const civ = leader(sim, [3], 60);
    cast(sim, Ab.LongLife, civ); // rolled as 50: lives
    const counter = sim.leaders.counter[civ];
    const yearEnd = () => {
      for (let t = 0; t < TICKS_PER_YEAR; t++) stepSimulation(sim);
    };
    yearEnd();
    assert.equal(sim.leaders.counter[civ], counter, 'Long Life: still alive');
    const civ2 = leader(sim, [3, 15], 46); // Cautious Strategist, Builder
    cast(sim, Ab.BrittleCrown, civ2); // rolled as 56: dies
    cast(sim, Ab.YoungHeir, civ2);
    cast(sim, Ab.DynastysHeir, civ2);
    assert.deepEqual(leaderEffects(sim, civ2).map((e) => e.name), ['Young Heir', "Dynasty's Heir"]);
    assert.equal(canCast(sim, Ab.YoungHeir, civ2), false, 'flag set already');
    assert.equal(canCast(sim, Ab.DynastysHeir, civ2), false, 'flag set already');
    assert.ok(!validTargets(sim, Ab.YoungHeir).includes(civ2));
    LEADER.inherit = 0;
    const before = sim.leaders.counter[civ2];
    yearEnd();
    assert.equal(sim.leaders.counter[civ2], before + 1, 'Brittle Crown: died');
    assert.equal(sim.leaders.age0[civ2], 20, 'Young Heir');
    assert.ok([3, 15].includes(sim.leaders.attr[civ2 * ATTR_SLOTS]), "Dynasty's Heir inherits though LEADER.inherit is 0");
    assert.equal(sim.leaders.youngHeir[civ2], 0);
    assert.equal(sim.leaders.heirInherits[civ2], 0);
    assert.equal(sim.leaders.ageShift[civ2], 0, 'the shift ends with the leader');
    assert.ok(canCast(sim, Ab.YoungHeir, civ2) && canCast(sim, Ab.DynastysHeir, civ2), 'for the next successor again');
  } finally {
    Object.assign(LEADER, saved);
  }
});

test('Reroll Destiny: a new goal, not the old one, progress anew; not once the goal is reached', () => {
  const sim = aged();
  const civ = leader(sim, [3]);
  sim.leaders.goal[civ] = Goal.Expansion;
  sim.leaders.safeYears[civ] = 3;
  cast(sim, Ab.RerollDestiny, civ);
  assert.notEqual(sim.leaders.goal[civ], Goal.Expansion);
  assert.notEqual(sim.leaders.goal[civ], 0);
  assert.equal(sim.leaders.safeYears[civ], 0);
  sim.leaders.goalDone[civ] = 1;
  assert.equal(canCast(sim, Ab.RerollDestiny, civ), false);
  assert.ok(sim.chronicle.some((e) => e.text.includes('by the god')));
});

test('leader abilities need a leader; casts go into the chronicle as silent entries', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  const civ = startCiv(sim);
  assert.equal(sim.leaders.has[civ], 0, 'the first leader comes at the first year\'s end');
  for (const a of [Ab.GiftOfTrait, Ab.MarkOfWeakness, Ab.LongLife, Ab.BrittleCrown, Ab.RerollDestiny, Ab.YoungHeir, Ab.HonedMind, Ab.DynastysHeir]) {
    assert.equal(canCast(sim, a, civ), false, ABILITIES[a].name);
  }
  cast(sim, Ab.GratefulHearts, civ);
  const last = sim.chronicle[sim.chronicle.length - 1];
  assert.equal(last.text, `You cast Grateful Hearts on the ${sim.civs[civ]!.name}.`);
  assert.equal(last.important, false);
});

test('god effects of a people end when its id is reused', () => {
  const sim = aged();
  const civ = startCiv(sim);
  cast(sim, Ab.FruitfulWaters, civ);
  cast(sim, Ab.GratefulHearts, civ);
  // What foundCivilization does for a reused id.
  sim.civs[civ] = null;
  resetGodCiv(sim, civ);
  assert.equal(sim.gacha.divine[civ], 0);
  assert.equal(sim.gacha.godLev[civ * LEVERS + L.birth], 1);
  assert.equal(peopleEffects(sim, civ).length, 0);
});

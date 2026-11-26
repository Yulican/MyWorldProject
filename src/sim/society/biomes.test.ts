import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRECTION_COUNT } from '../hex';
import { BIOMES, Biome, RESOURCE_COUNT, Resource } from '../world/biomes';
import { landBiome } from '../world/classify';
import { generateWorld } from '../world/generate';
import { BUILDINGS, SlotState } from './buildings';
import { BIOME_RULE, BiomeCause, advanceBiomes, biomeStep, checkBiomesFast, climateDrift, hexBiome, setBiomeObserver } from './biomes';
import { Ab, SHIFT_DRIER, blessedCell, castAbility, setBiome } from './gacha';
import { TICKS_PER_YEAR, createSimulation, stepSimulation, type Simulation } from './simulation';

// Dynamic biomes and regrowing resources ("Design Documents/Requirement Dynamische Biome.md").

const typeOf = (name: string) => BUILDINGS.findIndex((b) => b.name === name);
const isStill = (b: number) => b === Biome.Lake || b === Biome.ShallowSea || b === Biome.DeepOcean;
const isLand = (sim: Simulation, c: number) => sim.world.elevation[c] >= 0 && !isStill(sim.world.biome[c]);
const neighbors = (sim: Simulation, c: number) => {
  const out: number[] = [];
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = sim.world.neighbors[c * DIRECTION_COUNT + d];
    if (nb >= 0) out.push(nb);
  }
  return out;
};

/** Only the biome checks of `years` years (the rest of the simulation stands still). */
function checkYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR; t++) {
    advanceBiomes(sim);
    sim.tick++;
  }
}

function cast(sim: Simulation, ability: number, target: number, option = 0): void {
  sim.gacha.charges[ability]++;
  assert.ok(castAbility(sim, ability, target, option));
}

test('the chains: one step at a time, Mountains, Ice and water stay', () => {
  assert.equal(biomeStep(Biome.Desert, Biome.Forest), Biome.Savanna);
  assert.equal(biomeStep(Biome.Swamp, Biome.Plains), Biome.Jungle);
  assert.equal(biomeStep(Biome.Tundra, Biome.Forest), Biome.Plains);
  assert.equal(biomeStep(Biome.Hills, Biome.Desert), Biome.Plains);
  assert.equal(biomeStep(Biome.Plains, Biome.Mountains), -1);
  assert.equal(biomeStep(Biome.Ice, Biome.Tundra), -1);
  assert.equal(biomeStep(Biome.Plains, Biome.Plains), -1);
});

test('climate drift: within ±0.2, oscillates over centuries, derived from the seed alone', () => {
  const a = generateWorld({ seed: 3 });
  const b = generateWorld({ seed: 3 });
  let most = 0;
  let positive = 0;
  let negative = 0;
  let sum = 0;
  let n = 0;
  for (let year = 0; year <= 1200; year += 10) {
    for (let c = 0; c < a.cellCount; c += 7) {
      const d = climateDrift(a, c, year * TICKS_PER_YEAR);
      assert.equal(d, climateDrift(b, c, year * TICKS_PER_YEAR), 'the same for the same seed');
      most = Math.max(most, Math.abs(d));
      if (d > 0.02) positive++;
      if (d < -0.02) negative++;
      sum += d;
      n++;
    }
  }
  assert.ok(most <= BIOME_RULE.driftAmp + 1e-9, `drift ${most}`);
  assert.ok(most > 0.05, 'it drifts');
  assert.ok(positive > n / 10 && negative > n / 10, `${positive} wetter, ${negative} drier of ${n}`);
  assert.ok(Math.abs(sum / n) < 0.05, `mean ${sum / n}: no runaway`);
  // One hex swings both ways within 400 years.
  const c = a.startCell;
  let lo = Infinity;
  let hi = -Infinity;
  for (let year = 0; year <= 400; year++) {
    const d = climateDrift(a, c, year * TICKS_PER_YEAR);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  assert.ok(hi - lo > 0.05, `range ${lo}..${hi}`);
});

test('dynamic biomes are deterministic per seed and change about 0.2 % of the land a year', () => {
  const run = () => {
    const sim = createSimulation(generateWorld({ seed: 6 }));
    for (let t = 0; t < 150 * TICKS_PER_YEAR; t++) stepSimulation(sim);
    return sim;
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.world.biome, b.world.biome);
  assert.deepEqual(a.world.resources, b.world.resources);
  assert.deepEqual(a.biomes.trend, b.biomes.trend);
  assert.equal(a.biomes.changes, b.biomes.changes);
  let land = 0;
  for (let c = 0; c < a.world.cellCount; c++) if (isLand(a, c)) land++;
  const perYear = (100 * a.biomes.changes) / 150 / land;
  assert.ok(perYear > 0.05 && perYear < 0.6, `${perYear.toFixed(2)} % a year`);
});

test('every land hex is checked once in 5 years, a 52nd of a year\'s share per tick; resources regrow 2 % of the gap a year', () => {
  const sim = createSimulation(generateWorld({ seed: 2 }));
  const w = sim.world;
  BIOME_RULE.enabled = 0;
  try {
    w.resources.fill(0);
    const year = Math.floor(sim.tick / TICKS_PER_YEAR);
    checkYears(sim, 1);
    const f = 1 - Math.pow(0.98, 5);
    for (let c = 0; c < w.cellCount; c++) {
      if (!isLand(sim, c)) continue;
      const checked = c % 5 === year % 5;
      for (let r = 0; r < RESOURCE_COUNT; r++) {
        const k = c * RESOURCE_COUNT + r;
        const renewable = r <= Resource.Wood;
        const expect = checked && renewable && w.resourceCapacity[k] > 1e-4 ? w.resourceCapacity[k] * f : 0;
        assert.ok(Math.abs(w.resources[k] - expect) < 1e-5, `hex ${c} resource ${r}: ${w.resources[k]} vs ${expect}`);
      }
    }
    // Five years: every land hex once; stone and ore never come back.
    checkYears(sim, 4);
    for (let c = 0; c < w.cellCount; c++) {
      if (!isLand(sim, c)) continue;
      const k = c * RESOURCE_COUNT;
      if (w.resourceCapacity[k + Resource.Wood] > 1e-4) assert.ok(w.resources[k + Resource.Wood] > 0, `wood of ${c}`);
      assert.equal(w.resources[k + Resource.Stone], 0);
      assert.equal(w.resources[k + Resource.Ore], 0);
    }
    // A stock above its capacity falls at the same rate.
    const c = w.startCell;
    const k = c * RESOURCE_COUNT + Resource.Game;
    w.resources[k] = w.resourceCapacity[k] + 0.3;
    checkYears(sim, 5);
    assert.ok(Math.abs(w.resources[k] - (w.resourceCapacity[k] + 0.3 * (1 - f))) < 1e-5);
  } finally {
    BIOME_RULE.enabled = 1;
  }
});

test('the accelerated check of the benchmark covers every land hex in 5 ticks', () => {
  const sim = createSimulation(generateWorld({ seed: 2 }));
  const w = sim.world;
  BIOME_RULE.enabled = 0;
  try {
    for (let c = 0; c < w.cellCount; c++) w.resources[c * RESOURCE_COUNT + Resource.Wood] = 0;
    for (let t = 0; t < 5; t++) {
      // In 3 slices, as the benchmark may spread a tick's share over frames.
      for (let k = 0; k < 3; k++) checkBiomesFast(sim, 5, k, 3);
      sim.tick++;
    }
    for (let c = 0; c < w.cellCount; c++) {
      if (isLand(sim, c) && w.resourceCapacity[c * RESOURCE_COUNT + Resource.Wood] > 1e-4) assert.ok(w.resources[c * RESOURCE_COUNT + Resource.Wood] > 0, `hex ${c}`);
    }
  } finally {
    BIOME_RULE.enabled = 1;
  }
});

test('Biome Shift pins its hexes: natural changes skip them for good, their resources still regrow', () => {
  const sim = createSimulation(generateWorld({ seed: 4 }));
  const w = sim.world;
  // A plains hex whose drier neighbor biome is not its climax: without the pin it would return.
  const c = w.startCell;
  assert.equal(w.biome[c] === Biome.Plains || w.biome[c] === Biome.Forest || w.biome[c] === Biome.Savanna, true, BIOMES[w.biome[c]].name);
  cast(sim, Ab.BiomeShift, c, SHIFT_DRIER);
  const area = [c, ...neighbors(sim, c)].filter((x) => sim.biomes.pinned[x] === 1);
  assert.ok(area.length >= 1);
  const set = area.map((x) => w.biome[x]);
  for (const x of area) {
    assert.deepEqual(hexBiome(sim, x), { biome: w.biome[x], becoming: -1, pinned: true });
    w.resources[x * RESOURCE_COUNT + Resource.Fertility] = 0;
  }
  checkYears(sim, 300);
  area.forEach((x, i) => {
    assert.equal(w.biome[x], set[i], 'stays as the god set it');
    assert.ok(w.resources[x * RESOURCE_COUNT + Resource.Fertility] > 0.9 * w.resourceCapacity[x * RESOURCE_COUNT + Resource.Fertility], 'regrows');
    assert.equal(sim.biomes.trend[x], 0);
  });
  // Pinned hexes count as neighbors: the unpinned ones around them did change meanwhile somewhere.
  assert.ok(sim.biomes.changes > 0);
});

/** A land hex without people whose climax is `climax` well inside its moisture band for all drift (no settlement, no water). */
function wildHex(sim: Simulation, climax: number, margin = 0.25): number {
  const w = sim.world;
  for (let c = 0; c < w.cellCount; c++) {
    if (!isLand(sim, c) || sim.cellPop[c] > 0 || w.deposit[c] !== 0 || w.riverFlow[c] > 0) continue;
    const e = w.elevation[c];
    const t = w.temperature[c];
    const m = w.moisture[c];
    if (landBiome(e, t, m) !== climax || landBiome(e, t, m - margin) !== climax || landBiome(e, t, m + margin) !== climax) continue;
    if (neighbors(sim, c).some((n) => isStill(w.biome[n]) || w.riverFlow[n] > 0)) continue;
    return c;
  }
  assert.fail(`no wild hex with climax ${BIOMES[climax].name}`);
}

test('burnt plains return to their forest climax; the panel shows "Becoming Forest" meanwhile', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  const w = sim.world;
  const c = wildHex(sim, Biome.Forest);
  setBiome(sim, c, Biome.Plains);
  w.resources[c * RESOURCE_COUNT + Resource.Wood] = 0;
  checkYears(sim, 5);
  assert.equal(sim.biomes.climax[c], Biome.Forest);
  let years = 5;
  while (w.biome[c] === Biome.Plains && years < 300) {
    assert.equal(hexBiome(sim, c).becoming, Biome.Forest);
    checkYears(sim, 5);
    years += 5;
  }
  assert.equal(w.biome[c], Biome.Forest, `back after ${years} years`);
  assert.equal(sim.biomes.pinned[c], 0);
  assert.equal(hexBiome(sim, c).becoming, -1);
  assert.equal(w.resourceCapacity[c * RESOURCE_COUNT + Resource.Wood] > 0.5, true, 'forest capacity');
});

test('Drought moves the climax drier while it lasts; quiet chronicle entries when it falls on a settlement', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  const w = sim.world;
  const c = w.startCell;
  const dry = Float32Array.from(w.moisture);
  const before = sim.chronicle.length;
  cast(sim, Ab.Drought, c);
  assert.ok(sim.chronicle.slice(before).some((e) => e.text.startsWith('A drought parches the land of the') && !e.important));
  // One accelerated pass checks every hex: the climax follows moisture with the Drought's -0.25, plus drift.
  let shifted = 0;
  for (let t = 0; t < 5; t++) {
    checkBiomesFast(sim);
    for (let x = sim.tick % 5; x < w.cellCount; x += 5) {
      if (!isLand(sim, x) || w.moisture[x] === dry[x]) continue;
      const drift = climateDrift(w, x, sim.tick);
      assert.equal(sim.biomes.climax[x], landBiome(w.elevation[x], w.temperature[x], w.moisture[x] + drift));
      if (sim.biomes.climax[x] !== landBiome(w.elevation[x], w.temperature[x], dry[x] + drift)) shifted++;
    }
    sim.tick++;
  }
  assert.ok(shifted > 0, 'the drought moved some climax');
  for (let t = 0; t < 21 * TICKS_PER_YEAR; t++) stepSimulation(sim);
  assert.ok(sim.chronicle.some((e) => e.text.startsWith('The drought ends over the land of the') && !e.important));
});

test('Fertile Blessing marks its hexes for the faster return towards green', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  const c = sim.world.startCell;
  assert.equal(blessedCell(sim, c), false);
  cast(sim, Ab.FertileBlessing, c);
  assert.equal(blessedCell(sim, c), true);
  for (const n of neighbors(sim, c)) if (isLand(sim, n)) assert.equal(blessedCell(sim, n), true);
  const far = (c + Math.floor(sim.world.width / 2)) % sim.world.cellCount;
  assert.equal(blessedCell(sim, far), false);
});

test('a biome change ruins only the biome-bound buildings, with a quiet chronicle entry', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  const w = sim.world;
  const eco = sim.economy;
  const c = wildHex(sim, Biome.Plains, 0.1);
  setBiome(sim, c, Biome.Forest);
  const camp = c * eco.slots;
  eco.type[camp] = typeOf('Lumber camp');
  eco.state[camp] = SlotState.Standing;
  eco.type[camp + 1] = typeOf('Fields');
  eco.state[camp + 1] = SlotState.Standing;
  sim.hasBuildings[c] = 1;
  const before = sim.chronicle.length;
  let years = 0;
  while (w.biome[c] === Biome.Forest && years < 400) {
    checkYears(sim, 5);
    years += 5;
  }
  assert.equal(w.biome[c], Biome.Plains, `changed after ${years} years`);
  assert.equal(eco.state[camp], SlotState.Ruin);
  assert.equal(eco.state[camp + 1], SlotState.Standing);
  const entry = sim.chronicle.slice(before).find((e) => e.cell === c);
  assert.ok(entry && entry.text.includes('turned to plains') && entry.text.includes('lumber camp') && !entry.important, entry?.text ?? 'no entry');
});

test('no Desert next to sea or lake, except where the world made it', () => {
  const sim = createSimulation(generateWorld({ seed: 8 }));
  for (let t = 0; t < 200 * TICKS_PER_YEAR; t++) stepSimulation(sim);
  const w = sim.world;
  for (let c = 0; c < w.cellCount; c++) {
    if (w.biome[c] !== Biome.Desert || sim.biomes.desertBorn[c]) continue;
    assert.ok(!neighbors(sim, c).some((n) => isStill(w.biome[n])), `desert ${c} by the water`);
  }
});

test('overgrazing: fertility under 20 % of its capacity for 10 years on used land makes it one step drier', () => {
  const sim = createSimulation(generateWorld({ seed: 5 }));
  const w = sim.world;
  const c = wildHex(sim, Biome.Plains, 0.1);
  w.owner[c] = 1;
  const seen: number[] = [];
  setBiomeObserver((_s, cell, _from, to, cause) => {
    if (cell === c && cause === BiomeCause.Overgrazing) seen.push(to);
  });
  try {
    for (let year = 0; year < 15 && seen.length === 0; year++) {
      w.resources[c * RESOURCE_COUNT + Resource.Fertility] = 0;
      checkYears(sim, 1);
    }
  } finally {
    setBiomeObserver(null);
  }
  assert.deepEqual(seen, [Biome.Savanna]);
  assert.equal(sim.biomes.grazeYears[c], 0, 'counter reset');
});

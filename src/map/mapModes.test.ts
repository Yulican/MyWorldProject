import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulation, generateWorld, stepSimulation, TICKS_PER_YEAR } from '../sim';
import { MODE_SWITCH_EVERY, modeCycle, modeForSwipe } from '../bench/modeCycle';
import { BENCHMARK, DIRECTIONS } from '../bench/benchmark';
import {
  FERTILITY_EDGES,
  GLYPHS,
  MARK_LABEL,
  MARK_REBEL,
  MODES,
  MapModeId,
  POLITICAL,
  POPULATION_EDGES,
  SATISFACTION_EDGES,
  SUPPLY_EDGES,
  allModes,
  bucketOf,
  createModeData,
  fillModeData,
  labelText,
  modeColors,
  modeKey,
  modeLegend,
  modeSignature,
  parseModeKey,
} from './mapModes';

test('values fall into buckets by their lower edges', () => {
  assert.equal(bucketOf(-100, SATISFACTION_EDGES), 0);
  assert.equal(bucketOf(-20, SATISFACTION_EDGES), 1);
  assert.equal(bucketOf(-0.5, SATISFACTION_EDGES), 3, 'just below 0 is red');
  assert.equal(bucketOf(0, SATISFACTION_EDGES), 4, '0 starts the green side');
  assert.equal(bucketOf(100, SATISFACTION_EDGES), SATISFACTION_EDGES.length);
  assert.equal(bucketOf(9, POPULATION_EDGES), 0);
  assert.equal(bucketOf(150, POPULATION_EDGES), POPULATION_EDGES.length);
  assert.equal(bucketOf(119, SUPPLY_EDGES), SUPPLY_EDGES.length - 1);
  assert.equal(bucketOf(120, SUPPLY_EDGES), SUPPLY_EDGES.length, 'dark red from 120 %');
});

test('every mode has one color per bucket, 8 to 12 buckets', () => {
  for (const mode of allModes()) {
    if (mode.id === MapModeId.Political || mode.id === MapModeId.Deposits) continue;
    const colors = modeColors(mode);
    const edges =
      mode.id === MapModeId.Satisfaction
        ? SATISFACTION_EDGES
        : mode.id === MapModeId.Population
          ? POPULATION_EDGES
          : mode.id === MapModeId.Supply
            ? SUPPLY_EDGES
            : FERTILITY_EDGES[mode.sub];
    assert.equal(colors.length, edges.length + 1, modeKey(mode));
    assert.ok(colors.length >= 8 && colors.length <= 12, modeKey(mode));
    assert.equal(modeLegend(mode)!.entries.length, colors.length);
  }
  assert.equal(modeLegend(POLITICAL), null, 'no legend bar in Political');
  assert.equal(modeLegend({ id: MapModeId.Deposits, sub: 0 })!.entries.length, 4);
});

test('mode keys round trip; missing or unknown keys give Political', () => {
  for (const mode of allModes()) assert.deepEqual(parseModeKey(modeKey(mode)), mode);
  assert.equal(modeKey({ id: MapModeId.Supply, sub: 1 }), 'supply.water');
  assert.deepEqual(parseModeKey(undefined), POLITICAL);
  assert.deepEqual(parseModeKey(42), POLITICAL);
  assert.deepEqual(parseModeKey('weather'), POLITICAL);
  assert.deepEqual(parseModeKey('supply.mana'), POLITICAL);
  assert.deepEqual(parseModeKey('population.food'), POLITICAL);
});

test('labels have at most 4 characters and glyphs for each of them', () => {
  for (const v of [-100, -5, 0, 7, 120, 999, 1000, 1499, 25_000, 999_999]) {
    const text = labelText(v);
    assert.ok(text.length <= 4, `${v} → ${text}`);
    for (const ch of text) assert.ok(GLYPHS[ch], ch);
  }
  assert.equal(labelText(1499), '1k');
});

test('the buffer holds buckets, numbers and rebel marks of the settlements', () => {
  const sim = createSimulation(generateWorld({ seed: 7 }));
  for (let t = 0; t < 60 * TICKS_PER_YEAR && !sim.gameOver; t++) stepSimulation(sim);
  const data = createModeData();
  data.id = MapModeId.Satisfaction;
  assert.ok(fillModeData(sim, data));
  assert.equal(fillModeData(sim, data), false, 'nothing changed');
  let settled = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (sim.cellPop[c] === 0) {
      assert.equal(data.bucket[c], 0, 'no fill without people');
      assert.equal(data.mark[c], 0);
      continue;
    }
    settled++;
    assert.equal(data.label[c], Math.round(sim.satisfaction[c]));
    assert.equal(data.bucket[c], bucketOf(sim.satisfaction[c], SATISFACTION_EDGES) + 1);
    const owner = sim.world.owner[c];
    assert.equal((data.mark[c] & MARK_REBEL) !== 0, sim.satisfaction[c] < 0 && sim.civs[owner]?.capital !== c);
  }
  assert.ok(settled > 0);

  data.id = MapModeId.Fertility;
  data.sub = 2;
  assert.ok(fillModeData(sim, data));
  let free = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    assert.equal(data.mark[c] & MARK_LABEL, 0, 'no numbers for fertility');
    if (sim.cellPop[c] === 0 && data.bucket[c] > 0) free++;
  }
  assert.ok(free > 0, 'fertility colors free land too');
});

test('the tile signature follows the mode and its values, Political adds nothing', () => {
  const sim = createSimulation(generateWorld({ seed: 3 }));
  const cells = new Int32Array(sim.world.cellCount).map((_, i) => i);
  const data = createModeData();
  fillModeData(sim, data);
  const base = 0x811c9dc5;
  assert.equal(modeSignature(base, data, cells), base);
  data.id = MapModeId.Population;
  fillModeData(sim, data);
  const pop = modeSignature(base, data, cells);
  assert.notEqual(pop, base);
  data.id = MapModeId.Supply;
  fillModeData(sim, data);
  const food = modeSignature(base, data, cells);
  assert.notEqual(food, pop);
  data.sub = 2;
  fillModeData(sim, data);
  assert.notEqual(modeSignature(base, data, cells), food, 'sub-mode');
  const before = modeSignature(base, data, cells);
  const c = data.mark.findIndex((m) => (m & MARK_LABEL) !== 0);
  assert.ok(c >= 0);
  data.label[c] += 1;
  assert.notEqual(modeSignature(base, data, cells), before, 'a shown number changed');
});

test('the modes scenario goes through every mode and sub-mode, Political last', () => {
  const cycle = modeCycle();
  assert.equal(cycle.length, allModes().length);
  assert.deepEqual(cycle[cycle.length - 1], POLITICAL);
  const swipes = DIRECTIONS.length * BENCHMARK.swipesPerDirection;
  const seen = new Set<string>();
  for (let i = 0; i < swipes; i++) seen.add(modeKey(modeForSwipe(i)));
  assert.equal(seen.size, cycle.length, 'all modes within one world');
  assert.deepEqual(modeForSwipe(MODE_SWITCH_EVERY - 1), modeForSwipe(0));
  assert.equal(MODES[modeForSwipe(0).id].key, 'satisfaction');
});

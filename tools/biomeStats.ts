// Dynamic biomes and regrowing resources (see "Design Documents/Requirement Dynamische Biome.md"): statistics
// of the core rule (src/sim/society/biomes.ts) over many worlds. The numbers are BIOME_RULE's, set by key=value.
// Usage: npx tsx tools/biomeStats.ts [worlds=12] [years=100,300,500] [key=value ...]
//   biomes=0|1   natural/civilization biome transitions (default 1)
//   regrow=0|1   resources regrow to capacity (default 1); biomes=0 regrow=0 is the frozen land (baseline)
//   any BIOME_RULE name, e.g. pReturn=0.25 pNeighbor=0.08 established=0.15 margin=0.02 wetFactor=2 ruinFactor=3
//   settleFactor=0.5 regrowRate=0.02 checkEvery=5 driftAmp=0.2 driftPeriod=300 driftSpread=100 driftBlobs=6 driftRadius=10
// Agreed figures (Requirement section 11, 36 worlds): ~0.22 % of the land changes a year, ~3.7 % reversals
// within 50 years, a state lasts ~66 years, ~62 % of the changes at fronts, Desert ~11 %.
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation, type Simulation } from '../src/sim';
import { Biome, BIOMES, BIOME_COUNT, Resource, RESOURCE_COUNT } from '../src/sim/world/biomes';
import { landBiome } from '../src/sim/world/classify';
import { BIOME_RULE, BiomeCause, climateDrift, isChangingBiome, setBiomeObserver } from '../src/sim/society/biomes';
import { SlotState } from '../src/sim/society/buildings';
import { DIRECTION_COUNT } from '../src/sim/hex';

const worlds = Number(process.argv[2] ?? 12);
const checkpoints = (process.argv[3] ?? '100,300,500').split(',').map(Number);
const options = Object.fromEntries(process.argv.slice(4).map((a) => a.split('=') as [string, string]));
for (const [k, v] of Object.entries(options)) {
  const key = k === 'biomes' ? 'enabled' : k;
  if (key in BIOME_RULE) (BIOME_RULE as Record<string, number>)[key] = Number(v);
  else console.warn(`unknown parameter ${k}`);
}

const isStillWater = (b: number) => b === Biome.Lake || b === Biome.ShallowSea || b === Biome.DeepOcean;

type Counters = { life: number; lifeN: number; short: number; front: number; changes: number; ret: number; press: number; graze: number; settled: number; reversals: number };

/** Per-world bookkeeping of the changes (the observer fills it). */
type Hook = {
  initial: Uint8Array;
  prev: Int16Array;
  prevAt: Int32Array;
  lastAt: Int32Array;
  moves: Uint16Array;
  count: Counters;
};

let h: Hook;
setBiomeObserver((sim: Simulation, c: number, from: number, to: number, cause: number) => {
  const k = h.count;
  k.changes++;
  if (h.lastAt[c] > -1e8) {
    const yrs = (sim.tick - h.lastAt[c]) / TICKS_PER_YEAR;
    k.life += yrs;
    k.lifeN++;
    if (yrs < 50) k.short++;
  }
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = sim.world.neighbors[c * DIRECTION_COUNT + d];
    if (nb >= 0 && nb !== c && sim.world.biome[nb] === to) {
      k.front++;
      break;
    }
  }
  if (cause === BiomeCause.Return) k.ret++;
  else if (cause === BiomeCause.Pressure) k.press++;
  else k.graze++;
  if (sim.cellPop[c] > 0) k.settled++;
  if (h.prev[c] === to && sim.tick - h.prevAt[c] < 50 * TICKS_PER_YEAR) k.reversals++;
  h.prev[c] = from;
  h.prevAt[c] = sim.tick;
  h.lastAt[c] = sim.tick;
  h.moves[c]++;
});

// ---- statistics ----
type Row = Record<string, number>;
const rows = new Map<number, Row[]>();
const LAND_BIOMES = [Biome.Tundra, Biome.Plains, Biome.Forest, Biome.Hills, Biome.Desert, Biome.Savanna, Biome.Jungle, Biome.Swamp, Biome.Mountains, Biome.Ice];

for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  const w = sim.world;
  const land: number[] = [];
  for (let c = 0; c < w.cellCount; c++) if (w.elevation[c] >= 0 && !isStillWater(w.biome[c])) land.push(c);
  h = {
    initial: Uint8Array.from(w.biome),
    prev: new Int16Array(w.cellCount).fill(-1),
    prevAt: new Int32Array(w.cellCount),
    lastAt: new Int32Array(w.cellCount).fill(-1e9),
    moves: new Uint16Array(w.cellCount),
    count: { life: 0, lifeN: 0, short: 0, front: 0, changes: 0, ret: 0, press: 0, graze: 0, settled: 0, reversals: 0 },
  };
  const share0 = new Float64Array(BIOME_COUNT);
  for (const c of land) share0[w.biome[c]] += 1 / land.length;
  let lastChanges = 0;
  let lastYear = 0;
  for (const year of checkpoints) {
    while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) {
      stepSimulation(sim);
    }
    // economy
    let settlements = 0;
    let towns = 0;
    let cities = 0;
    let crowded = 0;
    let ruins = 0;
    let standing = 0;
    let wood = 0;
    for (let c = 0; c < w.cellCount; c++) {
      const pop = sim.cellPop[c];
      if (pop > 0) {
        settlements++;
        if (pop > sim.cellCapacity[c]) crowded++;
        wood += sim.economy.stock[c * 2];
      }
      if (pop >= 50) towns++;
      if (pop >= 150) cities++;
      for (let s = c * sim.economy.slots; s < (c + 1) * sim.economy.slots; s++) {
        if (sim.economy.state[s] === SlotState.Standing) standing++;
        if (sim.economy.state[s] === SlotState.Ruin) ruins++;
      }
    }
    const text = (s: string) => sim.chronicle.filter((e) => e.text.includes(s)).length;
    let merchants = 0;
    for (const v of sim.trade.merchants) merchants += v;
    let abroad = 0;
    for (const v of sim.trade.abroad) abroad += v;
    // biome statistics
    const share = new Float64Array(BIOME_COUNT);
    let off = 0;
    let moved = 0;
    let moved3 = 0;
    let gap = 0;
    let gapN = 0;
    for (const c of land) {
      share[w.biome[c]] += 1 / land.length;
      if (w.biome[c] !== landBiome(w.elevation[c], w.temperature[c], w.moisture[c] + climateDrift(w, c, sim.tick)) && isChangingBiome(w.biome[c])) off++;
      if (w.biome[c] !== h.initial[c]) moved++;
      if (h.moves[c] >= 3) moved3++;
      for (const r of [Resource.Fertility, Resource.Game, Resource.Wood]) {
        gap += Math.abs(w.resourceCapacity[c * RESOURCE_COUNT + r] - w.resources[c * RESOURCE_COUNT + r]);
        gapN++;
      }
    }
    let tv = 0;
    for (let b = 0; b < BIOME_COUNT; b++) tv += Math.abs(share[b] - share0[b]) / 2;
    const years = year - lastYear;
    const row: Row = {
      people: sim.pop.count,
      peoples: sim.civs.filter(Boolean).length,
      settlements,
      'towns (50+)': towns,
      'cities (150+)': cities,
      'crowded %': (100 * crowded) / Math.max(1, settlements),
      buildings: standing,
      ruins,
      'wood stock/settl': wood / Math.max(1, settlements),
      allTraded: sim.trade.delivered.reduce((s, v) => s + v, 0),
      deliveredAbroad: abroad,
      merchants,
      agreements: sim.diplomacy.agreements.length,
      wars: text('declared war'),
      uprisings: text('rose up'),
      'changes with ruins': text('lies in ruins'),
      'changes %/yr (period)': (100 * (h.count.changes - lastChanges)) / years / land.length,
      'changes total': h.count.changes,
      '  return %': (100 * h.count.ret) / Math.max(1, h.count.changes),
      '  pressure %': (100 * h.count.press) / Math.max(1, h.count.changes),
      '  overgrazing %': (100 * h.count.graze) / Math.max(1, h.count.changes),
      '  at settlement %': (100 * h.count.settled) / Math.max(1, h.count.changes),
      'mean state life (y)': h.count.life / Math.max(1, h.count.lifeN),
      'states ended <50y %': (100 * h.count.short) / Math.max(1, h.count.lifeN),
      'changes with neighbor already %': (100 * h.count.front) / Math.max(1, h.count.changes),
      'reversals % (<50y)': (100 * h.count.reversals) / Math.max(1, h.count.changes),
      'hexes changed 3+ times %': (100 * moved3) / land.length,
      'off-climax %': (100 * off) / land.length,
      'differs from J0 %': (100 * moved) / land.length,
      'share drift TV %': 100 * tv,
      'resource gap (mean abs)': gap / Math.max(1, gapN),
    };
    for (const b of LAND_BIOMES) row[`share ${BIOMES[b].name} %`] = 100 * share[b];
    lastChanges = h.count.changes;
    lastYear = year;
    if (!rows.has(year)) rows.set(year, []);
    rows.get(year)!.push(row);
  }
}

console.log(`${worlds} worlds`, JSON.stringify(BIOME_RULE));
for (const [year, list] of rows) {
  console.log(`\nYear ${year}: mean [min..max]`);
  for (const k of Object.keys(list[0])) {
    const mean = list.reduce((s, r) => s + r[k], 0) / list.length;
    const lo = Math.min(...list.map((r) => r[k]));
    const hi = Math.max(...list.map((r) => r[k]));
    console.log(`  ${k.padEnd(28)} ${mean.toFixed(2).padStart(10)}  [${lo.toFixed(1)}..${hi.toFixed(1)}]`);
  }
}

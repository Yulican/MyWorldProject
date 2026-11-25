// Dynamic biomes and regrowing resources (see "Design Documents/Requirement Dynamische Biome.md").
// PROTOTYPE of the rule as a per-tick hook around the unchanged core (the later core version lives in
// society/biomes.ts); everything is a named parameter in PARAMS, set by key=value.
// Usage: npx tsx tools/biomeStats.ts [worlds=12] [years=100,300,500] [key=value ...]
//   biomes=0|1   natural/civilization biome transitions (default 1)
//   regrow=0|1   resources regrow to capacity (default 1); biomes=0 regrow=0 is the current state (baseline)
//   any PARAMS name, e.g. pReturn=0.04 pNeighbor=0.01 wetFactor=2 pDefor=0.03 ruinFactor=3 settleFactor=0.5
//   hold=10 (years without return/neighbor change after a change) desertOwn=1 (Desert next to water allowed where generated)
//   regrowRate=0.02 checkEvery=10 (rotation: 1/checkEvery of the land hexes per year)
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation, type Simulation } from '../src/sim';
import { Biome, BIOMES, BIOME_COUNT, Resource, RESOURCE_COUNT } from '../src/sim/world/biomes';
import { landBiome } from '../src/sim/world/classify';
import { createRng, deriveSeed } from '../src/sim/rng';
import { setBiome } from '../src/sim/society/gacha';
import { updateCellSupply } from '../src/sim/society/economy';
import { updateTradeBuildings } from '../src/sim/society/trade';
import { BUILDINGS, SlotState } from '../src/sim/society/buildings';
import { DIRECTION_COUNT } from '../src/sim/hex';

const worlds = Number(process.argv[2] ?? 12);
const checkpoints = (process.argv[3] ?? '100,300,500').split(',').map(Number);
const options = Object.fromEntries(process.argv.slice(4).map((a) => a.split('=') as [string, string]));

export const PARAMS = {
  biomes: 1,
  regrow: 1,
  /** Share of land hexes checked per year = 1 / checkEvery. */
  checkEvery: 10,
  /** Per check: step towards the climax. */
  pReturn: 0.04,
  /** Per check and neighbor of another biome: step towards it (within climax +-1). */
  pNeighbor: 0.01,
  /** Factor on steps towards wetter near water (sea, lake, river) and with irrigation. */
  wetFactor: 2,
  /** Per check: Forest -> Plains / Jungle -> Forest under a standing lumber camp or sawmill. */
  pDefor: 0.03,
  /** Factor on the return at hexes with ruins or abandoned. */
  ruinFactor: 3,
  /** Factor on all chances at a settled hex. */
  settleFactor: 0.5,
  /** Per year: share of the gap to the capacity (Fertility, Game, Fish, Wood). */
  regrowRate: 0.02,
  /** Years after a change without return/neighbor change at that hex (0 = off). */
  hold: 0,
  /** 0: no Desert next to sea/lake anywhere; 1: only for hexes that were not Desert at generation. */
  desertOwn: 0,
  /** Established biome: every land neighbor of the same biome multiplies the change chance by (1 - established); 0 = off. */
  established: 0,
  /** Neighbor pressure only when at least this many neighbors have the target biome (0/1 = off). */
  majority: 0,
  /** Ecotone margin: a hex is off-climax only if its moisture is beyond the biome boundary by more than this (0 = off). */
  margin: 0,
  /** Pressure band: neighbor pressure only towards a biome that is the climax for moisture within +-band of the hex's (0 = off). */
  band: 0,
};
for (const [k, v] of Object.entries(options)) if (k in PARAMS) (PARAMS as Record<string, number>)[k] = Number(v);

// ---- the biome tree: Desert - Savanna - Plains - Forest - Jungle - Swamp, Tundra - Plains, Hills - Plains ----
const EDGES: [number, number][] = [
  [Biome.Desert, Biome.Savanna],
  [Biome.Savanna, Biome.Plains],
  [Biome.Plains, Biome.Forest],
  [Biome.Forest, Biome.Jungle],
  [Biome.Jungle, Biome.Swamp],
  [Biome.Tundra, Biome.Plains],
  [Biome.Hills, Biome.Plains],
];
const CHAIN_RANK = new Int8Array(BIOME_COUNT).fill(-1);
[Biome.Desert, Biome.Savanna, Biome.Plains, Biome.Forest, Biome.Jungle, Biome.Swamp].forEach((b, i) => (CHAIN_RANK[b] = i));
/** STEP[from * 13 + to]: next biome from `from` towards `to` (-1 = not connected); DIST = number of steps. */
const STEP = new Int8Array(BIOME_COUNT * BIOME_COUNT).fill(-1);
const DIST = new Int8Array(BIOME_COUNT * BIOME_COUNT).fill(99);
for (let from = 0; from < BIOME_COUNT; from++) {
  DIST[from * BIOME_COUNT + from] = 0;
  const queue = [from];
  const first = new Int8Array(BIOME_COUNT).fill(-1);
  for (let qi = 0; qi < queue.length; qi++) {
    const b = queue[qi];
    for (const [x, y] of EDGES) {
      const o = x === b ? y : y === b ? x : -1;
      if (o < 0 || DIST[from * BIOME_COUNT + o] < 99) continue;
      DIST[from * BIOME_COUNT + o] = DIST[from * BIOME_COUNT + b] + 1;
      first[o] = b === from ? o : first[b];
      STEP[from * BIOME_COUNT + o] = first[o];
      queue.push(o);
    }
  }
}
const isMovable = (b: number) => DIST[Biome.Plains * BIOME_COUNT + b] < 99;
const isStillWater = (b: number) => b === Biome.Lake || b === Biome.ShallowSea || b === Biome.DeepOcean;
const MYSTIC = new Set<number>([13, 14, 15, 16]); // see Deposit in world/deposits.ts (checked below)

type Counters = { changes: number; ret: number; press: number; defor: number; settled: number; reversals: number; ruined: number };

type Hook = {
  rng: () => number;
  initial: Uint8Array;
  prev: Int16Array;
  prevAt: Int32Array;
  lastAt: Int32Array;
  moves: Uint16Array;
  count: Counters;
};

function nearWater(sim: Simulation, c: number): boolean {
  const w = sim.world;
  if (w.riverFlow[c] > 0) return true;
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = w.neighbors[c * DIRECTION_COUNT + d];
    if (nb >= 0 && (isStillWater(w.biome[nb]) || w.riverFlow[nb] > 0)) return true;
  }
  return false;
}
function nearStillWater(sim: Simulation, c: number): boolean {
  const w = sim.world;
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = w.neighbors[c * DIRECTION_COUNT + d];
    if (nb >= 0 && isStillWater(w.biome[nb])) return true;
  }
  return false;
}

const nbBuf = new Int8Array(BIOME_COUNT);
const cand = new Float64Array(16);
const candTo = new Int8Array(16);
const candKind = new Int8Array(16);

/** One check of land hex `c` (year `year`). */
function checkHex(sim: Simulation, h: Hook, c: number): void {
  const P = PARAMS;
  const w = sim.world;
  const cur = w.biome[c];
  if (!isMovable(cur) || MYSTIC.has(w.deposit[c])) return;
  const clim = landBiome(w.elevation[c], w.temperature[c], w.moisture[c]);
  const settled = sim.cellPop[c] > 0;
  const ruins = w.ruins[c] > 0 || (sim.hasBuildings[c] === 1 && !settled);
  const water = nearWater(sim, c);
  let irrigated = false;
  let logging = false;
  if (sim.hasBuildings[c]) {
    const eco = sim.economy;
    for (let s = c * eco.slots, end = s + eco.slots; s < end; s++) {
      if (eco.state[s] !== SlotState.Standing) continue;
      const name = BUILDINGS[eco.type[s]].name;
      if (name === 'Fields' || name === 'Well') irrigated = true;
      else if (name === 'Lumber camp' || name === 'Sawmill') logging = true;
    }
  }
  let same = 0;
  const nbCount = nbBuf;
  nbCount.fill(0);
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = w.neighbors[c * DIRECTION_COUNT + d];
    if (nb < 0) continue;
    if (w.biome[nb] === cur) same++;
    else nbCount[w.biome[nb]]++;
  }
  const factor = (settled ? P.settleFactor : 1) * (P.established > 0 ? Math.pow(1 - P.established, same) : 1);
  let n = 0;
  const add = (to: number, p: number, kind: number) => {
    if (to < 0 || p <= 0) return;
    if (to === Biome.Desert && nearStillWater(sim, c) && !(P.desertOwn && h.initial[c] === Biome.Desert)) return;
    if (kind !== 2 && P.hold > 0 && sim.tick - h.lastAt[c] < P.hold * TICKS_PER_YEAR) return;
    const wetter = CHAIN_RANK[cur] >= 0 && CHAIN_RANK[to] > CHAIN_RANK[cur];
    if (wetter && (water || (irrigated && (cur === Biome.Desert || cur === Biome.Savanna) && CHAIN_RANK[to] <= CHAIN_RANK[Biome.Plains]))) p *= P.wetFactor;
    cand[n] = p * factor;
    candTo[n] = to;
    candKind[n] = kind;
    n++;
  };
  // 1. return to the climax (never into a wood while a lumber camp stands)
  let fine = false;
  if (P.margin > 0) {
    const m = w.moisture[c];
    fine = cur === landBiome(w.elevation[c], w.temperature[c], m - P.margin) || cur === landBiome(w.elevation[c], w.temperature[c], m + P.margin);
  }
  if (isMovable(clim) && cur !== clim && !fine) {
    const to = STEP[cur * BIOME_COUNT + clim];
    if (!(logging && (to === Biome.Forest || to === Biome.Jungle))) add(to, P.pReturn * (ruins ? P.ruinFactor : 1), 0);
  }
  // 2. neighbor pressure, inside climax +-1
  if (isMovable(clim)) {
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = w.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0) continue;
      const nbb = w.biome[nb];
      if (nbb === cur || !isMovable(nbb)) continue;
      if (P.majority > 1 && nbCount[nbb] < P.majority) continue;
      const to = STEP[cur * BIOME_COUNT + nbb];
      if (to < 0 || DIST[to * BIOME_COUNT + clim] > 1) continue;
      if (P.band > 0 && to !== clim && to !== landBiome(w.elevation[c], w.temperature[c], w.moisture[c] - P.band) && to !== landBiome(w.elevation[c], w.temperature[c], w.moisture[c] + P.band)) continue;
      add(to, P.pNeighbor, 1);
    }
  }
  // 3. deforestation
  if (logging && (cur === Biome.Forest || cur === Biome.Jungle)) add(cur === Biome.Forest ? Biome.Plains : Biome.Forest, P.pDefor, 2);
  if (n === 0) return;
  let u = h.rng();
  for (let i = 0; i < n; i++) {
    u -= cand[i];
    if (u >= 0) continue;
    change(sim, h, c, candTo[i], candKind[i], settled);
    return;
  }
}

function change(sim: Simulation, h: Hook, c: number, to: number, kind: number, settled: boolean): void {
  const eco = sim.economy;
  const k = h.count;
  const from = sim.world.biome[c];
  k.changes++;
  if (kind === 0) k.ret++;
  else if (kind === 1) k.press++;
  else k.defor++;
  if (settled) k.settled++;
  if (h.prev[c] === to && sim.tick - h.prevAt[c] < 50 * TICKS_PER_YEAR) k.reversals++;
  h.prev[c] = from;
  h.prevAt[c] = sim.tick;
  h.lastAt[c] = sim.tick;
  h.moves[c]++;
  // Biome-bound buildings fall to ruins.
  let any = false;
  if (sim.hasBuildings[c]) {
    for (let s = c * eco.slots, end = s + eco.slots; s < end; s++) {
      if (eco.state[s] !== SlotState.Standing && eco.state[s] !== SlotState.Repair) continue;
      const bound = BUILDINGS[eco.type[s]].biomes;
      if (!bound || bound.includes(to)) continue;
      eco.state[s] = SlotState.Ruin;
      eco.work[s] = 0;
      eco.unpaid[s] = 0;
      any = true;
      k.ruined++;
    }
  }
  if (any) updateTradeBuildings(sim, c);
  setBiome(sim, c, to);
}

function regrow(sim: Simulation, c: number): void {
  const w = sim.world;
  const f = 1 - Math.pow(1 - PARAMS.regrowRate, PARAMS.checkEvery);
  let moved = false;
  for (const r of [Resource.Fertility, Resource.Game, Resource.Fish, Resource.Wood]) {
    const j = c * RESOURCE_COUNT + r;
    const gap = w.resourceCapacity[j] - w.resources[j];
    if (gap > 1e-4 || gap < -1e-4) {
      w.resources[j] += gap * f;
      moved = true;
    }
  }
  if (moved) updateCellSupply(sim, c);
}

/** The rotating check of this tick: hex index mod checkEvery = year mod checkEvery, index / checkEvery mod 52 = tick of the year. */
function step(sim: Simulation, h: Hook): void {
  const E = PARAMS.checkEvery;
  const year = Math.floor(sim.tick / TICKS_PER_YEAR);
  const t = sim.tick % TICKS_PER_YEAR;
  const n = sim.world.cellCount;
  for (let j = t; j * E < n; j += TICKS_PER_YEAR) {
    const c = j * E + (year % E);
    if (c >= n || sim.world.elevation[c] < 0 || isStillWater(sim.world.biome[c])) continue;
    if (PARAMS.biomes) checkHex(sim, h, c);
    if (PARAMS.regrow) regrow(sim, c);
  }
}

// ---- statistics ----
type Row = Record<string, number>;
const rows = new Map<number, Row[]>();
const LAND_BIOMES = [Biome.Tundra, Biome.Plains, Biome.Forest, Biome.Hills, Biome.Desert, Biome.Savanna, Biome.Jungle, Biome.Swamp, Biome.Mountains, Biome.Ice];

for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  const w = sim.world;
  const land: number[] = [];
  for (let c = 0; c < w.cellCount; c++) if (w.elevation[c] >= 0 && !isStillWater(w.biome[c])) land.push(c);
  const h: Hook = {
    rng: createRng(deriveSeed(w.seed, 'biome')),
    initial: Uint8Array.from(w.biome),
    prev: new Int16Array(w.cellCount).fill(-1),
    prevAt: new Int32Array(w.cellCount),
    lastAt: new Int32Array(w.cellCount).fill(-1e9),
    moves: new Uint16Array(w.cellCount),
    count: { changes: 0, ret: 0, press: 0, defor: 0, settled: 0, reversals: 0, ruined: 0 },
  };
  const share0 = new Float64Array(BIOME_COUNT);
  for (const c of land) share0[w.biome[c]] += 1 / land.length;
  let lastChanges = 0;
  let lastYear = 0;
  for (const year of checkpoints) {
    while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) {
      step(sim, h);
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
      if (w.biome[c] !== landBiome(w.elevation[c], w.temperature[c], w.moisture[c]) && isMovable(w.biome[c])) off++;
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
      'changes %/yr (period)': (100 * (h.count.changes - lastChanges)) / years / land.length,
      'changes total': h.count.changes,
      '  return %': (100 * h.count.ret) / Math.max(1, h.count.changes),
      '  pressure %': (100 * h.count.press) / Math.max(1, h.count.changes),
      '  deforest %': (100 * h.count.defor) / Math.max(1, h.count.changes),
      '  at settlement %': (100 * h.count.settled) / Math.max(1, h.count.changes),
      'reversals % (<50y)': (100 * h.count.reversals) / Math.max(1, h.count.changes),
      'hexes changed 3+ times %': (100 * moved3) / land.length,
      'off-climax %': (100 * off) / land.length,
      'differs from J0 %': (100 * moved) / land.length,
      'share drift TV %': 100 * tv,
      'buildings ruined by biome': h.count.ruined,
      'resource gap (mean abs)': gap / Math.max(1, gapN),
    };
    for (const b of LAND_BIOMES) row[`share ${BIOMES[b].name} %`] = 100 * share[b];
    lastChanges = h.count.changes;
    lastYear = year;
    if (!rows.has(year)) rows.set(year, []);
    rows.get(year)!.push(row);
  }
}

console.log(`${worlds} worlds`, JSON.stringify(PARAMS));
for (const [year, list] of rows) {
  console.log(`\nYear ${year}: mean [min..max]`);
  for (const k of Object.keys(list[0])) {
    const mean = list.reduce((s, r) => s + r[k], 0) / list.length;
    const lo = Math.min(...list.map((r) => r[k]));
    const hi = Math.max(...list.map((r) => r[k]));
    console.log(`  ${k.padEnd(28)} ${mean.toFixed(2).padStart(10)}  [${lo.toFixed(1)}..${hi.toFixed(1)}]`);
  }
}

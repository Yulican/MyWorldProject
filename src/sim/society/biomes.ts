import { DIRECTION_COUNT } from '../hex';
import { createRng, deriveSeed, type Rng } from '../rng';
import { BIOMES, BIOME_COUNT, Biome, RESOURCE_COUNT, Resource } from '../world/biomes';
import { landBiome } from '../world/classify';
import { Deposit } from '../world/deposits';
import type { World } from '../world/world';
import { BUILDINGS, SlotState } from './buildings';
import { updateCellSupply } from './economy';
import { blessedCell, setBiome } from './gacha';
import { updateTradeBuildings } from './trade';
import { TICKS_PER_YEAR, record, type Simulation } from './simulation';

// Dynamic biomes and regrowing resources ("Design Documents/Requirement Dynamische Biome.md").
//
// Every land hex is checked once in BIOME_RULE.checkEvery years: hex index mod checkEvery = year mod
// checkEvery, spread over the 52 ticks of the year (index / checkEvery mod 52 = tick of the year), so a tick
// checks only a few hexes (about 8 on the default map). A check
//   - computes the hex's climax: landBiome(elevation, temperature, moisture + climate drift); moisture already
//     carries a running Drought (gacha.ts), so the climax follows it;
//   - steps the biome one step along the chains Desert - Savanna - Plains - Forest - Jungle - Swamp,
//     Tundra - Plains, Hills - Plains: back to the climax (pReturn) or, at a front, towards a neighbor's biome
//     one step closer to the climax (pNeighbor), with the factors of sections 3, 6, 7 and 8;
//   - lets the renewable resources (fertility, game, fish, wood) regrow towards their capacity (section 5),
//     the gap of checkEvery years in one step.
// The climate drift (section 3) is a pure function of the seed and the year: 6 Gaussian blobs with sine
// periods, derived from the seed by a stream of its own and kept outside the simulation state (not saved).
//
// All state is flat typed arrays in `sim.biomes`; random numbers only from `sim.biomes.rng` ("biome"). Nothing
// is allocated per tick; a change (about 0.2 % of the land a year) goes through setBiome (gacha.ts), which
// marks the hex for the map's redraw (landChanged).

/** The decided numbers (Requirement sections 3-8, 11); tools may vary them before creating a simulation. */
export const BIOME_RULE = {
  /** 0 = biomes stay as generated (tools' baseline); regrow 0 = resources don't regrow. */
  enabled: 1,
  regrow: 1,
  /** Every land hex is checked once in this many years. */
  checkEvery: 5,
  /** Per check: a step towards the climax. */
  pReturn: 0.25,
  /** Per check and neighbor whose biome is one step closer to the climax: a step towards it. */
  pNeighbor: 0.08,
  /** Every land neighbor of the same biome multiplies the chances by (1 - established). */
  established: 0.15,
  /** Ecotone margin: a hex is off its climax only if its moisture is beyond the biome boundary by more than this. */
  margin: 0.02,
  /** Factor on steps towards wetter near water (sea, lake, river) and with irrigation. */
  wetFactor: 2,
  /** Factor on the return at hexes with ruins or abandoned buildings. */
  ruinFactor: 3,
  /** Factor on all chances at a settled hex. */
  settleFactor: 0.5,
  /** Fertile Blessing: factor on the return towards green (wetter, at most Forest). */
  blessFactor: 2,
  /** Per year: share of the gap to the capacity (fertility, game, fish, wood). */
  regrowRate: 0.02,
  /** Overgrazing: fertility below this share of its capacity for `grazeYears` years makes the hex one step drier. */
  grazeShare: 0.2,
  grazeYears: 10,
  /** Climate drift: amplitude (moisture), blobs, their radius (hexes) and sine periods driftPeriod +- driftSpread years. */
  driftAmp: 0.2,
  driftBlobs: 6,
  driftRadius: 10,
  driftPeriod: 300,
  driftSpread: 100,
};

/** How a change came about (for the tools' observer). */
export const BiomeCause = { Return: 0, Pressure: 1, Overgrazing: 2 } as const;

export type Biomes = {
  rng: Rng;
  /** 1 = set by the god (Biome Shift): natural and civilization changes skip the hex; regrowth runs. */
  pinned: Uint8Array;
  /** Climax biome per hex at its last check (land hexes; 0 = none yet). */
  climax: Uint8Array;
  /** Biome the next return would step to (the panel's "Becoming ..."), 0 = none (on its climax, pinned or fixed). */
  trend: Uint8Array;
  /** Years in a row with fertility below BIOME_RULE.grazeShare of its capacity (overgrazing). */
  grazeYears: Uint8Array;
  /** 1 for hexes that were Desert when the world was made (they may stay Desert next to water). */
  desertBorn: Uint8Array;
  /** Natural and civilization changes so far. */
  changes: number;
};

export function createBiomes(world: World): Biomes {
  const n = world.cellCount;
  const desertBorn = new Uint8Array(n);
  for (let c = 0; c < n; c++) if (world.biome[c] === Biome.Desert) desertBorn[c] = 1;
  return {
    rng: createRng(deriveSeed(world.seed, 'biome')),
    pinned: new Uint8Array(n),
    climax: new Uint8Array(n),
    trend: new Uint8Array(n),
    grazeYears: new Uint8Array(n),
    desertBorn,
    changes: 0,
  };
}

/** Climax and trend of every land hex (a new simulation, so the panel has them before the first check). */
export function initBiomes(sim: Simulation): void {
  const w = sim.world;
  for (let c = 0; c < w.cellCount; c++) if (isLand(w, c)) assess(sim, c);
}

/** Tools only: called on every natural or civilization change (null = none). */
export let biomeObserver: ((sim: Simulation, cell: number, from: number, to: number, cause: number) => void) | null = null;
export function setBiomeObserver(f: typeof biomeObserver): void {
  biomeObserver = f;
}

// ---------------------------------------------------------------------------
// The chains

const EDGES: readonly (readonly [number, number])[] = [
  [Biome.Desert, Biome.Savanna],
  [Biome.Savanna, Biome.Plains],
  [Biome.Plains, Biome.Forest],
  [Biome.Forest, Biome.Jungle],
  [Biome.Jungle, Biome.Swamp],
  [Biome.Tundra, Biome.Plains],
  [Biome.Hills, Biome.Plains],
];
/** Rank in Desert - Savanna - Plains - Forest - Jungle - Swamp (wetter = higher), -1 elsewhere. */
const RANK = new Int8Array(BIOME_COUNT).fill(-1);
[Biome.Desert, Biome.Savanna, Biome.Plains, Biome.Forest, Biome.Jungle, Biome.Swamp].forEach((b, i) => (RANK[b] = i));
/** STEP[from * BIOME_COUNT + to]: the next biome from `from` towards `to` (-1 = not connected); DIST: steps. */
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
/** Biomes that change (section 4): connected to Plains. Mountains, Ice and water stay. */
const MOVABLE = new Uint8Array(BIOME_COUNT);
for (let b = 0; b < BIOME_COUNT; b++) if (DIST[Biome.Plains * BIOME_COUNT + b] < 99) MOVABLE[b] = 1;

/** Buildings that water the land (irrigation, section 6) and that need their biome (they fall to ruins). */
const WATERS = new Uint8Array(BUILDINGS.length);
for (let t = 0; t < BUILDINGS.length; t++) if (BUILDINGS[t].name === 'Fields' || BUILDINGS[t].name === 'Well') WATERS[t] = 1;

const isStillWater = (b: number) => b === Biome.Lake || b === Biome.ShallowSea || b === Biome.DeepOcean;
const isLand = (w: World, c: number) => w.elevation[c] >= 0 && !isStillWater(w.biome[c]);
const isMystic = (d: number) => d === Deposit.HolySpring || d === Deposit.SacredGrove || d === Deposit.Meteorite || d === Deposit.AncientRuins;

/** True when `biome` can change naturally (section 4). */
export function isChangingBiome(biome: number): boolean {
  return MOVABLE[biome] === 1;
}

/** The next biome from `from` towards `to` along the chains (-1 = not connected or equal). */
export function biomeStep(from: number, to: number): number {
  return from === to ? -1 : STEP[from * BIOME_COUNT + to];
}

// ---------------------------------------------------------------------------
// Climate drift (not saved: derived from the seed)

type Drift = { period: Float64Array; phase: Float64Array; weight: Float32Array };
const drifts = new WeakMap<World, Drift>();

function driftOf(w: World): Drift {
  let d = drifts.get(w);
  if (d) return d;
  const R = BIOME_RULE;
  const K = R.driftBlobs;
  d = { period: new Float64Array(K), phase: new Float64Array(K), weight: new Float32Array(w.cellCount * K) };
  const rng = createRng(deriveSeed(w.seed, 'climate-drift'));
  for (let k = 0; k < K; k++) {
    d.period[k] = R.driftPeriod + (rng() * 2 - 1) * R.driftSpread;
    d.phase[k] = rng() * 2 * Math.PI;
    const cx = rng() * w.width;
    const cy = rng() * w.height;
    for (let c = 0; c < w.cellCount; c++) {
      let dx = Math.abs((c % w.width) - cx);
      dx = Math.min(dx, w.width - dx);
      const dy = Math.floor(c / w.width) - cy;
      d.weight[c * K + k] = Math.exp(-(dx * dx + dy * dy) / (2 * R.driftRadius * R.driftRadius));
    }
  }
  drifts.set(w, d);
  return d;
}

/** Moisture offset of the climate drift at hex `cell` and tick `tick` (within +-BIOME_RULE.driftAmp). */
export function climateDrift(w: World, cell: number, tick: number): number {
  const A = BIOME_RULE.driftAmp;
  if (A <= 0) return 0;
  const d = driftOf(w);
  const K = BIOME_RULE.driftBlobs;
  const year = tick / TICKS_PER_YEAR;
  let sw = 0;
  let sv = 0;
  for (let k = 0; k < K; k++) {
    const wk = d.weight[cell * K + k];
    sw += wk;
    sv += wk * Math.sin((2 * Math.PI * year) / d.period[k] + d.phase[k]);
  }
  return (A * sv) / (sw + 0.25);
}

// ---------------------------------------------------------------------------
// The check

function nearWater(w: World, c: number): boolean {
  if (w.riverFlow[c] > 0) return true;
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = w.neighbors[c * DIRECTION_COUNT + d];
    if (nb >= 0 && (isStillWater(w.biome[nb]) || w.riverFlow[nb] > 0)) return true;
  }
  return false;
}

function nearStillWater(w: World, c: number): boolean {
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = w.neighbors[c * DIRECTION_COUNT + d];
    if (nb >= 0 && isStillWater(w.biome[nb])) return true;
  }
  return false;
}

/** No step into Desert next to sea or lake, except for hexes that were Desert when the world was made. */
function desertBlocked(sim: Simulation, c: number, to: number): boolean {
  return to === Biome.Desert && sim.biomes.desertBorn[c] === 0 && nearStillWater(sim.world, c);
}

/** The climax of hex `c` now, and whether its biome is within the ecotone margin of it (not off-climax). */
let fineNow = false;
function climaxNow(sim: Simulation, c: number): number {
  const w = sim.world;
  const mo = w.moisture[c] + climateDrift(w, c, sim.tick);
  const e = w.elevation[c];
  const t = w.temperature[c];
  const clim = landBiome(e, t, mo);
  const cur = w.biome[c];
  const m = BIOME_RULE.margin;
  fineNow = m > 0 && (cur === landBiome(e, t, mo - m) || cur === landBiome(e, t, mo + m));
  return clim;
}

/** Climax and trend of hex `c` (no random numbers). */
function assess(sim: Simulation, c: number): void {
  const b = sim.biomes;
  const w = sim.world;
  const cur = w.biome[c];
  const clim = climaxNow(sim, c);
  b.climax[c] = clim;
  b.trend[c] = trendOf(sim, c, cur, clim);
}

function trendOf(sim: Simulation, c: number, cur: number, clim: number): number {
  if (sim.biomes.pinned[c] || !MOVABLE[cur] || !MOVABLE[clim] || cur === clim || fineNow || isMystic(sim.world.deposit[c])) return 0;
  const to = STEP[cur * BIOME_COUNT + clim];
  return to < 0 || desertBlocked(sim, c, to) ? 0 : to;
}

// Candidates of one check (scratch, no allocation).
const candP = new Float64Array(16);
const candTo = new Int8Array(16);
const candCause = new Int8Array(16);
let candN = 0;

function addCandidate(sim: Simulation, c: number, cur: number, to: number, p: number, cause: number, wet: boolean, irrigated: boolean, factor: number): void {
  if (to < 0 || p <= 0 || candN >= 16) return;
  if (desertBlocked(sim, c, to)) return;
  const wetter = RANK[cur] >= 0 && RANK[to] > RANK[cur];
  if (wetter && (wet || (irrigated && (cur === Biome.Desert || cur === Biome.Savanna) && RANK[to] <= RANK[Biome.Plains]))) p *= BIOME_RULE.wetFactor;
  candP[candN] = p * factor;
  candTo[candN] = to;
  candCause[candN] = cause;
  candN++;
}

/** One check of land hex `c`: overgrazing, return to the climax, pressure of the fronts. */
function checkHex(sim: Simulation, c: number): void {
  const R = BIOME_RULE;
  const b = sim.biomes;
  const w = sim.world;
  const cur = w.biome[c];
  const clim = climaxNow(sim, c);
  const fine = fineNow;
  b.climax[c] = clim;
  if (b.pinned[c] || !MOVABLE[cur] || isMystic(w.deposit[c])) {
    b.trend[c] = 0;
    b.grazeYears[c] = 0;
    return;
  }
  b.trend[c] = trendOf(sim, c, cur, clim);
  const settled = sim.cellPop[c] > 0;
  // Overgrazing (section 6): fertility kept low (Exhausted Soil) on used land makes the hex one step drier.
  if (w.owner[c] > 0 || settled) {
    const k = c * RESOURCE_COUNT + Resource.Fertility;
    if (w.resources[k] < R.grazeShare * w.resourceCapacity[k]) {
      const years = b.grazeYears[c] + R.checkEvery;
      b.grazeYears[c] = years > 255 ? 255 : years;
    } else b.grazeYears[c] = 0;
    if (b.grazeYears[c] >= R.grazeYears) {
      b.grazeYears[c] = 0;
      const to = RANK[cur] > 0 ? STEP[cur * BIOME_COUNT + Biome.Desert] : -1;
      if (to >= 0 && !desertBlocked(sim, c, to)) {
        change(sim, c, to, BiomeCause.Overgrazing, settled);
        return;
      }
    }
  } else b.grazeYears[c] = 0;

  const ruins = w.ruins[c] > 0 || (sim.hasBuildings[c] === 1 && !settled);
  const wet = nearWater(w, c);
  let irrigated = false;
  if (sim.hasBuildings[c]) {
    const eco = sim.economy;
    for (let s = c * eco.slots, end = s + eco.slots; s < end; s++) {
      if (eco.state[s] === SlotState.Standing && WATERS[eco.type[s]]) {
        irrigated = true;
        break;
      }
    }
  }
  let same = 0;
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = w.neighbors[c * DIRECTION_COUNT + d];
    if (nb >= 0 && w.biome[nb] === cur) same++;
  }
  const factor = (settled ? R.settleFactor : 1) * (R.established > 0 ? Math.pow(1 - R.established, same) : 1);
  candN = 0;
  // 1. Return to the climax.
  if (MOVABLE[clim] && cur !== clim && !fine) {
    const to = STEP[cur * BIOME_COUNT + clim];
    let p = R.pReturn * (ruins ? R.ruinFactor : 1);
    // Fertile Blessing: towards green (wetter, at most Forest).
    if (to >= 0 && RANK[cur] >= 0 && RANK[to] > RANK[cur] && RANK[to] <= RANK[Biome.Forest] && blessedCell(sim, c)) p *= R.blessFactor;
    addCandidate(sim, c, cur, to, p > 1 ? 1 : p, BiomeCause.Return, wet, irrigated, factor);
  }
  // 2. Pressure of the fronts: a neighbor's biome one step closer to the climax.
  if (MOVABLE[clim] && cur !== clim && !fine) {
    const toClim = DIST[cur * BIOME_COUNT + clim];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = w.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0) continue;
      const nbb = w.biome[nb];
      if (nbb === cur || !MOVABLE[nbb]) continue;
      const to = STEP[cur * BIOME_COUNT + nbb];
      if (to < 0 || DIST[to * BIOME_COUNT + clim] >= toClim) continue;
      addCandidate(sim, c, cur, to, R.pNeighbor, BiomeCause.Pressure, wet, irrigated, factor);
    }
  }
  if (candN === 0) return;
  let u = b.rng();
  for (let i = 0; i < candN; i++) {
    u -= candP[i];
    if (u >= 0) continue;
    change(sim, c, candTo[i], candCause[i], settled);
    return;
  }
}

/**
 * Hex `c` turns to `to`: biome-bound buildings (lumber camp, sawmill on Forest/Jungle; quarry, stonemason on
 * Hills/Mountains) that no longer fit fall to ruins, setBiome sets capacities and marks the map. Unlike the
 * prototype, a standing lumber camp doesn't hold back the return to Forest (section 6: no deforestation).
 */
function change(sim: Simulation, c: number, to: number, cause: number, settled: boolean): void {
  const w = sim.world;
  const eco = sim.economy;
  const from = w.biome[c];
  let ruined = 0;
  let ruinedType = -1;
  if (sim.hasBuildings[c]) {
    for (let s = c * eco.slots, end = s + eco.slots; s < end; s++) {
      // Sites under construction too: they could not be finished on the new biome.
      const st = eco.state[s];
      if (st !== SlotState.Standing && st !== SlotState.Repair && st !== SlotState.Construction) continue;
      const bound = BUILDINGS[eco.type[s]].biomes;
      if (!bound || bound.includes(to)) continue;
      eco.state[s] = SlotState.Ruin;
      eco.work[s] = 0;
      eco.unpaid[s] = 0;
      ruined++;
      ruinedType = eco.type[s];
    }
    if (ruined > 0) updateTradeBuildings(sim, c);
  }
  setBiome(sim, c, to);
  sim.biomes.changes++;
  sim.biomes.trend[c] = trendOf(sim, c, to, sim.biomes.climax[c]);
  if (settled || ruined > 0) {
    // Quiet chronicle entries for the big changes (section 9).
    const civ = sim.civs[w.owner[c]];
    const where = civ ? ` in the land of the ${civ.name}` : '';
    const lost = ruined > 0 ? ` The ${BUILDINGS[ruinedType].name.toLowerCase()} there lies in ruins.` : '';
    record(sim, `The ${BIOMES[from].name.toLowerCase()}${where} turned to ${BIOMES[to].name.toLowerCase()}.${lost}`, c, false);
  }
  if (biomeObserver) biomeObserver(sim, c, from, to, cause);
}

/** Renewable resources of hex `c` regrow (or fall) towards their capacity, `years` years in one step (section 5). */
function regrow(sim: Simulation, c: number, years: number): void {
  const w = sim.world;
  const f = 1 - Math.pow(1 - BIOME_RULE.regrowRate, years);
  let moved = false;
  for (let r = Resource.Fertility; r <= Resource.Wood; r++) {
    const j = c * RESOURCE_COUNT + r;
    const gap = w.resourceCapacity[j] - w.resources[j];
    if (gap > 1e-4 || gap < -1e-4) {
      w.resources[j] += gap * f;
      moved = true;
    }
  }
  if (moved) updateCellSupply(sim, c);
}

function checkCell(sim: Simulation, c: number): void {
  if (!isLand(sim.world, c)) return;
  if (BIOME_RULE.enabled) checkHex(sim, c);
  if (BIOME_RULE.regrow) regrow(sim, c, BIOME_RULE.checkEvery);
}

/**
 * The rotating check of this tick (simulation.ts, TickPart.Start, before the tick's inhabitants): the land hexes
 * with index mod checkEvery = year mod checkEvery, a 52nd of them per tick.
 */
export function advanceBiomes(sim: Simulation): void {
  const E = BIOME_RULE.checkEvery;
  const year = Math.floor(sim.tick / TICKS_PER_YEAR);
  const t = sim.tick % TICKS_PER_YEAR;
  const n = sim.world.cellCount;
  const off = year % E;
  for (let j = t; j * E < n; j += TICKS_PER_YEAR) {
    const c = j * E + off;
    if (c < n) checkCell(sim, c);
  }
}

/**
 * Benchmark hook (scenario gacha, Requirement section 11): an accelerated check, every hex every `every` ticks
 * (the hexes with index mod every = tick mod every). Same rules and random numbers as the natural check. The
 * tick's share can be split into `slices` calls (slice 0 .. slices-1, e.g. one per frame) of about
 * cellCount / every / slices hexes each.
 */
export function checkBiomesFast(sim: Simulation, every = 5, slice = 0, slices = 1): void {
  const n = sim.world.cellCount;
  const stride = every * slices;
  for (let c = (sim.tick % every) + slice * every; c < n; c += stride) checkCell(sim, c);
}

// ---------------------------------------------------------------------------
// What the app reads

/** The hex panel's "Biome" line: the biome, the one it is becoming (-1 = none) and whether the god set it. */
export type HexBiome = { biome: number; becoming: number; pinned: boolean };

export function hexBiome(sim: Simulation, cell: number): HexBiome {
  const b = sim.biomes;
  const pinned = b.pinned[cell] === 1;
  const trend = b.trend[cell];
  return { biome: sim.world.biome[cell], becoming: pinned || trend === 0 ? -1 : trend, pinned };
}

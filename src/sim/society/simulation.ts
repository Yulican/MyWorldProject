import { DIRECTION_COUNT } from '../hex';
import { createRng, deriveSeed, type Rng } from '../rng';
import type { Term } from '../terms';
import { BIOMES, isWaterBiome } from '../world/biomes';
import { clamp } from '../world/climate';
import { addRoad, stepCost } from '../world/roads';
import type { World } from '../world/world';
import {
  CIV_COLOR_COUNT,
  MAX_CIVS,
  createCivilization,
  emptyFaithLedger,
  generateCivName,
  type CivOrigin,
  type Civilization,
} from './civilizations';
import { CULTURE_COUNT, Culture, driftCulture, landCulture, terrainAppeal } from './culture';
import { allocateSlot, createPopulation, releaseSlot, type Population } from './population';
import { SUPPLY_KINDS, computeSupply, supplyTerms, supportedPeople, type SupplyModifier } from './supply';

// The living world: inhabitants age, have children and die; when a hex can't
// provide enough food, water or space, a group moves on to a free neighbor
// and a road connects the two. Civilizations spread that way, new peoples
// appear (and, once enabled again, break away). One tick is one
// week. Each inhabitant is updated once a year, staggered so that every tick
// handles 1/52 of them (design doc, section 11).

export const TICKS_PER_YEAR = 52;
/** Map snapshot and civilization stats are refreshed this often (quarterly). */
const REFRESH_TICKS = 13;
/** Faith from which an inhabitant counts as a believer who prays to the player. */
export const BELIEVER_FAITH = 0.5;
const START_TRIBE_SIZE = 20;
/** Civilization slots per cell in `cellCivPop` (index 0 = nobody). */
const CIV_SLOTS = MAX_CIVS + 1;
/**
 * Breakaways are paused for now: they made test games hard to follow
 * without adding much. The rules stay in place for when we return to them.
 */
const SECESSION_ENABLED = false;
/** Settlements further than this many hexes from the capital may break away. */
const SECESSION_REACH = 7;
const SECESSION_CHANCE = 0.08;
/**
 * When a hex's people need more than it provides, this many of them move to
 * a free neighboring hex that can hold them, and a road is built between the
 * two (design doc, section 5).
 */
export const EXPANSION_GROUP = 25;
/** Score lost per unit of travel cost into the new hex: easy land is settled first. */
const TRAVEL_EFFORT = 0.05;
/** Space supply of the best land; normalizes how much a new hex can hold. */
const GOOD_LAND_PEOPLE = 150;
/** Years of population and believer counts kept for the trend chart. */
const HISTORY_YEARS = 200;
const NEW_TRIBE_MIN_YEAR = 25;
const NEW_TRIBE_CHANCE = 0.02;
/** New tribes appear at least this many hexes from anyone else. */
const NEW_TRIBE_DISTANCE = 8;

export type ChronicleEntry = { tick: number; text: string };

export type Simulation = {
  world: World;
  rng: Rng;
  tick: number;
  pop: Population;
  /** Index = civilization id; null for free slots. Index 0 is never used. */
  civs: (Civilization | null)[];
  /** Inhabitants per cell, kept exact on every birth, death and move. */
  cellPop: Int32Array;
  /** Inhabitants per cell and civilization: cell * CIV_SLOTS + civ. */
  cellCivPop: Int32Array;
  /** Food, water and space per hex in people: cell * SUPPLY_KINDS + kind (see supply.ts). */
  cellSupply: Float32Array;
  /** People a hex supports: its scarcest supply. */
  cellCapacity: Float32Array;
  /**
   * Changes to hexes' supplies from outside nature's defaults (abilities,
   * depletion; none yet). Recompute supply after changing them.
   */
  supplyModifiers: Map<number, SupplyModifier[]>;
  /** Notable events, oldest first. */
  chronicle: ChronicleEntry[];
  /** Believers in all civilizations at the last refresh. */
  believers: number;
  /** Totals at the end of each year, oldest first, at most HISTORY_YEARS. */
  history: { population: number[]; believers: number[] };
  /** Nobody prays to the player anymore (design doc, section 9). */
  gameOver: boolean;
  /** Increases whenever the map snapshot in `world` changes. */
  snapshotVersion: number;
};

/** Settles the player's starting tribe in a freshly generated world. */
export function createSimulation(world: World): Simulation {
  const n = world.cellCount;
  const sim: Simulation = {
    world,
    rng: createRng(deriveSeed(world.seed, 'society')),
    tick: 0,
    pop: createPopulation(1024),
    civs: new Array<Civilization | null>(CIV_SLOTS).fill(null),
    cellPop: new Int32Array(n),
    cellCivPop: new Int32Array(n * CIV_SLOTS),
    cellSupply: new Float32Array(n * SUPPLY_KINDS),
    cellCapacity: new Float32Array(n),
    supplyModifiers: new Map(),
    chronicle: [],
    believers: 0,
    history: { population: [], believers: [] },
    gameOver: false,
    snapshotVersion: 0,
  };
  computeCapacity(sim);

  const start = world.startCell;
  const tribe = foundCivilization(sim, 'start', start, null);
  tribe.worshipsPlayer = true;
  for (let i = 0; i < START_TRIBE_SIZE; i++) {
    addInhabitant(sim, start, tribe.id, 2 + Math.floor(sim.rng() * 36), 0.75 + 0.25 * sim.rng());
  }
  record(sim, `The ${tribe.name} settle in the ${biomeName(world, start)}. They pray to you.`);
  refreshSnapshot(sim);
  return sim;
}

/** Advances the world by one week. */
export function stepSimulation(sim: Simulation): void {
  if (sim.gameOver) return;
  const { pop } = sim;
  const end = pop.end;
  for (let i = sim.tick % TICKS_PER_YEAR; i < end; i += TICKS_PER_YEAR) {
    if (pop.alive[i]) updateInhabitant(sim, i);
  }
  sim.tick++;
  const yearEnd = sim.tick % TICKS_PER_YEAR === 0;
  if (yearEnd) updateCivilizations(sim);
  if (sim.tick % REFRESH_TICKS === 0) {
    expandSettlements(sim);
    refreshSnapshot(sim);
  }
  if (yearEnd) closeYear(sim);
}

/** Keeps the year's totals for the trend chart and starts new faith ledgers. */
function closeYear(sim: Simulation): void {
  const { history } = sim;
  history.population.push(sim.pop.count);
  history.believers.push(sim.believers);
  if (history.population.length > HISTORY_YEARS) {
    history.population.shift();
    history.believers.shift();
  }
  for (const civ of livingCivilizations(sim)) {
    civ.faithLastYear = civ.faithYear;
    civ.faithYear = emptyFaithLedger();
  }
}

/** In-game year, starting at 1. */
export function simulationYear(sim: Simulation): number {
  return Math.floor(sim.tick / TICKS_PER_YEAR) + 1;
}

export function livingCivilizations(sim: Simulation): Civilization[] {
  return sim.civs.filter((c): c is Civilization => c !== null);
}

// ---------------------------------------------------------------------------
// Inhabitants

function addInhabitant(sim: Simulation, cell: number, civ: number, age: number, faith: number): void {
  const { pop } = sim;
  const i = allocateSlot(pop);
  pop.alive[i] = 1;
  pop.age[i] = age;
  pop.cell[i] = cell;
  pop.civ[i] = civ;
  pop.faith[i] = faith;
  pop.count++;
  sim.cellPop[cell]++;
  sim.cellCivPop[cell * CIV_SLOTS + civ]++;
}

function removeInhabitant(sim: Simulation, i: number): void {
  const { pop } = sim;
  const cell = pop.cell[i];
  sim.cellPop[cell]--;
  sim.cellCivPop[cell * CIV_SLOTS + pop.civ[i]]--;
  releaseSlot(pop, i);
  pop.count--;
}

function moveInhabitant(sim: Simulation, i: number, to: number): void {
  const { pop } = sim;
  const from = pop.cell[i];
  const civ = pop.civ[i];
  sim.cellPop[from]--;
  sim.cellCivPop[from * CIV_SLOTS + civ]--;
  sim.cellPop[to]++;
  sim.cellCivPop[to * CIV_SLOTS + civ]++;
  pop.cell[i] = to;
}

function changeCiv(sim: Simulation, i: number, civ: number): void {
  const { pop } = sim;
  const cell = pop.cell[i];
  sim.cellCivPop[cell * CIV_SLOTS + pop.civ[i]]--;
  sim.cellCivPop[cell * CIV_SLOTS + civ]++;
  pop.civ[i] = civ;
}

/** Yearly chance to die by age. */
function ageMortality(age: number): number {
  if (age < 5) return 0.03;
  if (age < 45) return 0.006;
  return 0.006 + (age - 45) * 0.007;
}

/** One inhabitant's year: aging, death, faith and children. */
function updateInhabitant(sim: Simulation, i: number): void {
  const { pop, world, rng } = sim;
  const cell = pop.cell[i];
  const civId = pop.civ[i];
  const civ = sim.civs[civId]!;
  const age = Math.min(255, pop.age[i] + 1);
  pop.age[i] = age;

  // Shortage (of food, water or space) kills once a hex holds more people than it supports.
  const crowding = sim.cellPop[cell] / Math.max(1, sim.cellCapacity[cell]);
  const death = ageMortality(age) + world.danger[cell] * 0.01 + (crowding > 1 ? (crowding - 1) * 0.3 : 0);
  const ledger = civ.faithYear;
  if (rng() < death) {
    if (pop.faith[i] >= BELIEVER_FAITH) ledger.died++;
    removeInhabitant(sim, i);
    return;
  }

  // Faith follows the neighbors. The player's own people grow more devout,
  // everyone else slowly forgets the player. Crossing the believer line is
  // booked under whichever of these pulled hardest.
  const before = pop.faith[i];
  const neighborFaith = world.population[cell] > 0 ? world.faith[cell] : before;
  const pull = (neighborFaith - before) * 0.1;
  const devotion = civ.worshipsPlayer ? civ.culture[Culture.Devout] * 0.02 : 0;
  const fading = civ.worshipsPlayer ? 0 : 0.005;
  const faith = clamp(before + pull + devotion - fading, 0, 1);
  pop.faith[i] = faith;
  const wasBeliever = before >= BELIEVER_FAITH;
  if (wasBeliever !== faith >= BELIEVER_FAITH) {
    if (wasBeliever) {
      if (-pull > fading) ledger.lostToNeighbors++;
      else ledger.forgot++;
    } else if (pull > devotion) ledger.wonByNeighbors++;
    else ledger.grewDevout++;
  }

  // Full birth rate up to half the hex's capacity, none once it is overfull.
  if (age >= 16 && age <= 42 && rng() < 0.17 * clamp((1.1 - crowding) / 0.6, 0, 1)) {
    const childFaith = clamp(faith * 0.9 + neighborFaith * 0.1 + (rng() - 0.5) * 0.1, 0, 1);
    if (childFaith >= BELIEVER_FAITH) ledger.born++;
    addInhabitant(sim, cell, civId, 0, childFaith);
  }

}

// ---------------------------------------------------------------------------
// Map snapshot and statistics

/**
 * Each hex's supply and the people it supports, from its current natural
 * resources. Nature doesn't change yet, so this runs once per world; it has
 * to run again once resources deplete or abilities change the land.
 */
function computeCapacity(sim: Simulation): void {
  computeSupply(sim.world, sim.supplyModifiers, sim.cellSupply);
  for (let c = 0; c < sim.world.cellCount; c++) sim.cellCapacity[c] = supportedPeople(sim.cellSupply, c);
}

/** How a hex's food, water and space come about, indexed by SupplyKind (see supply.ts). */
export function hexSupplyTerms(sim: Simulation, cell: number): Term[][] {
  return supplyTerms(sim.world, cell, sim.supplyModifiers.get(cell) ?? []);
}

// ---------------------------------------------------------------------------
// Expansion

/**
 * Quarterly: every hex whose people need more than it provides sends a group
 * of EXPANSION_GROUP of the civilization living there to the best free
 * neighboring hex that can hold them, and a road links the two. Free means
 * nobody lives there and it isn't another people's land (emptied hexes stay
 * their people's land). Without such a neighbor the people stay, and
 * shortage thins them out.
 */
function expandSettlements(sim: Simulation): void {
  const { world } = sim;
  for (const civ of livingCivilizations(sim)) {
    const sources: number[] = [];
    for (let c = 0; c < world.cellCount; c++) {
      if (sim.cellCivPop[c * CIV_SLOTS + civ.id] > EXPANSION_GROUP && sim.cellPop[c] > sim.cellCapacity[c]) sources.push(c);
    }
    if (sources.length === 0) continue;
    // Most overloaded first, so it gets the pick of the free land.
    sources.sort((a, b) => sim.cellPop[b] - sim.cellCapacity[b] - (sim.cellPop[a] - sim.cellCapacity[a]));
    for (const source of sources) {
      let best = -1;
      let bestScore = -Infinity;
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const target = world.neighbors[source * DIRECTION_COUNT + d];
        if (target < 0 || sim.cellPop[target] > 0 || sim.cellCapacity[target] < EXPANSION_GROUP) continue;
        // Another people's land is off limits, even where it has emptied.
        const owner = world.owner[target];
        if (owner !== 0 && owner !== civ.id) continue;
        const score =
          sim.cellCapacity[target] / GOOD_LAND_PEOPLE +
          terrainAppeal(world, civ.culture, target) -
          TRAVEL_EFFORT * stepCost(world, source, d);
        if (score > bestScore) {
          bestScore = score;
          best = d;
        }
      }
      if (best < 0) continue;
      moveGroup(sim, source, world.neighbors[source * DIRECTION_COUNT + best], civ.id, EXPANSION_GROUP);
      addRoad(world, source, best);
    }
  }
}

/** Moves `count` people of a civilization from one hex to another. */
function moveGroup(sim: Simulation, from: number, to: number, civId: number, count: number): void {
  const { pop } = sim;
  let moved = 0;
  for (let i = 0; i < pop.end && moved < count; i++) {
    if (pop.alive[i] && pop.cell[i] === from && pop.civ[i] === civId) {
      moveInhabitant(sim, i, to);
      moved++;
    }
  }
}

// ---------------------------------------------------------------------------
// Map snapshot and statistics

/**
 * Recomputes the per-hex snapshot the map shows (owner, population, faith),
 * civilization stats, extinctions and game over.
 */
function refreshSnapshot(sim: Simulation): void {
  const { world, pop } = sim;

  const faithSum = new Float64Array(world.cellCount);
  const believers = new Int32Array(CIV_SLOTS);
  const civFaithSum = new Float64Array(CIV_SLOTS);
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i]) continue;
    faithSum[pop.cell[i]] += pop.faith[i];
    civFaithSum[pop.civ[i]] += pop.faith[i];
    if (pop.faith[i] >= BELIEVER_FAITH) believers[pop.civ[i]]++;
  }

  const civPop = new Int32Array(CIV_SLOTS);
  const territory = new Int32Array(CIV_SLOTS);
  for (let c = 0; c < world.cellCount; c++) {
    const people = sim.cellPop[c];
    world.population[c] = people;
    world.faith[c] = people > 0 ? faithSum[c] / people : 0;
    // An emptied hex stays its people's land (no one else may settle it)
    // until that people dies out.
    let owner = people === 0 ? world.owner[c] : 0;
    let most = 0;
    for (let id = 1; id < CIV_SLOTS; id++) {
      const n = sim.cellCivPop[c * CIV_SLOTS + id];
      civPop[id] += n;
      if (n > most) {
        most = n;
        owner = id;
      }
    }
    world.owner[c] = owner;
    if (owner) territory[owner]++;
  }

  sim.believers = 0;
  for (let id = 1; id < CIV_SLOTS; id++) {
    const civ = sim.civs[id];
    if (!civ) continue;
    civ.population = civPop[id];
    civ.territory = territory[id];
    civ.believers = believers[id];
    civ.averageFaith = civ.population > 0 ? civFaithSum[id] / civ.population : 0;
    sim.believers += believers[id];
    if (civ.population === 0) {
      record(sim, `The ${civ.name} have vanished.`);
      sim.civs[id] = null;
      continue;
    }
    if (sim.cellCivPop[civ.capital * CIV_SLOTS + id] === 0) civ.capital = mostPopulousCell(sim, id, null);
  }

  // Land of peoples that just vanished is free again.
  for (let c = 0; c < world.cellCount; c++) if (world.owner[c] && !sim.civs[world.owner[c]]) world.owner[c] = 0;

  if (sim.believers === 0) {
    sim.gameOver = true;
    record(sim, 'Nobody prays to you anymore.');
  }
  sim.snapshotVersion++;
}

function mostPopulousCell(sim: Simulation, civId: number, allowed: Uint8Array | null): number {
  let best = -1;
  let most = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (allowed && !allowed[c]) continue;
    const n = sim.cellCivPop[c * CIV_SLOTS + civId];
    if (n > most) {
      most = n;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Civilizations

/** Yearly: culture drift, breakaways and new tribes. */
function updateCivilizations(sim: Simulation): void {
  const target = new Float32Array(CULTURE_COUNT);
  for (const civ of livingCivilizations(sim)) {
    const { cells, weights } = civCells(sim, civ.id);
    if (cells.length === 0) continue;
    landCulture(sim.world, cells, weights, target);
    driftCulture(civ.culture, target);
    if (SECESSION_ENABLED) trySecession(sim, civ);
  }
  tryNewTribe(sim);
}

function civCells(sim: Simulation, civId: number): { cells: number[]; weights: number[] } {
  const cells: number[] = [];
  const weights: number[] = [];
  for (let c = 0; c < sim.world.cellCount; c++) {
    const n = sim.cellCivPop[c * CIV_SLOTS + civId];
    if (n > 0) {
      cells.push(c);
      weights.push(n);
    }
  }
  return { cells, weights };
}

/**
 * Settlements cut off from the capital, or too far away from it, may break
 * away as a new civilization. They keep part of their faith in the player
 * but no longer worship them.
 */
function trySecession(sim: Simulation, parent: Civilization): void {
  const { world, rng, pop } = sim;
  if (livingCivilizations(sim).length >= MAX_CIVS || parent.population < 60) return;

  const own = (c: number) => sim.cellCivPop[c * CIV_SLOTS + parent.id] > 0;
  const reach = distanceField(world, [parent.capital], SECESSION_REACH, own);

  // Group remote settlements into connected clusters, keep the largest.
  const cluster = new Int32Array(world.cellCount).fill(-1);
  let bestCluster = -1;
  let bestPop = 0;
  let clusterCount = 0;
  const stack: number[] = [];
  for (let start = 0; start < world.cellCount; start++) {
    if (!own(start) || reach[start] >= 0 || cluster[start] >= 0) continue;
    const id = clusterCount++;
    let people = 0;
    cluster[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const c = stack.pop()!;
      people += sim.cellCivPop[c * CIV_SLOTS + parent.id];
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const nb = world.neighbors[c * DIRECTION_COUNT + d];
        if (nb < 0 || cluster[nb] >= 0 || !own(nb) || reach[nb] >= 0) continue;
        cluster[nb] = id;
        stack.push(nb);
      }
    }
    if (people > bestPop) {
      bestPop = people;
      bestCluster = id;
    }
  }
  if (bestCluster < 0 || bestPop < 25 || rng() >= SECESSION_CHANCE) return;

  const inCluster = new Uint8Array(world.cellCount);
  for (let c = 0; c < world.cellCount; c++) if (cluster[c] === bestCluster) inCluster[c] = 1;
  const capital = mostPopulousCell(sim, parent.id, inCluster);
  const civ = foundCivilization(sim, 'secession', capital, parent);
  for (let i = 0; i < pop.end; i++) {
    if (pop.alive[i] && pop.civ[i] === parent.id && inCluster[pop.cell[i]]) {
      changeCiv(sim, i, civ.id);
      pop.faith[i] *= 0.6;
    }
  }
  record(sim, `The ${civ.name} in the ${biomeName(world, capital)} broke away from the ${parent.name}.`);
}

/** Occasionally a new people appears in empty, livable land far from everyone. */
function tryNewTribe(sim: Simulation): void {
  const { world, rng } = sim;
  if (simulationYear(sim) < NEW_TRIBE_MIN_YEAR || livingCivilizations(sim).length >= MAX_CIVS) return;
  if (rng() >= NEW_TRIBE_CHANCE) return;

  const settled: number[] = [];
  for (let c = 0; c < world.cellCount; c++) if (sim.cellPop[c] > 0 || world.owner[c] !== 0) settled.push(c);
  const near = distanceField(world, settled, NEW_TRIBE_DISTANCE - 1, () => true);

  let best = -1;
  let bestScore = -Infinity;
  for (let c = 0; c < world.cellCount; c++) {
    if (near[c] >= 0 || sim.cellCapacity[c] < 15) continue;
    const score = sim.cellCapacity[c] / GOOD_LAND_PEOPLE - world.danger[c] + rng() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best < 0) return;

  const civ = foundCivilization(sim, 'tribe', best, null);
  const size = 15 + Math.floor(rng() * 10);
  for (let i = 0; i < size; i++) addInhabitant(sim, best, civ.id, 2 + Math.floor(rng() * 36), rng() * 0.1);
  record(sim, `A new people, the ${civ.name}, appeared in the ${biomeName(world, best)}.`);
}

/**
 * Creates a civilization in a free slot. Its culture comes from the land
 * around its capital; a breakaway starts halfway between that and its
 * parent's culture.
 */
function foundCivilization(sim: Simulation, origin: CivOrigin, capital: number, parent: Civilization | null): Civilization {
  const { world, rng } = sim;
  const living = livingCivilizations(sim);
  const id = sim.civs.indexOf(null, 1);
  const usedColors = new Set(living.map((c) => c.color));
  let color = 0;
  while (usedColors.has(color) && color < CIV_COLOR_COUNT - 1) color++;
  const name = generateCivName(rng, new Set(living.map((c) => c.name)));

  const civ = createCivilization(id, name, color, origin, sim.tick, capital);
  const around = distanceField(world, [capital], 2, (c) => !isWaterBiome(world.biome[c]));
  const cells: number[] = [];
  for (let c = 0; c < world.cellCount; c++) if (around[c] >= 0) cells.push(c);
  landCulture(world, cells, cells.map(() => 1), civ.culture);
  for (let k = 0; k < CULTURE_COUNT; k++) {
    const own = clamp(civ.culture[k] + (rng() - 0.5) * 0.2, 0, 1);
    civ.culture[k] = parent ? (own + parent.culture[k]) / 2 : own;
  }
  if (parent) civ.parentName = parent.name;
  sim.civs[id] = civ;
  return civ;
}

// ---------------------------------------------------------------------------
// Helpers

/**
 * Breadth-first hex distance from the source cells, walking only through
 * cells that `passable` allows. -1 for cells not reached within `maxDistance`.
 */
function distanceField(
  world: World,
  sources: readonly number[],
  maxDistance: number,
  passable: (cell: number) => boolean,
): Int32Array {
  const distance = new Int32Array(world.cellCount).fill(-1);
  let frontier: number[] = [];
  for (const s of sources) {
    if (s < 0 || distance[s] >= 0) continue;
    distance[s] = 0;
    frontier.push(s);
  }
  for (let d = 1; d <= maxDistance && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let k = 0; k < DIRECTION_COUNT; k++) {
        const nb = world.neighbors[c * DIRECTION_COUNT + k];
        if (nb < 0 || distance[nb] >= 0 || !passable(nb)) continue;
        distance[nb] = d;
        next.push(nb);
      }
    }
    frontier = next;
  }
  return distance;
}

function biomeName(world: World, cell: number): string {
  return BIOMES[world.biome[cell]].name.toLowerCase();
}

function record(sim: Simulation, text: string): void {
  sim.chronicle.push({ tick: sim.tick, text });
}

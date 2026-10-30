import { DIRECTION_COUNT } from '../hex';
import { MinHeap } from '../minHeap';
import { createRng, deriveSeed, type Rng } from '../rng';
import type { Term } from '../terms';
import { BIOMES, isWaterBiome } from '../world/biomes';
import { clamp } from '../world/climate';
import { addRoad, hasRoad, stepCost } from '../world/roads';
import type { World } from '../world/world';
import {
  MAX_CIVS,
  MAX_CIV_ID,
  createCivilization,
  emptyFaithLedger,
  generateCivName,
  pickCivColor,
  type CivOrigin,
  type Civilization,
} from './civilizations';
import { CULTURE_COUNT, Culture, driftCulture, landCulture, terrainAppeal } from './culture';
import { BUILDINGS, FIRST_LUXURY, GOOD_NAMES, SLOTS, SlotState, countSlots, createEconomy, isLuxury, type Economy } from './buildings';
import {
  EXPANSION_GROUP,
  capacityAfterRepair,
  cellModifiers,
  isSettlementTarget,
  planSeats,
  rawMaterials,
  runEconomy,
  updateCellSupply,
} from './economy';
import {
  MOOD_NEW_PEOPLE,
  MOOD_REVOLUTION_LOST,
  MOOD_REVOLUTION_WON,
  SATISFACTION_MAX,
  UNHAPPY_QUARTERS,
  addMood,
  birthFactor,
  cellOwners,
  connectionValue,
  hasSeat,
  pruneMoods,
  updateSatisfaction,
} from './satisfaction';
import { WORKSHOP_OF, advanceTrips, createTrade, sumCivWants, type Trade } from './trade';
import { PROTO } from './tuning';
import { allocateSlot, createPopulation, releaseSlot, type Population } from './population';
import { SUPPLY_KINDS, supplyTerms, type SupplyModifier } from './supply';

// The living world: inhabitants age, have children and die; when a hex can't
// provide enough food, water or space, a group moves on to a free neighbor
// and a road connects the two. Civilizations spread that way and new peoples
// appear. Unhappy settlements send people away and, joined by roads into a
// league, break away (satisfaction.ts). One tick is one week. Each
// inhabitant is updated once a year, staggered so that every tick handles
// 1/52 of them (design doc, section 11).

export const TICKS_PER_YEAR = 52;
/** Map snapshot and civilization stats are refreshed this often (quarterly). */
const REFRESH_TICKS = 13;
/** Faith from which an inhabitant counts as a believer who prays to the player. */
export const BELIEVER_FAITH = 0.5;
const START_TRIBE_SIZE = 20;
/** From this age inhabitants count as adults (they have children and earn money). */
const ADULT_AGE = 16;
/** Civilization slots per cell in `cellCivPop` at first (index 0 = nobody); doubles as needed. */
const INITIAL_CIV_SLOTS = 8;
export { EXPANSION_GROUP };
/** A league of settlements ready to break away needs this many settlements or people. */
export const LEAGUE_MIN_SETTLEMENTS = 3;
export const LEAGUE_MIN_PEOPLE = 100;
/** Unhappy people move to settlements reachable by road within this travel cost. */
const MIGRATION_REACH = 8;
/** ...that are at least this much more satisfied than their own. */
const MIGRATION_MIN_GAIN = 10;
/** Expansion score per point of satisfaction the new hex's connection promises (×1/100). */
const SATISFACTION_APPEAL = 0.5;
/** Score lost per unit of travel cost into the new hex: easy land is settled first. */
const TRAVEL_EFFORT = 0.05;
/** Score per unit of wood and stone the new hex yields per year: building material is worth having. */
const RAW_MATERIAL_APPEAL = 0.02;
/** Space supply of the best land; normalizes how much a new hex can hold. */
const GOOD_LAND_PEOPLE = 150;
/** Years of population and believer counts kept for the trend chart. */
const HISTORY_YEARS = 200;
const NEW_TRIBE_MIN_YEAR = 25;
const NEW_TRIBE_CHANCE = 0.02;
/** New tribes appear at least this many hexes from anyone else. */
const NEW_TRIBE_DISTANCE = 8;

/** A notable event; `cell` is where it happened (-1 for none), so the player can jump there. */
export type ChronicleEntry = { tick: number; text: string; cell: number };

export type Simulation = {
  world: World;
  rng: Rng;
  /** Separate from `rng`, so picking colors doesn't change the world's history. */
  colorRng: Rng;
  tick: number;
  pop: Population;
  /** Index = civilization id; null for free slots. Index 0 is never used. */
  civs: (Civilization | null)[];
  /** Inhabitants per cell, kept exact on every birth, death and move. */
  cellPop: Int32Array;
  /** Civilization ids 0..civSlots-1 that `civs` and `cellCivPop` have room for (grows, see growCivSlots). */
  civSlots: number;
  /** Inhabitants per cell and civilization: cell * civSlots + civ. */
  cellCivPop: Int32Array;
  /** Food, water and space per hex in people: cell * SUPPLY_KINDS + kind (see supply.ts). */
  cellSupply: Float32Array;
  /** People a hex supports: its scarcest supply. */
  cellCapacity: Float32Array;
  /** Food, water and space per hex without its buildings, for planning them (see economy.ts). */
  baseSupply: Float32Array;
  /**
   * Changes to hexes' supplies from outside nature's defaults other than
   * buildings (abilities, depletion; none yet). Recompute supply after
   * changing them (updateCellSupply).
   */
  supplyModifiers: Map<number, SupplyModifier[]>;
  /** Wood and stone stock and buildings per hex (see buildings.ts). */
  economy: Economy;
  /** 1 for hexes that ever had a building (ruins stay forever), so the economy can skip the rest. */
  hasBuildings: Uint8Array;
  /** Satisfaction per settled hex, -100..100 (see satisfaction.ts). */
  satisfaction: Float32Array;
  /** Quarters in a row a settlement's satisfaction was below zero. */
  unhappyQuarters: Uint8Array;
  /** 1 once a settled hex has a satisfaction; a new settlement starts at its target. */
  moodSet: Uint8Array;
  /** Travel cost to the nearest seat of government of the hex's people, Infinity if none in reach. */
  seatCost: Float32Array;
  /** Merchants on their way and what settlements ask for and spare (see trade.ts). */
  trade: Trade;
  /** Inhabitants of 16 and older per hex, counted at every refresh (they earn money). */
  cellAdults: Int32Array;
  /** Notable events, oldest first. */
  chronicle: ChronicleEntry[];
  /** Groups that left unhappy settlements so far, and how many of them joined another people. */
  migrations: { groups: number; abroad: number };
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
    colorRng: createRng(deriveSeed(world.seed, 'civ-colors')),
    tick: 0,
    pop: createPopulation(1024),
    civs: new Array<Civilization | null>(INITIAL_CIV_SLOTS).fill(null),
    civSlots: INITIAL_CIV_SLOTS,
    cellPop: new Int32Array(n),
    cellCivPop: new Int32Array(n * INITIAL_CIV_SLOTS),
    cellSupply: new Float32Array(n * SUPPLY_KINDS),
    cellCapacity: new Float32Array(n),
    baseSupply: new Float32Array(n * SUPPLY_KINDS),
    supplyModifiers: new Map(),
    economy: createEconomy(n),
    hasBuildings: new Uint8Array(n),
    satisfaction: new Float32Array(n),
    unhappyQuarters: new Uint8Array(n),
    moodSet: new Uint8Array(n),
    seatCost: new Float32Array(n).fill(Infinity),
    trade: createTrade(world.seed, n),
    cellAdults: new Int32Array(n),
    chronicle: [],
    migrations: { groups: 0, abroad: 0 },
    believers: 0,
    history: { population: [], believers: [] },
    gameOver: false,
    snapshotVersion: 0,
  };
  computeCapacity(sim);

  const start = world.startCell;
  const tribe = foundCivilization(sim, 'start', start, null)!;
  tribe.worshipsPlayer = true;
  for (let i = 0; i < START_TRIBE_SIZE; i++) {
    addInhabitant(sim, start, tribe.id, 2 + Math.floor(sim.rng() * 36), 0.75 + 0.25 * sim.rng());
  }
  record(sim, `The ${tribe.name} settle in the ${biomeName(world, start)}. They pray to you.`, start);
  updateSatisfaction(sim, cellOwners(sim));
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
  // Every hex's economy runs once a quarter, a 13th of the hexes each week;
  // upkeep is due in the year's last quarter.
  const week = sim.tick - 1;
  advanceTrips(sim);
  for (let i = 0; i < sim.trade.supplyDirtyCount; i++) updateCellSupply(sim, sim.trade.supplyDirty[i]);
  sim.trade.supplyDirtyCount = 0;
  runEconomy(sim, Math.floor(week / REFRESH_TICKS) % 4 === 3, week % REFRESH_TICKS, REFRESH_TICKS);
  if (sim.tick % REFRESH_TICKS === 0) {
    expandSettlements(sim);
    const owner = cellOwners(sim);
    splitCutOffLand(sim, owner);
    updateSatisfaction(sim, owner);
    sumCivWants(sim, owner);
    emigrate(sim, owner);
    breakAway(sim, owner);
    if (yearEnd) planSeats(sim, owner);
    if (yearEnd && PROTO.capture) captureDeposits(sim, owner);
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
  sim.cellCivPop[cell * sim.civSlots + civ]++;
}

function removeInhabitant(sim: Simulation, i: number): void {
  const { pop } = sim;
  const cell = pop.cell[i];
  sim.cellPop[cell]--;
  sim.cellCivPop[cell * sim.civSlots + pop.civ[i]]--;
  releaseSlot(pop, i);
  pop.count--;
}

function moveInhabitant(sim: Simulation, i: number, to: number): void {
  const { pop } = sim;
  const from = pop.cell[i];
  const civ = pop.civ[i];
  sim.cellPop[from]--;
  sim.cellCivPop[from * sim.civSlots + civ]--;
  sim.cellPop[to]++;
  sim.cellCivPop[to * sim.civSlots + civ]++;
  pop.cell[i] = to;
}

function changeCiv(sim: Simulation, i: number, civ: number): void {
  const { pop } = sim;
  const cell = pop.cell[i];
  sim.cellCivPop[cell * sim.civSlots + pop.civ[i]]--;
  sim.cellCivPop[cell * sim.civSlots + civ]++;
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

  // Full birth rate up to half the hex's capacity, none once it is overfull;
  // satisfied settlements have more children, unhappy ones fewer.
  const birth = 0.17 * clamp((1.1 - crowding) / 0.6, 0, 1) * birthFactor(sim.satisfaction[cell]);
  if (age >= 16 && age <= 42 && rng() < birth) {
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
 * Buildings update their own hex (updateCellSupply).
 */
function computeCapacity(sim: Simulation): void {
  for (let c = 0; c < sim.world.cellCount; c++) updateCellSupply(sim, c);
}

/** How a hex's food, water and space come about, indexed by SupplyKind (see supply.ts), buildings included. */
export function hexSupplyTerms(sim: Simulation, cell: number): Term[][] {
  return supplyTerms(sim.world, cell, cellModifiers(sim, cell));
}

// ---------------------------------------------------------------------------
// Expansion

/**
 * Quarterly: every hex whose people need more than it provides sends a group
 * of EXPANSION_GROUP of the civilization living there to the best free
 * neighboring hex that can hold them (counting repairable ruins), and a road
 * links the two. The best hex has room, appeals to the people's culture and
 * yields building material. Without such a neighbor the people stay; they
 * build (see economy.ts), and shortage thins them out.
 */
function expandSettlements(sim: Simulation): void {
  const { world } = sim;
  // Overloaded hexes are few; find them once instead of once per people.
  const overloaded: number[] = [];
  for (let c = 0; c < world.cellCount; c++) if (sim.cellPop[c] > sim.cellCapacity[c]) overloaded.push(c);
  if (overloaded.length === 0) return;
  for (const civ of livingCivilizations(sim)) {
    const sources = overloaded.filter((c) => sim.cellCivPop[c * sim.civSlots + civ.id] > EXPANSION_GROUP);
    if (sources.length === 0) continue;
    // Most overloaded first, so it gets the pick of the free land.
    sources.sort((a, b) => sim.cellPop[b] - sim.cellCapacity[b] - (sim.cellPop[a] - sim.cellCapacity[a]));
    for (const source of sources) {
      let best = -1;
      let bestScore = -Infinity;
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const target = world.neighbors[source * DIRECTION_COUNT + d];
        if (target < 0 || !isSettlementTarget(sim, target)) continue;
        const step = stepCost(world, source, d);
        // Rather stop spreading than found a settlement that is unhappy from the start.
        if (PROTO.expandOnlyHappy && connectionValue(sim.seatCost[source] + step) < PROTO.expandMinConnection) continue;
        const score =
          capacityAfterRepair(sim, target) / GOOD_LAND_PEOPLE +
          terrainAppeal(world, civ.culture, target) +
          RAW_MATERIAL_APPEAL * rawMaterials(sim, target) +
          (SATISFACTION_APPEAL * connectionValue(sim.seatCost[source] + step)) / SATISFACTION_MAX -
          TRAVEL_EFFORT * step;
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

/**
 * Yearly, per people that lacks a luxury good whose deposit lies on free land
 * within PROTO.captureReach hexes: a group of PROTO.captureGroup from the
 * nearest settlement big enough (twice the group) moves one hex towards it,
 * with a road, over hexes that hold such a group. Year by year the people
 * reaches the deposit and builds its workshop there.
 */
function captureDeposits(sim: Simulation, owner: Uint8Array): void {
  const { world, economy } = sim;
  const n = world.cellCount;
  const group = PROTO.captureGroup;
  // The luxury goods each people makes (workshops standing or being built).
  const makes = new Uint8Array(sim.civSlots);
  for (let c = 0; c < n; c++) {
    if (!owner[c] || !sim.hasBuildings[c]) continue;
    for (let s = c * SLOTS, end = s + SLOTS; s < end; s++) {
      const st = economy.state[s];
      if (st === SlotState.Empty || st === SlotState.Ruin) continue;
      const good = BUILDINGS[economy.type[s]].good;
      if (isLuxury(good)) makes[owner[c]] |= 1 << (good - FIRST_LUXURY);
    }
  }
  const free = (c: number) => owner[c] === 0 && sim.cellPop[c] === 0 && !isWaterBiome(world.biome[c]) && sim.cellCapacity[c] >= group;
  const prev = new Int32Array(n).fill(-2);
  for (const civ of livingCivilizations(sim)) {
    // Breadth-first from the people's big enough settlements over free land.
    let frontier: number[] = [];
    const touched: number[] = [];
    for (let c = 0; c < n; c++) {
      if (owner[c] === civ.id && sim.cellCivPop[c * sim.civSlots + civ.id] >= 2 * group) {
        prev[c] = -1;
        touched.push(c);
        frontier.push(c);
      }
    }
    let found = -1;
    for (let step = 1; step <= PROTO.captureReach && found < 0 && frontier.length > 0; step++) {
      const next: number[] = [];
      for (const c of frontier) {
        for (let d = 0; d < DIRECTION_COUNT && found < 0; d++) {
          const nb = world.neighbors[c * DIRECTION_COUNT + d];
          if (nb < 0 || prev[nb] !== -2 || !free(nb)) continue;
          prev[nb] = c;
          touched.push(nb);
          const workshop = WORKSHOP_OF[world.deposit[nb]];
          if (workshop !== undefined && !(makes[civ.id] & (1 << (BUILDINGS[workshop].good - FIRST_LUXURY)))) found = nb;
          else next.push(nb);
        }
      }
      frontier = next;
    }
    if (found >= 0) {
      // The first hex on the way, and the settlement it starts from.
      let first = found;
      while (prev[prev[first]] !== -1) first = prev[first];
      const source = prev[first];
      const dir = world.neighbors.subarray(source * DIRECTION_COUNT, source * DIRECTION_COUNT + DIRECTION_COUNT).indexOf(first);
      moveGroup(sim, source, first, civ.id, group);
      addRoad(world, source, dir);
      owner[first] = civ.id;
      if (first === found) record(sim, `The ${civ.name} settled the ${GOOD_NAMES[BUILDINGS[WORKSHOP_OF[world.deposit[found]]].good].toLowerCase()} of the ${biomeName(world, found)}.`, found);
    }
    for (const c of touched) prev[c] = -2;
  }
}

/**
 * Quarterly: a people's hexes that are no longer connected to its capital by
 * roads through its own hexes (e.g. because a hex between them emptied and
 * was lost) found a new civilization, one per cut-off group. This ignores the
 * soft cap MAX_CIVS (only new tribes respect it). Its people keep 60 % of their faith and no
 * longer worship the player (design doc, section 5).
 */
function splitCutOffLand(sim: Simulation, owner: Uint8Array): void {
  const { world, pop } = sim;
  const n = world.cellCount;
  // Land is only cut off after a hex changed hands since the last snapshot
  // (`world.owner`); otherwise skip the search.
  let changed = false;
  for (let c = 0; c < n && !changed; c++) changed = owner[c] !== world.owner[c] && world.owner[c] !== 0;
  if (!changed) return;
  for (const parent of livingCivilizations(sim)) {
    if (owner[parent.capital] !== parent.id) {
      const capital = mostPopulousCell(sim, parent.id, null);
      if (capital < 0 || owner[capital] !== parent.id) continue;
      parent.capital = capital;
    }
    const group = new Int32Array(n).fill(-1);
    const connect = (start: number, id: number): number[] => {
      const cells = [start];
      group[start] = id;
      for (let k = 0; k < cells.length; k++) {
        const c = cells[k];
        for (let d = 0; d < DIRECTION_COUNT; d++) {
          if (!hasRoad(world, c, d)) continue;
          const nb = world.neighbors[c * DIRECTION_COUNT + d];
          if (nb >= 0 && group[nb] < 0 && owner[nb] === parent.id) {
            group[nb] = id;
            cells.push(nb);
          }
        }
      }
      return cells;
    };
    connect(parent.capital, 0);
    const cutOff: number[][] = [];
    for (let c = 0; c < n; c++) {
      if (owner[c] === parent.id && group[c] < 0) cutOff.push(connect(c, cutOff.length + 1));
    }
    // Largest groups first, while civilization slots last.
    const people = (cells: number[]) => cells.reduce((sum, c) => sum + sim.cellCivPop[c * sim.civSlots + parent.id], 0);
    cutOff.sort((a, b) => people(b) - people(a));
    for (const cells of cutOff) {
      const inGroup = new Uint8Array(n);
      for (const c of cells) inGroup[c] = 1;
      const capital = mostPopulousCell(sim, parent.id, inGroup);
      const civ = foundCivilization(sim, 'secession', capital, parent);
      if (!civ) break; // all civilization ids in use; try again next quarter
      for (let i = 0; i < pop.end; i++) {
        if (!pop.alive[i] || pop.civ[i] !== parent.id || !inGroup[pop.cell[i]]) continue;
        if (pop.faith[i] >= BELIEVER_FAITH) parent.faithYear.brokeAway++;
        changeCiv(sim, i, civ.id);
        pop.faith[i] *= 0.6;
      }
      for (const c of cells) owner[c] = civ.id;
      record(sim, `The ${civ.name} in the ${biomeName(world, capital)}, cut off from the ${parent.name}, became their own people.`, capital);
    }
  }
}

/**
 * Moves `count` people of a civilization from one hex to another; settling
 * with another people (`joinCiv`) makes them part of it, faith unchanged.
 */
function moveGroup(sim: Simulation, from: number, to: number, civId: number, count: number, joinCiv = civId): void {
  const { pop } = sim;
  let moved = 0;
  for (let i = 0; i < pop.end && moved < count; i++) {
    if (pop.alive[i] && pop.cell[i] === from && pop.civ[i] === civId) {
      moveInhabitant(sim, i, to);
      if (joinCiv !== civId) {
        if (pop.faith[i] >= BELIEVER_FAITH) {
          sim.civs[civId]!.faithYear.emigrated++;
          sim.civs[joinCiv]!.faithYear.immigrated++;
        }
        changeCiv(sim, i, joinCiv);
      }
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
  const believers = new Int32Array(sim.civSlots);
  const civFaithSum = new Float64Array(sim.civSlots);
  sim.cellAdults.fill(0);
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i]) continue;
    if (pop.age[i] >= ADULT_AGE) sim.cellAdults[pop.cell[i]]++;
    faithSum[pop.cell[i]] += pop.faith[i];
    civFaithSum[pop.civ[i]] += pop.faith[i];
    if (pop.faith[i] >= BELIEVER_FAITH) believers[pop.civ[i]]++;
  }

  const civPop = new Int32Array(sim.civSlots);
  const territory = new Int32Array(sim.civSlots);
  for (let c = 0; c < world.cellCount; c++) {
    const people = sim.cellPop[c];
    world.population[c] = people;
    world.faith[c] = people > 0 ? faithSum[c] / people : 0;
    let owner = 0;
    let most = 0;
    for (let id = 1; id < sim.civSlots; id++) {
      const n = sim.cellCivPop[c * sim.civSlots + id];
      civPop[id] += n;
      if (n > most) {
        most = n;
        owner = id;
      }
    }
    world.owner[c] = owner;
    if (owner) territory[owner]++;
    if (sim.hasBuildings[c]) {
      world.buildings[c] = countSlots(sim.economy, c, SlotState.Standing);
      world.ruins[c] = countSlots(sim.economy, c, SlotState.Ruin) + countSlots(sim.economy, c, SlotState.Repair);
      world.harbors[c] = sim.trade.harbor[c];
    }
  }

  sim.believers = 0;
  for (let id = 1; id < sim.civSlots; id++) {
    const civ = sim.civs[id];
    if (!civ) continue;
    civ.population = civPop[id];
    civ.territory = territory[id];
    civ.believers = believers[id];
    civ.averageFaith = civ.population > 0 ? civFaithSum[id] / civ.population : 0;
    sim.believers += believers[id];
    if (civ.population === 0) {
      record(sim, `The ${civ.name} have vanished.`, civ.capital);
      sim.civs[id] = null;
      continue;
    }
    if (sim.cellCivPop[civ.capital * sim.civSlots + id] === 0) civ.capital = mostPopulousCell(sim, id, null);
  }

  if (sim.believers === 0) {
    sim.gameOver = true;
    record(sim, 'Nobody prays to you anymore.', -1);
  }
  sim.snapshotVersion++;
}

function mostPopulousCell(sim: Simulation, civId: number, allowed: Uint8Array | null): number {
  let best = -1;
  let most = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (allowed && !allowed[c]) continue;
    const n = sim.cellCivPop[c * sim.civSlots + civId];
    if (n > most) {
      most = n;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Civilizations

/** Yearly: culture drift, fading moods and new tribes (new seats of government: see stepSimulation). */
function updateCivilizations(sim: Simulation): void {
  const target = new Float32Array(CULTURE_COUNT);
  for (const civ of livingCivilizations(sim)) {
    pruneMoods(civ, sim.tick);
    const { cells, weights } = civCells(sim, civ.id);
    if (cells.length === 0) continue;
    landCulture(sim.world, cells, weights, target);
    driftCulture(civ.culture, target);
  }
  tryNewTribe(sim);
}

function civCells(sim: Simulation, civId: number): { cells: number[]; weights: number[] } {
  const cells: number[] = [];
  const weights: number[] = [];
  for (let c = 0; c < sim.world.cellCount; c++) {
    const n = sim.cellCivPop[c * sim.civSlots + civId];
    if (n > 0) {
      cells.push(c);
      weights.push(n);
    }
  }
  return { cells, weights };
}

// ---------------------------------------------------------------------------
// Satisfaction: migration and breakaway

/**
 * Quarterly: an unhappy settlement sends a group of EXPANSION_GROUP people
 * away, with a yearly chance that grows with its unhappiness (certain at
 * -100), as long as some of its people stay. They go to the best of: a free
 * neighboring hex (a road is built), or a settlement of any people reachable
 * by road within MIGRATION_REACH that has room and is clearly more
 * satisfied. Settling with another people makes them part of it; their faith
 * stays as it is.
 */
function emigrate(sim: Simulation, owner: Uint8Array): void {
  const { world, rng } = sim;
  for (let c = 0; c < world.cellCount; c++) {
    const mood = sim.satisfaction[c];
    const civId = owner[c];
    if (mood >= 0 || civId === 0 || sim.cellCivPop[c * sim.civSlots + civId] <= EXPANSION_GROUP) continue;
    if (rng() >= -mood / SATISFACTION_MAX / 4) continue;
    const target = migrationTarget(sim, owner, c, civId);
    if (target < 0) continue;
    const dir = neighborDirection(world, c, target);
    if (sim.cellPop[target] === 0 && dir >= 0) addRoad(world, c, dir);
    moveGroup(sim, c, target, civId, EXPANSION_GROUP, owner[target] || civId);
    sim.migrations.groups++;
    if (owner[target] && owner[target] !== civId) sim.migrations.abroad++;
  }
}

/** Travel cost along roads from the source, reset for every search (see migrationTarget). */
let roadCost = new Float32Array(0);
const roadHeap = new MinHeap(64);
const roadTouched: number[] = [];

/** Where an unhappy settlement's group goes, or -1 if nowhere is clearly better. */
function migrationTarget(sim: Simulation, owner: Uint8Array, source: number, civId: number): number {
  const { world } = sim;
  const mood = sim.satisfaction[source];
  let best = -1;
  let bestScore = -Infinity;

  // Free land next door, valued by the connection it would have.
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = world.neighbors[source * DIRECTION_COUNT + d];
    if (nb < 0 || !isSettlementTarget(sim, nb)) continue;
    const step = stepCost(world, source, d);
    const promise = connectionValue(sim.seatCost[source] + step);
    if (promise < mood + MIGRATION_MIN_GAIN) continue;
    const score = promise / SATISFACTION_MAX + capacityAfterRepair(sim, nb) / GOOD_LAND_PEOPLE - TRAVEL_EFFORT * step;
    if (score > bestScore) {
      bestScore = score;
      best = nb;
    }
  }

  // Settlements of any people along the roads.
  if (roadCost.length !== world.cellCount) roadCost = new Float32Array(world.cellCount).fill(Infinity);
  roadCost[source] = 0;
  roadTouched.push(source);
  roadHeap.push(source, 0);
  while (roadHeap.size > 0) {
    const c = roadHeap.pop();
    const here = roadCost[c];
    if (c !== source && sim.cellPop[c] > 0 && owner[c] !== 0) {
      const room = sim.cellCapacity[c] - sim.cellPop[c];
      if (room >= EXPANSION_GROUP && sim.satisfaction[c] >= mood + MIGRATION_MIN_GAIN) {
        const score = sim.satisfaction[c] / SATISFACTION_MAX + room / GOOD_LAND_PEOPLE - TRAVEL_EFFORT * here;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      if (!hasRoad(world, c, d)) continue;
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0) continue;
      const next = here + stepCost(world, c, d);
      if (next < roadCost[nb] && next <= MIGRATION_REACH) {
        if (roadCost[nb] === Infinity) roadTouched.push(nb);
        roadCost[nb] = next;
        roadHeap.push(nb, next);
      }
    }
  }
  for (const c of roadTouched) roadCost[c] = Infinity;
  roadTouched.length = 0;
  return best;
}

function neighborDirection(world: World, cell: number, other: number): number {
  for (let d = 0; d < DIRECTION_COUNT; d++) if (world.neighbors[cell * DIRECTION_COUNT + d] === other) return d;
  return -1;
}

/**
 * Quarterly: settlements below zero for UNHAPPY_QUARTERS in a row (never a
 * capital) that are joined by roads form leagues; a league with at least
 * LEAGUE_MIN_SETTLEMENTS settlements or LEAGUE_MIN_PEOPLE people breaks away
 * as a new people. Its capital is its most populous seat of government, else
 * its most populous settlement. Faith stays as it is; the new people starts
 * proud of its revolution, the old one is shaken. Satisfied settlements stay
 * with their people, and a lone unhappy settlement only loses people.
 */
function breakAway(sim: Simulation, owner: Uint8Array): void {
  const { world, pop } = sim;
  const n = world.cellCount;
  const ready = UNHAPPY_QUARTERS;
  // Settlements ready to break away (never a capital), by people.
  const byCiv = new Map<number, number[]>();
  for (let c = 0; c < n; c++) {
    if (sim.unhappyQuarters[c] < ready || owner[c] === 0 || sim.civs[owner[c]]?.capital === c) continue;
    const list = byCiv.get(owner[c]);
    if (list) list.push(c);
    else byCiv.set(owner[c], [c]);
  }
  if (byCiv.size === 0) return;
  const league = new Int32Array(n).fill(-1);
  for (const [parentId, restlessCells] of byCiv) {
    const parent = sim.civs[parentId]!;
    const restless = (c: number) => owner[c] === parentId && sim.unhappyQuarters[c] >= ready && c !== parent.capital;
    const leagues: number[][] = [];
    for (const start of restlessCells) {
      if (league[start] >= 0) continue;
      const cells = [start];
      league[start] = leagues.length;
      for (let k = 0; k < cells.length; k++) {
        const c = cells[k];
        for (let d = 0; d < DIRECTION_COUNT; d++) {
          if (!hasRoad(world, c, d)) continue;
          const nb = world.neighbors[c * DIRECTION_COUNT + d];
          if (nb < 0 || league[nb] >= 0 || !restless(nb)) continue;
          league[nb] = leagues.length;
          cells.push(nb);
        }
      }
      leagues.push(cells);
    }
    for (const cells of leagues) {
      const people = cells.reduce((sum, c) => sum + sim.cellCivPop[c * sim.civSlots + parent.id], 0);
      if (cells.length < LEAGUE_MIN_SETTLEMENTS && people < LEAGUE_MIN_PEOPLE) continue;
      const inLeague = new Uint8Array(n);
      for (const c of cells) inLeague[c] = 1;
      let capital = -1;
      for (const c of cells) {
        if (hasSeat(sim.economy, c) && (capital < 0 || sim.cellPop[c] > sim.cellPop[capital])) capital = c;
      }
      if (capital < 0) capital = mostPopulousCell(sim, parent.id, inLeague);
      const civ = foundCivilization(sim, 'revolution', capital, parent);
      if (!civ) return; // all civilization ids in use; try again next quarter
      for (let i = 0; i < pop.end; i++) {
        if (!pop.alive[i] || pop.civ[i] !== parent.id || !inLeague[pop.cell[i]]) continue;
        if (pop.faith[i] >= BELIEVER_FAITH) parent.faithYear.brokeAway++;
        changeCiv(sim, i, civ.id);
      }
      for (const c of cells) {
        sim.unhappyQuarters[c] = 0;
        owner[c] = civ.id;
      }
      addMood(civ, 'Won its revolution', MOOD_REVOLUTION_WON, sim.tick);
      addMood(parent, 'Lost a revolution', MOOD_REVOLUTION_LOST, sim.tick);
      const who = cells.length === 1 ? 'A settlement' : `${cells.length} settlements`;
      record(sim, `${who} in the ${biomeName(world, capital)} rose up against the ${parent.name} and became the ${civ.name}.`, capital);
    }
  }
}

/** Occasionally a new people appears in empty, livable land far from everyone. */
function tryNewTribe(sim: Simulation): void {
  const { world, rng } = sim;
  if (simulationYear(sim) < NEW_TRIBE_MIN_YEAR || livingCivilizations(sim).length >= MAX_CIVS) return;
  if (rng() >= NEW_TRIBE_CHANCE) return;

  const settled: number[] = [];
  for (let c = 0; c < world.cellCount; c++) if (sim.cellPop[c] > 0) settled.push(c);
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
  if (!civ) return;
  const size = 15 + Math.floor(rng() * 10);
  for (let i = 0; i < size; i++) addInhabitant(sim, best, civ.id, 2 + Math.floor(rng() * 36), rng() * 0.1);
  record(sim, `A new people, the ${civ.name}, appeared in the ${biomeName(world, best)}.`, best);
}

/**
 * Creates a civilization in a free slot. Its culture comes from the land
 * around its capital; a breakaway starts halfway between that and its
 * parent's culture.
 */
function foundCivilization(
  sim: Simulation,
  origin: CivOrigin,
  capital: number,
  parent: Civilization | null,
): Civilization | null {
  const { world, rng } = sim;
  const living = livingCivilizations(sim);
  let id = sim.civs.indexOf(null, 1);
  if (id < 0 && sim.civSlots <= MAX_CIV_ID) {
    growCivSlots(sim);
    id = sim.civs.indexOf(null, 1);
  }
  if (id < 0) return null;
  const color = pickCivColor(sim.colorRng, living.map((c) => c.color));
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
  addMood(civ, 'A new people', MOOD_NEW_PEOPLE, sim.tick);
  sim.civs[id] = civ;
  return civ;
}

/**
 * Doubles the room for civilization ids (up to MAX_CIV_ID): `civs` gets free
 * slots and `cellCivPop` is copied into a wider layout. Rare, so the copy is fine.
 */
function growCivSlots(sim: Simulation): void {
  const old = sim.civSlots;
  const slots = Math.min(old * 2, MAX_CIV_ID + 1);
  const n = sim.world.cellCount;
  const cellCivPop = new Int32Array(n * slots);
  for (let c = 0; c < n; c++) cellCivPop.set(sim.cellCivPop.subarray(c * old, (c + 1) * old), c * slots);
  sim.cellCivPop = cellCivPop;
  for (let id = old; id < slots; id++) sim.civs.push(null);
  sim.civSlots = slots;
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

function record(sim: Simulation, text: string, cell: number): void {
  sim.chronicle.push({ tick: sim.tick, text, cell });
}

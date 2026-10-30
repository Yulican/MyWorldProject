import { DIRECTION_COUNT } from '../hex';
import { MinHeap } from '../minHeap';
import { createRng, deriveSeed, type Rng } from '../rng';
import { isWaterBiome } from '../world/biomes';
import { addRoad, hasRoad, oppositeDirection, ROAD_TRAVEL_FACTOR } from '../world/roads';
import type { World } from '../world/world';
import { BUILDINGS, Good, LUXURY_COUNT, MATERIAL_COUNT, SLOTS, SlotState, type Economy } from './buildings';
import { LUXURY_PER_PERSON } from './satisfaction';
import type { Simulation } from './simulation';
import { SUPPLY_KINDS, SupplyKind, type SupplyModifier } from './supply';

// Internal trade (design doc, section 5; agreed requirement: "Design
// Documents/Requirement Handel.md"). Settlements with a trade center or a
// harbor send merchants with what they can spare to settlements of their own
// people that need it, paid in money, and bring back what home needs.
// Merchants only travel on ways: roads, rivers (and their banks) and the
// water between two harbors. Part of a load can get lost on the way.
// Merchants are trips, not inhabitants: flat arrays, no per-tick movement.

/** Goods merchants carry, as indexed in Trade's per-cell arrays. Luxury goods follow from TradeGood.Luxury on. */
export const TradeGood = { Wood: 0, Stone: 1, Money: 2, Grain: 3, Water: 4, Luxury: 5 } as const;
export const TRADE_GOODS = 5 + LUXURY_COUNT;
export const TRADE_GOOD_NAMES = ['Wood', 'Stone', 'Money', 'Grain', 'Water', 'Salt', 'Spices', 'Gems', 'Gold', 'Marble', 'Horses'] as const;
/** Weight of one unit; a merchant carries MERCHANT_LOAD. */
const WEIGHT = [1, 1.5, 0.1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
/** Money one unit costs. */
const PRICE = [1, 1.5, 1, 1, 1, 5, 5, 5, 5, 5, 5];
export const MERCHANT_LOAD = 20;
/** Money every adult earns per year. */
export const MONEY_PER_ADULT = 0.1;
/** Merchants go at most this far (travel cost, about weeks) one way. */
const MAX_TRIP_COST = 26;
/** Weeks per unit of travel cost (plains = 1). */
const WEEKS_PER_COST = 1;
/** Travel cost factors on ways: downstream, upstream, from a bank onto the river (and back), on water per hex. */
const RIVER_DOWN = 0.25;
const RIVER_UP = 0.75;
const RIVER_BANK = ROAD_TRAVEL_FACTOR;
const SEA_STEP = 1;
/** A sea route crosses at most this many water hexes. */
const MAX_SEA_HEXES = 12;
/** Chance per hex entered to lose LOSS_SHARE of the load: on land, on water, plus the hex's danger times LOSS_DANGER. */
const LOSS_LAND = 0.02;
const LOSS_WATER = 0.06;
const LOSS_DANGER = 0.04;
const LOSS_SHARE = 0.25;
/** A trip must be worth this much money (goods both ways) to go. */
const MIN_TRIP_VALUE = 5;
/** Wood and stone a settlement keeps for this many years of upkeep before it sells. */
const RESERVE_YEARS = 2;
const RESERVE_MIN = 10;
/** Luxury goods a settlement keeps (and asks for): this many years of its need. */
const LUXURY_YEARS = 2;
/** Grain or water in stock counts as supply up to this many people. */
export const PROVISIONS_MAX = 50;
/** A road segment costs this much wood and stone times the terrain's travel cost. */
const ROAD_WOOD = 3;
const ROAD_STONE = 3;
/** A road is built when it makes the way to the last partner this much shorter. */
const ROAD_SAVING = 0.25;
/**
 * Way searches per week at most (trips, roads, trade buildings): hexes over
 * budget try again next quarter, so no single tick gets long.
 */
const SEARCHES_PER_TICK = 3;
/** Years before a partner without a worthwhile road is checked again. */
const ROAD_RECHECK_YEARS = 4;
/** A trade center needs a trip worth this much (money) in reach. */
const CENTER_MIN_VALUE = 15;

/** Merchants on their way, as flat arrays per trip slot. */
export type Trade = {
  rng: Rng;
  /** What a settlement asks for and can spare: cell * TRADE_GOODS + good. */
  want: Float32Array;
  surplus: Float32Array;
  /** Ordered and on its way: cell * TRADE_GOODS + good. */
  incoming: Float32Array;
  /** Merchants per hex from its standing trade buildings, and how many are away. */
  merchants: Uint8Array;
  away: Uint8Array;
  /** 1 for hexes with a standing harbor. */
  harbor: Uint8Array;
  /** 1 for settlements with something to sell, or something to buy and money: only they look for trips. */
  interest: Uint8Array;
  /** Hexes whose grain or water stock merchants changed this tick; their supply needs recomputing. */
  supplyDirty: Int32Array;
  supplyDirtyCount: number;
  /** Way searches left this tick (see SEARCHES_PER_TICK), and the tick they count for. */
  searchesLeft: number;
  searchTick: number;
  /** The partner a hex last checked a trade road to, and the year it did (-1 = never). */
  roadChecked: Int32Array;
  roadYear: Int32Array;
  /** The settlement the hex's merchants traded with last, -1 = none (roads lead there). */
  partner: Int32Array;
  /** What each people asks for and can spare in total (civ * TRADE_GOODS + good), from the last refresh. */
  civWant: Float32Array;
  civSpare: Float32Array;
  /** Grain and water barrels each people's buildings make per year (civ * 2 + 0 grain / 1 water), standing or being built. */
  civMake: Float32Array;
  // Trips: home, target, arrival tick, leg (0 free, 1 out, 2 back), travel time,
  // cargo per good, and the share of each leg's load that arrives.
  tripHome: Int32Array;
  tripTarget: Int32Array;
  tripArrive: Int32Array;
  tripLeg: Uint8Array;
  tripWeeks: Int32Array;
  tripCargo: Float32Array;
  /** What the merchant is to buy for home at the target (units per good). */
  tripBuy: Float32Array;
  tripKeepOut: Float32Array;
  tripKeepBack: Float32Array;
  tripEnd: number;
  /** Totals since the start, for the hex info and tests: delivered and lost per good, trips and road segments. */
  delivered: Float64Array;
  lost: Float64Array;
  trips: number;
  roads: number;
};

export function createTrade(seed: number, cellCount: number): Trade {
  const trips = 64;
  return {
    rng: createRng(deriveSeed(seed, 'trade')),
    want: new Float32Array(cellCount * TRADE_GOODS),
    surplus: new Float32Array(cellCount * TRADE_GOODS),
    incoming: new Float32Array(cellCount * TRADE_GOODS),
    merchants: new Uint8Array(cellCount),
    away: new Uint8Array(cellCount),
    harbor: new Uint8Array(cellCount),
    interest: new Uint8Array(cellCount),
    supplyDirty: new Int32Array(16),
    supplyDirtyCount: 0,
    searchesLeft: 0,
    searchTick: -1,
    roadChecked: new Int32Array(cellCount).fill(-1),
    roadYear: new Int32Array(cellCount).fill(-1),
    partner: new Int32Array(cellCount).fill(-1),
    civWant: new Float32Array(0),
    civSpare: new Float32Array(0),
    civMake: new Float32Array(0),
    tripHome: new Int32Array(trips),
    tripTarget: new Int32Array(trips),
    tripArrive: new Int32Array(trips),
    tripLeg: new Uint8Array(trips),
    tripWeeks: new Int32Array(trips),
    tripCargo: new Float32Array(trips * TRADE_GOODS),
    tripBuy: new Float32Array(trips * TRADE_GOODS),
    tripKeepOut: new Float32Array(trips),
    tripKeepBack: new Float32Array(trips),
    tripEnd: 0,
    delivered: new Float64Array(TRADE_GOODS),
    lost: new Float64Array(TRADE_GOODS),
    trips: 0,
    roads: 0,
  };
}

// ---------------------------------------------------------------------------
// Stock

/** A hex's stock of a trade good. */
export function stockOf(eco: Economy, cell: number, good: number): number {
  if (good <= TradeGood.Stone) return eco.stock[cell * MATERIAL_COUNT + good];
  if (good === TradeGood.Money) return eco.money[cell];
  if (good <= TradeGood.Water) return eco.provisions[cell * 2 + good - TradeGood.Grain];
  return eco.luxury[cell * LUXURY_COUNT + good - TradeGood.Luxury];
}

export function addStock(eco: Economy, cell: number, good: number, amount: number): void {
  if (good <= TradeGood.Stone) eco.stock[cell * MATERIAL_COUNT + good] += amount;
  else if (good === TradeGood.Money) eco.money[cell] += amount;
  else if (good <= TradeGood.Water) eco.provisions[cell * 2 + good - TradeGood.Grain] += amount;
  else eco.luxury[cell * LUXURY_COUNT + good - TradeGood.Luxury] += amount;
}

/** Grain and water in stock as food and water supply (up to PROVISIONS_MAX people). */
export function provisionModifiers(eco: Economy, cell: number): SupplyModifier[] {
  const grain = eco.provisions[cell * 2];
  const water = eco.provisions[cell * 2 + 1];
  const mods: SupplyModifier[] = [];
  if (grain > 0) mods.push({ kind: SupplyKind.Food, label: 'Grain in stock', amount: Math.min(grain, PROVISIONS_MAX) });
  if (water > 0) mods.push({ kind: SupplyKind.Water, label: 'Water barrels in stock', amount: Math.min(water, PROVISIONS_MAX) });
  return mods;
}

/** The trade buildings' merchants and harbor of a hex, from its standing buildings. */
export function updateTradeBuildings(sim: Simulation, cell: number): void {
  const { economy, trade } = sim;
  let merchants = 0;
  let harbor = 0;
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (economy.state[s] !== SlotState.Standing) continue;
    const b = BUILDINGS[economy.type[s]];
    if (b.good === Good.Merchants || b.good === Good.Harbor) merchants += b.amount;
    if (b.good === Good.Harbor) harbor = 1;
  }
  trade.merchants[cell] = merchants;
  trade.harbor[cell] = harbor;
}

/**
 * Quarterly per settled hex: money from its adults; at the year's end its
 * people eat and drink what they lack from the grain and water in stock;
 * then what it asks for and can spare. Returns whether its supply changed.
 */
export function updateTradeNeeds(sim: Simulation, cell: number, adults: number, yearEnd: boolean, stepsPerYear: number): boolean {
  const { economy, trade } = sim;
  const people = sim.cellPop[cell];
  economy.money[cell] += (adults * MONEY_PER_ADULT) / stepsPerYear;
  let changed = false;
  const base = cell * SUPPLY_KINDS;
  if (yearEnd) {
    for (let k = 0; k < 2; k++) {
      const i = cell * 2 + k;
      if (economy.provisions[i] <= 0) continue;
      const own = sim.cellSupply[base + k] - Math.min(economy.provisions[i], PROVISIONS_MAX);
      const eat = Math.min(economy.provisions[i], Math.max(0, people - own));
      if (eat > 0) {
        economy.provisions[i] -= eat;
        changed = true;
      }
    }
  }
  const t = cell * TRADE_GOODS;
  trade.want.fill(0, t, t + TRADE_GOODS);
  trade.surplus.fill(0, t, t + TRADE_GOODS);
  trade.interest[cell] = 0;
  if (people === 0) return changed;

  // Wood and stone: ask for what the next building lacks, spare what is
  // beyond it and a reserve for upkeep.
  for (let m = 0; m < MATERIAL_COUNT; m++) {
    const stock = economy.stock[cell * MATERIAL_COUNT + m];
    const goal = economy.goal[cell * MATERIAL_COUNT + m];
    const reserve = Math.max(RESERVE_MIN, RESERVE_YEARS * upkeepOf(economy, cell, m));
    trade.want[t + m] = Math.max(0, goal - stock - trade.incoming[t + m]);
    trade.surplus[t + m] = Math.max(0, stock - goal - reserve);
  }

  // Grain and water: ask when it is the scarcest supply of a hex half full,
  // up to the next limit; spare what its own people don't need.
  const capacity = sim.cellCapacity[cell];
  for (let k = 0; k < 2; k++) {
    const g = TradeGood.Grain + k;
    const stock = economy.provisions[cell * 2 + k];
    const supply = sim.cellSupply[base + k];
    const own = supply - Math.min(stock, PROVISIONS_MAX);
    trade.surplus[t + g] = Math.max(0, stock - Math.max(0, people - own));
    if (supply > capacity + 0.01 || people < 0.5 * capacity) continue;
    let next = Infinity;
    for (let j = 0; j < SUPPLY_KINDS; j++) if (j !== k) next = Math.min(next, sim.cellSupply[base + j]);
    const room = Math.min(PROVISIONS_MAX - Math.min(stock, PROVISIONS_MAX), next - supply);
    trade.want[t + g] = Math.max(0, room - trade.incoming[t + g]);
  }

  // Luxury goods: keep and ask for LUXURY_YEARS of the people's need of each.
  const keep = people * LUXURY_PER_PERSON * LUXURY_YEARS;
  for (let k = 0; k < LUXURY_COUNT; k++) {
    const g = TradeGood.Luxury + k;
    const stock = economy.luxury[cell * LUXURY_COUNT + k];
    trade.want[t + g] = Math.max(0, keep - stock - trade.incoming[t + g]);
    trade.surplus[t + g] = Math.max(0, stock - keep);
  }
  // Only goods the rest of its people ask for or spare count (totals from the last refresh).
  const civ = sim.world.owner[cell];
  const c = civ * TRADE_GOODS;
  const known = c + TRADE_GOODS <= trade.civWant.length;
  let sell = 0;
  let buy = 0;
  for (let g = 0; g < TRADE_GOODS; g++) {
    if (!known) break;
    const othersWant = trade.civWant[c + g] - trade.want[t + g];
    const othersSpare = trade.civSpare[c + g] - trade.surplus[t + g];
    if (othersWant > 0) sell += Math.min(trade.surplus[t + g], othersWant) * PRICE[g];
    if (othersSpare > 0) buy += Math.min(trade.want[t + g], othersSpare) * PRICE[g];
  }
  trade.interest[cell] = sell >= MIN_TRIP_VALUE || (buy >= MIN_TRIP_VALUE && economy.money[cell] >= MIN_TRIP_VALUE) ? 1 : 0;
  return changed;
}

function upkeepOf(eco: Economy, cell: number, material: number): number {
  let sum = 0;
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (eco.state[s] !== SlotState.Standing) continue;
    const b = BUILDINGS[eco.type[s]];
    sum += material === 0 ? b.upkeepWood : b.upkeepStone;
  }
  return sum;
}

/**
 * Quarterly: what each people asks for and can spare in total, and the
 * grain and barrels its buildings make, so settlements know whether making
 * more pays.
 */
export function sumCivWants(sim: Simulation, owner: Uint8Array): void {
  const { trade, economy } = sim;
  const size = sim.civSlots * TRADE_GOODS;
  if (trade.civWant.length !== size) {
    trade.civWant = new Float32Array(size);
    trade.civSpare = new Float32Array(size);
    trade.civMake = new Float32Array(sim.civSlots * 2);
  } else {
    trade.civWant.fill(0);
    trade.civSpare.fill(0);
    trade.civMake.fill(0);
  }
  for (let c = 0; c < owner.length; c++) {
    const id = owner[c];
    if (!id || sim.cellPop[c] === 0) continue;
    for (let g = 0; g < TRADE_GOODS; g++) {
      trade.civWant[id * TRADE_GOODS + g] += trade.want[c * TRADE_GOODS + g];
      trade.civSpare[id * TRADE_GOODS + g] += trade.surplus[c * TRADE_GOODS + g];
    }
    if (!sim.hasBuildings[c]) continue;
    for (let s = c * SLOTS, end = s + SLOTS; s < end; s++) {
      const st = economy.state[s];
      if (st !== SlotState.Standing && st !== SlotState.Construction && st !== SlotState.Repair) continue;
      const b = BUILDINGS[economy.type[s]];
      if (b.good === Good.Grain) trade.civMake[id * 2] += b.amount;
      else if (b.good === Good.Barrels) trade.civMake[id * 2 + 1] += b.amount;
    }
  }
}

// ---------------------------------------------------------------------------
// Ways

/** Takes `count` way searches from this tick's budget; false when it is used up. */
function takeSearches(sim: Simulation, count: number): boolean {
  const { trade } = sim;
  if (trade.searchTick !== sim.tick) {
    trade.searchTick = sim.tick;
    trade.searchesLeft = SEARCHES_PER_TICK;
  }
  if (trade.searchesLeft < count) return false;
  trade.searchesLeft -= count;
  return true;
}

/** 1 for water hexes of the world last searched (a lookup is cheaper than the biome table). */
let waterOf = new Uint8Array(0);
let waterWorld: World | null = null;
function water(world: World): Uint8Array {
  if (waterWorld !== world) {
    waterOf = new Uint8Array(world.cellCount);
    for (let c = 0; c < world.cellCount; c++) waterOf[c] = isWaterBiome(world.biome[c]) ? 1 : 0;
    waterWorld = world;
  }
  return waterOf;
}

let wayCost = new Float32Array(0);
let wayPrev = new Int32Array(0);
let waySea = new Uint8Array(0);
const wayHeap = new MinHeap(256);
const wayReached: number[] = [];

/**
 * Whether a hex counts as a harbor: a standing one, or with `assume` >= 0
 * (planning a harbor there) also that hex and every coastal settlement of
 * the people.
 */
function isHarbor(sim: Simulation, owner: Uint8Array, civ: number, assume: number, cell: number): boolean {
  if (sim.trade.harbor[cell] === 1) return true;
  if (assume < 0) return false;
  return cell === assume || (owner[cell] === civ && sim.cellPop[cell] > 0 && isCoast(sim.world, cell));
}

/**
 * Cost of a merchant's step from `cell` to its neighbor in direction `dir`
 * for the people `civ`, Infinity if there is no way: roads, rivers along
 * their course (down faster than up) and from either bank, water from and
 * to a harbor of the people (see isHarbor for `assume`).
 * Merchants never enter another people's land.
 */
function wayStep(sim: Simulation, owner: Uint8Array, civ: number, assume: number, cell: number, dir: number): number {
  const { world } = sim;
  const nb = world.neighbors[cell * DIRECTION_COUNT + dir];
  if (nb < 0) return Infinity;
  const wet = water(world);
  const fromWater = wet[cell] === 1;
  const toWater = wet[nb] === 1;
  if (toWater) return fromWater || isHarbor(sim, owner, civ, assume, cell) ? SEA_STEP : Infinity;
  if (owner[nb] !== civ && owner[nb] !== 0) return Infinity;
  if (fromWater) return owner[nb] === civ && isHarbor(sim, owner, civ, assume, nb) ? SEA_STEP : Infinity;
  const terrain = (world.moveCost[cell] + world.moveCost[nb]) / 2;
  let factor = Infinity;
  if (hasRoad(world, cell, dir)) factor = ROAD_TRAVEL_FACTOR;
  const riverHere = world.riverFlow[cell] > 0;
  const riverThere = world.riverFlow[nb] > 0;
  if (riverHere && world.riverDir[cell] === dir) factor = Math.min(factor, RIVER_DOWN);
  else if (riverThere && world.riverDir[nb] === oppositeDirection(dir)) factor = Math.min(factor, RIVER_UP);
  else if (riverHere !== riverThere) factor = Math.min(factor, RIVER_BANK);
  return terrain * factor;
}

/**
 * Cheapest ways from `from` for its people (Dijkstra), up to `maxCost`.
 * Fills the module's cost and predecessor arrays; returns the hexes
 * reached. Call resetWays() when done.
 */
function searchWays(sim: Simulation, owner: Uint8Array, from: number, maxCost: number, assume: number): number[] {
  const { world } = sim;
  const n = world.cellCount;
  if (wayCost.length !== n) {
    wayCost = new Float32Array(n).fill(Infinity);
    wayPrev = new Int32Array(n).fill(-1);
    waySea = new Uint8Array(n);
  }
  const civ = owner[from];
  wayReached.length = 0;
  wayCost[from] = 0;
  wayReached.push(from);
  wayHeap.push(from, 0);
  while (wayHeap.size > 0) {
    const c = wayHeap.pop();
    const here = wayCost[c];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const step = wayStep(sim, owner, civ, assume, c, d);
      if (step === Infinity) continue;
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      const sea = waterOf[nb] === 1 ? waySea[c] + 1 : 0;
      if (sea > MAX_SEA_HEXES) continue;
      const next = here + step;
      if (next >= wayCost[nb] || next > maxCost) continue;
      if (wayCost[nb] === Infinity) wayReached.push(nb);
      wayCost[nb] = next;
      wayPrev[nb] = c;
      waySea[nb] = sea;
      wayHeap.push(nb, next);
    }
  }
  return wayReached;
}

function resetWays(): void {
  for (const c of wayReached) {
    wayCost[c] = Infinity;
    wayPrev[c] = -1;
    waySea[c] = 0;
  }
  wayReached.length = 0;
}

/** Share of a load that survives the way to `to` (from the last search), rolling the loss of every hex entered. */
function rollKeep(sim: Simulation, to: number, from: number, back: boolean): number {
  const { world, trade } = sim;
  let keep = 1;
  // Walk the path from `to` back to the start; on the way back the hexes entered are the predecessors.
  let c = to;
  while (c !== from && c >= 0) {
    const entered = back ? wayPrev[c] : c;
    if (entered >= 0) {
      const chance = (isWaterBiome(world.biome[entered]) ? LOSS_WATER : LOSS_LAND) + LOSS_DANGER * world.danger[entered];
      if (trade.rng() < chance) keep *= 1 - LOSS_SHARE;
    }
    c = wayPrev[c];
  }
  return keep;
}

// ---------------------------------------------------------------------------
// Deals

const dealSell = new Float32Array(TRADE_GOODS);
const dealBuy = new Float32Array(TRADE_GOODS);

/**
 * What a merchant from `home` would take to `target` and bring back, into
 * dealSell and dealBuy (units), and its worth in money: goods home can spare
 * that the target asks for (dearest per weight first), then goods home asks
 * for that the target can spare, as far as home's money and the load allow.
 */
function planDeal(trade: Trade, eco: Economy, home: number, target: number): number {
  dealSell.fill(0);
  dealBuy.fill(0);
  let load = MERCHANT_LOAD;
  let worth = 0;
  for (const g of BY_VALUE) {
    if (g === TradeGood.Money || load <= 0) continue;
    const amount = Math.min(trade.surplus[home * TRADE_GOODS + g], trade.want[target * TRADE_GOODS + g], load / WEIGHT[g]);
    if (amount <= 0) continue;
    dealSell[g] = amount;
    load -= amount * WEIGHT[g];
    worth += amount * PRICE[g];
  }
  let money = eco.money[home];
  let backLoad = MERCHANT_LOAD;
  for (const g of BY_VALUE) {
    if (g === TradeGood.Money || backLoad <= 0 || money <= 0) continue;
    const amount = Math.min(trade.want[home * TRADE_GOODS + g], trade.surplus[target * TRADE_GOODS + g], backLoad / WEIGHT[g], money / PRICE[g]);
    if (amount <= 0) continue;
    dealBuy[g] = amount;
    backLoad -= amount * WEIGHT[g];
    money -= amount * PRICE[g];
    worth += amount * PRICE[g];
  }
  return worth;
}

/** Trade goods by price per weight, dearest first. */
const BY_VALUE = Array.from({ length: TRADE_GOODS }, (_, g) => g).sort((a, b) => PRICE[b] / WEIGHT[b] - PRICE[a] / WEIGHT[a] || a - b);

/**
 * The best trip from `home` among the settlements of its people in reach:
 * most worth per week of the round trip. Leaves its deal in dealSell and
 * dealBuy; returns the target (-1 = none) and its travel cost in `out`.
 */
function bestTrip(sim: Simulation, owner: Uint8Array, home: number, assume: number, out: { cost: number; rate: number }): number {
  const { trade, economy } = sim;
  const civ = owner[home];
  const reached = searchWays(sim, owner, home, MAX_TRIP_COST, assume);
  let best = -1;
  let bestRate = 0;
  for (const t of reached) {
    if (t === home || owner[t] !== civ || sim.cellPop[t] === 0) continue;
    const worth = planDeal(trade, economy, home, t);
    if (worth < MIN_TRIP_VALUE) continue;
    const rate = worth / (2 * wayCost[t] + 1);
    if (rate > bestRate || (rate === bestRate && t < best)) {
      bestRate = rate;
      best = t;
    }
  }
  out.cost = best >= 0 ? wayCost[best] : Infinity;
  out.rate = bestRate;
  if (best >= 0) planDeal(trade, economy, home, best);
  return best;
}

const tripOut = { cost: 0, rate: 0 };

/** Quarterly per hex with merchants at home: each goes on the best trip there is. */
export function sendMerchants(sim: Simulation, home: number): void {
  const { trade, economy } = sim;
  const owner = sim.world.owner;
  if (!owner[home] || !trade.interest[home]) return;
  while (trade.away[home] < trade.merchants[home] && takeSearches(sim, 1)) {
    const target = bestTrip(sim, owner, home, -1, tripOut);
    if (target < 0) {
      resetWays();
      return;
    }
    const trip = allocTrip(trade);
    const weeks = Math.max(1, Math.ceil(tripOut.cost * WEEKS_PER_COST));
    trade.tripHome[trip] = home;
    trade.tripTarget[trip] = target;
    trade.tripLeg[trip] = 1;
    trade.tripWeeks[trip] = weeks;
    trade.tripArrive[trip] = sim.tick + weeks;
    trade.tripKeepOut[trip] = rollKeep(sim, target, home, false);
    trade.tripKeepBack[trip] = rollKeep(sim, target, home, true);
    resetWays();
    // Load what is sold, and the money for what is bought.
    let pay = 0;
    for (let g = 0; g < TRADE_GOODS; g++) {
      trade.tripCargo[trip * TRADE_GOODS + g] = dealSell[g];
      if (dealSell[g] > 0) {
        addStock(economy, home, g, -dealSell[g]);
        trade.incoming[target * TRADE_GOODS + g] += dealSell[g];
        trade.want[target * TRADE_GOODS + g] = Math.max(0, trade.want[target * TRADE_GOODS + g] - dealSell[g]);
        trade.surplus[home * TRADE_GOODS + g] -= dealSell[g];
      }
      trade.tripBuy[trip * TRADE_GOODS + g] = dealBuy[g];
      if (dealBuy[g] > 0) {
        pay += dealBuy[g] * PRICE[g];
        trade.want[home * TRADE_GOODS + g] = Math.max(0, trade.want[home * TRADE_GOODS + g] - dealBuy[g]);
      }
    }
    pay = Math.min(pay, economy.money[home]);
    economy.money[home] -= pay;
    trade.tripCargo[trip * TRADE_GOODS + TradeGood.Money] = pay;
    trade.away[home]++;
    trade.partner[home] = target;
    trade.trips++;
  }
}

function markSupply(trade: Trade, cell: number): void {
  if (trade.supplyDirtyCount === trade.supplyDirty.length) {
    const grown = new Int32Array(trade.supplyDirty.length * 2);
    grown.set(trade.supplyDirty);
    trade.supplyDirty = grown;
  }
  trade.supplyDirty[trade.supplyDirtyCount++] = cell;
}

function allocTrip(trade: Trade): number {
  for (let i = 0; i < trade.tripEnd; i++) if (trade.tripLeg[i] === 0) return i;
  if (trade.tripEnd === trade.tripLeg.length) growTrips(trade);
  return trade.tripEnd++;
}

function growTrips(trade: Trade): void {
  const size = trade.tripLeg.length * 2;
  const grow = <T extends Int32Array | Uint8Array | Float32Array>(a: T, n: number): T => {
    const b = new (a.constructor as new (n: number) => T)(n);
    b.set(a as never);
    return b;
  };
  trade.tripHome = grow(trade.tripHome, size);
  trade.tripTarget = grow(trade.tripTarget, size);
  trade.tripArrive = grow(trade.tripArrive, size);
  trade.tripLeg = grow(trade.tripLeg, size);
  trade.tripWeeks = grow(trade.tripWeeks, size);
  trade.tripCargo = grow(trade.tripCargo, size * TRADE_GOODS);
  trade.tripBuy = grow(trade.tripBuy, size * TRADE_GOODS);
  trade.tripKeepOut = grow(trade.tripKeepOut, size);
  trade.tripKeepBack = grow(trade.tripKeepBack, size);
}

/**
 * Weekly: merchants that arrive. At the target they hand over the goods
 * (part may be lost), get paid (in goods home asks for when money runs
 * short), buy what home asks for and turn back; at home they unload.
 * Hexes whose grain or water stock changed go into `trade.supplyDirty`.
 */
export function advanceTrips(sim: Simulation): void {
  const { trade, economy } = sim;
  const owner = sim.world.owner;
  for (let trip = 0; trip < trade.tripEnd; trip++) {
    const leg = trade.tripLeg[trip];
    if (leg === 0 || trade.tripArrive[trip] > sim.tick) continue;
    const home = trade.tripHome[trip];
    const target = trade.tripTarget[trip];
    const cargo = trip * TRADE_GOODS;
    if (leg === 1) {
      const keep = trade.tripKeepOut[trip];
      const open = owner[target] !== 0 && owner[target] === owner[home];
      let owed = 0;
      let provisions = false;
      for (let g = 0; g < TRADE_GOODS; g++) {
        const amount = trade.tripCargo[cargo + g];
        if (amount <= 0 || g === TradeGood.Money) continue;
        trade.incoming[target * TRADE_GOODS + g] = Math.max(0, trade.incoming[target * TRADE_GOODS + g] - amount);
        if (!open) continue; // the settlement is gone or lost: the goods go back
        const arrived = amount * keep;
        trade.lost[g] += amount - arrived;
        trade.delivered[g] += arrived;
        addStock(economy, target, g, arrived);
        owed += arrived * PRICE[g];
        trade.tripCargo[cargo + g] = 0;
        if (g === TradeGood.Grain || g === TradeGood.Water) provisions = true;
      }
      if (provisions) markSupply(trade, target);
      let money = trade.tripCargo[cargo + TradeGood.Money] * keep;
      trade.lost[TradeGood.Money] += trade.tripCargo[cargo + TradeGood.Money] - money;
      if (open) {
        const paid = Math.min(owed, economy.money[target]);
        economy.money[target] -= paid;
        money += paid;
        owed -= paid;
        // Buy what home asked for with the money, or take it as payment for the rest.
        let load = MERCHANT_LOAD;
        for (let g = 0; g < TRADE_GOODS; g++) load -= trade.tripCargo[cargo + g] * WEIGHT[g];
        for (const g of BY_VALUE) {
          if (g === TradeGood.Money || load <= 0) continue;
          const asked = Math.max(trade.tripBuy[cargo + g], owed > 0 ? trade.want[home * TRADE_GOODS + g] : 0);
          const credit = money + owed;
          const amount = Math.min(asked, trade.surplus[target * TRADE_GOODS + g], stockOf(economy, target, g), load / WEIGHT[g], credit / PRICE[g]);
          if (amount <= 0) continue;
          addStock(economy, target, g, -amount);
          trade.surplus[target * TRADE_GOODS + g] -= amount;
          trade.tripCargo[cargo + g] += amount;
          load -= amount * WEIGHT[g];
          let cost = amount * PRICE[g];
          const fromOwed = Math.min(owed, cost);
          owed -= fromOwed;
          cost -= fromOwed;
          money -= cost;
          economy.money[target] += cost;
        }
      }
      trade.tripCargo[cargo + TradeGood.Money] = money;
      trade.tripLeg[trip] = 2;
      trade.tripArrive[trip] = sim.tick + trade.tripWeeks[trip];
      continue;
    }
    // Back home.
    const keep = trade.tripKeepBack[trip];
    const atHome = owner[home] !== 0;
    let provisions = false;
    for (let g = 0; g < TRADE_GOODS; g++) {
      const amount = trade.tripCargo[cargo + g];
      trade.tripCargo[cargo + g] = 0;
      trade.tripBuy[cargo + g] = 0;
      if (amount <= 0) continue;
      const arrived = atHome ? amount * keep : 0;
      trade.lost[g] += amount - arrived;
      if (arrived <= 0) continue;
      addStock(economy, home, g, arrived);
      if (g !== TradeGood.Money) trade.delivered[g] += arrived;
      if (g === TradeGood.Grain || g === TradeGood.Water) provisions = true;
    }
    if (provisions) markSupply(trade, home);
    trade.tripLeg[trip] = 0;
    trade.away[home] = Math.max(0, trade.away[home] - 1);
  }
}

// ---------------------------------------------------------------------------
// Trade buildings and roads

/** How much a hex's best trip is worth per week, with the given harbors; 0 = no trip. */
export function tradeRate(sim: Simulation, home: number, assume = -1): number {
  const target = bestTrip(sim, sim.world.owner, home, assume, tripOut);
  resetWays();
  return target >= 0 ? tripOut.rate : 0;
}

/** Whether a land hex lies next to the sea or a lake. */
export function isCoast(world: World, cell: number): boolean {
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = world.neighbors[cell * DIRECTION_COUNT + d];
    if (nb >= 0 && isWaterBiome(world.biome[nb])) return true;
  }
  return false;
}

/**
 * Which trade building a settlement should put up, if any (a type id, -1 =
 * none): the workshop of its special deposit's luxury good (the whole
 * people needs it); a trade center when a trip worth CENTER_MIN_VALUE is in
 * reach; a harbor when harbors here and at every coastal settlement of its
 * people would make its best trip better (a shorter way over water); a granary or water carriers
 * when the hex has 25 more food or water than it can use and its people ask
 * for more of that good than they spare and make.
 */
export function wantedTradeBuilding(sim: Simulation, cell: number, has: (good: number) => boolean): number {
  const { world, trade } = sim;
  const owner = world.owner;
  const civ = owner[cell];
  if (!civ) return -1;
  const workshop = WORKSHOP_OF[world.deposit[cell]];
  if (workshop !== undefined && !has(BUILDINGS[workshop].good)) return workshop;
  if (!trade.interest[cell]) return granaryOrBarrels(sim, cell, civ);
  if (!takeSearches(sim, 3)) return -1;
  if (!has(Good.Merchants)) {
    const target = bestTrip(sim, owner, cell, -1, tripOut);
    resetWays();
    if (target >= 0 && tripOut.rate * (2 * tripOut.cost + 1) >= CENTER_MIN_VALUE) return TYPE_OF[Good.Merchants];
  }
  if (!has(Good.Harbor) && isCoast(world, cell)) {
    const now = tradeRate(sim, cell);
    const withHarbors = tradeRate(sim, cell, cell);
    if (withHarbors > now) return TYPE_OF[Good.Harbor];
  }
  return granaryOrBarrels(sim, cell, civ);
}

/** A granary or water carriers, when the hex has 25 more food or water than it can use and its people ask for more than they spare and make. */
function granaryOrBarrels(sim: Simulation, cell: number, civ: number): number {
  const { trade } = sim;
  const capacity = sim.cellCapacity[cell];
  for (let k = 0; k < 2; k++) {
    const good = k === 0 ? Good.Grain : Good.Barrels;
    const spare = sim.cellSupply[cell * SUPPLY_KINDS + k] - capacity;
    const g = civ * TRADE_GOODS + TradeGood.Grain + k;
    const short = trade.civWant[g] - trade.civSpare[g] - trade.civMake[civ * 2 + k];
    if (spare >= BUILDINGS[TYPE_OF[good]].amount && short > 0) {
      trade.civMake[civ * 2 + k] += BUILDINGS[TYPE_OF[good]].amount; // counts until the next refresh
      return TYPE_OF[good];
    }
  }
  return -1;
}

/** The luxury workshop type per special deposit id. */
const WORKSHOP_OF: Record<number, number> = {};
BUILDINGS.forEach((b, i) => {
  if (b.deposit !== undefined) WORKSHOP_OF[b.deposit] = i;
});
const TYPE_OF: Record<number, number> = {};
BUILDINGS.forEach((b, i) => {
  if (b.good === Good.Merchants || b.good === Good.Harbor || b.good === Good.Grain || b.good === Good.Barrels) TYPE_OF[b.good] = i;
});

let landCost = new Float32Array(0);
let landPrev = new Int32Array(0);
const landReached: number[] = [];

/**
 * Quarterly per hex with merchants (a partner without a worthwhile road only
 * every ROAD_RECHECK_YEARS): when the way to its last partner would be
 * ROAD_SAVING shorter on a road over its own and free land, it builds the
 * first missing segment of that road from its stock (wood and stone times
 * the terrain's cost), keeping what it saves up for. Returns whether a
 * segment was built.
 */
export function buildTradeRoad(sim: Simulation, home: number, year: number): boolean {
  const { world, trade, economy } = sim;
  const owner = world.owner;
  const partner = trade.partner[home];
  const civ = owner[home];
  if (partner < 0 || !civ || owner[partner] !== civ) return false;
  // A partner checked without a road worth building is checked again after ROAD_RECHECK_YEARS.
  if (trade.roadChecked[home] === partner && year - trade.roadYear[home] < ROAD_RECHECK_YEARS) return false;
  if (!takeSearches(sim, 2)) return false;
  searchWays(sim, owner, home, MAX_TRIP_COST * 2, -1);
  const now = wayCost[partner];
  resetWays();

  // The cheapest road there could be: every step on a road.
  const n = world.cellCount;
  if (landCost.length !== n) {
    landCost = new Float32Array(n).fill(Infinity);
    landPrev = new Int32Array(n).fill(-1);
  }
  landReached.length = 0;
  landCost[home] = 0;
  landReached.push(home);
  wayHeap.push(home, 0);
  while (wayHeap.size > 0) {
    const c = wayHeap.pop();
    if (c === partner) break;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || isWaterBiome(world.biome[nb]) || (owner[nb] !== civ && owner[nb] !== 0)) continue;
      const next = landCost[c] + ((world.moveCost[c] + world.moveCost[nb]) / 2) * ROAD_TRAVEL_FACTOR;
      if (next >= landCost[nb] || next > MAX_TRIP_COST * 2) continue;
      if (landCost[nb] === Infinity) landReached.push(nb);
      landCost[nb] = next;
      landPrev[nb] = c;
      wayHeap.push(nb, next);
    }
  }
  while (wayHeap.size > 0) wayHeap.pop();
  let built = false;
  const road = landCost[partner];
  if (road < Infinity && road <= now * (1 - ROAD_SAVING)) {
    // The first missing segment from home along the road.
    let c = partner;
    let segment = -1;
    while (c !== home && c >= 0) {
      const prev = landPrev[c];
      const dir = directionTo(world, prev, c);
      if (dir >= 0 && !hasRoad(world, prev, dir)) segment = c;
      c = prev;
    }
    if (segment >= 0) {
      const prev = landPrev[segment];
      const dir = directionTo(world, prev, segment);
      const terrain = (world.moveCost[prev] + world.moveCost[segment]) / 2;
      const wood = ROAD_WOOD * terrain;
      const stone = ROAD_STONE * terrain;
      const w = home * MATERIAL_COUNT;
      if (economy.stock[w] - economy.goal[w] >= wood && economy.stock[w + 1] - economy.goal[w + 1] >= stone) {
        economy.stock[w] -= wood;
        economy.stock[w + 1] -= stone;
        addRoad(world, prev, dir);
        trade.roads++;
        built = true;
      }
    }
  }
  for (const c of landReached) {
    landCost[c] = Infinity;
    landPrev[c] = -1;
  }
  landReached.length = 0;
  // After a segment, the next one follows next quarter; otherwise wait.
  trade.roadChecked[home] = built ? -1 : partner;
  trade.roadYear[home] = year;
  return built;
}

function directionTo(world: World, from: number, to: number): number {
  for (let d = 0; d < DIRECTION_COUNT; d++) if (world.neighbors[from * DIRECTION_COUNT + d] === to) return d;
  return -1;
}

/** Travel cost on ways from one hex to another for the people of `from` (Infinity = no way); for tests and the hex info. */
export function travelOnWays(sim: Simulation, from: number, to: number): number {
  searchWays(sim, sim.world.owner, from, Infinity, -1);
  const cost = wayCost[to];
  resetWays();
  return cost;
}

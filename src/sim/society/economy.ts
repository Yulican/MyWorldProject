import { DIRECTION_COUNT } from '../hex';
import { sumTerms, type Term } from '../terms';
import { Biome, isWaterBiome } from '../world/biomes';
import {
  BUILDINGS,
  FIRST_LUXURY,
  GOOD_NAMES,
  Good,
  LUXURY_COUNT,
  MATERIAL_COUNT,
  Material,
  REPAIR_SHARE,
  GOV_SLOT,
  SETTLEMENT_SLOTS,
  SLOTS,
  SlotState,
  UPKEEP_GRACE_YEARS,
  buildingSupplyModifiers,
  forageYield,
  harvestTerms,
  isLuxury,
  isMaterial,
  isStored,
  STORED_COUNT,
  withBuildings,
} from './buildings';
import {
  CONNECTION_NEAR,
  LUXURY_EACH,
  LUXURY_MAX,
  LUXURY_PER_PERSON,
  comfortServed,
  comfortValue,
  connectionValue,
  luxuryValue,
  seatField,
  yieldFactor,
} from './satisfaction';
import { GOV_TUNING } from './taxes';
import { MIL, TROOP_BUILDING, TROOP_GOOD, TROOP_TYPES, TROOP_TYPE_OF_BUILDING, districtRoom } from './military';
import type { Simulation } from './simulation';
import { SUPPLY_KINDS, supplySums, type SupplyModifier } from './supply';
import { MONEY_PER_ADULT, PROVISIONS_MAX, TRADE_GOODS, TRADE_GOOD_NAMES, TradeGood, WORKSHOP_OF, buildTradeRoad, isCoast, provisionModifiers, sendMerchants, updateTradeBuildings, updateTradeNeeds, wantedTradeBuilding } from './trade';

// The quarterly economy of every settled hex: harvest, construction, upkeep
// and what to build next (design doc, section 5). No randomness, so it keeps
// the simulation deterministic.

/**
 * When a hex's people need more than it provides, this many of them move to
 * a free neighboring hex that can hold them (see simulation.ts). A hex with
 * ruins counts with its capacity after repair.
 */
export const EXPANSION_GROUP = 25;
/** Economy steps per year (it runs with the quarterly refresh). */
const STEPS_PER_YEAR = 4;
/**
 * Below this share of its capacity a hex's birth rate is full (see
 * updateInhabitant), so more food, water or space wouldn't help it grow yet.
 */
const BUILD_FROM_CROWDING = 0.5;
/** A settlement saves up for a building its harvest pays for within this many years. */
export const SAVE_UP_YEARS = 5;

/** Building slots of a hex on plains and elsewhere: plains build up, woods and mountains supply them. */
const PLAINS_SLOTS = SETTLEMENT_SLOTS;
const OTHER_SLOTS = 4;

/** Building slots a hex can use. */
export function usableSlots(sim: Simulation, cell: number): number {
  return sim.world.biome[cell] === Biome.Plains ? PLAINS_SLOTS : OTHER_SLOTS;
}

/** Smallest capacity gain (people) worth a building. */
const MIN_GAIN = 0.5;
/** Smallest satisfaction gain worth a comfort or luxury building. */
const MIN_SATISFACTION_GAIN = 1;
/**
 * A new seat of government keeps this travel cost from the existing ones, so
 * their best-connected surroundings don't overlap.
 */
const SEAT_MIN_COST = 2 * CONNECTION_NEAR;
/** A seat is only worth it if the settlements it serves gain this much satisfaction together. */
const SEAT_MIN_BENEFIT = 40;
/** Years before a seat site that was not built in time may be chosen again. */
const SEAT_RETRY_YEARS = 10;
/** Settlements a people compares per year for its next seat of government. */
const SEAT_CANDIDATES = 12;
/** Seat planning counts this much for each settlement the expansion stop holds back that the seat would free. */
const FRONTIER_BONUS = 20;
/**
 * Settlers only go where the connection term would be at least this (about
 * 3.4 travel cost from a seat): a people rather stops spreading than founds
 * settlements that turn unhappy and break away; seats of government and
 * roads to them extend its reach (design doc, section 5).
 */
export const EXPAND_MIN_CONNECTION = -15;
/** Below this satisfaction a settlement builds for it before it builds for growth: a lost settlement costs many people. */
const SATISFACTION_FIRST_BELOW = 5;

const NO_MODIFIERS: readonly SupplyModifier[] = [];

/**
 * Recomputes a hex's food, water and space and the people it supports, from
 * nature, `sim.supplyModifiers` and its standing buildings. Keeps the value
 * without buildings in `sim.baseSupply` for planning.
 */
export function updateCellSupply(sim: Simulation, cell: number): void {
  const grain = sim.economy.provisions[cell * 2];
  const barrels = sim.economy.provisions[cell * 2 + 1];
  supplySums(
    sim.world,
    cell,
    sim.supplyModifiers.get(cell) ?? NO_MODIFIERS,
    grain > 0 ? Math.min(grain, PROVISIONS_MAX) : 0,
    barrels > 0 ? Math.min(barrels, PROVISIONS_MAX) : 0,
    sums,
  );
  let capacity = Infinity;
  for (let k = 0; k < SUPPLY_KINDS; k++) {
    sim.baseSupply[cell * SUPPLY_KINDS + k] = Math.max(0, sums[k]);
    const v = sim.hasBuildings[cell] ? withBuildings(sim.economy, cell, k, sums[k]) : Math.max(0, sums[k]);
    sim.cellSupply[cell * SUPPLY_KINDS + k] = v;
    capacity = Math.min(capacity, v);
  }
  sim.cellCapacity[cell] = capacity;
}

const sums = new Float64Array(SUPPLY_KINDS);

/** A hex's supply modifiers other than its buildings: `sim.supplyModifiers` and grain or water in stock. */
function otherModifiers(sim: Simulation, cell: number): readonly SupplyModifier[] {
  const given = sim.supplyModifiers.get(cell) ?? NO_MODIFIERS;
  const provisions = provisionModifiers(sim.economy, cell);
  return provisions.length > 0 ? [...given, ...provisions] : given;
}

/** Every supply modifier of a hex, as the simulation uses them (for the hex info). */
export function cellModifiers(sim: Simulation, cell: number): SupplyModifier[] {
  return [...otherModifiers(sim, cell), ...buildingSupplyModifiers(sim.economy, cell)];
}

/** People a hex would support with its standing buildings plus up to two extra types. */
export function capacityWith(sim: Simulation, cell: number, extraA: number, extraB: number): number {
  const base = cell * SUPPLY_KINDS;
  let capacity = Infinity;
  for (let k = 0; k < SUPPLY_KINDS; k++) {
    capacity = Math.min(capacity, withBuildings(sim.economy, cell, k, sim.baseSupply[base + k], extraA, extraB));
  }
  return capacity;
}

/** People a hex would support once all its ruins are repaired. */
export function capacityAfterRepair(sim: Simulation, cell: number): number {
  const { economy } = sim;
  let a = -1;
  let b = -1;
  let ruins = 0;
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (economy.state[s] !== SlotState.Ruin && economy.state[s] !== SlotState.Repair) continue;
    ruins++;
    if (a < 0) a = economy.type[s];
    else if (b < 0) b = economy.type[s];
  }
  if (ruins === 0) return sim.cellCapacity[cell];
  if (ruins <= 2) return capacityWith(sim, cell, a, b);
  // More than two ruins (rare): add them up one by one.
  const base = cell * SUPPLY_KINDS;
  let capacity = Infinity;
  for (let k = 0; k < SUPPLY_KINDS; k++) {
    let add = 0;
    let mul = 1;
    for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
      const st = economy.state[s];
      if (st === SlotState.Empty || st === SlotState.Construction) continue;
      const t = BUILDINGS[economy.type[s]];
      if (t.good !== k) continue;
      add += t.amount;
      mul *= 1 + t.percent;
    }
    capacity = Math.min(capacity, Math.max(0, sim.baseSupply[base + k] + add) * mul);
  }
  return capacity;
}

/** Free land that settlers can move to: empty, and holding a group once its ruins are repaired. */
export function isSettlementTarget(sim: Simulation, cell: number): boolean {
  if (sim.cellPop[cell] > 0 || isWaterBiome(sim.world.biome[cell])) return false;
  return sim.cellCapacity[cell] >= EXPANSION_GROUP || capacityAfterRepair(sim, cell) >= EXPANSION_GROUP;
}

/** Wood plus stone a hex harvests per year by foraging; makes land more attractive to settle. */
export function rawMaterials(sim: Simulation, cell: number): number {
  return forageYield(sim.world, cell, Good.Wood) + forageYield(sim.world, cell, Good.Stone);
}

/**
 * Yearly wood or stone harvest with the standing buildings plus up to two
 * extra types; satisfied people harvest more (satisfaction.ts).
 */
function harvestWith(sim: Simulation, cell: number, good: number, extraA: number, extraB: number): number {
  const harvest = withBuildings(sim.economy, cell, good, forageYield(sim.world, cell, good), extraA, extraB);
  return harvest * yieldFactor(sim.satisfaction[cell]);
}

/** Yearly wood and stone upkeep of the standing buildings plus up to two extra types. */
function upkeepWith(sim: Simulation, cell: number, material: number, extraA: number, extraB: number): number {
  const { economy } = sim;
  let sum = 0;
  // The settlement's own buildings (the government keeps up its own).
  for (let s = cell * SLOTS, end = s + SETTLEMENT_SLOTS; s < end; s++) {
    if (economy.state[s] === SlotState.Standing) sum += upkeepOfType(economy.type[s], material);
  }
  if (extraA >= 0) sum += upkeepOfType(extraA, material);
  if (extraB >= 0) sum += upkeepOfType(extraB, material);
  return sum;
}

const upkeepOfType = (type: number, material: number) => (material === Material.Wood ? BUILDINGS[type].upkeepWood : BUILDINGS[type].upkeepStone);

/**
 * Wood and stone harvest and upkeep of `netCell` as it stands, from
 * prepareNet: the building plans weigh many types, and most don't change the
 * harvest, so netFast only adds their upkeep (the same result as netWith,
 * without recounting the slots).
 */
const netBase = new Float64Array(4);
let netCell = -1;

function prepareNet(sim: Simulation, cell: number): void {
  netBase[0] = harvestWith(sim, cell, Good.Wood, -1, -1);
  netBase[1] = harvestWith(sim, cell, Good.Stone, -1, -1);
  netBase[2] = upkeepWith(sim, cell, Material.Wood, -1, -1);
  netBase[3] = upkeepWith(sim, cell, Material.Stone, -1, -1);
  netCell = cell;
}

/** netWith for the cell of the last prepareNet. */
function netFast(sim: Simulation, cell: number, material: number, extraA: number, extraB: number): number {
  const good = material === Material.Wood ? Good.Wood : Good.Stone;
  if (cell !== netCell || (extraA >= 0 && BUILDINGS[extraA].good === good) || (extraB >= 0 && BUILDINGS[extraB].good === good)) {
    return netWith(sim, cell, material, extraA, extraB);
  }
  let upkeep = netBase[2 + material];
  if (extraA >= 0) upkeep += upkeepOfType(extraA, material);
  if (extraB >= 0) upkeep += upkeepOfType(extraB, material);
  return netBase[material] - upkeep;
}

/** Yearly wood and stone left after upkeep, with up to two extra standing types. */
function netWith(sim: Simulation, cell: number, material: number, extraA: number, extraB: number): number {
  const good = material === Material.Wood ? Good.Wood : Good.Stone;
  return harvestWith(sim, cell, good, extraA, extraB) - upkeepWith(sim, cell, material, extraA, extraB);
}

/** Years until a stock with this yearly income has `cost`; Infinity if never. */
function yearsUntil(stock: number, cost: number, income: number): number {
  if (stock >= cost) return 0;
  return income > 0 ? (cost - stock) / income : Infinity;
}

/**
 * One quarter of the economy for every `step`-th hex from `first` that has
 * people or buildings: harvest, construction, upkeep (with `yearEnd`) and
 * the next building. The simulation spreads the hexes over the weeks of a
 * quarter, so no single tick carries all of them. Returns whether any hex's
 * supply or buildings changed.
 */
export function runEconomy(sim: Simulation, yearEnd: boolean, first = 0, step = 1): boolean {
  const { world, economy } = sim;
  let changed = false;
  for (let c = first; c < world.cellCount; c += step) {
    const people = sim.cellPop[c];
    if (people === 0 && !sim.hasBuildings[c]) continue;
    const stock = c * MATERIAL_COUNT;
    if (people > 0) {
      economy.stock[stock + Material.Wood] += harvestWith(sim, c, Good.Wood, -1, -1) / STEPS_PER_YEAR;
      economy.stock[stock + Material.Stone] += harvestWith(sim, c, Good.Stone, -1, -1) / STEPS_PER_YEAR;
      harvestLuxury(sim, c, yearEnd);
    }
    let busy = false;
    let supplyChanged = false;
    for (let s = c * SLOTS, end = s + SLOTS; s < end; s++) {
      const st = economy.state[s];
      if (st === SlotState.Construction || st === SlotState.Repair) {
        // Only people build; an empty hex's construction site waits.
        if (people > 0) economy.work[s] -= 1 / STEPS_PER_YEAR;
        if (economy.work[s] > 1e-4) {
          // Government construction doesn't hold up the settlement's own.
          if (s < c * SLOTS + GOV_SLOT) busy = true;
        } else {
          economy.state[s] = SlotState.Standing;
          economy.work[s] = 0;
          economy.unpaid[s] = 0;
          supplyChanged = true;
        }
      } else if (st === SlotState.Standing && yearEnd && s < c * SLOTS + GOV_SLOT) {
        // The government keeps up its own buildings (government.ts).
        const b = BUILDINGS[economy.type[s]];
        // Nobody maintains an empty hex's buildings.
        if (
          people > 0 &&
          economy.stock[stock + Material.Wood] >= b.upkeepWood &&
          economy.stock[stock + Material.Stone] >= b.upkeepStone
        ) {
          economy.stock[stock + Material.Wood] -= b.upkeepWood;
          economy.stock[stock + Material.Stone] -= b.upkeepStone;
          economy.unpaid[s] = 0;
        } else if (++economy.unpaid[s] > UPKEEP_GRACE_YEARS) {
          economy.state[s] = SlotState.Ruin;
          economy.unpaid[s] = 0;
          supplyChanged = true;
        }
      }
    }
    if (supplyChanged) {
      updateTradeBuildings(sim, c);
      updateCellSupply(sim, c);
    }
    if (people > 0) {
      if (updateTradeNeeds(sim, c, sim.cellAdults[c], yearEnd, STEPS_PER_YEAR)) {
        updateCellSupply(sim, c);
        supplyChanged = true;
      }
      economy.goal[stock + Material.Wood] = 0;
      economy.goal[stock + Material.Stone] = 0;
      // Satisfaction comes first while a settlement is about to turn unhappy: a lost settlement costs many people.
      const moodFirst = sim.satisfaction[c] < SATISFACTION_FIRST_BELOW;
      // Seats of government are the government's (government.ts).
      const started = !busy && (planDeposit(sim, c) || (moodFirst ? planSatisfaction(sim, c) || planBuilding(sim, c) : planBuilding(sim, c) || planSatisfaction(sim, c)));
      if (started || (!busy && yearEnd && (planTrade(sim, c) || planMilitary(sim, c)))) supplyChanged = true;
      if (sim.trade.merchants[c] > 0) {
        sendMerchants(sim, c);
        buildTradeRoad(sim, c, Math.floor(sim.tick / (STEPS_PER_YEAR * 13)));
      }
    }
    if (supplyChanged) changed = true;
  }
  return changed;
}

/** Whether a free neighbor could take settlers, so growing outward beats building (design doc, section 5). */
function canExpand(sim: Simulation, cell: number): boolean {
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = sim.world.neighbors[cell * DIRECTION_COUNT + d];
    if (nb >= 0 && isSettlementTarget(sim, nb)) return true;
  }
  return false;
}

/**
 * Decides what a hex builds next, best for its population growth:
 * - Only once it is half full (before that, births are at their highest
 *   anyway), and new buildings only while no free land next door takes
 *   settlers (spreading out grows faster; repairs are always fine).
 * - Picks the building or repair that raises its capacity most among those
 *   its harvest pays for within SAVE_UP_YEARS, directly or after a lumber
 *   camp, quarry (or similar) first, if that gets it there sooner. Only
 *   buildings whose upkeep the harvest covers for good.
 * - Affordable: starts it (materials paid upfront). Otherwise it saves up,
 *   and when nothing is in reach, people move out once the hex is full.
 * Returns whether construction started.
 */
function planBuilding(sim: Simulation, cell: number, repairsOnly = false): boolean {
  const { economy } = sim;
  const capacity = sim.cellCapacity[cell];
  if (sim.cellPop[cell] < BUILD_FROM_CROWDING * capacity) return false;
  let free = 0;
  let ruins = 0;
  for (let s = cell * SLOTS, end = s + usableSlots(sim, cell); s < end; s++) {
    if (economy.state[s] === SlotState.Empty) free++;
    else if (economy.state[s] === SlotState.Ruin) ruins++;
  }
  const newAllowed = !repairsOnly && free > 0 && !canExpand(sim, cell);
  if (!newAllowed && ruins === 0) return false;
  prepareNet(sim, cell);
  const wood = economy.stock[cell * MATERIAL_COUNT + Material.Wood];
  const stone = economy.stock[cell * MATERIAL_COUNT + Material.Stone];
  const netWood = netFast(sim, cell, Material.Wood, -1, -1);
  const netStone = netFast(sim, cell, Material.Stone, -1, -1);

  let bestGain = 0;
  let bestTime = Infinity;
  let bestSlot = -1; // a ruin slot to repair, or -1 for a new building
  let bestType = -1;
  let firstSlot = -1; // production building to put up first, if any
  let firstType = -1;

  // Options: every population building type in a free slot, every ruined one repaired.
  for (let option = 0; option < BUILDINGS.length + SETTLEMENT_SLOTS; option++) {
    let type: number;
    let slot = -1;
    if (option < BUILDINGS.length) {
      if (!newAllowed) continue;
      type = option;
    } else {
      slot = cell * SLOTS + option - BUILDINGS.length;
      if (economy.state[slot] !== SlotState.Ruin) continue;
      type = economy.type[slot];
    }
    const b = BUILDINGS[type];
    if (b.good >= SUPPLY_KINDS) continue;
    const gain = capacityWith(sim, cell, type, -1) - capacity;
    if (gain < MIN_GAIN || gain < bestGain) continue;
    const share = slot >= 0 ? REPAIR_SHARE : 1;
    const costWood = b.wood * share;
    const costStone = b.stone * share;

    // Directly, if the harvest keeps paying its upkeep.
    if (netFast(sim, cell, Material.Wood, type, -1) >= 0 && netFast(sim, cell, Material.Stone, type, -1) >= 0) {
      const wait = Math.max(yearsUntil(wood, costWood, netWood), yearsUntil(stone, costStone, netStone));
      if (wait <= SAVE_UP_YEARS && (gain > bestGain || wait < bestTime)) {
        bestGain = gain;
        bestTime = wait;
        bestSlot = slot;
        bestType = type;
        firstType = -1;
      }
    }

    // After an affordable production building (new or repaired) first.
    for (let first = 0; first < BUILDINGS.length + SETTLEMENT_SLOTS; first++) {
      let ptype: number;
      let pslot = -1;
      if (first < BUILDINGS.length) {
        if (free < (slot >= 0 ? 1 : 2)) continue;
        ptype = first;
      } else {
        pslot = cell * SLOTS + first - BUILDINGS.length;
        if (economy.state[pslot] !== SlotState.Ruin || pslot === slot) continue;
        ptype = economy.type[pslot];
      }
      const p = BUILDINGS[ptype];
      if (!isMaterial(p.good)) continue;
      const pshare = pslot >= 0 ? REPAIR_SHARE : 1;
      if (wood < p.wood * pshare || stone < p.stone * pshare) continue;
      const netWood2 = netFast(sim, cell, Material.Wood, ptype, -1);
      const netStone2 = netFast(sim, cell, Material.Stone, ptype, -1);
      if (netWood2 < 0 || netStone2 < 0) continue;
      if (netFast(sim, cell, Material.Wood, ptype, type) < 0 || netFast(sim, cell, Material.Stone, ptype, type) < 0) continue;
      const build = p.years * pshare;
      const wait =
        build +
        Math.max(
          yearsUntil(wood - p.wood * pshare + netWood * build, costWood, netWood2),
          yearsUntil(stone - p.stone * pshare + netStone * build, costStone, netStone2),
        );
      if (wait <= SAVE_UP_YEARS && (gain > bestGain || wait < bestTime)) {
        bestGain = gain;
        bestTime = wait;
        bestSlot = slot;
        bestType = type;
        firstSlot = pslot;
        firstType = ptype;
      }
    }
  }

  if (bestType < 0) return false;
  if (firstType >= 0) return startConstruction(sim, cell, firstSlot, firstType);
  if (bestTime > 0) return saveUp(sim, cell, bestSlot, bestType);
  return startConstruction(sim, cell, bestSlot, bestType);
}

/** Notes what a hex saves up for, so merchants can bring the rest (trade.ts). Returns false: nothing started. */
function saveUp(sim: Simulation, cell: number, slot: number, type: number): boolean {
  const b = BUILDINGS[type];
  const share = slot >= 0 ? REPAIR_SHARE : 1;
  sim.economy.goal[cell * MATERIAL_COUNT + Material.Wood] = b.wood * share;
  sim.economy.goal[cell * MATERIAL_COUNT + Material.Stone] = b.stone * share;
  return false;
}

/** Yearly, when nothing else is to be built: a trade building (see wantedTradeBuilding) if affordable and kept up for good. */
function planTrade(sim: Simulation, cell: number): boolean {
  if (sim.cellPop[cell] < EXPANSION_GROUP) return false;
  const type = wantedTradeBuilding(sim, cell, (good) => hasGood(sim, cell, good));
  if (type < 0 || !buildingFits(sim, cell, type)) return false;
  const { economy } = sim;
  let free = false;
  for (let s = cell * SLOTS, end = s + usableSlots(sim, cell); s < end; s++) if (economy.state[s] === SlotState.Empty) free = true;
  if (!free) return false;
  const b = BUILDINGS[type];
  if (economy.stock[cell * MATERIAL_COUNT + Material.Wood] < b.wood || economy.stock[cell * MATERIAL_COUNT + Material.Stone] < b.stone) return false;
  if (netWith(sim, cell, Material.Wood, type, -1) < 0 || netWith(sim, cell, Material.Stone, type, -1) < 0) return false;
  return startConstruction(sim, cell, -1, type);
}

/**
 * Placeholder rule (war phase 1; where and when the AI builds military
 * buildings is not designed yet): yearly, a settlement of MIL.minPop people
 * whose district has room for the pay (the income check) builds the military
 * building its people has the least capacity of, at most one of each type per
 * settlement, a stable only where horses are at hand, when it can pay and keep
 * it up like its other buildings.
 */
function planMilitary(sim: Simulation, cell: number): boolean {
  if (!MIL.enabled || !MIL.build || sim.cellPop[cell] < MIL.minPop) return false;
  const seat = sim.government.district[cell];
  if (seat < 0 || districtRoom(sim, seat) < MIL.capacity) return false;
  const { economy, military } = sim;
  // Not what the settlement saves up for something else (growth, comfort).
  if (economy.goal[cell * MATERIAL_COUNT] > 0 || economy.goal[cell * MATERIAL_COUNT + 1] > 0) return false;
  let free = 0;
  for (let s = cell * SLOTS, end = s + usableSlots(sim, cell); s < end; s++) if (economy.state[s] === SlotState.Empty) free++;
  if (free <= MIL.reserveSlots) return false;
  const civ = sim.world.owner[cell];
  let best = -1;
  let bestCap = Infinity;
  for (let k = 0; k < TROOP_TYPES; k++) {
    const t = (k + cell) % TROOP_TYPES; // ties go different ways in different settlements
    if (hasGood(sim, cell, TROOP_BUILDING[t])) continue;
    if (t === 2 && economy.luxury[cell * STORED_COUNT + TROOP_GOOD[t]] < 1) continue;
    const have = civ > 0 && civ * TROOP_TYPES + t < military.soldiersOf.length ? military.soldiersOf[civ * TROOP_TYPES + t] : 0;
    if (have < bestCap) {
      bestCap = have;
      best = t;
    }
  }
  if (best < 0) return false;
  const type = TROOP_TYPE_OF_BUILDING[best];
  const b = BUILDINGS[type];
  if (economy.stock[cell * MATERIAL_COUNT + Material.Wood] < b.wood || economy.stock[cell * MATERIAL_COUNT + Material.Stone] < b.stone) return false;
  if (netWith(sim, cell, Material.Wood, type, -1) < 0 || netWith(sim, cell, Material.Stone, type, -1) < 0) return false;
  if (!startConstruction(sim, cell, -1, type)) return false;
  military.districtCap[seat] += MIL.capacity;
  return true;
}

/**
 * A quarter of the luxury goods the hex's standing buildings harvest from
 * its deposit; at the year's end its people use their yearly need of each
 * (with buildings or without),
 * and the goods whose need the stock covered count for their satisfaction.
 */
function harvestLuxury(sim: Simulation, cell: number, yearEnd: boolean): void {
  const { economy } = sim;
  const factor = yieldFactor(sim.satisfaction[cell]);
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (economy.state[s] !== SlotState.Standing) continue;
    const b = BUILDINGS[economy.type[s]];
    if (isStored(b.good)) economy.luxury[cell * STORED_COUNT + b.good - FIRST_LUXURY] += (b.amount * factor) / STEPS_PER_YEAR;
    else if (b.good === Good.Gold) {
      // Gold is money at once (war phase 0): MIL.goldRate per unit.
      const gold = (b.amount * factor * MIL.goldRate) / STEPS_PER_YEAR;
      economy.money[cell] += gold;
      sim.military.goldMined += gold;
    } else if (b.good === Good.Grain || b.good === Good.Barrels) economy.provisions[cell * 2 + (b.good === Good.Grain ? 0 : 1)] += b.amount / STEPS_PER_YEAR;
  }
  if (!yearEnd) return;
  const need = sim.cellPop[cell] * LUXURY_PER_PERSON;
  let covered = 0;
  for (let k = 0; k < LUXURY_COUNT; k++) {
    const i = cell * STORED_COUNT + k;
    if (economy.luxury[i] <= 0) continue;
    // Goods held for a trade partner in transit aren't the settlement's own.
    const held = Math.min(economy.luxury[i], sim.trade.transitKeep[cell * TRADE_GOODS + TradeGood.Luxury + k]);
    const own = economy.luxury[i] - held;
    if (own >= need) covered |= 1 << k;
    economy.luxury[i] = held + Math.max(0, own - need);
  }
  economy.luxuryCovered[cell] = covered;
}

/** Whether a hex can have a building of this type at all (deposit, water, coast, biome). */
export function buildingFits(sim: Simulation, cell: number, type: number): boolean {
  const b = BUILDINGS[type];
  if (b.deposit !== undefined && sim.world.deposit[cell] !== b.deposit) return false;
  if (b.waterSurplus !== undefined && sim.cellSupply[cell * SUPPLY_KINDS + 1] - sim.cellPop[cell] < b.waterSurplus) return false;
  if (b.coast && !isCoast(sim.world, cell)) return false;
  if (b.biomes && !b.biomes.includes(sim.world.biome[cell])) return false;
  return true;
}

/** Whether the hex has a building of this good standing, under construction or under repair. */
function hasGood(sim: Simulation, cell: number, good: number): boolean {
  const { economy } = sim;
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    const st = economy.state[s];
    if ((st === SlotState.Standing || st === SlotState.Construction || st === SlotState.Repair) && BUILDINGS[economy.type[s]].good === good) return true;
  }
  return false;
}

/**
 * A settlement on a luxury deposit mines it as soon as its people or one of
 * their trade partners lack the good in total, happy or not (luxury goods
 * are strategic). Upkeep its harvest doesn't cover comes by trade if its
 * people spare the wood and stone. Starts when affordable, else saves up.
 */
function planDeposit(sim: Simulation, cell: number): boolean {
  const type = WORKSHOP_OF[sim.world.deposit[cell]];
  if (type === undefined || hasGood(sim, cell, BUILDINGS[type].good) || !buildingFits(sim, cell, type)) return false;
  const { economy, trade } = sim;
  const civ = sim.world.owner[cell];
  // Gold is mined for its money, wanted or not; the other goods when the people or a partner lacks them.
  if (BUILDINGS[type].good !== Good.Gold) {
    const g = TradeGood.Luxury + BUILDINGS[type].good - FIRST_LUXURY;
    const lacks = (p: number) => (p + 1) * TRADE_GOODS <= trade.civWant.length && trade.civWant[p * TRADE_GOODS + g] - trade.civSpare[p * TRADE_GOODS + g] > 0;
    if (!lacks(civ) && !(sim.diplomacy.partners[civ] ?? []).some(lacks)) return false;
  }
  let slot = -1;
  let free = false;
  for (let s = cell * SLOTS, end = s + usableSlots(sim, cell); s < end; s++) {
    if (economy.state[s] === SlotState.Ruin && economy.type[s] === type) slot = s;
    if (economy.state[s] === SlotState.Empty) free = true;
  }
  if (slot < 0 && !free) return false;
  // Upkeep: from its own harvest, or brought by its people.
  const spares = (m: number) => (civ + 1) * TRADE_GOODS <= trade.civSpare.length && trade.civSpare[civ * TRADE_GOODS + m] - trade.civWant[civ * TRADE_GOODS + m] > 0;
  if (netWith(sim, cell, Material.Wood, type, -1) < 0 && !spares(TradeGood.Wood)) return false;
  if (netWith(sim, cell, Material.Stone, type, -1) < 0 && !spares(TradeGood.Stone)) return false;
  const b = BUILDINGS[type];
  const share = slot >= 0 ? REPAIR_SHARE : 1;
  const ready = economy.stock[cell * MATERIAL_COUNT + Material.Wood] >= b.wood * share && economy.stock[cell * MATERIAL_COUNT + Material.Stone] >= b.stone * share;
  return ready ? startConstruction(sim, cell, slot, type) : saveUp(sim, cell, slot, type);
}

/**
 * When a settlement is unhappy but has the food, water and space it needs
 * (and nothing to build for its growth): the comfort building or luxury
 * workshop that raises its satisfaction most among those it pays for within
 * SAVE_UP_YEARS and keeps up for good, new or repaired. Starts it when
 * affordable, else saves up. Returns whether construction started.
 */
function planSatisfaction(sim: Simulation, cell: number): boolean {
  const { economy } = sim;
  const people = sim.cellPop[cell];
  if (sim.satisfaction[cell] >= SATISFACTION_FIRST_BELOW || people > sim.cellCapacity[cell]) return false;
  prepareNet(sim, cell);
  let free = 0;
  for (let s = cell * SLOTS, end = s + usableSlots(sim, cell); s < end; s++) if (economy.state[s] === SlotState.Empty) free++;
  const wood = economy.stock[cell * MATERIAL_COUNT + Material.Wood];
  const stone = economy.stock[cell * MATERIAL_COUNT + Material.Stone];
  const netWood = netFast(sim, cell, Material.Wood, -1, -1);
  const netStone = netFast(sim, cell, Material.Stone, -1, -1);
  const served = comfortServed(economy, cell);
  const luxuryNow = luxuryValue(economy.luxuryCovered[cell]);

  let bestGain = MIN_SATISFACTION_GAIN;
  let bestTime = Infinity;
  let bestSlot = -1;
  let bestType = -1;
  for (let option = 0; option < BUILDINGS.length + SETTLEMENT_SLOTS; option++) {
    let type: number;
    let slot = -1;
    if (option < BUILDINGS.length) {
      if (free === 0) continue;
      type = option;
    } else {
      slot = cell * SLOTS + option - BUILDINGS.length;
      if (economy.state[slot] !== SlotState.Ruin) continue;
      type = economy.type[slot];
    }
    const b = BUILDINGS[type];
    let gain: number;
    if (b.good === Good.Comfort) gain = comfortValue(served + b.amount, people) - comfortValue(served, people);
    else if (isLuxury(b.good) && !hasGood(sim, cell, b.good)) gain = Math.min(LUXURY_EACH, LUXURY_MAX - luxuryNow);
    else continue;
    if (gain < bestGain || !buildingFits(sim, cell, type)) continue;
    if (netFast(sim, cell, Material.Wood, type, -1) < 0 || netFast(sim, cell, Material.Stone, type, -1) < 0) continue;
    const share = slot >= 0 ? REPAIR_SHARE : 1;
    const wait = Math.max(yearsUntil(wood, b.wood * share, netWood), yearsUntil(stone, b.stone * share, netStone));
    if (wait > SAVE_UP_YEARS || (gain === bestGain && wait >= bestTime)) continue;
    bestGain = gain;
    bestTime = wait;
    bestSlot = slot;
    bestType = type;
  }
  if (bestType < 0) return false; // nothing worth it
  if (bestTime > 0) return saveUp(sim, cell, bestSlot, bestType);
  return startConstruction(sim, cell, bestSlot, bestType);
}

const SEAT_TYPE = BUILDINGS.findIndex((b) => b.good === Good.Seat);

/**
 * Yearly, per people without a planned or unfinished seat of government:
 * the site for the next one. Candidates are its settlements of 25+ people
 * at least SEAT_MIN_COST from every seat; those the expansion stop holds
 * back come first, then the worst connected, SEAT_CANDIDATES in all. The
 * site is the one whose seat raises its people's connection most (at least
 * SEAT_MIN_BENEFIT), counting only gains over today's connection, so a seat
 * covers new ground rather than ground another seat covers, plus
 * FRONTIER_BONUS for each held-back settlement it frees. The site saves up
 * for it (merchants bring the rest) and builds it in the economy step
 * (buildPlannedSeat); a plan not built within SAVE_UP_YEARS goes elsewhere.
 */
export function planSeats(sim: Simulation, owner: Uint8Array): void {
  const plan = startSeatPlan(sim, owner);
  while (!continueSeatPlan(sim, plan, Infinity));
}

/**
 * planSeats in parts, so it can be spread over frames: the candidates
 * (startSeatPlan), then the districts' sites a few at a time
 * (continueSeatPlan). Districts don't affect each other's choice, so the
 * parts give the same result as one go, as long as nothing else changes the
 * simulation in between.
 */
export type SeatPlan = {
  owner: Uint8Array;
  year: number;
  busy: Uint8Array;
  candidates: number[][];
  again: Int32Array;
  civOf: Uint8Array;
  /** The next district (by seat cell) to plan. */
  next: number;
};

export function startSeatPlan(sim: Simulation, owner: Uint8Array): SeatPlan {
  const { economy, world } = sim;
  const n = world.cellCount;
  // One planned seat per government district (by its seat cell).
  const groups = n;
  const groupOf = (c: number) => sim.government.district[c];
  const busy = new Uint8Array(groups);
  const candidates: number[][] = [];
  const again = new Int32Array(groups).fill(-1);
  const civOf = new Uint8Array(groups);
  const year = Math.floor(sim.tick / (STEPS_PER_YEAR * 13));
  for (let c = 0; c < n; c++) {
    const id = owner[c];
    const g = groupOf(c);
    if (sim.seatSite[c] && (id === 0 || sim.cellPop[c] === 0)) sim.seatSite[c] = 0; // lost
    if (sim.seatSite[c] && year + 1 - sim.seatSite[c] > SAVE_UP_YEARS) {
      sim.seatSite[c] = 0;
      // Queued by the government: it competes again with the other sites (below).
      if (sim.government.seatQueued[c] && id && g >= 0) again[g] = c;
      // Not built in time: try elsewhere, and this site again only later.
      else sim.seatRetry[c] = year + SEAT_RETRY_YEARS + 1;
    }
    if (id === 0 || g < 0) continue;
    civOf[g] = id;
    if (sim.seatSite[c]) busy[g] = 1;
    if (sim.hasBuildings[c]) {
      for (let s = c * SLOTS, end = s + SLOTS; s < end; s++) {
        const st = economy.state[s];
        if ((st === SlotState.Construction || st === SlotState.Repair) && economy.type[s] === SEAT_TYPE) busy[g] = 1;
      }
    }
    if (sim.cellPop[c] < EXPANSION_GROUP || sim.seatCost[c] < SEAT_MIN_COST || hasGood(sim, c, Good.Seat)) continue;
    if (sim.seatRetry[c] > year + 1) continue;
    (candidates[g] ??= []).push(c);
  }
  return { owner, year, busy, candidates, again, civOf, next: 0 };
}

/** Plans the sites of up to `districts` more districts; true once all are done. */
export function continueSeatPlan(sim: Simulation, plan: SeatPlan, districts: number): boolean {
  const { owner, year, busy, candidates, again, civOf } = plan;
  const groups = busy.length;
  const field = scratchField(groups);
  let planned = 0;
  for (; plan.next < groups && planned < districts; plan.next++) {
    const g = plan.next;
    const id = civOf[g];
    const list = candidates[g];
    // A queued site keeps its plan while another seat is being built.
    if (again[g] >= 0 && busy[g]) sim.seatSite[again[g]] = year + 1;
    if (!sim.civs[id] || busy[g] || !list) continue;
    planned++;
    // Held back by the expansion stop first, then the worst connected.
    const held = (c: number) => (sim.frontierBlocked[c] && year + 1 - sim.frontierBlocked[c] <= 1 ? 1 : 0);
    list.sort((a, b) => held(b) - held(a) || sim.seatCost[b] - sim.seatCost[a] || a - b);
    let best = -1;
    let bestBenefit = SEAT_MIN_BENEFIT;
    const evaluate = list.slice(0, SEAT_CANDIDATES);
    if (again[g] >= 0 && list.includes(again[g]) && !evaluate.includes(again[g])) evaluate.push(again[g]);
    for (const c of evaluate) {
      const reached = seatField(sim, owner, id, [c], field);
      let benefit = 0;
      for (const k of reached) {
        // Only its own settlements count (the way may cross land opened to it).
        if (owner[k] === id) {
          benefit += Math.max(0, connectionValue(field[k]) - connectionValue(sim.seatCost[k]));
          // A settlement held back whose next step would pass the stop with this seat.
          if (held(k) && connectionValue(field[k] + 1) >= EXPAND_MIN_CONNECTION) benefit += FRONTIER_BONUS;
        }
        field[k] = Infinity;
      }
      // A district its government cannot tax (0 %) needs the seat most (GOV_TUNING.zeroPriority).
      const d = sim.government.district[c];
      if (d >= 0 && sim.government.rate[d] === 0) benefit *= GOV_TUNING.zeroPriority;
      if (benefit > bestBenefit) {
        bestBenefit = benefit;
        best = c;
      }
    }
    if (best >= 0) sim.seatSite[best] = year + 1;
    if (again[g] >= 0 && best !== again[g]) sim.seatRetry[again[g]] = year + SEAT_RETRY_YEARS + 1;
  }
  return plan.next >= groups;
}

let scratch = new Float32Array(0);
/** A reusable all-Infinity field of `n` cells (seatField users reset what they touched). */
function scratchField(n: number): Float32Array {
  if (scratch.length !== n) scratch = new Float32Array(n).fill(Infinity);
  return scratch;
}

/** Where a hex could get a seat of government: a ruined seat to repair, -1 for a free slot, null if neither. */
function seatSlot(sim: Simulation, cell: number): number | null {
  const { economy } = sim;
  let free = false;
  for (let s = cell * SLOTS, end = s + usableSlots(sim, cell); s < end; s++) {
    if (economy.state[s] === SlotState.Ruin && economy.type[s] === SEAT_TYPE) return s;
    if (economy.state[s] === SlotState.Empty) free = true;
    if (economy.state[s] !== SlotState.Empty && economy.state[s] !== SlotState.Ruin && economy.type[s] === SEAT_TYPE) return null;
  }
  return free ? -1 : null;
}

/** Pays a building (or the repair of the ruin in `slot`) and starts the work; -1 = a new building in a free slot. */
function startConstruction(sim: Simulation, cell: number, slot: number, type: number): boolean {
  const { economy } = sim;
  const b = BUILDINGS[type];
  const share = slot >= 0 ? REPAIR_SHARE : 1;
  if (slot < 0) {
    for (let s = cell * SLOTS, end = s + usableSlots(sim, cell); s < end && slot < 0; s++) if (economy.state[s] === SlotState.Empty) slot = s;
    if (slot < 0) return false;
    economy.type[slot] = type;
  }
  economy.stock[cell * MATERIAL_COUNT + Material.Wood] -= b.wood * share;
  economy.stock[cell * MATERIAL_COUNT + Material.Stone] -= b.stone * share;
  const repair = economy.state[slot] === SlotState.Ruin;
  economy.state[slot] = repair ? SlotState.Repair : SlotState.Construction;
  economy.work[slot] = b.years * (repair ? REPAIR_SHARE : 1);
  economy.unpaid[slot] = 0;
  sim.hasBuildings[cell] = 1;
  return true;
}

/** One building of a hex as the hex info shows it. */
export type BuildingInfo = {
  name: string;
  state: 'standing' | 'construction' | 'ruin' | 'repair';
  /** Years of work left (construction, repair). */
  workLeft: number;
  /** Standing: years its upkeep went unpaid in a row. */
  unpaidYears: number;
  /** E.g. "+25 food", "+50 % water". */
  effect: string;
  /** E.g. "1 wood". */
  upkeep: string;
};

/** Stock, harvest and buildings of a hex for the hex info (allocates; UI only). */
export type HexEconomy = {
  wood: number;
  stone: number;
  /** How the yearly wood and stone harvest come about. */
  harvest: { wood: Term[]; stone: Term[] };
  /** Yearly upkeep of the standing buildings. */
  upkeepWood: number;
  upkeepStone: number;
  buildings: BuildingInfo[];
  slots: number;
  trade: HexTrade;
  /** The government on this hex (Requirement Zentralregierung): its district, taxes, stock and buildings. */
  government: HexGovernment;
};

export type HexGovernment = {
  /** The seat whose district the hex is in, -1 if none; whether that is the capital. */
  seat: number;
  capital: boolean;
  /** Money and goods tax rates the settlement pays (0..1). */
  rate: number;
  goodsRate: number;
  /** Wood and stone the government keeps on this hex. */
  wood: number;
  stone: number;
  buildings: BuildingInfo[];
  slots: number;
};

/** A hex's trade for the hex info: money, grain and barrels, merchants, and what it asks for and spares. */
export type HexTrade = {
  money: number;
  /** Money its adults earn per year. */
  income: number;
  grain: number;
  barrels: number;
  merchants: number;
  away: number;
  /** Where its merchants traded last, -1 = nowhere yet. */
  partner: number;
  asks: { good: string; amount: number }[];
  spares: { good: string; amount: number }[];
};

const STATE_NAMES = ['standing', 'construction', 'standing', 'ruin', 'repair'] as const;

export function hexEconomy(sim: Simulation, cell: number): HexEconomy {
  const { economy, world, government: gov } = sim;
  const buildings: BuildingInfo[] = [];
  const govBuildings: BuildingInfo[] = [];
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    const st = economy.state[s];
    if (st === SlotState.Empty) continue;
    const b = BUILDINGS[economy.type[s]];
    const good = GOOD_NAMES[b.good].toLowerCase();
    const isGov = s >= cell * SLOTS + GOV_SLOT;
    // Seats in government slots cost GOV_TUNING.seatUpkeep of the usual upkeep.
    const factor = isGov && b.good === Good.Seat ? GOV_TUNING.seatUpkeep : 1;
    const upkeep = [b.upkeepWood ? `${b.upkeepWood * factor} wood` : '', b.upkeepStone ? `${b.upkeepStone * factor} stone` : ''].filter(Boolean);
    (isGov ? govBuildings : buildings).push({
      name: b.name,
      state: STATE_NAMES[st],
      workLeft: economy.work[s],
      unpaidYears: st === SlotState.Standing ? economy.unpaid[s] : 0,
      effect: buildingEffect(b.good, b.amount, b.percent, good),
      upkeep: upkeep.join(' + ') || 'none',
    });
  }
  return {
    wood: economy.stock[cell * MATERIAL_COUNT + Material.Wood],
    stone: economy.stock[cell * MATERIAL_COUNT + Material.Stone],
    harvest: {
      wood: harvestTerms(world, economy, cell, Good.Wood, yieldFactor(sim.satisfaction[cell])),
      stone: harvestTerms(world, economy, cell, Good.Stone, yieldFactor(sim.satisfaction[cell])),
    },
    upkeepWood: upkeepWith(sim, cell, Material.Wood, -1, -1),
    upkeepStone: upkeepWith(sim, cell, Material.Stone, -1, -1),
    buildings,
    slots: usableSlots(sim, cell),
    trade: hexTrade(sim, cell),
    government: {
      seat: gov.district[cell],
      capital: gov.district[cell] >= 0 && sim.civs[world.owner[cell]]?.capital === gov.district[cell],
      rate: gov.cellRate[cell],
      goodsRate: gov.cellGoodsRate[cell],
      wood: gov.stock[cell * MATERIAL_COUNT + Material.Wood],
      stone: gov.stock[cell * MATERIAL_COUNT + Material.Stone],
      buildings: govBuildings,
      slots: usableSlots(sim, cell),
    },
  };
}

function hexTrade(sim: Simulation, cell: number): HexTrade {
  const { economy, trade } = sim;
  const asks: HexTrade['asks'] = [];
  const spares: HexTrade['spares'] = [];
  for (let g = 0; g < TRADE_GOODS; g++) {
    const want = trade.want[cell * TRADE_GOODS + g];
    const spare = trade.surplus[cell * TRADE_GOODS + g];
    if (want >= 0.5) asks.push({ good: TRADE_GOOD_NAMES[g], amount: want });
    if (spare >= 0.5) spares.push({ good: TRADE_GOOD_NAMES[g], amount: spare });
  }
  return {
    money: economy.money[cell],
    income: sim.cellAdults[cell] * MONEY_PER_ADULT,
    grain: economy.provisions[cell * 2],
    barrels: economy.provisions[cell * 2 + 1],
    merchants: trade.merchants[cell],
    away: trade.away[cell],
    partner: trade.partner[cell],
    asks,
    spares,
  };
}

/** E.g. "+25 food", "+50 % water", "+5 wood/year", "comfort for 50", "+10 salt/year". */
function buildingEffect(good: number, amount: number, percent: number, name: string): string {
  if (good === Good.Comfort) return `comfort for ${amount}`;
  if (good === Good.Seat) return 'seat of government';
  if (good === Good.Merchants) return `${amount} merchants`;
  if (good === Good.Harbor) return `trade over water, ${amount} merchants`;
  if (good === Good.Grain) return `−${amount} food → +${amount} grain/year`;
  if (good === Good.Barrels) return `−${amount} water → +${amount} water barrels/year`;
  if (percent) return `+${Math.round(percent * 100)} % ${name}`;
  return `+${amount} ${name}${good >= SUPPLY_KINDS ? '/year' : ''}`;
}

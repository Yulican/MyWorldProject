import { DIRECTION_COUNT } from '../hex';
import { sumTerms, type Term } from '../terms';
import { isWaterBiome } from '../world/biomes';
import {
  BUILDINGS,
  FIRST_LUXURY,
  GOOD_NAMES,
  Good,
  LUXURY_COUNT,
  MATERIAL_COUNT,
  Material,
  REPAIR_SHARE,
  SLOTS,
  SlotState,
  UPKEEP_GRACE_YEARS,
  buildingSupplyModifiers,
  forageYield,
  harvestTerms,
  isLuxury,
  isMaterial,
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
import type { Simulation } from './simulation';
import { PROTO } from './tuning';
import { SUPPLY_KINDS, supplySums, type SupplyModifier } from './supply';
import { MONEY_PER_ADULT, PROVISIONS_MAX, TRADE_GOODS, TRADE_GOOD_NAMES, buildTradeRoad, isCoast, provisionModifiers, sendMerchants, updateTradeBuildings, updateTradeNeeds, wantedTradeBuilding } from './trade';

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
/** Seats of government a people considers per year (its worst-connected settlements). */
const SEAT_CANDIDATES = 3;

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
function capacityWith(sim: Simulation, cell: number, extraA: number, extraB: number): number {
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
  const of = (t: number) => (material === Material.Wood ? BUILDINGS[t].upkeepWood : BUILDINGS[t].upkeepStone);
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (economy.state[s] === SlotState.Standing) sum += of(economy.type[s]);
  }
  if (extraA >= 0) sum += of(extraA);
  if (extraB >= 0) sum += of(extraB);
  return sum;
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
      if (sim.hasBuildings[c]) harvestLuxury(sim, c, yearEnd);
    }
    let busy = false;
    let supplyChanged = false;
    for (let s = c * SLOTS, end = s + SLOTS; s < end; s++) {
      const st = economy.state[s];
      if (st === SlotState.Construction || st === SlotState.Repair) {
        // Only people build; an empty hex's construction site waits.
        if (people > 0) economy.work[s] -= 1 / STEPS_PER_YEAR;
        if (economy.work[s] > 1e-4) busy = true;
        else {
          economy.state[s] = SlotState.Standing;
          economy.work[s] = 0;
          economy.unpaid[s] = 0;
          supplyChanged = true;
        }
      } else if (st === SlotState.Standing && yearEnd) {
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
      const moodFirst = PROTO.satisfactionFirst && sim.satisfaction[c] < PROTO.satisfactionFirstBelow;
      const started =
        !busy &&
        (moodFirst ? planSatisfaction(sim, c) || planBuilding(sim, c) : planBuilding(sim, c) || planSatisfaction(sim, c));
      if (started || (!busy && yearEnd && planTrade(sim, c))) supplyChanged = true;
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
function planBuilding(sim: Simulation, cell: number): boolean {
  const { economy } = sim;
  const capacity = sim.cellCapacity[cell];
  if (sim.cellPop[cell] < BUILD_FROM_CROWDING * capacity) return false;
  let free = 0;
  let ruins = 0;
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (economy.state[s] === SlotState.Empty) free++;
    else if (economy.state[s] === SlotState.Ruin) ruins++;
  }
  const newAllowed = free > 0 && !canExpand(sim, cell);
  if (!newAllowed && ruins === 0) return false;
  const wood = economy.stock[cell * MATERIAL_COUNT + Material.Wood];
  const stone = economy.stock[cell * MATERIAL_COUNT + Material.Stone];
  const netWood = netWith(sim, cell, Material.Wood, -1, -1);
  const netStone = netWith(sim, cell, Material.Stone, -1, -1);

  let bestGain = 0;
  let bestTime = Infinity;
  let bestSlot = -1; // a ruin slot to repair, or -1 for a new building
  let bestType = -1;
  let firstSlot = -1; // production building to put up first, if any
  let firstType = -1;

  // Options: every population building type in a free slot, every ruined one repaired.
  for (let option = 0; option < BUILDINGS.length + SLOTS; option++) {
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
    if (netWith(sim, cell, Material.Wood, type, -1) >= 0 && netWith(sim, cell, Material.Stone, type, -1) >= 0) {
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
    for (let first = 0; first < BUILDINGS.length + SLOTS; first++) {
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
      const netWood2 = netWith(sim, cell, Material.Wood, ptype, -1);
      const netStone2 = netWith(sim, cell, Material.Stone, ptype, -1);
      if (netWood2 < 0 || netStone2 < 0) continue;
      if (netWith(sim, cell, Material.Wood, ptype, type) < 0 || netWith(sim, cell, Material.Stone, ptype, type) < 0) continue;
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
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) if (economy.state[s] === SlotState.Empty) free = true;
  if (!free) return false;
  const b = BUILDINGS[type];
  if (economy.stock[cell * MATERIAL_COUNT + Material.Wood] < b.wood || economy.stock[cell * MATERIAL_COUNT + Material.Stone] < b.stone) return false;
  if (netWith(sim, cell, Material.Wood, type, -1) < 0 || netWith(sim, cell, Material.Stone, type, -1) < 0) return false;
  return startConstruction(sim, cell, -1, type);
}

/**
 * A quarter of the luxury goods the hex's standing buildings harvest from
 * its deposit; at the year's end its people use their yearly need of each,
 * and the goods whose need the stock covered count for their satisfaction.
 */
function harvestLuxury(sim: Simulation, cell: number, yearEnd: boolean): void {
  const { economy } = sim;
  const factor = yieldFactor(sim.satisfaction[cell]);
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (economy.state[s] !== SlotState.Standing) continue;
    const b = BUILDINGS[economy.type[s]];
    if (isLuxury(b.good)) economy.luxury[cell * LUXURY_COUNT + b.good - FIRST_LUXURY] += (b.amount * factor) / STEPS_PER_YEAR;
    else if (b.good === Good.Grain || b.good === Good.Barrels) economy.provisions[cell * 2 + (b.good === Good.Grain ? 0 : 1)] += b.amount / STEPS_PER_YEAR;
  }
  if (!yearEnd) return;
  const need = sim.cellPop[cell] * LUXURY_PER_PERSON;
  let covered = 0;
  for (let k = 0; k < LUXURY_COUNT; k++) {
    const i = cell * LUXURY_COUNT + k;
    if (economy.luxury[i] <= 0) continue;
    if (economy.luxury[i] >= need) covered |= 1 << k;
    economy.luxury[i] = Math.max(0, economy.luxury[i] - need);
  }
  economy.luxuryCovered[cell] = covered;
}

/** Whether a hex can have a building of this type at all (deposit, water). */
function buildingFits(sim: Simulation, cell: number, type: number): boolean {
  const b = BUILDINGS[type];
  if (b.deposit !== undefined && sim.world.deposit[cell] !== b.deposit) return false;
  if (b.waterSurplus !== undefined && sim.cellSupply[cell * SUPPLY_KINDS + 1] - sim.cellPop[cell] < b.waterSurplus) return false;
  if (b.coast && !isCoast(sim.world, cell)) return false;
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
 * When a settlement is unhappy but has the food, water and space it needs
 * (and nothing to build for its growth): the comfort building or luxury
 * workshop that raises its satisfaction most among those it pays for within
 * SAVE_UP_YEARS and keeps up for good, new or repaired. Starts it when
 * affordable, else saves up. Returns whether construction started.
 */
function planSatisfaction(sim: Simulation, cell: number): boolean {
  const { economy } = sim;
  const people = sim.cellPop[cell];
  const below = PROTO.satisfactionFirst ? PROTO.satisfactionFirstBelow : 0;
  if (sim.satisfaction[cell] >= below || people > sim.cellCapacity[cell]) return false;
  let free = 0;
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) if (economy.state[s] === SlotState.Empty) free++;
  const wood = economy.stock[cell * MATERIAL_COUNT + Material.Wood];
  const stone = economy.stock[cell * MATERIAL_COUNT + Material.Stone];
  const netWood = netWith(sim, cell, Material.Wood, -1, -1);
  const netStone = netWith(sim, cell, Material.Stone, -1, -1);
  const served = comfortServed(economy, cell);
  const luxuryNow = luxuryValue(economy.luxuryCovered[cell]);

  let bestGain = MIN_SATISFACTION_GAIN;
  let bestTime = Infinity;
  let bestSlot = -1;
  let bestType = -1;
  for (let option = 0; option < BUILDINGS.length + SLOTS; option++) {
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
    if (netWith(sim, cell, Material.Wood, type, -1) < 0 || netWith(sim, cell, Material.Stone, type, -1) < 0) continue;
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
 * Yearly, per people: a seat of government in the settlement whose
 * settlements would gain the most connection satisfaction together (at
 * least SEAT_MIN_BENEFIT), among its SEAT_CANDIDATES worst-connected
 * settlements that keep SEAT_MIN_COST from every seat. The settlement pays
 * it from its own stock (or repairs a ruined seat); one seat at a time.
 */
export function planSeats(sim: Simulation, owner: Uint8Array): void {
  const { economy, world } = sim;
  const n = world.cellCount;
  // One pass: peoples already building a seat, and every people's candidates.
  const busy = new Uint8Array(sim.civSlots);
  const candidates: number[][] = [];
  for (let c = 0; c < n; c++) {
    const id = owner[c];
    if (id === 0) continue;
    if (sim.hasBuildings[c]) {
      for (let s = c * SLOTS, end = s + SLOTS; s < end; s++) {
        const st = economy.state[s];
        if ((st === SlotState.Construction || st === SlotState.Repair) && economy.type[s] === SEAT_TYPE) busy[id] = 1;
      }
    }
    if (sim.cellPop[c] < EXPANSION_GROUP || sim.seatCost[c] < SEAT_MIN_COST || seatSlot(sim, c) === null) continue;
    (candidates[id] ??= []).push(c);
  }
  const field = scratchField(n);
  for (let id = 1; id < sim.civSlots; id++) {
    const list = candidates[id];
    if (!sim.civs[id] || busy[id] || !list) continue;
    // Its worst-connected settlements.
    list.sort((a, b) => sim.seatCost[b] - sim.seatCost[a] || a - b);
    let best = -1;
    let bestBenefit = SEAT_MIN_BENEFIT;
    for (const c of list.slice(0, SEAT_CANDIDATES)) {
      const reached = seatField(sim, owner, id, [c], field);
      let benefit = 0;
      for (const k of reached) {
        benefit += Math.max(0, connectionValue(field[k]) - connectionValue(sim.seatCost[k]));
        field[k] = Infinity;
      }
      if (benefit > bestBenefit) {
        bestBenefit = benefit;
        best = c;
      }
    }
    if (best < 0) continue;
    const slot = seatSlot(sim, best)!;
    const b = BUILDINGS[SEAT_TYPE];
    const share = slot >= 0 ? REPAIR_SHARE : 1;
    if (economy.stock[best * MATERIAL_COUNT + Material.Wood] < b.wood * share) continue;
    if (economy.stock[best * MATERIAL_COUNT + Material.Stone] < b.stone * share) continue;
    if (netWith(sim, best, Material.Wood, SEAT_TYPE, -1) < 0 || netWith(sim, best, Material.Stone, SEAT_TYPE, -1) < 0) continue;
    startConstruction(sim, best, slot, SEAT_TYPE);
  }
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
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
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
    for (let s = cell * SLOTS, end = s + SLOTS; s < end && slot < 0; s++) if (economy.state[s] === SlotState.Empty) slot = s;
    if (slot < 0) return false;
    economy.type[slot] = type;
  }
  economy.stock[cell * MATERIAL_COUNT + Material.Wood] -= b.wood * share;
  economy.stock[cell * MATERIAL_COUNT + Material.Stone] -= b.stone * share;
  economy.state[slot] = share < 1 ? SlotState.Repair : SlotState.Construction;
  economy.work[slot] = b.years * share;
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
  const { economy, world } = sim;
  const buildings: BuildingInfo[] = [];
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    const st = economy.state[s];
    if (st === SlotState.Empty) continue;
    const b = BUILDINGS[economy.type[s]];
    const good = GOOD_NAMES[b.good].toLowerCase();
    const upkeep = [b.upkeepWood ? `${b.upkeepWood} wood` : '', b.upkeepStone ? `${b.upkeepStone} stone` : ''].filter(Boolean);
    buildings.push({
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
    slots: SLOTS,
    trade: hexTrade(sim, cell),
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

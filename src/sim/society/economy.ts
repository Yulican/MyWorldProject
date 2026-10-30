import { DIRECTION_COUNT } from '../hex';
import { sumTerms, type Term } from '../terms';
import { isWaterBiome } from '../world/biomes';
import {
  BUILDINGS,
  GOOD_NAMES,
  Good,
  MATERIAL_COUNT,
  Material,
  REPAIR_SHARE,
  SLOTS,
  SlotState,
  UPKEEP_GRACE_YEARS,
  buildingSupplyModifiers,
  forageYield,
  harvestTerms,
  withBuildings,
} from './buildings';
import type { Simulation } from './simulation';
import { SUPPLY_KINDS, supplyTerms, type SupplyModifier } from './supply';

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

const NO_MODIFIERS: readonly SupplyModifier[] = [];

/**
 * Recomputes a hex's food, water and space and the people it supports, from
 * nature, `sim.supplyModifiers` and its standing buildings. Keeps the value
 * without buildings in `sim.baseSupply` for planning.
 */
export function updateCellSupply(sim: Simulation, cell: number): void {
  const other = sim.supplyModifiers.get(cell) ?? NO_MODIFIERS;
  const base = supplyTerms(sim.world, cell, other);
  const buildings = buildingSupplyModifiers(sim.economy, cell);
  const terms = buildings.length > 0 ? supplyTerms(sim.world, cell, [...other, ...buildings]) : base;
  let capacity = Infinity;
  for (let k = 0; k < SUPPLY_KINDS; k++) {
    sim.baseSupply[cell * SUPPLY_KINDS + k] = sumTerms(base[k]);
    const v = sumTerms(terms[k]);
    sim.cellSupply[cell * SUPPLY_KINDS + k] = v;
    capacity = Math.min(capacity, v);
  }
  sim.cellCapacity[cell] = capacity;
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

/** Yearly wood or stone harvest with the standing buildings plus up to two extra types. */
function harvestWith(sim: Simulation, cell: number, good: number, extraA: number, extraB: number): number {
  return withBuildings(sim.economy, cell, good, forageYield(sim.world, cell, good), extraA, extraB);
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
    if (supplyChanged) updateCellSupply(sim, c);
    if (people > 0 && !busy && planBuilding(sim, c)) supplyChanged = true;
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
      if (p.good < SUPPLY_KINDS) continue;
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
  if (bestTime > 0) return false; // saving up
  return startConstruction(sim, cell, bestSlot, bestType);
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
      effect: b.percent ? `+${Math.round(b.percent * 100)} % ${good}` : `+${b.amount} ${good}${b.good >= SUPPLY_KINDS ? '/year' : ''}`,
      upkeep: upkeep.join(' + ') || 'none',
    });
  }
  return {
    wood: economy.stock[cell * MATERIAL_COUNT + Material.Wood],
    stone: economy.stock[cell * MATERIAL_COUNT + Material.Stone],
    harvest: { wood: harvestTerms(world, economy, cell, Good.Wood), stone: harvestTerms(world, economy, cell, Good.Stone) },
    upkeepWood: upkeepWith(sim, cell, Material.Wood, -1, -1),
    upkeepStone: upkeepWith(sim, cell, Material.Stone, -1, -1),
    buildings,
    slots: SLOTS,
  };
}

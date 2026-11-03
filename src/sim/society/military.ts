import { BUILDINGS, Good, SETTLEMENT_SLOTS, SLOTS, STORED_COUNT, SlotState, FIRST_LUXURY } from './buildings';
import { GOV_TUNING } from './taxes';
import type { Simulation } from './simulation';

// Soldiers without combat (war phase 1; "Design Documents/Requirement
// Krieg.md", sections 2 and 10). Barracks, shooting ranges and stables train
// soldiers from the settlement's adults each year, up to MIL.capacity per
// building. Soldiers are paid in money from the district treasury (the income
// check of the government counts their pay like upkeep); unpaid soldiers
// desert. Strategic goods (iron for melee, flint for ranged, horses for
// shock) make a troop type MIL.factor times as strong while they last. A
// people's strength (soldiers with factors) replaces its population in the
// danger it poses to its neighbors (diplomacy.ts). All state lives in flat
// typed arrays.

/**
 * The numbers (tools/warStats.ts can vary them by name):
 * - `enabled`: 0 = no military at all (phase 0 only).
 * - `capacity`: soldiers one building houses.
 * - `trainShare`: share of its capacity a building trains per year.
 * - `sold`: money one soldier costs the district treasury per year.
 * - `factor`: strength of a troop type with its strategic good.
 * - `perN`: soldiers one unit of the strategic good a year serves.
 * - `keepYears`: years of that need a settlement keeps in stock and asks for.
 * - `saleDanger`: strategic goods are sold only to peoples whose danger for the seller is at most this.
 * - `goldRate`: money per unit of gold mined (today's trade price).
 * - `dangerMode`: 0 = danger from population (before), 1 = from strength.
 * - `floor`: strength every people counts on top (danger is a ratio; nobody has 0 against 0).
 * - `minPop`: smallest settlement that builds a military building.
 * - `maxPopShare`: largest share of a settlement's people that are soldiers.
 * - `treasuryShare`: share of the district treasury that may commit to the pay of new soldiers next year.
 * - `reserveSlots`: free building slots a settlement keeps for its growth buildings when it builds a military building.
 * - `pool`: 1 = a district short of money gets it from the people's richest other seats before soldiers desert (0 = district treasury only, as designed).
 * - `captureStrategic`: 1 = peoples also settle free iron and flint deposits (like luxury deposits, simulation.ts: captureDeposits).
 * - `mineAlways`: 1 = a settlement on an iron or flint deposit always mines it (economy.ts: planDeposit).
 * - `govBuild`: 1 = seats build military buildings as government projects (government.ts: chooseProject), priority loyalty > military > growth.
 * - `threatDanger`: a people feels threatened (arms) when another's danger for it is at least this (50 = equal strength at nearness 1).
 * - `spareYears`: a seat with this many years of one building's pay in its treasury counts as having resources to spare.
 * - `govGoods`: 1 = the seat's government traders buy iron, flint and horses for soldiers that lack them from the people's settlements that spare them (paid from the treasury, MERCHANT-sized loads per trader).
 * - `build`: 1 = settlements build military buildings (placeholder rule), 0 = only what a test sets up.
 */
export const MIL = {
  enabled: 1,
  capacity: 20,
  trainShare: 0.25,
  sold: 0.1,
  factor: 1.5,
  perN: 20,
  keepYears: 2,
  saleDanger: 40,
  goldRate: 5,
  dangerMode: 1,
  floor: 20,
  minPop: 40,
  maxPopShare: 0.1,
  treasuryShare: 1,
  pool: 1,
  captureStrategic: 0,
  reserveSlots: 2,
  build: 0,
  mineAlways: 0,
  govBuild: 1,
  threatDanger: 50,
  govGoods: 0,
  spareYears: 5,
};

export const TROOP_TYPES = 3;
/** Troop types: melee, ranged, shock. */
export const Troop = { Melee: 0, Ranged: 1, Shock: 2 } as const;
/** The building good of each troop type, and the strategic good (index into the stored goods, good - FIRST_LUXURY) it needs. */
export const TROOP_BUILDING = [Good.Barracks, Good.Range, Good.Stable] as const;
export const TROOP_GOOD = [Good.Iron - FIRST_LUXURY, Good.Flint - FIRST_LUXURY, Good.Horses - FIRST_LUXURY] as const;
/** Types of the military buildings in the catalog, per troop type. */
export const TROOP_TYPE_OF_BUILDING = TROOP_BUILDING.map((g) => BUILDINGS.findIndex((b) => b.good === g));

export type Military = {
  /** Soldiers per cell and troop type: cell * TROOP_TYPES + type. */
  soldiers: Uint16Array;
  /** Capacity of the cell's standing military buildings, per troop type. */
  cap: Uint16Array;
  /** 1 if the soldiers got their strategic good this year. */
  covered: Uint8Array;
  /** Per seat cell: capacity of its district's military buildings (standing or being built), the pay that capacity commits. */
  districtCap: Float32Array;
  /** Soldiers to draw from the cell's adults (simulation.ts: drawSoldiers). */
  train: Uint16Array;
  /** Per people (civilization id): strength, soldiers (all types) and soldiers per troop type. */
  strength: Float64Array;
  soldiersOf: Float64Array;
  /** Statistics, summed over the run. */
  trained: number;
  deserted: number;
  disbanded: number;
  paid: number;
  goldMined: number;
  goodsUsed: number;
  /** Iron+flint mined, needed by the soldiers (soldiers / perN a year) and bought by government traders (units, summed over years). */
  goodsMined: number;
  goodsNeeded: number;
  goodsBought: number;
  goldTaxed: number;
  uncovered: number;
};

export function createMilitary(cellCount: number): Military {
  return {
    soldiers: new Uint16Array(cellCount * TROOP_TYPES),
    cap: new Uint16Array(cellCount * TROOP_TYPES),
    covered: new Uint8Array(cellCount * TROOP_TYPES),
    districtCap: new Float32Array(cellCount),
    train: new Uint16Array(cellCount),
    strength: new Float64Array(0),
    soldiersOf: new Float64Array(0),
    trained: 0,
    deserted: 0,
    disbanded: 0,
    paid: 0,
    goldMined: 0,
    goodsUsed: 0,
    goodsMined: 0,
    goodsNeeded: 0,
    goodsBought: 0,
    goldTaxed: 0,
    uncovered: 0,
  };
}

/** Strategic goods a settlement keeps and asks for: troop type -> yearly units for its building capacity. */
export function yearlyGoodNeed(sim: Simulation, cell: number, type: number): number {
  return sim.military.cap[cell * TROOP_TYPES + type] / MIL.perN;
}

/** The strength of a people against another's, as a danger: 50 × theirs ÷ ours, at most 100 (before nearness). */
export function strengthSize(sim: Simulation, a: number, b: number, scale: number): number {
  const m = sim.military;
  const sa = (a < m.strength.length ? m.strength[a] : 0) + MIL.floor;
  const sb = (b < m.strength.length ? m.strength[b] : 0) + MIL.floor;
  return Math.min(100, (scale * sb) / Math.max(1, sa));
}

/** Soldiers the district of `seat` can still house in new buildings within the income check (soldiers' pay is counted like upkeep). */
export function districtRoom(sim: Simulation, seat: number): number {
  const gov = sim.government;
  const budget = GOV_TUNING.incomeShare * gov.potential[seat] - gov.upkeep[seat];
  return Math.floor(budget / MIL.sold) - sim.military.districtCap[seat];
}

/** The pay the district's military buildings commit per year (the government counts it in its income check). */
export function districtPay(sim: Simulation, seat: number): number {
  return sim.military.districtCap[seat] * MIL.sold;
}

/**
 * Yearly, a few weeks after the government's year: soldiers over the capacity
 * of their buildings are disbanded, the district treasury pays the soldiers
 * (those it can't pay desert), buildings train new soldiers (within the
 * income check), strategic goods are used up, and every people's strength is
 * counted. Inhabitants for the soldiers are drawn by simulation.ts
 * (drawSoldiers) from `military.train`.
 */
export function updateMilitary(sim: Simulation, owner: Uint8Array): void {
  const m = sim.military;
  const gov = sim.government;
  const eco = sim.economy;
  const n = sim.world.cellCount;
  m.train.fill(0);
  m.districtCap.fill(0);
  if (m.strength.length !== sim.civSlots) {
    m.strength = new Float64Array(sim.civSlots);
    m.soldiersOf = new Float64Array(sim.civSlots * TROOP_TYPES);
  } else {
    m.strength.fill(0);
    m.soldiersOf.fill(0);
  }
  if (!MIL.enabled) return;

  // Capacity of the standing military buildings; soldiers beyond it (or without people, or a district) leave.
  // Capacity standing or being built commits the district's pay.
  const sums = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    const d = gov.district[c];
    const base = c * TROOP_TYPES;
    for (let t = 0; t < TROOP_TYPES; t++) m.cap[base + t] = 0;
    if (sim.hasBuildings[c]) {
      for (let s = c * SLOTS, end = s + SLOTS; s < end; s++) {
        const st = eco.state[s];
        if (st !== SlotState.Standing && st !== SlotState.Construction) continue;
        const good = BUILDINGS[eco.type[s]].good;
        const t = TROOP_BUILDING.indexOf(good as never);
        if (t < 0) continue;
        if (d >= 0) m.districtCap[d] += MIL.capacity;
        if (st === SlotState.Standing) m.cap[base + t] += MIL.capacity;
      }
    }
    for (let t = 0; t < TROOP_TYPES; t++) {
      let have = m.soldiers[base + t];
      if (have === 0) continue;
      const keep = sim.cellPop[c] > 0 && d >= 0 ? Math.min(have, m.cap[base + t]) : 0;
      m.disbanded += have - keep;
      m.soldiers[base + t] = keep;
      have = keep;
      sums[d >= 0 ? d : c] += have;
    }
  }

  // Pay: the district treasury pays every soldier; what it can't pay deserts (evenly over the district's settlements).
  const unpaidShare = new Float32Array(n);
  for (let s = 0; s < n; s++) {
    const total = sums[s];
    if (total <= 0) continue;
    const cost = total * MIL.sold;
    if (gov.treasury[s] >= cost) {
      gov.treasury[s] -= cost;
      m.paid += cost;
    } else {
      if (MIL.pool) {
        // The people's other seats lend what the district lacks (richest first).
        let lack = cost - gov.treasury[s];
        while (lack > 1e-6) {
          let rich = -1;
          for (let o = 0; o < n; o++) {
            if (o !== s && gov.traders[o] > 0 && owner[o] === owner[s] && (rich < 0 || gov.treasury[o] > gov.treasury[rich])) rich = o;
          }
          if (rich < 0 || gov.treasury[rich] <= 0) break;
          const take = Math.min(lack, gov.treasury[rich]);
          gov.treasury[rich] -= take;
          gov.treasury[s] += take;
          lack -= take;
        }
        if (gov.treasury[s] >= cost) {
          gov.treasury[s] -= cost;
          m.paid += cost;
          continue;
        }
      }
      const afford = Math.floor(gov.treasury[s] / MIL.sold);
      gov.treasury[s] -= afford * MIL.sold;
      m.paid += afford * MIL.sold;
      unpaidShare[s] = (total - afford) / total;
    }
  }
  // Soldiers the treasury can still pay next year beyond those who stay (no training on credit).
  const afford = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const d = gov.district[c];
    if (d < 0) continue;
    for (let t = 0; t < TROOP_TYPES; t++) {
      const i = c * TROOP_TYPES + t;
      if (unpaidShare[d] > 0) {
        const leave = Math.min(m.soldiers[i], Math.ceil(m.soldiers[i] * unpaidShare[d]));
        m.soldiers[i] -= leave;
        m.deserted += leave;
      }
      afford[d] -= m.soldiers[i];
    }
  }
  for (let c = 0; c < n; c++) {
    const d = gov.district[c];
    if (d === c) afford[d] += Math.floor(gov.treasury[d] / MIL.sold) * MIL.treasuryShare;
  }

  // The government keeps next year's pay of the soldiers that stay (and the new ones below) out of its spending.
  gov.reserve.fill(0);
  for (let c = 0; c < n; c++) {
    const d = gov.district[c];
    if (d < 0) continue;
    for (let t = 0; t < TROOP_TYPES; t++) gov.reserve[d] += m.soldiers[c * TROOP_TYPES + t] * MIL.sold;
  }
  // Pooled: the people's seats together pay for next year's soldiers.
  const civAfford = new Float32Array(sim.civSlots);
  if (MIL.pool) {
    for (let c = 0; c < n; c++) {
      const civ = owner[c];
      if (civ === 0) continue;
      for (let t = 0; t < TROOP_TYPES; t++) civAfford[civ] -= m.soldiers[c * TROOP_TYPES + t];
      if (gov.traders[c] > 0) civAfford[civ] += Math.floor(gov.treasury[c] / MIL.sold) * MIL.treasuryShare;
    }
  }
  // Training: each building trains MIL.trainShare of its capacity a year, within the settlement's people, its
  // share of soldiers and the district's room (soldiers + free capacity cost pay; buildings were only built within it).
  for (let c = 0; c < n; c++) {
    const people = sim.cellPop[c];
    if (people === 0) continue;
    const base = c * TROOP_TYPES;
    let have = 0;
    for (let t = 0; t < TROOP_TYPES; t++) have += m.soldiers[base + t];
    let room = Math.min(Math.floor(MIL.maxPopShare * people) - have, Math.floor(0.5 * sim.cellAdults[c]));
    const dist = gov.district[c];
    if (dist < 0) continue;
    for (let t = 0; t < TROOP_TYPES && room > 0; t++) {
      const cap = m.cap[base + t];
      if (cap <= 0 || m.soldiers[base + t] >= cap) continue;
      // Stables need horses at hand.
      if (t === Troop.Shock && eco.luxury[c * STORED_COUNT + TROOP_GOOD[t]] < 1) continue;
      const add = Math.min(cap - m.soldiers[base + t], Math.ceil(MIL.trainShare * cap), room, Math.floor(MIL.pool ? civAfford[owner[c]] : afford[dist]));
      if (add <= 0) continue;
      if (MIL.pool) civAfford[owner[c]] -= add;
      else afford[dist] -= add;
      m.soldiers[base + t] += add;
      m.train[c] += add;
      m.trained += add;
      if (dist >= 0) gov.reserve[dist] += add * MIL.sold;
      room -= add;
    }
  }

  if (MIL.govGoods) governmentBuys(sim, owner);

  // Strategic goods: soldiers use MIL.perN^-1 units a year; a troop type without its good is not stronger.
  for (let c = 0; c < n; c++) {
    const base = c * TROOP_TYPES;
    const civ = owner[c];
    for (let t = 0; t < TROOP_TYPES; t++) {
      const count = m.soldiers[base + t];
      if (count === 0) {
        m.covered[base + t] = 0;
        continue;
      }
      const need = count / MIL.perN;
      if (t !== Troop.Shock) m.goodsNeeded += need;
      const i = c * STORED_COUNT + TROOP_GOOD[t];
      const covered = eco.luxury[i] >= need;
      if (covered) {
        eco.luxury[i] -= need;
        m.goodsUsed += need;
      } else m.uncovered += count;
      m.covered[base + t] = covered ? 1 : 0;
      if (civ > 0) {
        m.strength[civ] += count * (covered ? MIL.factor : 1);
        m.soldiersOf[civ * TROOP_TYPES + t] += count;
      }
    }
  }
}

/** Total soldiers of a cell (all troop types). */
export function soldiersAt(sim: Simulation, cell: number): number {
  const base = cell * TROOP_TYPES;
  return sim.military.soldiers[base] + sim.military.soldiers[base + 1] + sim.military.soldiers[base + 2];
}

/**
 * Whether the seat's people arms (government.ts: chooseProject): a stronger
 * people is near (danger for us at least MIL.threatDanger, the strength ratio
 * weighted by nearness), settlements of the district are dissatisfied
 * (satisfaction < 0), or the seat has resources to spare (treasury of
 * MIL.spareYears years of one building's pay). Always within the income check.
 */
export function armingWanted(sim: Simulation, seat: number, pairs: number): boolean {
  const civ = sim.world.owner[seat];
  if (civ === 0 || districtRoom(sim, seat) < MIL.capacity) return false;
  if (sim.government.treasury[seat] >= MIL.spareYears * MIL.capacity * MIL.sold) return true;
  const d = sim.diplomacy.danger;
  for (let b = 1; b < pairs; b++) if (b !== civ && d[civ * pairs + b] >= MIL.threatDanger) return true;
  const gov = sim.government;
  for (let c = 0; c < sim.world.cellCount; c++) if (gov.district[c] === seat && sim.cellPop[c] > 0 && sim.satisfaction[c] < 0) return true;
  return false;
}

/** The troop type the people has the least of and the cell can host (-1 = none); ties go by cell. */
export function pickTroopType(sim: Simulation, cell: number, has: (good: number) => boolean): number {
  const civ = sim.world.owner[cell];
  let best = -1;
  let bestN = Infinity;
  for (let k = 0; k < TROOP_TYPES; k++) {
    const t = (k + cell) % TROOP_TYPES;
    if (has(TROOP_BUILDING[t])) continue;
    if (t === Troop.Shock && sim.economy.luxury[cell * STORED_COUNT + TROOP_GOOD[t]] < 1) continue;
    const have = civ * TROOP_TYPES + t < sim.military.soldiersOf.length ? sim.military.soldiersOf[civ * TROOP_TYPES + t] : 0;
    if (have < bestN) {
      bestN = have;
      best = t;
    }
  }
  return best;
}

/** Whether the people feels threatened: some people's danger for it is at least MIL.threatDanger. */
export function threatened(sim: Simulation, civ: number, pairs: number): boolean {
  const d = sim.diplomacy.danger;
  for (let b = 1; b < pairs; b++) if (b !== civ && d[civ * pairs + b] >= MIL.threatDanger) return true;
  return false;
}

/** Load a government trader carries (units of a strategic good). */
const TRADER_UNITS = 80;

/**
 * Variant e: each seat's traders buy what its soldiers' stock lacks for the
 * year from settlements of the people that spare the good, paid from the
 * treasury beyond the pay reserve. Idealized: delivery within the week.
 */
function governmentBuys(sim: Simulation, owner: Uint8Array): void {
  const m = sim.military;
  const gov = sim.government;
  const eco = sim.economy;
  const n = sim.world.cellCount;
  const left = new Float32Array(n);
  for (let c = 0; c < n; c++) if (gov.traders[c] > 0) left[c] = gov.traders[c] * TRADER_UNITS;
  for (let c = 0; c < n; c++) {
    const d = gov.district[c];
    if (d < 0 || left[d] <= 0) continue;
    for (let t = 0; t < TROOP_TYPES; t++) {
      const count = m.soldiers[c * TROOP_TYPES + t];
      if (count === 0) continue;
      const k = TROOP_GOOD[t];
      const i = c * STORED_COUNT + k;
      let lack = count / MIL.perN - eco.luxury[i];
      if (lack <= 0) continue;
      // The people's settlement with the most to spare of the good.
      for (let tries = 0; tries < 3 && lack > 1e-6 && left[d] > 0; tries++) {
        let src = -1;
        let best = 0;
        for (let o = 0; o < n; o++) {
          if (o === c || owner[o] !== owner[c]) continue;
          const spare = eco.luxury[o * STORED_COUNT + k] - soldiersNeed(m, o, k);
          if (spare > best) {
            best = spare;
            src = o;
          }
        }
        if (src < 0) break;
        const units = Math.min(lack, best, left[d]);
        const price = units * 5;
        if (gov.treasury[d] - gov.reserve[d] < price) break;
        gov.treasury[d] -= price;
        eco.money[src] += price;
        eco.luxury[src * STORED_COUNT + k] -= units;
        eco.luxury[i] += units;
        left[d] -= units;
        lack -= units;
        m.goodsBought += units;
      }
    }
  }
}

/** Units a cell's own soldiers need of stored good k this year. */
function soldiersNeed(m: Military, cell: number, k: number): number {
  const t = TROOP_GOOD.indexOf(k as never);
  return t < 0 ? 0 : m.soldiers[cell * TROOP_TYPES + t] / MIL.perN;
}

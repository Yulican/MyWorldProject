import { BUILDINGS, Good, SLOTS, STORED_COUNT, SlotState, FIRST_LUXURY } from './buildings';
import { GOV_TUNING } from './taxes';
import { PRICE, TradeGood } from './trade';
import type { Simulation } from './simulation';

// Soldiers without combat (war phase 1; "Design Documents/Requirement
// Krieg.md", sections 2 and 10). Barracks, shooting ranges and stables (built
// by the government, government.ts: chooseProject) train soldiers from the
// settlement's adults each year, up to MIL.capacity per building. Soldiers
// are paid in money from the district treasury, pooled with the people's
// other seats; those nobody can pay are dismissed and go back to their
// settlement. Strategic goods (iron for melee, flint for ranged, horses for
// shock) make a troop type MIL.factor times as strong while they last; the
// seats' government traders buy what the soldiers lack from the people's own
// settlements. A people's strength (soldiers with factors) replaces its
// population in the danger it poses to its neighbors (diplomacy.ts). All
// state lives in flat typed arrays; the yearly update is one pass over the
// cells plus short per-people lists.

/**
 * The numbers of war phases 0 and 1 (tools/warStats.ts can vary them by name):
 * - `capacity`: soldiers one military building houses.
 * - `trainShare`: share of its capacity a building trains per year.
 * - `sold`: money one soldier costs the district treasury per year.
 * - `factor`: strength of a troop type with its strategic good.
 * - `perN`: soldiers one unit of the strategic good a year serves.
 * - `keepYears`: years of that need a settlement keeps in stock and asks for.
 * - `wish`: weight of the soldiers' need of iron and flint in what a settlement asks for (trade agreements form from lacks).
 * - `saleDanger`: strategic goods are sold only to peoples whose danger for the seller is at most this.
 * - `goldRate`: money per unit of gold mined.
 * - `floor`: strength every people counts on top (danger is a ratio; nobody has 0 against 0).
 * - `minPop`: smallest settlement that gets a military building.
 * - `maxPopShare`, `maxAdultShare`: largest share of a settlement's people that are soldiers, and of its adults trained in one year.
 * - `threatDanger`: a people feels threatened (arms, settles iron and flint) when another's danger for it is at least this.
 * - `spareYears`: a seat with this many years of one building's pay in its treasury has resources to spare (arms).
 * - `traderUnits`: units of a strategic good one government trader buys a year.
 */
export const MIL = {
  capacity: 20,
  trainShare: 0.25,
  sold: 0.1,
  factor: 1.5,
  perN: 20,
  keepYears: 2,
  wish: 5,
  saleDanger: 40,
  goldRate: 5,
  floor: 20,
  minPop: 40,
  maxPopShare: 0.1,
  maxAdultShare: 0.5,
  threatDanger: 50,
  spareYears: 5,
  traderUnits: 80,
};

export const TROOP_TYPES = 3;
/** Troop types: melee, ranged, shock. */
export const Troop = { Melee: 0, Ranged: 1, Shock: 2 } as const;
export const TROOP_NAMES = ['Melee', 'Ranged', 'Shock'] as const;
/** The building good of each troop type, and the strategic good (index into the stored goods, good - FIRST_LUXURY) it needs. */
export const TROOP_BUILDING = [Good.Barracks, Good.Range, Good.Stable] as const;
export const TROOP_GOOD = [Good.Iron - FIRST_LUXURY, Good.Flint - FIRST_LUXURY, Good.Horses - FIRST_LUXURY] as const;
/** Types of the military buildings in the catalog, per troop type. */
export const TROOP_TYPE_OF_BUILDING = TROOP_BUILDING.map((g) => BUILDINGS.findIndex((b) => b.good === g));
/** Troop type of every building type, -1 for the others. */
const TROOP_OF_TYPE = Int8Array.from(BUILDINGS, (b) => TROOP_BUILDING.indexOf(b.good as never));
/** Troop type that needs stored good k (k = good - FIRST_LUXURY), -1 for the others. */
const TROOP_OF_GOOD = Int8Array.from({ length: STORED_COUNT }, (_, k) => TROOP_GOOD.indexOf(k as never));

export type Military = {
  /** Soldiers per cell and troop type: cell * TROOP_TYPES + type. */
  soldiers: Uint16Array;
  /** Capacity of the cell's standing military buildings, per troop type. */
  cap: Uint16Array;
  /** 1 if the soldiers got their strategic good this year. */
  covered: Uint8Array;
  /** Sum of the faith of the cell's soldiers (they bring it back when dismissed). */
  faith: Float32Array;
  /** Per seat cell: capacity of its district's military buildings (standing or being built); it commits the district's pay. */
  districtCap: Float32Array;
  /** Soldiers to draw from the cell's adults (simulation.ts: drawSoldiers). */
  train: Uint16Array;
  /** Dismissed soldiers to return to the cell's population (simulation.ts: returnSoldiers). */
  release: Uint16Array;
  /** Per people (civilization id): strength, and soldiers per troop type (civ * TROOP_TYPES + type). */
  strength: Float64Array;
  soldiersOf: Float64Array;
  /** Per seat cell: 1 if a settlement of its district is dissatisfied (prepareArming). */
  unhappy: Uint8Array;
  /** Per people: 1 if it feels threatened (prepareArming). */
  threat: Uint8Array;
  /** Scratch, per cell: soldiers per district, unpaid share, soldiers still to dismiss, what a seat's traders can still buy. */
  sums: Float64Array;
  unpaidShare: Float32Array;
  rest: Float32Array;
  left: Float32Array;
  /** Scratch, per people: soldiers its treasuries can still pay next year. */
  civAfford: Float64Array;
  /** Scratch: owned cells (and seats) grouped by people, ascending: cells of civ = list[start[civ] .. start[civ + 1]). */
  civStart: Int32Array;
  civCells: Int32Array;
  seatStart: Int32Array;
  civSeats: Int32Array;
  /** Statistics, summed over the run (tools/warStats.ts). */
  trained: number;
  dismissed: number;
  disbanded: number;
  paid: number;
  goldMined: number;
  goldTaxed: number;
  goodsMined: number;
  goodsNeeded: number;
  goodsUsed: number;
  goodsBought: number;
};

export function createMilitary(cellCount: number): Military {
  return {
    soldiers: new Uint16Array(cellCount * TROOP_TYPES),
    cap: new Uint16Array(cellCount * TROOP_TYPES),
    covered: new Uint8Array(cellCount * TROOP_TYPES),
    faith: new Float32Array(cellCount),
    districtCap: new Float32Array(cellCount),
    train: new Uint16Array(cellCount),
    release: new Uint16Array(cellCount),
    strength: new Float64Array(0),
    soldiersOf: new Float64Array(0),
    unhappy: new Uint8Array(cellCount),
    threat: new Uint8Array(0),
    sums: new Float64Array(cellCount),
    unpaidShare: new Float32Array(cellCount),
    rest: new Float32Array(cellCount),
    left: new Float32Array(cellCount),
    civAfford: new Float64Array(0),
    civStart: new Int32Array(0),
    civCells: new Int32Array(cellCount),
    seatStart: new Int32Array(0),
    civSeats: new Int32Array(cellCount),
    trained: 0,
    dismissed: 0,
    disbanded: 0,
    paid: 0,
    goldMined: 0,
    goldTaxed: 0,
    goodsMined: 0,
    goodsNeeded: 0,
    goodsUsed: 0,
    goodsBought: 0,
  };
}

/** Total soldiers of a cell (all troop types). */
export function soldiersAt(sim: Simulation, cell: number): number {
  const base = cell * TROOP_TYPES;
  const s = sim.military.soldiers;
  return s[base] + s[base + 1] + s[base + 2];
}

/** Strategic goods a settlement keeps and asks for: troop type -> yearly units for its building capacity. */
export function yearlyGoodNeed(sim: Simulation, cell: number, type: number): number {
  return sim.military.cap[cell * TROOP_TYPES + type] / MIL.perN;
}

/**
 * The size term of the danger `b` poses to `a`: 50 × (b's strength + floor) ÷
 * (a's strength + floor), at most 100 (diplomacy.ts multiplies it by nearness).
 */
export function strengthSize(sim: Simulation, a: number, b: number, scale: number): number {
  const m = sim.military;
  const sa = (a < m.strength.length ? m.strength[a] : 0) + MIL.floor;
  const sb = (b < m.strength.length ? m.strength[b] : 0) + MIL.floor;
  return Math.min(100, (scale * sb) / sa);
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
 * Hook for war (phase 3+): whether `a` and `b` are at war, or `b` is allied to
 * an enemy of `a`. Strategic goods are never sold then. No wars yet.
 */
export function hostile(_sim: Simulation, _a: number, _b: number): boolean {
  return false;
}

/** Whether `buyer` may buy strategic goods of `seller`: its danger for the seller is at most MIL.saleDanger, and they are not hostile. */
export function mayBuyStrategic(sim: Simulation, seller: number, buyer: number, pairs: number): boolean {
  return sim.diplomacy.danger[seller * pairs + buyer] <= MIL.saleDanger && !hostile(sim, seller, buyer);
}

/** Whether the people feels threatened: some people's danger for it is at least MIL.threatDanger. */
export function threatened(sim: Simulation, civ: number, pairs: number): boolean {
  const d = sim.diplomacy.danger;
  for (let b = 1; b < pairs; b++) if (b !== civ && d[civ * pairs + b] >= MIL.threatDanger) return true;
  return false;
}

/**
 * Before the government's projects (government.ts): which peoples feel
 * threatened and which districts have dissatisfied settlements (satisfaction < 0).
 */
export function prepareArming(sim: Simulation, owner: Uint8Array, pairs: number): void {
  const m = sim.military;
  const gov = sim.government;
  const n = sim.world.cellCount;
  if (m.threat.length !== sim.civSlots) m.threat = new Uint8Array(sim.civSlots);
  for (let civ = 1; civ < sim.civSlots; civ++) m.threat[civ] = civ < pairs && threatened(sim, civ, pairs) ? 1 : 0;
  m.unhappy.fill(0);
  for (let c = 0; c < n; c++) {
    const d = gov.district[c];
    if (d >= 0 && owner[c] !== 0 && sim.cellPop[c] > 0 && sim.satisfaction[c] < 0) m.unhappy[d] = 1;
  }
}

/**
 * Whether the seat's people arms (government.ts: chooseProject; after
 * prepareArming): within the income check, when a stronger people threatens
 * it (danger ≥ MIL.threatDanger), a settlement of the district is
 * dissatisfied, or the treasury holds MIL.spareYears years of one building's pay.
 */
export function armingWanted(sim: Simulation, seat: number): boolean {
  const civ = sim.world.owner[seat];
  if (civ === 0 || districtRoom(sim, seat) < MIL.capacity) return false;
  const m = sim.military;
  return sim.government.treasury[seat] >= MIL.spareYears * MIL.capacity * MIL.sold || m.unhappy[seat] === 1 || (civ < m.threat.length && m.threat[civ] === 1);
}

/** Whether the cell has a building (any state but empty or ruin) making `good`. */
function hasBuildingOf(sim: Simulation, cell: number, good: number): boolean {
  const eco = sim.economy;
  for (let q = cell * SLOTS, end = q + SLOTS; q < end; q++) {
    const st = eco.state[q];
    if (st !== SlotState.Empty && st !== SlotState.Ruin && BUILDINGS[eco.type[q]].good === good) return true;
  }
  return false;
}

/**
 * The military building type the government builds in `cell` (-1 = none):
 * the troop type the people has the fewest soldiers of that the settlement
 * lacks a building for; a stable only with horses in stock. Ties go by cell.
 */
export function pickMilitaryBuilding(sim: Simulation, cell: number): number {
  if (sim.cellPop[cell] < MIL.minPop) return -1;
  const civ = sim.world.owner[cell];
  const m = sim.military;
  let best = -1;
  let bestN = Infinity;
  for (let k = 0; k < TROOP_TYPES; k++) {
    const t = (k + cell) % TROOP_TYPES;
    if (hasBuildingOf(sim, cell, TROOP_BUILDING[t])) continue;
    if (t === Troop.Shock && sim.economy.luxury[cell * STORED_COUNT + TROOP_GOOD[t]] < 1) continue;
    const have = civ * TROOP_TYPES + t < m.soldiersOf.length ? m.soldiersOf[civ * TROOP_TYPES + t] : 0;
    if (have < bestN) {
      bestN = have;
      best = t;
    }
  }
  return best < 0 ? -1 : TROOP_TYPE_OF_BUILDING[best];
}

/** Groups the owned cells and the seats (cells with government traders) by people, ascending. */
function groupByPeople(sim: Simulation, owner: Uint8Array): void {
  const m = sim.military;
  const gov = sim.government;
  const n = sim.world.cellCount;
  const slots = sim.civSlots;
  if (m.civStart.length !== slots + 1) {
    m.civStart = new Int32Array(slots + 1);
    m.seatStart = new Int32Array(slots + 1);
  }
  const cs = m.civStart;
  const ss = m.seatStart;
  cs.fill(0);
  ss.fill(0);
  for (let c = 0; c < n; c++) {
    const civ = owner[c];
    if (civ === 0) continue;
    cs[civ + 1]++;
    if (gov.traders[c] > 0) ss[civ + 1]++;
  }
  for (let civ = 1; civ <= slots; civ++) {
    cs[civ] += cs[civ - 1];
    ss[civ] += ss[civ - 1];
  }
  // Fill using the start of the next people as a cursor, then shift back.
  for (let c = 0; c < n; c++) {
    const civ = owner[c];
    if (civ === 0) continue;
    m.civCells[cs[civ]++] = c;
    if (gov.traders[c] > 0) m.civSeats[ss[civ]++] = c;
  }
  for (let civ = slots; civ > 0; civ--) {
    cs[civ] = cs[civ - 1];
    ss[civ] = ss[civ - 1];
  }
  cs[0] = 0;
  ss[0] = 0;
}

/**
 * Yearly, a few weeks after the government's year: soldiers over the
 * capacity of their buildings (or whose settlement lost its district) are
 * disbanded; the district treasury pays the soldiers, the people's other
 * seats lend what it lacks, and those nobody can pay are dismissed; buildings
 * train new soldiers while next year's pay of the people's soldiers is
 * covered (the government keeps that reserve); government traders buy the
 * strategic goods soldiers lack; soldiers use their goods up; every people's
 * strength is counted. simulation.ts then draws the trained soldiers from the
 * adults (`train`) and returns the disbanded and dismissed ones (`release`).
 */
export function updateMilitary(sim: Simulation, owner: Uint8Array): void {
  const m = sim.military;
  const gov = sim.government;
  const eco = sim.economy;
  const n = sim.world.cellCount;
  m.train.fill(0);
  m.release.fill(0);
  m.districtCap.fill(0);
  m.sums.fill(0);
  m.unpaidShare.fill(0);
  m.rest.fill(0);
  if (m.strength.length !== sim.civSlots) {
    m.strength = new Float64Array(sim.civSlots);
    m.soldiersOf = new Float64Array(sim.civSlots * TROOP_TYPES);
    m.civAfford = new Float64Array(sim.civSlots);
  } else {
    m.strength.fill(0);
    m.soldiersOf.fill(0);
    m.civAfford.fill(0);
  }
  groupByPeople(sim, owner);

  // Capacity of the standing military buildings; capacity standing or being built commits the district's pay.
  // Soldiers beyond the capacity, or without a district, go back to their settlement.
  for (let c = 0; c < n; c++) {
    const d = gov.district[c];
    const base = c * TROOP_TYPES;
    m.cap[base] = 0;
    m.cap[base + 1] = 0;
    m.cap[base + 2] = 0;
    if (sim.hasBuildings[c]) {
      for (let s = c * SLOTS, end = s + SLOTS; s < end; s++) {
        const st = eco.state[s];
        if (st !== SlotState.Standing && st !== SlotState.Construction) continue;
        const t = TROOP_OF_TYPE[eco.type[s]];
        if (t < 0) continue;
        if (d >= 0) m.districtCap[d] += MIL.capacity;
        if (st === SlotState.Standing) m.cap[base + t] += MIL.capacity;
      }
    }
    for (let t = 0; t < TROOP_TYPES; t++) {
      const have = m.soldiers[base + t];
      if (have === 0) continue;
      const keep = sim.cellPop[c] > 0 && d >= 0 ? Math.min(have, m.cap[base + t]) : 0;
      if (keep < have) {
        m.disbanded += have - keep;
        m.soldiers[base + t] = keep;
        m.release[c] += have - keep;
      }
      if (d >= 0) m.sums[d] += keep;
    }
  }

  // Pay: the district treasury pays every soldier; the people's other seats lend what it lacks (richest first);
  // the soldiers nobody can pay are dismissed, spread exactly over the district's settlements.
  for (let s = 0; s < n; s++) {
    const total = m.sums[s];
    if (total <= 0) continue;
    const cost = total * MIL.sold;
    if (gov.treasury[s] < cost) {
      const civ = owner[s];
      let lack = cost - gov.treasury[s];
      while (lack > 1e-6) {
        let rich = -1;
        for (let k = m.seatStart[civ], end = m.seatStart[civ + 1]; k < end; k++) {
          const o = m.civSeats[k];
          if (o !== s && (rich < 0 || gov.treasury[o] > gov.treasury[rich])) rich = o;
        }
        if (rich < 0 || gov.treasury[rich] <= 0) break;
        const take = Math.min(lack, gov.treasury[rich]);
        gov.treasury[rich] -= take;
        gov.treasury[s] += take;
        lack -= take;
      }
    }
    if (gov.treasury[s] >= cost) {
      gov.treasury[s] -= cost;
      m.paid += cost;
      continue;
    }
    const afford = Math.floor(gov.treasury[s] / MIL.sold);
    gov.treasury[s] -= afford * MIL.sold;
    m.paid += afford * MIL.sold;
    m.unpaidShare[s] = (total - afford) / total;
    m.rest[s] = total - afford;
  }
  // First every settlement's whole share (rounded down), then one more from settlements in order until the district's count is reached.
  for (let pass = 0; pass < 2; pass++) {
    for (let c = 0; c < n; c++) {
      const d = gov.district[c];
      if (d < 0 || m.rest[d] <= 0) continue;
      for (let t = 0; t < TROOP_TYPES; t++) {
        const i = c * TROOP_TYPES + t;
        if (m.soldiers[i] === 0) continue;
        const leave = pass === 0 ? Math.min(m.soldiers[i], Math.floor(m.soldiers[i] * m.unpaidShare[d])) : m.rest[d] > 0 ? 1 : 0;
        if (leave <= 0) continue;
        m.rest[d] -= leave;
        m.soldiers[i] -= leave;
        m.release[c] += leave;
        m.dismissed += leave;
      }
    }
  }

  // Next year's pay of the soldiers that stay is the government's reserve; the people's treasuries together
  // pay for new soldiers (no training on credit).
  gov.reserve.fill(0);
  for (let c = 0; c < n; c++) {
    const civ = owner[c];
    const d = gov.district[c];
    const here = soldiersAt(sim, c);
    if (d >= 0) gov.reserve[d] += here * MIL.sold;
    if (civ === 0) continue;
    m.civAfford[civ] -= here;
    if (gov.traders[c] > 0) m.civAfford[civ] += Math.floor(gov.treasury[c] / MIL.sold);
  }
  // Training: each building trains MIL.trainShare of its capacity a year, within the settlement's people and
  // adults and what the people's treasuries pay.
  for (let c = 0; c < n; c++) {
    const people = sim.cellPop[c];
    const dist = gov.district[c];
    const civ = owner[c];
    if (people === 0 || dist < 0 || civ === 0) continue;
    const base = c * TROOP_TYPES;
    if (m.cap[base] === 0 && m.cap[base + 1] === 0 && m.cap[base + 2] === 0) continue;
    let room = Math.min(Math.floor(MIL.maxPopShare * people) - soldiersAt(sim, c), Math.floor(MIL.maxAdultShare * sim.cellAdults[c]));
    for (let t = 0; t < TROOP_TYPES && room > 0; t++) {
      const cap = m.cap[base + t];
      if (cap === 0 || m.soldiers[base + t] >= cap) continue;
      // Stables need horses at hand.
      if (t === Troop.Shock && eco.luxury[c * STORED_COUNT + TROOP_GOOD[t]] < 1) continue;
      const add = Math.min(cap - m.soldiers[base + t], Math.ceil(MIL.trainShare * cap), room, Math.floor(m.civAfford[civ]));
      if (add <= 0) continue;
      m.civAfford[civ] -= add;
      m.soldiers[base + t] += add;
      m.train[c] += add;
      m.trained += add;
      gov.reserve[dist] += add * MIL.sold;
      room -= add;
    }
  }

  governmentBuys(sim, owner);

  // Strategic goods: soldiers use 1 / MIL.perN units each a year; a troop type without its good is not stronger.
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
      m.goodsNeeded += need;
      const i = c * STORED_COUNT + TROOP_GOOD[t];
      const covered = eco.luxury[i] >= need;
      if (covered) {
        eco.luxury[i] -= need;
        m.goodsUsed += need;
      }
      m.covered[base + t] = covered ? 1 : 0;
      if (civ > 0) {
        m.strength[civ] += count * (covered ? MIL.factor : 1);
        m.soldiersOf[civ * TROOP_TYPES + t] += count;
      }
    }
  }
}

/**
 * Each seat's government traders (MIL.traderUnits each a year) buy what its
 * district's soldiers lack of their strategic good this year from the
 * people's settlements that spare it (the most first), paid from the
 * treasury beyond the pay reserve, and bring it to the soldiers.
 */
function governmentBuys(sim: Simulation, owner: Uint8Array): void {
  const m = sim.military;
  const gov = sim.government;
  const eco = sim.economy;
  const n = sim.world.cellCount;
  for (let c = 0; c < n; c++) m.left[c] = gov.traders[c] * MIL.traderUnits;
  for (let c = 0; c < n; c++) {
    const d = gov.district[c];
    if (d < 0 || m.left[d] <= 0) continue;
    const civ = owner[c];
    for (let t = 0; t < TROOP_TYPES; t++) {
      const count = m.soldiers[c * TROOP_TYPES + t];
      if (count === 0) continue;
      const k = TROOP_GOOD[t];
      const i = c * STORED_COUNT + k;
      let lack = count / MIL.perN - eco.luxury[i];
      const price = PRICE[TradeGood.Luxury + k];
      for (let tries = 0; tries < 3 && lack > 1e-6 && m.left[d] > 0; tries++) {
        let src = -1;
        let best = 0;
        for (let q = m.civStart[civ], end = m.civStart[civ + 1]; q < end; q++) {
          const o = m.civCells[q];
          if (o === c) continue;
          const tt = TROOP_OF_GOOD[k];
          const spare = eco.luxury[o * STORED_COUNT + k] - (tt < 0 ? 0 : m.soldiers[o * TROOP_TYPES + tt] / MIL.perN);
          if (spare > best) {
            best = spare;
            src = o;
          }
        }
        if (src < 0) break;
        const units = Math.min(lack, best, m.left[d]);
        const cost = units * price;
        if (gov.treasury[d] - gov.reserve[d] < cost) break;
        gov.treasury[d] -= cost;
        eco.money[src] += cost;
        eco.luxury[src * STORED_COUNT + k] -= units;
        eco.luxury[i] += units;
        m.left[d] -= units;
        lack -= units;
        m.goodsBought += units;
      }
    }
  }
}

/** A hex's soldiers for the info panel. */
export type HexMilitary = {
  /** Per troop type (TROOP_NAMES): soldiers, capacity of the standing buildings, and whether they had their strategic good this year. */
  troops: { name: string; soldiers: number; capacity: number; supplied: boolean }[];
  soldiers: number;
};

export function hexMilitary(sim: Simulation, cell: number): HexMilitary {
  const m = sim.military;
  const troops: HexMilitary['troops'] = [];
  for (let t = 0; t < TROOP_TYPES; t++) {
    const i = cell * TROOP_TYPES + t;
    if (m.soldiers[i] > 0 || m.cap[i] > 0) troops.push({ name: TROOP_NAMES[t], soldiers: m.soldiers[i], capacity: m.cap[i], supplied: m.covered[i] === 1 });
  }
  return { troops, soldiers: soldiersAt(sim, cell) };
}

/** A people's military for its panel: strength and soldiers per troop type. */
export type CivMilitary = { strength: number; soldiers: number; byType: number[] };

export function civMilitary(sim: Simulation, civ: number): CivMilitary {
  const m = sim.military;
  const byType: number[] = [];
  let soldiers = 0;
  for (let t = 0; t < TROOP_TYPES; t++) {
    const v = civ * TROOP_TYPES + t < m.soldiersOf.length ? m.soldiersOf[civ * TROOP_TYPES + t] : 0;
    byType.push(v);
    soldiers += v;
  }
  return { strength: civ < m.strength.length ? m.strength[civ] : 0, soldiers, byType };
}

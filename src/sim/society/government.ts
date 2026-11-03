import { hexDistance } from '../hex';
import { BUILDINGS, GOV_SLOT, Good, MATERIAL_COUNT, SLOTS, SlotState, forageYield, withBuildings } from './buildings';
import { buildingFits, capacityWith, updateCellSupply, usableSlots } from './economy';
import { MIL, TROOP_TYPE_OF_BUILDING, armingWanted, districtPay, pickTroopType } from './military';
import { PAIRS } from './diplomacy';
import { satisfactionTarget, seatsOf, yieldFactor } from './satisfaction';
import type { Simulation } from './simulation';
import { GOV_TUNING, TAX_MAX, goodsRateFor, goodsTaxValue, rateFor, taxValue } from './taxes';
import { MONEY_PER_ADULT, PRICE, TRADE_GOODS, upkeepOf as settlementUpkeep } from './trade';

export { GOV_TUNING };

// The central government ("Design Documents/Requirement Zentralregierung.md").
// The capital and every seat of government run a district: the settlements of
// their people nearest to them. Once a year each district sets a goods tax (as
// much wood and stone as it needs) and a money tax (the rest of what its
// weakest settlement bears while it stays loyal), pays the upkeep of its
// government buildings, and chooses its next project: a planned seat of
// government first, then comfort where settlements threaten to break away,
// then whatever lets crowded settlements grow. Its traders bring the wood and
// stone to its building sites, from the seat's stock or bought from its
// people's settlements.

/** A government trader carries this many units of wood or stone. */
const TRADER_LOAD = 40;
/** Weeks per hex a government trader travels (roads and rivers aside). */
const WEEKS_PER_HEX = 1;
/** Years of upkeep a government building keeps in stock at its site; a project starts with one year less left after its cost. */
const UPKEEP_RESERVE_YEARS = 3;
/** Years a government building goes without upkeep before it falls to ruin. */
const UPKEEP_GRACE_YEARS = 2;
/** Years a project may wait for its materials before the government drops it (seats excepted). */
const PROJECT_YEARS = 5;
const WEEKS_PER_YEAR = 52;
/** Project score of a military building: below loyalty (seats 1000, comfort 100+), above growth (capped below it). */
const MILITARY_SCORE = 50;
const SEAT_TYPE = BUILDINGS.findIndex((b) => b.good === Good.Seat);
const COMFORT_TYPES = BUILDINGS.map((b, i) => (b.good === Good.Comfort ? i : -1)).filter((i) => i >= 0);
const GROWTH_TYPES = BUILDINGS.map((b, i) => (b.good <= Good.Space && !b.deposit ? i : -1)).filter((i) => i >= 0);

export type Government = {
  /** Per cell: the seat whose district it is in, -1 = none. */
  district: Int32Array;
  /** Per seat cell: money tax rate and goods tax rate of its district. */
  rate: Float32Array;
  goodsRate: Float32Array;
  /** Per cell: the money and goods tax rates it pays (for its satisfaction). */
  cellRate: Float32Array;
  cellGoodsRate: Float32Array;
  /** Per seat cell: money in its treasury. */
  treasury: Float32Array;
  /** Per cell and material: wood and stone the government keeps there (seat stock, building sites). */
  stock: Float32Array;
  /** Per seat cell: its project (site cell, slot, building type, year chosen); site -1 = none. */
  projectSite: Int32Array;
  projectSlot: Int32Array;
  projectType: Int16Array;
  projectYear: Int32Array;
  /** Per cell: 1 if a seat of government is a project there (seat planning re-evaluates it, economy.ts). */
  seatQueued: Uint8Array;
  /** Per seat cell: what its district could raise in a year at its loyalty limit (the income check). */
  potential: Float32Array;
  /** Per seat cell: yearly upkeep in money of its district's government buildings (standing or being built), as of the last projects update (military.ts reads it). */
  upkeep: Float32Array;
  /** Per seat cell: money kept back for next year's soldiers' pay (military.ts); the government doesn't spend it. */
  reserve: Float32Array;
  /** Per seat cell: money tax its district paid into the treasury at the last yearly update. */
  income: Float32Array;
  /** Per civilization id: its founding tick + 1 once its government got its starting money. */
  funded: number[];
  /** Per seat cell: its traders and how many are away. */
  traders: Uint8Array;
  away: Uint8Array;
  /** Per cell and material: wood and stone on its way there. */
  incoming: Float32Array;
  /** Trips under way (struct of arrays, `tripCount` in use): the trader's seat, the site and what it brings, arrival and return. */
  tripSeat: Int32Array;
  tripSite: Int32Array;
  tripMaterial: Uint8Array;
  tripAmount: Float64Array;
  tripMoney: Float64Array;
  tripArrive: Int32Array;
  tripBack: Int32Array;
  tripCount: number;
  /** Statistics: taxes in money and goods, levied on site, starting money, money spent, buildings put up, trips, transfers. */
  collected: number;
  collectedGoods: number;
  levied: number;
  startMoney: number;
  spent: number;
  built: number;
  sent: number;
  transfers: number;
  transferred: number;
};

export function createGovernment(cellCount: number): Government {
  const trips = 64;
  return {
    district: new Int32Array(cellCount).fill(-1),
    rate: new Float32Array(cellCount),
    goodsRate: new Float32Array(cellCount),
    cellRate: new Float32Array(cellCount),
    cellGoodsRate: new Float32Array(cellCount),
    treasury: new Float32Array(cellCount),
    stock: new Float32Array(cellCount * MATERIAL_COUNT),
    projectSite: new Int32Array(cellCount).fill(-1),
    projectSlot: new Int32Array(cellCount).fill(-1),
    projectType: new Int16Array(cellCount).fill(-1),
    projectYear: new Int32Array(cellCount),
    seatQueued: new Uint8Array(cellCount),
    potential: new Float32Array(cellCount),
    upkeep: new Float32Array(cellCount),
    reserve: new Float32Array(cellCount),
    income: new Float32Array(cellCount),
    funded: [],
    traders: new Uint8Array(cellCount),
    away: new Uint8Array(cellCount),
    incoming: new Float32Array(cellCount * MATERIAL_COUNT),
    tripSeat: new Int32Array(trips),
    tripSite: new Int32Array(trips),
    tripMaterial: new Uint8Array(trips),
    tripAmount: new Float64Array(trips),
    tripMoney: new Float64Array(trips),
    tripArrive: new Int32Array(trips),
    tripBack: new Int32Array(trips),
    tripCount: 0,
    collected: 0,
    collectedGoods: 0,
    levied: 0,
    startMoney: 0,
    spent: 0,
    built: 0,
    sent: 0,
    transfers: 0,
    transferred: 0,
  };
}

/** Wood (m = 0) or stone a building costs the government; seats by GOV_TUNING.seatCost. */
function costOf(type: number, m: number): number {
  const b = BUILDINGS[type];
  return (m === 0 ? b.wood : b.stone) * (type === SEAT_TYPE ? GOV_TUNING.seatCost : 1);
}

/** Yearly wood (m = 0) or stone upkeep of a government building; seats by GOV_TUNING.seatUpkeep. */
function upkeepOf(type: number, m: number): number {
  const b = BUILDINGS[type];
  return (m === 0 ? b.upkeepWood : b.upkeepStone) * (type === SEAT_TYPE ? GOV_TUNING.seatUpkeep : 1);
}

/** Yearly upkeep of a government building in money (at market prices). */
const upkeepGold = (type: number) => upkeepOf(type, 0) * PRICE[0] + upkeepOf(type, 1) * PRICE[1];

/** A building's materials in money (at market prices), for the growth score. */
const goldCost = (type: number) => BUILDINGS[type].wood * PRICE[0] + BUILDINGS[type].stone * PRICE[1];

/** Per seat cell, for the income check (filled once a year, kept up as projects start): the yearly upkeep in money of
 * its district's government buildings standing or being built, and of those that are seats. */
let buildUpkeep = new Float64Array(0);
let seatBuildUpkeep = new Float64Array(0);
/** Per civilization id: its seats, and GOV_TUNING.incomeShare of their potential income together. */
let civSeatList: number[][] = [];
let civBudget = new Float64Array(0);

/** Yearly upkeep in money of a seat's project (0 without one, or if `seatsOnly` and it is no seat). */
function projectUpkeep(gov: Government, seat: number, seatsOnly: boolean): number {
  const type = gov.projectType[seat];
  return gov.projectSite[seat] >= 0 && (!seatsOnly || type === SEAT_TYPE) ? upkeepGold(type) : 0;
}

/** Wood or stone the government keeps at `cell` for its buildings' upkeep (`years` of it). */
function upkeepReserve(sim: Simulation, cell: number, m: number, years = UPKEEP_RESERVE_YEARS): number {
  const { economy } = sim;
  let sum = 0;
  for (let s = cell * SLOTS + GOV_SLOT, end = s + usableSlots(sim, cell); s < end; s++) {
    const st = economy.state[s];
    if (st !== SlotState.Standing && st !== SlotState.Construction) continue;
    sum += upkeepOf(economy.type[s], m);
  }
  return sum * years;
}

/** A chronicle entry at a hex (simulation.ts: record). */
export type Record = (text: string, cell: number) => void;

/**
 * Yearly: districts, tax rates and taxes (then updateGovernmentUpkeep and
 * updateGovernmentProjects in the following weeks).
 */
export function updateGovernment(sim: Simulation, owner: Uint8Array, record: Record): void {
  const gov = sim.government;
  const { world, economy } = sim;
  const n = world.cellCount;
  const seats = seatsOf(sim, owner);
  // Districts: the nearest seat of the settlement's people.
  gov.district.fill(-1);
  for (let c = 0; c < n; c++) {
    const civ = owner[c];
    if (!civ || sim.cellPop[c] === 0) continue;
    let best = -1;
    let bestD = Infinity;
    for (const s of seats[civ] ?? []) {
      const d = hexDistance(world, c, s);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    gov.district[c] = best;
  }
  // Traders per seat.
  const isSeat = new Uint8Array(n);
  for (let civ = 1; civ < seats.length; civ++) {
    const civObj = sim.civs[civ];
    for (const s of seats[civ] ?? []) {
      isSeat[s] = 1;
      gov.traders[s] = civObj && civObj.capital === s ? GOV_TUNING.capitalTraders : GOV_TUNING.traders;
    }
  }
  // Starting money: a newly founded people's government gets GOV_TUNING.startSeats seats' worth; breakaways keep
  // the settlements that rose up and get none.
  const seatGold = costOf(SEAT_TYPE, 0) * PRICE[0] + costOf(SEAT_TYPE, 1) * PRICE[1];
  for (const civObj of sim.civs) {
    if (!civObj || gov.funded[civObj.id] === civObj.foundedTick + 1 || civObj.capital < 0) continue;
    gov.funded[civObj.id] = civObj.foundedTick + 1;
    if (civObj.origin !== 'start' && civObj.origin !== 'tribe') continue;
    const money = GOV_TUNING.startSeats * seatGold;
    gov.treasury[civObj.capital] += money;
    gov.startMoney += money;
  }
  // While a people finances a seat (one is a project), it taxes without the safety margin.
  const civFinancing = new Uint8Array(sim.civSlots);
  for (let s = 0; s < n; s++) if (isSeat[s] && gov.projectSite[s] >= 0 && gov.projectType[s] === SEAT_TYPE) civFinancing[owner[s]] = 1;
  // The weakest settlement of every district, without its taxes.
  const low = new Float32Array(n).fill(Infinity);
  const count = new Uint16Array(n);
  for (let c = 0; c < n; c++) {
    const s = gov.district[c];
    if (s < 0) continue;
    const base = satisfactionTarget(sim, c, sim.civs[owner[c]] ?? null) - taxValue(gov.cellRate[c]) - goodsTaxValue(gov.cellGoodsRate[c]);
    low[s] = Math.min(low[s], base);
    count[s]++;
  }
  // Per district: the money tax base, the wood and stone its settlements spare (stock) and harvest beyond their own
  // upkeep (yearly), and what it needs: a year's upkeep of its buildings and its project's missing materials, less
  // what its seat holds.
  const moneyBase = new Float32Array(n);
  const goodsFlow = new Float32Array(n);
  const goodsSpare = new Float32Array(n * MATERIAL_COUNT);
  const goodsNeed = new Float32Array(n * MATERIAL_COUNT);
  for (let c = 0; c < n; c++) {
    const s = gov.district[c];
    if (s < 0) continue;
    moneyBase[s] += sim.cellAdults[c] * MONEY_PER_ADULT;
    for (let m = 0; m < MATERIAL_COUNT; m++) {
      const good = m === 0 ? Good.Wood : Good.Stone;
      const harvest = withBuildings(economy, c, good, forageYield(world, c, good)) * yieldFactor(sim.satisfaction[c]);
      goodsFlow[s] += Math.max(0, harvest - settlementUpkeep(economy, c, m)) * PRICE[m];
    }
    for (let m = 0; m < MATERIAL_COUNT; m++) goodsSpare[s * MATERIAL_COUNT + m] += Math.max(0, sim.trade.surplus[c * TRADE_GOODS + m]);
  }
  for (let c = 0; c < n; c++) {
    const s = gov.district[c];
    if (s < 0 || !sim.hasBuildings[c]) continue;
    for (let m = 0; m < MATERIAL_COUNT; m++) goodsNeed[s * MATERIAL_COUNT + m] += upkeepReserve(sim, c, m, 1);
  }
  for (let s = 0; s < n; s++) {
    if (!isSeat[s]) continue;
    const site = gov.projectSite[s];
    if (site >= 0) {
      for (let m = 0; m < MATERIAL_COUNT; m++) {
        goodsNeed[s * MATERIAL_COUNT + m] += Math.max(0, costOf(gov.projectType[s], m) + upkeepReserve(sim, site, m) - gov.stock[site * MATERIAL_COUNT + m] - gov.incoming[site * MATERIAL_COUNT + m]);
      }
    }
    for (let m = 0; m < MATERIAL_COUNT; m++) goodsNeed[s * MATERIAL_COUNT + m] = Math.max(0, goodsNeed[s * MATERIAL_COUNT + m] - gov.stock[s * MATERIAL_COUNT + m]);
  }
  // Rates: the goods tax as the district needs, as far as its weakest settlement stays loyal without a money tax;
  // the money tax takes the rest of the room. And the potential income for the income check.
  for (let s = 0; s < n; s++) {
    if (!isSeat[s]) {
      gov.rate[s] = 0;
      gov.goodsRate[s] = 0;
      gov.traders[s] = 0;
      continue;
    }
    if (count[s] === 0) continue;
    const room = (civFinancing[owner[s]] === 1 ? GOV_TUNING.seatMargin : GOV_TUNING.margin) - low[s];
    const goodsLimit = Math.min(TAX_MAX, goodsRateFor(room - GOV_TUNING.taxPlus));
    let goodsRate = 0;
    for (let m = 0; m < MATERIAL_COUNT; m++) {
      const spare = goodsSpare[s * MATERIAL_COUNT + m];
      if (spare > 0) goodsRate = Math.max(goodsRate, goodsNeed[s * MATERIAL_COUNT + m] / spare);
    }
    goodsRate = Math.min(goodsRate, goodsLimit);
    const rate = rateFor(room - goodsTaxValue(goodsRate));
    // At the loyalty limit: all room for the money tax (goods tax 0 %), or all for the goods tax (money tax 0 %),
    // the latter no more than the yearly harvest beyond the settlements' own upkeep.
    const moneyOnly = rateFor(room - goodsTaxValue(0)) * moneyBase[s];
    let goodsValue = 0;
    for (let m = 0; m < MATERIAL_COUNT; m++) goodsValue += goodsSpare[s * MATERIAL_COUNT + m] * PRICE[m];
    gov.potential[s] = Math.max(moneyOnly, Math.min(goodsFlow[s], goodsLimit * goodsValue));
    if (Math.abs(rate - gov.rate[s]) >= 0.1) {
      record(`The ${sim.civs[owner[s]]?.name ?? ''} ${rate > gov.rate[s] ? 'raised' : 'lowered'} the taxes around ${s === sim.civs[owner[s]]?.capital ? 'the capital' : 'a seat of government'} to ${Math.round(rate * 100)} %.`, s);
    }
    gov.rate[s] = rate;
    gov.goodsRate[s] = goodsRate;
  }
  gov.income.fill(0);
  // Taxes: money into the seat's treasury, goods from the settlements' surplus into its stock.
  for (let c = 0; c < n; c++) {
    const s = gov.district[c];
    gov.cellRate[c] = s >= 0 ? gov.rate[s] : 0;
    gov.cellGoodsRate[c] = s >= 0 ? gov.goodsRate[s] : 0;
    if (s < 0) continue;
    const tax = Math.min(economy.money[c], gov.rate[s] * sim.cellAdults[c] * MONEY_PER_ADULT);
    economy.money[c] -= tax;
    gov.treasury[s] += tax;
    gov.income[s] += tax;
    gov.collected += tax;
    if (gov.goodsRate[s] > 0) {
      for (let m = 0; m < MATERIAL_COUNT; m++) {
        const spare = sim.trade.surplus[c * TRADE_GOODS + m];
        const take = Math.min(economy.stock[c * MATERIAL_COUNT + m], gov.goodsRate[s] * Math.max(0, spare));
        economy.stock[c * MATERIAL_COUNT + m] -= take;
        gov.stock[s * MATERIAL_COUNT + m] += take;
        gov.collectedGoods += take;
      }
    }
  }
}

/**
 * Yearly, a week after updateGovernment: the levy on site, then the upkeep
 * of government buildings.
 */
export function updateGovernmentUpkeep(sim: Simulation, owner: Uint8Array): void {
  const gov = sim.government;
  const { economy } = sim;
  const n = sim.world.cellCount;
  // Levy on site: each site takes what its government buildings lack for a year's upkeep from its own settlement's
  // surplus, as a goods tax there, as far as that settlement stays above the safety margin.
  for (let c = 0; c < n; c++) {
    const s = gov.district[c];
    if (s < 0 || !sim.hasBuildings[c] || sim.cellPop[c] === 0 || owner[c] !== owner[s]) continue;
    const lackWood = Math.max(0, upkeepReserve(sim, c, 0, 1) - gov.stock[c * MATERIAL_COUNT]);
    const lackStone = Math.max(0, upkeepReserve(sim, c, 1, 1) - gov.stock[c * MATERIAL_COUNT + 1]);
    if (lackWood <= 1e-3 && lackStone <= 1e-3) continue;
    const headroom = satisfactionTarget(sim, c, sim.civs[owner[c]] ?? null) - GOV_TUNING.margin;
    if (headroom <= 0) continue;
    const g0 = gov.cellGoodsRate[c];
    const extra = Math.max(0, goodsRateFor(goodsTaxValue(g0) - headroom) - g0);
    let levy = 0;
    for (let m = 0; m < MATERIAL_COUNT; m++) {
      const lack = m === 0 ? lackWood : lackStone;
      const spare = Math.max(0, sim.trade.surplus[c * TRADE_GOODS + m]);
      if (lack <= 1e-3 || spare <= 0) continue;
      const take = Math.min(lack, spare * extra, economy.stock[c * MATERIAL_COUNT + m]);
      if (take <= 0) continue;
      economy.stock[c * MATERIAL_COUNT + m] -= take;
      sim.trade.surplus[c * TRADE_GOODS + m] -= take;
      gov.stock[c * MATERIAL_COUNT + m] += take;
      gov.levied += take;
      levy = Math.max(levy, take / spare);
    }
    gov.cellGoodsRate[c] = g0 + levy;
  }
  // Upkeep of government buildings, from the government's stock at their site; two years without it, a ruin.
  for (let c = 0; c < n; c++) {
    if (!sim.hasBuildings[c]) continue;
    let ruined = false;
    for (let s = c * SLOTS + GOV_SLOT, end = s + usableSlots(sim, c); s < end; s++) {
      if (economy.state[s] !== SlotState.Standing) continue;
      const t = economy.type[s];
      const w = c * MATERIAL_COUNT;
      if (gov.stock[w] >= upkeepOf(t, 0) && gov.stock[w + 1] >= upkeepOf(t, 1)) {
        gov.stock[w] -= upkeepOf(t, 0);
        gov.stock[w + 1] -= upkeepOf(t, 1);
        economy.unpaid[s] = 0;
      } else if (++economy.unpaid[s] > UPKEEP_GRACE_YEARS) {
        economy.state[s] = SlotState.Ruin;
        ruined = true;
      }
    }
    // A ruin no longer supplies its hex.
    if (ruined) updateCellSupply(sim, c);
  }
}

/**
 * Yearly, a week after updateGovernmentUpkeep (the government's year is
 * spread over three weeks so no single one carries it all): every seat starts
 * its project once paid for, drops one that is lost or waited too long, and
 * chooses the next.
 */
export function updateGovernmentProjects(sim: Simulation, owner: Uint8Array): void {
  const gov = sim.government;
  const { economy } = sim;
  const n = sim.world.cellCount;
  if (buildUpkeep.length !== n) {
    buildUpkeep = new Float64Array(n);
    seatBuildUpkeep = new Float64Array(n);
  } else {
    buildUpkeep.fill(0);
    seatBuildUpkeep.fill(0);
  }
  for (let c = 0; c < n; c++) {
    const d = gov.district[c];
    if (d < 0 || !sim.hasBuildings[c]) continue;
    for (let s = c * SLOTS + GOV_SLOT, end = s + usableSlots(sim, c); s < end; s++) {
      const st = economy.state[s];
      if (st !== SlotState.Standing && st !== SlotState.Construction) continue;
      const t = economy.type[s];
      buildUpkeep[d] += upkeepGold(t);
      if (t === SEAT_TYPE) seatBuildUpkeep[d] += upkeepGold(t);
    }
  }
  for (let s = 0; s < n; s++) gov.upkeep[s] = buildUpkeep[s];
  civSeatList = [];
  if (civBudget.length < sim.civSlots) civBudget = new Float64Array(sim.civSlots);
  civBudget.fill(0);
  for (let s = 0; s < n; s++) {
    if (!gov.traders[s]) continue;
    (civSeatList[owner[s]] ??= []).push(s);
    civBudget[owner[s]] += GOV_TUNING.incomeShare * gov.potential[s];
  }
  const year = Math.floor(sim.tick / WEEKS_PER_YEAR);
  for (let s = 0; s < n; s++) {
    // Seats are the cells with traders (updateGovernment).
    if (!gov.traders[s]) {
      gov.projectSite[s] = -1;
      continue;
    }
    const site = gov.projectSite[s];
    if (site >= 0) {
      const type = gov.projectType[s];
      const slot = gov.projectSlot[s];
      const w = site * MATERIAL_COUNT;
      // Checked after the year's upkeep was paid: the reserve has one year less.
      const keep = UPKEEP_RESERVE_YEARS - 1;
      if (owner[site] !== owner[s] || sim.cellPop[site] === 0 || economy.state[slot] !== SlotState.Empty) {
        gov.projectSite[s] = -1; // lost or taken
      } else if (type === SEAT_TYPE && !sim.seatSite[site]) {
        gov.projectSite[s] = -1; // seat planning found a better site, or none is worth it
      } else if (gov.stock[w] - upkeepReserve(sim, site, 0, keep) >= costOf(type, 0) && gov.stock[w + 1] - upkeepReserve(sim, site, 1, keep) >= costOf(type, 1)) {
        gov.stock[w] -= costOf(type, 0);
        gov.stock[w + 1] -= costOf(type, 1);
        economy.type[slot] = type;
        economy.state[slot] = SlotState.Construction;
        economy.work[slot] = BUILDINGS[type].years;
        economy.unpaid[slot] = 0;
        sim.hasBuildings[site] = 1;
        gov.built++;
        const d = gov.district[site];
        if (d >= 0) {
          buildUpkeep[d] += upkeepGold(type);
          if (type === SEAT_TYPE) seatBuildUpkeep[d] += upkeepGold(type);
        }
        if (type === SEAT_TYPE) sim.seatSite[site] = 0;
        gov.projectSite[s] = -1;
      } else if (type !== SEAT_TYPE && year - gov.projectYear[s] >= PROJECT_YEARS) {
        gov.projectSite[s] = -1; // waited too long
      }
    }
    // A planned seat goes before any other project.
    const seatProject = gov.projectSite[s] >= 0 && gov.projectType[s] === SEAT_TYPE;
    if (!seatProject && chooseProject(sim, s, true)) setProject(gov, s, year);
    if (gov.projectSite[s] < 0 && chooseProject(sim, s, false)) setProject(gov, s, year);
  }
  gov.seatQueued.fill(0);
  for (let s = 0; s < n; s++) if (gov.projectSite[s] >= 0 && gov.projectType[s] === SEAT_TYPE) gov.seatQueued[gov.projectSite[s]] = 1;
}

let pickSite = -1;
let pickSlot = -1;
let pickType = -1;

function setProject(gov: Government, seat: number, year: number): void {
  gov.projectSite[seat] = pickSite;
  gov.projectSlot[seat] = pickSlot;
  gov.projectType[seat] = pickType;
  gov.projectYear[seat] = year;
}

/** A free government slot of a hex, -1 if none. */
function freeGovSlot(sim: Simulation, cell: number): number {
  for (let s = cell * SLOTS + GOV_SLOT, end = s + usableSlots(sim, cell); s < end; s++) if (sim.economy.state[s] === SlotState.Empty) return s;
  return -1;
}

/**
 * The next project of a seat's district, into pickSite/pickSlot/pickType: a
 * planned seat, comfort for the restless, growth for the crowded; none at the
 * site of its current project. Income check: the district's yearly upkeep
 * with the new building stays within GOV_TUNING.incomeShare of its potential
 * income; a seat is checked against the whole people's seats and income.
 */
function chooseProject(sim: Simulation, seat: number, seatOnly: boolean): boolean {
  const gov = sim.government;
  const n = sim.world.cellCount;
  const budget = GOV_TUNING.incomeShare * gov.potential[seat];
  const upkeep = buildUpkeep[seat] + projectUpkeep(gov, seat, false) + districtPay(sim, seat);
  const civ = sim.world.owner[seat];
  let seatUpkeep = 0;
  for (const s of civSeatList[civ] ?? []) seatUpkeep += seatBuildUpkeep[s] + projectUpkeep(gov, s, true);
  const seatBudget = civBudget[civ];
  const fits = (t: number) => (t === SEAT_TYPE ? seatUpkeep : upkeep) + upkeepGold(t) <= (t === SEAT_TYPE ? seatBudget : budget);
  let bestSite = -1;
  let bestSlot = -1;
  let bestType = -1;
  let bestScore = 0;
  const arm = !seatOnly && MIL.enabled && MIL.govBuild && armingWanted(sim, seat, PAIRS);
  for (let c = 0; c < n; c++) {
    if (gov.district[c] !== seat || gov.projectSite[seat] === c) continue;
    const slot = freeGovSlot(sim, c);
    if (slot < 0) continue;
    // 1. A planned seat of government.
    if (sim.seatSite[c] && buildingFits(sim, c, SEAT_TYPE) && fits(SEAT_TYPE)) {
      const score = 1000;
      if (score > bestScore) [bestSite, bestSlot, bestType, bestScore] = [c, slot, SEAT_TYPE, score];
      continue;
    }
    if (seatOnly) continue;
    const people = sim.cellPop[c];
    // 2. Comfort where a settlement threatens to break away.
    if (sim.satisfaction[c] < GOV_TUNING.margin) {
      for (const t of COMFORT_TYPES) {
        if (!buildingFits(sim, c, t) || !fits(t)) continue;
        const score = 100 + (GOV_TUNING.margin - sim.satisfaction[c]) * people * 0.01;
        if (score > bestScore) [bestSite, bestSlot, bestType, bestScore] = [c, slot, t, score];
        break;
      }
    }
    // 3. Military (below loyalty, above growth): one building of each type per settlement.
    if (arm && people >= MIL.minPop && bestScore < MILITARY_SCORE) {
      const has = (good: number) => {
        for (let q = c * SLOTS, end = q + SLOTS; q < end; q++) {
          const st = sim.economy.state[q];
          if (st !== SlotState.Empty && st !== SlotState.Ruin && BUILDINGS[sim.economy.type[q]].good === good) return true;
        }
        return false;
      };
      const k = pickTroopType(sim, c, has);
      if (k >= 0) {
        bestSite = c;
        bestSlot = slot;
        bestType = TROOP_TYPE_OF_BUILDING[k];
        bestScore = MILITARY_SCORE;
        continue;
      }
    }
    // 4. Growth where it is crowded (more people pay more taxes).
    if (people >= 0.8 * sim.cellCapacity[c]) {
      for (const t of GROWTH_TYPES) {
        if (!buildingFits(sim, c, t) || !fits(t)) continue;
        const gain = capacityWith(sim, c, t, -1) - sim.cellCapacity[c];
        if (gain < 1) continue;
        const score = Math.min(MILITARY_SCORE - 1, (gain / Math.max(1, goldCost(t))) * 10);
        if (score > bestScore) [bestSite, bestSlot, bestType, bestScore] = [c, slot, t, score];
      }
    }
  }
  [pickSite, pickSlot, pickType] = [bestSite, bestSlot, bestType];
  return bestSite >= 0;
}

/** A trip of a government trader (or a money transfer between seats). */
function addTrip(gov: Government, seat: number, site: number, material: number, amount: number, money: number, arrive: number, back: number): void {
  if (gov.tripCount === gov.tripSeat.length) {
    const grow = <T extends Int32Array | Uint8Array | Float64Array>(a: T): T => {
      const b = new (a.constructor as { new (n: number): T })(a.length * 2);
      b.set(a);
      return b;
    };
    gov.tripSeat = grow(gov.tripSeat);
    gov.tripSite = grow(gov.tripSite);
    gov.tripMaterial = grow(gov.tripMaterial);
    gov.tripAmount = grow(gov.tripAmount);
    gov.tripMoney = grow(gov.tripMoney);
    gov.tripArrive = grow(gov.tripArrive);
    gov.tripBack = grow(gov.tripBack);
  }
  const i = gov.tripCount++;
  gov.tripSeat[i] = seat;
  gov.tripSite[i] = site;
  gov.tripMaterial[i] = material;
  gov.tripAmount[i] = amount;
  gov.tripMoney[i] = money;
  gov.tripArrive[i] = arrive;
  gov.tripBack[i] = back;
}

/**
 * Weekly: government traders arrive and set out. Every four weeks each free
 * trader of a seat brings wood or stone to a site of its district: the upkeep
 * reserve of its buildings first, then its project's materials; from the
 * seat's own stock, else bought from the settlement of its people that
 * spares the most (paid from the treasury). A seat short of money gets half
 * the treasury of the richest seat of its people.
 */
export function advanceGovernment(sim: Simulation): void {
  const gov = sim.government;
  const { world, economy, trade } = sim;
  const now = sim.tick;
  // Arrivals; trips whose trader is back are dropped (in order).
  let kept = 0;
  for (let i = 0; i < gov.tripCount; i++) {
    const site = gov.tripSite[i];
    if (gov.tripArrive[i] === now) {
      const amount = gov.tripAmount[i];
      if (amount > 0) {
        const m = gov.tripMaterial[i];
        gov.stock[site * MATERIAL_COUNT + m] += amount;
        gov.incoming[site * MATERIAL_COUNT + m] -= amount;
      }
      if (gov.tripMoney[i] > 0) gov.treasury[site] += gov.tripMoney[i];
    }
    if (gov.tripBack[i] <= now) {
      gov.away[gov.tripSeat[i]] = Math.max(0, gov.away[gov.tripSeat[i]] - 1);
      continue;
    }
    if (kept !== i) {
      gov.tripSeat[kept] = gov.tripSeat[i];
      gov.tripSite[kept] = site;
      gov.tripMaterial[kept] = gov.tripMaterial[i];
      gov.tripAmount[kept] = gov.tripAmount[i];
      gov.tripMoney[kept] = gov.tripMoney[i];
      gov.tripArrive[kept] = gov.tripArrive[i];
      gov.tripBack[kept] = gov.tripBack[i];
    }
    kept++;
  }
  gov.tripCount = kept;
  if (now % 4 !== 0) return;
  const owner = world.owner;
  const n = world.cellCount;
  // One pass over the map for the round: the seats, each district's sites with buildings and each people's
  // settlements, all in hex order (as the traders would find them hex by hex).
  const seats: number[] = [];
  const sites = new Map<number, number[]>();
  const settled = new Map<number, number[]>();
  for (let c = 0; c < n; c++) {
    if (gov.traders[c]) seats.push(c);
    const d = gov.district[c];
    if (d >= 0 && sim.hasBuildings[c]) (sites.get(d) ?? sites.set(d, []).get(d)!).push(c);
    if (sim.cellPop[c] > 0 && owner[c]) (settled.get(owner[c]) ?? settled.set(owner[c], []).get(owner[c])!).push(c);
  }
  for (const seat of seats) {
    for (let round = 0; round < gov.traders[seat]; round++) {
      if (gov.away[seat] >= gov.traders[seat]) break;
      const civ = owner[seat];
      // What its sites need: upkeep reserves of its buildings first, then its project's materials.
      let need = -1;
      let needM = 0;
      let needAmount = 0;
      for (const c of sites.get(seat) ?? []) {
        if (need >= 0) break;
        for (let m = 0; m < MATERIAL_COUNT && need < 0; m++) {
          const lack = upkeepReserve(sim, c, m) - gov.stock[c * MATERIAL_COUNT + m] - gov.incoming[c * MATERIAL_COUNT + m];
          if (lack > 0.5) [need, needM, needAmount] = [c, m, lack];
        }
      }
      const site = gov.projectSite[seat];
      if (need < 0 && site >= 0) {
        for (let m = 0; m < MATERIAL_COUNT && need < 0; m++) {
          const lack = costOf(gov.projectType[seat], m) + upkeepReserve(sim, site, m) - gov.stock[site * MATERIAL_COUNT + m] - gov.incoming[site * MATERIAL_COUNT + m];
          if (lack > 0) [need, needM, needAmount] = [site, m, lack];
        }
      }
      if (need < 0) break;
      let amount = Math.min(needAmount, TRADER_LOAD);
      // From the seat's own stock, else bought.
      let source = -1;
      const fromSeat = need !== seat && gov.stock[seat * MATERIAL_COUNT + needM] >= amount;
      if (fromSeat) source = seat;
      let price = 0;
      if (!fromSeat) {
        let best = 0;
        for (const c of settled.get(civ) ?? []) {
          const spare = trade.surplus[c * TRADE_GOODS + needM];
          if (spare >= GOV_TUNING.minLoad && spare > best) {
            best = spare;
            source = c;
          }
        }
        if (source < 0) break;
        amount = Math.min(amount, best);
        price = amount * PRICE[needM];
        if (gov.treasury[seat] - gov.reserve[seat] < price) {
          // Ask the richest seat of the people for the money.
          let rich = -1;
          for (const s of seats) if (owner[s] === civ && s !== seat && (rich < 0 || gov.treasury[s] > gov.treasury[rich])) rich = s;
          if (rich >= 0 && gov.away[rich] < gov.traders[rich] && gov.treasury[rich] - gov.reserve[rich] > 2 * price) {
            const send = (gov.treasury[rich] - gov.reserve[rich]) / 2;
            gov.treasury[rich] -= send;
            const weeks = Math.max(1, hexDistance(world, rich, seat) * WEEKS_PER_HEX);
            gov.away[rich]++;
            addTrip(gov, rich, seat, 0, 0, send, now + weeks, now + 2 * weeks);
            gov.transfers++;
            gov.transferred += send;
          }
          break;
        }
      }
      gov.sent++;
      if (fromSeat) gov.stock[seat * MATERIAL_COUNT + needM] -= amount;
      else {
        economy.stock[source * MATERIAL_COUNT + needM] -= amount;
        trade.surplus[source * TRADE_GOODS + needM] -= amount;
        economy.money[source] += price;
        gov.treasury[seat] -= price;
        gov.spent += price;
      }
      gov.incoming[need * MATERIAL_COUNT + needM] += amount;
      const weeks = Math.max(1, (hexDistance(world, seat, source) + hexDistance(world, source, need)) * WEEKS_PER_HEX);
      gov.away[seat]++;
      addTrip(gov, seat, need, needM, amount, 0, now + weeks, now + Math.max(2, weeks + hexDistance(world, need, seat) * WEEKS_PER_HEX));
    }
  }
}

// ---------------------------------------------------------------------------
// Panel

/** A government building or project for the panel. */
export type GovBuilding = { cell: number; name: string; state: 'standing' | 'building' | 'ruin' };

/** One district for the "Government" panel. */
export type District = {
  seat: number;
  capital: boolean;
  settlements: number;
  people: number;
  /** Money and goods tax rates (0..1). */
  rate: number;
  goodsRate: number;
  treasury: number;
  wood: number;
  stone: number;
  /** Yearly upkeep of its government buildings in money, and the most the income check allows. */
  upkeep: number;
  budget: number;
  buildings: GovBuilding[];
  /** Its project, null if none: what, where, and its materials (in stock and on the way) against what it needs. */
  project: { name: string; cell: number; wood: number; stone: number; needWood: number; needStone: number } | null;
  traders: number;
  away: number;
};

/** A people's districts, the capital's first, then by size. */
export function governmentOf(sim: Simulation, civ: number): District[] {
  const gov = sim.government;
  const { economy, world } = sim;
  const n = world.cellCount;
  const capital = sim.civs[civ]?.capital ?? -1;
  const byCell = new Map<number, District>();
  for (let s = 0; s < n; s++) {
    if (!gov.traders[s] || world.owner[s] !== civ) continue;
    byCell.set(s, {
      seat: s,
      capital: s === capital,
      settlements: 0,
      people: 0,
      rate: gov.rate[s],
      goodsRate: gov.goodsRate[s],
      treasury: gov.treasury[s],
      wood: gov.stock[s * MATERIAL_COUNT],
      stone: gov.stock[s * MATERIAL_COUNT + 1],
      upkeep: 0,
      budget: GOV_TUNING.incomeShare * gov.potential[s],
      buildings: [],
      project: null,
      traders: gov.traders[s],
      away: gov.away[s],
    });
  }
  for (let c = 0; c < n; c++) {
    const d = byCell.get(gov.district[c]);
    if (!d) continue;
    d.settlements++;
    d.people += sim.cellPop[c];
    if (!sim.hasBuildings[c]) continue;
    for (let s = c * SLOTS + GOV_SLOT, end = s + usableSlots(sim, c); s < end; s++) {
      const st = economy.state[s];
      if (st === SlotState.Empty) continue;
      const t = economy.type[s];
      const state = st === SlotState.Standing ? 'standing' : st === SlotState.Ruin ? 'ruin' : 'building';
      d.buildings.push({ cell: c, name: BUILDINGS[t].name, state });
      if (state !== 'ruin') d.upkeep += upkeepGold(t);
    }
  }
  for (const d of byCell.values()) {
    const site = gov.projectSite[d.seat];
    if (site < 0) continue;
    const t = gov.projectType[d.seat];
    const w = site * MATERIAL_COUNT;
    d.project = {
      name: BUILDINGS[t].name,
      cell: site,
      wood: gov.stock[w] + gov.incoming[w],
      stone: gov.stock[w + 1] + gov.incoming[w + 1],
      needWood: costOf(t, 0) + upkeepReserve(sim, site, 0, UPKEEP_RESERVE_YEARS - 1),
      needStone: costOf(t, 1) + upkeepReserve(sim, site, 1, UPKEEP_RESERVE_YEARS - 1),
    };
  }
  return [...byCell.values()].sort((a, b) => Number(b.capital) - Number(a.capital) || b.people - a.people || a.seat - b.seat);
}

/** The seat whose district a hex is in, -1 if none (for the hex info). */
export function districtOf(sim: Simulation, cell: number): number {
  return sim.government.district[cell];
}

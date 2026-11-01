import { hexDistance } from '../hex';
import { BUILDINGS, GOV_SLOT, Good, MATERIAL_COUNT, SLOTS, SlotState } from './buildings';
import { buildingFits, capacityWith, usableSlots } from './economy';
import { satisfactionTarget, seatsOf } from './satisfaction';
import type { Simulation } from './simulation';
import { ECON_TUNING, GOV_TUNING, TAX_MAX, TAX_NEUTRAL, taxValue } from './taxes';
import { MONEY_PER_ADULT, PRICE, TRADE_GOODS } from './trade';

export { GOV_TUNING, taxValue };

// The central government (agreed requirement: "Design Documents/Requirement
// Zentralregierung.md"; simulation phase). Every seat of government (and the
// capital) runs a district: the settlements nearest to it. It sets a tax rate
// as high as its settlements stay loyal, collects the taxes into its own
// treasury, and builds in the government slots of its settlements: seats of
// government first, then comfort where settlements threaten to break away,
// then whatever lets crowded settlements grow (and pay more). Its own
// traders buy the wood and stone and bring them to its building sites.

/** A government trader carries this many units of wood or stone. */
const TRADER_LOAD = 40;
/** Weeks per hex a government trader travels (roads and rivers aside). */
const WEEKS_PER_HEX = 1;
/** Years of upkeep a government building keeps in stock at its site. */
const UPKEEP_RESERVE_YEARS = 2;
const UPKEEP_GRACE_YEARS = 2;
/** Years a project may wait for its materials before the government drops it. */
const PROJECT_YEARS = 5;
const WEEKS_PER_YEAR = 52;
/** Most projects a seat can queue (GOV_TUNING.queue is at most this). */
export const QUEUE_MAX = 8;
const SEAT_TYPE = BUILDINGS.findIndex((b) => b.good === Good.Seat);
const COMFORT_TYPES = BUILDINGS.map((b, i) => (b.good === Good.Comfort ? i : -1)).filter((i) => i >= 0);
const GROWTH_TYPES = BUILDINGS.map((b, i) => (b.good <= Good.Space && !b.deposit ? i : -1)).filter((i) => i >= 0);

export type Government = {
  /** Per cell: the seat whose district it is in, -1 = none. */
  district: Int32Array;
  /** Per seat cell: money tax rate and goods tax rate of its district. */
  rate: Float32Array;
  goodsRate: Float32Array;
  /** Per cell: the money tax rate it pays (for its satisfaction). */
  cellRate: Float32Array;
  /** Per seat cell: money in its treasury. */
  treasury: Float32Array;
  /** Per cell and material: wood and stone the government keeps there (seat stock, building sites). */
  stock: Float32Array;
  /** Per seat cell: its queue of projects (QUEUE_MAX entries each): site cell, slot, type, year chosen; projectCount are in use. */
  projectSite: Int32Array;
  projectSlot: Int32Array;
  projectType: Int16Array;
  projectYear: Int32Array;
  projectCount: Uint8Array;
  /** Per cell: 1 if a seat of government is queued there (seat planning re-evaluates it, economy.ts). */
  seatQueued: Uint8Array;
  /** Per seat cell: its traders and how many are away. */
  traders: Uint8Array;
  away: Uint8Array;
  /** Per cell and material: wood and stone on its way there. */
  incoming: Float32Array;
  trips: GovTrip[];
  /** Statistics: taxes in money and goods, money spent, buildings put up. */
  collected: number;
  collectedGoods: number;
  spent: number;
  built: number;
  /** Statistics: why a free trader stayed home (nothing needed, no seller, no money) and trips made. */
  stayNoNeed: number;
  stayNoSource: number;
  stayNoMoney: number;
  sent: number;
  /** Statistics: money sent between seats, how often, and how often no seat could help. */
  transfers: number;
  transferred: number;
  noRichSeat: number;
};

type GovTrip = { seat: number; site: number; material: number; amount: number; money: number; arrive: number; back: number };

export function createGovernment(cellCount: number): Government {
  return {
    district: new Int32Array(cellCount).fill(-1),
    rate: new Float32Array(cellCount),
    goodsRate: new Float32Array(cellCount),
    cellRate: new Float32Array(cellCount),
    treasury: new Float32Array(cellCount),
    stock: new Float32Array(cellCount * MATERIAL_COUNT),
    projectSite: new Int32Array(cellCount * QUEUE_MAX).fill(-1),
    projectSlot: new Int32Array(cellCount * QUEUE_MAX).fill(-1),
    projectType: new Int16Array(cellCount * QUEUE_MAX).fill(-1),
    projectYear: new Int32Array(cellCount * QUEUE_MAX),
    projectCount: new Uint8Array(cellCount),
    seatQueued: new Uint8Array(cellCount),
    traders: new Uint8Array(cellCount),
    away: new Uint8Array(cellCount),
    incoming: new Float32Array(cellCount * MATERIAL_COUNT),
    trips: [],
    collected: 0,
    collectedGoods: 0,
    spent: 0,
    built: 0,
    stayNoNeed: 0,
    stayNoSource: 0,
    stayNoMoney: 0,
    sent: 0,
    transfers: 0,
    transferred: 0,
    noRichSeat: 0,
  };
}

/** The highest rate whose term is at least `need`. */
function rateFor(need: number): number {
  if (need > GOV_TUNING.taxPlus) return 0;
  if (need >= 0) return TAX_NEUTRAL * (1 - need / GOV_TUNING.taxPlus);
  return TAX_NEUTRAL + (TAX_MAX - TAX_NEUTRAL) * Math.min(1, -need / GOV_TUNING.taxMinus);
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

/** Yearly upkeep in money of a seat's government buildings and queued projects. */
function districtUpkeep(sim: Simulation, seat: number): number {
  const { economy } = sim;
  const gov = sim.government;
  let sum = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (gov.district[c] !== seat || !sim.hasBuildings[c]) continue;
    for (let s = c * SLOTS + GOV_SLOT, end = s + usableSlots(sim, c); s < end; s++) {
      const st = economy.state[s];
      if (st === SlotState.Standing || st === SlotState.Construction) sum += upkeepGold(economy.type[s]);
    }
  }
  for (let i = seat * QUEUE_MAX, end = i + gov.projectCount[seat]; i < end; i++) sum += upkeepGold(gov.projectType[i]);
  return sum;
}

const goldCost = (type: number) => BUILDINGS[type].wood * PRICE[0] + BUILDINGS[type].stone * PRICE[1];

/** A chronicle entry at a hex (simulation.ts: record). */
export type Record = (text: string, cell: number) => void;

/**
 * Yearly: districts, tax rates, taxes, upkeep of government buildings and
 * the next project of every seat.
 */
export function updateGovernment(sim: Simulation, owner: Uint8Array, record: Record): void {
  if (!GOV_TUNING.on) return;
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
  // Traders and rates per seat.
  const isSeat = new Uint8Array(n);
  for (let civ = 1; civ < seats.length; civ++) {
    const civObj = sim.civs[civ];
    for (const s of seats[civ] ?? []) {
      isSeat[s] = 1;
      gov.traders[s] = civObj && civObj.capital === s ? GOV_TUNING.capitalTraders : GOV_TUNING.traders;
    }
  }
  const civFinancing = new Uint8Array(sim.civSlots);
  for (let s = 0; s < n; s++) if (isSeat[s] && seatQueued(gov, s)) civFinancing[owner[s]] = 1;
  const low = new Float32Array(n).fill(Infinity);
  const sum = new Float32Array(n);
  const count = new Uint16Array(n);
  for (let c = 0; c < n; c++) {
    const s = gov.district[c];
    if (s < 0) continue;
    // Satisfaction without its taxes.
    const base = satisfactionTarget(sim, c, sim.civs[owner[c]] ?? null) - taxValue(gov.cellRate[c]);
    low[s] = Math.min(low[s], base);
    sum[s] += base;
    count[s]++;
  }
  for (let s = 0; s < n; s++) {
    if (!isSeat[s]) {
      gov.rate[s] = 0;
      gov.goodsRate[s] = 0;
      gov.traders[s] = 0;
      continue;
    }
    if (count[s] === 0) continue;
    const base = GOV_TUNING.weakest ? low[s] : sum[s] / count[s];
    // While a seat is to be paid for, its district (seatTax 1) or its whole people (2) taxes without the safety margin.
    const financing = (GOV_TUNING.seatTax === 1 && seatQueued(gov, s)) || (GOV_TUNING.seatTax === 2 && civFinancing[owner[s]] === 1);
    const rate = rateFor((financing ? GOV_TUNING.seatMargin : GOV_TUNING.margin) - base);
    if (Math.abs(rate - gov.rate[s]) >= 0.1) {
      record(`The ${sim.civs[owner[s]]?.name ?? ''} ${rate > gov.rate[s] ? 'raised' : 'lowered'} the taxes around ${s === sim.civs[owner[s]]?.capital ? 'the capital' : 'a seat of government'} to ${Math.round(rate * 100)} %.`, s);
    }
    gov.rate[s] = rate;
    gov.goodsRate[s] = GOV_TUNING.goodsTax ? rate : 0;
  }
  // Taxes.
  for (let c = 0; c < n; c++) {
    const s = gov.district[c];
    gov.cellRate[c] = s >= 0 ? gov.rate[s] : 0;
    if (s < 0) continue;
    const tax = Math.min(economy.money[c], gov.rate[s] * sim.cellAdults[c] * MONEY_PER_ADULT * ECON_TUNING.money);
    economy.money[c] -= tax;
    gov.treasury[s] += tax;
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
  // Upkeep of government buildings, from the government's stock at their site.
  for (let c = 0; c < n; c++) {
    if (!sim.hasBuildings[c]) continue;
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
      }
    }
  }
  // Projects: start what is paid for, drop what is lost or waited too long, fill the queue.
  const year = Math.floor(sim.tick / WEEKS_PER_YEAR);
  const length = Math.min(QUEUE_MAX, GOV_TUNING.queue);
  for (let s = 0; s < n; s++) {
    if (!isSeat[s]) {
      gov.projectCount[s] = 0;
      continue;
    }
    const q = s * QUEUE_MAX;
    let kept = 0;
    let seatQueued = false;
    for (let i = 0; i < gov.projectCount[s]; i++) {
      const site = gov.projectSite[q + i];
      const type = gov.projectType[q + i];
      const slot = gov.projectSlot[q + i];
      const b = BUILDINGS[type];
      const w = site * MATERIAL_COUNT;
      if (owner[site] !== owner[s] || sim.cellPop[site] === 0 || economy.state[slot] !== SlotState.Empty) continue; // lost or taken
      if (type === SEAT_TYPE && !sim.seatSite[site]) continue; // seat planning found a better site, or none is worth it
      // Its upkeep reserve stays (upkeep first).
      if (gov.stock[w] - upkeepReserve(sim, site, 0) >= costOf(type, 0) && gov.stock[w + 1] - upkeepReserve(sim, site, 1) >= costOf(type, 1)) {
        gov.stock[w] -= costOf(type, 0);
        gov.stock[w + 1] -= costOf(type, 1);
        economy.type[slot] = type;
        economy.state[slot] = SlotState.Construction;
        economy.work[slot] = b.years;
        economy.unpaid[slot] = 0;
        sim.hasBuildings[site] = 1;
        gov.built++;
        if (type === SEAT_TYPE) sim.seatSite[site] = 0;
        continue;
      }
      if (type !== SEAT_TYPE && year - gov.projectYear[q + i] >= PROJECT_YEARS) continue; // waited too long
      if (type === SEAT_TYPE) seatQueued = true;
      gov.projectSite[q + kept] = site;
      gov.projectSlot[q + kept] = slot;
      gov.projectType[q + kept] = type;
      gov.projectYear[q + kept] = gov.projectYear[q + i];
      kept++;
    }
    gov.projectCount[s] = kept;
    // A planned seat goes before any other project, if need be in place of the last one.
    if (!seatQueued && chooseProject(sim, s, true)) {
      if (gov.projectCount[s] >= length) gov.projectCount[s] = length - 1;
      for (let i = gov.projectCount[s]; i > 0; i--) {
        gov.projectSite[q + i] = gov.projectSite[q + i - 1];
        gov.projectSlot[q + i] = gov.projectSlot[q + i - 1];
        gov.projectType[q + i] = gov.projectType[q + i - 1];
        gov.projectYear[q + i] = gov.projectYear[q + i - 1];
      }
      [gov.projectSite[q], gov.projectSlot[q], gov.projectType[q], gov.projectYear[q]] = [pickSite, pickSlot, pickType, year];
      gov.projectCount[s]++;
    }
    while (gov.projectCount[s] < length && chooseProject(sim, s, false)) {
      const i = q + gov.projectCount[s]++;
      [gov.projectSite[i], gov.projectSlot[i], gov.projectType[i], gov.projectYear[i]] = [pickSite, pickSlot, pickType, year];
    }
  }
  gov.seatQueued.fill(0);
  for (let s = 0; s < n; s++) {
    for (let i = s * QUEUE_MAX, end = i + gov.projectCount[s]; i < end; i++) if (gov.projectType[i] === SEAT_TYPE) gov.seatQueued[gov.projectSite[i]] = 1;
  }
}

/** Wood or stone the government keeps at `cell` for its buildings' upkeep (UPKEEP_RESERVE_YEARS of it). */
function upkeepReserve(sim: Simulation, cell: number, m: number): number {
  const { economy } = sim;
  let sum = 0;
  for (let s = cell * SLOTS + GOV_SLOT, end = s + usableSlots(sim, cell); s < end; s++) {
    const st = economy.state[s];
    if (st !== SlotState.Standing && st !== SlotState.Construction) continue;
    sum += upkeepOf(economy.type[s], m);
  }
  return sum * UPKEEP_RESERVE_YEARS;
}

/** Whether a seat's queue holds a seat of government. */
function seatQueued(gov: Government, seat: number): boolean {
  for (let i = seat * QUEUE_MAX, end = i + gov.projectCount[seat]; i < end; i++) if (gov.projectType[i] === SEAT_TYPE) return true;
  return false;
}

/** Whether a seat's queue already has a project at `cell`. */
function queued(gov: Government, seat: number, cell: number): boolean {
  for (let i = seat * QUEUE_MAX, end = i + gov.projectCount[seat]; i < end; i++) if (gov.projectSite[i] === cell) return true;
  return false;
}

let pickSite = -1;
let pickSlot = -1;
let pickType = -1;

/** A free government slot of a hex, -1 if none. */
function freeGovSlot(sim: Simulation, cell: number): number {
  for (let s = cell * SLOTS + GOV_SLOT, end = s + usableSlots(sim, cell); s < end; s++) if (sim.economy.state[s] === SlotState.Empty) return s;
  return -1;
}

/** The next project of a seat's district, into pickSite/pickSlot/pickType: a planned seat, comfort for the restless, growth for the crowded (one project per site). */
function chooseProject(sim: Simulation, seat: number, seatOnly: boolean): boolean {
  const gov = sim.government;
  const n = sim.world.cellCount;
  let bestSite = -1;
  let bestSlot = -1;
  let bestType = -1;
  let bestScore = 0;
  // Only what the treasury can keep up for GOV_TUNING.secureYears (upkeep secured).
  const upkeep = districtUpkeep(sim, seat);
  const secured = (t: number) => gov.treasury[seat] >= GOV_TUNING.secureYears * (upkeep + upkeepGold(t));
  for (let c = 0; c < n; c++) {
    if (gov.district[c] !== seat || queued(gov, seat, c)) continue;
    const slot = freeGovSlot(sim, c);
    if (slot < 0) continue;
    // 1. A planned seat of government.
    if (sim.seatSite[c] && buildingFits(sim, c, SEAT_TYPE) && secured(SEAT_TYPE)) {
      const score = 1000;
      if (score > bestScore) [bestSite, bestSlot, bestType, bestScore] = [c, slot, SEAT_TYPE, score];
      continue;
    }
    if (seatOnly) continue;
    const people = sim.cellPop[c];
    // 2. Comfort where a settlement threatens to break away.
    if (sim.satisfaction[c] < GOV_TUNING.margin) {
      for (const t of COMFORT_TYPES) {
        if (!buildingFits(sim, c, t) || !secured(t)) continue;
        const score = 100 + (GOV_TUNING.margin - sim.satisfaction[c]) * people * 0.01;
        if (score > bestScore) [bestSite, bestSlot, bestType, bestScore] = [c, slot, t, score];
        break;
      }
    }
    // 3. Growth where it is crowded (more people pay more taxes).
    if (people >= 0.8 * sim.cellCapacity[c]) {
      for (const t of GROWTH_TYPES) {
        if (!buildingFits(sim, c, t) || !secured(t)) continue;
        const gain = capacityWith(sim, c, t, -1) - sim.cellCapacity[c];
        if (gain < 1) continue;
        const score = gain / Math.max(1, goldCost(t)) * 10;
        if (score > bestScore) [bestSite, bestSlot, bestType, bestScore] = [c, slot, t, score];
      }
    }
  }
  [pickSite, pickSlot, pickType] = [bestSite, bestSlot, bestType];
  return bestSite >= 0;
}

/**
 * Weekly: government traders arrive and set out. A free trader of a seat
 * brings wood or stone to the site of its project or of its buildings'
 * upkeep: from the seat's own stock, else bought from the settlement of its
 * people that spares the most (paid from the treasury). A seat short of money
 * for its project gets it from the richest seat of its people.
 */
export function advanceGovernment(sim: Simulation): void {
  if (!GOV_TUNING.on) return;
  const gov = sim.government;
  const { world, economy, trade } = sim;
  const now = sim.tick;
  // Arrivals.
  const keep: GovTrip[] = [];
  for (const t of gov.trips) {
    if (t.arrive === now) {
      if (t.amount > 0) {
        gov.stock[t.site * MATERIAL_COUNT + t.material] += t.amount;
        gov.incoming[t.site * MATERIAL_COUNT + t.material] -= t.amount;
      }
      if (t.money > 0) gov.treasury[t.site] += t.money;
    }
    if (t.back <= now) gov.away[t.seat] = Math.max(0, gov.away[t.seat] - 1);
    else keep.push(t);
  }
  gov.trips = keep;
  if (now % 4 !== 0) return;
  const owner = world.owner;
  const n = world.cellCount;
  for (let seat = 0; seat < n; seat++) {
    if (gov.traders[seat] === 0 || gov.away[seat] >= gov.traders[seat]) continue;
    const civ = owner[seat];
    // What its sites need: upkeep reserves of its buildings first, then the queued projects' materials in turn.
    let need = -1;
    let needM = 0;
    let needAmount = 0;
    if (need < 0) {
      for (let c = 0; c < n && need < 0; c++) {
        if (gov.district[c] !== seat || !sim.hasBuildings[c]) continue;
        for (let m = 0; m < MATERIAL_COUNT && need < 0; m++) {
          const lack = upkeepReserve(sim, c, m) - gov.stock[c * MATERIAL_COUNT + m] - gov.incoming[c * MATERIAL_COUNT + m];
          if (lack > 0.5) [need, needM, needAmount] = [c, m, lack];
        }
      }
    }
    if (need < 0) {
      for (let i = seat * QUEUE_MAX, end = i + gov.projectCount[seat]; i < end && need < 0; i++) {
        const site = gov.projectSite[i];
        const b = BUILDINGS[gov.projectType[i]];
        for (let m = 0; m < MATERIAL_COUNT && need < 0; m++) {
          const lack = costOf(gov.projectType[i], m) + upkeepReserve(sim, site, m) - gov.stock[site * MATERIAL_COUNT + m] - gov.incoming[site * MATERIAL_COUNT + m];
          if (lack > 0) [need, needM, needAmount] = [site, m, lack];
        }
      }
    }
    if (need < 0) {
      gov.stayNoNeed++;
      continue;
    }
    let amount = Math.min(needAmount, TRADER_LOAD);
    // From the seat's own stock, else bought.
    let source = -1;
    if (need !== seat && gov.stock[seat * MATERIAL_COUNT + needM] >= amount) source = seat;
    let price = 0;
    if (source < 0) {
      let best = 0;
      // Its own people's settlements, and with buyPartners those of peoples whose merchants trade with it.
      const partnersOf = sim.diplomacy.partners;
      for (let c = 0; c < n; c++) {
        const o = owner[c];
        if (sim.cellPop[c] === 0 || (o !== civ && !(GOV_TUNING.buyPartners && partnersOf[o]?.includes(civ)))) continue;
        const spare = trade.surplus[c * TRADE_GOODS + needM];
        if (spare >= GOV_TUNING.minLoad && spare > best) {
          best = spare;
          source = c;
        }
      }
      if (source >= 0) amount = Math.min(amount, best);
      price = amount * PRICE[needM];
      if (source >= 0 && gov.treasury[seat] < price) {
        // Ask the richest seat of the people for the money.
        let rich = -1;
        for (let s = 0; s < n; s++) if (gov.traders[s] && owner[s] === civ && s !== seat && (rich < 0 || gov.treasury[s] > gov.treasury[rich])) rich = s;
        if (rich >= 0 && gov.away[rich] < gov.traders[rich] && gov.treasury[rich] > 2 * price) {
          const send = gov.treasury[rich] / 2;
          gov.treasury[rich] -= send;
          const weeks = Math.max(1, hexDistance(world, rich, seat) * WEEKS_PER_HEX);
          gov.away[rich]++;
          gov.trips.push({ seat: rich, site: seat, material: 0, amount: 0, money: send, arrive: now + weeks, back: now + 2 * weeks });
          gov.transfers++;
          gov.transferred += send;
        } else gov.noRichSeat++;
        gov.stayNoMoney++;
        continue;
      }
    }
    if (source < 0) {
      gov.stayNoSource++;
      continue;
    }
    gov.sent++;
    if (source === seat) gov.stock[seat * MATERIAL_COUNT + needM] -= amount;
    else {
      economy.stock[source * MATERIAL_COUNT + needM] -= amount;
      trade.surplus[source * TRADE_GOODS + needM] -= amount;
      economy.money[source] += price;
      gov.treasury[seat] -= price;
      gov.spent += price;
    }
    gov.incoming[need * MATERIAL_COUNT + needM] += amount;
    const toSource = hexDistance(world, seat, source) * WEEKS_PER_HEX;
    const toSite = hexDistance(world, source, need) * WEEKS_PER_HEX;
    const home = hexDistance(world, need, seat) * WEEKS_PER_HEX;
    gov.away[seat]++;
    gov.trips.push({ seat, site: need, material: needM, amount, money: 0, arrive: now + Math.max(1, toSource + toSite), back: now + Math.max(2, toSource + toSite + home) });
  }
}

import { TICKS_PER_YEAR, stepSimulation, type Simulation } from '../sim';
import { hexDistance } from '../sim/hex';
import { BUILDINGS, GOV_SLOT, Good, SLOTS, SlotState } from '../sim/society/buildings';
import { buildingFits, updateCellSupply, usableSlots } from '../sim/society/economy';

// The "government" benchmark scenario: the most the central government
// shows and does at once. Every settlement at least SEAT_SPACING hexes from
// a seat of government gets one (flags and districts all over the map),
// every settlement fills its government slots with standing buildings (the
// military ones first, so soldiers are trained and paid everywhere), and
// every seat gets money; then a year runs so the districts, taxes and
// projects follow and government traders are on their way during the swipes.

/** No seat closer than this to another (in hexes). */
const SEAT_SPACING = 2;
/** Money each seat's treasury gets, so its traders buy and deliver. */
const TREASURY = 300;
const SEAT_TYPE = BUILDINGS.findIndex((b) => b.good === Good.Seat);
const MILITARY_GOODS: readonly number[] = [Good.Barracks, Good.Range, Good.Stable];
const isMilitary = (i: number) => MILITARY_GOODS.includes(BUILDINGS[i].good);
/**
 * Government buildings to fill slots with: anything but seats, mines and trade buildings, the military
 * buildings first (barracks, shooting ranges, stables), so soldiers are trained and paid everywhere.
 */
const FILL_TYPES = BUILDINGS.map((b, i) => (b.good !== Good.Seat && b.deposit === undefined && b.good !== Good.Merchants && b.good !== Good.Harbor ? i : -1))
  .filter((i) => i >= 0)
  .sort((a, b) => Number(isMilitary(b)) - Number(isMilitary(a)) || a - b);

/** Seats and government buildings everywhere, money in every treasury, then a year of simulation. */
export function empowerGovernment(sim: Simulation): void {
  const { world } = sim;
  const n = world.cellCount;
  const seats: number[] = [];
  for (const civ of sim.civs) if (civ && civ.capital >= 0) seats.push(civ.capital);
  for (let c = 0; c < n; c++) {
    if (sim.cellPop[c] === 0 || world.owner[c] === 0) continue;
    const slots = usableSlots(sim, c);
    let next = c * SLOTS + GOV_SLOT;
    const end = next + slots;
    const far = seats.every((s) => hexDistance(world, s, c) >= SEAT_SPACING);
    if (far && buildingFits(sim, c, SEAT_TYPE)) {
      putUp(sim, next++, SEAT_TYPE);
      seats.push(c);
    }
    for (const t of FILL_TYPES) {
      if (next >= end) break;
      if (buildingFits(sim, c, t)) putUp(sim, next++, t);
    }
    sim.hasBuildings[c] = 1;
    updateCellSupply(sim, c);
  }
  for (const s of seats) sim.government.treasury[s] += TREASURY;
  for (let t = 0; t < TICKS_PER_YEAR && !sim.gameOver; t++) stepSimulation(sim);
}

function putUp(sim: Simulation, slot: number, type: number): void {
  const { economy } = sim;
  economy.type[slot] = type;
  economy.state[slot] = SlotState.Standing;
  economy.work[slot] = 0;
  economy.unpaid[slot] = 0;
}

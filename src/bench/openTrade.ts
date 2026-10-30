import { TICKS_PER_YEAR, stepSimulation, type Simulation } from '../sim';
import { BUILDINGS, LUXURY_COUNT, SLOTS, SlotState } from '../sim/society/buildings';
import { updateCellSupply } from '../sim/society/economy';
import { isCoast, updateTradeBuildings } from '../sim/society/trade';

// The "trade" benchmark scenario: the most trade the map and simulation
// carry at once. Every settlement gets a trade center, every coastal one a
// harbor (in a free slot, or in place of its last building) and a stock of
// one luxury good (taking turns, so every settlement can spare one and asks
// for the others), and half a year runs so merchants are on their way during
// the swipes.

const CENTER = BUILDINGS.findIndex((b) => b.name === 'Trade center');
const HARBOR = BUILDINGS.findIndex((b) => b.name === 'Harbor');
/** Luxury goods each settlement gets to sell. */
const LUXURY_STOCK = 50;

/** Gives every settlement a trade center, every coastal one a harbor and luxury goods to sell, then simulates half a year. */
export function openTrade(sim: Simulation): void {
  const { world, economy } = sim;
  for (let c = 0; c < world.cellCount; c++) {
    if (sim.cellPop[c] === 0) continue;
    putUp(sim, c, CENTER, SLOTS - 1);
    if (isCoast(world, c)) putUp(sim, c, HARBOR, SLOTS - 2);
    updateTradeBuildings(sim, c);
    updateCellSupply(sim, c);
    // Something to sell and money to buy, so merchants actually set out.
    economy.luxury[c * LUXURY_COUNT + (c % LUXURY_COUNT)] += LUXURY_STOCK;
    economy.money[c] = Math.max(economy.money[c], 100);
  }
  // A quarter for the totals of what each people asks for and spares, a second for merchants to set out.
  const halfYear = TICKS_PER_YEAR / 2;
  for (let t = 0; t < halfYear && !sim.gameOver; t++) stepSimulation(sim);
}

/** A standing building of `type` in a free slot, else in `fallback`. */
function putUp(sim: Simulation, cell: number, type: number, fallback: number): void {
  const { economy } = sim;
  let slot = cell * SLOTS + fallback;
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (economy.state[s] === SlotState.Standing && economy.type[s] === type) return;
    if (economy.state[s] === SlotState.Empty) {
      slot = s;
      break;
    }
  }
  economy.type[slot] = type;
  economy.state[slot] = SlotState.Standing;
  economy.work[slot] = 0;
  economy.unpaid[slot] = 0;
  sim.hasBuildings[cell] = 1;
}

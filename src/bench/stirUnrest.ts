import { TICKS_PER_YEAR, livingCivilizations, stepSimulation, type Simulation } from '../sim';

// The "unrest" benchmark scenario: the busiest map the satisfaction feature
// can draw. Every settlement but the capitals has been unhappy for years, so
// within a quarter road-connected leagues all over the map break away as
// new peoples: many small territories, borders and colors.

/** Years of unhappiness the breakaway rule asks for (satisfaction.ts). */
const UNHAPPY_QUARTERS = 5 * 4;

/** Makes every settlement except the capitals restless and simulates the quarter in which they break away. */
export function stirUnrest(sim: Simulation): void {
  const capitals = new Set(livingCivilizations(sim).map((c) => c.capital));
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (sim.cellPop[c] === 0 || capitals.has(c)) continue;
    sim.satisfaction[c] = -80;
    sim.moodSet[c] = 1;
    sim.unhappyQuarters[c] = UNHAPPY_QUARTERS;
  }
  const quarter = TICKS_PER_YEAR / 4;
  for (let t = 0; t < quarter && !sim.gameOver; t++) stepSimulation(sim);
}

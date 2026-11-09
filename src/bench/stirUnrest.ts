import { EndType, TICKS_PER_YEAR, endWar, livingCivilizations, startRebellion, stepSimulation, type Simulation } from '../sim';

// The "unrest" benchmark scenario: the busiest map the satisfaction feature
// can draw. Every settlement but the capitals rises up at once (war phase 5:
// a rebellion per realm, one new people per road-joined group), and each
// rebellion ends at once with the rebels independent (as after exhaustion),
// so the map has many small territories, borders and colors, but no armies.

/** Makes every settlement except the capitals rebel and stay independent, then simulates a quarter (the map's snapshot). */
export function stirUnrest(sim: Simulation): void {
  for (const civ of livingCivilizations(sim)) {
    const s = startRebellion(sim, civ.id, true);
    if (s >= 0) endWar(sim, s, EndType.Exhausted);
  }
  const quarter = TICKS_PER_YEAR / 4;
  for (let t = 0; t < quarter && !sim.gameOver; t++) stepSimulation(sim);
}

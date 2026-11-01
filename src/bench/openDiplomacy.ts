import { TICKS_PER_YEAR, livingCivilizations, stepSimulation, type Simulation } from '../sim';
import { PAIRS, PEACE_MAX } from '../sim/society/diplomacy';

// The "diplomacy" benchmark scenario: the most the diplomacy feature shows
// and does at once. Every people knows every other, all borders are open
// (dashed on the map) and everyone trades freely, then half a year runs so
// merchants cross foreign land and pay toll during the swipes.

/** Opens every border between all peoples, makes them free trade partners and simulates half a year. */
export function openDiplomacy(sim: Simulation): void {
  const dip = sim.diplomacy;
  const ids = livingCivilizations(sim).map((c) => c.id);
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const k = a * PAIRS + b;
      dip.known[k] = 1;
      dip.open[k] = 1;
      dip.freeTrade[k] = 1;
      // Full trust from peace, so the yearly diplomacy keeps them open while the benchmark runs.
      dip.peace[k] = PEACE_MAX;
    }
  }
  dip.bordersVersion++;
  dip.partners = [];
  for (const a of ids) dip.partners[a] = ids.filter((b) => b !== a);
  for (let t = 0; t < TICKS_PER_YEAR / 2 && !sim.gameOver; t++) stepSimulation(sim);
}

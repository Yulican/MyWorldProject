import { DIRECTION_COUNT, isWaterBiome, type Simulation } from '../sim';
import { BUILDINGS, SLOTS, SlotState } from '../sim/society/buildings';
import { updateCellSupply } from '../sim/society/economy';

// The "cities" benchmark scenario: the busiest map the building feature can
// draw. Every settled hex becomes a big city and free land next to any
// territory gets ruins, so every territory tile carries icons.

/** Gives every settled hex a full set of standing buildings and free land beside it ruins. */
export function fillWithBuildings(sim: Simulation): void {
  const { world, economy } = sim;
  const n = world.cellCount;
  const settled = new Uint8Array(n);
  for (let c = 0; c < n; c++) settled[c] = sim.cellPop[c] > 0 ? 1 : 0;
  for (let c = 0; c < n; c++) {
    if (isWaterBiome(world.biome[c])) continue;
    let ruin = false;
    if (!settled[c]) {
      for (let d = 0; d < DIRECTION_COUNT && !ruin; d++) {
        const nb = world.neighbors[c * DIRECTION_COUNT + d];
        ruin = nb >= 0 && settled[nb] === 1;
      }
      if (!ruin) continue;
    }
    for (let s = c * SLOTS, k = 0; k < SLOTS; s++, k++) {
      economy.type[s] = k % BUILDINGS.length;
      economy.state[s] = ruin ? (k === 0 ? SlotState.Ruin : SlotState.Empty) : SlotState.Standing;
      economy.work[s] = 0;
      economy.unpaid[s] = 0;
      if (economy.state[s] === SlotState.Empty) economy.type[s] = -1;
    }
    sim.hasBuildings[c] = 1;
    world.buildings[c] = ruin ? 0 : SLOTS;
    world.ruins[c] = ruin ? 1 : 0;
    updateCellSupply(sim, c);
  }
  sim.snapshotVersion++;
}

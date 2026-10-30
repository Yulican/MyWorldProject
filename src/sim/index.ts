// Public API of the simulation core. Plain TypeScript, no React or React
// Native imports, so it can run anywhere (app, tests, tools) and be ported
// to C++ later.
export * from './hex';
export { createRng, deriveSeed, randomSeed, type Rng } from './rng';
export * from './world/biomes';
export * from './world/deposits';
export { generateWorld, DEFAULT_WORLD_WIDTH, DEFAULT_WORLD_HEIGHT, type WorldOptions } from './world/generate';
export { hasFreshWater } from './world/hydrology';
export { ROAD_TRAVEL_FACTOR, hasRoad, stepCost, travelCostField } from './world/roads';
export { elevationMeters, resourceAt, WORLD_VERSION, type World, type WorldShape } from './world/world';
export { CIV_COLOR_COUNT, MAX_CIVS, type CivOrigin, type Civilization } from './society/civilizations';
export { CULTURE_COUNT, CULTURE_NAMES, Culture } from './society/culture';
export { SUPPLY_KINDS, SUPPLY_NAMES, SupplyKind } from './society/supply';
export {
  BELIEVER_FAITH,
  EXPANSION_GROUP,
  TICKS_PER_YEAR,
  createSimulation,
  livingCivilizations,
  simulationYear,
  stepSimulation,
  type ChronicleEntry,
  type Simulation,
} from './society/simulation';

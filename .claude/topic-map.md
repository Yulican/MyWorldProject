# Topic map

Where each topic of MyWorldProject lives, so agents can open the right files without searching. Read only the rows your task needs. Big files (>800 lines): search them with grep, don't read them whole. Keep this map up to date when files move or a topic is added.

## Simulation core (`src/sim/`, agent `sim-engineer`)

| Topic | Code | Tests | Requirement | Stats tool | Benchmark scenario |
|---|---|---|---|---|---|
| World generation: terrain, climate, water, biomes, deposits | `world/generate.ts`, `terrain.ts`, `climate.ts`, `hydrology.ts`, `biomes.ts`, `classify.ts`, `features.ts`, `deposits.ts` | `world/generate.test.ts` | Game Design doc | `npm run world:preview` | young |
| World data layout (typed arrays per cell) | `world/world.ts`, `sim/hex.ts` | `hex.test.ts` | – | – | – |
| Roads | `world/roads.ts` | – | Requirement Handel | – | aged |
| Inhabitants, aging, births, migration, settling (main loop, 1320 lines; a tick runs in parts, `stepSimulationPart`, which the game clock in `src/state/worldStore.ts` spreads over frames) | `society/simulation.ts`, `population.ts` | `simulation.test.ts` | Game Design doc | `economyStats.ts` | aged |
| Food, water, space per hex | `society/supply.ts` | – | Requirement Regionale Rohstoffe | `economyStats.ts` | – |
| Harvest, buildings, construction, upkeep (912 lines) | `society/economy.ts`, `buildings.ts` | `economy.test.ts` | Requirement Regionale Rohstoffe | `economyStats.ts` | cities |
| Peoples, culture, names | `society/civilizations.ts`, `culture.ts` | – | Game Design doc | – | – |
| Satisfaction, uprisings | `society/satisfaction.ts` (+ uprisings in `simulation.ts`) | `satisfaction.test.ts` | Requirement Zufriedenheit | `satisfactionStats.ts` | unrest |
| Trade, merchants, harbors, goods (1280 lines) | `society/trade.ts` | `trade.test.ts` | Requirement Handel (+ Diplomatie for foreign trade) | `economyStats.ts` | trade |
| Diplomacy: trust, borders, treaties, seats of government (914 lines) | `society/diplomacy.ts` | `diplomacy.test.ts` | Requirement Diplomatie | `diplomacyStats.ts`, `economyStats.ts open=1` | diplomacy |
| Central government: seats, goods tax, government buildings and traders | `society/government.ts`, `taxes.ts` (+ government traders in `trade.ts`) | `government.test.ts` | Requirement Zentralregierung | `economyStats.ts` | government |
| War: soldiers, battles, sieges, alliances, rebel wars | phase 0+1 as simulation experiment (uncommitted on `feature/war`): `society/military.ts` (soldiers, pay, strength, `MIL` numbers), mines/gold in `economy.ts` (harvestLuxury, planMilitary placeholder), strategic goods in `trade.ts`, danger from strength in `diplomacy.ts`; battles etc. planned `society/war.ts` | – | Requirement Krieg (draft) | `warStats.ts` (variants `name:key=val,...`) | planned `war` |
| Randomness, noise, helpers | `rng.ts`, `noise.ts`, `minHeap.ts`, `terms.ts`, `index.ts` (public API) | – | – | – | – |

## App (agent `app-engineer`)

| Topic | Code | Notes |
|---|---|---|
| Simulation outside React, snapshots for the map | `src/state/worldStore.ts` | components subscribe; Context only for UI state (`src/context/AppContext.tsx`, `src/hooks/useApp.ts`) |
| Map rendering (Skia), gestures, zoom | `src/map/WorldMap.tsx`, `viewport.ts`, `mapGeometry.ts` | `viewport.test.ts` |
| Map pictures, tile cache | `src/map/worldPicture.ts`, `tileImages.ts`, `hexIcons.ts`, `palette.ts`, `paints.ts` | hot path for the benchmark |
| Territories, borders (dashed = open), seat flags | `src/map/territoryLayers.ts` | unrest, diplomacy, government scenarios |
| FPS meter, perf counters | `src/map/MapPerfMeter.tsx`, `motionStats.ts`, `src/state/perfStats.ts` | `motionStats.test.ts` |
| Screen, panels, dialogs (English texts) | `src/screens/WorldScreen.tsx`, `src/components/HexInfoPanel.tsx`, `CivPanel.tsx`, `DiplomacyPanel.tsx`, `GovernmentPanel.tsx`, `ChronicleDialog.tsx`, `TimeControls.tsx`, `Screen.tsx`, `src/theme/` | – |
| Benchmark rules and scenarios | `src/bench/benchmark.ts` (rules), `useBenchmark.ts` (in-app runner), `fillBuildings.ts` (cities), `stirUnrest.ts` (unrest), `openTrade.ts` (trade), `openDiplomacy.ts` (diplomacy), `empowerGovernment.ts` (government) | `benchmark.test.ts`; scenario list also in `.github/workflows/android-build.yml` and `AGENTS.md` |
| Build, CI, native config | `app.json`, `eas.json`, `.github/workflows/android-build.yml`, `scripts/swap-js-bundle.sh` | `android/` is generated, never edit |

## Design (agent `designer`)

| Document | Content |
|---|---|
| `Design Documents/Game Design Gott einer Zivilisation.pdf` (.docx = source) | overall design: god, tribe, influence, gacha abilities, sections 5–6 economy and society |
| `Requirement Regionale Rohstoffe.md` | supply, harvest, buildings, upkeep |
| `Requirement Zufriedenheit.md` | satisfaction, uprisings |
| `Requirement Handel.md` | internal trade, merchants, goods, prices |
| `Requirement Diplomatie.md` | trust, borders, foreign trade |
| `Requirement Zentralregierung.md` | seats of government, goods tax, government buildings and traders |
| `Requirement Krieg.md` | war: soldiers, strategic goods, battles, sieges, alliances, rebel wars (draft, 5 phases) |
| `sim-prototyp/` | old standalone load prototype, placeholder rules |

import {
  ABILITIES,
  ABILITY_COUNT,
  Ab,
  Biome,
  SHIFT_DRIER,
  SHIFT_WETTER,
  TargetKind,
  canCast,
  castAbility,
  checkBiomesFast,
  livingCivilizations,
  shiftedBiome,
  type Simulation,
} from '../sim';
import { hexDistance } from '../sim/hex';
import type { BenchTick } from '../state/worldStore';

// The "gacha" benchmark scenario (Requirement Gacha 10): the most the god's
// abilities change on the map at once. On an aged world the setup casts
// charges of all 25 abilities on targets spread around the map's center,
// where the benchmark's view swipes: wild fires in forests, great rivers
// and their lakes, biome shifts both ways, more and fewer building slots
// (the slot arrays grow), fertile and exhausted soil, droughts and new
// deposits, every people ability on every people and the leader abilities
// on every leader. During the swipes, `gachaDuringSwipes` keeps the land
// changing: new fires while fewer than MIN_BURNING hexes burn, a biome
// shift back and forth and now and then a new river, so terrain tiles,
// fires and ruins are redrawn throughout (only while the map rests, as in the game).
// The natural biome changes (Requirement Dynamische Biome 11) run accelerated
// too: every land hex is checked every BIOME_EVERY ticks instead of every 5
// years, split into BIOME_SLICES slices between ticks so no frame carries all.

/** Hexes around the map's center the benchmark's view covers while it swipes (zoom 2, 750 pt swipes). */
const NEAR = 12;
/** Targets of the setup near the center, and the spacing between targets of one ability (hexes). */
const SETUP = {
  fires: 8,
  rivers: 6,
  shifts: 16,
  blessings: 6,
  droughts: 3,
  exhausted: 6,
  veins: 6,
  spacing: 3,
};
/**
 * During the swipes: weeks between new fires (up to FIRES_AT_ONCE while fewer than MIN_BURNING hexes burn),
 * biome shifts back and forth, burnt plains turned back into forest (so there is always something to burn)
 * and new rivers.
 */
const FIRE_EVERY = 3;
const FIRES_AT_ONCE = 3;
const MIN_BURNING = 24;
const SHIFT_EVERY = 13;
const REGROW_EVERY = 5;
const RIVER_EVERY = 52;
/** Hexes the biome shift during the swipes flips back and forth (a step wetter, then a step drier). */
const FLIP_TARGETS = 4;
/** The accelerated biome check during the swipes: every hex every BIOME_EVERY ticks, in BIOME_SLICES slices per tick. */
const BIOME_EVERY = 5;
const BIOME_SLICES = 8;

/** The world's cells by distance from the map's center (the view the benchmark zooms to). */
function byCenter(sim: Simulation): Int32Array {
  const w = sim.world;
  const center = Math.floor(w.height / 2) * w.width + Math.floor(w.width / 2);
  const dist = new Float64Array(w.cellCount);
  const cells: number[] = [];
  for (let c = 0; c < w.cellCount; c++) {
    dist[c] = hexDistance(w, center, c);
    cells.push(c);
  }
  cells.sort((a, b) => dist[a] - dist[b] || a - b);
  const out = Int32Array.from(cells);
  nearCount = cells.findIndex((c) => dist[c] > NEAR);
  if (nearCount < 0) nearCount = cells.length;
  return out;
}
let nearCount = 0;

/** A charge of `ability` cast on `target` (the charge is given first; taken back when the target isn't valid). */
function cast(sim: Simulation, ability: number, target: number, option = 0): boolean {
  sim.gacha.charges[ability]++;
  if (castAbility(sim, ability, target, option)) return true;
  sim.gacha.charges[ability]--;
  return false;
}

/** Casts `ability` on up to `count` valid hexes nearest the center, `spacing` apart; returns them. */
function castNear(sim: Simulation, order: Int32Array, ability: number, count: number, spacing: number, option = 0): number[] {
  const done: number[] = [];
  for (let i = 0; i < order.length && done.length < count; i++) {
    const c = order[i];
    if (done.some((d) => hexDistance(sim.world, d, c) < spacing)) continue;
    if (cast(sim, ability, c, option)) done.push(c);
  }
  return done;
}

/** The setup: charges of all 25 abilities cast on spread targets (see above). */
export function castGacha(sim: Simulation): void {
  const order = byCenter(sim);
  castNear(sim, order, Ab.WildFire, SETUP.fires, SETUP.spacing + 1);
  castNear(sim, order, Ab.GreatRiver, SETUP.rivers, SETUP.spacing + 1);
  castNear(sim, order, Ab.BiomeShift, SETUP.shifts / 2, SETUP.spacing, SHIFT_WETTER);
  castNear(sim, order, Ab.BiomeShift, SETUP.shifts / 2, SETUP.spacing, SHIFT_DRIER);
  castNear(sim, order, Ab.FertileBlessing, SETUP.blessings, SETUP.spacing);
  castNear(sim, order, Ab.Drought, SETUP.droughts, 7);
  castNear(sim, order, Ab.ExhaustedSoil, SETUP.exhausted, SETUP.spacing);
  castNear(sim, order, Ab.RichVein, SETUP.veins, SETUP.spacing);
  // Slots: one more on every settlement (the slot arrays grow), one fewer on every third where one is free.
  let settled = 0;
  for (let c = 0; c < sim.world.cellCount; c++) {
    if (sim.cellPop[c] === 0) continue;
    cast(sim, Ab.WideFoundations, c);
    if (settled++ % 3 === 0) cast(sim, Ab.CrampedGround, c);
  }
  // Every people and leader ability on every people (as far as the effect list and the leaders allow).
  for (const civ of livingCivilizations(sim)) {
    for (let a = 0; a < ABILITY_COUNT; a++) {
      const kind = ABILITIES[a].target;
      if (kind === TargetKind.Hex || a === Ab.BrittleCrown) continue;
      cast(sim, a, civ.id);
      // A second trait from the god on top.
      if (a === Ab.GiftOfTrait) cast(sim, a, civ.id);
    }
  }
  sim.snapshotVersion++;
}

/**
 * The game clock's work between ticks during the gacha benchmark
 * (worldStore.setBenchTick): after every tick it keeps fires burning, flips a
 * few biomes near the center back and forth and lays a river now and then,
 * and in slices before the next tick it runs the accelerated biome check, so
 * the land keeps changing during the swipes. One per world.
 */
export function gachaDuringSwipes(): BenchTick {
  return {
    afterTick: castDuringSwipes(),
    slices: BIOME_SLICES,
    slice: (sim, slice) => checkBiomesFast(sim, BIOME_EVERY, slice, BIOME_SLICES),
  };
}

/** The casts after every tick (see gachaDuringSwipes). */
function castDuringSwipes(): (sim: Simulation) => void {
  let order: Int32Array | null = null;
  let world: Simulation['world'] | null = null;
  let weeks = 0;
  let flips: number[] = [];
  let flip = 0;
  let next = 0;
  let regrow = 0;
  return (sim) => {
    if (world !== sim.world) {
      world = sim.world;
      order = byCenter(sim);
      weeks = 0;
      flip = 0;
      next = 0;
      regrow = 0;
      flips = [];
      // Land hexes near the center that a shift can turn either way.
      for (let i = 0; i < nearCount && flips.length < FLIP_TARGETS; i++) {
        const c = order[i];
        if (flips.some((d) => hexDistance(sim.world, d, c) < 3)) continue;
        if (canFlip(sim, c)) flips.push(c);
      }
    }
    const near = order!;
    weeks++;
    // One kind of cast per week at most, so no tick carries several (rivers first, then shifts, regrowth, fires).
    if (weeks % RIVER_EVERY === 0) {
      for (let k = 0; k < nearCount; k++) {
        const c = near[(weeks * 7 + k) % nearCount];
        if (sim.world.riverFlow[c] <= 0 && cast(sim, Ab.GreatRiver, c)) break;
      }
    } else if (weeks % SHIFT_EVERY === 0 && flips.length > 0) {
      const c = flips[flip % flips.length];
      // Each target a step wetter, then back drier on its next turn.
      const option = Math.floor(flip / flips.length) % 2 === 0 ? SHIFT_WETTER : SHIFT_DRIER;
      cast(sim, Ab.BiomeShift, c, option);
      flip++;
    } else if (weeks % REGROW_EVERY === 0) {
      // Burnt land near the center grows back into forest: a shift wetter on the nearest plains.
      for (let k = 0; k < nearCount; k++) {
        const c = near[(regrow + k) % nearCount];
        if (sim.world.biome[c] === Biome.Plains && sim.gacha.burning[c] === 0 && cast(sim, Ab.BiomeShift, c, SHIFT_WETTER)) {
          regrow = (regrow + k + 1) % nearCount;
          break;
        }
      }
    } else if (weeks % FIRE_EVERY === 0) {
      // The next burnable hexes near the center (farther out once those are burnt), round the list.
      const range = Math.min(near.length, 2 * nearCount);
      for (let k = 0, lit = 0; k < range && lit < FIRES_AT_ONCE && burningCount(sim) < MIN_BURNING; k++) {
        const c = near[(next + k) % range];
        if (cast(sim, Ab.WildFire, c)) {
          next = (next + k + 1) % range;
          lit++;
        }
      }
    }
  };
}

/** Whether a shift of `c` wetter is valid now and its biome comes back with a shift drier (Plains, Forest, Jungle, Savanna...). */
function canFlip(sim: Simulation, c: number): boolean {
  const b = sim.world.biome[c];
  const wetter = shiftedBiome(b, SHIFT_WETTER);
  return wetter >= 0 && shiftedBiome(wetter, SHIFT_DRIER) === b && canCast(sim, Ab.BiomeShift, c, SHIFT_WETTER);
}

/** Hexes burning now. */
export function burningCount(sim: Simulation): number {
  return sim.gacha.fireCount;
}

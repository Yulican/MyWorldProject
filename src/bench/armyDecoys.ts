import { ArmyState, DIRECTION_COUNT, MAX_ARMIES, hexDistance, isWaterBiome, livingCivilizations, type Simulation } from '../sim';

// Benchmark only (the "war" scenario, approved by the user): the game's caps
// leave most worlds fewer than 32 armies on the map (one war per people, 1 +
// up to 3 armies per war; 21 to 32 with leaders), so the map is given extra
// army markers up to the world cap of 32, the worst case it must draw. They exist only on the map
// (worldStore.mapArmies), never in the simulation, so no game rule changes.
// A mix of what real armies do: marching between a people's settlement and
// its enemy's capital (one hex a week along a land route found once per
// world, back and forth, retreating on the way home), besieging an enemy seat
// and gathering at home. The first decoy always marches: worlds with leaders
// field up to 32 real armies, so often only a few decoys are left to show. Likewise siege frames: the
// alliance blocks break most real sieges, so real seats of peoples at war get
// map-only frames up to SIEGE_FRAMES (they follow the wars with every map
// snapshot and are part of the territory tiles' fingerprint like real ones).

/**
 * `fill`: the map's army markers from index `from` up to MAX_ARMIES; returns the new count.
 * `sieges`: marks siege-frame decoys in the map's siege copy (worldStore.mapWar.siege) up to SIEGE_FRAMES frames.
 */
export type ExtraArmies = {
  fill: (sim: Simulation, markers: { cell: Int32Array; civ: Uint8Array; state: Uint8Array }, from: number) => number;
  sieges: (sim: Simulation, siege: Uint8Array) => number;
};

/**
 * Siege frames the map shows at least (real ones first): as many as the war
 * scenario had before allies broke most sieges (about 4 to 7 per world).
 */
export const SIEGE_FRAMES = 6;

type Decoy = {
  civ: number;
  cell: number;
  home: number;
  away: number;
  kind: number;
  state: number;
  /** Marching decoys: the land route from home (first) towards `away`, and where on it the decoy stands. */
  route: Int32Array;
  at: number;
};

/** Kinds by slot: two marching, one besieging, one gathering. */
const KINDS = [0, 1, 0, 2] as const;
/** A marcher whose enemy is beyond the sea walks this many hexes of its own coast instead. */
const DETOUR = 12;
const NO_ROUTE = new Int32Array(0);

export function armyDecoys(): ExtraArmies {
  let forSim: Simulation | null = null;
  let decoys: Decoy[] = [];
  let tick = 0;
  return {
    sieges(sim, siege) {
      const { world } = sim;
      const w = sim.war;
      let frames = 0;
      for (let c = 0; c < siege.length; c++) frames += siege[c];
      // Real seats (capitals first, then the lower cell) of peoples at war that are not besieged yet.
      for (let pass = 2; pass >= 1 && frames < SIEGE_FRAMES; pass--) {
        for (let c = 0; c < world.cellCount && frames < SIEGE_FRAMES; c++) {
          const o = world.owner[c];
          if (world.seats[c] !== pass || siege[c] || o === 0 || (w.enemy[o] === 0 && w.allyWarsOf[o] === 0)) continue;
          siege[c] = 1;
          frames++;
        }
      }
      return frames;
    },
    fill(sim, markers, from) {
      if (forSim !== sim) {
        forSim = sim;
        decoys = makeDecoys(sim);
        tick = sim.tick;
      }
      // One step a simulated week.
      for (; tick < sim.tick; tick++) for (let i = 0; i < decoys.length; i++) step(decoys[i]);
      let k = from;
      for (let i = 0; i < decoys.length && k < MAX_ARMIES; i++) {
        const d = decoys[i];
        if (!sim.civs[d.civ]) continue;
        markers.cell[k] = d.cell;
        markers.civ[k] = d.civ;
        markers.state[k] = d.state;
        k++;
      }
      return k;
    },
  };
}

/**
 * MAX_ARMIES decoys over the living peoples in turn: home is a settled hex of theirs, away their enemy's capital (or
 * the nearest other people's). A marcher takes the first home (and, if its people has none, the first people) with a
 * land route to walk.
 */
function makeDecoys(sim: Simulation): Decoy[] {
  const { world } = sim;
  const civs = livingCivilizations(sim).filter((c) => c.capital >= 0);
  if (civs.length === 0) return [];
  const homes = new Map<number, number[]>();
  for (let c = 0; c < world.cellCount; c++) {
    const o = world.owner[c];
    if (o === 0 || sim.cellPop[c] === 0) continue;
    let list = homes.get(o);
    if (!list) homes.set(o, (list = []));
    list.push(c);
  }
  const awayFrom = (civ: number, home: number): number => {
    let away = sim.civs[sim.war.enemy[civ]]?.capital ?? -1;
    if (away < 0) {
      let best = Infinity;
      for (const o of civs) {
        if (o.id === civ) continue;
        const d = hexDistance(world, home, o.capital);
        if (d < best) {
          best = d;
          away = o.capital;
        }
      }
    }
    return away < 0 ? home : away;
  };
  const search = { from: new Int32Array(world.cellCount), queue: new Int32Array(world.cellCount) };
  const decoys: Decoy[] = [];
  for (let i = 0; i < MAX_ARMIES; i++) {
    const kind = KINDS[i % KINDS.length];
    let civ = civs[i % civs.length].id;
    const list = homes.get(civ) ?? [sim.civs[civ]!.capital];
    const first = Math.floor(i / civs.length) % list.length;
    let home = list[first];
    let away = awayFrom(civ, home);
    let route: Int32Array = NO_ROUTE;
    if (kind === 0) {
      // The first home with a way to walk, of this people or else of the next ones.
      for (let p = 0; p < civs.length && route.length < 2; p++) {
        const id = civs[(i + p) % civs.length].id;
        const own = homes.get(id) ?? [sim.civs[id]!.capital];
        for (let h = 0; h < own.length && route.length < 2; h++) {
          const cell = own[(first + h) % own.length];
          const target = awayFrom(id, cell);
          const found = landRoute(sim, cell, target, search);
          if (found.length < 2) continue;
          [civ, home, away, route] = [id, cell, target, found];
        }
      }
    }
    // Besiegers stand on the enemy seat; the others start at home.
    const cell = kind === 1 ? away : home;
    decoys.push({ civ, cell, home, away, kind, state: kind === 2 ? ArmyState.Gathering : ArmyState.Marching, route, at: 0 });
  }
  return decoys;
}

/**
 * The shortest way over land from `home` to the hex nearest to `target` that can be reached (the target itself when
 * no sea lies between); when that is `home`, the way to a hex DETOUR steps along its own land. One hex (no way) only
 * on an island of one hex.
 */
function landRoute(sim: Simulation, home: number, target: number, search: { from: Int32Array; queue: Int32Array }): Int32Array {
  const { world } = sim;
  const { from, queue } = search;
  from.fill(-1);
  from[home] = home;
  queue[0] = home;
  let end = home;
  let endDistance = hexDistance(world, home, target);
  let detour = home;
  let detourSteps = 0;
  // Breadth first: `steps` hexes from home for the cells queue[levelStart..levelEnd).
  let steps = 0;
  let levelEnd = 1;
  for (let head = 0, tail = 1; head < tail; head++) {
    if (head === levelEnd) {
      steps++;
      levelEnd = tail;
    }
    const cell = queue[head];
    const d = hexDistance(world, cell, target);
    if (d < endDistance) {
      endDistance = d;
      end = cell;
    }
    if (steps <= DETOUR && steps > detourSteps) {
      detourSteps = steps;
      detour = cell;
    }
    for (let k = 0; k < DIRECTION_COUNT; k++) {
      const nb = world.neighbors[cell * DIRECTION_COUNT + k];
      if (nb < 0 || from[nb] >= 0 || isWaterBiome(world.biome[nb])) continue;
      from[nb] = cell;
      queue[tail++] = nb;
    }
  }
  if (end === home) end = detour;
  let length = 1;
  for (let c = end; c !== home; c = from[c]) length++;
  const route = new Int32Array(length);
  for (let c = end, i = length - 1; i >= 0; c = from[c], i--) route[i] = c;
  return route;
}

/** A marching decoy steps one hex along its route every week: away while marching, home while retreating; at an end it turns. */
function step(d: Decoy): void {
  const last = d.route.length - 1;
  if (d.kind !== 0 || last < 1) return;
  if (d.state === ArmyState.Retreating) {
    if (d.at === 0) d.state = ArmyState.Marching;
  } else if (d.at === last) d.state = ArmyState.Retreating;
  d.at += d.state === ArmyState.Retreating ? -1 : 1;
  d.cell = d.route[d.at];
}

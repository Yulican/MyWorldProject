import { ArmyState, DIRECTION_COUNT, MAX_ARMIES, hexDistance, isWaterBiome, livingCivilizations, type Simulation } from '../sim';

// Benchmark only (the "war" scenario, approved by the user): the game's caps
// leave fewer than 32 armies on the map (one war per people, 1 + up to 3
// armies per war), so the map is given extra army markers up to the world
// cap of 32, the worst case it must draw. They exist only on the map
// (worldStore.mapArmies), never in the simulation, so no game rule changes.
// A mix of what real armies do: marching between a people's seat and its
// enemy's (one hex a week, back and forth, retreating on the way home),
// besieging an enemy seat and gathering at home. Likewise siege frames: the
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

type Decoy = { civ: number; cell: number; home: number; away: number; kind: number; state: number };

/** Kinds by slot: two marching, one besieging, one gathering. */
const KINDS = [0, 1, 0, 2] as const;

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
      for (; tick < sim.tick; tick++) for (const d of decoys) step(sim, d);
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

/** MAX_ARMIES decoys over the living peoples in turn: home is a settled hex of theirs, away their enemy's capital (or the nearest other people's). */
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
  const decoys: Decoy[] = [];
  for (let i = 0; i < MAX_ARMIES; i++) {
    const civ = civs[i % civs.length];
    const list = homes.get(civ.id) ?? [civ.capital];
    const home = list[Math.floor(i / civs.length) % list.length];
    let away = sim.civs[sim.war.enemy[civ.id]]?.capital ?? -1;
    if (away < 0) {
      let best = Infinity;
      for (const o of civs) {
        if (o.id === civ.id) continue;
        const d = hexDistance(world, home, o.capital);
        if (d < best) {
          best = d;
          away = o.capital;
        }
      }
    }
    if (away < 0) away = home;
    const kind = KINDS[i % KINDS.length];
    // Besiegers stand on the enemy seat; the others start at home.
    const cell = kind === 1 ? away : home;
    decoys.push({ civ: civ.id, cell, home, away, kind, state: kind === 2 ? ArmyState.Gathering : ArmyState.Marching });
  }
  return decoys;
}

/** A marching decoy steps one land hex towards its target: away while marching, home while retreating; then turns. */
function step(sim: Simulation, d: Decoy): void {
  if (d.kind !== 0) return;
  const { world } = sim;
  const target = d.state === ArmyState.Retreating ? d.home : d.away;
  let next = -1;
  let best = hexDistance(world, d.cell, target);
  for (let k = 0; k < DIRECTION_COUNT; k++) {
    const nb = world.neighbors[d.cell * DIRECTION_COUNT + k];
    if (nb < 0 || isWaterBiome(world.biome[nb])) continue;
    const dist = hexDistance(world, nb, target);
    if (dist < best) {
      best = dist;
      next = nb;
    }
  }
  // Arrived, or no land way closer: turn around.
  if (next < 0) {
    d.state = d.state === ArmyState.Retreating ? ArmyState.Marching : ArmyState.Retreating;
    return;
  }
  d.cell = next;
}

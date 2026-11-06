import { hexDistance, livingCivilizations, stepSimulation, type Simulation } from '../sim';
import { PAIRS } from '../sim/society/diplomacy';
import { chooseGoal, startWar } from '../sim/society/war';
import { empowerGovernment } from './empowerGovernment';

// The "war" benchmark scenario: the most the war shows on the map at once.
// First the government scenario's setup (empowerGovernment: military
// buildings everywhere and a year of training), so every people has soldiers
// for its armies. Then the peoples pair up, nearest capitals first, and every pair goes to war
// (one war per people, the rule): the stronger declares on the weaker, both
// raise their armies up to the real caps (WAR.maxArmies per people,
// WAR.worldArmies worldwide), and the attackers' armies stand on their goal
// seats, so every war has a siege: army markers, siege frames and red dashed
// war borders all over the map. Then a few weeks run so the sieges begin and
// the defenders' armies march.
//
// Aged worlds rarely have peoples with adjacent settlements (the game's rule
// for a declaration), so pairs are formed by distance; the goal is the seat
// chooseGoal picks where the two do border, else the defender's seat nearest
// to the attacker's capital.

/** Weeks simulated after the declarations: the sieges begin in the first one. */
const WEEKS = 2;

/** Soldiers everywhere, then a war between as many pairs of peoples as possible, the attackers on their goals. */
export function declareWarsEverywhere(sim: Simulation): void {
  empowerGovernment(sim);
  const w = sim.war;
  const world = sim.world;
  const strength = (a: number) => sim.military.strength[a] ?? 0;
  const civs = livingCivilizations(sim).filter((c) => c.capital >= 0 && w.enemy[c.id] === 0);
  const pairs: { a: number; b: number; d: number }[] = [];
  for (const x of civs) {
    for (const y of civs) {
      if (x.id < y.id) pairs.push({ a: x.id, b: y.id, d: hexDistance(world, x.capital, y.capital) });
    }
  }
  pairs.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b);
  const candidate = new Uint8Array(PAIRS);
  for (const { a, b } of pairs) {
    if (w.enemy[a] !== 0 || w.enemy[b] !== 0) continue;
    const [att, def] = strength(a) >= strength(b) ? [a, b] : [b, a];
    candidate.fill(0);
    candidate[def] = 1;
    let goal = chooseGoal(sim, att, candidate);
    if (goal < 0) goal = nearestSeat(sim, def, sim.civs[att]!.capital);
    if (goal >= 0) startWar(sim, att, goal);
  }
  // The attackers besiege their goals at once.
  for (let a = 0; a < w.live.length; a++) {
    if (!w.live[a]) continue;
    const s = w.aWar[a];
    if (w.aCiv[a] !== w.wAtt[s]) continue;
    w.aCell[a] = w.wGoal[s];
    w.aSince[a] = sim.tick;
    w.aProg[a] = 0;
  }
  w.version++;
  for (let t = 0; t < WEEKS && !sim.gameOver; t++) stepSimulation(sim);
}

/** The settled seat of government (or capital) of `civ` nearest to `from`; -1 if none. */
function nearestSeat(sim: Simulation, civ: number, from: number): number {
  const { world } = sim;
  const district = sim.government.district;
  let best = sim.civs[civ]?.capital ?? -1;
  let bestD = best >= 0 ? hexDistance(world, best, from) : Infinity;
  for (let c = 0; c < world.cellCount; c++) {
    if (district[c] !== c || world.owner[c] !== civ || sim.cellPop[c] === 0) continue;
    const d = hexDistance(world, c, from);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

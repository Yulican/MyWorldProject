import { MAX_ARMIES, finishGathering, hexDistance, livingCivilizations, stepSimulation, type Simulation } from '../sim';
import { PAIRS } from '../sim/society/diplomacy';
import { chooseGoal, startWar } from '../sim/society/war';
import { empowerGovernment } from './empowerGovernment';
import { stirUnrest } from './stirUnrest';

// The "war" benchmark scenario: the most the war shows on the map at once.
// The armies' caps make 32 armies on the map out of reach (one war per
// people, per war the attacker's 1 main army and the defender's relief armies
// from up to 3 other seats with soldiers), so the setup makes as many wars and
// seats as it can: first the unrest scenario's uprisings (stirUnrest: the most
// peoples), then the government scenario's seats and military buildings with
// a year of training (empowerGovernment: soldiers and seats everywhere). Then
// the peoples pair up by size (the two with the most seats, the next two,
// ...), the stronger declares war on the weaker, every army gathers at once
// (finishGathering) and the attackers stand on their goal seats, so every war
// has a siege: army markers, siege frames and red dashed war borders all over
// the map. A few weeks run so the sieges begin and the relief armies march.
//
// Aged worlds rarely have peoples with adjacent settlements (the game's rule
// for a declaration), so pairs ignore it; the goal is the seat chooseGoal
// picks where the two do border, else the defender's seat nearest to the
// attacker's capital.

/** Weeks simulated after the declarations: the sieges begin in the first one. */
const WEEKS = 2;

/** Uprisings, seats and soldiers everywhere, then a war between as many pairs of peoples as possible. */
export function declareWarsEverywhere(sim: Simulation): void {
  stirUnrest(sim);
  empowerGovernment(sim);
  declarePairs(sim);
}

/** Wars between the peoples in pairs of similar size; all armies gathered and the attackers on their goals. */
export function declarePairs(sim: Simulation): void {
  const w = sim.war;
  const world = sim.world;
  // Relief armies come from the defender's other seats: peoples of similar size pair up (the two with the most
  // seats, then the next two, ...), the stronger attacks, so defenders have seats to send relief from and the
  // attackers hold out. Peoples already at war keep their war.
  const district = sim.government.district;
  const seats = new Map<number, number>();
  for (let c = 0; c < world.cellCount; c++) {
    if (district[c] === c && sim.cellPop[c] > 0) seats.set(world.owner[c], (seats.get(world.owner[c]) ?? 0) + 1);
  }
  const strength = (a: number) => sim.military.strength[a] ?? 0;
  const civs = livingCivilizations(sim)
    .filter((c) => c.capital >= 0 && w.enemy[c.id] === 0)
    .sort((x, y) => (seats.get(y.id) ?? 0) - (seats.get(x.id) ?? 0) || x.id - y.id);
  const candidate = new Uint8Array(PAIRS);
  for (let i = 0; i + 1 < civs.length; i += 2) {
    const [x, y] = [civs[i].id, civs[i + 1].id];
    const [att, def] = strength(x) >= strength(y) ? [x, y] : [y, x];
    candidate.fill(0);
    candidate[def] = 1;
    let goal = chooseGoal(sim, att, candidate);
    if (goal < 0) goal = nearestSeat(sim, def, sim.civs[att]!.capital);
    if (goal >= 0) startWar(sim, att, goal);
  }
  // Every contingent arrives at once, so the armies are full when they set out.
  for (let a = 0; a < MAX_ARMIES; a++) finishGathering(sim, a);
  // The attackers besiege their goals at once.
  for (let a = 0; a < MAX_ARMIES; a++) {
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

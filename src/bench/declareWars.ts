import { MAX_ARMIES, finishGathering, formAlliance, hexDistance, startRebellion, livingCivilizations, stepSimulation, type Simulation } from '../sim';
import { PAIRS } from '../sim/society/diplomacy';
import { chooseGoal, startWar } from '../sim/society/war';
import { empowerGovernment } from './empowerGovernment';
import { stirUnrest } from './stirUnrest';

// The "war" benchmark scenario: the most the war shows on the map at once.
// The armies' caps keep most worlds below 32 armies on the map (one war per
// people, per war the attacker's 1 main army and the defender's relief armies
// from up to 3 other seats with soldiers; with leaders the larger worlds field
// 21 to 32), so the setup makes as many wars and seats as it can: first the unrest scenario's uprisings (stirUnrest: the most
// peoples), then the government scenario's seats and military buildings with
// a year of training (empowerGovernment: soldiers and seats everywhere). Then
// the three strongest realms face a rebellion of all their other settlements
// (startRebellion; the mothers' armies besiege the first rebel seat). Then
// the other peoples form two blocks of allies (by strength, alternately; alliances within each
// block), the n-th of block A declares war on the n-th of block B, the allies
// join (one army each), every army gathers at once (finishGathering) and the
// attackers stand on their goal seats, so every war has a siege: army
// markers, siege frames and red dashed war borders all over the map. A few
// weeks run so the sieges begin and the relief armies march. armyDecoys.ts
// fills the map up to 32 army markers. Peoples founded here (stirUnrest, the
// rebellions) have no leader until the year's end: they act by the base rules.
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
  // Phase 5: the three strongest realms with settlements to lose face a rebellion of all their other settlements.
  const strength = (a: number) => sim.military.strength[a] ?? 0;
  const realms = livingCivilizations(sim)
    .filter((c) => c.capital >= 0 && sim.world.owner.some((o, cell) => o === c.id && cell !== c.capital && sim.cellPop[cell] > 0))
    .map((c) => c.id)
    .sort((x, y) => strength(y) - strength(x) || x - y);
  let rebellions = 0;
  for (const id of realms) {
    if (rebellions === REBELLIONS) break;
    if (startRebellion(sim, id, true) >= 0) rebellions++;
  }
  declarePairs(sim);
}

/** Rebellions the scenario starts (in the strongest realms). */
export const REBELLIONS = 3;

/** Whether `civ` fights in any war already (a main party, a rebel group or an ally). */
function atWar(sim: Simulation, civ: number): boolean {
  const w = sim.war;
  for (let s = 0; s < w.wLive.length; s++) if (w.wLive[s] && w.side[s * PAIRS + civ] >= 0) return true;
  return false;
}

/** Two blocks of allies at war in pairs; all armies gathered and the attackers on their goals. */
export function declarePairs(sim: Simulation): void {
  const w = sim.war;
  const world = sim.world;
  // Two blocks of allies (phase 4): the peoples by strength, alternately into block A and B, every pair within a
  // block forms an alliance. Then the n-th of A declares war on the n-th of B (similar strength, A's the
  // stronger), so the allies of both join the wars as they start. Peoples already at war keep their war.
  const strength = (a: number) => sim.military.strength[a] ?? 0;
  const civs = livingCivilizations(sim)
    .filter((c) => c.capital >= 0 && w.enemy[c.id] === 0 && !atWar(sim, c.id))
    .map((c) => c.id)
    .sort((x, y) => strength(y) - strength(x) || x - y);
  const blockA = civs.filter((_, i) => i % 2 === 0);
  const blockB = civs.filter((_, i) => i % 2 === 1);
  for (const block of [blockA, blockB]) {
    for (let i = 0; i < block.length; i++) for (let j = i + 1; j < block.length; j++) formAlliance(sim, block[i], block[j]);
  }
  const candidate = new Uint8Array(PAIRS);
  for (let i = 0; i < blockB.length; i++) {
    const [att, def] = [blockA[i], blockB[i]];
    if (w.enemy[att] !== 0 || w.enemy[def] !== 0) continue;
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

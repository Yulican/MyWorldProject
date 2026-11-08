import type { Simulation } from './simulation';

// War phase 4 PROTOTYPE, the leaf part (no imports besides a type, so military.ts and diplomacy.ts can use it
// without import cycles at load time): the numbers, pact kinds and the strength sums. alliance.ts has the yearly update.

/** People pair stride (diplomacy.ts: PAIRS). */
const PAIRS = 256;

/** The numbers of phase 4 (user-approved start values); mutable only for the stats tool. */
export const ALLY = {
  /** 4a: pacts and alliances exist (0 = off). */
  on: 0,
  /** 4b: allies join wars (needs `on`). */
  join: 0,
  /** Mutual trust for a pact (with a common threat), for an alliance, and below which an alliance becomes a pact / a pact ends. */
  pactTrust: 40,
  allianceTrust: 70,
  downgradeTrust: 55,
  pactEnd: 30,
  /** Common threat: both peoples' danger from the same third people at least this to form a pact, below threatEnd for either to end it. */
  threatForm: 50,
  threatEnd: 35,
  /** Trust: permanent for a pact / alliance, one-time at signing (fades over 10 years), lost by the partner when an alliance is broken by a declaration. */
  pactBonus: 5,
  allianceBonus: 10,
  signBonus: 10,
  breakLoss: 30,
  /** 4b: an ally sends this many armies (per war) with this share of its soldiers. */
  armies: 1,
  send: 0.5,
  /** 4b: an ally joins only if its side (with the joining allies) is stronger than the other side with its pacts and alliances (0 = always joins). */
  needWin: 1,
  /** 4b: trust the partner gains in an ally who fought at its side and a winner loses in the loser's allies. */
  winBonus: 10,
  loseLoss: 10,
  /** 4b: a people fighting as an ally cannot start a war (1) or can (0). */
  allyBlocksStart: 1,
};

export const Pact = { None: 0, Pact: 1, Alliance: 2 } as const;

const strengthOf = (sim: Simulation, civ: number) => (civ < sim.military.strength.length ? sim.military.strength[civ] : 0);

/** Own strength of `a` for danger and give-up: its soldiers plus its alliance partners' (pacts don't count for the own side). */
export function ownStrength(sim: Simulation, a: number, except = 0): number {
  const w = sim.war;
  let sum = strengthOf(sim, a);
  if (w.pactCount === 0) return sum;
  const max = sim.diplomacy.maxId;
  for (let p = 1; p <= max; p++) {
    if (p !== except && p !== a && w.pact[a * PAIRS + p] === Pact.Alliance && sim.civs[p]) sum += strengthOf(sim, p);
  }
  return sum;
}

/** Strength of `b` as the other side sees it: its soldiers plus its pact and alliance partners' (not `except`). */
export function foeStrength(sim: Simulation, b: number, except: number): number {
  const w = sim.war;
  let sum = strengthOf(sim, b);
  if (w.pactCount === 0) return sum;
  const max = sim.diplomacy.maxId;
  for (let p = 1; p <= max; p++) {
    if (p !== except && p !== b && w.pact[b * PAIRS + p] !== Pact.None && sim.civs[p]) sum += strengthOf(sim, p);
  }
  return sum;
}

/**
 * Declaration check: `a`'s own strength with the alliance partners it would not lose by declaring on
 * `t` (partners allied to `t` leave it), against `t` with its pacts and alliances (not `a`).
 */
export function mayOutweigh(sim: Simulation, a: number, t: number, ratio: number): boolean {
  const w = sim.war;
  if (!ALLY.on || w.pactCount === 0) return strengthOf(sim, a) >= ratio * strengthOf(sim, t);
  let own = strengthOf(sim, a);
  const max = sim.diplomacy.maxId;
  for (let p = 1; p <= max; p++) {
    if (p === t || p === a || w.pact[a * PAIRS + p] !== Pact.Alliance || !sim.civs[p]) continue;
    if (w.pact[p * PAIRS + t] === Pact.Alliance) continue;
    own += strengthOf(sim, p);
  }
  return own >= ratio * foeStrength(sim, t, a);
}

/** Permanent trust a pact or alliance between a and b gives (diplomacy.ts: trustValue). */
export function pactTrust(sim: Simulation, a: number, b: number): number {
  const p = sim.war.pact[a * PAIRS + b];
  return p === Pact.Alliance ? ALLY.allianceBonus : p === Pact.Pact ? ALLY.pactBonus : 0;
}

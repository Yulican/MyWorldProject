// War phase 2: the battle calculation as a pure function ("Design Documents/
// Requirement Krieg.md", section 3). No map, no armies moving; counters only.
//
// Each side has melee, ranged and shock soldiers and a factor per troop type
// (1, or MIL.factor while the type is supplied with its strategic good, see
// military.ts). Strength = soldiers x factor. Per round, three phases, each
// simultaneous for both sides, one after the other:
//   1. ranged hit the enemy front line,
//   2. the front lines fight each other,
//   3. shock hit the enemy front line.
// The front line is melee; with no melee left shock takes the melee role, then
// ranged. A substitute front fights with BATTLE.penalty less and does not use
// its own role in that round (substitute ranged do not shoot in phase 1,
// substitute shock do not charge in phase 3). Every attack removes BATTLE.loss
// x the attacker's strength from the target; the target loses that damage /
// its factor in soldiers (at most what is there). The defender's attacks are
// multiplied by (1 + its defender bonus).
//
// A side withdraws when, at the start of a round, its strength is below
// BATTLE.retreat of its starting strength; the battle ends then, or after
// BATTLE.rounds rounds. The field goes to the side that kept the larger share
// of its starting strength.
//
// Port note: all state lives in the caller's Float64Arrays and a module
// scratch array; no allocation per battle.

import { MIL } from './military';

/** Fixed battle numbers (agreed with the user, war phase 2). */
export const BATTLE = {
  /** Maximum rounds per battle. */
  rounds: 5,
  /** Share of an attacker's strength that is removed from the target per attack. */
  loss: 0.1,
  /** Strength malus of a substitute front line (0.5 = -50 %). */
  penalty: 0.5,
  /** A side withdraws when its strength falls below this share of its starting strength. */
  retreat: 0.5,
  /** A side gives up (does not fight) when its strength is below this share of the enemy's. */
  giveUp: 0.4,
} as const;

/** Defense situation of side B (the defender), passed to fightBattle. */
export const Defense = {
  /** Field battle, no bonus. */
  Field: 0,
  /** Besieged seat of government. */
  Seat: 1,
  /** Seat of government with an own army in it. */
  SeatArmy: 2,
} as const;
export type Defense = (typeof Defense)[keyof typeof Defense];

/** Defender bonus per Defense value. */
export const DEFENSE_BONUS = Float64Array.of(0, 0.25, 0.5);

/**
 * Input layout (BATTLE_IN numbers): side A (attacker) at 0, side B (defender)
 * at 6; per side soldiers melee, ranged, shock, then factors melee, ranged, shock.
 */
export const BATTLE_IN = 12;
export const BI = { soldiers: 0, factor: 3, SIDE: 6 } as const;

/** Output slots of fightBattle. `retreat`: 0 nobody withdrew, 1 A withdrew, 2 B withdrew, 3 both. */
export const BO = { lostA: 0, lostB: 1, strLostA: 2, strLostB: 3, rounds: 4, remA: 5, remB: 6, startA: 7, startB: 8, retreat: 9, SIZE: 10 } as const;

/** Strategic factor of a troop type: MIL.factor while supplied, else 1. */
export function troopFactor(supplied: boolean): number {
  return supplied ? MIL.factor : 1;
}

/** True when a side of strength `own` gives up against an enemy of strength `enemy` (war phase 3). */
export function givesUp(own: number, enemy: number): boolean {
  return own < BATTLE.giveUp * enemy;
}

const EPS = 1e-9;
/** Soldiers of `side` (0 = A, 1 = B) and troop type `t` left after the last fightBattle (war phase 3 applies the losses to its armies). */
export function remainingSoldiers(side: number, t: number): number {
  return cnt[side * 3 + t];
}
// Scratch: current soldiers of both sides (A melee, ranged, shock, B melee, ranged, shock).
const cnt = new Float64Array(6);

function strengthOf(inp: Float64Array, side: number): number {
  const o = side * BI.SIDE + BI.factor;
  const c = side * 3;
  return cnt[c] * inp[o] + cnt[c + 1] * inp[o + 1] + cnt[c + 2] * inp[o + 2];
}

/** Front line type of a side: melee (0), else shock (2), else ranged (1); -1 when nothing is left. */
function front(side: number): number {
  const c = side * 3;
  if (cnt[c] > EPS) return 0;
  if (cnt[c + 2] > EPS) return 2;
  if (cnt[c + 1] > EPS) return 1;
  return -1;
}

/** Hits `target`'s troop type `t` with `dmg` strength points. */
function hit(inp: Float64Array, target: number, t: number, dmg: number): void {
  const i = target * 3 + t;
  const lost = dmg / inp[target * BI.SIDE + BI.factor + t];
  cnt[i] = lost >= cnt[i] ? 0 : cnt[i] - lost;
}

/**
 * Fights one battle: side A attacks, side B defends in situation `defense`.
 * Fills `out` (BO slots) and returns +1 if A holds the field, -1 if B, 0 for
 * a draw (equal shares of the starting strength kept).
 */
export function fightBattle(inp: Float64Array, defense: Defense, out: Float64Array): number {
  for (let t = 0; t < 3; t++) {
    cnt[t] = inp[BI.soldiers + t];
    cnt[3 + t] = inp[BI.SIDE + BI.soldiers + t];
  }
  const startA = strengthOf(inp, 0);
  const startB = strengthOf(inp, 1);
  const sA0 = cnt[0] + cnt[1] + cnt[2];
  const sB0 = cnt[3] + cnt[4] + cnt[5];
  const loss = BATTLE.loss;
  const mulA = loss;
  const mulB = loss * (1 + DEFENSE_BONUS[defense]);
  const sub = 1 - BATTLE.penalty;
  const fA = BI.factor;
  const fB = BI.SIDE + BI.factor;
  let round = 0;
  let retreat = 0;
  while (round < BATTLE.rounds) {
    const remA = strengthOf(inp, 0);
    const remB = strengthOf(inp, 1);
    if (remA <= EPS || remB <= EPS) break;
    if (remA < BATTLE.retreat * startA) retreat |= 1;
    if (remB < BATTLE.retreat * startB) retreat |= 2;
    if (retreat) break;
    round++;
    // 1. Ranged hit the enemy front (ranged serving as front do not shoot).
    let fa = front(0);
    let fb = front(1);
    if (fa < 0 || fb < 0) break;
    let dA = fa !== 1 ? cnt[1] * inp[fA + 1] * mulA : 0;
    let dB = fb !== 1 ? cnt[4] * inp[fB + 1] * mulB : 0;
    hit(inp, 1, fb, dA);
    hit(inp, 0, fa, dB);
    // 2. Front lines fight (substitutes with the penalty).
    fa = front(0);
    fb = front(1);
    if (fa < 0 || fb < 0) break;
    dA = cnt[fa] * inp[fA + fa] * mulA * (fa === 0 ? 1 : sub);
    dB = cnt[3 + fb] * inp[fB + fb] * mulB * (fb === 0 ? 1 : sub);
    hit(inp, 1, fb, dA);
    hit(inp, 0, fa, dB);
    // 3. Shock hit the enemy front (shock serving as front already fought).
    fa = front(0);
    fb = front(1);
    if (fa < 0 || fb < 0) break;
    dA = fa !== 2 ? cnt[2] * inp[fA + 2] * mulA : 0;
    dB = fb !== 2 ? cnt[5] * inp[fB + 2] * mulB : 0;
    hit(inp, 1, fb, dA);
    hit(inp, 0, fa, dB);
  }
  const eA = strengthOf(inp, 0);
  const eB = strengthOf(inp, 1);
  out[BO.lostA] = sA0 - (cnt[0] + cnt[1] + cnt[2]);
  out[BO.lostB] = sB0 - (cnt[3] + cnt[4] + cnt[5]);
  out[BO.strLostA] = startA - eA;
  out[BO.strLostB] = startB - eB;
  out[BO.rounds] = round;
  out[BO.remA] = eA;
  out[BO.remB] = eB;
  out[BO.startA] = startA;
  out[BO.startB] = startB;
  out[BO.retreat] = retreat;
  const shareA = startA > 0 ? eA / startA : 0;
  const shareB = startB > 0 ? eB / startB : 0;
  return Math.abs(shareA - shareB) < EPS ? 0 : shareA > shareB ? 1 : -1;
}

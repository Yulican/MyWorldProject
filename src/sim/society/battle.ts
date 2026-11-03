// War phase 2: the battle calculation as a pure function ("Design Documents/
// Requirement Krieg.md", section 3). No map, no armies moving; counters only.
//
// Each side has melee, ranged and shock counters and a factor per type (1, or
// MIL.factor with the strategic good). Per round: (1) ranged hit the enemy front
// line, (2) front lines fight each other, (3) shock hit the enemy front line.
// The front line is melee; with no melee left shock steps in, then ranged (they
// fight with the substitute penalty and do not use their own role that round).
// An attack removes `loss` x its power in strength points from the target
// (converted to soldiers by the target's factor), at most what is there. The
// defender's power is multiplied by (1 + defender bonus). Phases are
// simultaneous per phase, sequential between phases.
//
// Layout (typed arrays, no allocation per battle): see the offsets below.

export const BATTLE = {
  /** Rounds per battle. */
  rounds: 5,
  /** Share of an attacker's power that hits the target per attack. */
  loss: 0.2,
  /** Power malus of a unit in a substitute role (0.5 = -50 %). */
  penalty: 0.5,
  /** Defender bonus: besieged seat, and with an own army in the seat. */
  defend: 0.25,
  defendArmy: 0.5,
  /** A side retreats when its strength falls below this share of its starting strength (0 = never). */
  retreat: 0,
};

/** Input: per side (A at 0, B at 6): counts melee, ranged, shock, then factors melee, ranged, shock. */
export const BATTLE_IN = 12;
/** Output slots. */
export const BO = { lostA: 0, lostB: 1, strLostA: 2, strLostB: 3, rounds: 4, remA: 5, remB: 6, startA: 7, startB: 8, SIZE: 9 } as const;

// Scratch: current counts of both sides (6) and effective power multipliers (2).
const cnt = new Float64Array(6);

function strengthOf(inp: Float64Array, side: number): number {
  const o = side * 6;
  return cnt[side * 3] * inp[o + 3] + cnt[side * 3 + 1] * inp[o + 4] + cnt[side * 3 + 2] * inp[o + 5];
}

/** Front line type of a side: melee, else shock, else ranged; -1 when nothing is left. */
function front(side: number): number {
  const o = side * 3;
  if (cnt[o] > 1e-9) return 0;
  if (cnt[o + 2] > 1e-9) return 2;
  if (cnt[o + 1] > 1e-9) return 1;
  return -1;
}

/** Hit `target`'s front line (type ft) with strength points `dmg`. */
function hit(inp: Float64Array, target: number, ft: number, dmg: number): void {
  const f = inp[target * 6 + 3 + ft];
  const i = target * 3 + ft;
  const lost = dmg / f;
  cnt[i] = lost >= cnt[i] ? 0 : cnt[i] - lost;
}

/**
 * Fight one battle. `bonusB` is the defender bonus of side B (0 for a field
 * battle; BATTLE.defend / defendArmy for a defending seat); A attacks.
 * Fills `out` (BO) and returns +1 if A holds the field, -1 if B, 0 for a draw
 * (decided by the remaining strength after the last round).
 */
export function fightBattle(inp: Float64Array, bonusB: number, out: Float64Array): number {
  for (let i = 0; i < 6; i++) cnt[i] = inp[i < 3 ? i : i + 3];
  const startA = strengthOf(inp, 0);
  const startB = strengthOf(inp, 1);
  const sA0 = cnt[0] + cnt[1] + cnt[2];
  const sB0 = cnt[3] + cnt[4] + cnt[5];
  const loss = BATTLE.loss;
  const pen = 1 - BATTLE.penalty;
  const mulB = 1 + bonusB;
  let round = 0;
  while (round < BATTLE.rounds) {
    if (startA <= 0 || startB <= 0) break;
    const remA = strengthOf(inp, 0);
    const remB = strengthOf(inp, 1);
    if (remA <= 1e-9 || remB <= 1e-9) break;
    if (BATTLE.retreat > 0 && (remA < BATTLE.retreat * startA || remB < BATTLE.retreat * startB)) break;
    round++;
    // 1. Ranged hit the enemy front line (ranged serving as front stay in melee).
    let fa = front(0);
    let fb = front(1);
    let dA = fa !== 1 ? cnt[1] * inp[4] * loss : 0;
    let dB = fb !== 1 ? cnt[4] * inp[10] * loss * mulB : 0;
    if (fb >= 0) hit(inp, 1, fb, dA);
    if (fa >= 0) hit(inp, 0, fa, dB);
    // 2. Front lines fight.
    fa = front(0);
    fb = front(1);
    if (fa < 0 || fb < 0) break;
    dA = cnt[fa] * inp[fa + 3] * loss * (fa === 0 ? 1 : pen);
    dB = cnt[3 + fb] * inp[6 + 3 + fb] * loss * mulB * (fb === 0 ? 1 : pen);
    const ftA = fa;
    const ftB = fb;
    hit(inp, 1, ftB, dA);
    hit(inp, 0, ftA, dB);
    // 3. Shock hit the enemy front line (shock serving as front already fought).
    fa = front(0);
    fb = front(1);
    if (fa < 0 || fb < 0) break;
    dA = fa !== 2 ? cnt[2] * inp[5] * loss : 0;
    dB = fb !== 2 ? cnt[5] * inp[11] * loss * mulB : 0;
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
  // The field is held by the side with the larger share of its strength left (a dead side loses).
  const shareA = startA > 0 ? eA / startA : 0;
  const shareB = startB > 0 ? eB / startB : 0;
  return Math.abs(shareA - shareB) < 1e-9 ? 0 : shareA > shareB ? 1 : -1;
}

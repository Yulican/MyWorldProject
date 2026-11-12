import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE, BATTLE_IN, BO, DEFENSE_BONUS, Defense, fightBattle, givesUp, troopFactor } from './battle';
import { MIL } from './military';

const inp = new Float64Array(BATTLE_IN);
const out = new Float64Array(BO.SIZE);

/** Sides as [melee, ranged, shock] soldiers and optional factors. */
function fight(a: number[], b: number[], defense: Defense = Defense.Field, fa = [1, 1, 1], fb = [1, 1, 1]): number {
  for (let t = 0; t < 3; t++) {
    inp[t] = a[t];
    inp[3 + t] = fa[t];
    inp[6 + t] = b[t];
    inp[9 + t] = fb[t];
  }
  return fightBattle(inp, defense, out);
}
const near = (x: number, y: number, msg?: string) => assert.ok(Math.abs(x - y) < 1e-9, `${msg ?? ''} ${x} != ${y}`);

test('agreed numbers', () => {
  assert.equal(BATTLE.rounds, 5);
  assert.equal(BATTLE.loss, 0.1);
  assert.equal(BATTLE.penalty, 0.5);
  assert.equal(BATTLE.retreat, 0.5);
  assert.equal(BATTLE.giveUp, 0.4);
  assert.deepEqual([...DEFENSE_BONUS], [0, 0.25, 0.5]);
});

test('phases run in order: ranged before the front fight', () => {
  // A: 100 melee + 100 ranged, B: 100 melee. Ranged first take B to 90, so B
  // hits back with 9 (not 10) in the front fight. B retreats after round 3.
  const r = fight([100, 100, 0], [100, 0, 0]);
  assert.equal(r, 1);
  assert.equal(out[BO.rounds], 3);
  assert.equal(out[BO.retreat], 2);
  near(out[BO.lostB], 57.5, 'lostB');
  near(out[BO.lostA], 100 - 78.91, 'lostA');
});

test('phases run in order: shock after the front fight', () => {
  // A: 100 melee + 100 shock, B: 100 melee. Round 1: front fight 10/10, then shock 10.
  // Round 1: A 90 / B 80; round 2: B 71, A 82, shock -> B 61; round 3: B 52.8, A 75.9, shock -> 42.8; B retreats.
  // (Shock before the front fight would leave B hitting back with 8 in round 1.)
  fight([100, 0, 100], [100, 0, 0]);
  assert.equal(out[BO.rounds], 3);
  near(out[BO.lostA], 100 - 75.9, 'lostA');
  near(out[BO.lostB], 100 - 42.8, 'lostB');
});

test('substitute shock front fights with -50% and does not charge', () => {
  // A: 100 shock only vs B: 100 melee. Per round A deals 5 (not 10, and no extra charge), B deals 10.
  const r = fight([0, 0, 100], [100, 0, 0]);
  assert.equal(r, -1);
  assert.equal(out[BO.rounds], 5);
  let b = 100;
  let a = 100;
  for (let i = 0; i < 5; i++) {
    const dA = a * 0.1 * 0.5;
    a -= b * 0.1;
    b -= dA;
  }
  near(out[BO.remA], a, 'remA');
  near(out[BO.remB], b, 'remB');
});

test('substitute ranged front does not shoot in phase 1', () => {
  // A: 100 ranged vs B: 100 melee. Round 1: no volley; front fight A 5, B 10.
  fight([0, 100, 0], [100, 0, 0]);
  let a = 100;
  let b = 100;
  for (let i = 0; i < 5; i++) {
    const dA = a * 0.05;
    a -= b * 0.1;
    b -= dA;
  }
  near(out[BO.remA], a);
  near(out[BO.remB], b);
});

test('front order: shock takes the melee role before ranged', () => {
  // B has ranged and shock but no melee: A's melee hits B's shock; B's ranged
  // still shoot (they are not the front) and are untouched while shock remain.
  // Round 1: volley 5 -> A 95; front fight A 9.5 -> shock 40.5, shock (substitute) 2.5 -> A 92.5; no charge.
  let a = 100;
  let s = 50;
  for (let i = 0; i < 5; i++) {
    a -= 50 * 0.1;
    const dA = a * 0.1;
    a -= s * 0.05;
    s -= dA;
  }
  fight([100, 0, 0], [0, 50, 50]);
  assert.equal(out[BO.rounds], 5);
  near(out[BO.remA], a, 'remA');
  near(out[BO.remB], 50 + s, 'remB');
});

test('retreat below 50 % of the starting strength ends the battle', () => {
  // 300 melee vs 100 melee: B loses 30, 27.x ... falls below 50 after round 2.
  const r = fight([300, 0, 0], [100, 0, 0]);
  assert.equal(r, 1);
  // Round 1: B 70, A 290. Round 2: B 41, A 283. B retreats at the start of round 3.
  assert.equal(out[BO.rounds], 2);
  assert.equal(out[BO.retreat], 2);
  near(out[BO.remB], 41);
  near(out[BO.remA], 283);
});

test('battle lasts at most 5 rounds; equal sides draw', () => {
  const r = fight([100, 0, 0], [100, 0, 0]);
  assert.equal(r, 0);
  assert.equal(out[BO.rounds], BATTLE.rounds);
  assert.equal(out[BO.retreat], 0);
  near(out[BO.remA], 100 * 0.9 ** 5);
  near(out[BO.remB], 100 * 0.9 ** 5);
});

test('defender bonus multiplies the defender\'s attacks', () => {
  fight([100, 0, 0], [100, 0, 0], Defense.Seat);
  // Round 1: A loses 12.5, B 10.
  let a = 100;
  let b = 100;
  for (let i = 0; i < 5; i++) {
    const dA = a * 0.1;
    a -= b * 0.125;
    b -= dA;
  }
  near(out[BO.remA], a);
  near(out[BO.remB], b);
  assert.equal(fight([100, 0, 0], [100, 0, 0], Defense.Seat), -1);
  fight([100, 0, 0], [100, 0, 0], Defense.SeatArmy);
  assert.ok(out[BO.remA] < a, '+50 % hurts more than +25 %');
});

test('strategic factor: strength and losses in soldiers', () => {
  assert.equal(troopFactor(true), MIL.factor);
  assert.equal(troopFactor(false), 1);
  // 100 supplied melee (strength 150) vs 150 plain melee: equal strength, a draw,
  // but the supplied side loses fewer soldiers (damage / factor).
  const r = fight([100, 0, 0], [150, 0, 0], Defense.Field, [1.5, 1, 1]);
  assert.equal(r, 0);
  near(out[BO.startA], 150);
  near(out[BO.startB], 150);
  // Round 1: both deal 15 strength; A loses 10 soldiers, B 15.
  const lostA = out[BO.lostA];
  const lostB = out[BO.lostB];
  near(lostA * 1.5, lostB, 'same strength lost');
});

test('deterministic: same input, same output', () => {
  fight([37, 21, 14], [20, 30, 9], Defense.Seat, [1.5, 1, 1.5], [1, 1.5, 1]);
  const first = Float64Array.from(out);
  fight([37, 21, 14], [20, 30, 9], Defense.Seat, [1.5, 1, 1.5], [1, 1.5, 1]);
  assert.deepEqual([...out], [...first]);
});

const COMPS = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5],
  [0.34, 0.33, 0.33], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6],
];

test('2:1 attacker wins against any composition, even with +50 % defender', () => {
  for (const ca of COMPS) for (const cb of COMPS) {
    const r = fight(ca.map((x) => x * 2000), cb.map((x) => x * 1000), Defense.SeatArmy);
    assert.equal(r, 1, `${ca} vs ${cb}`);
  }
});

test('1:1 with +25 % defender: mostly the defender', () => {
  let def = 0;
  for (const ca of COMPS) for (const cb of COMPS) if (fight(ca.map((x) => x * 1000), cb.map((x) => x * 1000), Defense.Seat) < 0) def++;
  assert.ok(def > COMPS.length * COMPS.length * 0.5, `defender won ${def}`);
});

test('give-up check below 40 % of the enemy', () => {
  assert.equal(givesUp(39, 100), true);
  assert.equal(givesUp(40, 100), false);
  assert.equal(givesUp(100, 39), false);
});

test('empty side: no rounds', () => {
  const r = fight([0, 0, 0], [10, 0, 0]);
  assert.equal(r, -1);
  assert.equal(out[BO.rounds], 0);
});

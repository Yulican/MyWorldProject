import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRECTION_COUNT, hexDistance } from '../hex';
import { isWaterBiome } from '../world/biomes';
import { Deposit } from '../world/deposits';
import { generateWorld } from '../world/generate';
import { hasRoad, stepCost } from '../world/roads';
import { BUILDINGS, GOV_SLOT, Good, SLOTS, SlotState } from './buildings';
import { PAIRS, trustValue } from './diplomacy';
import { civPacts, formAlliance, updateAlliances } from './alliance';
import { ALLY, Pact, mayOutweigh, pactTrust } from './pacts';
import { updateGovernment } from './government';
import { MIL, TROOP_TYPES, Troop, hostile, strengthSize } from './military';
import { conqueredValue, hasSeat, satisfactionTerms } from './satisfaction';
import { SUPPLY_KINDS, SupplyKind } from './supply';
import { TICKS_PER_YEAR, changeCiv, createSimulation, foundCivilization, stepSimulation, type Simulation } from './simulation';
import { TRADE_GOODS, updateTradeNeeds } from './trade';
import {
  ArmyState,
  EndType,
  MAX_ARMIES,
  WAR,
  advanceWar,
  armySoldiers,
  chooseGoal,
  civWars,
  disbandArmy,
  endWar,
  finishGathering,
  inTruce,
  planMarch,
  rallyPoint,
  runWarYear,
  sideStrength,
  startWar,
  travelCost,
  warTargets,
} from './war';

const SEAT = BUILDINGS.findIndex((b) => b.good === Good.Seat);
const noRecord = () => {};

function runYears(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR; t++) stepSimulation(sim);
}

/** One week of war alone (no other part of the simulation runs). */
function week(sim: Simulation): void {
  sim.tick++;
  advanceWar(sim);
}

function placeSeat(sim: Simulation, cell: number): void {
  for (let s = cell * SLOTS + GOV_SLOT; s < (cell + 1) * SLOTS; s++) {
    if (sim.economy.state[s] !== SlotState.Empty) continue;
    sim.economy.type[s] = SEAT;
    sim.economy.state[s] = SlotState.Standing;
    sim.hasBuildings[cell] = 1;
    return;
  }
  throw new Error('no free government slot');
}

const settledOf = (sim: Simulation, civ: number) => {
  const list: number[] = [];
  for (let c = 0; c < sim.world.cellCount; c++) if (sim.world.owner[c] === civ && sim.cellPop[c] > 0) list.push(c);
  return list;
};

const borders = (sim: Simulation, cell: number, civ: number) => {
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = sim.world.neighbors[cell * DIRECTION_COUNT + d];
    if (nb >= 0 && sim.world.owner[nb] === civ && sim.cellPop[nb] > 0) return true;
  }
  return false;
};

type Fixture = { sim: Simulation; att: number; def: number; seats: number[] };

/**
 * A grown world (seed 12, year 200, no war yet) whose first people gets
 * `districts` new seats far from its capital; the districts of these seats
 * break away as a new people (`def`, its capital the first seat) next to the
 * old one (`att`). Soldiers: 10 melee in every settlement of att, 8 in every
 * settlement of def; strengths set to match.
 */
function fixture(districts: number): Fixture {
  const sim = createSimulation(generateWorld({ seed: 12 }));
  runYears(sim, 200);
  assert.equal(sim.war.wars, 0);
  const owner = sim.world.owner;
  const att = 1;
  const parent = sim.civs[att]!;
  const own = settledOf(sim, att);
  // Seats: the settlements farthest from the capital (and from each other).
  const seats: number[] = [];
  for (let k = 0; k < districts; k++) {
    let best = -1;
    let bestD = -1;
    for (const c of own) {
      if (c === parent.capital || hasSeat(sim.economy, c)) continue;
      let d = hexDistance(sim.world, c, parent.capital);
      for (const s of seats) d = Math.min(d, hexDistance(sim.world, c, s));
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    assert.ok(best >= 0 && bestD >= 2, 'room for a seat');
    placeSeat(sim, best);
    seats.push(best);
  }
  updateGovernment(sim, owner, noRecord);
  const civ = foundCivilization(sim, 'secession', seats[0], parent)!;
  const def = civ.id;
  const moving = new Uint8Array(sim.world.cellCount);
  for (const c of own) if (seats.includes(sim.government.district[c])) moving[c] = 1;
  for (let i = 0; i < sim.pop.end; i++) if (sim.pop.alive[i] && moving[sim.pop.cell[i]]) changeCiv(sim, i, def);
  for (let c = 0; c < sim.world.cellCount; c++) if (moving[c]) owner[c] = def;
  const m = sim.military;
  if (m.strength.length < sim.civSlots) m.strength = new Float64Array(sim.civSlots);
  m.soldiers.fill(0);
  m.covered.fill(0);
  m.strength.fill(0);
  for (const c of settledOf(sim, att)) m.soldiers[c * TROOP_TYPES + Troop.Melee] = 10;
  for (const c of settledOf(sim, def)) m.soldiers[c * TROOP_TYPES + Troop.Melee] = 8;
  m.strength[att] = 10 * settledOf(sim, att).length;
  m.strength[def] = 8 * settledOf(sim, def).length;
  assert.ok(m.strength[att] >= 2 * m.strength[def], 'twice as strong');
  assert.ok(settledOf(sim, def).some((c) => borders(sim, c, att)), 'the new people borders the old one');
  return { sim, att, def, seats };
}

const armiesOf = (sim: Simulation, civ: number) => {
  const list: number[] = [];
  for (let a = 0; a < MAX_ARMIES; a++) if (sim.war.live[a] && sim.war.aCiv[a] === civ) list.push(a);
  return list;
};

const totalSoldiers = (sim: Simulation) => sim.military.soldiers.reduce((s, v) => s + v, 0);

/** Every gathering army is complete and sets out. */
function ready(sim: Simulation): void {
  for (let a = 0; a < MAX_ARMIES; a++) finishGathering(sim, a);
}

/** A war of att against the seat `goal`, the armies gathered; the defender's armies are sent home. */
function warOn(f: Fixture, goal: number, keepDefenders = false): number {
  const s = startWar(f.sim, f.att, goal);
  assert.ok(s >= 0);
  ready(f.sim);
  if (!keepDefenders) for (const a of armiesOf(f.sim, f.def)) disbandArmy(f.sim, a);
  return s;
}

/** Puts army `a` on `cell`, arrived this week. */
function put(sim: Simulation, a: number, cell: number): void {
  sim.war.aCell[a] = cell;
  sim.war.aSince[a] = sim.tick;
  sim.war.aProg[a] = 0;
}

/** Siege of the goal by the attacker's first army, the rest of its armies sent home. */
function besiege(f: Fixture, s: number): number {
  const [a, ...rest] = armiesOf(f.sim, f.att);
  for (const b of rest) disbandArmy(f.sim, b);
  put(f.sim, a, f.sim.war.wGoal[s]);
  week(f.sim);
  assert.equal(f.sim.war.wSiegeStart[s], f.sim.tick);
  return a;
}

test('war is declared only on a neighbor at most half as strong, outside a truce, and one war per people', () => {
  const f = fixture(1);
  const { sim, att, def } = f;
  const m = sim.military;
  assert.deepEqual(warTargets(sim, att), [def]);
  // Peoples without a common border are no target, however weak.
  for (const civ of sim.civs) if (civ && civ.id !== att && civ.id !== def) assert.equal(m.strength[civ.id], 0);
  assert.ok(sim.civs.filter(Boolean).length > 2, 'other, far peoples live');
  // Exactly twice as strong is enough, a little less is not.
  m.strength[def] = m.strength[att] / 2;
  assert.deepEqual(warTargets(sim, att), [def]);
  m.strength[def] = m.strength[att] / 2 + 0.01;
  assert.deepEqual(warTargets(sim, att), []);
  m.strength[def] = 8 * settledOf(sim, def).length;
  // Without strength no war, not even on a people without strength.
  const sa = m.strength[att];
  const sd = m.strength[def];
  m.strength[att] = 0;
  m.strength[def] = 0;
  assert.deepEqual(warTargets(sim, att), []);
  m.strength[att] = 0.01;
  assert.deepEqual(warTargets(sim, att), [def]);
  m.strength[att] = sa;
  m.strength[def] = sd;
  // A truce bars it until it ends.
  sim.war.truce[att * PAIRS + def] = sim.tick + 10;
  assert.equal(inTruce(sim, att, def), true);
  assert.deepEqual(warTargets(sim, att), []);
  sim.war.truce[att * PAIRS + def] = 0;
  // The yearly roll (forced to succeed here) declares the war; then neither side declares another.
  const chance = WAR.chance;
  try {
    WAR.chance = 1;
    runWarYear(sim);
  } finally {
    WAR.chance = chance;
  }
  assert.equal(sim.war.wars, 1);
  assert.equal(sim.war.enemy[att], def);
  assert.equal(sim.war.enemy[def], att);
  assert.equal(sim.war.wGoal[sim.war.civWar[att]], f.seats[0]);
  assert.deepEqual(warTargets(sim, att), []);
  assert.deepEqual(warTargets(sim, def), []);
  assert.ok(sim.chronicle.some((e) => e.text.includes('declared war')));
  // War closes the borders and ends free trade between them.
  assert.equal(sim.diplomacy.open[att * PAIRS + def], 0);
  assert.equal(sim.diplomacy.freeTrade[att * PAIRS + def], 0);
});

test('the goal is the bordering seat with the largest benefit: (inhabitants + 50 per deposit, doubled for strategic and luxury) / (1 + defenders)', () => {
  const f = fixture(2);
  const { sim, att, def } = f;
  const cand = new Uint8Array(PAIRS);
  cand[def] = 1;
  const value = (seat: number) => {
    let pop = 0;
    let res = 0;
    let soldiers = 0;
    let border = false;
    for (const c of settledOf(sim, def)) {
      if (sim.government.district[c] !== seat) continue;
      pop += sim.cellPop[c];
      const dep = sim.world.deposit[c];
      if (dep) res += BUILDINGS.some((b) => b.deposit === dep) || dep === Deposit.Iron || dep === Deposit.Flint ? 2 : 1;
      soldiers += sim.military.soldiers[c * TROOP_TYPES] + sim.military.soldiers[c * TROOP_TYPES + 1] + sim.military.soldiers[c * TROOP_TYPES + 2];
      border ||= borders(sim, c, att);
    }
    return border ? (pop + 50 * res) / (1 + soldiers) : -1;
  };
  const expect = () => (value(f.seats[0]) >= value(f.seats[1]) ? f.seats[0] : f.seats[1]);
  assert.ok(value(f.seats[0]) > 0 || value(f.seats[1]) > 0);
  assert.equal(chooseGoal(sim, att, cand), expect());
  // Defenders make a district less worth taking.
  const first = chooseGoal(sim, att, cand);
  for (const c of settledOf(sim, def)) if (sim.government.district[c] === first) sim.military.soldiers[c * TROOP_TYPES] = 500;
  assert.equal(chooseGoal(sim, att, cand), expect());
  if (value(f.seats[0]) > 0 && value(f.seats[1]) > 0) assert.notEqual(chooseGoal(sim, att, cand), first);
  // A district without a settlement on the border is never the goal.
  for (const seat of f.seats) if (value(seat) < 0) assert.notEqual(chooseGoal(sim, att, cand), seat);
  // No candidate, no goal.
  assert.equal(chooseGoal(sim, att, new Uint8Array(PAIRS)), -1);
});

test('70 % of the soldiers march: the attacker in 1 main army, the defender in up to 3 relief armies from its other seats, at most 4 per people and 32 in the world', () => {
  const f = fixture(4);
  const { sim, att, def } = f;
  const w = sim.war;
  const goal = f.seats[0];
  w.armies = MAX_ARMIES - 2; // as if 30 armies marched elsewhere
  const s = startWar(sim, att, goal);
  assert.equal(armiesOf(sim, att).length, 1);
  assert.equal(armiesOf(sim, def).length, 1, 'room for one relief army only');
  endWar(sim, s, EndType.Exhausted);
  w.truce.fill(0);
  w.armies = MAX_ARMIES - 1;
  const chance = WAR.chance;
  try {
    WAR.chance = 1;
    runWarYear(sim);
  } finally {
    WAR.chance = chance;
  }
  assert.equal(w.wars, 0, 'no room for two armies: no declaration');
  assert.ok(w.stats.capBlocked >= 1);
  w.armies = 0;

  const s2 = startWar(sim, att, goal);
  const relief = armiesOf(sim, def);
  assert.equal(armiesOf(sim, att).length, 1);
  assert.equal(relief.length, 3);
  // Each relief army at another seat, the three nearest the goal, never the goal itself.
  const cells = relief.map((a) => w.aCell[a]);
  assert.equal(new Set(cells).size, 3);
  for (const c of cells) assert.ok(c !== goal && f.seats.includes(c));
  const left = f.seats.filter((c) => c !== goal && !cells.includes(c));
  for (const c of left) for (const r of cells) assert.ok(travelCost(sim, s2, 1, c) >= travelCost(sim, s2, 1, r));
  ready(sim);
  let marching = 0;
  for (const a of armiesOf(sim, att)) marching += w.aN[a * TROOP_TYPES + Troop.Melee];
  let away = 0;
  for (const c of settledOf(sim, att)) {
    const k = w.away[c * TROOP_TYPES + Troop.Melee];
    assert.ok(k === 0 || k === 7, 'the share of a settlement that can reach the rally point, or none');
    away += k;
  }
  assert.ok(marching > 0);
  assert.equal(marching, away);
  for (const c of settledOf(sim, def)) assert.ok([0, 5].includes(w.away[c * TROOP_TYPES + Troop.Melee]));
  // Raised again every year, but never beyond the caps.
  for (let y = 0; y < 3; y++) {
    for (const c of settledOf(sim, att)) sim.military.soldiers[c * TROOP_TYPES + Troop.Melee] += 10;
    for (const c of settledOf(sim, def)) sim.military.soldiers[c * TROOP_TYPES + Troop.Melee] += 10;
    runWarYear(sim);
    ready(sim);
    assert.ok(w.wLive[s2]);
    assert.equal(armiesOf(sim, att).length, 1);
    assert.equal(armiesOf(sim, def).length, 3);
  }
  for (const c of settledOf(sim, att)) {
    const i = c * TROOP_TYPES + Troop.Melee;
    assert.ok(w.away[i] <= Math.floor(0.7 * sim.military.soldiers[i]));
  }
  // A main army gone: a new one next year. A retreating relief army still counts toward the 4.
  disbandArmy(sim, armiesOf(sim, att)[0]);
  w.aState[armiesOf(sim, def)[0]] = ArmyState.Retreating;
  for (const c of settledOf(sim, att)) sim.military.soldiers[c * TROOP_TYPES + Troop.Melee] += 10;
  for (const c of settledOf(sim, def)) sim.military.soldiers[c * TROOP_TYPES + Troop.Melee] += 10;
  runWarYear(sim);
  assert.equal(armiesOf(sim, att).length, 1);
  assert.equal(armiesOf(sim, def).length, 4);
  w.aState[armiesOf(sim, def)[1]] = ArmyState.Retreating;
  runWarYear(sim);
  assert.equal(armiesOf(sim, def).length, 4, 'never more than 4');
});

test('a relief army gathers at the defender’s nearest other seat and marches to the besieged goal; a defender with one seat gathers in the goal', () => {
  const f = fixture(2);
  const { sim, att, def } = f;
  const w = sim.war;
  const [capital, goal] = f.seats;
  const s = startWar(sim, att, goal);
  const [b] = armiesOf(sim, def);
  assert.equal(armiesOf(sim, def).length, 1);
  assert.equal(w.aCell[b], capital, 'its other seat');
  assert.equal(w.aState[b], ArmyState.Gathering);
  for (const a of armiesOf(sim, att)) disbandArmy(sim, a);
  ready(sim);
  assert.ok(travelCost(sim, s, 1, capital) < Infinity, 'a way to the goal');
  let weeks = 0;
  let last = travelCost(sim, s, 1, w.aCell[b]);
  while (w.live[b] && w.aCell[b] !== goal && weeks < 60) {
    week(sim);
    weeks++;
    const now = travelCost(sim, s, 1, w.aCell[b]);
    assert.ok(now <= last);
    last = now;
  }
  assert.equal(w.aCell[b], goal, 'the relief reached the goal');
  // One seat only: the garrison gathers in the goal.
  const g = fixture(1);
  startWar(g.sim, g.att, g.seats[0]);
  const [x] = armiesOf(g.sim, g.def);
  assert.equal(g.sim.war.aCell[x], g.seats[0]);
});

test('contingents walk to the rally point (the seat nearest the goal) at army speed; the army sets out when all arrived, at the latest after 8 weeks', () => {
  for (const late of [false, true]) {
    const f = fixture(1);
    const { sim, att, def } = f;
    const goal = f.seats[0];
    const s = startWar(sim, att, goal);
    const w = sim.war;
    const [a] = armiesOf(sim, att);
    const [b] = armiesOf(sim, def);
    assert.equal(w.aState[a], ArmyState.Gathering);
    // The rally point: the attacker's seat with the least travel cost to the goal; the defender gathers in the goal.
    const rally = rallyPoint(sim, s, att);
    assert.equal(w.aCell[a], rally);
    assert.ok(rally === sim.civs[att]!.capital || hasSeat(sim.economy, rally));
    for (const c of settledOf(sim, att)) {
      if (c === sim.civs[att]!.capital || hasSeat(sim.economy, c)) assert.ok(travelCost(sim, s, 0, c) >= travelCost(sim, s, 0, rally));
    }
    assert.equal(w.aCell[b], goal);
    // The rally point's own soldiers are there at once, the others on the way.
    assert.equal(w.aN[a * TROOP_TYPES + Troop.Melee], 7);
    const coming = settledOf(sim, att).filter((c) => w.cArmy[c] === a);
    assert.ok(coming.length > 1, 'contingents on the way');
    assert.equal(w.aWait[a], coming.length);
    for (const c of coming) {
      assert.equal(w.pend[c * TROOP_TYPES + Troop.Melee], 7);
      assert.equal(w.away[c * TROOP_TYPES + Troop.Melee], 0, 'not in the army yet');
      assert.ok(w.cArrive[c] - sim.tick >= hexDistance(sim.world, c, rally) / 2, 'army speed');
    }
    // One contingent far away (as if 20 weeks): the army leaves without it after 8 weeks.
    if (late) w.cArrive[coming[0]] = sim.tick + 20;
    const start = sim.tick;
    const last = Math.max(...coming.map((c) => w.cArrive[c]));
    const leave = Math.min(last, start + WAR.gatherWeeks);
    if (!late) assert.ok(last - start <= WAR.gatherWeeks, 'all near enough for this check');
    while (sim.tick < leave - 1) {
      week(sim);
      assert.equal(w.aState[a], ArmyState.Gathering);
      assert.equal(w.aCell[a], rally, 'it waits');
      let n = 7;
      for (const c of coming) if (w.cArrive[c] <= sim.tick) n += 7;
      assert.equal(w.aN[a * TROOP_TYPES + Troop.Melee], n, `week ${sim.tick - start}`);
    }
    week(sim);
    assert.equal(w.aState[a], ArmyState.Marching);
    assert.equal(w.aWait[a], 0);
    const arrived = coming.filter((c) => !late || c !== coming[0]);
    assert.equal(w.aN[a * TROOP_TYPES + Troop.Melee], 7 * (arrived.length + 1));
    if (late) {
      assert.equal(w.pend[coming[0] * TROOP_TYPES + Troop.Melee], 0, 'the late contingent went home');
      assert.equal(w.away[coming[0] * TROOP_TYPES + Troop.Melee], 0);
      assert.equal(w.cArmy[coming[0]], -1);
    }
    for (const c of arrived) assert.equal(w.away[c * TROOP_TYPES + Troop.Melee], 7);
  }
});

test('armies march 1 travel cost a week over land they may enter, and go home after 2 years without a way', () => {
  const f = fixture(1);
  const { sim, att } = f;
  const s = warOn(f, f.seats[0]);
  const goal = f.seats[0];
  const armies = armiesOf(sim, att);
  // The farthest army; the others go home.
  armies.sort((x, y) => travelCost(sim, s, 0, sim.war.aCell[y]) - travelCost(sim, s, 0, sim.war.aCell[x]));
  const a = armies[0];
  // Start it from the farthest land the way reaches.
  let start = sim.war.aCell[a];
  for (let c = 0; c < sim.world.cellCount; c++) {
    const cost = travelCost(sim, s, 0, c);
    if (cost < Infinity && cost > travelCost(sim, s, 0, start)) start = c;
  }
  put(sim, a, start);
  for (const b of armies.slice(1)) disbandArmy(sim, b);
  const c0 = travelCost(sim, s, 0, sim.war.aCell[a]);
  assert.ok(c0 > 3 && c0 < Infinity, `cost ${c0}`);
  for (let k = 0; k < 3; k++) week(sim);
  const c3 = travelCost(sim, s, 0, sim.war.aCell[a]);
  assert.notEqual(sim.war.aCell[a], goal);
  assert.ok(Math.abs(c0 - c3 + sim.war.aProg[a] - 3 * WAR.speed) < 1e-3, `walked ${c0 - c3}, left ${sim.war.aProg[a]}`);
  assert.ok(sim.war.aProg[a] >= 0 && sim.war.aProg[a] < 3);

  // No way over water; a third people's land only with its border open to the army's people.
  const n = sim.world.cellCount;
  for (let c = 0; c < n; c++) if (isWaterBiome(sim.world.biome[c])) assert.equal(travelCost(sim, s, 0, c), Infinity);
  let x = -1;
  for (let c = 0; c < n && x < 0; c++) if (c !== goal && sim.world.owner[c] === 0 && travelCost(sim, s, 0, c) < Infinity) x = c;
  assert.ok(x >= 0);
  const third = 200;
  sim.world.owner[x] = third;
  planMarch(sim, s);
  assert.equal(travelCost(sim, s, 0, x), Infinity, 'closed border');
  sim.diplomacy.open[third * PAIRS + att] = 1;
  planMarch(sim, s);
  assert.ok(travelCost(sim, s, 0, x) < Infinity, 'open border');
  sim.diplomacy.open[third * PAIRS + att] = 0;
  sim.world.owner[x] = 0;
  planMarch(sim, s);

  // Beyond the reach of the path search: home after 104 weeks, soldiers back in their cells.
  let far = -1;
  for (let c = 0; c < n && far < 0; c++) if (!isWaterBiome(sim.world.biome[c]) && travelCost(sim, s, 0, c) === Infinity) far = c;
  assert.ok(far >= 0);
  put(sim, a, far);
  for (let k = 0; k < WAR.noTargetWeeks - 1; k++) week(sim);
  assert.equal(sim.war.live[a], 1);
  week(sim);
  assert.equal(sim.war.live[a], 0);
  for (const c of settledOf(sim, att)) assert.equal(sim.war.away[c * TROOP_TYPES + Troop.Melee], 0);
});

test('armies that meet fight: on the same hex, and an army stops on the hex of an enemy army in its way', () => {
  for (const mode of ['same', 'way'] as const) {
    const f = fixture(1);
    const { sim, att, def } = f;
    const s = warOn(f, f.seats[0], true);
    const [a, ...ra] = armiesOf(sim, att);
    const [b, ...rb] = armiesOf(sim, def);
    for (const x of [...ra, ...rb]) disbandArmy(sim, x);
    assert.ok(a < b, 'the attacker moves first');
    const n = sim.world.cellCount;
    const goal = f.seats[0];
    const field = (c: number) => travelCost(sim, s, 0, c);
    // A hex on the attacker's way whose next step is not the goal.
    let from = -1;
    let next = -1;
    for (let c = 0; c < n && from < 0; c++) {
      if (field(c) === Infinity || field(c) < 3) continue;
      let bestV = Infinity;
      let best = -1;
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const nb = sim.world.neighbors[c * DIRECTION_COUNT + d];
        if (nb < 0 || field(nb) === Infinity) continue;
        const v = field(nb) + stepCost(sim.world, c, d);
        if (v < bestV) {
          bestV = v;
          best = nb;
        }
      }
      if (best >= 0 && best !== goal) {
        from = c;
        next = best;
      }
    }
    assert.ok(from >= 0);
    const before = totalSoldiers(sim);
    if (mode === 'same') {
      put(sim, a, next);
      put(sim, b, next);
    } else {
      put(sim, a, from);
      sim.war.aProg[a] = 10; // would walk far past the enemy
      put(sim, b, next);
    }
    week(sim);
    assert.equal(sim.war.wBattles[s], 1, mode);
    assert.ok(totalSoldiers(sim) < before, 'both sides lose soldiers');
    const beaten = (x: number) => !sim.war.live[x] || sim.war.aState[x] === ArmyState.Retreating;
    assert.ok(beaten(a) || beaten(b), 'the loser retreats');
    if (!beaten(a)) assert.equal(sim.war.aCell[a], next);
  }
});

test('a beaten army retreats with what is left to its nearest own seat and goes home there; on the way it can be attacked', () => {
  for (const attacked of [false, true]) {
    const f = fixture(1);
    const { sim, att, def } = f;
    const w = sim.war;
    const goal = f.seats[0];
    const s = warOn(f, goal, true);
    const [a, ...ra] = armiesOf(sim, att);
    const [b, ...rb] = armiesOf(sim, def);
    for (const x of [...ra, ...rb]) disbandArmy(sim, x);
    const field = settledOf(sim, def).find((c) => c !== goal)!;
    assert.ok(field >= 0);
    const n0 = armySoldiers(w, a);
    w.aN.fill(0, b * TROOP_TYPES, b * TROOP_TYPES + TROOP_TYPES);
    w.aN[b * TROOP_TYPES + Troop.Melee] = Math.round(1.6 * n0);
    put(sim, a, field);
    put(sim, b, field);
    week(sim);
    assert.equal(w.wBattles[s], 1);
    assert.equal(w.live[a], 1);
    assert.equal(w.aState[a], ArmyState.Retreating);
    assert.ok(armySoldiers(w, a) > 0 && armySoldiers(w, a) < n0, 'with what is left');
    assert.equal(w.aState[b], ArmyState.Marching);
    // The way: neighbor by neighbor to a seat of its own people.
    const path = Array.from(w.aPath.subarray(a * 64, a * 64 + w.aPathLen[a]));
    assert.ok(path.length > 0);
    let prev = field;
    for (const c of path) {
      assert.equal(hexDistance(sim.world, prev, c), 1);
      prev = c;
    }
    const seat = path[path.length - 1];
    assert.equal(sim.world.owner[seat], att);
    assert.ok(seat === sim.civs[att]!.capital || hasSeat(sim.economy, seat));
    if (attacked) {
      // An enemy army waits on its way: the retreating army stops there and is attacked.
      put(sim, b, path[0]);
      // It stands there (as if gathering).
      w.aState[b] = ArmyState.Gathering;
      w.aWait[b] = 1;
      w.aLeave[b] = sim.tick + 100;
      w.gathering++;
      for (let k = 0; k < 4 && w.wBattles[s] === 1; k++) {
        week(sim);
      }
      assert.equal(w.wBattles[s], 2);
      assert.equal(w.stats.retreatBattles, 1);
      assert.ok(!w.live[a] || w.aCell[a] === path[0]);
      continue;
    }
    disbandArmy(sim, b);
    let weeks = 0;
    while (w.live[a] && weeks < 60) {
      week(sim);
      weeks++;
      if (w.live[a]) assert.ok(path.includes(w.aCell[a]), 'along its way');
    }
    assert.equal(w.live[a], 0, 'home at the seat');
    assert.ok(weeks >= path.length / 2, 'at army speed');
    assert.equal(w.stats.retreatsHome, 1);
    for (const c of settledOf(sim, att)) assert.equal(w.away[c * TROOP_TYPES + Troop.Melee], 0, 'its soldiers count in their cells again');
  }
});

test('retreating armies do not attack each other', () => {
  const f = fixture(1);
  const { sim, att, def } = f;
  const w = sim.war;
  const s = warOn(f, f.seats[0], true);
  const [a] = armiesOf(sim, att);
  const [b] = armiesOf(sim, def);
  const field = settledOf(sim, def).find((c) => c !== f.seats[0])!;
  let far = 0;
  while (hexDistance(sim.world, field, far) < 3) far++;
  put(sim, a, field);
  put(sim, b, field);
  for (const x of [a, b]) {
    w.aState[x] = ArmyState.Retreating;
    w.aPath[x * 64] = far; // not a neighbor: a way they can't walk, both stay
    w.aPathLen[x] = 1;
    w.aPathPos[x] = 0;
  }
  week(sim);
  assert.equal(w.live[a] + w.live[b], 2);
  assert.equal(w.aCell[a], w.aCell[b]);
  assert.equal(w.wBattles[s], 0);
  // A fighting army on the hex attacks.
  w.aState[b] = ArmyState.Marching;
  week(sim);
  assert.equal(w.wBattles[s], 1);
});

test('a siege halves the seat’s natural supply, stops its trade and gives “Besieged” −40', () => {
  const f = fixture(1);
  const { sim, def } = f;
  const goal = f.seats[0];
  const food = sim.baseSupply[goal * SUPPLY_KINDS + SupplyKind.Food];
  const s = warOn(f, goal);
  besiege(f, s);
  assert.equal(sim.war.siege[goal], 1);
  assert.equal(sim.war.siegeValue[goal], -40);
  const term = satisfactionTerms(sim, goal, sim.civs[def]).find((t) => t.label === 'Besieged');
  assert.equal(term?.value, -40);
  assert.ok(food > 0 && Math.abs(sim.baseSupply[goal * SUPPLY_KINDS + SupplyKind.Food] - food / 2) < 1e-3);
  updateTradeNeeds(sim, goal, sim.cellAdults[goal], false, 13);
  for (let g = 0; g < TRADE_GOODS; g++) {
    assert.equal(sim.trade.want[goal * TRADE_GOODS + g], 0);
    assert.equal(sim.trade.surplus[goal * TRADE_GOODS + g], 0);
  }
  assert.ok(sim.chronicle.some((e) => e.text.includes('besieged')));
  // The siege ends with the war: supply and satisfaction back.
  endWar(sim, s, EndType.Exhausted);
  assert.equal(sim.war.siege[goal], 0);
  assert.equal(sim.war.siegeValue[goal], 0);
  assert.ok(Math.abs(sim.baseSupply[goal * SUPPLY_KINDS + SupplyKind.Food] - food) < 1e-3);
});

test('a seat is occupied after 2 years of siege if its satisfaction is below 0, else checked again every year', () => {
  for (const happyFirst of [false, true]) {
    const f = fixture(1);
    const { sim } = f;
    const goal = f.seats[0];
    const s = warOn(f, goal);
    besiege(f, s);
    for (let k = 1; k < WAR.occupyWeeks; k++) {
      sim.satisfaction[goal] = -5;
      week(sim);
    }
    assert.equal(sim.war.wOccupied[s], 0, 'not before 2 years');
    sim.satisfaction[goal] = happyFirst ? 5 : -5;
    week(sim);
    assert.equal(sim.war.wOccupied[s], happyFirst ? 0 : 1);
    if (!happyFirst) {
      assert.ok(sim.chronicle.some((e) => e.text.includes('occupied')));
      assert.equal(sim.war.wLive[s], 1, 'occupied is not conquered: the war goes on');
      assert.equal(sim.world.owner[goal], f.def);
      continue;
    }
    for (let k = 1; k < WAR.occupyCheck; k++) {
      sim.satisfaction[goal] = -5;
      week(sim);
    }
    assert.equal(sim.war.wOccupied[s], 0, 'only at the yearly check');
    week(sim);
    assert.equal(sim.war.wOccupied[s], 1);
  }
});

test('defenders in a besieged seat attack only when they can win, at the latest in the month before the check; relief breaks the siege', () => {
  // Too weak: they wait until 4 weeks before the occupation check.
  {
    const f = fixture(1);
    const { sim, att, def } = f;
    const goal = f.seats[0];
    const s = warOn(f, goal, true);
    const [b, ...rest] = armiesOf(sim, def);
    for (const x of rest) disbandArmy(sim, x);
    put(sim, b, goal);
    sim.war.aN.fill(0, b * TROOP_TYPES, b * TROOP_TYPES + TROOP_TYPES);
    sim.war.aN[b * TROOP_TYPES + Troop.Melee] = 1;
    besiege(f, s);
    assert.ok(armiesOf(sim, att).length === 1);
    while (sim.tick - sim.war.wSiegeStart[s] < WAR.occupyWeeks - WAR.forceWeeks - 1) {
      sim.satisfaction[goal] = 10;
      week(sim);
      assert.equal(sim.war.wBattles[s], 0);
    }
    week(sim);
    assert.equal(sim.war.wBattles[s], 1, 'forced to fight');
    assert.equal(sim.war.live[b], 0);
  }
  // Strong enough: the relief attacks on arrival and the siege is broken.
  {
    const f = fixture(1);
    const { sim, att, def } = f;
    const goal = f.seats[0];
    const s = warOn(f, goal, true);
    const [b, ...rest] = armiesOf(sim, def);
    for (const x of rest) disbandArmy(sim, x);
    put(sim, b, 0);
    sim.war.aIdle[b] = 0;
    const a = besiege(f, s);
    assert.equal(sim.war.wBattles[s], 0);
    sim.war.aN[b * TROOP_TYPES + Troop.Melee] = 20 * sim.war.aN[a * TROOP_TYPES + Troop.Melee] + 50;
    put(sim, b, goal);
    sim.war.aSince[b] = sim.tick + 1; // arrives this week
    week(sim);
    assert.equal(sim.war.wBattles[s], 1);
    assert.equal(sim.war.live[a], 0, 'the besiegers are beaten');
    week(sim);
    assert.equal(sim.war.wSiegeStart[s], -1);
    assert.equal(sim.war.siege[goal], 0);
    assert.equal(armiesOf(sim, att).length, 0);
  }
});

test('the defender gives up only after the goal is occupied and below 40 % of the attacker; the attacker below 40 %', () => {
  {
    const f = fixture(1);
    const { sim, att, def } = f;
    const goal = f.seats[0];
    const s = warOn(f, goal);
    sim.military.strength[def] = 0.1 * sim.military.strength[att];
    runWarYear(sim);
    assert.equal(sim.war.wLive[s], 1, 'never before the occupation');
    sim.war.wOccupied[s] = 1;
    sim.military.strength[def] = 0.5 * sim.military.strength[att];
    runWarYear(sim);
    assert.equal(sim.war.wLive[s], 1, 'occupied, but strong enough to fight on');
    sim.military.strength[def] = 0.39 * sim.military.strength[att];
    runWarYear(sim);
    assert.equal(sim.war.wLive[s], 0);
    assert.equal(sim.war.stats.ended[EndType.GaveUp], 1);
    assert.equal(sim.world.owner[goal], att, 'the goal district changes hands');
  }
  {
    const f = fixture(1);
    const { sim, att, def } = f;
    const goal = f.seats[0];
    const s = warOn(f, goal);
    sim.military.strength[att] = 0.39 * sim.military.strength[def];
    runWarYear(sim);
    assert.equal(sim.war.wLive[s], 0);
    assert.equal(sim.war.stats.ended[EndType.AttackerGaveUp], 1);
    assert.equal(sim.world.owner[goal], def, 'no land changes hands');
  }
});

test('10 years without an attacker success end the war by exhaustion: peace without land, trust −30, closed borders, no agreements, 20 years of truce', () => {
  const f = fixture(1);
  const { sim, att, def } = f;
  const goal = f.seats[0];
  const s = warOn(f, goal);
  const owners = sim.world.owner.slice();
  sim.war.wLastGain[s] = sim.tick - WAR.exhaustYears * TICKS_PER_YEAR + 1;
  runWarYear(sim);
  assert.equal(sim.war.wLive[s], 1, 'not yet');
  sim.war.wLastGain[s] = sim.tick - WAR.exhaustYears * TICKS_PER_YEAR;
  runWarYear(sim);
  assert.equal(sim.war.wLive[s], 0);
  assert.equal(sim.war.stats.ended[EndType.Exhausted], 1);
  assert.deepEqual(sim.world.owner, owners, 'no land changed hands');
  assert.equal(sim.war.enemy[att], 0);
  assert.equal(sim.war.enemy[def], 0);
  assert.equal(sim.war.armies, 0, 'all armies home');
  for (const [x, y] of [
    [att, def],
    [def, att],
  ]) {
    const mood = sim.diplomacy.moods.get(x * PAIRS + y)?.find((m) => m.label === 'War');
    assert.equal(mood?.value, -30);
    assert.equal(sim.diplomacy.open[x * PAIRS + y], 0);
    assert.equal(sim.diplomacy.freeTrade[x * PAIRS + y], 0);
    assert.equal(sim.diplomacy.migration[x * PAIRS + y], 0);
  }
  assert.ok(!sim.diplomacy.agreements.some((t) => (t.a === att && t.b === def) || (t.a === def && t.b === att)));
  assert.ok(sim.chronicle.some((e) => e.text.includes('made peace')));
  // The truce: 20 years without a new war between them.
  const end = sim.tick + WAR.truceYears * TICKS_PER_YEAR;
  assert.equal(inTruce(sim, att, def), true);
  assert.deepEqual(warTargets(sim, att), []);
  sim.tick = end - 1;
  assert.equal(inTruce(sim, def, att), true);
  sim.tick = end;
  assert.equal(inTruce(sim, att, def), false);
  assert.deepEqual(warTargets(sim, att), [def]);
});

test('at the war’s end only the goal district changes hands, with half the treasury, “Conquered” −15 for 10 years and a road at the border', () => {
  const f = fixture(2);
  const { sim, att, def } = f;
  const [capital, other] = f.seats;
  assert.equal(sim.civs[def]!.capital, capital);
  sim.government.treasury[other] = 100;
  const goalCells = settledOf(sim, def).filter((c) => sim.government.district[c] === other);
  const kept = settledOf(sim, def).filter((c) => sim.government.district[c] !== other);
  assert.ok(goalCells.length > 0 && kept.length > 0);
  const s = warOn(f, other);
  sim.war.wOccupied[s] = 1;
  const roads = sim.war.stats.roads;
  endWar(sim, s, EndType.GaveUp);
  for (const c of goalCells) {
    assert.equal(sim.world.owner[c], att);
    assert.equal(sim.cellCivPop[c * sim.civSlots + def], 0);
    assert.equal(sim.cellCivPop[c * sim.civSlots + att], sim.cellPop[c]);
    assert.equal(conqueredValue(sim, c), -15);
    assert.equal(satisfactionTerms(sim, c, sim.civs[att]).find((t) => t.label === 'Conquered')?.value, -15);
  }
  for (const c of kept) assert.equal(sim.world.owner[c], def, 'the other seat stays with the defender');
  assert.equal(sim.civs[def]!.capital, capital);
  assert.equal(sim.government.treasury[other], 50);
  // The road at the border crossing.
  assert.equal(sim.war.stats.roads, roads + 1);
  const crossing = goalCells.some((c) => {
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = sim.world.neighbors[c * DIRECTION_COUNT + d];
      if (nb >= 0 && !goalCells.includes(nb) && sim.world.owner[nb] === att && sim.cellPop[nb] > 0 && hasRoad(sim.world, c, d)) return true;
    }
    return false;
  });
  assert.ok(crossing);
  // "Conquered" fades linearly over 10 years.
  sim.tick += 5 * TICKS_PER_YEAR;
  assert.ok(Math.abs(conqueredValue(sim, goalCells[0]) + 7.5) < 1e-4);
  sim.tick += 5 * TICKS_PER_YEAR;
  assert.equal(conqueredValue(sim, goalCells[0]), 0);
});

test('a conquered capital goes with its district only; the rest keeps a seat as its new capital', () => {
  const f = fixture(2);
  const { sim, att, def } = f;
  const [capital, other] = f.seats;
  const s = warOn(f, capital);
  sim.war.wOccupied[s] = 1;
  endWar(sim, s, EndType.GaveUp);
  assert.equal(sim.world.owner[capital], att);
  assert.ok(sim.civs[def], 'the people lives on');
  assert.equal(sim.civs[def]!.capital, other);
  assert.equal(sim.world.owner[other], def);
  assert.equal(sim.war.stats.annexed, 0);
});

test('a people with only one seat that loses it is annexed whole', () => {
  const f = fixture(1);
  const { sim, att, def } = f;
  const cells = settledOf(sim, def);
  const s = warOn(f, f.seats[0]);
  sim.war.wOccupied[s] = 1;
  endWar(sim, s, EndType.GaveUp);
  for (const c of cells) assert.equal(sim.world.owner[c], att);
  for (let c = 0; c < sim.world.cellCount; c++) assert.equal(sim.cellCivPop[c * sim.civSlots + def], 0);
  assert.equal(sim.war.stats.annexed, 1);
  assert.ok(sim.chronicle.some((e) => e.text.includes('conquered all their land')));
  runYears(sim, 1);
  assert.equal(sim.civs[def], null, 'the people is gone');
});

test('wars run the same for the same seed', () => {
  const run = () => {
    const f = fixture(2);
    startWar(f.sim, f.att, f.seats[0]);
    runYears(f.sim, 4);
    const w = f.sim.war;
    return [Array.from(w.aCell), Array.from(w.aN), Array.from(w.live), Array.from(w.wLive), Array.from(f.sim.world.owner), f.sim.chronicle.map((e) => e.text)];
  };
  assert.deepEqual(run(), run());
});

// ---------------------------------------------------------------------------
// Phase 4: defense pacts and alliances

const kindOf = (sim: Simulation, a: number, b: number) => sim.war.pact[a * PAIRS + b];

function setPact(sim: Simulation, a: number, b: number, kind: number): void {
  const w = sim.war;
  if (w.pact[a * PAIRS + b] === 0 && kind !== 0) w.pactCount++;
  else if (w.pact[a * PAIRS + b] !== 0 && kind === 0) w.pactCount--;
  w.pact[a * PAIRS + b] = kind;
  w.pact[b * PAIRS + a] = kind;
}

function clearPacts(sim: Simulation): void {
  sim.war.pact.fill(0);
  sim.war.pactX.fill(0);
  sim.war.pactCount = 0;
}

const setTrust = (sim: Simulation, a: number, b: number, ab: number, ba = ab) => {
  sim.diplomacy.trust[a * PAIRS + b] = ab;
  sim.diplomacy.trust[b * PAIRS + a] = ba;
};

const moodOf = (sim: Simulation, a: number, b: number, label: string) => sim.diplomacy.moods.get(a * PAIRS + b)?.find((m) => m.label === label)?.value;

type Bloc = Fixture & { ally: number; far: number[] };

/**
 * fixture(2), then the district of the second seat breaks away from `def` as
 * a third people (`ally`, its capital seats[1]) with 20 melee per settlement;
 * no pacts or alliances anywhere. `far` are the other living peoples (no soldiers).
 */
function blocFixture(): Bloc {
  const f = fixture(2);
  const { sim } = f;
  const owner = sim.world.owner;
  const civ = foundCivilization(sim, 'secession', f.seats[1], sim.civs[f.def]!)!;
  const ally = civ.id;
  const moving = new Uint8Array(sim.world.cellCount);
  for (const c of settledOf(sim, f.def)) if (sim.government.district[c] === f.seats[1]) moving[c] = 1;
  for (let i = 0; i < sim.pop.end; i++) if (sim.pop.alive[i] && moving[sim.pop.cell[i]]) changeCiv(sim, i, ally);
  for (let c = 0; c < sim.world.cellCount; c++) if (moving[c]) owner[c] = ally;
  const m = sim.military;
  if (m.strength.length < sim.civSlots) {
    const grown = new Float64Array(sim.civSlots);
    grown.set(m.strength);
    m.strength = grown;
  }
  for (const c of settledOf(sim, ally)) m.soldiers[c * TROOP_TYPES + Troop.Melee] = 20;
  m.strength[f.def] = 8 * settledOf(sim, f.def).length;
  m.strength[ally] = 20 * settledOf(sim, ally).length;
  clearPacts(sim);
  const far: number[] = [];
  for (const c of sim.civs) if (c && c.id !== f.att && c.id !== f.def && c.id !== ally) far.push(c.id);
  assert.ok(far.length >= 2, 'other peoples live');
  assert.ok(settledOf(sim, ally).length > 0 && settledOf(sim, f.def).length > 0);
  return { ...f, ally, far };
}

test('a defense pact needs trust ≥ 40 both ways and a common threat (both danger ≥ 50 from the same third people); it ends below trust 30 or when the threat falls below 35', () => {
  const f = blocFixture();
  const { sim } = f;
  const [a, b] = f.far;
  const x = f.att;
  const dip = sim.diplomacy;
  dip.known[a * PAIRS + b] = 1;
  dip.known[b * PAIRS + a] = 1;
  const danger = (p: number, v: number) => (dip.danger[p * PAIRS + x] = v);
  const year = () => {
    for (let o = 1; o < PAIRS; o++) if (o !== x) dip.danger[a * PAIRS + o] = dip.danger[b * PAIRS + o] = 0;
    updateAlliances(sim);
  };
  setTrust(sim, a, b, 60);
  danger(a, 60);
  danger(b, 49);
  year();
  assert.equal(kindOf(sim, a, b), Pact.None, 'no common threat');
  danger(b, 50);
  setTrust(sim, a, b, 60, 39);
  year();
  assert.equal(kindOf(sim, a, b), Pact.None, 'trust 40 needed both ways');
  setTrust(sim, a, b, 40);
  year();
  assert.equal(kindOf(sim, a, b), Pact.Pact);
  assert.equal(sim.war.pactX[a * PAIRS + b], x);
  assert.deepEqual(civPacts(sim, a).find((p) => p.civ === b), { civ: b, kind: Pact.Pact, threat: x });
  assert.ok(sim.chronicle.some((e) => e.text.includes('signed a defense pact')));
  // The threat may fall to 35 and trust to 30 without ending it.
  danger(a, 35);
  setTrust(sim, a, b, 30);
  year();
  assert.equal(kindOf(sim, a, b), Pact.Pact);
  danger(b, 34.9);
  year();
  assert.equal(kindOf(sim, a, b), Pact.None, 'threat below 35 at one partner');
  danger(b, 50);
  danger(a, 50);
  setTrust(sim, a, b, 45);
  year();
  assert.equal(kindOf(sim, a, b), Pact.Pact);
  setTrust(sim, a, b, 29.9, 60);
  year();
  assert.equal(kindOf(sim, a, b), Pact.None, 'trust below 30');
  assert.ok(sim.chronicle.some((e) => e.text.includes('defense pact') && e.text.includes('ended')));
});

test('an alliance needs trust ≥ 80 both ways and no threat; below 65 it becomes a pact (with a common threat ≥ 35) or ends; a pact at 80 becomes an alliance', () => {
  const f = blocFixture();
  const { sim } = f;
  const [a, b] = f.far;
  const x = f.att;
  const dip = sim.diplomacy;
  dip.known[a * PAIRS + b] = 1;
  dip.known[b * PAIRS + a] = 1;
  const year = () => {
    for (let o = 1; o < PAIRS; o++) if (o !== x) dip.danger[a * PAIRS + o] = dip.danger[b * PAIRS + o] = 0;
    updateAlliances(sim);
  };
  dip.danger[a * PAIRS + x] = dip.danger[b * PAIRS + x] = 0;
  setTrust(sim, a, b, 90, 79.9);
  year();
  assert.equal(kindOf(sim, a, b), Pact.None);
  setTrust(sim, a, b, 80);
  year();
  assert.equal(kindOf(sim, a, b), Pact.Alliance);
  assert.ok(sim.chronicle.some((e) => e.text.includes('formed an alliance')));
  setTrust(sim, a, b, 65);
  year();
  assert.equal(kindOf(sim, a, b), Pact.Alliance, 'kept at 65');
  // Below 65 with a common threat: a pact against it.
  dip.danger[a * PAIRS + x] = dip.danger[b * PAIRS + x] = 40;
  setTrust(sim, a, b, 64.9, 70);
  year();
  assert.equal(kindOf(sim, a, b), Pact.Pact);
  assert.equal(sim.war.pactX[a * PAIRS + b], x);
  assert.ok(sim.chronicle.some((e) => e.text.includes('became a defense pact')));
  // The pact is an alliance again at 80.
  setTrust(sim, a, b, 80);
  year();
  assert.equal(kindOf(sim, a, b), Pact.Alliance);
  // Below 65 without a common threat it ends.
  dip.danger[a * PAIRS + x] = dip.danger[b * PAIRS + x] = 0;
  setTrust(sim, a, b, 60);
  year();
  assert.equal(kindOf(sim, a, b), Pact.None);
  // An alliance made without trust (the peoples of a won revolution) follows the same rule.
  formAlliance(sim, a, b);
  assert.equal(kindOf(sim, a, b), Pact.Alliance);
  setTrust(sim, a, b, 70);
  year();
  assert.equal(kindOf(sim, a, b), Pact.Alliance);
  setTrust(sim, a, b, 50);
  year();
  assert.equal(kindOf(sim, a, b), Pact.None);
  // No limit per people: one people allied with all others.
  const all = [f.att, f.def, f.ally, ...f.far];
  for (const p of all) for (const q of all) if (p !== q) {
    dip.known[p * PAIRS + q] = 1;
    sim.diplomacy.trust[p * PAIRS + q] = p === a || q === a ? 90 : 0;
  }
  updateAlliances(sim);
  for (const q of all) if (q !== a) assert.equal(kindOf(sim, a, q), Pact.Alliance);
});

test('trust: a pact +5, an alliance +10 for good, signing +10 fading over 10 years; it counts for open borders and free trade', () => {
  const f = blocFixture();
  const { sim } = f;
  const [a, b] = f.far;
  const dip = sim.diplomacy;
  dip.known[a * PAIRS + b] = 1;
  dip.known[b * PAIRS + a] = 1;
  dip.moods.delete(a * PAIRS + b);
  dip.moods.delete(b * PAIRS + a);
  const plain = trustValue(sim, a, b);
  assert.ok(plain <= 80, 'room below the clamp');
  setTrust(sim, a, b, 85);
  for (let o = 1; o < PAIRS; o++) dip.danger[a * PAIRS + o] = dip.danger[b * PAIRS + o] = 0;
  updateAlliances(sim);
  assert.equal(kindOf(sim, a, b), Pact.Alliance);
  assert.equal(pactTrust(sim, a, b), ALLY.allianceBonus);
  assert.equal(moodOf(sim, a, b, 'Formed an alliance with us'), ALLY.signBonus);
  assert.equal(moodOf(sim, b, a, 'Formed an alliance with us'), ALLY.signBonus);
  assert.equal(trustValue(sim, a, b), Math.min(100, plain + 10 + 10));
  sim.tick += 5 * TICKS_PER_YEAR;
  const half = trustValue(sim, a, b);
  setPact(sim, a, b, Pact.Pact);
  assert.ok(Math.abs(trustValue(sim, a, b) - (half - 5)) < 1e-9, 'a pact gives 5 less');
  setPact(sim, a, b, Pact.None);
  assert.ok(Math.abs(trustValue(sim, a, b) - (half - 10)) < 1e-9);
  sim.tick += 5 * TICKS_PER_YEAR;
  const faded = trustValue(sim, a, b);
  setPact(sim, a, b, Pact.Alliance);
  assert.ok(Math.abs(trustValue(sim, a, b) - (faded + 10)) < 1e-9, 'the signing bonus is gone after 10 years, the alliance stays');
});

test('danger and the 2× declaration check count the other side with pacts and alliances, the own side with alliances, not a partner the declaration would lose; allies never attack each other', () => {
  const f = blocFixture();
  const { sim, att } = f;
  const target = f.def;
  const [c, d] = f.far;
  const m = sim.military;
  m.strength[att] = 100;
  m.strength[target] = 60;
  m.strength[c] = 30;
  m.strength[d] = 10;
  m.strength[f.ally] = 0;
  assert.ok(!warTargets(sim, att).includes(target));
  // An ally of the attacker counts, a defense pact of the attacker does not.
  setPact(sim, att, c, Pact.Pact);
  assert.equal(mayOutweigh(sim, att, target, WAR.ratio), false);
  setPact(sim, att, c, Pact.Alliance);
  assert.equal(mayOutweigh(sim, att, target, WAR.ratio), true);
  assert.ok(warTargets(sim, att).includes(target));
  // The target's pacts and alliances count.
  setPact(sim, target, d, Pact.Pact);
  assert.equal(mayOutweigh(sim, att, target, WAR.ratio), false);
  setPact(sim, target, d, Pact.None);
  // A partner allied to the target would be lost by the declaration: it counts for the target, not for the attacker.
  setPact(sim, c, target, Pact.Alliance);
  assert.equal(mayOutweigh(sim, att, target, WAR.ratio), false);
  m.strength[att] = 200;
  assert.equal(mayOutweigh(sim, att, target, WAR.ratio), true);
  setPact(sim, c, target, Pact.None);
  // Allies never attack each other, however strong.
  setPact(sim, att, target, Pact.Alliance);
  m.strength[att] = 1e6;
  assert.ok(!warTargets(sim, att).includes(target));
  setPact(sim, att, target, Pact.None);
  // Danger of the target for the attacker: (target + its pacts and alliances + floor) / (attacker + its alliances + floor).
  m.strength[att] = 100;
  setPact(sim, target, d, Pact.Pact);
  setPact(sim, target, f.ally, Pact.Alliance);
  m.strength[f.ally] = 15;
  setPact(sim, att, c, Pact.Alliance);
  const expected = Math.min(100, (50 * (60 + 10 + 15 + MIL.floor)) / (100 + 30 + MIL.floor));
  assert.ok(Math.abs(strengthSize(sim, att, target, 50) - expected) < 1e-9);
  // The attacker's pact does not count for its own side.
  setPact(sim, att, c, Pact.Pact);
  assert.ok(Math.abs(strengthSize(sim, att, target, 50) - Math.min(100, (50 * (60 + 10 + 15 + MIL.floor)) / (100 + MIL.floor))) < 1e-9);
});

test('a declaration on an ally of a partner ends that alliance (−30 trust at the partner), who may then join the other side', () => {
  const f = blocFixture();
  const { sim, att } = f;
  const target = f.def;
  const c = f.ally;
  const m = sim.military;
  m.strength[att] = 100;
  m.strength[target] = 40;
  m.strength[c] = 70;
  setPact(sim, att, c, Pact.Alliance);
  setPact(sim, c, target, Pact.Alliance);
  const s = startWar(sim, att, f.seats[0]);
  assert.ok(s >= 0);
  assert.equal(kindOf(sim, att, c), Pact.None);
  assert.equal(moodOf(sim, c, att, 'Attacked our ally'), -ALLY.breakLoss);
  assert.ok(sim.chronicle.some((e) => e.text.includes('attacked an ally')));
  // 40 + 70 > 100: the lost partner joins the defender.
  assert.equal(sim.war.side[s * PAIRS + c], 1);
  assert.equal(hostile(sim, c, att), true);
});

test('pact partners join only a defensive war, alliance partners both, if their side can win and unless the opponent is their own ally', () => {
  const f = blocFixture();
  const { sim, att } = f;
  const target = f.def;
  const [c, d, e] = [f.ally, f.far[0], f.far[1]];
  const m = sim.military;
  m.strength[att] = 100;
  m.strength[target] = 40;
  m.strength[c] = 90;
  m.strength[d] = 20;
  m.strength[e] = 5;
  setPact(sim, target, c, Pact.Pact); // defends the target
  setPact(sim, att, d, Pact.Pact); // a pact of the attacker: never joins its attack
  setPact(sim, att, e, Pact.Alliance); // an ally of the attacker
  // The defender's side 40 + 90 > the attacker with its pacts and alliances 100 + 20 + 5: c joins; e's side 105 < 130 does not.
  let s = startWar(sim, att, f.seats[0]);
  const side = (p: number) => sim.war.side[s * PAIRS + p];
  assert.equal(side(c), 1);
  assert.equal(side(d), -1);
  assert.equal(side(e), -1, 'the attacker’s side cannot win');
  assert.equal(sim.war.wAllies[s], 1);
  assert.ok(sim.chronicle.some((x) => x.text.includes('joined the')));
  // Agreements and open borders between the opposing sides end.
  assert.equal(sim.diplomacy.open[c * PAIRS + att], 0);
  assert.equal(sim.diplomacy.freeTrade[c * PAIRS + att], 0);
  assert.equal(hostile(sim, c, att), true);
  assert.equal(hostile(sim, d, target), false);
  endWar(sim, s, EndType.Exhausted);
  sim.war.truce.fill(0);
  // Just not stronger is not enough: 40 + 85 against 125.
  m.strength[c] = 85;
  s = startWar(sim, att, f.seats[0]);
  assert.equal(side(c), -1);
  assert.equal(sim.war.wAllies[s], 0);
  endWar(sim, s, EndType.Exhausted);
  sim.war.truce.fill(0);
  // With more strength the attacker's ally joins its attack (100 + 50 > 40 + 85), the defender's pact then cannot win.
  m.strength[e] = 50;
  s = startWar(sim, att, f.seats[0]);
  assert.equal(side(e), 0);
  assert.equal(side(c), -1);
  assert.equal(hostile(sim, e, target), true);
  endWar(sim, s, EndType.Exhausted);
  sim.war.truce.fill(0);
  // Allied to the attacker and to the defender: the declaration breaks its alliance with the attacker, and it defends its ally.
  setPact(sim, e, target, Pact.Alliance);
  s = startWar(sim, att, f.seats[0]);
  assert.equal(kindOf(sim, att, e), Pact.None);
  assert.equal(side(e), 1);
  endWar(sim, s, EndType.Exhausted);
  sim.war.truce.fill(0);
  setPact(sim, e, target, Pact.None);
  setPact(sim, att, e, Pact.Alliance);
  // An ally of the attacker never joins against an ally of its own on the other side.
  setPact(sim, e, c, Pact.Alliance);
  setPact(sim, target, c, Pact.Alliance);
  m.strength[c] = 200;
  s = startWar(sim, att, f.seats[0]);
  assert.equal(side(c), 1);
  assert.equal(side(e), -1);
  endWar(sim, s, EndType.Exhausted);
  sim.war.truce.fill(0);
  // The defender's ally joins its partner's attack too (alliances join offensive wars, pacts don't).
  setPact(sim, e, c, Pact.None);
  setPact(sim, att, e, Pact.None);
  setPact(sim, target, d, Pact.Pact);
  m.strength[target] = 200;
  s = startWar(sim, target, sim.civs[att]!.capital);
  assert.ok(s >= 0);
  assert.equal(side(c), 0);
  assert.equal(side(d), -1);
});

test('a people starts a war only when it is in none (as a main party or an ally), but joins many wars as an ally; allies join only at the start', () => {
  const f = blocFixture();
  const { sim, att } = f;
  const target = f.def;
  const [c, x, y] = [f.ally, f.far[0], f.far[1]];
  const m = sim.military;
  m.strength[att] = 100;
  m.strength[target] = 40;
  m.strength[c] = 70;
  m.strength[x] = 10;
  m.strength[y] = 10;
  setPact(sim, target, c, Pact.Alliance);
  setPact(sim, y, c, Pact.Alliance);
  const s1 = startWar(sim, att, f.seats[0]);
  assert.equal(sim.war.side[s1 * PAIRS + c], 1);
  // A second war: c is allied to its defender too and joins it as well.
  const s2 = startWar(sim, x, sim.civs[y]!.capital);
  assert.ok(s2 >= 0);
  assert.equal(sim.war.side[s2 * PAIRS + c], 1);
  assert.equal(sim.war.allyWarsOf[c], 2);
  assert.deepEqual(civWars(sim, c).map((w) => [w.war, w.ally, w.partner]), [[s1, true, target], [s2, true, y]]);
  const info = civWars(sim, target)[0];
  assert.deepEqual([info.enemy, info.ownSide, info.otherSide], [att, [c], [att]]);
  // Fighting as an ally, it starts no war of its own, however strong.
  m.strength[c] = 1e6;
  assert.deepEqual(warTargets(sim, c), []);
  m.strength[c] = 70;
  // An alliance formed during the war does not join it, nor count for its sides.
  const before = sideStrength(sim, s1, 0);
  formAlliance(sim, att, y);
  reviewYear(sim);
  assert.equal(sim.war.side[s1 * PAIRS + y], -1);
  assert.equal(sideStrength(sim, s1, 0), before);
  assert.equal(sideStrength(sim, s1, 1), m.strength[target] + m.strength[c]);
});

/** The war checks of a year alone (no declarations). */
function reviewYear(sim: Simulation): void {
  const chance = WAR.chance;
  try {
    WAR.chance = 0;
    runWarYear(sim);
  } finally {
    WAR.chance = chance;
  }
}

test('in the war only the allies that joined count: the 40 % give-up weighs the sides with them', () => {
  const f = blocFixture();
  const { sim, att } = f;
  const target = f.def;
  const c = f.ally;
  const m = sim.military;
  m.strength[att] = 100;
  m.strength[target] = 30;
  m.strength[c] = 80;
  setPact(sim, target, c, Pact.Pact);
  const s = startWar(sim, att, f.seats[0]);
  assert.equal(sim.war.side[s * PAIRS + c], 1);
  // 100 against 30 + 80: the attacker keeps fighting; at 43.9 (< 40 % of 110) it gives up, though 40 % of the defender alone is 12.
  reviewYear(sim);
  assert.equal(sim.war.wLive[s], 1);
  m.strength[att] = 43.9;
  reviewYear(sim);
  assert.equal(sim.war.wLive[s], 0, 'the attacker gave up');
  assert.equal(sim.war.stats.ended[EndType.AttackerGaveUp], 1);
});

test('an ally sends one army with 50 % of its soldiers from its seat nearest the goal, and relieves the besieged seat of its partner', () => {
  const f = blocFixture();
  const { sim, att } = f;
  const target = f.def;
  const c = f.ally;
  const m = sim.military;
  m.strength[att] = 100;
  m.strength[target] = 40;
  m.strength[c] = 100;
  setPact(sim, target, c, Pact.Alliance);
  const s = startWar(sim, att, f.seats[0]);
  assert.equal(sim.war.side[s * PAIRS + c], 1);
  const mine = armiesOf(sim, c);
  assert.equal(mine.length, 1);
  const a = mine[0];
  assert.equal(sim.war.aCell[a], f.seats[1], 'its only seat');
  ready(sim);
  const sent = armySoldiers(sim.war, a);
  const all = settledOf(sim, c).length * 20;
  assert.ok(sent >= WAR.armyMin && sent <= all * ALLY.send + 1e-9, `${sent} of ${all}`);
  // Raised again the next year: still one army.
  reviewYear(sim);
  assert.equal(armiesOf(sim, c).length, 1);
  // Relief: the attacker besieges the goal; the ally's army reaches it and breaks the siege.
  for (const b of armiesOf(sim, target)) disbandArmy(sim, b);
  const [besieger, ...rest] = armiesOf(sim, att);
  for (const b of rest) disbandArmy(sim, b);
  for (let t = 0; t < TROOP_TYPES; t++) sim.war.aN[besieger * TROOP_TYPES + t] = 0;
  sim.war.aN[besieger * TROOP_TYPES + Troop.Melee] = 5;
  put(sim, besieger, f.seats[0]);
  week(sim);
  assert.ok(sim.war.wSiegeStart[s] >= 0, 'besieged');
  assert.ok(travelCost(sim, s, 1, sim.war.aCell[a]) < Infinity, 'the ally has a way to the goal');
  for (let k = 0; k < 60 && sim.war.wSiegeStart[s] >= 0; k++) week(sim);
  assert.equal(sim.war.wSiegeStart[s], -1, 'the siege is broken');
  assert.ok(sim.war.stats.battles > 0);
});

test('the main parties’ peace ends the war for all: allies go home without land or loot, the winner trusts its allies +10 and the loser’s allies −10', () => {
  const f = blocFixture();
  const { sim, att } = f;
  const target = f.def;
  const c = f.ally;
  const e = f.far[0];
  const m = sim.military;
  const all = [att, target, c, e];
  const peace = (s: number) => {
    assert.equal(sim.war.wLive[s], 0);
    assert.equal(sim.war.wars, 0);
    assert.equal(sim.war.armies, 0);
    for (const p of all) {
      assert.equal(sim.war.side[s * PAIRS + p], -1);
      assert.equal(sim.war.allyWarsOf[p], 0);
      for (const q of all) assert.equal(sim.war.foe[p * PAIRS + q], 0);
    }
  };
  // The defender's ally wins with it: the attacker gives up.
  m.strength[att] = 100;
  m.strength[target] = 40;
  m.strength[c] = 70;
  setPact(sim, target, c, Pact.Pact);
  let s = startWar(sim, att, f.seats[0]);
  assert.equal(sim.war.side[s * PAIRS + c], 1);
  assert.ok(armiesOf(sim, c).length > 0);
  const cLand = settledOf(sim, c).length;
  endWar(sim, s, EndType.AttackerGaveUp);
  peace(s);
  assert.equal(moodOf(sim, target, c, 'Fought at our side'), ALLY.winBonus);
  assert.equal(settledOf(sim, c).length, cLand);
  assert.equal(hostile(sim, c, att), false);
  // The attacker's ally loses with it: the winning defender trusts it 10 less.
  sim.war.truce.fill(0);
  setPact(sim, target, c, Pact.None);
  setPact(sim, att, e, Pact.Alliance);
  m.strength[e] = 30;
  s = startWar(sim, att, f.seats[0]);
  assert.equal(sim.war.side[s * PAIRS + e], 0);
  endWar(sim, s, EndType.AttackerGaveUp);
  peace(s);
  assert.equal(moodOf(sim, target, e, 'Fought against us'), -ALLY.loseLoss);
  // Winning with the attacker: +10 at the attacker; the goal district goes to the attacker alone.
  sim.war.truce.fill(0);
  const eLand = settledOf(sim, e).length;
  s = startWar(sim, att, f.seats[0]);
  assert.equal(sim.war.side[s * PAIRS + e], 0);
  endWar(sim, s, EndType.GaveUp);
  peace(s);
  assert.equal(moodOf(sim, att, e, 'Fought at our side'), ALLY.winBonus);
  assert.equal(sim.world.owner[f.seats[0]], att);
  assert.equal(settledOf(sim, e).length, eLand, 'allies get no land');
});

test('wars with allies run the same for the same seed', () => {
  const run = () => {
    const f = blocFixture();
    const m = f.sim.military;
    m.strength[f.att] = 100;
    m.strength[f.def] = 40;
    m.strength[f.ally] = 70;
    setPact(f.sim, f.def, f.ally, Pact.Alliance);
    startWar(f.sim, f.att, f.seats[0]);
    runYears(f.sim, 4);
    const w = f.sim.war;
    return [Array.from(w.aCell), Array.from(w.aN), Array.from(w.live), Array.from(w.wLive), Array.from(w.pact), Array.from(f.sim.world.owner), f.sim.chronicle.map((e) => e.text)];
  };
  assert.deepEqual(run(), run());
});

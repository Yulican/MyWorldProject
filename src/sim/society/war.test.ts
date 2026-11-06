import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRECTION_COUNT, hexDistance } from '../hex';
import { isWaterBiome } from '../world/biomes';
import { Deposit } from '../world/deposits';
import { generateWorld } from '../world/generate';
import { hasRoad, stepCost } from '../world/roads';
import { BUILDINGS, GOV_SLOT, Good, SLOTS, SlotState } from './buildings';
import { PAIRS } from './diplomacy';
import { updateGovernment } from './government';
import { TROOP_TYPES, Troop } from './military';
import { conqueredValue, hasSeat, satisfactionTerms } from './satisfaction';
import { SUPPLY_KINDS, SupplyKind } from './supply';
import { TICKS_PER_YEAR, changeCiv, createSimulation, foundCivilization, stepSimulation, type Simulation } from './simulation';
import { TRADE_GOODS, updateTradeNeeds } from './trade';
import {
  EndType,
  MAX_ARMIES,
  WAR,
  advanceWar,
  chooseGoal,
  disbandArmy,
  endWar,
  inTruce,
  planMarch,
  runWarYear,
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
function fixture(districts: 1 | 2): Fixture {
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

/** A war of att against the seat `goal`; the defender's armies are sent home. */
function warOn(f: Fixture, goal: number, keepDefenders = false): number {
  const s = startWar(f.sim, f.att, goal);
  assert.ok(s >= 0);
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

test('70 % of the soldiers march, in at most 4 armies per people and 32 in the world', () => {
  const f = fixture(1);
  const { sim, att, def } = f;
  sim.war.armies = MAX_ARMIES - 2; // as if 30 armies marched elsewhere
  const s = startWar(sim, att, f.seats[0]);
  assert.ok(armiesOf(sim, att).length <= 1 && armiesOf(sim, def).length <= 1, 'only room for one army each');
  endWar(sim, s, EndType.Exhausted);
  sim.war.truce.fill(0);
  sim.war.armies = MAX_ARMIES - 1;
  const chance = WAR.chance;
  try {
    WAR.chance = 1;
    runWarYear(sim);
  } finally {
    WAR.chance = chance;
  }
  assert.equal(sim.war.wars, 0, 'no room for two armies: no declaration');
  assert.ok(sim.war.stats.capBlocked >= 1);
  sim.war.armies = 0;

  const s2 = startWar(sim, att, f.seats[0]);
  assert.equal(armiesOf(sim, att).length, 4);
  for (const c of settledOf(sim, att)) assert.equal(sim.war.away[c * TROOP_TYPES + Troop.Melee], 7);
  for (const c of settledOf(sim, def)) assert.equal(sim.war.away[c * TROOP_TYPES + Troop.Melee], 5);
  let marching = 0;
  for (const a of armiesOf(sim, att)) marching += sim.war.aN[a * TROOP_TYPES + Troop.Melee];
  assert.equal(marching, 7 * settledOf(sim, att).length);
  // Raising again next year keeps to the caps and to 70 %.
  runWarYear(sim);
  assert.ok(sim.war.wLive[s2]);
  assert.equal(armiesOf(sim, att).length, 4);
  for (const c of settledOf(sim, att)) assert.equal(sim.war.away[c * TROOP_TYPES + Troop.Melee], 7);
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
    assert.ok(!sim.war.live[a] || !sim.war.live[b], 'the loser leaves the field');
    if (sim.war.live[a]) assert.equal(sim.war.aCell[a], next);
  }
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

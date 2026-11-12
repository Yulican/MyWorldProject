import { DIRECTION_COUNT } from '../hex';
import { hasRoad } from '../world/roads';
import { BIOMES } from '../world/biomes';
import { hasSeat } from './satisfaction';
import { MIL, TROOP_TYPES, Troop } from './military';
import { Pact } from './pacts';
import { PAIRS } from './diplomacy';
import { WAR, MAX_GOALS, MAX_WARS, startRebelWar } from './war';
import { BELIEVER_FAITH, UPRISING_HOOK, changeCiv, drawSoldiers, foundCivilization, record, type Simulation } from './simulation';

// War phase 5a + 5b: uprisings as war ("Design Documents/Requirement
// Krieg.md", section 8; "Requirement Zufriedenheit.md", Abspaltung).
//
// Once a year (war.ts: runWarYearStep, one realm per step) every realm with
// dissatisfied settlements is checked: a settlement is dissatisfied when its
// satisfaction is below 0 (never the capital, no years, no size). All of a
// realm's dissatisfied settlements rebel together, without a roll, when their
// strength (the soldiers there plus a militia of WAR.militia of their people,
// melee without the strategic factor) is greater than the mother's (her
// strength without those soldiers, plus her pact and alliance partners').
// At the declaration they become independent peoples, one per group of
// rebel settlements joined by roads (at most MAX_GOALS, the largest), allied
// with each other; war.ts (startRebelWar) runs the war. A people in a
// running rebellion (on either side) sees no other rebellion.
//
// Cut-off land still splits off directly (simulation.ts: splitCutOffLand).
// Everything is in flat arrays by cell or people, grown with the map;
// the declaration allocates nothing but the chronicle's strings.

/** Scratch by cell: 1 for a settlement of the realm checked that rebels, its group, the groups' cells in order and their people. */
let flag = new Uint8Array(0);
let groupOf = new Int32Array(0);
let order = new Int32Array(0);
let groupStart = new Int32Array(0);
let groupPeople = new Float64Array(0);
/** Peoples in a running rebellion (either side). */
const busy = new Uint8Array(PAIRS);
/** The chosen groups (index into groupStart, largest first; MAX_GOALS, made on first use as war.ts imports this module). */
let chosen = new Int32Array(0);

/** The last check's numbers (measureRebellion): the rebels' strength (soldiers + militia), their soldiers' strength and militia, the mother's side. */
export const REBEL_CHECK = { rebels: 0, soldiers: 0, militia: 0, mother: 0, settlements: 0 };

function ensureScratch(n: number): void {
  if (chosen.length === 0) chosen = new Int32Array(MAX_GOALS);
  if (flag.length === n) return;
  flag = new Uint8Array(n);
  groupOf = new Int32Array(n);
  order = new Int32Array(n);
  groupStart = new Int32Array(n + 1);
  groupPeople = new Float64Array(n);
}

/** Strength of the soldiers in one cell (the strategic factor where they are covered; militia without it). */
function cellStrength(sim: Simulation, c: number): number {
  const m = sim.military;
  let sum = 0;
  for (let t = 0; t < TROOP_TYPES; t++) {
    const i = c * TROOP_TYPES + t;
    const militia = t === Troop.Melee ? Math.min(sim.war.militia[c], m.soldiers[i]) : 0;
    sum += (m.soldiers[i] - militia) * (m.covered[i] ? MIL.factor : 1) + militia;
  }
  return sum;
}

/** Militia a settlement raises at a rebellion: WAR.militia of its people, at most its adults. */
export function militiaOf(sim: Simulation, c: number): number {
  return Math.max(0, Math.min(Math.floor(WAR.militia * sim.cellPop[c]), sim.cellAdults[c]));
}

/** Whether settlement `c` of people `civ` is dissatisfied in the sense of a rebellion (satisfaction below 0, not the capital). */
export function isDissatisfied(sim: Simulation, c: number, civ: number): boolean {
  return civ !== 0 && sim.cellPop[c] > 0 && sim.satisfaction[c] < 0 && sim.civs[civ]?.capital !== c;
}

/** Marks in `busy` the peoples on either side of a running rebellion. */
function markBusy(sim: Simulation): void {
  const w = sim.war;
  busy.fill(0);
  for (let s = 0; s < MAX_WARS; s++) {
    if (!w.wLive[s] || !w.wRebel[s]) continue;
    for (let p = 1; p < PAIRS; p++) if (w.side[s * PAIRS + p] >= 0) busy[p] = 1;
  }
}

/** Whether people `civ` is on either side of a running rebellion (its settlements can't rebel). */
export function inRebellion(sim: Simulation, civ: number): boolean {
  markBusy(sim);
  return busy[civ] === 1;
}

/** The war's year, first step: each people's dissatisfied settlements (war.restless), none for peoples in a rebellion. */
export function countRestless(sim: Simulation): void {
  const w = sim.war;
  const owner = sim.world.owner;
  w.restless.fill(0);
  markBusy(sim);
  for (let c = 0; c < sim.world.cellCount; c++) {
    const civ = owner[c];
    if (busy[civ] || !isDissatisfied(sim, c, civ)) continue;
    if (w.restless[civ] < 65535) w.restless[civ]++;
  }
}

/** Flags the settlements of `mother` that rebel: the dissatisfied ones, or with `all` every one but the capital. Returns their number. */
function markRebels(sim: Simulation, mother: number, all: boolean): number {
  const n = sim.world.cellCount;
  ensureScratch(n);
  const owner = sim.world.owner;
  const capital = sim.civs[mother]?.capital ?? -1;
  let count = 0;
  for (let c = 0; c < n; c++) {
    const yes = owner[c] === mother && (all ? sim.cellPop[c] > 0 && c !== capital : isDissatisfied(sim, c, mother));
    flag[c] = yes ? 1 : 0;
    if (yes) count++;
  }
  return count;
}

/** Fills REBEL_CHECK for the flagged settlements of `mother`; true if the rebels are the stronger. */
function measureFlagged(sim: Simulation, mother: number, count: number): boolean {
  const w = sim.war;
  const m = sim.military;
  const n = sim.world.cellCount;
  let soldiers = 0;
  let militia = 0;
  for (let c = 0; c < n; c++) {
    if (!flag[c]) continue;
    soldiers += cellStrength(sim, c);
    militia += militiaOf(sim, c);
  }
  let motherStr = Math.max(0, (mother < m.strength.length ? m.strength[mother] : 0) - soldiers);
  for (let p = 1; p <= sim.diplomacy.maxId; p++) {
    if (p !== mother && sim.civs[p] && w.pact[mother * PAIRS + p] !== Pact.None && p < m.strength.length) motherStr += m.strength[p];
  }
  REBEL_CHECK.rebels = soldiers + militia;
  REBEL_CHECK.soldiers = soldiers;
  REBEL_CHECK.militia = militia;
  REBEL_CHECK.mother = motherStr;
  REBEL_CHECK.settlements = count;
  return count > 0 && REBEL_CHECK.rebels > motherStr;
}

/** The strengths of a rebellion of `mother`'s dissatisfied settlements now (REBEL_CHECK); true if they would rebel. */
export function measureRebellion(sim: Simulation, mother: number): boolean {
  return measureFlagged(sim, mother, markRebels(sim, mother, false));
}

/**
 * The yearly check of realm `mother` (war.ts: one step each): its
 * dissatisfied settlements rebel if they are the stronger and the realm is in
 * no rebellion. True if a rebellion began; its declaration goes on in the
 * next steps of the war's year (continueRebellion).
 */
export function checkRebellion(sim: Simulation, mother: number): boolean {
  if (!sim.civs[mother] || sim.war.rebelStage !== 0 || inRebellion(sim, mother)) return false;
  const count = markRebels(sim, mother, false);
  if (!measureFlagged(sim, mother, count)) return false;
  return prepareRebels(sim, mother);
}

/**
 * Starts a rebellion in realm `mother` at once, without the strength check
 * (the benchmark, tests): its dissatisfied settlements rise, with `all` every
 * settlement but the capital. The armies are raised at once. Returns the war
 * slot, -1 if none began (no settlement, no free war slot or people id, the
 * realm in a rebellion already).
 */
export function startRebellion(sim: Simulation, mother: number, all = false): number {
  const w = sim.war;
  if (!sim.civs[mother] || sim.war.rebelStage !== 0 || inRebellion(sim, mother)) return -1;
  const count = markRebels(sim, mother, all);
  if (count === 0) return -1;
  measureFlagged(sim, mother, count);
  if (!prepareRebels(sim, mother)) return -1;
  while (w.rebelStage !== 0 && w.rebelStage !== 3) continueRebellion(sim);
  return continueRebellion(sim, false);
}

/** Grows the military's per-people arrays to the people slots (a new people may have taken a new id). */
function ensureMilitary(sim: Simulation): void {
  const m = sim.military;
  if (m.strength.length === sim.civSlots) return;
  const strength = new Float64Array(sim.civSlots);
  strength.set(m.strength.subarray(0, Math.min(m.strength.length, sim.civSlots)));
  const soldiersOf = new Float64Array(sim.civSlots * TROOP_TYPES);
  soldiersOf.set(m.soldiersOf.subarray(0, Math.min(m.soldiersOf.length, soldiersOf.length)));
  const afford = new Float64Array(sim.civSlots);
  afford.set(m.civAfford.subarray(0, Math.min(m.civAfford.length, sim.civSlots)));
  m.strength = strength;
  m.soldiersOf = soldiersOf;
  m.civAfford = afford;
}

/** Groups the flagged settlements of `mother` by roads (groupOf, order, groupStart, groupPeople); returns the number of groups. */
function groupRebels(sim: Simulation, mother: number): number {
  const world = sim.world;
  const n = world.cellCount;
  const owner = world.owner;
  groupOf.fill(-1);
  let groups = 0;
  let end = 0;
  for (let c = 0; c < n; c++) {
    if (!flag[c] || groupOf[c] >= 0) continue;
    groupStart[groups] = end;
    groupOf[c] = groups;
    order[end++] = c;
    let people = 0;
    for (let k = groupStart[groups]; k < end; k++) {
      const x = order[k];
      people += sim.cellPop[x];
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        if (!hasRoad(world, x, d)) continue;
        const nb = world.neighbors[x * DIRECTION_COUNT + d];
        if (nb < 0 || !flag[nb] || owner[nb] !== mother || groupOf[nb] >= 0) continue;
        groupOf[nb] = groups;
        order[end++] = nb;
      }
    }
    groupPeople[groups] = people;
    groups++;
  }
  groupStart[groups] = end;
  return groups;
}

/** The capital of group `g`: its seat of government with the most people, else its most populous settlement (ties: the lower cell). */
function groupCapital(sim: Simulation, g: number): number {
  let seat = -1;
  let big = -1;
  for (let k = groupStart[g]; k < groupStart[g + 1]; k++) {
    const c = order[k];
    if (sim.cellPop[c] === 0) continue;
    if (big < 0 || sim.cellPop[c] > sim.cellPop[big]) big = c;
    if (sim.hasBuildings[c] && hasSeat(sim.economy, c) && (seat < 0 || sim.cellPop[c] > sim.cellPop[seat])) seat = c;
  }
  return seat >= 0 ? seat : big;
}

/**
 * The declaration begins: the flagged settlements of `mother` form their
 * road-joined groups; the MAX_GOALS largest (the others stay) get their
 * capitals and are marked in war.rebelTo. continueRebellion does the rest,
 * in the war's year one step each: a new people per group, the change of
 * sides, the war. False if none can begin (no free war slot).
 */
function prepareRebels(sim: Simulation, mother: number): boolean {
  const w = sim.war;
  let free = false;
  for (let s = 0; s < MAX_WARS; s++) if (!w.wLive[s]) free = true;
  if (!free) return false;
  const groups = groupRebels(sim, mother);
  // The largest groups first (ties: the group of the lower first cell).
  let pick = 0;
  for (; pick < MAX_GOALS && pick < groups; pick++) {
    let best = -1;
    for (let g = 0; g < groups; g++) {
      let taken = false;
      for (let i = 0; i < pick; i++) if (chosen[i] === g) taken = true;
      if (!taken && (best < 0 || groupPeople[g] > groupPeople[best])) best = g;
    }
    chosen[pick] = best;
  }
  w.rebelTo.fill(0);
  let count = 0;
  for (let i = 0; i < pick; i++) {
    const g = chosen[i];
    const capital = groupCapital(sim, g);
    if (capital < 0) continue;
    w.rebelSeats[count] = capital;
    w.rebelCells[count] = groupStart[g + 1] - groupStart[g];
    w.rebelCivs[count] = 0;
    count++;
    for (let k = groupStart[g]; k < groupStart[g + 1]; k++) w.rebelTo[order[k]] = count;
  }
  if (count === 0) return false;
  w.rebelOf = mother;
  w.rebelPicked = count;
  w.rebelCount = 0;
  w.rebelStage = 1;
  return true;
}

/** Founds the people of the next rebel group (rebelCount); false if no id is free (the groups left stay with the mother). */
function foundNextRebels(sim: Simulation): boolean {
  const w = sim.war;
  const world = sim.world;
  const k = w.rebelCount;
  const parent = sim.civs[w.rebelOf]!;
  const capital = w.rebelSeats[k];
  const civ = foundCivilization(sim, 'revolution', capital, parent);
  if (!civ) {
    w.stats.rebNoRoom++;
    return false;
  }
  w.rebelCivs[k] = civ.id;
  w.rebelCount++;
  if (UPRISING_HOOK.fn) {
    const cells: number[] = [];
    for (let c = 0; c < world.cellCount; c++) if (w.rebelTo[c] === k + 1) cells.push(c);
    UPRISING_HOOK.fn(sim, cells, w.rebelOf);
  }
  const n = w.rebelCells[k];
  const who = n === 1 ? 'a settlement' : `${n} settlements`;
  record(sim, `Rebellion: ${who} in the ${BIOMES[world.biome[capital]].name.toLowerCase()} rose up against the ${parent.name} and became the ${civ.name}.`, capital, true);
  return true;
}

/**
 * The next step of the declaration under way (war.rebelStage): 1 the next
 * rebel group becomes a people; 2 the rebel settlements change sides with
 * their people and soldiers and raise their militia; 3 the war begins, its
 * armies raised in the next steps of the war's year (with `later`) or at
 * once. Returns the war slot after step 3, else -1.
 */
export function continueRebellion(sim: Simulation, later = true): number {
  const w = sim.war;
  if (w.rebelStage === 1) {
    const ok = foundNextRebels(sim);
    if (ok && w.rebelCount < w.rebelPicked) return -1;
    // No id left: only the groups founded so far rise.
    w.rebelStage = w.rebelCount > 0 ? 2 : 0;
    return -1;
  }
  if (w.rebelStage === 2) {
    moveRebels(sim);
    w.rebelStage = 3;
    return -1;
  }
  if (w.rebelStage !== 3) return -1;
  w.rebelStage = 0;
  return startRebelWar(sim, w.rebelOf, w.rebelCivs, w.rebelSeats, w.rebelCount, later);
}

/** Step 2: the settlements in war.rebelTo go to their new peoples with people and soldiers; each raises its militia. */
function moveRebels(sim: Simulation): void {
  const w = sim.war;
  const m = sim.military;
  const n = sim.world.cellCount;
  const owner = sim.world.owner;
  const mother = w.rebelOf;
  const parent = sim.civs[mother]!;
  const to = w.rebelTo;
  // Groups not founded (no id left) stay.
  for (let c = 0; c < n; c++) if (to[c] > w.rebelCount) to[c] = 0;
  ensureMilitary(sim);
  const pop = sim.pop;
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i] || pop.civ[i] !== mother) continue;
    const g = to[pop.cell[i]];
    if (g === 0) continue;
    const civ = w.rebelCivs[g - 1];
    if (pop.faith[i] >= BELIEVER_FAITH) parent.faithYear.brokeAway++;
    changeCiv(sim, i, civ);
  }
  const st = w.stats;
  let rebelSoldiers = 0;
  let raised = 0;
  for (let i = 0; i < w.rebelCount; i++) m.strength[w.rebelCivs[i]] = 0;
  for (let c = 0; c < n; c++) {
    if (to[c] === 0) continue;
    const civ = w.rebelCivs[to[c] - 1];
    rebelSoldiers += cellStrength(sim, c);
    owner[c] = civ;
    sim.unhappyQuarters[c] = 0;
    st.rebPeople += sim.cellPop[c];
    st.rebSettlements++;
    if (w.rebCount[c] > 0) st.rebCellRepeat++;
    if (w.rebCount[c] < 255) w.rebCount[c]++;
    // Militia: adults become melee soldiers (no building, no pay, no strategic factor).
    const k = militiaOf(sim, c);
    if (k > 0) {
      m.soldiers[c * TROOP_TYPES + Troop.Melee] += k;
      m.train[c] += k;
      w.militia[c] = Math.min(65535, w.militia[c] + k);
      raised += k;
    }
    m.strength[civ] += cellStrength(sim, c);
  }
  drawSoldiers(sim);
  st.militia += raised;
  // The mother's strength without the rebels' soldiers (the yearly military update counts them next year).
  m.strength[mother] = Math.max(0, m.strength[mother] - rebelSoldiers);
  st.rebDeclared++;
  st.rebRatioSum += REBEL_CHECK.rebels > 0 ? Math.min(5, REBEL_CHECK.mother / REBEL_CHECK.rebels) : 0;
  st.rebGroups += w.rebelCount;
  if (w.rebLast[mother] > 0 && sim.tick - w.rebLast[mother] < WAR.chainYears * 52) st.rebRepeat++;
  w.rebLast[mother] = sim.tick;
  if (w.rebTimes[mother] < 255) w.rebTimes[mother]++;
  if (w.rebTimes[mother] > st.rebMaxRealm) st.rebMaxRealm = w.rebTimes[mother];
}

import { DIRECTION_COUNT } from '../hex';
import { hasRoad } from '../world/roads';
import { BIOMES } from '../world/biomes';
import { hasSeat } from './satisfaction';
import { MIL, TROOP_TYPES, Troop } from './military';
import { Pact } from './pacts';
import { WAR, MAX_GOALS, MAX_WARS, startRebelWar } from './war';
import { BELIEVER_FAITH, changeCiv, drawSoldiers, foundCivilization, mostPopulousCell, record, type Simulation } from './simulation';

// War phase 5 PROTOTYPE ("Design Documents/Requirement Krieg.md", section 8):
// uprisings as war. Once a year (war.ts: the first step of the war's year)
// every realm is checked: its dissatisfied settlements (satisfaction below 0,
// never the capital, not in a rebel war already) all rebel together when
// their strength (soldiers there plus militia, WAR.militia of their people as
// melee) is greater than the mother's (her soldiers elsewhere plus her pacts'
// and alliances' strengths). At the declaration they become independent
// peoples, one per road-connected group, allied with each other; war.ts
// (startRebelWar) runs the war. Off by default (WAR.rebel = 0: the direct
// breakaway of simulation.ts stays).

const PAIRS = 256;
const rebel = new Uint8Array(0);
let flag = rebel;
let groupOf = new Int16Array(0);
let newCiv = new Int16Array(0);
const counts = new Int32Array(PAIRS);

/** Strength of the soldiers in one cell (the strategic factor where they are covered). */
function cellStrength(sim: Simulation, c: number): number {
  const m = sim.military;
  let sum = 0;
  for (let t = 0; t < TROOP_TYPES; t++) sum += m.soldiers[c * TROOP_TYPES + t] * (m.covered[c * TROOP_TYPES + t] ? MIL.factor : 1);
  return sum;
}

/** Militia a settlement raises: WAR.militia of its people, at most its adults. */
function militiaOf(sim: Simulation, c: number): number {
  return Math.min(Math.floor(WAR.militia * sim.cellPop[c]), sim.cellAdults[c]);
}

/** A people in a rebel war (as mother or rebel group) can't see another rebellion. */
function busy(sim: Simulation, civ: number): boolean {
  return sim.war.motherBusy[civ] > 0 || sim.war.rebelMother[civ] !== 0;
}

/** Grows the military's per-people arrays to the people slots (a new people may have taken a new id). */
function ensureMilitary(sim: Simulation): void {
  const m = sim.military;
  if (m.strength.length === sim.civSlots) return;
  const strength = new Float64Array(sim.civSlots);
  strength.set(m.strength);
  const soldiersOf = new Float64Array(sim.civSlots * TROOP_TYPES);
  soldiersOf.set(m.soldiersOf);
  const afford = new Float64Array(sim.civSlots);
  afford.set(m.civAfford);
  m.strength = strength;
  m.soldiersOf = soldiersOf;
  m.civAfford = afford;
}

/** The yearly rebellion check (WAR.rebel): which realms' dissatisfied settlements rise now. */
export function checkRebellions(sim: Simulation): void {
  if (!WAR.rebel) return;
  const w = sim.war;
  const world = sim.world;
  const n = world.cellCount;
  const owner = world.owner;
  if (flag.length !== n) {
    flag = new Uint8Array(n);
    groupOf = new Int16Array(n);
    newCiv = new Int16Array(n);
  }
  counts.fill(0);
  let any = false;
  for (let c = 0; c < n; c++) {
    flag[c] = 0;
    const civ = owner[c];
    if (civ === 0 || sim.cellPop[c] === 0 || sim.satisfaction[c] >= 0 || sim.civs[civ]?.capital === c || busy(sim, civ)) continue;
    flag[c] = 1;
    counts[civ]++;
    any = true;
  }
  if (!any) return;
  for (let civ = 1; civ < sim.civs.length; civ++) {
    if (counts[civ] === 0 || !sim.civs[civ]) continue;
    rebelRealm(sim, civ);
  }
  void w;
}

function rebelRealm(sim: Simulation, mother: number): void {
  const w = sim.war;
  const world = sim.world;
  const m = sim.military;
  const n = world.cellCount;
  const owner = world.owner;
  // Strength: the rebels' soldiers and militia against the mother's other soldiers and her partners.
  let rebelStr = 0;
  let rebelSoldiers = 0;
  for (let c = 0; c < n; c++) {
    if (!flag[c] || owner[c] !== mother) continue;
    const sc = cellStrength(sim, c);
    rebelSoldiers += sc;
    rebelStr += sc + militiaOf(sim, c);
  }
  let motherStr = Math.max(0, (m.strength[mother] ?? 0) - rebelSoldiers);
  for (let p = 1; p <= sim.diplomacy.maxId; p++) {
    if (p !== mother && sim.civs[p] && w.pact[mother * PAIRS + p] !== Pact.None) motherStr += m.strength[p] ?? 0;
  }
  if (rebelStr <= motherStr) return;
  // Groups: the rebel settlements joined by roads.
  groupOf.fill(-1);
  const groups: number[][] = [];
  for (let c = 0; c < n; c++) {
    if (!flag[c] || owner[c] !== mother || groupOf[c] >= 0) continue;
    const cells = [c];
    groupOf[c] = groups.length;
    for (let k = 0; k < cells.length; k++) {
      const x = cells[k];
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        if (!hasRoad(world, x, d)) continue;
        const nb = world.neighbors[x * DIRECTION_COUNT + d];
        if (nb < 0 || !flag[nb] || owner[nb] !== mother || groupOf[nb] >= 0) continue;
        groupOf[nb] = groups.length;
        cells.push(nb);
      }
    }
    groups.push(cells);
  }
  const people = (cells: number[]) => cells.reduce((sum, c) => sum + sim.cellPop[c], 0);
  groups.sort((a, b) => people(b) - people(a) || a[0] - b[0]);
  if (groups.length > MAX_GOALS) groups.length = MAX_GOALS;
  // A free war slot first.
  let free = false;
  for (let s = 0; s < MAX_WARS; s++) if (!w.wLive[s]) free = true;
  if (!free) return;
  const parent = sim.civs[mother]!;
  const founded: number[] = [];
  const goals: number[] = [];
  const keptGroups: number[][] = [];
  newCiv.fill(0);
  for (const cells of groups) {
    const inGroup = new Uint8Array(n);
    for (const c of cells) inGroup[c] = 1;
    let capital = -1;
    for (const c of cells) if (sim.hasBuildings[c] && hasSeat(sim.economy, c) && (capital < 0 || sim.cellPop[c] > sim.cellPop[capital])) capital = c;
    if (capital < 0) capital = mostPopulousCell(sim, mother, inGroup);
    if (capital < 0) continue;
    const civ = foundCivilization(sim, 'revolution', capital, parent);
    if (!civ) {
      w.stats.rebNoRoom++;
      break;
    }
    founded.push(civ.id);
    goals.push(capital);
    keptGroups.push(cells);
    for (const c of cells) newCiv[c] = civ.id;
  }
  if (founded.length === 0) return;
  ensureMilitary(sim);
  // The settlements change their people; their soldiers go with them.
  const pop = sim.pop;
  for (let i = 0; i < pop.end; i++) {
    if (!pop.alive[i] || pop.civ[i] !== mother) continue;
    const to = newCiv[pop.cell[i]];
    if (to === 0) continue;
    if (pop.faith[i] >= BELIEVER_FAITH) parent.faithYear.brokeAway++;
    changeCiv(sim, i, to);
  }
  const st = w.stats;
  let totalPeople = 0;
  let totalCells = 0;
  for (let g = 0; g < keptGroups.length; g++) {
    for (const c of keptGroups[g]) {
      owner[c] = founded[g];
      sim.unhappyQuarters[c] = 0;
      totalPeople += sim.cellPop[c];
      totalCells++;
      if (w.rebCount[c] > 0) st.rebCellRepeat++;
      if (w.rebCount[c] < 255) w.rebCount[c]++;
      // Their soldiers are theirs now; pending contingents and soldiers away stay with the mother's armies' bookkeeping (reconcileWar).
      for (let t = 0; t < TROOP_TYPES; t++) w.away[c * TROOP_TYPES + t] = 0;
      w.cArmy[c] = -1;
      w.pend.fill(0, c * TROOP_TYPES, c * TROOP_TYPES + TROOP_TYPES);
    }
  }
  // Militia: adults become melee soldiers (they need no building and get no pay).
  let raised = 0;
  for (const cells of keptGroups) {
    for (const c of cells) {
      const k = militiaOf(sim, c);
      if (k <= 0) continue;
      m.soldiers[c * TROOP_TYPES + Troop.Melee] += k;
      m.train[c] += k;
      w.militia[c] += k;
      raised += k;
    }
  }
  drawSoldiers(sim);
  st.militia += raised;
  // Strengths now (the yearly military update only counts them next year).
  for (let g = 0; g < keptGroups.length; g++) {
    let str = 0;
    for (const c of keptGroups[g]) str += cellStrength(sim, c);
    m.strength[founded[g]] = str;
  }
  m.strength[mother] = Math.max(0, (m.strength[mother] ?? 0) - rebelSoldiers);
  // Statistics: chains in the same realm.
  st.rebDeclared++;
  if (motherStr < 0.4 * rebelStr) st.rebWeakMother++;
  st.rebRatioSum += rebelStr > 0 ? Math.min(5, motherStr / rebelStr) : 0;
  st.rebGroups += founded.length;
  st.rebSettlements += totalCells;
  st.rebPeople += totalPeople;
  if (w.rebLast[mother] > 0 && sim.tick - w.rebLast[mother] < WAR.chainYears * 52) st.rebRepeat++;
  w.rebLast[mother] = sim.tick;
  if (w.rebTimes[mother] < 255) w.rebTimes[mother]++;
  if (w.rebTimes[mother] > st.rebMaxRealm) st.rebMaxRealm = w.rebTimes[mother];
  for (let g = 0; g < founded.length; g++) {
    const civ = sim.civs[founded[g]]!;
    const cells = keptGroups[g];
    const who = cells.length === 1 ? 'A settlement' : `${cells.length} settlements`;
    record(sim, `${who} in the ${BIOMES[world.biome[goals[g]]].name.toLowerCase()} rose up against the ${parent.name} and became the ${civ.name}.`, goals[g]);
  }
  startRebelWar(sim, mother, founded, goals);
}

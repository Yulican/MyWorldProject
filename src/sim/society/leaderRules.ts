import { DIRECTION_COUNT } from '../hex';
import { PAIRS } from './diplomacy';
import { capacityAfterRepair, isSettlementTarget } from './economy';
import { EVENTS, Ev, Goal, L, LEADER, MUTE, TRADE_HISTORY, LEADER_CIVS, LEVERS, LEVER_KIND, MEASURES, M, clearLeader, type TermRecord } from './leaders';
import type { Simulation } from './simulation';
import { WAR } from './war';

// Leaders (measuring prototype, "Design Documents/Requirement Anführer.md"): the yearly rules. A leader per
// people with up to 3 attributes and 1 goal; each year: age, death and succession, experiences, the 2nd
// attribute after LEADER.secondYears, goal completion with the 3rd attribute, and the lever set the
// decisions read (leaders.ts). Runs only with LEADER.enabled = 1; without it the yearly pass only measures.
// The random numbers come from `sim.leaders.rng` (its own sequence), never from the simulation's.

/** One effect: lever index and value (a deviation; mutable only so tools/leaderStats.ts can try other numbers). */
export type Effect = [lever: number, value: number];

/** The 25 attributes, index 1..25 (Requirement section 4); effects are deviations from the base values. */
export const ATTRS: { name: string; fx: Effect[] }[] = [
  { name: '', fx: [] },
  { name: 'Warmonger', fx: [[L.warChance, 0.2], [L.sendShare, 0.15], [L.popShare, 0.05], [L.trainShare, 0.1], [L.sat, -2]] },
  { name: 'Pacifist', fx: [[L.neverWar, 1], [L.openTrust, -10], [L.giveUp, 0.15]] },
  { name: 'Cautious Strategist', fx: [[L.ratio, 1], [L.warChanceMul, 0.8], [L.lossTaken, 0.75], [L.sat, 1]] },
  { name: 'Stubborn', fx: [[L.giveUp, -0.4], [L.occupy, 1.5], [L.satWar, -3]] },
  { name: 'Craven', fx: [[L.sendShare, -0.3], [L.sold, 0.7], [L.giveUp, 0.2]] },
  { name: 'Drillmaster', fx: [[L.strength, 1.25], [L.sold, 1.3]] },
  { name: 'Silver Tongue', fx: [[L.trust, 10], [L.trustBase, 5]] },
  { name: 'Xenophobe', fx: [[L.openDanger, -15], [L.closeDanger, -15], [L.tollAsk, 3], [L.defExtra, 0.25]] },
  { name: 'Oathkeeper', fx: [[L.allyTrust, -15], [L.pactTrust, -10], [L.oath, 1]] },
  { name: 'Opportunist', fx: [[L.ratioBusy, -0.8], [L.ratioCalm, 0.5]] },
  { name: 'Grudge-bearer', fx: [[L.revenge, 2], [L.truce, -10], [L.warTrust, -30]] },
  { name: 'Merchant Prince', fx: [[L.load, 1.5], [L.centerMin, 0.533], [L.lossTrade, 0.5], [L.tollPay, 0.5], [L.income, 0.1]] },
  { name: 'Generous', fx: [[L.margin, 7], [L.sat, 4]] },
  { name: 'Tax Hawk', fx: [[L.margin, -5], [L.income, 0.15], [L.sat, -3]] },
  { name: 'Builder', fx: [[L.buildCost, 0.7], [L.buildTime, 0.7], [L.buildFrom, -0.2], [L.govUpkeep, 1.2]] },
  { name: 'Frugal', fx: [[L.upkeepAll, 0.7], [L.income, -0.15], [L.buildFrom, 0.1]] },
  { name: 'Prospector', fx: [[L.harvest, 1.5]] },
  { name: 'Pioneer', fx: [[L.travel, 0.7], [L.settleOver, 0.95], [L.sat, -2]] },
  { name: 'Homebody', fx: [[L.travel, 1.5], [L.sat, 3]] },
  { name: 'Beloved', fx: [[L.sat, 5]] },
  { name: 'Tyrant', fx: [[L.sat, -6], [L.rebel, 2]] },
  { name: 'Iron Fist', fx: [[L.rebel, 1.5], [L.sat, -2], [L.sold, 1.1]] },
  { name: 'Weak Hand', fx: [[L.rebel, 0.6], [L.sat, 3]] },
  { name: 'Devout', fx: [[L.sat, 3], [L.birth, 1.1], [L.devotion, 0.05]] },
  { name: 'Road Builder', fx: [[L.tripRange, 1.3], [L.sat, 3]] },
];
export const ATTR_COUNT = 25;

/** The goals' effects while active (halved by LEADER.goalHalf once reached): index Goal. */
export const GOAL_FX: Effect[][] = [
  [],
  [[L.settleOver, 0.98], [L.warPop, 1.5], [L.buildFrom, -0.1]],
  [[L.tradeTrust, -5], [L.income, 0.1]],
  [[L.warChanceMul, 0.5], [L.pactTrust, -10], [L.threat, -15], [L.strength, 1.1]],
  [[L.warChanceMul, 1.5], [L.ratio, -0.5], [L.satGlory, 2]],
];

/** Pairs that exclude each other (Requirement section 4), and attribute / goal pairs (section 5). */
const EXCLUDE_PAIRS = [[1, 2], [1, 3], [2, 4], [4, 5], [7, 8], [13, 14], [15, 16], [18, 19], [20, 21], [21, 23], [22, 23], [8, 12], [2, 11]];
const excludes = new Uint8Array(26 * 26);
for (const [a, b] of EXCLUDE_PAIRS) {
  excludes[a * 26 + b] = 1;
  excludes[b * 26 + a] = 1;
}
/** Attributes taken out of the game (never drawn or inherited); none at the moment. */
const REMOVED = new Uint8Array(26);
const PACIFIST = 2;
const HOMEBODY = 19;
/** Whether attribute `a` may not go with goal `g`. */
function goalExcludes(g: number, a: number): boolean {
  return (g === Goal.Glory && a === PACIFIST) || (g === Goal.Expansion && a === HOMEBODY);
}

/** Attributes an experience can bring (Requirement section 4), by Ev. */
const FROM_EXPERIENCE: readonly (readonly number[])[] = [
  [1, 6, 10, 4],
  [2, 3, 5, 11],
  [22, 23, 20, 21],
  [16, 14, 13, 19],
  [12, 15, 17, 7, 25],
  [9, 7, 10],
  [8, 11, 3],
  [18, 15, 17, 25],
  [2, 12, 20, 13],
];

// ---------------------------------------------------------------------------
// Scratch (one yearly pass)

const adj = new Uint8Array(PAIRS * PAIRS);
const cSettle = new Int32Array(LEADER_CIVS);
const cNeg = new Int32Array(LEADER_CIVS);
const cSat = new Float64Array(LEADER_CIVS);
const cDeals = new Int32Array(LEADER_CIVS);
const cPacts = new Int32Array(LEADER_CIVS);
const cOpen = new Int32Array(LEADER_CIVS);
const cKnown = new Int32Array(LEADER_CIVS);
const mark = new Uint8Array(1 << 16);
const add = new Float64Array(LEVERS);
const mul = new Float64Array(LEVERS);

function collect(sim: Simulation): void {
  const w = sim.world;
  adj.fill(0);
  cSettle.fill(0);
  cNeg.fill(0);
  cSat.fill(0);
  for (let c = 0; c < w.cellCount; c++) {
    const a = w.owner[c];
    if (a === 0 || sim.cellPop[c] === 0) continue;
    cSettle[a]++;
    cSat[a] += sim.satisfaction[c];
    if (sim.satisfaction[c] < 0) cNeg[a]++;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = w.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0) continue;
      const b = w.owner[nb];
      if (b !== 0 && b !== a && sim.cellPop[nb] > 0) adj[a * PAIRS + b] = 1;
    }
  }
  const dip = sim.diplomacy;
  cDeals.fill(0);
  cPacts.fill(0);
  cOpen.fill(0);
  cKnown.fill(0);
  for (const t of dip.agreements) {
    cDeals[t.a]++;
    cDeals[t.b]++;
  }
  for (let a = 1; a <= dip.maxId; a++) {
    if (!sim.civs[a]) continue;
    for (let b = 1; b <= dip.maxId; b++) {
      if (a === b || !sim.civs[b]) continue;
      if (dip.freeTrade[a * PAIRS + b]) cDeals[a]++;
      if (sim.war.pact[a * PAIRS + b] !== 0) cPacts[a]++;
      if (dip.known[a * PAIRS + b]) {
        cKnown[a]++;
        cOpen[a] += dip.open[a * PAIRS + b];
      }
    }
  }
}

const strengthOf = (sim: Simulation, civ: number) => (civ < sim.military.strength.length ? sim.military.strength[civ] : 0);

// ---------------------------------------------------------------------------
// Starting a term

/** Ends the term of the leader of `civ` (death, or the people is gone / its id reused) and keeps the sample. */
function endTerm(sim: Simulation, civ: number, end: number): void {
  const s = sim.leaders;
  if (!s.has[civ]) return;
  s.records.push(termRecord(sim, civ, end));
  s.has[civ] = 0;
}

function termRecord(sim: Simulation, civ: number, end: number): TermRecord {
  const s = sim.leaders;
  const attrs: number[] = [];
  for (let i = 0; i < 3; i++) if (s.attr[civ * 3 + i]) attrs.push(s.attr[civ * 3 + i]);
  return {
    civ,
    goal: s.goal[civ],
    years: (sim.tick - s.start[civ]) / 52,
    doneYears: s.goalDone[civ] ? (s.goalTick[civ] - s.start[civ]) / 52 : -1,
    attrs,
    end,
  };
}

/** Terms so far, plus the running ones (end 2), for the tool. */
export function leaderTerms(sim: Simulation): TermRecord[] {
  const s = sim.leaders;
  const list = s.records.slice();
  for (let civ = 1; civ < LEADER_CIVS; civ++) if (s.has[civ] && sim.civs[civ]) list.push(termRecord(sim, civ, 2));
  return list;
}

/** A people founded under id `civ` (also a reused one): the old leader's term ends, a new dynasty starts at the next yearly pass. */
export function resetLeaderCiv(sim: Simulation, civ: number): void {
  const s = sim.leaders;
  endTerm(sim, civ, 1);
  s.counter[civ] = 0;
  s.lastSettlements[civ] = 0;
  s.tradeValue[civ] = 0;
  s.tradeLast[civ] = 0;
  s.tradeCount[civ] = 0;
  clearLeader(sim, civ);
}

const randInt = (sim: Simulation, n: number) => Math.floor(sim.leaders.rng() * n);

/** Whether attribute `a` may be added to the leader of `civ`: not present, no exclusion pair, not against the goal. */
function allowed(sim: Simulation, civ: number, a: number): boolean {
  const s = sim.leaders;
  if (REMOVED[a]) return false;
  for (let i = 0; i < 3; i++) {
    const h = s.attr[civ * 3 + i];
    if (h === a || (h !== 0 && excludes[h * 26 + a])) return false;
  }
  return !goalExcludes(s.goal[civ], a);
}

/** Draws an attribute for `civ` at random among the allowed ones. */
function drawRandom(sim: Simulation, civ: number): number {
  const pick: number[] = [];
  for (let a = 1; a <= ATTR_COUNT; a++) if (allowed(sim, civ, a)) pick.push(a);
  return pick.length ? pick[randInt(sim, pick.length)] : 0;
}

/** From the experiences of the term: the kind with most events (a tie: the latest), an attribute of its list; random if none. Returns [attribute, 1 if from experience]. */
function drawExperienced(sim: Simulation, civ: number): [number, number] {
  const s = sim.leaders;
  if (s.rng() < LEADER.experience) {
    let best = -1;
    let bestCount = 0;
    let bestTick = -1;
    for (let k = 0; k < EVENTS; k++) {
      const n = s.events[civ * EVENTS + k];
      // "New settlements" counts from the 2nd one on.
      if (n === 0 || (k === Ev.Settled && n < 2)) continue;
      const t = s.eventTick[civ * EVENTS + k];
      if (n > bestCount || (n === bestCount && t > bestTick)) {
        best = k;
        bestCount = n;
        bestTick = t;
      }
    }
    if (best >= 0) {
      const pick: number[] = [];
      for (const a of FROM_EXPERIENCE[best]) if (allowed(sim, civ, a)) pick.push(a);
      if (pick.length) return [pick[randInt(sim, pick.length)], 1];
    }
  }
  return [drawRandom(sim, civ), 0];
}

/** Free settleable land next to the people's settlements, in people it could hold (capacity after repairs). */
function freeLand(sim: Simulation, civ: number): number {
  const w = sim.world;
  let total = 0;
  const touched: number[] = [];
  for (let c = 0; c < w.cellCount; c++) {
    if (w.owner[c] !== civ || sim.cellPop[c] === 0) continue;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = w.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || mark[nb] || !isSettlementTarget(sim, nb)) continue;
      mark[nb] = 1;
      touched.push(nb);
      total += capacityAfterRepair(sim, nb);
    }
  }
  for (const c of touched) mark[c] = 0;
  return total;
}

function chooseGoal(sim: Simulation, civ: number): number {
  const s = sim.leaders;
  const dip = sim.diplomacy;
  const eligible: number[] = [];
  const weight: number[] = [];
  let neighborDanger = 0;
  let neighbors = 0;
  let strongest = 0;
  for (let b = 1; b <= dip.maxId; b++) {
    if (!sim.civs[b] || adj[civ * PAIRS + b] === 0) continue;
    neighbors++;
    neighborDanger = Math.max(neighborDanger, dip.danger[civ * PAIRS + b]);
    strongest = Math.max(strongest, strengthOf(sim, b));
  }
  const mine = strengthOf(sim, civ);
  let weakerNeighbor = false;
  for (let b = 1; b <= dip.maxId; b++) {
    if (sim.civs[b] && adj[civ * PAIRS + b] === 1 && mine >= 1.5 * strengthOf(sim, b) && mine > 0) weakerNeighbor = true;
  }
  const people = sim.civs[civ]?.population ?? 0;
  for (let g: number = Goal.Expansion; g <= Goal.Glory; g++) {
    if (g === Goal.Security && neighbors === 0) continue;
    if ((g === Goal.Glory && hasAttr(sim, civ, PACIFIST)) || (g === Goal.Expansion && hasAttr(sim, civ, HOMEBODY))) continue;
    let wgt = 1;
    if (g === Goal.Expansion && freeLand(sim, civ) >= 0.2 * people) wgt = LEADER.weightExpansion;
    else if (g === Goal.Wealth && cDeals[civ] > 0) wgt = LEADER.weightWealth;
    else if (g === Goal.Security && neighborDanger >= 50) wgt = LEADER.weightSecurity;
    else if (g === Goal.Glory && weakerNeighbor) wgt = LEADER.weightGlory;
    eligible.push(g);
    weight.push(wgt);
  }
  if (eligible.length === 0) return Goal.Wealth;
  if (s.rng() < LEADER.goalBySituation) {
    let sum = 0;
    for (const wg of weight) sum += wg;
    let r = s.rng() * sum;
    for (let i = 0; i < eligible.length; i++) {
      r -= weight[i];
      if (r < 0) return eligible[i];
    }
    return eligible[eligible.length - 1];
  }
  return eligible[randInt(sim, eligible.length)];
}

function hasAttr(sim: Simulation, civ: number, a: number): boolean {
  const s = sim.leaders;
  return s.attr[civ * 3] === a || s.attr[civ * 3 + 1] === a || s.attr[civ * 3 + 2] === a;
}

/** The measure of a goal now: settlements, trade value (last year), the capital's tier. */
function goalMeasure(sim: Simulation, civ: number, goal: number): number {
  if (goal === Goal.Expansion) return cSettle[civ];
  if (goal === Goal.Wealth) return sim.leaders.tradeLast[civ];
  if (goal === Goal.Glory) return sim.world.cityTier[sim.civs[civ]!.capital];
  return 0;
}

/** Mean trade value of the last LEADER.wealthYears years (a calmer base than one year). */
function tradeAverage(sim: Simulation, civ: number): number {
  const s = sim.leaders;
  const n = Math.min(s.tradeCount[civ], LEADER.wealthYears);
  if (n === 0) return s.tradeLast[civ];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s.tradeHist[civ * TRADE_HISTORY + ((s.tradeCount[civ] - 1 - i) % TRADE_HISTORY)];
  return sum / n;
}

/** A new leader of `civ`; `pred` = the predecessor's attributes (empty for a new dynasty). */
function startLeader(sim: Simulation, civ: number, pred: readonly number[]): void {
  const s = sim.leaders;
  const st = s.stats;
  s.has[civ] = 1;
  s.counter[civ]++;
  if (s.counter[civ] === 1) st.dynasties++;
  s.age0[civ] = LEADER.ageMin + randInt(sim, LEADER.ageMax - LEADER.ageMin + 1);
  s.start[civ] = sim.tick;
  s.attr.fill(0, civ * 3, civ * 3 + 3);
  s.goal[civ] = 0;
  s.goalDone[civ] = 0;
  s.goalTick[civ] = 0;
  s.safeYears[civ] = 0;
  s.lastWin[civ] = -1;
  s.calmYears[civ] = 0;
  s.conquests[civ] = 0;
  s.events.fill(0, civ * EVENTS, civ * EVENTS + EVENTS);
  s.eventTick.fill(0, civ * EVENTS, civ * EVENTS + EVENTS);
  s.lastSettlements[civ] = cSettle[civ];
  s.lastDeals[civ] = cDeals[civ];
  s.lastPacts[civ] = cPacts[civ];
  // 1st attribute: 50 % one of the predecessor's, else any.
  let first = 0;
  if (pred.length > 0) {
    st.inheritChances++;
    if (s.rng() < LEADER.inherit) {
      first = pred[randInt(sim, pred.length)];
      if (REMOVED[first]) first = 0;
      else st.inherited++;
    }
  }
  if (LEADER.forceAttr > 0) first = LEADER.forceAttr;
  if (first === 0) first = drawRandom(sim, civ);
  s.attr[civ * 3] = first;
  st.attrDrawn[first]++;
  const goal = chooseGoal(sim, civ);
  s.goal[civ] = goal;
  st.goalsChosen[goal]++;
  s.goalBase[civ] = goal === Goal.Wealth ? Math.max(LEADER.wealthFloor, tradeAverage(sim, civ)) : goalMeasure(sim, civ, goal);
  st.started++;
  recompute(sim, civ);
}

// ---------------------------------------------------------------------------
// The lever set

/** Fills the lever set of `civ` from its attributes and goal (and war and glory state), and the capped satisfaction part. */
export function recompute(sim: Simulation, civ: number): void {
  const s = sim.leaders;
  add.fill(0);
  mul.fill(1);
  for (let i = 0; i < 3; i++) {
    const a = s.attr[civ * 3 + i];
    if (a !== 0) for (const [lv, v] of ATTRS[a].fx) accumulate(lv, v, LEADER.attrScale);
  }
  const g = s.goal[civ];
  if (g !== 0) {
    const k = LEADER.goalScale * (s.goalDone[civ] ? LEADER.goalHalf : 1);
    for (const [lv, v] of GOAL_FX[g]) accumulate(lv, v, k);
  }
  const lev = s.lev;
  const o = civ * LEVERS;
  for (let k = 0; k < LEVERS; k++) lev[o + k] = LEVER_KIND[k] ? mul[k] : add[k];
  const atWar = sim.war.enemy[civ] !== 0 || sim.war.allyWarsOf[civ] > 0;
  const glory = s.lastWin[civ] >= 0 && sim.tick - s.lastWin[civ] <= LEADER.gloryYears * 52;
  const raw = add[L.sat] + (atWar ? add[L.satWar] : 0) + (glory ? add[L.satGlory] : 0);
  s.sat[civ] = Math.max(-LEADER.capSatisfaction, Math.min(LEADER.capSatisfaction, raw));
}

function accumulate(lever: number, value: number, k: number): void {
  if (MUTE.size > 0 && MUTE.has(lever)) return;
  if (LEVER_KIND[lever]) mul[lever] *= 1 + (value - 1) * k;
  else add[lever] += value * k;
}

// ---------------------------------------------------------------------------
// The yearly pass

function deathChance(age: number): number {
  if (age < LEADER.deathFrom) return 0;
  return Math.min(LEADER.deathMax, LEADER.deathBase + LEADER.deathStep * (age - LEADER.deathFrom));
}

/** Yearly (simulation.ts: updateCivilizations): measures every people; with LEADER.enabled also runs the leaders' year. */
export function updateLeaders(sim: Simulation): void {
  const s = sim.leaders;
  collect(sim);
  const on = LEADER.enabled === 1;
  if (on) {
    for (let id = 1; id < LEADER_CIVS; id++) if (s.has[id] && !sim.civs[id]) endTerm(sim, id, 1);
  }
  const w = sim.war;
  for (let civ = 1; civ < sim.civs.length; civ++) {
    const people = sim.civs[civ];
    if (!people) continue;
    const atWar = w.enemy[civ] !== 0 || w.allyWarsOf[civ] > 0;
    if (on) {
      if (!s.has[civ]) startLeader(sim, civ, []);
      yearOfLeader(sim, civ, atWar);
    }
    // Measures (also without leaders, for the baseline).
    const known = Math.max(1, cKnown[civ]);
    const row = civMeasures(sim, civ, atWar, known);
    for (let m = 0; m < MEASURES; m++) s.all[m] += row[m];
    if (on && s.has[civ]) {
      for (let i = 0; i < 3; i++) {
        const a = s.attr[civ * 3 + i];
        if (a !== 0) for (let m = 0; m < MEASURES; m++) s.attrM[a * MEASURES + m] += row[m];
      }
      const g = s.goal[civ] + (s.goalDone[civ] ? 5 : 0);
      for (let m = 0; m < MEASURES; m++) s.goalM[g * MEASURES + m] += row[m];
    }
    s.declared[civ] = 0;
    s.uprisings[civ] = 0;
    s.lastSettlements[civ] = cSettle[civ];
    s.lastDeals[civ] = cDeals[civ];
    s.lastPacts[civ] = cPacts[civ];
  }
  // Trade value counts per year.
  for (let civ = 1; civ < LEADER_CIVS; civ++) {
    s.tradeLast[civ] = s.tradeValue[civ];
    if (sim.civs[civ]) s.tradeHist[civ * TRADE_HISTORY + (s.tradeCount[civ]++ % TRADE_HISTORY)] = s.tradeValue[civ];
    s.tradeValue[civ] = 0;
  }
}

const row = new Float64Array(MEASURES);
function civMeasures(sim: Simulation, civ: number, atWar: boolean, known: number): Float64Array {
  const s = sim.leaders;
  row[M.years] = 1;
  row[M.war] = atWar ? 1 : 0;
  row[M.declared] = s.declared[civ];
  row[M.open] = cOpen[civ] / known;
  row[M.deals] = cDeals[civ];
  row[M.pacts] = cPacts[civ];
  row[M.tradeValue] = s.tradeValue[civ];
  row[M.settlements] = cSettle[civ];
  row[M.growth] = cSettle[civ] - s.lastSettlements[civ];
  row[M.satisfaction] = cSettle[civ] > 0 ? cSat[civ] / cSettle[civ] : 0;
  row[M.rebellions] = s.uprisings[civ];
  row[M.people] = sim.civs[civ]?.population ?? 0;
  return row;
}

/** One year of the leader of `civ`: age and death, experiences, goal, attributes, levers. */
function yearOfLeader(sim: Simulation, civ: number, atWar: boolean): void {
  const s = sim.leaders;
  const st = s.stats;
  // Death (the successor takes office in the same year).
  const age = s.age0[civ] + Math.floor((sim.tick - s.start[civ]) / 52);
  const p = deathChance(age);
  if (p > 0 && s.rng() < p) {
    const pred: number[] = [];
    for (let i = 0; i < 3; i++) if (s.attr[civ * 3 + i]) pred.push(s.attr[civ * 3 + i]);
    st.died++;
    endTerm(sim, civ, 0);
    startLeader(sim, civ, pred);
    st.capYears++;
    return;
  }
  // Experiences of the year.
  const dSettle = cSettle[civ] - s.lastSettlements[civ];
  if (dSettle > 0) bump(sim, civ, Ev.Settled, dSettle);
  if (cDeals[civ] > s.lastDeals[civ]) bump(sim, civ, Ev.Trade, 1);
  if (cPacts[civ] > s.lastPacts[civ]) bump(sim, civ, Ev.Pact, 1);
  if (cNeg[civ] >= Math.max(1, LEADER.hardshipShare * cSettle[civ])) bump(sim, civ, Ev.Hardship, 1);
  if (s.uprisings[civ] > 0) bump(sim, civ, Ev.Uprising, 1);
  if (atWar) s.calmYears[civ] = 0;
  else if (++s.calmYears[civ] % LEADER.peaceYears === 0) bump(sim, civ, Ev.Peace, 1);
  // The 2nd attribute after the first years in office.
  const years = (sim.tick - s.start[civ]) / 52;
  if (s.attr[civ * 3 + 1] === 0 && years >= LEADER.secondYears) {
    const [a, fromExp] = drawExperienced(sim, civ);
    if (a !== 0) {
      s.attr[civ * 3 + 1] = a;
      st.attrDrawn[a]++;
      st.secondFromExperience += fromExp;
    }
  }
  // Goal.
  if (!s.goalDone[civ] && goalReached(sim, civ)) {
    s.goalDone[civ] = 1;
    s.goalTick[civ] = sim.tick;
    st.goalsDone[s.goal[civ]]++;
    if (s.attr[civ * 3 + 2] === 0) {
      const slot = s.attr[civ * 3 + 1] === 0 ? 1 : 2;
      const [a, fromExp] = drawExperienced(sim, civ);
      if (a !== 0) {
        s.attr[civ * 3 + slot] = a;
        st.attrDrawn[a]++;
        st.thirdFromExperience += fromExp;
      }
    }
  }
  // Exclusions must hold (checked in the tool).
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const a = s.attr[civ * 3 + i];
      const b = s.attr[civ * 3 + j];
      if (a && b && excludes[a * 26 + b]) st.exclusionBreaks++;
    }
    const a = s.attr[civ * 3 + i];
    if (a && goalExcludes(s.goal[civ], a)) st.exclusionBreaks++;
  }
  recompute(sim, civ);
  // Caps that bind (civ-years).
  st.capYears++;
  const o = civ * LEVERS;
  const lev = s.lev;
  if (Math.abs(rawSat(sim, civ)) > LEADER.capSatisfaction) st.capSat++;
  if (WAR.ratio + lev[o + L.ratio] + Math.min(lev[o + L.ratioBusy], lev[o + L.ratioCalm]) < LEADER.capRatioMin) st.capRatio++;
  if (lev[o + L.neverWar] === 0 && (WAR.chance + lev[o + L.warChance]) * lev[o + L.warChanceMul] > LEADER.capWarChance) st.capChance++;
}

function rawSat(sim: Simulation, civ: number): number {
  const s = sim.leaders;
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const a = s.attr[civ * 3 + i];
    if (a !== 0) for (const [lv, v] of ATTRS[a].fx) if (lv === L.sat) sum += v * LEADER.attrScale;
  }
  return sum;
}

function bump(sim: Simulation, civ: number, kind: number, n: number): void {
  const s = sim.leaders;
  s.events[civ * EVENTS + kind] += n;
  s.eventTick[civ * EVENTS + kind] = sim.tick;
}

/** The goal's completion condition (Requirement section 5), measured against the value at takeover. */
function goalReached(sim: Simulation, civ: number): boolean {
  const s = sim.leaders;
  const goal = s.goal[civ];
  const base = s.goalBase[civ];
  if (goal === Goal.Expansion) {
    return cSettle[civ] >= Math.max(LEADER.expansionFactor * base, base + LEADER.expansionMin);
  }
  if (goal === Goal.Wealth) {
    const partners = sim.diplomacy.partners[civ]?.length ?? 0;
    const valueOk = s.tradeLast[civ] >= LEADER.wealthFactor * base;
    const partnersOk = partners >= LEADER.wealthPartners;
    const parts = s.stats.parts;
    parts[0]++;
    if (valueOk) parts[1]++;
    if (partnersOk) parts[2]++;
    return valueOk && partnersOk;
  }
  if (goal === Goal.Security) {
    let safe = true;
    for (let b = 1; b <= sim.diplomacy.maxId; b++) {
      if (sim.civs[b] && adj[civ * PAIRS + b] === 1 && sim.diplomacy.danger[civ * PAIRS + b] > LEADER.securityDanger) safe = false;
    }
    if (cSettle[civ] < s.lastSettlements[civ]) safe = false;
    s.safeYears[civ] = safe ? Math.min(255, s.safeYears[civ] + 1) : 0;
    const parts = s.stats.parts;
    parts[3]++;
    if (safe) parts[4]++;
    if (cPacts[civ] >= 1) parts[5]++;
    return s.safeYears[civ] >= LEADER.securityYears && cPacts[civ] >= 1;
  }
  if (goal === Goal.Glory) {
    const parts = s.stats.parts;
    parts[6]++;
    if (s.conquests[civ] > 0) parts[7]++;
    if (goalMeasure(sim, civ, goal) > base) parts[8]++;
    return s.conquests[civ] > 0 || goalMeasure(sim, civ, goal) > base;
  }
  return false;
}


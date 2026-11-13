import { DIRECTION_COUNT } from '../hex';
import { PAIRS } from './diplomacy';
import { capacityAfterRepair, isSettlementTarget } from './economy';
import { EVENTS, Ev, GOALS, Goal, L, LEADER, LEADER_STEMS, MUTE, TRADE_HISTORY, LEADER_CIVS, LEVERS, LEVER_KIND, MEASURES, M, clearLeader, leaderName, type TermRecord } from './leaders';
import type { Simulation } from './simulation';
import { WAR } from './war';

// Leaders ("Design Documents/Requirement Anführer.md"): the yearly rules. A leader per people with up to 3
// attributes and 1 goal; each year: age, death and succession, experiences, the 2nd attribute after
// LEADER.secondYears, goal completion with the 3rd attribute. The lever set the decisions read (leaders.ts)
// is recomputed only when the leader, an attribute or the goal's state changed. With LEADER.enabled = 0
// (tools only) the yearly pass only measures.
// The random numbers come from `sim.leaders.rng` (its own sequence), never from the simulation's.
// One pass per year over the cells and the pairs of peoples (collect), a few dozen operations per people; no
// allocation besides the chronicle's strings (and, with LEADER.records, the tools' samples).

/** One effect: lever index and value (a deviation; mutable only so tools/leaderStats.ts can try other numbers). */
export type Effect = [lever: number, value: number];

/**
 * The 25 attributes, index 1..25 (Requirement section 4); effects are deviations from the base values:
 * additive levers a difference, multiplicative ones a factor (leaders.ts: LEVER_KIND). The index is state
 * (`leaders.attr`): append only.
 */
export const ATTRS: { name: string; about: string; fx: Effect[] }[] = [
  { name: '', about: '', fx: [] },
  { name: 'Warmonger', about: 'Looks for war and keeps a large army.', fx: [[L.warChance, 0.3], [L.sendShare, 0.15], [L.popShare, 0.05], [L.trainShare, 0.1], [L.sat, -2]] },
  { name: 'Pacifist', about: 'Never declares a war and gives in early.', fx: [[L.neverWar, 1], [L.openTrust, -10], [L.giveUp, 0.15]] },
  { name: 'Cautious Strategist', about: 'Attacks only the much weaker and spares the soldiers.', fx: [[L.ratio, 1], [L.warChanceMul, 0.8], [L.lossTaken, 0.75], [L.sat, 1]] },
  { name: 'Stubborn', about: 'Never gives up a war; its seats hold out longer.', fx: [[L.giveUp, -0.4], [L.occupy, 1.5], [L.satWar, -3]] },
  { name: 'Craven', about: 'Keeps most soldiers at home, pays them less and gives up early.', fx: [[L.sendShare, -0.45], [L.sold, 0.85], [L.giveUp, 0.2]] },
  { name: 'Drillmaster', about: 'Well trained, well paid soldiers.', fx: [[L.strength, 1.25], [L.sold, 1.3]] },
  { name: 'Silver Tongue', about: 'Wins the trust of other peoples.', fx: [[L.trust, 10], [L.trustBase, 5]] },
  { name: 'Xenophobe', about: 'Closes the borders early, taxes foreign merchants and defends the homeland.', fx: [[L.openDanger, -15], [L.closeDanger, -15], [L.tollAsk, 3], [L.defExtra, 0.25]] },
  { name: 'Oathkeeper', about: 'Makes pacts and alliances early and joins every war of an ally.', fx: [[L.allyTrust, -15], [L.pactTrust, -10], [L.oath, 1]] },
  { name: 'Opportunist', about: 'Attacks peoples that are already at war or in a rebellion.', fx: [[L.ratioBusy, -0.8], [L.ratioCalm, 0.5]] },
  { name: 'Grudge-bearer', about: 'Takes revenge on peoples that beat it.', fx: [[L.revenge, 2], [L.truce, -10], [L.warTrust, -30]] },
  { name: 'Merchant Prince', about: 'Merchants carry more, travel farther and lose less.', fx: [[L.load, 2], [L.tripRange, 1.2], [L.centerMin, 8 / 15], [L.lossTrade, 0.5], [L.tollPay, 0.5], [L.dealAmount, 1.5], [L.income, 0.1]] },
  { name: 'Generous', about: 'Low taxes.', fx: [[L.margin, 7], [L.sat, 4]] },
  { name: 'Tax Hawk', about: 'Taxes to the limit.', fx: [[L.margin, -5], [L.income, 0.15], [L.sat, -3]] },
  { name: 'Builder', about: 'Builds early, fast and cheap.', fx: [[L.buildCost, 0.7], [L.buildTime, 0.7], [L.buildFrom, -0.1]] },
  { name: 'Frugal', about: 'Low upkeep, large reserves, builds late.', fx: [[L.upkeepAll, 0.7], [L.income, -0.15], [L.buildFrom, 0.1], [L.reserve, 2]] },
  { name: 'Prospector', about: 'Gets more out of mines and special deposits and covets them in war.', fx: [[L.harvest, 1.5], [L.resMul, 2]] },
  { name: 'Pioneer', about: 'Settlers set out early and travel far.', fx: [[L.travel, 0.85], [L.settleOver, 0.97], [L.sat, -2]] },
  { name: 'Homebody', about: 'Settlers stay close to home.', fx: [[L.travel, 1.25], [L.sat, 3]] },
  { name: 'Beloved', about: 'Loved by the people.', fx: [[L.sat, 5]] },
  { name: 'Tyrant', about: 'Feared: unhappy people, but few dare to rebel.', fx: [[L.sat, -6], [L.rebel, 2]] },
  { name: 'Iron Fist', about: 'Keeps order with soldiers.', fx: [[L.rebel, 1.5], [L.sat, -2], [L.sold, 1.1]] },
  { name: 'Weak Hand', about: 'Mild; rebels dare more.', fx: [[L.rebel, 0.6], [L.sat, 3]] },
  { name: 'Devout', about: 'A pious people with many children.', fx: [[L.sat, 3], [L.birth, 1.05], [L.devotion, 0.05]] },
  { name: 'Road Builder', about: 'Merchants travel farther; settlements feel closer to their seat.', fx: [[L.tripRange, 1.3], [L.connection, 3]] },
];
export const ATTR_COUNT = 25;

/** What the goals mean (index Goal). */
export const GOAL_ABOUT = ['', 'Win land and settlements.', 'Grow rich by trade.', 'Keep the people safe.', 'Win glory in war or with a great capital.'] as const;

/** The goals' effects while active (the deviation halved by LEADER.goalHalf once reached; the "first" flags stay): index Goal. */
export const GOAL_FX: Effect[][] = [
  [],
  [[L.settleOver, 0.98], [L.warPop, 1.5], [L.buildFrom, -0.1]],
  [[L.tradeTrust, -5], [L.income, 0.1], [L.tradeFirst, 1]],
  [[L.warChanceMul, 0.5], [L.pactTrust, -10], [L.threat, -15], [L.strength, 1.1]],
  [[L.warChanceMul, 2], [L.ratio, -0.8], [L.satGlory, 2], [L.capitalFirst, 1]],
];

/** Pairs that exclude each other (Requirement section 4), and attribute / goal pairs (section 5). */
const EXCLUDE_PAIRS = [[1, 2], [1, 3], [2, 4], [4, 5], [7, 8], [13, 14], [15, 16], [18, 19], [20, 21], [21, 23], [22, 23], [8, 12], [2, 11]];
export const excludes = new Uint8Array(26 * 26);
for (const [a, b] of EXCLUDE_PAIRS) {
  excludes[a * 26 + b] = 1;
  excludes[b * 26 + a] = 1;
}
/** Attributes taken out of the game (never drawn or inherited); none at the moment. */
const REMOVED = new Uint8Array(26);
const PACIFIST = 2;
const HOMEBODY = 19;
/** Whether attribute `a` may not go with goal `g`. */
export function goalExcludes(g: number, a: number): boolean {
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
/** Settlements with merchants (trade centers, harbors) per people. */
const cCenters = new Int32Array(LEADER_CIVS);
/** Free settleable land next to each people's settlements, in people it could hold; filled on demand (freeDone). */
const cFree = new Float64Array(LEADER_CIVS);
let freeDone = false;
const add = new Float64Array(LEVERS);
const mul = new Float64Array(LEVERS);
const pick = new Uint8Array(32);
const pred = new Uint8Array(3);
const goalPick = new Uint8Array(5);
const goalWeight = new Float64Array(5);

function collect(sim: Simulation): void {
  const w = sim.world;
  adj.fill(0);
  cSettle.fill(0);
  cNeg.fill(0);
  cSat.fill(0);
  cCenters.fill(0);
  freeDone = false;
  const merchants = sim.trade.merchants;
  for (let c = 0; c < w.cellCount; c++) {
    const a = w.owner[c];
    if (a === 0 || sim.cellPop[c] === 0) continue;
    cSettle[a]++;
    cSat[a] += sim.satisfaction[c];
    if (sim.satisfaction[c] < 0) cNeg[a]++;
    if (merchants[c] > 0) cCenters[a]++;
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

/** Free settleable land next to every people's settlements (capacity after repairs), one pass for all peoples; only in years a leader takes office. */
function collectFreeLand(sim: Simulation): void {
  const w = sim.world;
  cFree.fill(0);
  freeDone = true;
  for (let c = 0; c < w.cellCount; c++) {
    if (sim.cellPop[c] > 0) continue;
    let capacity = -1;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = w.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || sim.cellPop[nb] === 0) continue;
      const a = w.owner[nb];
      if (a === 0) continue;
      // Once per people, however many of its settlements touch the hex.
      let seen = false;
      for (let e = 0; e < d && !seen; e++) {
        const other = w.neighbors[c * DIRECTION_COUNT + e];
        if (other >= 0 && sim.cellPop[other] > 0 && w.owner[other] === a) seen = true;
      }
      if (seen) continue;
      if (capacity < 0) capacity = isSettlementTarget(sim, c) ? capacityAfterRepair(sim, c) : 0;
      if (capacity === 0) break;
      cFree[a] += capacity;
    }
  }
}

const strengthOf = (sim: Simulation, civ: number) => (civ < sim.military.strength.length ? sim.military.strength[civ] : 0);

// ---------------------------------------------------------------------------
// Starting and ending a term

/** Ends the term of the leader of `civ` (death, or the people is gone / its id reused); with LEADER.records keeps the sample. */
function endTerm(sim: Simulation, civ: number, end: number): void {
  const s = sim.leaders;
  if (!s.has[civ]) return;
  if (LEADER.records === 1) s.records.push(termRecord(sim, civ, end));
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

/** Terms so far (with LEADER.records), plus the running ones (end 2), for tools and tests. */
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
  s.stem[civ] = 0;
  s.lastSettlements[civ] = 0;
  s.settlements[civ] = 0;
  s.tradeValue[civ] = 0;
  s.tradeLast[civ] = 0;
  s.tradeCount[civ] = 0;
  s.declared[civ] = 0;
  s.uprisings[civ] = 0;
  for (let b = 0; b < LEADER_CIVS; b++) {
    s.beaten[civ * LEADER_CIVS + b] = 0;
    s.beaten[b * LEADER_CIVS + civ] = 0;
  }
  clearLeader(sim, civ);
}

/**
 * Tests and tools: from now on the peoples of `sim` have no leaders (all terms end, every lever set is neutral),
 * so a fixture can check the base rules without a leader's shifts.
 */
export function dismissLeaders(sim: Simulation): void {
  const s = sim.leaders;
  s.enabled = 0;
  for (let civ = 1; civ < LEADER_CIVS; civ++) {
    endTerm(sim, civ, 1);
    clearLeader(sim, civ);
  }
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

/** Draws an attribute for `civ` at random among the allowed ones (0 if none). */
function drawRandom(sim: Simulation, civ: number): number {
  let n = 0;
  for (let a = 1; a <= ATTR_COUNT; a++) if (allowed(sim, civ, a)) pick[n++] = a;
  return n > 0 ? pick[randInt(sim, n)] : 0;
}

/** 1 if the last drawExperienced took the attribute from an experience. */
let drawnFromExperience = 0;

/** From the experiences of the term: the kind with most events (a tie: the latest), an attribute of its list; random if none. */
function drawExperienced(sim: Simulation, civ: number): number {
  const s = sim.leaders;
  drawnFromExperience = 0;
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
      const list = FROM_EXPERIENCE[best];
      let n = 0;
      for (let i = 0; i < list.length; i++) if (allowed(sim, civ, list[i])) pick[n++] = list[i];
      if (n > 0) {
        drawnFromExperience = 1;
        return pick[randInt(sim, n)];
      }
    }
  }
  return drawRandom(sim, civ);
}

function chooseGoal(sim: Simulation, civ: number): number {
  const s = sim.leaders;
  const dip = sim.diplomacy;
  let neighborDanger = 0;
  let neighbors = 0;
  const mine = strengthOf(sim, civ);
  let weakerNeighbor = false;
  for (let b = 1; b <= dip.maxId; b++) {
    if (!sim.civs[b] || adj[civ * PAIRS + b] === 0) continue;
    neighbors++;
    neighborDanger = Math.max(neighborDanger, dip.danger[civ * PAIRS + b]);
    if (mine > 0 && mine >= 1.5 * strengthOf(sim, b)) weakerNeighbor = true;
  }
  const people = sim.civs[civ]?.population ?? 0;
  let n = 0;
  for (let g: number = Goal.Expansion; g <= Goal.Glory; g++) {
    if (g === Goal.Security && neighbors === 0) continue;
    if ((g === Goal.Glory && hasAttr(sim, civ, PACIFIST)) || (g === Goal.Expansion && hasAttr(sim, civ, HOMEBODY))) continue;
    let wgt = 1;
    if (g === Goal.Expansion) {
      if (!freeDone) collectFreeLand(sim);
      if (cFree[civ] >= 0.2 * people) wgt = LEADER.weightExpansion;
    } else if (g === Goal.Wealth && (cDeals[civ] > 0 || cCenters[civ] >= 2)) wgt = LEADER.weightWealth;
    else if (g === Goal.Security && neighborDanger >= 50) wgt = LEADER.weightSecurity;
    else if (g === Goal.Glory && weakerNeighbor) wgt = LEADER.weightGlory;
    goalPick[n] = g;
    goalWeight[n++] = wgt;
  }
  if (n === 0) return Goal.Wealth;
  if (s.rng() < LEADER.goalBySituation) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += goalWeight[i];
    let r = s.rng() * sum;
    for (let i = 0; i < n; i++) {
      r -= goalWeight[i];
      if (r < 0) return goalPick[i];
    }
    return goalPick[n - 1];
  }
  return goalPick[randInt(sim, n)];
}

function hasAttr(sim: Simulation, civ: number, a: number): boolean {
  const s = sim.leaders;
  return s.attr[civ * 3] === a || s.attr[civ * 3 + 1] === a || s.attr[civ * 3 + 2] === a;
}

/** The capital's city tier (the Glory goal's second measure); 0 without a capital. */
export function capitalTier(sim: Simulation, civ: number): number {
  const capital = sim.civs[civ]?.capital ?? -1;
  return capital >= 0 ? sim.world.cityTier[capital] : 0;
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

/** A new line for `civ`: a name no living people's line bears, if one is free. */
function drawStem(sim: Simulation, civ: number): number {
  const s = sim.leaders;
  let stem = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    stem = randInt(sim, LEADER_STEMS.length);
    let taken = false;
    for (let b = 1; b < LEADER_CIVS && !taken; b++) if (b !== civ && s.has[b] && s.stem[b] === stem) taken = true;
    if (!taken) break;
  }
  return stem;
}

const leaderLabel = (sim: Simulation, civ: number) => leaderName(sim.leaders.stem[civ], sim.leaders.counter[civ]);
/** A silent chronicle entry at the people's capital (Requirement section 8). */
function chronicle(sim: Simulation, civ: number, text: string): void {
  if (LEADER.chronicle === 1) sim.chronicle.push({ tick: sim.tick, text, cell: sim.civs[civ]?.capital ?? -1, important: false });
}

/** A new leader of `civ`; `inherit`: it follows a leader whose attributes are still in the slots (else a new dynasty's first). */
function startLeader(sim: Simulation, civ: number, inherit: boolean): void {
  const s = sim.leaders;
  const st = s.stats;
  let preds = 0;
  if (inherit) for (let i = 0; i < 3; i++) if (s.attr[civ * 3 + i]) pred[preds++] = s.attr[civ * 3 + i];
  s.has[civ] = 1;
  if (s.counter[civ] === 0) {
    s.stem[civ] = drawStem(sim, civ);
    st.dynasties++;
  }
  s.counter[civ]++;
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
  s.wonAttack[civ] = 0;
  s.events.fill(0, civ * EVENTS, civ * EVENTS + EVENTS);
  s.eventTick.fill(0, civ * EVENTS, civ * EVENTS + EVENTS);
  s.lastSettlements[civ] = cSettle[civ];
  s.settlements[civ] = cSettle[civ];
  s.lastDeals[civ] = cDeals[civ];
  s.lastPacts[civ] = cPacts[civ];
  // 1st attribute: 50 % one of the predecessor's, else any.
  let first = 0;
  if (preds > 0) {
    st.inheritChances++;
    if (s.rng() < LEADER.inherit) {
      first = pred[randInt(sim, preds)];
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
  s.goalBase[civ] = goal === Goal.Expansion ? cSettle[civ] : goal === Goal.Wealth ? Math.max(LEADER.wealthFloor, tradeAverage(sim, civ)) : goal === Goal.Glory ? capitalTier(sim, civ) : 0;
  st.started++;
  recompute(sim, civ);
  const name = sim.civs[civ]?.name ?? '?';
  chronicle(sim, civ, `${leaderLabel(sim, civ)} became leader of the ${name} (${ATTRS[first].name}, goal: ${GOALS[goal]}).`);
}

// ---------------------------------------------------------------------------
// The lever set

/**
 * Fills the lever set of `civ` from its attributes and goal; called only when one of them changed (takeover,
 * new attribute, goal reached). The satisfaction parts follow in updateMood.
 */
export function recompute(sim: Simulation, civ: number): void {
  const s = sim.leaders;
  add.fill(0);
  mul.fill(1);
  for (let i = 0; i < 3; i++) {
    const a = s.attr[civ * 3 + i];
    if (a !== 0) {
      const fx = ATTRS[a].fx;
      for (let e = 0; e < fx.length; e++) accumulate(fx[e][0], fx[e][1], LEADER.attrScale);
    }
  }
  const g = s.goal[civ];
  if (g !== 0) {
    const k = LEADER.goalScale * (s.goalDone[civ] ? LEADER.goalHalf : 1);
    const fx = GOAL_FX[g];
    for (let e = 0; e < fx.length; e++) accumulate(fx[e][0], fx[e][1], k);
  }
  const lev = s.lev;
  const o = civ * LEVERS;
  for (let k = 0; k < LEVERS; k++) lev[o + k] = LEVER_KIND[k] ? mul[k] : add[k];
  updateMood(sim, civ);
}

/**
 * The leader's satisfaction parts of `civ` from its lever set and the people's state (at war, a war won
 * lately): the part "Leader" and what it adds to the connection part, together within +-LEADER.capSatisfaction.
 * Yearly and with every recompute. Returns whether the cap binds.
 */
function updateMood(sim: Simulation, civ: number): boolean {
  const s = sim.leaders;
  const o = civ * LEVERS;
  const lev = s.lev;
  const atWar = sim.war.enemy[civ] !== 0 || sim.war.allyWarsOf[civ] > 0;
  const glory = s.lastWin[civ] >= 0 && sim.tick - s.lastWin[civ] <= LEADER.gloryYears * 52;
  const cap = LEADER.capSatisfaction;
  const conn = Math.max(-cap, Math.min(cap, lev[o + L.connection]));
  const raw = lev[o + L.sat] + (atWar ? lev[o + L.satWar] : 0) + (glory ? lev[o + L.satGlory] : 0) + conn;
  s.conn[civ] = conn;
  s.sat[civ] = Math.max(-cap, Math.min(cap, raw)) - conn;
  return Math.abs(raw) > cap;
}

/** Adds one effect to the scratch sums: `k` scales the deviation (1 = full, LEADER.goalHalf after the goal). */
function accumulate(lever: number, value: number, k: number): void {
  if (MUTE[lever]) return;
  if (LEVER_KIND[lever]) mul[lever] *= 1 + (value - 1) * k;
  else add[lever] += value * k;
}

// ---------------------------------------------------------------------------
// The yearly pass

function deathChance(age: number): number {
  if (age < LEADER.deathFrom) return 0;
  return Math.min(LEADER.deathMax, LEADER.deathBase + LEADER.deathStep * (age - LEADER.deathFrom));
}

/** Yearly (simulation.ts: updateCivilizations): every people's leader lives a year; also sums the tools' measures. */
export function updateLeaders(sim: Simulation): void {
  const s = sim.leaders;
  collect(sim);
  const on = s.enabled === 1;
  // A people that is gone: its leader's term ends without a successor.
  for (let id = 1; id < LEADER_CIVS; id++) {
    if (s.has[id] && !sim.civs[id]) {
      endTerm(sim, id, 1);
      clearLeader(sim, id);
    }
  }
  const w = sim.war;
  for (let civ = 1; civ < sim.civs.length; civ++) {
    const people = sim.civs[civ];
    if (!people) continue;
    const atWar = w.enemy[civ] !== 0 || w.allyWarsOf[civ] > 0;
    if (on) {
      if (!s.has[civ]) startLeader(sim, civ, false);
      else yearOfLeader(sim, civ, atWar);
    }
    // Measures (also without leaders, for the comparison).
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
    s.settlements[civ] = cSettle[civ];
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
  const name = sim.civs[civ]?.name ?? '?';
  // Death (the successor takes office in the same year).
  const years = Math.floor((sim.tick - s.start[civ]) / 52);
  const age = s.age0[civ] + years;
  const p = deathChance(age);
  st.capYears++;
  if (p > 0 && s.rng() < p) {
    st.died++;
    chronicle(sim, civ, `${leaderLabel(sim, civ)}, leader of the ${name}, died at the age of ${age} after ${years} years in office.`);
    endTerm(sim, civ, 0);
    startLeader(sim, civ, true);
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
  let changed = false;
  // The 2nd attribute after the first years in office.
  if (s.attr[civ * 3 + 1] === 0 && years >= LEADER.secondYears) {
    const a = drawExperienced(sim, civ);
    if (a !== 0) {
      s.attr[civ * 3 + 1] = a;
      st.attrDrawn[a]++;
      st.secondFromExperience += drawnFromExperience;
      changed = true;
      chronicle(sim, civ, `${leaderLabel(sim, civ)}, leader of the ${name}, gained the trait ${ATTRS[a].name}.`);
    }
  }
  // Goal: once reached its effect halves and the 3rd attribute comes.
  if (!s.goalDone[civ] && goalReached(sim, civ)) {
    s.goalDone[civ] = 1;
    s.goalTick[civ] = sim.tick;
    st.goalsDone[s.goal[civ]]++;
    changed = true;
    chronicle(sim, civ, `${leaderLabel(sim, civ)}, leader of the ${name}, reached the goal ${GOALS[s.goal[civ]]}.`);
    if (s.attr[civ * 3 + 2] === 0) {
      const slot = s.attr[civ * 3 + 1] === 0 ? 1 : 2;
      const a = drawExperienced(sim, civ);
      if (a !== 0) {
        s.attr[civ * 3 + slot] = a;
        st.attrDrawn[a]++;
        st.thirdFromExperience += drawnFromExperience;
        chronicle(sim, civ, `${leaderLabel(sim, civ)}, leader of the ${name}, gained the trait ${ATTRS[a].name}.`);
      }
    }
  }
  if (changed) {
    // Exclusions must hold (the tool and the tests check the count).
    for (let i = 0; i < 3; i++) {
      const a = s.attr[civ * 3 + i];
      for (let j = i + 1; j < 3; j++) {
        const b = s.attr[civ * 3 + j];
        if (a && b && excludes[a * 26 + b]) st.exclusionBreaks++;
      }
      if (a && goalExcludes(s.goal[civ], a)) st.exclusionBreaks++;
    }
    recompute(sim, civ);
  }
  // Caps that bind (people-years).
  if (updateMood(sim, civ)) st.capSat++;
  const o = civ * LEVERS;
  const lev = s.lev;
  if (WAR.ratio + lev[o + L.ratio] + Math.min(lev[o + L.ratioBusy], lev[o + L.ratioCalm]) < LEADER.capRatioMin) st.capRatio++;
  if (lev[o + L.neverWar] === 0 && (WAR.chance + lev[o + L.warChance]) * lev[o + L.warChanceMul] > LEADER.capWarChance) st.capChance++;
}

function bump(sim: Simulation, civ: number, kind: number, n: number): void {
  const s = sim.leaders;
  s.events[civ * EVENTS + kind] += n;
  s.eventTick[civ * EVENTS + kind] = sim.tick;
}

/** Settlements the Expansion goal of `civ` asks for. */
export function expansionTarget(base: number): number {
  return Math.ceil(Math.max(LEADER.expansionFactor * base, base + LEADER.expansionMin));
}

/** The goal's completion condition (Requirement section 5), measured against the value at takeover. */
function goalReached(sim: Simulation, civ: number): boolean {
  const s = sim.leaders;
  const goal = s.goal[civ];
  const base = s.goalBase[civ];
  const parts = s.stats.parts;
  if (goal === Goal.Expansion) return cSettle[civ] >= expansionTarget(base);
  if (goal === Goal.Wealth) {
    const partners = sim.diplomacy.partners[civ]?.length ?? 0;
    const valueOk = s.tradeLast[civ] >= LEADER.wealthFactor * base;
    const partnersOk = partners >= LEADER.wealthPartners;
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
    parts[3]++;
    if (safe) parts[4]++;
    if (cPacts[civ] >= 1) parts[5]++;
    return s.safeYears[civ] >= LEADER.securityYears && cPacts[civ] >= 1;
  }
  if (goal === Goal.Glory) {
    // A war won as the attacker (with or without a conquered district), or the capital rose a city tier.
    const tierUp = capitalTier(sim, civ) > base;
    parts[6]++;
    if (s.wonAttack[civ] > 0) parts[7]++;
    if (tierUp) parts[8]++;
    if (s.conquests[civ] > 0) parts[9]++;
    return s.wonAttack[civ] > 0 || tierUp;
  }
  return false;
}

import { ATTRS, GOAL_ABOUT, GOAL_FX, capitalTier, expansionTarget, type Effect } from './leaderRules';
import { GOALS, Goal, L, LEADER, LEADER_CIVS, LEVER_KIND, leaderName } from './leaders';
import type { Simulation } from './simulation';

// Leaders: what the app shows of a people's leader ("Leader >" in the peoples panel, Requirement Anführer
// section 8). Read-only and for display: it allocates objects and strings, so it is called when the panel
// opens or the year changes, never per frame or per tick. Game text is English.

/** One attribute of a leader. */
export type LeaderTrait = {
  /** 1..25 (leaderRules.ts: ATTRS). */
  id: number;
  name: string;
  /** What the attribute means, one sentence. */
  about: string;
  /** Its effects in numbers, one line each, e.g. "Merchant load +100 %". */
  effects: string[];
};

/** One part of a goal's completion condition: `value` of `target`, e.g. "Settlements" 7 / 9. */
export type LeaderProgress = { label: string; value: number; target: number; met: boolean };

export type LeaderGoal = {
  /** 1 Expansion, 2 Wealth, 3 Security, 4 Glory. */
  id: number;
  name: string;
  about: string;
  /** Reached: the effects below are the halved ones. */
  reached: boolean;
  /** Years in office when it was reached; -1 while open. */
  reachedAfterYears: number;
  /** Its effects in numbers as they act now (full while active, half the deviation once reached). */
  effects: string[];
  /** The completion condition's parts and whether all of them or any one is needed. */
  progress: LeaderProgress[];
  needs: 'all' | 'any';
};

export type LeaderInfo = {
  civ: number;
  /** Name with ordinal: "Aron", "Aron II". */
  name: string;
  /** 1 = first of the line. */
  ordinal: number;
  age: number;
  yearsInOffice: number;
  /** 1 to 3 attributes in the order they came. */
  traits: LeaderTrait[];
  /** Years until the 2nd attribute comes (0 once it is there or due). */
  yearsToSecondTrait: number;
  goal: LeaderGoal;
  /** The satisfaction part "Leader" of the people's settlements now (capped) and what the leader adds to their connection part. */
  satisfaction: number;
  connection: number;
};

const round = (v: number) => Math.round(v * 100) / 100;
const num = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${round(Math.abs(v))}`;
const percent = (factor: number) => `${num(Math.round((factor - 1) * 100))} %`;
const points = (share: number) => `${num(Math.round(share * 100))} points`;

/** How a lever reads: its label and the unit of its value. */
type Unit = 'factor' | 'points' | 'number' | 'times' | 'flag';
const LEVER_TEXT: Record<number, [label: string, unit: Unit]> = {
  [L.warChance]: ['Yearly chance to declare war', 'points'],
  [L.warChanceMul]: ['Yearly chance to declare war', 'factor'],
  [L.neverWar]: ['Never declares war', 'flag'],
  [L.ratio]: ['Strength needed to declare war', 'times'],
  [L.ratioBusy]: ['Strength needed against peoples at war or in a rebellion', 'times'],
  [L.ratioCalm]: ['Strength needed against peoples at peace', 'times'],
  [L.giveUp]: ['Gives up below this share of the enemy\'s strength', 'points'],
  [L.exhaust]: ['Years until a war ends by exhaustion', 'number'],
  [L.dangerMul]: ['Danger seen in other peoples', 'factor'],
  [L.sold]: ['Soldiers\' pay', 'factor'],
  [L.strength]: ['Soldiers\' strength', 'factor'],
  [L.truce]: ['Years of truce after its wars', 'number'],
  [L.warTrust]: ['Trust in a former enemy', 'number'],
  [L.moodYears]: ['Years a mood lasts', 'number'],
  [L.openTrust]: ['Trust needed to open a border', 'number'],
  [L.closeTrust]: ['Trust below which a border closes', 'number'],
  [L.pactTrust]: ['Trust needed for a pact', 'number'],
  [L.allyTrust]: ['Trust needed for an alliance', 'number'],
  [L.tradeTrust]: ['Trust needed for trade agreements', 'number'],
  [L.trust]: ['Trust in all peoples', 'number'],
  [L.trustBase]: ['Trust at first contact', 'number'],
  [L.tollPay]: ['Tolls its merchants pay', 'factor'],
  [L.tollAsk]: ['Tolls for foreign merchants', 'factor'],
  [L.margin]: ['Safety margin of the taxes', 'number'],
  [L.income]: ['Share of the income spent on upkeep', 'points'],
  [L.buildFrom]: ['Settlements build for growth from this share of their capacity', 'points'],
  [L.govUpkeep]: ['Upkeep of government buildings', 'factor'],
  [L.travel]: ['Travel cost of settlers', 'factor'],
  [L.settleOver]: ['Crowding at which settlers set out', 'factor'],
  [L.threat]: ['Danger from which it arms', 'number'],
  [L.devotion]: ['Devotion to the god (the player\'s people)', 'number'],
  [L.rebel]: ['Strength rebels need to rise', 'factor'],
  [L.resMul]: ['Weight of special deposits when choosing a war goal', 'factor'],
  [L.warPop]: ['Weight of inhabitants when choosing a war goal', 'factor'],
  [L.oath]: ['Joins every war of an ally', 'flag'],
  [L.sat]: ['Satisfaction', 'number'],
  [L.satWar]: ['Satisfaction while at war', 'number'],
  [L.satGlory]: [`Satisfaction for ${LEADER.gloryYears} years after a war won`, 'number'],
  [L.sendShare]: ['Share of the soldiers sent to war', 'points'],
  [L.popShare]: ['Soldiers per inhabitants (limit)', 'points'],
  [L.trainShare]: ['Share of the soldiers trained per year', 'points'],
  [L.occupy]: ['Siege time until its seats are occupied', 'factor'],
  [L.lossTaken]: ['Losses in battle', 'factor'],
  [L.defExtra]: ['Defense bonus on its own land', 'points'],
  [L.openDanger]: ['Danger up to which a border opens', 'number'],
  [L.closeDanger]: ['Danger from which a border closes', 'number'],
  [L.birth]: ['Birth rate', 'factor'],
  [L.buildCost]: ['Building cost', 'factor'],
  [L.buildTime]: ['Building time', 'factor'],
  [L.upkeepAll]: ['Upkeep of all buildings', 'factor'],
  [L.harvest]: ['Yield of mines and special deposits', 'factor'],
  [L.load]: ['Merchant load', 'factor'],
  [L.centerMin]: ['Trade needed for a trade center', 'factor'],
  [L.lossTrade]: ['Merchant losses', 'factor'],
  [L.tripRange]: ['Merchant range', 'factor'],
  [L.revenge]: [`Chance of war on a people that beat it in the last ${LEADER.revengeYears} years (needs only ${LEADER.capRatioMin}× its strength)`, 'factor'],
  [L.dealAmount]: ['Amount of a trade agreement', 'factor'],
  [L.reserve]: ['Wood and stone reserve of settlements', 'factor'],
  [L.connection]: ['Satisfaction from the connection to a seat', 'number'],
  [L.tradeFirst]: ['Settlements build trade buildings first', 'flag'],
  [L.capitalFirst]: ['The government builds up the capital first', 'flag'],
};

/** One effect as text; `k` scales the deviation (1 = full, 0.5 = a reached goal). */
export function effectText(effect: Effect, k = 1): string {
  const [lever, value] = effect;
  const entry = LEVER_TEXT[lever];
  if (!entry) return '';
  const [label, unit] = entry;
  if (unit === 'flag') return label;
  if (LEVER_KIND[lever]) {
    const factor = 1 + (value - 1) * k;
    return `${label} ${percent(factor)}`;
  }
  const v = value * k;
  if (unit === 'points') return `${label} ${points(v)}`;
  if (unit === 'times') return `${label} ${num(v)}×`;
  return `${label} ${num(v)}`;
}

function effectTexts(fx: readonly Effect[], k: number): string[] {
  const out: string[] = [];
  for (const e of fx) {
    const text = effectText(e, k);
    if (text) out.push(text);
  }
  return out;
}

/** The attribute `id` (1..25) as the panel shows it. */
export function leaderTrait(id: number): LeaderTrait {
  const a = ATTRS[id];
  return { id, name: a.name, about: a.about, effects: effectTexts(a.fx, LEADER.attrScale) };
}

/** The leader of people `civ` for the panel; null while it has none (a people gets its first leader at its first year's end). */
export function leaderOf(sim: Simulation, civ: number): LeaderInfo | null {
  const s = sim.leaders;
  if (civ <= 0 || civ >= LEADER_CIVS || !s.has[civ] || !sim.civs[civ]) return null;
  const years = Math.floor((sim.tick - s.start[civ]) / 52);
  const traits: LeaderTrait[] = [];
  for (let i = 0; i < 3; i++) if (s.attr[civ * 3 + i]) traits.push(leaderTrait(s.attr[civ * 3 + i]));
  const g = s.goal[civ];
  const reached = s.goalDone[civ] === 1;
  const base = s.goalBase[civ];
  const progress: LeaderProgress[] = [];
  let needs: 'all' | 'any' = 'all';
  const part = (label: string, value: number, target: number) => progress.push({ label, value: round(value), target: round(target), met: value >= target });
  if (g === Goal.Expansion) part('Settlements', s.settlements[civ], expansionTarget(base));
  else if (g === Goal.Wealth) part('Trade value per year', s.tradeLast[civ], LEADER.wealthFactor * base);
  else if (g === Goal.Security) {
    part('Safe years in a row', Math.min(s.safeYears[civ], LEADER.securityYears), LEADER.securityYears);
    part('Pact or alliance', Math.min(1, s.lastPacts[civ]), 1);
  } else if (g === Goal.Glory) {
    needs = 'any';
    part('War won as the attacker', Math.min(1, s.wonAttack[civ]), 1);
    part('City tier of the capital', capitalTier(sim, civ), base + 1);
  }
  return {
    civ,
    name: leaderName(s.stem[civ], s.counter[civ]),
    ordinal: s.counter[civ],
    age: s.age0[civ] + years,
    yearsInOffice: years,
    traits,
    yearsToSecondTrait: s.attr[civ * 3 + 1] !== 0 ? 0 : Math.max(0, LEADER.secondYears - years),
    goal: {
      id: g,
      name: GOALS[g],
      about: GOAL_ABOUT[g],
      reached,
      reachedAfterYears: reached ? Math.floor((s.goalTick[civ] - s.start[civ]) / 52) : -1,
      effects: effectTexts(GOAL_FX[g], LEADER.goalScale * (reached ? LEADER.goalHalf : 1)),
      progress,
      needs,
    },
    satisfaction: s.sat[civ],
    connection: s.conn[civ],
  };
}

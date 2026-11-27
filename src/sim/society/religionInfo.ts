import type { Term } from '../terms';
import { effectText } from './leaderInfo';
import { L, LEADER_CIVS, LEVER_KIND } from './leaders';
import { BLOCS, MANDATE, loyaltyParts, restlessBelow } from './mandate';
import { MAXR, NO_RELIGION, RELIGION, SLOTS, THEMES, TRAITS, slotsOf, stateFaith, type TraitDef } from './religion';
import type { Simulation } from './simulation';

// What the app shows of religions and the Mandate (Requirement Religion 9, Mandat 9): the Faiths panel, a people's
// "Faith ›" and "Mandate ›", the hex panel's faith and loyalty. Read-only and for display: it allocates objects and
// strings, so it is called when a panel opens or the year changes, never per frame or per tick. Game text is English.

/** One trait of a religion as the panel shows it. */
export type FaithTraitInfo = {
  /** 1..24 (religion.ts TRAITS). */
  id: number;
  name: string;
  theme: string;
  about: string;
  /** 1..3, and the progress 0..100 to the next level (below 0 it falls a level). */
  level: number;
  progress: number;
  /** Given by the god (Blessed Doctrine). */
  byGod: boolean;
  /** Its effects at this level with a full following, one line each (e.g. "Birth rate +4 %"). */
  effects: string[];
};

export type ReligionInfo = {
  id: number;
  name: string;
  founded: number;
  age: number;
  /** The founding people's name (it may be gone). */
  founder: string;
  /** Believers, and their share of the world's people. */
  believers: number;
  share: number;
  /** The peoples with believers: id, name, believers, share of that people. */
  peoples: { civ: number; name: string; believers: number; share: number }[];
  traits: FaithTraitInfo[];
  /** Natural trait slots by age, years to the next new trait (a draw every RELIGION.newEvery years). */
  slots: number;
  yearsToNextTrait: number;
  /** Tension 0..100 and its word: Calm (< 40), Uneasy (< 70), Tense. */
  tension: number;
  tensionLabel: 'Calm' | 'Uneasy' | 'Tense';
  /** "You" for religion 0, "None" else (rival gods come in step 2). */
  god: 'You' | 'None';
  /** The mother religion of a daughter (-1 none) and its name; `heresy` while the daughter has not won yet. */
  parent: number;
  parentName: string;
  heresy: boolean;
};

const lf = (level: number) => (level <= 1 ? RELIGION.level1 : level === 2 ? RELIGION.level2 : RELIGION.level3);
const TRADE = new Set<number>([L.load, L.tripRange, L.dealAmount, L.lossTrade, L.tollAsk, L.buildCost, L.buildTime]);
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100) / 100}`;
const pct = (f: number) => `${signed(Math.round((f - 1) * 100))} %`;

/** The effects of trait `d` at deviation scale `k` (level x share), as text lines. */
function traitEffects(d: TraitDef, k: number): string[] {
  const out: string[] = [];
  const half = d.half ? 0.5 : 1;
  for (const e of d.lev) {
    const scale = k * half * (TRADE.has(e[0]) ? RELIGION.tradeScale : 1);
    const t = LEVER_KIND[e[0]] ? effectText([e[0], Math.pow(e[1], scale)], 1) : effectText(e as [number, number], scale);
    if (t) out.push(t);
  }
  if (d.sat !== 0) out.push(`Satisfaction (Creed) ${signed(d.sat * k * (d.half ? RELIGION.halfCreed : 1))}`);
  if (d.pull) out.push(`Pull on neighbors ${pct(Math.pow(d.pull, k))}`);
  if (d.carry) out.push(`Faith carried by settlers and merchants ${pct(Math.pow(d.carry, k))}`);
  if (d.hold) out.push(`Resistance to conversion ${pct(Math.pow(d.hold, k))}`);
  if (d.devotion) out.push(`Devotion ${signed(d.devotion * k)} a year`);
  if (d.suppress) out.push(`Other faiths lose ${signed(RELIGION.suppress * k)} faith a year where it rules`);
  if (d.merge === 0) out.push('Never merges with another faith');
  else if (d.merge) out.push(`Chance to merge ${pct(Math.pow(d.merge, k))}`);
  if (d.schism) out.push(`Chance of a schism ${pct(Math.pow(d.schism, k))}`);
  if (d.heresy) out.push(`Loyalty lost to heresy ${pct(Math.pow(d.heresy, k))}`);
  return out;
}

function trait(sim: Simulation, r: number, k: number): FaithTraitInfo | null {
  const st = sim.religion;
  const i = r * SLOTS + k;
  const t = st.traitId[i];
  if (t === 0) return null;
  const d = TRAITS[t];
  return {
    id: t,
    name: d.name,
    theme: THEMES[d.theme],
    about: d.about,
    level: st.traitLvl[i],
    progress: Math.round(st.traitProg[i]),
    byGod: st.traitGod[i] === 1,
    effects: traitEffects(d, lf(st.traitLvl[i])),
  };
}

/** The living religions for the Faiths panel, the player's first, then by believers. */
export function religionsOf(sim: Simulation): ReligionInfo[] {
  const st = sim.religion;
  const year = Math.floor(sim.tick / 52);
  const out: ReligionInfo[] = [];
  const world = Math.max(1, sim.pop.count);
  for (let r = 0; r < MAXR; r++) {
    if (!st.alive[r]) continue;
    const peoples: ReligionInfo['peoples'] = [];
    for (let c = 1; c < sim.civs.length && c < LEADER_CIVS; c++) {
      const n = st.cnt[c * MAXR + r];
      if (n > 0 && sim.civs[c]) peoples.push({ civ: c, name: sim.civs[c]!.name, believers: n, share: st.share[c * MAXR + r] });
    }
    peoples.sort((a, b) => b.believers - a.believers);
    const traits: FaithTraitInfo[] = [];
    for (let k = 0; k < SLOTS; k++) {
      const t = trait(sim, r, k);
      if (t) traits.push(t);
    }
    const tension = Math.round(st.tension[r]);
    const p = st.parent[r];
    out.push({
      id: r,
      name: st.name[r],
      founded: st.founded[r] + 1,
      age: year - st.founded[r],
      founder: sim.civs[st.founderCiv[r]]?.name ?? '',
      believers: st.total[r],
      share: st.total[r] / world,
      peoples,
      traits,
      slots: slotsOf(sim, r),
      yearsToNextTrait: Math.max(0, RELIGION.newEvery - (year - st.newClock[r])),
      tension,
      tensionLabel: tension < 40 ? 'Calm' : tension < RELIGION.tense ? 'Uneasy' : 'Tense',
      god: r === 0 ? 'You' : 'None',
      parent: p,
      parentName: p >= 0 && st.parentSerial[r] === st.serial[p] && st.alive[p] ? st.name[p] : '',
      heresy: p >= 0 && st.wonBy[r] === 0,
    });
  }
  out.sort((a, b) => (a.id === 0 ? -1 : b.id === 0 ? 1 : b.believers - a.believers));
  return out;
}

/** A people's faith for "Faith ›": the religions in it, the one it follows, its state faith, the actual effects and Creed. */
export type CivFaithInfo = {
  civ: number;
  shares: { religion: number; name: string; share: number }[];
  /** The religion the people follows (>= 55 %, Requirement Religion 2), -1 none. */
  follows: number;
  followsName: string;
  /** The state faith (the leader's faith, else the capital's majority), -1 none. */
  stateFaith: number;
  stateFaithName: string;
  /** The effects that act, one line each with their source, e.g. "Yearly chance to declare war +4 points (Holy War, 40 %)". */
  effects: string[];
  /** The satisfaction part "Creed" now (capped at ±RELIGION.creedCap). */
  creed: number;
  /** The trust part "Faith" towards each known people (Requirement Religion 6a). */
  trust: { civ: number; name: string; value: number }[];
};

export function civFaith(sim: Simulation, civ: number): CivFaithInfo | null {
  const st = sim.religion;
  if (civ <= 0 || civ >= LEADER_CIVS || !sim.civs[civ]) return null;
  const shares: CivFaithInfo['shares'] = [];
  const effects: string[] = [];
  for (let r = 0; r < MAXR; r++) {
    const s = st.share[civ * MAXR + r];
    if (s <= 0 || !st.alive[r]) continue;
    shares.push({ religion: r, name: st.name[r], share: s });
    for (let k = 0; k < SLOTS; k++) {
      const t = st.traitId[r * SLOTS + k];
      if (t === 0) continue;
      const d = TRAITS[t];
      const tag = ` (${d.name}, ${Math.round(s * 100)} %)`;
      for (const line of traitEffects(d, lf(st.traitLvl[r * SLOTS + k]) * s)) effects.push(line + tag);
    }
  }
  shares.sort((a, b) => b.share - a.share);
  const follows = st.major[civ];
  const sf = stateFaith(sim, civ);
  const trust: CivFaithInfo['trust'] = [];
  for (let b = 1; b < sim.civs.length && b < LEADER_CIVS; b++) {
    const v = st.trust[civ * 256 + b];
    if (b !== civ && sim.civs[b] && v !== 0) trust.push({ civ: b, name: sim.civs[b]!.name, value: Math.round(v * 10) / 10 });
  }
  return {
    civ,
    shares,
    follows,
    followsName: follows >= 0 ? st.name[follows] : '',
    stateFaith: sf,
    stateFaithName: sf >= 0 ? st.name[sf] : '',
    effects,
    creed: st.creed[civ],
    trust,
  };
}

/** The faith of a hex for the hex panel: its religions by believers (the last yearly count). */
export type HexFaith = { religions: { religion: number; name: string; believers: number; share: number }[]; people: number };

export function hexFaith(sim: Simulation, cell: number): HexFaith | null {
  const st = sim.religion;
  const n = sim.cellPop[cell];
  if (n === 0) return null;
  const religions: HexFaith['religions'] = [];
  for (let r = 0; r < MAXR; r++) {
    const b = st.cellBel[cell * MAXR + r];
    if (b > 0 && st.alive[r]) religions.push({ religion: r, name: st.name[r], believers: b, share: b / n });
  }
  religions.sort((a, b) => b.believers - a.believers);
  return { religions, people: n };
}

/** A settlement's loyalty for the hex panel (Mandat 9): the value, its target's parts, restless ("May rebel"), its countdown. */
export type HexLoyalty = {
  loyalty: number;
  /** Capital: always 100, never restless. */
  capital: boolean;
  terms: Term[];
  restless: boolean;
  /** Restless below this (45 / the rebel lever). */
  threshold: number;
  /** The bloc's countdown: "at the latest in N years" (N = 10 − years run), -1 without one; 1 if faith is its worst part. */
  latestIn: number;
  overFaith: boolean;
};

export function hexLoyalty(sim: Simulation, cell: number): HexLoyalty | null {
  const m = sim.mandate;
  const o = sim.world.owner[cell];
  if (sim.cellPop[cell] === 0 || o === 0 || m.loyalty[cell] < 0) return null;
  const capital = sim.civs[o]?.capital === cell;
  const p = loyaltyParts(sim, cell);
  const terms: Term[] = capital
    ? []
    : [
        { label: 'Base', value: MANDATE.base },
        { label: 'Reach', value: p.reach },
        { label: 'Satisfaction', value: p.satisfaction },
        { label: 'Faith', value: p.faith },
        { label: 'Legitimacy', value: p.legitimacy },
        { label: 'Garrison', value: p.garrison },
        { label: 'Grace', value: p.grace },
        { label: 'Reconciled', value: p.reconciled },
      ].filter((t) => t.label === 'Base' || Math.abs(t.value) >= 0.05);
  const id = m.blocId[cell];
  const year = Math.floor(sim.tick / 52);
  const latestIn = id >= 0 && m.blocActive[id] ? Math.max(0, MANDATE.countdownMin + MANDATE.countdownRoll - (year - m.blocStart[id])) : -1;
  return {
    loyalty: m.loyalty[cell],
    capital,
    terms,
    restless: m.restless[cell] === 1,
    threshold: restlessBelow(sim, o),
    latestIn,
    overFaith: id >= 0 && m.blocFaith[id] === 1,
  };
}

/** A people's Mandate for "Mandate ›": legitimacy with parts, restless settlements, countdowns, vassals and tribute. */
export type CivMandate = {
  civ: number;
  legitimacy: number;
  legitimacyTerms: Term[];
  restless: number;
  /** Running countdowns: settlements, "at the latest in N years", over faith. */
  countdowns: { settlements: number; latestIn: number; overFaith: boolean }[];
  /** Its mother if it is a vassal (-1 none) and her name. */
  vassalOf: number;
  vassalOfName: string;
  /** Its vassals with the tribute they paid this year. */
  vassals: { civ: number; name: string; tribute: number }[];
  tributePaid: number;
  tributeGot: number;
};

export function civMandate(sim: Simulation, civ: number): CivMandate | null {
  const m = sim.mandate;
  const s = sim.leaders;
  if (civ <= 0 || civ >= LEADER_CIVS || !sim.civs[civ]) return null;
  const year = Math.floor(sim.tick / 52);
  const terms: Term[] = [];
  if (s.has[civ]) {
    const years = (sim.tick - s.start[civ]) / 52;
    terms.push({ label: 'Years in office', value: Math.min(MANDATE.tenureMax, Math.floor(years / MANDATE.tenureYears)) });
    const age = s.age0[civ] + years;
    if (age > MANDATE.oldAge) terms.push({ label: 'Old ruler', value: -Math.min(MANDATE.oldMax, MANDATE.oldPer * (age - MANDATE.oldAge)) });
  }
  if (Math.abs(m.succ[civ]) >= 0.05) terms.push({ label: 'New ruler', value: m.succ[civ] });
  if (Math.abs(m.legitEvents[civ]) >= 0.05) terms.push({ label: 'Wars, goals and unrest', value: m.legitEvents[civ] });
  if (sim.civs[civ]!.worshipsPlayer) terms.push({ label: 'Blessed by you', value: MANDATE.worship });
  if (sim.gacha.godLegit[civ] !== 0) terms.push({ label: 'Decree of Grace', value: sim.gacha.godLegit[civ] });
  const countdowns: CivMandate['countdowns'] = [];
  for (let k = 0; k < BLOCS; k++) {
    if (!m.blocActive[k] || m.blocCiv[k] !== civ) continue;
    let n = 0;
    for (let c = 0; c < sim.world.cellCount; c++) if (m.blocId[c] === k) n++;
    countdowns.push({ settlements: n, latestIn: Math.max(0, MANDATE.countdownMin + MANDATE.countdownRoll - (year - m.blocStart[k])), overFaith: m.blocFaith[k] === 1 });
  }
  const vassals: CivMandate['vassals'] = [];
  for (let v = 1; v < sim.civs.length && v < LEADER_CIVS; v++) if (m.vassalOf[v] === civ && sim.civs[v]) vassals.push({ civ: v, name: sim.civs[v]!.name, tribute: m.tributePaid[v] });
  const mother = m.vassalOf[civ];
  let restless = 0;
  for (let c = 0; c < sim.world.cellCount; c++) if (m.restless[c] && sim.world.owner[c] === civ) restless++;
  return {
    civ,
    legitimacy: m.legit[civ],
    legitimacyTerms: terms,
    restless,
    countdowns,
    vassalOf: mother,
    vassalOfName: mother > 0 ? sim.civs[mother]?.name ?? '' : '',
    vassals,
    tributePaid: m.tributePaid[civ],
    tributeGot: m.tributeGot[civ],
  };
}

export { NO_RELIGION };

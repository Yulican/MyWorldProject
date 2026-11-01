import { DIRECTION_COUNT } from '../hex';
import { MinHeap } from '../minHeap';
import type { Term } from '../terms';
import { isWaterBiome } from '../world/biomes';
import { stepCost } from '../world/roads';
import type { CivMood } from './satisfaction';
import type { Simulation } from './simulation';
import { MONEY_PER_ADULT, TRADE_GOODS, TRADE_GOOD_NAMES, TradeGood, addStock, exportHub } from './trade';

// Diplomacy, stage 1 (agreed requirement: "Design Documents/Requirement
// Diplomatie.md"): every people rates every people it knows by trust and
// danger (0..100, directed), opens its borders to those it trusts, and makes
// free trade, trade and migration agreements. Travelers through open
// foreign land pay toll to the settlements they cross (see payToll).
// Pair data is indexed a * PAIRS + b (a's view of b), with a fixed stride,
// so civilization ids never need re-indexing.

/** Civilization ids are below this (MAX_CIV_ID + 1). */
export const PAIRS = 256;
/** Two peoples meet once two of their settlements are this close (travel cost over land). */
export const CONTACT_REACH = 10;
/** Trust: the base value, plus up to PEACE_MAX from years of peaceful neighborhood (PEACE_PER_YEAR × nearness). */
export const TRUST_BASE = 20;
export const PEACE_PER_YEAR = 1;
export const PEACE_MAX = 40;
/** Trust per agreement in force and per border the other opened to us. */
export const AGREEMENT_TRUST = 5;
/** One-time trust for an opened border or a new agreement, and the loss for a closed border or a broken agreement. */
export const EVENT_TRUST = 10;
export const CLOSED_TRUST = -20;
/** Trust lost per group of people that moved to the other without a migration agreement, at most MIGRATION_LOSS_MAX. */
export const MIGRATION_LOSS = -5;
const MIGRATION_LOSS_MAX = -20;
/** Danger: this × the other's population over our own (at most 100), times nearness. */
export const DANGER_SCALE = 50;
/** Borders open at this trust and danger, and close below / above these. */
export const OPEN_TRUST = 50;
export const OPEN_DANGER = 40;
export const CLOSE_TRUST = 35;
export const CLOSE_DANGER = 60;
/** Mutual trust for a free trade, a trade and a migration agreement; a migration agreement ends below MIGRATION_END_TRUST. */
export const FREE_TRADE_TRUST = 55;
export const TRADE_AGREEMENT_TRUST = 45;
export const MIGRATION_TRUST = 60;
const MIGRATION_END_TRUST = 40;
/** A trade agreement runs this long, delivers at most this much per year, and breaks after BREACH_YEARS below BREACH_SHARE. */
export const AGREEMENT_YEARS = 10;
const AGREEMENT_MAX_AMOUNT = 20;
const AGREEMENT_MIN_AMOUNT = 2;
const BREACH_SHARE = 0.5;
const BREACH_YEARS = 2;
/** Land cut off by a closed border gets this long to be connected again before it breaks away. */
export const GRACE_YEARS = 5;
/** Toll in money per foreign settlement crossed, before trust and scarcity; free trade partners and trade agreements pay TOLL_REDUCED of it. */
export const TOLL_BASE = 2;
export const TOLL_REDUCED = 0.5;
/** Moods between peoples fade over this many years. */
const MOOD_YEARS = 10;
const TICKS_PER_YEAR = 52;

/** A trade agreement: `supplier` delivers `amount` units of `good` a year to `buyer`'s settlements. */
export type TradeAgreement = {
  supplier: number;
  buyer: number;
  good: number;
  amount: number;
  /** Tick it was made or last renewed. */
  since: number;
  /** Delivered in the running agreement year (it starts with the agreement). */
  delivered: number;
  /** Tick the running agreement year started. */
  yearStart: number;
  /** The supplier's settlement that ships the deliveries (trade.ts: exportHub), -1 = none. */
  hub: number;
  /** Years in a row it delivered less than BREACH_SHARE. */
  shortYears: number;
};

export type Diplomacy = {
  /** 1 when a and b know each other (symmetric). */
  known: Uint8Array;
  /** Travel cost between their nearest settlements at the last yearly update (symmetric), Infinity beyond reach. */
  distance: Float32Array;
  /** Trust a gained from years of peaceful neighborhood with b. */
  peace: Float32Array;
  /** Trust and danger of a towards b, from the last yearly update. */
  trust: Float32Array;
  danger: Float32Array;
  /** 1 when a opened its borders to b. */
  open: Uint8Array;
  /** 1 for a free trade or migration agreement between a and b (symmetric). */
  freeTrade: Uint8Array;
  migration: Uint8Array;
  /** a's moods towards b (key a * PAIRS + b), fading over MOOD_YEARS. */
  moods: Map<number, CivMood[]>;
  agreements: TradeAgreement[];
  /** Tick a settlement was first found cut off from its capital by a closed border, -1 = not cut off. */
  cutOffSince: Int32Array;
  /** Increases when any border opens or closes (the map and the cut-off check follow). */
  bordersVersion: number;
  /** Toll paid so far, in money value, for statistics. */
  tollPaid: number;
  /** Per people: peoples its merchants trade with (free trade partners, buyers of its trade agreements); see rebuildPartners. */
  partners: number[][];
  /** Tick until which no new trade agreement is made for a supplier, buyer and good (after one broke or ran out). */
  agreementPause: Map<number, number>;
  /** Highest civilization id used so far: pair loops stop there. */
  maxId: number;
};

export function createDiplomacy(cellCount: number): Diplomacy {
  const pairs = PAIRS * PAIRS;
  return {
    known: new Uint8Array(pairs),
    distance: new Float32Array(pairs).fill(Infinity),
    peace: new Float32Array(pairs),
    trust: new Float32Array(pairs),
    danger: new Float32Array(pairs),
    open: new Uint8Array(pairs),
    freeTrade: new Uint8Array(pairs),
    migration: new Uint8Array(pairs),
    moods: new Map(),
    agreements: [],
    cutOffSince: new Int32Array(cellCount).fill(-1),
    bordersVersion: 0,
    tollPaid: 0,
    partners: [],
    agreementPause: new Map(),
    maxId: 0,
  };
}

const pair = (a: number, b: number) => a * PAIRS + b;

/** Forgets everything about a civilization id (a new people gets a reused id). */
export function resetCivRelations(dip: Diplomacy, id: number): void {
  dip.maxId = Math.max(dip.maxId, id);
  for (let other = 0; other <= dip.maxId; other++) {
    for (const k of [pair(id, other), pair(other, id)]) {
      dip.known[k] = 0;
      dip.distance[k] = Infinity;
      dip.peace[k] = 0;
      dip.trust[k] = 0;
      dip.danger[k] = 0;
      if (dip.open[k]) dip.bordersVersion++;
      dip.open[k] = 0;
      dip.freeTrade[k] = 0;
      dip.migration[k] = 0;
      dip.moods.delete(k);
    }
  }
  dip.agreements = dip.agreements.filter((a) => a.supplier !== id && a.buyer !== id);
  rebuildPartners(dip);
}

/** Every people's trade partners, after agreements changed. */
function rebuildPartners(dip: Diplomacy): void {
  const partners: number[][] = [];
  for (let a = 1; a <= dip.maxId; a++) {
    for (let b = 1; b <= dip.maxId; b++) if (dip.freeTrade[pair(a, b)]) (partners[a] ??= []).push(b);
  }
  for (const t of dip.agreements) {
    const list = (partners[t.supplier] ??= []);
    if (!list.includes(t.buyer)) list.push(t.buyer);
  }
  dip.partners = partners;
}

/** Whether travelers of `traveler` may cross land of `owner`: their own, free land, or borders opened to them. */
export function mayPass(dip: Diplomacy, traveler: number, owner: number): boolean {
  return owner === 0 || owner === traveler || dip.open[pair(owner, traveler)] === 1;
}

export function hasFreeTrade(dip: Diplomacy, a: number, b: number): boolean {
  return dip.freeTrade[pair(a, b)] === 1;
}

/** The trade agreement in which `supplier` delivers `good` to `buyer`, if any. */
export function agreementFor(dip: Diplomacy, supplier: number, buyer: number, good: number): TradeAgreement | null {
  for (const a of dip.agreements) if (a.supplier === supplier && a.buyer === buyer && a.good === good) return a;
  return null;
}

/** Whether `supplier` has any trade agreement to deliver to `buyer`. */
export function suppliesTo(dip: Diplomacy, supplier: number, buyer: number): boolean {
  for (const a of dip.agreements) if (a.supplier === supplier && a.buyer === buyer) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Moods

function moodNow(mood: CivMood, tick: number): number {
  const age = (tick - mood.tick) / TICKS_PER_YEAR;
  return age >= MOOD_YEARS ? 0 : mood.value * (1 - age / MOOD_YEARS);
}

/** a's new mood towards b; one of the same label replaces the old one. */
function addMood(dip: Diplomacy, a: number, b: number, label: string, value: number, tick: number): void {
  const k = pair(a, b);
  const list = (dip.moods.get(k) ?? []).filter((m) => m.label !== label);
  list.push({ label, value, tick });
  dip.moods.set(k, list);
}

/**
 * People of `from` moved to a settlement of `to`: without a migration
 * agreement, `from` trusts `to` less (MIGRATION_LOSS per group, adding up to
 * MIGRATION_LOSS_MAX).
 */
export function noteEmigration(sim: Simulation, from: number, to: number): void {
  const dip = sim.diplomacy;
  if (from === to || dip.migration[pair(from, to)]) return;
  const k = pair(from, to);
  const list = dip.moods.get(k) ?? [];
  const label = 'Took our people';
  let sum = 0;
  for (const m of list) if (m.label === label) sum += moodNow(m, sim.tick);
  if (sum <= MIGRATION_LOSS_MAX) return;
  list.push({ label, value: Math.max(MIGRATION_LOSS, MIGRATION_LOSS_MAX - sum), tick: sim.tick });
  dip.moods.set(k, list);
}

// ---------------------------------------------------------------------------
// Trust and danger

/** How a's trust in b comes about (the sum, clamped to 0..100, is the trust). */
export function trustTerms(sim: Simulation, a: number, b: number): Term[] {
  const dip = sim.diplomacy;
  const k = pair(a, b);
  const terms: Term[] = [{ label: 'Base', value: TRUST_BASE }];
  if (dip.peace[k] > 0) terms.push({ label: 'Peaceful neighbors', value: dip.peace[k] });
  if (dip.open[pair(b, a)]) terms.push({ label: 'Their borders are open to us', value: AGREEMENT_TRUST });
  if (dip.freeTrade[k]) terms.push({ label: 'Free trade agreement', value: AGREEMENT_TRUST });
  if (dip.migration[k]) terms.push({ label: 'Migration agreement', value: AGREEMENT_TRUST });
  let deals = 0;
  for (const t of dip.agreements) if ((t.supplier === a && t.buyer === b) || (t.supplier === b && t.buyer === a)) deals++;
  if (deals > 0) terms.push({ label: `Trade agreements (${deals})`, value: deals * AGREEMENT_TRUST });
  for (const m of dip.moods.get(k) ?? []) {
    const v = moodNow(m, sim.tick);
    if (v !== 0) terms.push({ label: m.label, value: v });
  }
  return terms;
}

/** How dangerous b looks to a: its size against ours, the nearer the worse. */
export function dangerTerms(sim: Simulation, a: number, b: number): Term[] {
  const civA = sim.civs[a];
  const civB = sim.civs[b];
  if (!civA || !civB) return [];
  const size = Math.min(100, (DANGER_SCALE * civB.population) / Math.max(1, civA.population));
  const near = nearness(sim.diplomacy.distance[pair(a, b)]);
  return [
    { label: `Size: ${civB.population} people against our ${civA.population}`, value: size },
    { label: `Distance ${distanceText(sim.diplomacy.distance[pair(a, b)])} (nearness ${Math.round(near * 100)} %)`, value: size * near - size },
  ];
}

/** 1 for neighbors, 0 at or beyond CONTACT_REACH. */
export function nearness(distance: number): number {
  return Number.isFinite(distance) ? Math.max(0, 1 - distance / CONTACT_REACH) : 0;
}

const distanceText = (d: number) => (Number.isFinite(d) ? d.toFixed(1) : 'out of reach');
const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

function sumTerms(terms: readonly Term[]): number {
  let s = 0;
  for (const t of terms) s += t.value;
  return s;
}

// ---------------------------------------------------------------------------
// Toll

/**
 * Toll in money value a settlement asks of travelers of `traveler` (pair
 * with its people `owner`): TOLL_BASE, less the more it trusts them, double
 * when it is short itself (asks for goods, or has less money than a year's
 * income), and TOLL_REDUCED of that for free trade partners and trade
 * agreement deliveries.
 */
export function tollValue(sim: Simulation, cell: number, owner: number, traveler: number, reduced: boolean): number {
  const trust = sim.diplomacy.trust[pair(owner, traveler)];
  const short = isShort(sim, cell) ? 1 : 0;
  return TOLL_BASE * (1 - trust / 100) * (1 + short) * (reduced ? TOLL_REDUCED : 1);
}

function isShort(sim: Simulation, cell: number): boolean {
  if (sim.economy.money[cell] < sim.cellAdults[cell] * MONEY_PER_ADULT) return true;
  const want = sim.trade.want;
  for (let g = cell * TRADE_GOODS, end = g + TRADE_GOODS; g < end; g++) if (want[g] > 0) return true;
  return false;
}

/**
 * Pays `value` of toll to the settlement `to`: first in goods it asks for,
 * from `available(good)` (a merchant's load, or a settlement's stock) taken
 * by `take`, at `price` per unit; the rest in money from `payer`. Returns
 * false (nothing paid) if goods and money don't cover it.
 */
export function payToll(
  sim: Simulation,
  to: number,
  value: number,
  available: (good: number) => number,
  take: (good: number, units: number) => void,
  price: readonly number[],
  payer: number,
): boolean {
  if (value <= 0) return true;
  const want = sim.trade.want;
  const t = to * TRADE_GOODS;
  // What could be paid in goods it asks for, then whether money covers the rest.
  let inGoods = 0;
  for (let g = 0; g < TRADE_GOODS; g++) {
    if (g !== TradeGood.Money) inGoods += Math.min(want[t + g], available(g)) * price[g];
  }
  if (inGoods + sim.economy.money[payer] < value) return false;
  let rest = value;
  for (let g = 0; g < TRADE_GOODS && rest > 0; g++) {
    if (g === TradeGood.Money) continue;
    const units = Math.min(want[t + g], available(g), rest / price[g]);
    if (units <= 0) continue;
    take(g, units);
    addStock(sim.economy, to, g, units);
    want[t + g] -= units;
    rest -= units * price[g];
  }
  if (rest > 0) {
    sim.economy.money[payer] -= rest;
    sim.economy.money[to] += rest;
  }
  sim.diplomacy.tollPaid += value;
  return true;
}

// ---------------------------------------------------------------------------
// Yearly update

/** Travel cost over land from a people's settlements, reset after each search. */
let reach = new Float32Array(0);
const reachHeap = new MinHeap(256);
const reachTouched: number[] = [];

/**
 * Weekly: for the peoples whose id falls on this week of the year (id modulo
 * the weeks), the travel cost from their settlements to the nearest
 * settlement of every other people within CONTACT_REACH (over any land,
 * roads cheaper), into `dip.distance` both ways. So every people is
 * measured once a year and no single week carries them all; the yearly
 * update uses what was measured last.
 */
export function measureDistances(sim: Simulation, owner: Uint8Array): void {
  const { world } = sim;
  const dip = sim.diplomacy;
  const n = world.cellCount;
  if (reach.length !== n) reach = new Float32Array(n).fill(Infinity);
  const week = sim.tick % TICKS_PER_YEAR;
  const turn: number[] = [];
  for (let id = week === 0 ? TICKS_PER_YEAR : week; id < sim.civs.length; id += TICKS_PER_YEAR) if (sim.civs[id]) turn.push(id);
  if (turn.length === 0) return;
  for (const a of turn) {
    for (let b = 1; b < sim.civs.length; b++) {
      if (b === a) continue;
      dip.distance[pair(a, b)] = Infinity;
      dip.distance[pair(b, a)] = Infinity;
    }
    for (let c = 0; c < n; c++) {
      if (owner[c] !== a || sim.cellPop[c] === 0) continue;
      reach[c] = 0;
      reachTouched.push(c);
      reachHeap.push(c, 0);
    }
    while (reachHeap.size > 0) {
      const c = reachHeap.pop();
      const here = reach[c];
      const b = owner[c];
      if (b !== 0 && b !== a && sim.cellPop[c] > 0 && here < dip.distance[pair(a, b)]) {
        dip.distance[pair(a, b)] = here;
        dip.distance[pair(b, a)] = here;
      }
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const nb = world.neighbors[c * DIRECTION_COUNT + d];
        if (nb < 0 || isWaterBiome(world.biome[nb])) continue;
        const next = here + stepCost(world, c, d);
        if (next >= reach[nb] || next > CONTACT_REACH) continue;
        if (reach[nb] === Infinity) reachTouched.push(nb);
        reach[nb] = next;
        reachHeap.push(nb, next);
      }
    }
    for (const c of reachTouched) reach[c] = Infinity;
    reachTouched.length = 0;
  }
}

/** A chronicle entry at a hex (simulation.ts: record), passed in to avoid an import cycle. */
export type Record = (text: string, cell: number) => void;

/**
 * Yearly: who meets whom, peaceful neighborhood, trust and danger; then
 * every people decides on its borders and agreements, in id order. Trade
 * agreements that ran out are renewed or end; one that delivered too little
 * for BREACH_YEARS breaks. `trade` holds what each people asks for and
 * spares in total (civ * goods + good).
 */
export function updateDiplomacy(sim: Simulation, owner: Uint8Array, record: Record): void {
  const dip = sim.diplomacy;
  const { civWant, civSpare } = sim.trade;
  const goods = TRADE_GOODS;
  const goodName = (g: number) => TRADE_GOOD_NAMES[g];
  const living: number[] = [];
  for (let id = 1; id < sim.civs.length; id++) if (sim.civs[id]) living.push(id);
  const name = (id: number) => sim.civs[id]!.name;
  const capital = (id: number) => sim.civs[id]!.capital;

  // Contact and peaceful neighborhood.
  for (const a of living) {
    for (const b of living) {
      if (a >= b) continue;
      const k = pair(a, b);
      if (!dip.known[k] && dip.distance[k] <= CONTACT_REACH) {
        dip.known[k] = 1;
        dip.known[pair(b, a)] = 1;
        record(`The ${name(a)} and the ${name(b)} met.`, capital(b));
      }
      if (!dip.known[k]) continue;
      const near = nearness(dip.distance[k]);
      dip.peace[k] = Math.min(PEACE_MAX, dip.peace[k] + PEACE_PER_YEAR * near);
      dip.peace[pair(b, a)] = Math.min(PEACE_MAX, dip.peace[pair(b, a)] + PEACE_PER_YEAR * near);
    }
  }
  // Faded moods go.
  for (const [k, list] of dip.moods) {
    const kept = list.filter((m) => sim.tick - m.tick < MOOD_YEARS * TICKS_PER_YEAR);
    if (kept.length) dip.moods.set(k, kept);
    else dip.moods.delete(k);
  }
  refreshRelations(sim, living);

  const trust = (a: number, b: number) => dip.trust[pair(a, b)];
  const danger = (a: number, b: number) => dip.danger[pair(a, b)];
  const mutual = (a: number, b: number, min: number) => trust(a, b) >= min && trust(b, a) >= min;

  for (const a of living) {
    for (const b of living) {
      if (a === b || !dip.known[pair(a, b)]) continue;
      // Borders: open to those we trust and don't fear; close when that ends.
      const k = pair(a, b);
      if (!dip.open[k] && trust(a, b) >= OPEN_TRUST && danger(a, b) <= OPEN_DANGER) {
        dip.open[k] = 1;
        dip.bordersVersion++;
        addMood(dip, b, a, 'Opened their borders to us', EVENT_TRUST, sim.tick);
        record(`The ${name(a)} opened their borders to the ${name(b)}.`, capital(a));
      } else if (dip.open[k] && (trust(a, b) < CLOSE_TRUST || danger(a, b) > CLOSE_DANGER)) {
        closeBorders(sim, a, b, record);
      }
    }
  }
  refreshRelations(sim, living);

  for (const a of living) {
    for (const b of living) {
      if (a >= b || !dip.known[pair(a, b)]) continue;
      const k = pair(a, b);
      const both = dip.open[k] && dip.open[pair(b, a)];
      if (!dip.freeTrade[k] && both && mutual(a, b, FREE_TRADE_TRUST)) {
        setSymmetric(dip.freeTrade, a, b, 1);
        celebrate(dip, a, b, 'Signed free trade with us', sim.tick);
        record(`The ${name(a)} and the ${name(b)} agreed on free trade.`, capital(a));
      }
      if (!dip.migration[k] && mutual(a, b, MIGRATION_TRUST)) {
        setSymmetric(dip.migration, a, b, 1);
        celebrate(dip, a, b, 'Signed a migration agreement with us', sim.tick);
        record(`The ${name(a)} and the ${name(b)} agreed that their people may settle with each other.`, capital(a));
      } else if (dip.migration[k] && (trust(a, b) < MIGRATION_END_TRUST || trust(b, a) < MIGRATION_END_TRUST)) {
        setSymmetric(dip.migration, a, b, 0);
        record(`The migration agreement between the ${name(a)} and the ${name(b)} ended.`, capital(a));
      }
    }
  }

  // Trade agreements: deliveries of the year, renewals, new ones.
  const kept: TradeAgreement[] = [];
  const pause = (t: TradeAgreement) => dip.agreementPause.set(agreementKey(t.supplier, t.buyer, t.good), sim.tick + AGREEMENT_YEARS * TICKS_PER_YEAR);
  for (const t of dip.agreements) {
    if (!sim.civs[t.supplier] || !sim.civs[t.buyer]) continue;
    const what = `${goodName(t.good).toLowerCase()} from the ${name(t.supplier)} to the ${name(t.buyer)}`;
    // A full agreement year since it started: did enough arrive?
    if (sim.tick - t.yearStart >= TICKS_PER_YEAR) {
      // Short only while the buyer still lacks the good (its need comes and goes).
      const lacks = civWant[t.buyer * goods + t.good] - civSpare[t.buyer * goods + t.good] > 0;
      t.shortYears = lacks && t.delivered < BREACH_SHARE * t.amount ? t.shortYears + 1 : 0;
      t.delivered = 0;
      t.yearStart = sim.tick;
    }
    if (t.shortYears >= BREACH_YEARS) {
      addMood(dip, t.buyer, t.supplier, 'Broke a trade agreement with us', CLOSED_TRUST, sim.tick);
      record(`The trade agreement for ${what} broke: too little arrived.`, capital(t.buyer));
      pause(t);
      continue;
    }
    if (sim.tick - t.since >= AGREEMENT_YEARS * TICKS_PER_YEAR) {
      const amount = agreedAmount(civWant, civSpare, goods, t.supplier, t.buyer, t.good);
      if (amount < AGREEMENT_MIN_AMOUNT || !mutual(t.supplier, t.buyer, TRADE_AGREEMENT_TRUST)) {
        record(`The trade agreement for ${what} ran out.`, capital(t.buyer));
        pause(t);
        continue;
      }
      t.amount = amount;
      t.since = sim.tick;
    }
    // The hub may be gone or a better one may exist by now.
    if (sim.world.owner[t.hub] !== t.supplier || sim.tick - t.yearStart === 0) t.hub = exportHub(sim, t.supplier, t.buyer, t.good);
    kept.push(t);
  }
  dip.agreements = kept;
  for (const a of living) {
    for (const b of living) {
      if (a === b || !dip.known[pair(a, b)] || !mutual(a, b, TRADE_AGREEMENT_TRUST)) continue;
      // b delivers to a what a lacks and b has in plenty.
      for (let g = 0; g < goods; g++) {
        if (g === TradeGood.Money || agreementFor(dip, b, a, g)) continue;
        if ((dip.agreementPause.get(agreementKey(b, a, g)) ?? -1) > sim.tick) continue;
        const amount = agreedAmount(civWant, civSpare, goods, b, a, g);
        if (amount < AGREEMENT_MIN_AMOUNT) continue;
        const hub = exportHub(sim, b, a, g);
        if (hub < 0) continue;
        dip.agreements.push({ supplier: b, buyer: a, good: g, amount, since: sim.tick, delivered: 0, yearStart: sim.tick, shortYears: 0, hub });
        celebrate(dip, a, b, 'Signed a trade agreement with us', sim.tick);
        record(`The ${name(b)} agreed to deliver ${Math.round(amount)} ${goodName(g).toLowerCase()} a year to the ${name(a)}.`, capital(a));
      }
    }
  }
  rebuildPartners(dip);
  refreshRelations(sim, living);
}

const agreementKey = (supplier: number, buyer: number, good: number) => (supplier * PAIRS + buyer) * 64 + good;

/** Units a year `supplier` can deliver of `good` to `buyer`: what the buyer lacks and the supplier spares, at most AGREEMENT_MAX_AMOUNT. */
function agreedAmount(want: Float32Array, spare: Float32Array, goods: number, supplier: number, buyer: number, good: number): number {
  if (supplier * goods + good >= want.length || buyer * goods + good >= want.length) return 0;
  const lacks = want[buyer * goods + good] - spare[buyer * goods + good];
  const extra = spare[supplier * goods + good] - want[supplier * goods + good];
  return Math.min(lacks, extra, AGREEMENT_MAX_AMOUNT);
}

function setSymmetric(arr: Uint8Array, a: number, b: number, v: number): void {
  arr[pair(a, b)] = v;
  arr[pair(b, a)] = v;
}

/** Both sides of a new agreement trust each other EVENT_TRUST more for a while. */
function celebrate(dip: Diplomacy, a: number, b: number, label: string, tick: number): void {
  addMood(dip, a, b, label, EVENT_TRUST, tick);
  addMood(dip, b, a, label, EVENT_TRUST, tick);
}

/**
 * a closes its borders to b: every agreement between them ends, b trusts a
 * less (CLOSED_TRUST, fading) and its peaceful neighborhood starts over.
 */
export function closeBorders(sim: Simulation, a: number, b: number, record: Record): void {
  const dip = sim.diplomacy;
  dip.open[pair(a, b)] = 0;
  dip.bordersVersion++;
  setSymmetric(dip.freeTrade, a, b, 0);
  setSymmetric(dip.migration, a, b, 0);
  dip.agreements = dip.agreements.filter((t) => !((t.supplier === a && t.buyer === b) || (t.supplier === b && t.buyer === a)));
  addMood(dip, b, a, 'Closed their borders to us', CLOSED_TRUST, sim.tick);
  dip.peace[pair(b, a)] = 0;
  rebuildPartners(dip);
  record(`The ${sim.civs[a]!.name} closed their borders to the ${sim.civs[b]!.name}.`, sim.civs[a]!.capital);
}

/** Trust and danger of every known pair (the sums of their terms, computed without allocating). */
function refreshRelations(sim: Simulation, living: number[]): void {
  const dip = sim.diplomacy;
  for (const a of living) {
    for (const b of living) {
      if (a === b) continue;
      const k = pair(a, b);
      if (!dip.known[k]) continue;
      dip.trust[k] = trustValue(sim, a, b);
      dip.danger[k] = dangerValue(sim, a, b);
    }
  }
}

/**
 * a's trust in b: the sum of `trustTerms`, clamped to 0..100, from the same
 * values without allocating (the yearly update runs it for every known
 * pair; a test keeps both equal).
 */
export function trustValue(sim: Simulation, a: number, b: number): number {
  const dip = sim.diplomacy;
  const k = pair(a, b);
  let sum = TRUST_BASE + dip.peace[k];
  if (dip.open[pair(b, a)]) sum += AGREEMENT_TRUST;
  if (dip.freeTrade[k]) sum += AGREEMENT_TRUST;
  if (dip.migration[k]) sum += AGREEMENT_TRUST;
  for (const t of dip.agreements) if ((t.supplier === a && t.buyer === b) || (t.supplier === b && t.buyer === a)) sum += AGREEMENT_TRUST;
  const moods = dip.moods.get(k);
  if (moods) for (const m of moods) sum += moodNow(m, sim.tick);
  return clamp100(sum);
}

/** How dangerous b looks to a: the sum of `dangerTerms`, clamped to 0..100, without allocating. */
export function dangerValue(sim: Simulation, a: number, b: number): number {
  const civA = sim.civs[a];
  const civB = sim.civs[b];
  if (!civA || !civB) return 0;
  const size = Math.min(100, (DANGER_SCALE * civB.population) / Math.max(1, civA.population));
  return clamp100(size * nearness(sim.diplomacy.distance[pair(a, b)]));
}

/** Relations of one people to another for the diplomacy panel (allocates; UI only). */
export type Relation = {
  other: number;
  trust: number;
  danger: number;
  trustTerms: Term[];
  dangerTerms: Term[];
  /** Their trust and danger towards us. */
  theirTrust: number;
  theirDanger: number;
  weOpen: boolean;
  theyOpen: boolean;
  freeTrade: boolean;
  migration: boolean;
  /** Trade agreements between the two, as "12 wood a year to the X". */
  deals: string[];
  distance: number;
};

export function relationsOf(sim: Simulation, a: number): Relation[] {
  const dip = sim.diplomacy;
  const goodName = (g: number) => TRADE_GOOD_NAMES[g];
  const out: Relation[] = [];
  for (let b = 1; b < sim.civs.length; b++) {
    if (b === a || !sim.civs[b] || !dip.known[pair(a, b)]) continue;
    const deals = dip.agreements
      .filter((t) => (t.supplier === a && t.buyer === b) || (t.supplier === b && t.buyer === a))
      .map((t) => `${Math.round(t.amount)} ${goodName(t.good).toLowerCase()} a year to the ${sim.civs[t.buyer]!.name}`);
    out.push({
      other: b,
      trust: dip.trust[pair(a, b)],
      danger: dip.danger[pair(a, b)],
      trustTerms: trustTerms(sim, a, b),
      dangerTerms: dangerTerms(sim, a, b),
      theirTrust: dip.trust[pair(b, a)],
      theirDanger: dip.danger[pair(b, a)],
      weOpen: dip.open[pair(a, b)] === 1,
      theyOpen: dip.open[pair(b, a)] === 1,
      freeTrade: dip.freeTrade[pair(a, b)] === 1,
      migration: dip.migration[pair(a, b)] === 1,
      deals,
      distance: dip.distance[pair(a, b)],
    });
  }
  return out;
}

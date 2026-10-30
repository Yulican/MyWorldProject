import { DIRECTION_COUNT } from '../hex';
import { MinHeap } from '../minHeap';
import { sumTerms, type Term } from '../terms';
import { stepCost } from '../world/roads';
import { GOOD_NAMES, FIRST_LUXURY, Good, LUXURY_COUNT, SLOTS, SlotState, BUILDINGS, type Economy } from './buildings';
import type { Civilization } from './civilizations';
import type { Simulation } from './simulation';
import { SUPPLY_KINDS, SUPPLY_NAMES } from './supply';

// Satisfaction of every settlement, -100..100 (design doc, section 6; the
// agreed requirement is "Design Documents/Requirement Zufriedenheit.md").
// Its target is the sum of named terms the hex info shows: missing food,
// water or space, crowding, the connection to the nearest seat of
// government, comfort, luxury goods and the people's recent history. The
// value follows its target slowly. Settlements below zero for years send
// people away and, joined by roads into a league, break away.

export const SATISFACTION_MAX = 100;
/** Share of the gap to the target closed per year. */
const FOLLOW_PER_YEAR = 0.25;
/** The same per quarter (the value is updated with every refresh). */
const FOLLOW_PER_QUARTER = 1 - Math.pow(1 - FOLLOW_PER_YEAR, 1 / 4);
/** Satisfaction per share of the people whose food, water or space is missing. */
const SHORTAGE = 100;
/** From this share of its capacity a hex feels crowded, down to CROWDING_MAX at full capacity. */
const CROWDING_FROM = 0.8;
const CROWDING_MAX = 5;
/** Connection: this much at a seat of government and up to CONNECTION_NEAR travel cost from it... */
export const CONNECTION_BEST = 10;
export const CONNECTION_NEAR = 0.5;
/** ...falling linearly to CONNECTION_WORST at CONNECTION_FAR and beyond (or without a road connection). */
export const CONNECTION_WORST = -20;
export const CONNECTION_FAR = 4;
/** Comfort when every inhabitant is served by a comfort building. */
const COMFORT_MAX = 15;
/** Per luxury good whose yearly need is covered, up to LUXURY_MAX. */
export const LUXURY_EACH = 5;
export const LUXURY_MAX = 15;
/** Units of each luxury good one inhabitant uses per year. */
export const LUXURY_PER_PERSON = 0.01;
/** Years a people's mood events (new people, revolutions) take to fade away. */
const MOOD_YEARS = 10;
export const MOOD_NEW_PEOPLE = 10;
export const MOOD_REVOLUTION_WON = 20;
export const MOOD_REVOLUTION_LOST = -5;
/** A settlement below zero this many years in a row is ready to break away. */
export const UNHAPPY_YEARS = 5;
export const UNHAPPY_QUARTERS = UNHAPPY_YEARS * 4;
/** Births and yields change by this share at ±100 satisfaction. */
const BIRTH_EFFECT = 0.25;
const YIELD_EFFECT = 0.2;

/** A mood a whole people shares for a while, e.g. after a revolution. */
export type CivMood = { label: string; value: number; tick: number };

const TICKS_PER_YEAR = 52;

/** Birth rate factor of a hex with this satisfaction. */
export function birthFactor(satisfaction: number): number {
  return 1 + (BIRTH_EFFECT * satisfaction) / SATISFACTION_MAX;
}

/** Wood, stone and luxury yield factor of a hex with this satisfaction (not food, water or space). */
export function yieldFactor(satisfaction: number): number {
  return 1 + (YIELD_EFFECT * satisfaction) / SATISFACTION_MAX;
}

/** Connection term for a travel cost to the nearest seat of government (Infinity = not connected). */
export function connectionValue(cost: number): number {
  if (cost <= CONNECTION_NEAR) return CONNECTION_BEST;
  if (cost >= CONNECTION_FAR) return CONNECTION_WORST;
  const t = (cost - CONNECTION_NEAR) / (CONNECTION_FAR - CONNECTION_NEAR);
  return CONNECTION_BEST + (CONNECTION_WORST - CONNECTION_BEST) * t;
}

/** Shortage term of one supply: the share of the people it doesn't cover. */
function shortageValue(supply: number, people: number): number {
  return -SHORTAGE * Math.max(0, 1 - supply / people);
}

/** Crowding term from people per capacity. */
function crowdingValue(crowding: number): number {
  return crowding > CROWDING_FROM ? -CROWDING_MAX * Math.min(1, (crowding - CROWDING_FROM) / (1 - CROWDING_FROM)) : 0;
}

/** A mood's value now: it fades linearly over MOOD_YEARS. */
function moodNow(mood: CivMood, tick: number): number {
  const age = (tick - mood.tick) / TICKS_PER_YEAR;
  return age >= MOOD_YEARS ? 0 : mood.value * (1 - age / MOOD_YEARS);
}

/** Adds a mood; one of the same label replaces the old one, so repeated events don't stack. */
export function addMood(civ: Civilization, label: string, value: number, tick: number): void {
  civ.moods = civ.moods.filter((m) => m.label !== label);
  civ.moods.push({ label, value, tick });
}

/** Drops faded moods (yearly). */
export function pruneMoods(civ: Civilization, tick: number): void {
  civ.moods = civ.moods.filter((m) => tick - m.tick < MOOD_YEARS * TICKS_PER_YEAR);
}

/** People one hex's standing comfort buildings serve. */
export function comfortServed(eco: Economy, cell: number): number {
  let served = 0;
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (eco.state[s] === SlotState.Standing && BUILDINGS[eco.type[s]].good === Good.Comfort) served += BUILDINGS[eco.type[s]].amount;
  }
  return served;
}

/** Comfort term for `served` people served out of `people`. */
export function comfortValue(served: number, people: number): number {
  return people > 0 ? COMFORT_MAX * Math.min(1, served / people) : 0;
}

/** Luxury term for a bitmask of covered goods. */
export function luxuryValue(covered: number): number {
  let n = 0;
  for (let k = 0; k < LUXURY_COUNT; k++) if (covered & (1 << k)) n++;
  return Math.min(LUXURY_MAX, n * LUXURY_EACH);
}

/** Whether a hex has a standing seat of government. */
export function hasSeat(eco: Economy, cell: number): boolean {
  for (let s = cell * SLOTS, end = s + SLOTS; s < end; s++) {
    if (eco.state[s] === SlotState.Standing && BUILDINGS[eco.type[s]].good === Good.Seat) return true;
  }
  return false;
}

/**
 * The terms of a settlement's target satisfaction, the sum of which is the
 * target. `civ` is the people living there (its moods count). The
 * simulation uses this same function through `satisfactionTarget`.
 */
export function satisfactionTerms(sim: Simulation, cell: number, civ: Civilization | null): Term[] {
  const terms: Term[] = [];
  const people = sim.cellPop[cell];
  if (people === 0) return terms;
  for (let k = 0; k < SUPPLY_KINDS; k++) {
    const v = shortageValue(sim.cellSupply[cell * SUPPLY_KINDS + k], people);
    if (v < 0) terms.push({ label: `${SUPPLY_NAMES[k]} missing for ${Math.round((-v / SHORTAGE) * 100)} %`, value: v });
  }
  const crowding = people / Math.max(1, sim.cellCapacity[cell]);
  if (crowding > CROWDING_FROM) terms.push({ label: `Crowded (${Math.round(crowding * 100)} % of capacity)`, value: crowdingValue(crowding) });
  const cost = sim.seatCost[cell];
  terms.push({
    label:
      cost === 0
        ? civ && civ.capital === cell
          ? 'Capital'
          : 'Seat of government'
        : Number.isFinite(cost)
          ? `Travel ${cost.toFixed(1)} to a seat of government`
          : 'No road to a seat of government',
    value: connectionValue(cost),
  });
  const served = comfortServed(sim.economy, cell);
  if (served > 0) terms.push({ label: `Comfort for ${Math.min(served, people)} of ${people}`, value: comfortValue(served, people) });
  const covered = sim.economy.luxuryCovered[cell];
  if (covered) {
    const names: string[] = [];
    for (let k = 0; k < LUXURY_COUNT; k++) if (covered & (1 << k)) names.push(GOOD_NAMES[FIRST_LUXURY + k]);
    terms.push({ label: `Luxury: ${names.join(', ')}`, value: luxuryValue(covered) });
  }
  if (civ) {
    for (const mood of civ.moods) {
      const v = moodNow(mood, sim.tick);
      if (v !== 0) terms.push({ label: mood.label, value: v });
    }
  }
  return terms;
}

/**
 * The target as a number: the sum of `satisfactionTerms`, computed from the
 * same values without allocating (the simulation runs this per settlement
 * every quarter; a test keeps both equal).
 */
export function satisfactionTarget(sim: Simulation, cell: number, civ: Civilization | null): number {
  const people = sim.cellPop[cell];
  if (people === 0) return 0;
  let sum = 0;
  for (let k = 0; k < SUPPLY_KINDS; k++) sum += shortageValue(sim.cellSupply[cell * SUPPLY_KINDS + k], people);
  sum += crowdingValue(people / Math.max(1, sim.cellCapacity[cell]));
  sum += connectionValue(sim.seatCost[cell]);
  sum += comfortValue(comfortServed(sim.economy, cell), people);
  sum += luxuryValue(sim.economy.luxuryCovered[cell]);
  if (civ) for (const mood of civ.moods) sum += moodNow(mood, sim.tick);
  return clampSatisfaction(sum);
}

const clampSatisfaction = (v: number) => Math.max(-SATISFACTION_MAX, Math.min(SATISFACTION_MAX, v));

/** Who holds each hex: the civilization with the most people there, 0 if empty. */
export function cellOwners(sim: Simulation): Uint8Array {
  const owner = new Uint8Array(sim.world.cellCount);
  for (let c = 0; c < owner.length; c++) {
    if (sim.cellPop[c] === 0) continue;
    let most = 0;
    for (let id = 1; id < sim.civSlots; id++) {
      const k = sim.cellCivPop[c * sim.civSlots + id];
      if (k > most) {
        most = k;
        owner[c] = id;
      }
    }
  }
  return owner;
}

const fieldHeap = new MinHeap(64);

/**
 * Travel cost from the nearest of `seats` to every hex of civilization `civ`
 * (Dijkstra through its own hexes only; roads make steps cheaper), at most
 * CONNECTION_FAR, written into `out` (which must hold Infinity elsewhere).
 * Returns the hexes it reached.
 */
export function seatField(sim: Simulation, owner: Uint8Array, civ: number, seats: readonly number[], out: Float32Array): number[] {
  const { world } = sim;
  const heap = fieldHeap;
  const reached: number[] = [];
  for (const s of seats) {
    if (owner[s] !== civ || out[s] === 0) continue;
    out[s] = 0;
    reached.push(s);
    heap.push(s, 0);
  }
  while (heap.size > 0) {
    const c = heap.pop();
    const here = out[c];
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb < 0 || owner[nb] !== civ) continue;
      const next = here + stepCost(world, c, d);
      if (next < out[nb] && next <= CONNECTION_FAR) {
        if (out[nb] === Infinity) reached.push(nb);
        out[nb] = next;
        heap.push(nb, next);
      }
    }
  }
  return reached;
}

/** Every civilization's seats of government: its capital and standing seats in hexes it holds. */
export function seatsOf(sim: Simulation, owner: Uint8Array): number[][] {
  const seats: number[][] = sim.civs.map((civ) => (civ ? [civ.capital] : []));
  for (let c = 0; c < owner.length; c++) {
    if (owner[c] && sim.hasBuildings[c] && hasSeat(sim.economy, c)) seats[owner[c]].push(c);
  }
  return seats;
}

/**
 * Quarterly: travel cost to the nearest seat of government, then every
 * settlement's satisfaction, which closes FOLLOW_PER_YEAR of the gap to its
 * target per year (a new settlement starts at its target), and the quarters
 * in a row it spent below zero. Also each people's mean satisfaction.
 */
export function updateSatisfaction(sim: Simulation, owner: Uint8Array): void {
  const n = sim.world.cellCount;
  sim.seatCost.fill(Infinity);
  const seats = seatsOf(sim, owner);
  for (let id = 1; id < sim.civSlots; id++) if (sim.civs[id]) seatField(sim, owner, id, seats[id], sim.seatCost);

  const sum = new Float64Array(sim.civSlots);
  const people = new Float64Array(sim.civSlots);
  for (let c = 0; c < n; c++) {
    if (sim.cellPop[c] === 0) {
      sim.satisfaction[c] = 0;
      sim.unhappyQuarters[c] = 0;
      sim.moodSet[c] = 0;
      continue;
    }
    const civ = sim.civs[owner[c]] ?? null;
    const target = satisfactionTarget(sim, c, civ);
    let value: number;
    if (sim.moodSet[c]) value = sim.satisfaction[c] + (target - sim.satisfaction[c]) * FOLLOW_PER_QUARTER;
    else {
      value = target;
      sim.moodSet[c] = 1;
    }
    sim.satisfaction[c] = value;
    sim.unhappyQuarters[c] = value < 0 ? Math.min(255, sim.unhappyQuarters[c] + 1) : 0;
    sum[owner[c]] += value * sim.cellPop[c];
    people[owner[c]] += sim.cellPop[c];
  }
  for (let id = 1; id < sim.civSlots; id++) {
    const civ = sim.civs[id];
    if (civ) civ.averageSatisfaction = people[id] > 0 ? sum[id] / people[id] : 0;
  }
}

/** Satisfaction of a hex for the hex info (allocates; UI only). */
export type HexSatisfaction = {
  value: number;
  target: number;
  terms: Term[];
  /** Years in a row below zero. */
  unhappyYears: number;
  /** Ready to break away with a league of such settlements. */
  restless: boolean;
  luxury: { name: string; stock: number; covered: boolean }[];
};

export function hexSatisfaction(sim: Simulation, cell: number): HexSatisfaction | null {
  if (sim.cellPop[cell] === 0) return null;
  const owner = cellOwnerOf(sim, cell);
  const terms = satisfactionTerms(sim, cell, sim.civs[owner] ?? null);
  const luxury: HexSatisfaction['luxury'] = [];
  for (let k = 0; k < LUXURY_COUNT; k++) {
    const stock = sim.economy.luxury[cell * LUXURY_COUNT + k];
    const covered = (sim.economy.luxuryCovered[cell] & (1 << k)) !== 0;
    if (stock > 0 || covered) luxury.push({ name: GOOD_NAMES[FIRST_LUXURY + k], stock, covered });
  }
  return {
    value: sim.satisfaction[cell],
    target: clampSatisfaction(sumTerms(terms)),
    terms,
    unhappyYears: Math.floor(sim.unhappyQuarters[cell] / 4),
    restless: sim.unhappyQuarters[cell] >= UNHAPPY_QUARTERS,
    luxury,
  };
}

function cellOwnerOf(sim: Simulation, cell: number): number {
  let owner = 0;
  let most = 0;
  for (let id = 1; id < sim.civSlots; id++) {
    const k = sim.cellCivPop[cell * sim.civSlots + id];
    if (k > most) {
      most = k;
      owner = id;
    }
  }
  return owner;
}

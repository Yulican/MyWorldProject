import type { Rng } from '../rng';
import { CULTURE_COUNT } from './culture';

/**
 * At most this many civilizations live at once (design doc: 3–6). Their ids
 * are slots 1..MAX_CIVS, stored per inhabitant in a Uint8Array; an extinct
 * civilization's slot is reused by the next one. Id 0 means "nobody".
 */
export const MAX_CIVS = 6;

/** How a civilization came to be. */
export type CivOrigin = 'start' | 'secession' | 'tribe';

/**
 * Why a civilization's believers changed over one year, so faith gains and
 * losses can be shown and explained. All values are numbers of people.
 */
export type FaithLedger = {
  /** Children born as believers. */
  born: number;
  /** Believers who died. */
  died: number;
  /** Became believers through their own devotion (worshipping civilizations only). */
  grewDevout: number;
  /** Became believers because the people around them believe. */
  wonByNeighbors: number;
  /** Stopped believing because the people around them believe less. */
  lostToNeighbors: number;
  /** Stopped believing because their civilization doesn't worship the player. */
  forgot: number;
};

export function emptyFaithLedger(): FaithLedger {
  return { born: 0, died: 0, grewDevout: 0, wonByNeighbors: 0, lostToNeighbors: 0, forgot: 0 };
}

export type Civilization = {
  id: number;
  name: string;
  /** Index into the map's civilization colors; stable for the civ's lifetime. */
  color: number;
  origin: CivOrigin;
  /** Name of the civilization it broke away from (secession only). */
  parentName: string | null;
  foundedTick: number;
  /** The player's own people. Breakaways and new tribes start without a god. */
  worshipsPlayer: boolean;
  /** CULTURE_COUNT values 0..1, see culture.ts. */
  culture: Float32Array;
  /** Cell the civilization measures its reach from; moves if abandoned. */
  capital: number;

  // Stats, refreshed with the map snapshot.
  population: number;
  /** Hexes where it is the largest group. */
  territory: number;
  /** Inhabitants with faith in the player of at least BELIEVER_FAITH. */
  believers: number;
  /** Mean faith in the player 0..1. */
  averageFaith: number;
  /** Believer changes in the running year, and in the last complete year. */
  faithYear: FaithLedger;
  faithLastYear: FaithLedger;
};

/** Number of distinct civilization colors the map offers. */
export const CIV_COLOR_COUNT = 8;

export function createCivilization(
  id: number,
  name: string,
  color: number,
  origin: CivOrigin,
  foundedTick: number,
  capital: number,
): Civilization {
  return {
    id,
    name,
    color,
    origin,
    parentName: null,
    foundedTick,
    worshipsPlayer: false,
    culture: new Float32Array(CULTURE_COUNT),
    capital,
    population: 0,
    territory: 0,
    believers: 0,
    averageFaith: 0,
    faithYear: emptyFaithLedger(),
    faithLastYear: emptyFaithLedger(),
  };
}

const ONSETS = ['k', 'r', 'm', 't', 'v', 'd', 'n', 'l', 'b', 'z', 'h', 's', 'th', 'sh', 'g', 'y'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'o'];
const CODAS = ['', '', '', 'n', 'r', 'l', 'th', 's', 'k'];

/** A short made-up people's name, e.g. "Karomi". Avoids names in `taken`. */
export function generateCivName(rng: Rng, taken: ReadonlySet<string>): string {
  for (let attempt = 0; ; attempt++) {
    const syllables = 2 + (rng() < 0.4 ? 1 : 0);
    let name = '';
    for (let s = 0; s < syllables; s++) {
      name += pick(rng, ONSETS) + pick(rng, VOWELS);
    }
    name += pick(rng, CODAS);
    name = name[0].toUpperCase() + name.slice(1);
    // Give up on uniqueness after many tries rather than loop forever.
    if (!taken.has(name) || attempt > 50) return name;
  }
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

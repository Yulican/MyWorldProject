import type { Rng } from '../rng';
import { CULTURE_COUNT } from './culture';

/**
 * Soft cap: new tribes only appear while fewer civilizations than this live
 * (design doc: 3–6). Peoples splitting off can go beyond it.
 */
export const MAX_CIVS = 6;
/**
 * Hard limit of civilizations alive at once: ids 1..MAX_CIV_ID are stored per
 * inhabitant and per hex in Uint8Arrays; an extinct civilization's id is
 * reused by the next one. Id 0 means "nobody".
 */
export const MAX_CIV_ID = 255;

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
  /** Believers who left with land cut off from the capital, founding their own people. */
  brokeAway: number;
};

export function emptyFaithLedger(): FaithLedger {
  return { born: 0, died: 0, grewDevout: 0, wonByNeighbors: 0, lostToNeighbors: 0, forgot: 0, brokeAway: 0 };
}

/** Net change in believers the ledger explains. */
export function ledgerNet(l: FaithLedger): number {
  return l.born - l.died + l.grewDevout + l.wonByNeighbors - l.lostToNeighbors - l.forgot - l.brokeAway;
}

export type Civilization = {
  id: number;
  name: string;
  /** Map color "#rrggbb", picked at random when founded (see pickCivColor). */
  color: string;
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

/** Candidate colors drawn per new civilization; the one most unlike the others wins. */
const COLOR_CANDIDATES = 12;

/**
 * A random, clearly visible color ("#rrggbb") whose hue differs as much as
 * possible from the colors of `taken` (the living civilizations).
 */
export function pickCivColor(rng: Rng, taken: readonly string[]): string {
  const takenHues = taken.map(hueOf);
  let best = '';
  let bestDistance = -1;
  for (let i = 0; i < COLOR_CANDIDATES; i++) {
    const hue = rng() * 360;
    const color = hslToHex(hue, 0.65 + 0.25 * rng(), 0.5 + 0.12 * rng());
    let distance = 360;
    for (const h of takenHues) {
      const d = Math.abs(hue - h) % 360;
      distance = Math.min(distance, d > 180 ? 360 - d : d);
    }
    if (distance > bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }
  return best;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Hue in degrees of a "#rrggbb" color. */
export function hueOf(color: string): number {
  const v = parseInt(color.slice(1), 16);
  const r = ((v >> 16) & 255) / 255;
  const g = ((v >> 8) & 255) / 255;
  const b = (v & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export function createCivilization(
  id: number,
  name: string,
  color: string,
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

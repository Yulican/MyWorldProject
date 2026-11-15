import type { SavedAppState } from './worldStore';

// The save file the app writes (Requirement Speichern und Laden 2): the
// simulation's save game (src/sim/save.ts, which checks its own version and
// checksum) followed by a short text trailer with what the app keeps beside
// it: the game speed, the chronicle entries seen and what the menu panel
// shows (the world's age and the save time), readable without loading the world.
//
//   simulation save game (bytes, length in its own header)
//   "\n" + JSON of SaveMeta
//   8 decimal digits: the JSON's length in bytes
//   "MWAP"
//
// The trailer is plain ASCII, so the file is written in two parts (the
// bytes, then the text appended) without copying the world into a new buffer.

export const TRAILER_MAGIC = 'MWAP';
const LENGTH_DIGITS = 8;
/** Format version of the trailer (the world's own version is in its header). */
export const APP_SAVE_VERSION = 1;

/** What the app stores beside the world. */
export type SaveMeta = SavedAppState & {
  v: number;
  /** The world's age in years (simulationYear) and the save time (ms since 1970), for the menu panel. */
  year: number;
  savedAt: number;
};

/** The text appended to the simulation's save game. */
export function saveTrailer(meta: SaveMeta): string {
  const json = JSON.stringify(meta);
  return `\n${json}${String(json.length).padStart(LENGTH_DIGITS, '0')}${TRAILER_MAGIC}`;
}

export type SaveFile = { ok: true; meta: SaveMeta; world: Uint8Array } | { ok: false; message: string };

/** Splits a save file into its trailer and the simulation's save game (unchecked: deserializeWorld checks it). */
export function readSaveFile(bytes: Uint8Array): SaveFile {
  const n = bytes.length;
  const tail = TRAILER_MAGIC.length + LENGTH_DIGITS;
  if (n < tail + 1 || ascii(bytes, n - TRAILER_MAGIC.length, n) !== TRAILER_MAGIC) {
    return { ok: false, message: 'Not a save file.' };
  }
  const digits = ascii(bytes, n - tail, n - TRAILER_MAGIC.length);
  const length = /^\d+$/.test(digits) ? Number(digits) : -1;
  const jsonStart = n - tail - length;
  if (length < 2 || jsonStart < 1 || bytes[jsonStart - 1] !== 10) return { ok: false, message: 'Save file is damaged.' };
  let meta: unknown;
  try {
    meta = JSON.parse(ascii(bytes, jsonStart, n - tail));
  } catch {
    return { ok: false, message: 'Save file is damaged.' };
  }
  if (!isMeta(meta)) return { ok: false, message: 'Save file is damaged.' };
  if (meta.v !== APP_SAVE_VERSION) return { ok: false, message: `Save file version ${meta.v}, this game reads ${APP_SAVE_VERSION}.` };
  return { ok: true, meta, world: bytes.subarray(0, jsonStart - 1) };
}

function isMeta(m: unknown): m is SaveMeta {
  if (typeof m !== 'object' || m === null) return false;
  const r = m as Record<string, unknown>;
  return ['v', 'year', 'savedAt', 'speed', 'resumeSpeed', 'chronicleSeen'].every((k) => typeof r[k] === 'number');
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let s = '';
  for (let i = from; i < to; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** The bytes of a trailer (tests and the in-memory slot; the file appends the text itself). */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

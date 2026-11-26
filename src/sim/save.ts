import { createRng, isRng, rngState, setRngState } from './rng';
import type { Simulation } from './society/simulation';

// Save games: the whole simulation state as one compact byte block, and back.
// No file I/O here: the app writes and reads the bytes.
//
// The state is a graph of plain objects, arrays, Maps, Sets, typed arrays and
// random generators (see Simulation and its parts). The format writes that
// graph as a tagged value stream, so every field of the state is saved
// without a list to keep in step with the code, and a loaded world continues
// bit-identically (save.test.ts). Shared and cyclic references stay shared
// (back references by id); typed arrays are their raw little-endian bytes,
// with runs of a repeated 32-bit word written once (the pair tables of
// 256 × 256 peoples are mostly empty), so a C++ port reads them with memcpy and fill.
//
// File layout (all numbers little-endian):
//   0  magic "MWSV" (4 bytes)
//   4  u32 format version (SAVE_VERSION)
//   8  u32 flags (0)
//  12  u32 payload length in bytes
//  16  u32 Adler-32 checksum of the payload
//  20  u32 reserved (0)
//  24  payload: one value (the Simulation)
//
// A value is a tag byte and its data:
//   Undefined, Null, False, True, Hole (an array gap)   no data
//   U8 (u8), I32 (i32), F64 (f64)                        numbers (-0, NaN, ±Infinity as F64)
//   Str8 (u32 n, n bytes: char codes < 256), Str16 (u32 n, n u16 code units)  a new string, gets the next string id
//   StrRef (u32 string id)                               a string written before
//   Array (u32 n, n values), Object (u32 n, n × (key string value, value)),
//   Map (u32 n, n × (key, value)), Set (u32 n, n values)  containers, get the next object id first
//   Typed (u8 kind, buffer, u32 byte offset, u32 length)  a typed array, gets the next object id;
//     buffer = u8 1, block (gets the next buffer id) | u8 0, u32 buffer id (a view on a buffer written before)
//     block = u32 byte length, then the buffer's 32-bit words as groups until all are filled:
//       u32 n literal words, the n words' raw bytes, u32 m repeated words, the word if m > 0;
//     then the last (byte length % 4) bytes raw
//   Rng (u32 state)                                      a createRng generator, gets the next object id
//   Ref (u32 object id)                                  a container, typed array or generator written before
//
// Bump SAVE_VERSION whenever the simulation state's layout changes (a field
// added, removed, renamed or of another type, a new meaning of an id): the
// state fingerprint test in save.test.ts fails until it is bumped. A save of
// another version is refused (SaveError 'version'), never loaded half.

/** Format version of save games; see above for when to bump it. */
export const SAVE_VERSION = 2;
export const SAVE_MAGIC = 0x5653574d; // "MWSV" read as a little-endian u32
export const SAVE_HEADER_BYTES = 24;

const T = {
  Undefined: 0,
  Null: 1,
  False: 2,
  True: 3,
  U8: 4,
  I32: 5,
  F64: 6,
  Str8: 7,
  Str16: 8,
  StrRef: 9,
  Array: 10,
  Object: 11,
  Map: 12,
  Set: 13,
  Typed: 14,
  Rng: 15,
  Ref: 16,
  Hole: 17,
} as const;

/** Typed array kinds by their code in the file (append only). */
const TYPED_KINDS = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
] as const;

export type SaveErrorCode =
  /** Not a save game (too short for a header, or another magic). */
  | 'not-a-save'
  /** A save of another format version; `version` says which. */
  | 'version'
  /** Shorter than its header says (an interrupted write). */
  | 'truncated'
  /** Checksum mismatch or data that doesn't decode to a world. */
  | 'corrupt';

export type SaveError = { code: SaveErrorCode; message: string; version?: number };

export type LoadResult = { ok: true; sim: Simulation } | { ok: false; error: SaveError };

// ---------------------------------------------------------------- writing

class Writer {
  buf: Uint8Array;
  view: DataView;
  pos = 0;
  constructor(capacity: number) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }
  ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number): void {
    this.ensure(1);
    this.buf[this.pos++] = v;
  }
  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }
  tagU32(tag: number, v: number): void {
    this.ensure(5);
    this.buf[this.pos] = tag;
    this.view.setUint32(this.pos + 1, v, true);
    this.pos += 5;
  }
}

type WriteContext = {
  w: Writer;
  objects: Map<object, number>;
  buffers: Map<ArrayBufferLike, number>;
  strings: Map<string, number>;
  /** New buffers in the order met; block k goes at stream position cuts[k] (written by encodeBlocks). */
  blocks: ArrayBufferLike[];
  cuts: number[];
};

function writeString(c: WriteContext, s: string): void {
  const w = c.w;
  const id = c.strings.get(s);
  if (id !== undefined) {
    w.tagU32(T.StrRef, id);
    return;
  }
  c.strings.set(s, c.strings.size);
  const n = s.length;
  let wide = false;
  for (let i = 0; i < n; i++) {
    if (s.charCodeAt(i) > 255) {
      wide = true;
      break;
    }
  }
  w.tagU32(wide ? T.Str16 : T.Str8, n);
  w.ensure(wide ? 2 * n : n);
  if (wide) {
    for (let i = 0; i < n; i++) {
      w.view.setUint16(w.pos, s.charCodeAt(i), true);
      w.pos += 2;
    }
  } else {
    const b = w.buf;
    let p = w.pos;
    for (let i = 0; i < n; i++) b[p++] = s.charCodeAt(i);
    w.pos = p;
  }
}

function writeNumber(w: Writer, v: number): void {
  if (v === (v | 0) && (v !== 0 || 1 / v > 0)) {
    if (v >= 0 && v < 256) {
      w.ensure(2);
      w.buf[w.pos] = T.U8;
      w.buf[w.pos + 1] = v;
      w.pos += 2;
    } else {
      w.ensure(5);
      w.buf[w.pos] = T.I32;
      w.view.setInt32(w.pos + 1, v, true);
      w.pos += 5;
    }
  } else {
    w.ensure(9);
    w.buf[w.pos] = T.F64;
    w.view.setFloat64(w.pos + 1, v, true);
    w.pos += 9;
  }
}

function typedKind(v: ArrayBufferView): number {
  for (let k = 0; k < TYPED_KINDS.length; k++) if (v instanceof TYPED_KINDS[k]) return k;
  return -1;
}

function writeValue(c: WriteContext, v: unknown): void {
  const w = c.w;
  switch (typeof v) {
    case 'number':
      writeNumber(w, v);
      return;
    case 'string':
      writeString(c, v);
      return;
    case 'boolean':
      w.u8(v ? T.True : T.False);
      return;
    case 'undefined':
      w.u8(T.Undefined);
      return;
    case 'object':
    case 'function':
      break;
    default:
      throw new Error(`save: cannot write a ${typeof v}`);
  }
  if (v === null) {
    w.u8(T.Null);
    return;
  }
  const obj = v as object;
  const seen = c.objects.get(obj);
  if (seen !== undefined) {
    w.tagU32(T.Ref, seen);
    return;
  }
  c.objects.set(obj, c.objects.size);
  if (typeof v === 'function') {
    if (!isRng(v)) throw new Error('save: cannot write a function that is not a createRng generator');
    w.tagU32(T.Rng, rngState(v));
    return;
  }
  if (Array.isArray(v)) {
    const n = v.length;
    w.tagU32(T.Array, n);
    for (let i = 0; i < n; i++) {
      if (!(i in v)) w.u8(T.Hole);
      else writeValue(c, v[i]);
    }
    return;
  }
  if (ArrayBuffer.isView(v)) {
    const kind = typedKind(v);
    if (kind < 0) throw new Error(`save: cannot write a ${v.constructor.name}`);
    const ta = v as Uint8Array;
    w.u8(T.Typed);
    w.u8(kind);
    const bufId = c.buffers.get(ta.buffer);
    if (bufId !== undefined) {
      w.u8(0);
      w.u32(bufId);
    } else {
      c.buffers.set(ta.buffer, c.buffers.size);
      w.u8(1);
      c.blocks.push(ta.buffer);
      c.cuts.push(w.pos);
    }
    w.u32(ta.byteOffset);
    w.u32(ta.length);
    return;
  }
  if (v instanceof Map) {
    w.tagU32(T.Map, v.size);
    for (const [k, x] of v) {
      writeValue(c, k);
      writeValue(c, x);
    }
    return;
  }
  if (v instanceof Set) {
    w.tagU32(T.Set, v.size);
    for (const x of v) writeValue(c, x);
    return;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`save: cannot write a ${(v as object).constructor?.name ?? 'class instance'}`);
  }
  const keys = Object.keys(v);
  w.tagU32(T.Object, keys.length);
  for (let i = 0; i < keys.length; i++) {
    writeString(c, keys[i]);
    writeValue(c, (v as Record<string, unknown>)[keys[i]]);
  }
}

/** Equal words from which a run is written as one (shorter ones stay literal). */
const MIN_RUN = 4;

/**
 * Work units (32-bit words scanned, or 4 bytes checksummed) continueSave
 * does per call by default: an aged world has about 1.3 million, so a save
 * takes some 20 calls. Measured in Node: ~1.5 ns per unit.
 */
export const SAVE_SLICE_WORDS = 65536;

/** A save in progress (startSave, continueSave, saveBytes). Opaque to the app. */
export type SaveJob = {
  sim: Simulation;
  tick: number;
  part: number;
  ctx: WriteContext;
  /** The blocks, encoded one after the other (blockEnds[k]: end of block k). */
  out: Writer;
  blockEnds: number[];
  /** Block being encoded, and its cursor: literal start, run start, scan position (-1: not begun). */
  block: number;
  lit: number;
  runStart: number;
  scan: number;
  /** The finished file once all blocks are encoded, and the checksum over it so far. */
  bytes: Uint8Array | null;
  sumA: number;
  sumB: number;
  sumPos: number;
  done: boolean;
};

/**
 * Starts a save of the simulation: writes its small data at once (a few
 * hundred objects) and leaves the typed arrays, the bulk, to continueSave.
 * From here until continueSave returns true the simulation must not change:
 * no stepSimulationPart, no cast (continueSave checks the tick and part).
 * Throws only on a programming error: state the format can't write (a class
 * instance or a function other than a createRng generator).
 */
export function startSave(sim: Simulation): SaveJob {
  if (!isLittleEndian()) throw new Error('save: big-endian platforms are not supported');
  const w = new Writer(1 << 16);
  w.pos = SAVE_HEADER_BYTES;
  const ctx: WriteContext = { w, objects: new Map(), buffers: new Map(), strings: new Map(), blocks: [], cuts: [] };
  writeValue(ctx, sim);
  return {
    sim,
    tick: sim.tick,
    part: sim.part,
    ctx,
    out: new Writer(1 << 18),
    blockEnds: [],
    block: 0,
    lit: 0,
    runStart: 0,
    scan: -1,
    bytes: null,
    sumA: 1,
    sumB: 0,
    sumPos: SAVE_HEADER_BYTES,
    done: false,
  };
}

/**
 * Does up to `budget` units of the save's remaining work; true once the save
 * is complete (then saveBytes gives the file). Call it once per frame (or in
 * a loop) without changing the simulation in between.
 */
export function continueSave(job: SaveJob, budget: number = SAVE_SLICE_WORDS): boolean {
  if (job.done) return true;
  if (job.sim.tick !== job.tick || job.sim.part !== job.part) throw new Error('save: the simulation changed during the save');
  budget = encodeBlocks(job, budget);
  if (budget <= 0) return false;
  if (!job.bytes) job.bytes = assemble(job);
  const bytes = job.bytes;
  const end = bytes.length;
  let a = job.sumA;
  let b = job.sumB;
  let i = job.sumPos;
  const stop = Math.min(end, i + 4 * budget);
  while (i < stop) {
    // 5552: the most bytes before b can overflow 2^53 in plain sums (zlib's NMAX).
    const e = Math.min(i + 5552, stop);
    for (; i < e; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  job.sumA = a;
  job.sumB = b;
  job.sumPos = i;
  if (i < end) return false;
  new DataView(bytes.buffer).setUint32(16, ((b << 16) | a) >>> 0, true);
  job.done = true;
  return true;
}

/** The save game of a finished job (continueSave returned true). */
export function saveBytes(job: SaveJob): Uint8Array {
  if (!job.done || !job.bytes) throw new Error('save: not finished');
  return job.bytes;
}

/**
 * The whole simulation state as a save game, in one call (startSave and
 * continueSave until done). Call it between two calls of
 * stepSimulationPart/stepSimulation (any part).
 */
export function serializeWorld(sim: Simulation): Uint8Array {
  const job = startSave(sim);
  while (!continueSave(job, Infinity));
  return saveBytes(job);
}

/**
 * Encodes blocks as a u32 byte length, then the buffer's 32-bit words as
 * groups of literal words and a run of one repeated word, then the last
 * byteLength % 4 bytes as they are; up to `budget` words. Returns the budget left.
 */
function encodeBlocks(job: SaveJob, budget: number): number {
  const w = job.out;
  const blocks = job.ctx.blocks;
  while (job.block < blocks.length) {
    if (budget <= 0) return 0;
    const buffer = blocks[job.block];
    const len = buffer.byteLength;
    const words = len >>> 2;
    if (job.scan < 0) {
      w.u32(len);
      job.lit = 0;
      job.runStart = 0;
      job.scan = 0;
    }
    const word = new Uint32Array(buffer, 0, words);
    const bytes = new Uint8Array(buffer, 0, len);
    let lit = job.lit;
    let i = job.runStart;
    let j = job.scan;
    while (i < words) {
      if (budget <= 0) {
        job.lit = lit;
        job.runStart = i;
        job.scan = j;
        return 0;
      }
      const x = word[i];
      if (j <= i) j = i + 1;
      const limit = Math.min(words, j + budget);
      const from = j;
      while (j < limit && word[j] === x) j++;
      budget -= j - from + 1;
      if (j === limit && j < words) continue; // out of budget inside a run: resume the scan here
      if (j - i >= MIN_RUN || j === words) {
        const runStart = j - i >= MIN_RUN ? i : j;
        const nLit = runStart - lit;
        w.u32(nLit);
        w.ensure(4 * nLit + 8);
        w.buf.set(bytes.subarray(4 * lit, 4 * runStart), w.pos);
        w.pos += 4 * nLit;
        w.u32(j - runStart);
        if (j > runStart) w.u32(x);
        lit = j;
      }
      i = j;
    }
    const tail = len & 3;
    w.ensure(tail);
    for (let k = len - tail; k < len; k++) w.buf[w.pos++] = bytes[k];
    job.blockEnds.push(w.pos);
    job.block++;
    job.scan = -1;
  }
  return budget;
}

/** The file: header, the small data with the encoded blocks put in at their places (checksum still 0). */
function assemble(job: SaveJob): Uint8Array {
  const { w, cuts } = job.ctx;
  const total = w.pos + job.out.pos;
  const bytes = new Uint8Array(total);
  let from = SAVE_HEADER_BYTES;
  let to = SAVE_HEADER_BYTES;
  let blockFrom = 0;
  for (let k = 0; k < cuts.length; k++) {
    bytes.set(w.buf.subarray(from, cuts[k]), to);
    to += cuts[k] - from;
    from = cuts[k];
    const blockTo = job.blockEnds[k];
    bytes.set(job.out.buf.subarray(blockFrom, blockTo), to);
    to += blockTo - blockFrom;
    blockFrom = blockTo;
  }
  bytes.set(w.buf.subarray(from, w.pos), to);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, SAVE_MAGIC, true);
  view.setUint32(4, SAVE_VERSION, true);
  view.setUint32(8, 0, true);
  view.setUint32(12, total - SAVE_HEADER_BYTES, true);
  view.setUint32(16, 0, true);
  view.setUint32(20, 0, true);
  return bytes;
}

/** Adler-32 (as zlib) of bytes[from, to). */
export function adler32(bytes: Uint8Array, from: number, to: number): number {
  let a = 1;
  let b = 0;
  let i = from;
  while (i < to) {
    const end = Math.min(i + 5552, to);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function isLittleEndian(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}

// ---------------------------------------------------------------- reading

/** Damaged data found while reading (an Error marked as such: no subclass of a builtin, which transpiled code may break). */
function corrupt(message: string): never {
  throw Object.assign(new Error(message), { saveCorrupt: true });
}

type ReadContext = {
  bytes: Uint8Array;
  view: DataView;
  pos: number;
  end: number;
  objects: unknown[];
  buffers: ArrayBuffer[];
  strings: string[];
};

function need(r: ReadContext, n: number): void {
  if (r.pos + n > r.end) corrupt('data ends inside a value');
}

function readU8(r: ReadContext): number {
  need(r, 1);
  return r.bytes[r.pos++];
}

function readU32(r: ReadContext): number {
  need(r, 4);
  const v = r.view.getUint32(r.pos, true);
  r.pos += 4;
  return v;
}

function readCount(r: ReadContext, minBytesEach: number): number {
  const n = readU32(r);
  // Every item takes at least a byte, so a count beyond the data left is corrupt (and no huge allocation).
  if (n * minBytesEach > r.end - r.pos) corrupt('count beyond the data');
  return n;
}

function readStringBody(r: ReadContext, wide: boolean): string {
  const n = readCount(r, wide ? 2 : 1);
  let s = '';
  const CHUNK = 4096;
  const codes: number[] = [];
  for (let i = 0; i < n; i += CHUNK) {
    const m = Math.min(CHUNK, n - i);
    codes.length = m;
    for (let j = 0; j < m; j++) {
      if (wide) {
        codes[j] = r.view.getUint16(r.pos, true);
        r.pos += 2;
      } else codes[j] = r.bytes[r.pos++];
    }
    s += String.fromCharCode.apply(null, codes);
  }
  r.strings.push(s);
  return s;
}

function readKey(r: ReadContext): string {
  const tag = readU8(r);
  if (tag === T.StrRef) {
    const id = readU32(r);
    if (id >= r.strings.length) corrupt('unknown string id');
    return r.strings[id];
  }
  if (tag === T.Str8 || tag === T.Str16) return readStringBody(r, tag === T.Str16);
  corrupt('object key is not a string');
}

/** Largest typed array a save may hold (the largest of a 46 × 44 world is ~400 KB). */
const MAX_BLOCK_BYTES = 1 << 26;

function readBlock(r: ReadContext): ArrayBuffer {
  const len = readU32(r);
  // Runs make a block much larger than its bytes in the file: cap it, so damaged data allocates no huge buffer.
  if (len > MAX_BLOCK_BYTES) corrupt('block too large');
  const buffer = new ArrayBuffer(len);
  const words = len >>> 2;
  const word = new Uint32Array(buffer, 0, words);
  const bytes = new Uint8Array(buffer);
  let i = 0;
  while (i < words) {
    const nLit = readU32(r);
    if (nLit > words - i) corrupt('block overrun');
    need(r, 4 * nLit);
    bytes.set(r.bytes.subarray(r.pos, r.pos + 4 * nLit), 4 * i);
    r.pos += 4 * nLit;
    i += nLit;
    const nRun = readU32(r);
    if (nRun > words - i) corrupt('block overrun');
    if (nRun > 0) {
      const x = readU32(r);
      if (x !== 0) word.fill(x, i, i + nRun);
      i += nRun;
    } else if (nLit === 0 && i < words) corrupt('empty block group');
  }
  const tail = len & 3;
  need(r, tail);
  for (let k = len - tail; k < len; k++) bytes[k] = r.bytes[r.pos++];
  return buffer;
}

function readValue(r: ReadContext): unknown {
  const tag = readU8(r);
  switch (tag) {
    case T.Undefined:
      return undefined;
    case T.Null:
      return null;
    case T.False:
      return false;
    case T.True:
      return true;
    case T.U8:
      return readU8(r);
    case T.I32: {
      need(r, 4);
      const v = r.view.getInt32(r.pos, true);
      r.pos += 4;
      return v;
    }
    case T.F64: {
      need(r, 8);
      const v = r.view.getFloat64(r.pos, true);
      r.pos += 8;
      return v;
    }
    case T.Str8:
    case T.Str16:
      return readStringBody(r, tag === T.Str16);
    case T.StrRef: {
      const id = readU32(r);
      if (id >= r.strings.length) corrupt('unknown string id');
      return r.strings[id];
    }
    case T.Array: {
      const n = readCount(r, 1);
      const a: unknown[] = new Array(n);
      r.objects.push(a);
      for (let i = 0; i < n; i++) {
        if (r.pos < r.end && r.bytes[r.pos] === T.Hole) r.pos++;
        else a[i] = readValue(r);
      }
      return a;
    }
    case T.Object: {
      const n = readCount(r, 2);
      const o: Record<string, unknown> = {};
      r.objects.push(o);
      for (let i = 0; i < n; i++) {
        const k = readKey(r);
        if (k === '__proto__') corrupt('bad key');
        o[k] = readValue(r);
      }
      return o;
    }
    case T.Map: {
      const n = readCount(r, 2);
      const m = new Map<unknown, unknown>();
      r.objects.push(m);
      for (let i = 0; i < n; i++) {
        const k = readValue(r);
        m.set(k, readValue(r));
      }
      return m;
    }
    case T.Set: {
      const n = readCount(r, 1);
      const s = new Set<unknown>();
      r.objects.push(s);
      for (let i = 0; i < n; i++) s.add(readValue(r));
      return s;
    }
    case T.Typed: {
      const kind = readU8(r);
      if (kind >= TYPED_KINDS.length) corrupt('unknown typed array kind');
      const Kind = TYPED_KINDS[kind];
      let buffer: ArrayBuffer;
      if (readU8(r) === 1) {
        buffer = readBlock(r);
        r.buffers.push(buffer);
      } else {
        const id = readU32(r);
        if (id >= r.buffers.length) corrupt('unknown buffer id');
        buffer = r.buffers[id];
      }
      const offset = readU32(r);
      const length = readU32(r);
      if (offset % Kind.BYTES_PER_ELEMENT !== 0 || offset + length * Kind.BYTES_PER_ELEMENT > buffer.byteLength) {
        corrupt('typed array outside its buffer');
      }
      const ta = new Kind(buffer, offset, length);
      r.objects.push(ta);
      return ta;
    }
    case T.Rng: {
      const rng = createRng(0);
      setRngState(rng, readU32(r));
      r.objects.push(rng);
      return rng;
    }
    case T.Ref: {
      const id = readU32(r);
      if (id >= r.objects.length) corrupt('unknown object id');
      return r.objects[id];
    }
    default:
      corrupt(`unknown tag ${tag}`);
  }
}

/** The fields every simulation has; a payload without them is not a world. */
const REQUIRED_FIELDS = ['world', 'rng', 'tick', 'pop', 'civs', 'economy', 'trade', 'diplomacy', 'government', 'military', 'leaders', 'war', 'gacha', 'biomes', 'part'];

/** Reads only the header: the format version of a save, or an error if it isn't one. */
export function saveVersion(bytes: Uint8Array): { ok: true; version: number } | { ok: false; error: SaveError } {
  if (bytes.length < SAVE_HEADER_BYTES) return { ok: false, error: { code: 'not-a-save', message: 'Too short for a save game.' } };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== SAVE_MAGIC) return { ok: false, error: { code: 'not-a-save', message: 'Not a save game.' } };
  return { ok: true, version: view.getUint32(4, true) };
}

/**
 * The simulation a save game holds, exactly as it was saved: stepping it on
 * gives the same world as stepping the original. Never throws; a save of
 * another version, a truncated or a damaged one gives an error and no world.
 */
export function deserializeWorld(bytes: Uint8Array): LoadResult {
  const head = saveVersion(bytes);
  if (!head.ok) return head;
  if (head.version !== SAVE_VERSION) {
    return {
      ok: false,
      error: { code: 'version', version: head.version, message: `Save game version ${head.version}, this game reads version ${SAVE_VERSION}.` },
    };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = view.getUint32(12, true);
  if (SAVE_HEADER_BYTES + len > bytes.length) {
    return { ok: false, error: { code: 'truncated', message: `Save game is cut off: ${bytes.length - SAVE_HEADER_BYTES} of ${len} bytes.` } };
  }
  const end = SAVE_HEADER_BYTES + len;
  if (adler32(bytes, SAVE_HEADER_BYTES, end) !== view.getUint32(16, true)) {
    return { ok: false, error: { code: 'corrupt', message: 'Save game is damaged (checksum).' } };
  }
  const r: ReadContext = { bytes, view, pos: SAVE_HEADER_BYTES, end, objects: [], buffers: [], strings: [] };
  let value: unknown;
  try {
    value = readValue(r);
  } catch (e) {
    if ((e as { saveCorrupt?: boolean }).saveCorrupt || e instanceof RangeError) {
      return { ok: false, error: { code: 'corrupt', message: `Save game is damaged (${(e as Error).message}).` } };
    }
    throw e;
  }
  if (r.pos !== end) return { ok: false, error: { code: 'corrupt', message: 'Save game is damaged (data after the world).' } };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: { code: 'corrupt', message: 'Save game holds no world.' } };
  }
  for (const f of REQUIRED_FIELDS) {
    if (!(f in value)) return { ok: false, error: { code: 'corrupt', message: `Save game holds no world (no ${f}).` } };
  }
  return { ok: true, sim: value as Simulation };
}

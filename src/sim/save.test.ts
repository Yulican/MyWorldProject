import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { castGacha } from '../bench/castGacha';
import { declareWarsEverywhere } from '../bench/declareWars';
import { isRng } from './rng';
import { SAVE_HEADER_BYTES, SAVE_VERSION, adler32, continueSave, deserializeWorld, saveBytes, serializeWorld, startSave } from './save';
import { TICKS_PER_YEAR, createSimulation, stepSimulation, stepSimulationPart, type Simulation } from './society/simulation';
import { generateWorld } from './world/generate';

function run(sim: Simulation, years: number): void {
  for (let t = 0; t < years * TICKS_PER_YEAR && !sim.gameOver; t++) stepSimulation(sim);
}

function load(bytes: Uint8Array): Simulation {
  const res = deserializeWorld(bytes);
  if (!res.ok) throw new Error(res.error.message);
  return res.sim;
}

/** Another world's years, so state a module keeps between calls (scratch, caches) is not the saved world's when the loaded copy runs. */
function pollute(): void {
  run(createSimulation(generateWorld({ seed: 991 })), 3);
}

/**
 * Saves `sim` (a few tick parts into its next tick, unless `parts` is 0),
 * loads it, runs the original and then the copy `years` further and asserts
 * both are the same state, byte for byte of their saves.
 */
function assertContinues(sim: Simulation, years: number, parts = 3): void {
  for (let i = 0; i < parts; i++) stepSimulationPart(sim);
  const bytes = serializeWorld(sim);
  const copy = load(bytes);
  assert.deepEqual(serializeWorld(copy), bytes, 'a loaded world saves the same bytes');
  assert.notEqual(copy, sim);
  assert.notEqual(copy.world, sim.world);
  run(sim, years);
  pollute();
  run(copy, years);
  assert.equal(copy.tick, sim.tick);
  assert.equal(copy.pop.count, sim.pop.count);
  assert.deepEqual(serializeWorld(copy), serializeWorld(sim), 'the loaded world continues bit-identically');
}

let aged: Uint8Array | null = null;
/** A 300-year world's save (built once; each test loads its own copy). */
function agedSave(): Uint8Array {
  if (!aged) {
    const sim = createSimulation(generateWorld({ seed: 4 }));
    run(sim, 300);
    aged = serializeWorld(sim);
  }
  return aged;
}

test('a young world continues identically after save and load', () => {
  const sim = createSimulation(generateWorld({ seed: 2 }));
  assertContinues(sim, 10, 0);
  assertContinues(sim, 2, 7);
});

test('an aged world continues identically after save and load, saved between and within ticks', () => {
  const sim = load(agedSave());
  assertContinues(sim, 10, 0);
  for (const parts of [1, 4, 9]) assertContinues(sim, 1, parts);
});

test('a world at war (war scenario setup) continues identically', () => {
  const sim = load(agedSave());
  declareWarsEverywhere(sim);
  assert.ok(sim.war.wLive.some((x) => x), 'wars are running');
  assertContinues(sim, 3, 2);
});

test('a world under the god (gacha scenario setup) continues identically', () => {
  const sim = load(agedSave());
  castGacha(sim);
  assertContinues(sim, 3, 5);
});

test('a save in slices is the same as one in a call, and loads', () => {
  const sim = load(agedSave());
  const whole = serializeWorld(sim);
  for (const budget of [1, 7, 1000]) {
    const job = startSave(sim);
    let calls = 0;
    while (!continueSave(job, budget)) calls++;
    assert.ok(calls > 0);
    assert.deepEqual(saveBytes(job), whole);
  }
  assert.throws(() => {
    const job = startSave(sim);
    continueSave(job, 10);
    stepSimulationPart(sim);
    continueSave(job, 10);
  }, /changed during the save/);
});

test('shared references stay shared and generators keep their sequence', () => {
  const sim = createSimulation(generateWorld({ seed: 6 }));
  run(sim, 2);
  const copy = load(serializeWorld(sim));
  assert.ok(isRng(copy.rng));
  for (let i = 0; i < 100; i++) assert.equal(copy.rng(), sim.rng());
  assert.equal(copy.colorRng(), sim.colorRng());
  for (const civ of copy.civs) if (civ) assert.equal(copy.civs[civ.id], civ);
});

test('a save of another version, a truncated and a damaged one are refused', () => {
  const sim = createSimulation(generateWorld({ seed: 7 }));
  const bytes = serializeWorld(sim);
  const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

  const other = bytes.slice();
  view(other).setUint32(4, SAVE_VERSION + 1, true);
  const v = deserializeWorld(other);
  assert.ok(!v.ok && v.error.code === 'version' && v.error.version === SAVE_VERSION + 1);

  for (const cut of [0, 10, SAVE_HEADER_BYTES, bytes.length >> 1, bytes.length - 1]) {
    const r = deserializeWorld(bytes.subarray(0, cut));
    assert.ok(!r.ok && (r.error.code === 'truncated' || r.error.code === 'not-a-save'), `cut at ${cut}`);
  }

  const magic = bytes.slice();
  magic[0] ^= 0xff;
  const m = deserializeWorld(magic);
  assert.ok(!m.ok && m.error.code === 'not-a-save');

  for (const at of [SAVE_HEADER_BYTES, SAVE_HEADER_BYTES + 100, bytes.length >> 1, bytes.length - 1]) {
    const flipped = bytes.slice();
    flipped[at] ^= 0x5a;
    const r = deserializeWorld(flipped);
    assert.ok(!r.ok && r.error.code === 'corrupt', `byte ${at} flipped`);
  }
});

test('damaged data with a matching checksum gives an error, never a half-loaded world or an exception', () => {
  const sim = createSimulation(generateWorld({ seed: 8 }));
  const bytes = serializeWorld(sim);
  let refused = 0;
  // Deterministic "random" damage: flip bytes all over the payload, fix the checksum, load.
  for (let k = 0; k < 400; k++) {
    const d = bytes.slice();
    const at = SAVE_HEADER_BYTES + ((k * 2654435761) >>> 0) % (bytes.length - SAVE_HEADER_BYTES);
    d[at] = (d[at] + 1 + (k % 255)) & 255;
    new DataView(d.buffer).setUint32(16, adler32(d, SAVE_HEADER_BYTES, d.length), true);
    const r = deserializeWorld(d);
    if (!r.ok) {
      assert.equal(r.error.code, 'corrupt');
      refused++;
    }
  }
  // Damage inside raw numbers decodes to other numbers; damage to the structure is refused.
  assert.ok(refused > 0);
});

// ------------------------------------------------------------ state layout

/**
 * The layout of the simulation state, one line per field path with its
 * types: arrays and Maps merged over their items, typed arrays by kind.
 * Kept in saveSchema.txt; when the state's layout changes, this test fails:
 * bump SAVE_VERSION in save.ts, then write the new layout with
 * `UPDATE_SAVE_SCHEMA=1 npm test` (and check the diff of saveSchema.txt).
 */
function stateSchema(sim: Simulation): string {
  const types = new Map<string, Set<string>>();
  const seen = new Set<object>();
  const add = (path: string, t: string) => {
    let s = types.get(path);
    if (!s) types.set(path, (s = new Set()));
    s.add(t);
  };
  const walk = (v: unknown, path: string): void => {
    if (v === null || v === undefined) return add(path, 'null');
    if (typeof v !== 'object' && typeof v !== 'function') return add(path, typeof v);
    if (isRng(v)) return add(path, 'rng');
    if (ArrayBuffer.isView(v)) return add(path, v.constructor.name);
    if (seen.has(v as object)) return; // shared: described where first met
    seen.add(v as object);
    if (Array.isArray(v) || v instanceof Set) {
      add(path, 'array');
      for (const x of v) walk(x, path + '[]');
    } else if (v instanceof Map) {
      add(path, 'map');
      for (const [k, x] of v) {
        walk(k, path + '{key}');
        walk(x, path + '{}');
      }
    } else {
      add(path, 'object');
      for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], `${path}.${k}`);
    }
  };
  walk(sim, 'sim');
  const lines = [...types].map(([p, s]) => {
    const t = [...s].filter((x) => x !== 'null' || s.size === 1).sort();
    return `${p}: ${t.join('|')}`;
  });
  return [`save version ${SAVE_VERSION}`, ...lines.sort()].join('\n') + '\n';
}

test('the state layout is the one of this save version (bump SAVE_VERSION when it changes)', () => {
  // A world with the most state in use: aged, at war, under the god's effects.
  const sim = load(agedSave());
  declareWarsEverywhere(sim);
  castGacha(sim);
  run(sim, 1);
  const schema = stateSchema(sim);
  const file = join(__dirname, 'saveSchema.txt');
  if (process.env.UPDATE_SAVE_SCHEMA) writeFileSync(file, schema);
  const expected = readFileSync(file, 'utf8');
  if (schema !== expected) {
    const want = new Set(expected.split('\n'));
    const got = new Set(schema.split('\n'));
    const diff = [...[...got].filter((l) => !want.has(l)).map((l) => `+ ${l}`), ...[...want].filter((l) => !got.has(l)).map((l) => `- ${l}`)];
    assert.fail(
      `The simulation state's layout changed. Bump SAVE_VERSION in save.ts if saves of the old layout can't load, ` +
        `then run UPDATE_SAVE_SCHEMA=1 npm test.\n${diff.slice(0, 40).join('\n')}`,
    );
  }
});

// Fast seedable random number generator (mulberry32). Same seed, same sequence.
export type Rng = () => number;

/**
 * Save games read and restore a generator's 32-bit state (save.ts). The
 * accessors hang on the function itself, so drawing a number stays a plain
 * closure call.
 */
type RngWithState = Rng & { getState: () => number; setState: (s: number) => void };

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as RngWithState;
  next.getState = () => a;
  next.setState = (s: number) => {
    a = s >>> 0;
  };
  return next;
}

/** True for a generator made by createRng (its state can be saved). */
export function isRng(f: unknown): f is Rng {
  return typeof f === 'function' && typeof (f as RngWithState).getState === 'function';
}

/** The generator's state: createRng(0) with setRngState(rng, state) continues the same sequence. */
export function rngState(rng: Rng): number {
  return (rng as RngWithState).getState();
}

export function setRngState(rng: Rng, state: number): void {
  (rng as RngWithState).setState(state);
}

/**
 * Derives an independent seed for a named sub-step, so adding random calls
 * to one generation step doesn't change the output of the others.
 */
export function deriveSeed(seed: number, salt: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h = Math.imul(h ^ salt.charCodeAt(i), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
  }
  return h;
}

/** Random seed for a new world, small enough to read out and type in. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

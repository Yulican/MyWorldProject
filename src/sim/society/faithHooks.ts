import type { Simulation } from './simulation';

/**
 * Religion prototype (Requirement Religion, step 1): the hook points the simulation core calls while a religion
 * layer (`religion.ts`, installed by tools/religionStats.ts) is on. Everything is off (`on` false, all slots null)
 * by default, so the game runs exactly as before. Leaf file: no imports besides types.
 */
export const FAITH: {
  on: boolean;
  /** The lever layer "Glaube" (people x LEVERS, identity when neutral), multiplied/added on top by combineLevers. */
  lev: Float32Array | null;
  /** Satisfaction parts "Creed" and "Heresy" per people. */
  creed: Float32Array | null;
  heresy: Float32Array | null;
  /** Trust part "Faith" per directed pair (a * PAIRS + b). */
  trust: Float32Array | null;
  /** Religion per inhabitant slot (255 = none). */
  rel: Uint8Array;
  /** A new inhabitant in `slot` (parent slot or -1, e.g. a soldier coming home). */
  added: ((sim: Simulation, slot: number, parent: number, cell: number) => void) | null;
  /** The yearly faith step of inhabitant `i`; returns its new faith. */
  step: ((sim: Simulation, i: number, civ: number, cell: number, before: number) => number) | null;
  /** The strength ratio `a` needs over `b` to declare war (holy war: lower against a foreign faith). */
  holyRatio: ((sim: Simulation, a: number, b: number, base: number) => number) | null;
  /** War `s` was declared by `att` on `def`. */
  warStarted: ((sim: Simulation, att: number, def: number, s: number) => void) | null;
  /** 1 for war slots that are holy wars. */
  holy: Uint8Array | null;
  /** Which side (0 attacker's, 1 defender's, -1 none) people `p` joins in war `s` for its faith (holy war, rebellion over faith). */
  joinSide: ((sim: Simulation, s: number, p: number) => number) | null;
  /** Per-cell Heresy part (mode 1). */
  heresyCell: Float32Array | null;
  /** Mandate prototype (mandate.ts): the old strength-check rebellion is off; vassal of each people (-1 none). */
  mandate: boolean;
  /** Mandate loyalty per cell (-1 none) for the schism's choice of place; scale on the satisfaction connection part while Mandate is on. */
  loyalty: Float32Array | null;
  /** State faith (leader's religion) per people, -1 none (mandate.ts). */
  stateRel: Int16Array | null;
  connScale: number;
  vassal: Int16Array | null;
  /** Per-cell satisfaction part "Unrest" (unrest.ts). */
  unrest: Float32Array | null;
  /** Tools: a rebel war `s` is about to end with `type` (EndType). */
  rebelEnd: ((sim: Simulation, s: number, type: number) => void) | null;
  /** Cells (mask) of war `s` changed hands to `att`. */
  conquered: ((sim: Simulation, s: number, mask: Uint8Array, att: number) => void) | null;
} = { on: false, lev: null, creed: null, heresy: null, trust: null, rel: new Uint8Array(0), added: null, step: null, holyRatio: null, warStarted: null, holy: null, joinSide: null, heresyCell: null, mandate: false, loyalty: null, stateRel: null, connScale: 1, vassal: null, unrest: null, conquered: null, rebelEnd: null };

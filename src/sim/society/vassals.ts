import type { Simulation } from './simulation';

// Vassals (Requirement Mandat 7): who is whose vassal, for the modules that only need to ask (diplomacy, alliances,
// war). A leaf: no imports besides types, so these modules can read it without import cycles at load time. The
// state lives in `sim.mandate` (mandate.ts).

/** The mother of vassal `civ`, -1 if it is none. */
export function vassalOf(sim: Simulation, civ: number): number {
  return civ > 0 && civ < 256 ? sim.mandate.vassalOf[civ] : -1;
}

/** Whether `a` and `b` are a vassal and its mother (either way round). */
export function vassalPair(sim: Simulation, a: number, b: number): boolean {
  const v = sim.mandate.vassalOf;
  return a > 0 && b > 0 && a < 256 && b < 256 && (v[a] === b || v[b] === a);
}

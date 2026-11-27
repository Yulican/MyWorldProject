import { FAITH } from './faithHooks';
import { DIRECTION_COUNT } from '../hex';
import { comfortServed } from './satisfaction';
import type { Simulation } from './simulation';

/**
 * Exploratory (off by default): unrest spreads between neighboring settlements of a people like an infection
 * (SIR-like, one value per settlement, yearly). Source: dissatisfaction; contagion: the mean unrest of the
 * same-owner neighbors; cure: a share a year plus a fixed amount while comfort, a leader's contentment or the
 * god's gifts help. Below `incubation` it does nothing; above it the part "Unrest" lowers satisfaction.
 */
export const UNREST = {
  enabled: 0,
  /** Source per year: alpha x (from - satisfaction) where satisfaction < from. */
  alpha: 0.3,
  from: 0,
  /** Contagion: beta x the mean unrest of the same-owner neighbors; cure: share gamma per year plus `cure` with comfort. */
  beta: 0.25,
  gamma: 0.15,
  cure: 10,
  incubation: 20,
  /** Satisfaction part: -weight x unrest, at most `cap`. */
  weight: 0.15,
  cap: 10,
};

export type UnrestState = { sim: Simulation; u: Float32Array; next: Float32Array; term: Float32Array };
let ACTIVE: UnrestState | null = null;

export function installUnrest(sim: Simulation): UnrestState {
  const n = sim.world.cellCount;
  ACTIVE = { sim, u: new Float32Array(n), next: new Float32Array(n), term: new Float32Array(n) };
  FAITH.unrest = ACTIVE.term;
  return ACTIVE;
}

export function removeUnrest(): void {
  ACTIVE = null;
  FAITH.unrest = null;
}

/** The yearly step (call after the year's last tick). */
export function unrestYear(sim: Simulation): void {
  const st = ACTIVE;
  if (st === null || st.sim !== sim || !UNREST.enabled) return;
  const w = sim.world;
  const n = w.cellCount;
  const { u, next, term } = st;
  for (let c = 0; c < n; c++) {
    const o = w.owner[c];
    if (sim.cellPop[c] === 0 || o === 0 || sim.civs[o]?.capital === c) {
      next[c] = 0;
      continue;
    }
    const base = sim.satisfaction[c] - term[c];
    let sum = 0;
    let k = 0;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const x = w.neighbors[c * DIRECTION_COUNT + d];
      if (x >= 0 && sim.cellPop[x] > 0 && w.owner[x] === o) {
        sum += u[x];
        k++;
      }
    }
    let v = u[c] + UNREST.alpha * Math.max(0, UNREST.from - base) + (k > 0 ? (UNREST.beta * sum) / k : 0) - UNREST.gamma * u[c];
    if (comfortServed(sim.economy, c) > 0 || sim.leaders.sat[o] > 0 || sim.gacha.divine[o] > 0) v -= UNREST.cure;
    next[c] = Math.max(0, Math.min(100, v));
  }
  for (let c = 0; c < n; c++) {
    u[c] = next[c];
    term[c] = u[c] >= UNREST.incubation ? -Math.min(UNREST.cap, UNREST.weight * u[c]) : 0;
  }
}

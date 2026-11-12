import { PAIRS, addMood } from './diplomacy';
import { ALLY, Pact } from './pacts';
import { record, type Simulation } from './simulation';

if (PAIRS !== 256) throw new Error('pacts.ts assumes 256 people pairs');

// War phase 4 ("Design Documents/Requirement Krieg.md", section 7): defense
// pacts and alliances between peoples. 4a: they form and end yearly from
// trust and common threats, give trust (diplomacy.ts: trustValue) and count
// in danger and the declaration check (pacts.ts); 4b (war.ts: joinAllies):
// allies join wars when they start.
//
// State lives in WarState: `pact` (a * PAIRS + b, symmetric: 0 none, 1 pact,
// 2 alliance) and `pactX` (a pact's common threat). The yearly update loops
// over the known pairs of the living peoples only and allocates nothing but
// the chronicle's strings.

function setPact(sim: Simulation, a: number, b: number, kind: number, x: number): void {
  const w = sim.war;
  const k = a * PAIRS + b;
  const k2 = b * PAIRS + a;
  if (w.pact[k] === Pact.None && kind !== Pact.None) w.pactCount++;
  else if (w.pact[k] !== Pact.None && kind === Pact.None) w.pactCount--;
  w.pact[k] = kind;
  w.pact[k2] = kind;
  w.pactX[k] = x;
  w.pactX[k2] = x;
}

/** Ends the pact or alliance of two peoples (a war between them, or a declaration on a partner's ally). */
export function endPact(sim: Simulation, a: number, b: number): void {
  if (sim.war.pact[a * PAIRS + b] !== Pact.None) setPact(sim, a, b, Pact.None, 0);
}

/** A declaration on `t` ends the alliance of `a` with every partner that is allied to `t` (−breakLoss trust at the partner). */
export function breakAlliances(sim: Simulation, a: number, t: number): void {
  const w = sim.war;
  const max = sim.diplomacy.maxId;
  for (let p = 1; p <= max; p++) {
    if (p === a || p === t || w.pact[a * PAIRS + p] !== Pact.Alliance || w.pact[p * PAIRS + t] !== Pact.Alliance) continue;
    setPact(sim, a, p, Pact.None, 0);
    addMood(sim.diplomacy, p, a, 'Attacked our ally', -ALLY.breakLoss, sim.tick);
    w.stats.alliesBroken++;
    if (sim.civs[p] && sim.civs[a]) record(sim, `The alliance of the ${sim.civs[a]!.name} and the ${sim.civs[p]!.name} ended: the ${sim.civs[a]!.name} attacked an ally of the ${sim.civs[p]!.name}.`, sim.civs[p]!.capital);
  }
}

/** A third people both `a` and `b` fear at least `min` (the one with the largest smaller danger), 0 if none. */
function commonThreat(sim: Simulation, a: number, b: number, min: number): number {
  const d = sim.diplomacy.danger;
  let best = 0;
  let bestV = min - 1e-9;
  for (let i = 0; i < livingCount; i++) {
    const x = living[i];
    if (x === a || x === b) continue;
    const v = Math.min(d[a * PAIRS + x], d[b * PAIRS + x]);
    if (v > bestV) {
      bestV = v;
      best = x;
    }
  }
  return best;
}

const living = new Uint8Array(PAIRS);
let livingCount = 0;

/**
 * Two peoples become allies at once (no trust needed; their trust then
 * decides yearly as for any alliance whether it stays, becomes a pact or
 * ends). For the peoples a won revolution splits into (section 8), and the
 * benchmark's allied blocks.
 */
export function formAlliance(sim: Simulation, a: number, b: number): void {
  if (a === b || sim.war.pact[a * PAIRS + b] === Pact.Alliance) return;
  setPact(sim, a, b, Pact.Alliance, 0);
}

/** Yearly (war.ts: first step of the war's year, after the diplomacy update): pacts and alliances form, are downgraded and end. */
export function updateAlliances(sim: Simulation): void {
  const w = sim.war;
  const dip = sim.diplomacy;
  const st = w.stats;
  livingCount = 0;
  for (let id = 1; id < sim.civs.length && id < PAIRS; id++) if (sim.civs[id]) living[livingCount++] = id;
  // Partners that vanished.
  const max = dip.maxId;
  for (let a = 1; a <= max; a++) {
    for (let b = a + 1; b <= max; b++) {
      if (w.pact[a * PAIRS + b] !== Pact.None && (!sim.civs[a] || !sim.civs[b])) setPact(sim, a, b, Pact.None, 0);
    }
  }
  for (let i = 0; i < livingCount; i++) {
    const a = living[i];
    for (let j = i + 1; j < livingCount; j++) {
      const b = living[j];
      const k = a * PAIRS + b;
      if (!dip.known[k] || w.foe[k] > 0) continue;
      const trust = Math.min(dip.trust[k], dip.trust[b * PAIRS + a]);
      const cur = w.pact[k];
      const nameA = sim.civs[a]!.name;
      const nameB = sim.civs[b]!.name;
      if (cur === Pact.Alliance) {
        if (trust >= ALLY.downgradeTrust) continue;
        const x = commonThreat(sim, a, b, ALLY.threatEnd);
        if (x > 0 && trust >= ALLY.pactEnd) {
          setPact(sim, a, b, Pact.Pact, x);
          st.downgraded++;
          record(sim, `The alliance of the ${nameA} and the ${nameB} became a defense pact.`, sim.civs[a]!.capital);
        } else {
          setPact(sim, a, b, Pact.None, 0);
          st.pactsEnded++;
          record(sim, `The alliance of the ${nameA} and the ${nameB} ended.`, sim.civs[a]!.capital);
        }
      } else if (cur === Pact.Pact) {
        if (trust >= ALLY.allianceTrust) {
          setPact(sim, a, b, Pact.Alliance, 0);
          st.alliancesSigned++;
          addMood(dip, a, b, 'Formed an alliance with us', ALLY.signBonus, sim.tick);
          addMood(dip, b, a, 'Formed an alliance with us', ALLY.signBonus, sim.tick);
          record(sim, `The ${nameA} and the ${nameB} formed an alliance.`, sim.civs[a]!.capital, true);
          continue;
        }
        const x = w.pactX[k];
        const gone = !sim.civs[x] || dip.danger[a * PAIRS + x] < ALLY.threatEnd || dip.danger[b * PAIRS + x] < ALLY.threatEnd;
        if (trust < ALLY.pactEnd || gone) {
          setPact(sim, a, b, Pact.None, 0);
          st.pactsEnded++;
          record(sim, `The defense pact of the ${nameA} and the ${nameB} ended.`, sim.civs[a]!.capital);
        }
      } else if (trust >= ALLY.allianceTrust) {
        setPact(sim, a, b, Pact.Alliance, 0);
        st.alliancesSigned++;
        addMood(dip, a, b, 'Formed an alliance with us', ALLY.signBonus, sim.tick);
        addMood(dip, b, a, 'Formed an alliance with us', ALLY.signBonus, sim.tick);
        record(sim, `The ${nameA} and the ${nameB} formed an alliance.`, sim.civs[a]!.capital, true);
      } else if (trust >= ALLY.pactTrust) {
        const x = commonThreat(sim, a, b, ALLY.threatForm);
        if (x > 0) {
          setPact(sim, a, b, Pact.Pact, x);
          st.pactsSigned++;
          addMood(dip, a, b, 'Signed a defense pact with us', ALLY.signBonus, sim.tick);
          addMood(dip, b, a, 'Signed a defense pact with us', ALLY.signBonus, sim.tick);
          record(sim, `The ${nameA} and the ${nameB} signed a defense pact against the ${sim.civs[x]!.name}.`, sim.civs[a]!.capital);
        }
      }
    }
  }
}


// ---------------------------------------------------------------------------
// Queries for the app (Diplomacy panel); they allocate, the simulation never calls them.

export type PactInfo = {
  civ: number;
  /** Pact.Pact (defense pact) or Pact.Alliance. */
  kind: number;
  /** A defense pact's common threat (people id), 0 for an alliance. */
  threat: number;
};

/** The pact or alliance between `a` and `b` (Pact.None, Pact.Pact, Pact.Alliance). */
export function pactBetween(sim: Simulation, a: number, b: number): number {
  return a > 0 && b > 0 && a < PAIRS && b < PAIRS ? sim.war.pact[a * PAIRS + b] : Pact.None;
}

/** The defense pacts and alliances of people `civ`. */
export function civPacts(sim: Simulation, civ: number): PactInfo[] {
  const list: PactInfo[] = [];
  const w = sim.war;
  for (let b = 1; b < sim.civs.length && b < PAIRS; b++) {
    const kind = w.pact[civ * PAIRS + b];
    if (b !== civ && kind !== Pact.None && sim.civs[b]) list.push({ civ: b, kind, threat: kind === Pact.Pact ? w.pactX[civ * PAIRS + b] : 0 });
  }
  return list;
}

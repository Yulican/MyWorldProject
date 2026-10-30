// A value explained as the sum of named terms, so the UI can show exactly how
// it was calculated. The simulation computes values from the same terms it
// shows, so the explanation can't drift from the rules.

export type Term = { label: string; value: number };

export function sumTerms(terms: readonly Term[]): number {
  let sum = 0;
  for (const t of terms) sum += t.value;
  return sum;
}

/** Adds a term that keeps the sum within [min, max], if needed. */
export function clampTerms(terms: Term[], min: number, max: number): Term[] {
  const sum = sumTerms(terms);
  if (sum > max) terms.push({ label: `Capped at ${max}`, value: max - sum });
  else if (sum < min) terms.push({ label: `Raised to ${min}`, value: min - sum });
  return terms;
}

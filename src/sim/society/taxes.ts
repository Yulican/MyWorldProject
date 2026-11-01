// The tax rules shared by the government (government.ts), the settlements'
// satisfaction (satisfaction.ts) and their economy (economy.ts); without
// imports, so these modules can all use it.

/**
 * Simulation-phase switches (tools/economyStats.ts): `goodsTax` = also tax
 * the wood and stone settlements spare (into the seat's stock); `weakest` =
 * the rate keeps the district's weakest settlement loyal (else its mean);
 * `margin` = satisfaction the settlements keep above zero; `taxPlus` /
 * `taxMinus` = the "Taxes" term at 0 % and at TAX_MAX; traders per seat and
 * at the capital.
 */
export const GOV_TUNING = { on: false, goodsTax: false, weakest: true, margin: 5, taxPlus: 5, taxMinus: 10, traders: 2, capitalTraders: 4, queue: 1, minLoad: 5 };
/** Economy variants for the simulation: money earned per adult, as a factor (1 = today). */
export const ECON_TUNING = { money: 1 };

/** The tax rate the people accept without complaint, and the highest there is. */
export const TAX_NEUTRAL = 0.1;
export const TAX_MAX = 0.5;
/** The "Taxes" satisfaction term at a money tax rate: taxPlus at 0, 0 at TAX_NEUTRAL, -taxMinus at TAX_MAX. */
export function taxValue(rate: number): number {
  if (!GOV_TUNING.on) return 0;
  if (rate <= TAX_NEUTRAL) return GOV_TUNING.taxPlus * (1 - rate / TAX_NEUTRAL);
  return -GOV_TUNING.taxMinus * Math.min(1, (rate - TAX_NEUTRAL) / (TAX_MAX - TAX_NEUTRAL));
}


// The tax rules shared by the government (government.ts), the settlements'
// satisfaction (satisfaction.ts) and their economy (economy.ts); without
// imports, so these modules can all use it. See "Design Documents/Requirement
// Zentralregierung.md".

/**
 * The government's numbers (tools/economyStats.ts can vary them):
 * - `margin`: satisfaction the weakest settlement of a district keeps above
 *   zero; `seatMargin` while the people finances a seat of government.
 * - `taxPlus` / `taxMinus`: the "Taxes" term at 0 % and at TAX_MAX;
 *   `goodsPlus` / `goodsMinus`: the same for the "Goods taxes" term.
 * - `traders`, `capitalTraders`: government traders per seat and at the capital.
 * - `minLoad`: smallest load a government trader sets out with.
 * - `seatCost`, `seatUpkeep`: factors on a seat's cost and upkeep in a
 *   government slot.
 * - `startSeats`: starting money of a new people's government, in seats.
 * - `incomeShare`: share of the potential income a district's government
 *   buildings may take in yearly upkeep.
 * - `zeroPriority`: factor on a seat site's benefit in a district at 0 % tax.
 */
export const GOV_TUNING = {
  margin: 5,
  seatMargin: 0,
  taxPlus: 5,
  taxMinus: 10,
  goodsPlus: 5,
  goodsMinus: 10,
  traders: 2,
  capitalTraders: 4,
  minLoad: 5,
  seatCost: 0.5,
  seatUpkeep: 0.5,
  startSeats: 1,
  incomeShare: 0.4,
  zeroPriority: 2,
};

/** The tax rate the people accept without complaint, and the highest there is. */
export const TAX_NEUTRAL = 0.1;
export const TAX_MAX = 0.5;

/** A tax term: `plus` at 0 %, 0 at TAX_NEUTRAL, -`minus` at TAX_MAX. */
function termValue(rate: number, plus: number, minus: number): number {
  if (rate <= TAX_NEUTRAL) return plus * (1 - rate / TAX_NEUTRAL);
  return -minus * Math.min(1, (rate - TAX_NEUTRAL) / (TAX_MAX - TAX_NEUTRAL));
}

/** The highest rate whose term is at least `need`. */
function rateForTerm(need: number, plus: number, minus: number): number {
  if (need > plus) return 0;
  if (need >= 0) return TAX_NEUTRAL * (1 - need / plus);
  return TAX_NEUTRAL + (TAX_MAX - TAX_NEUTRAL) * Math.min(1, -need / minus);
}

/** The "Taxes" satisfaction term at a money tax rate. */
export function taxValue(rate: number): number {
  return termValue(rate, GOV_TUNING.taxPlus, GOV_TUNING.taxMinus);
}

/** The highest money tax rate whose term is at least `need`. */
export function rateFor(need: number): number {
  return rateForTerm(need, GOV_TUNING.taxPlus, GOV_TUNING.taxMinus);
}

/** The "Goods taxes" satisfaction term at a goods tax rate. */
export function goodsTaxValue(rate: number): number {
  return termValue(rate, GOV_TUNING.goodsPlus, GOV_TUNING.goodsMinus);
}

/** The highest goods tax rate whose term is at least `need`. */
export function goodsRateFor(need: number): number {
  return rateForTerm(need, GOV_TUNING.goodsPlus, GOV_TUNING.goodsMinus);
}

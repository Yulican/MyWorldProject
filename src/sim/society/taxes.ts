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
export const GOV_TUNING = {
  on: false,
  goodsTax: false,
  weakest: true,
  margin: 5,
  taxPlus: 5,
  taxMinus: 10,
  traders: 2,
  capitalTraders: 4,
  queue: 1,
  minLoad: 5,
  // Baseline of the simulation phase (agreed so far): the people taxes without the safety margin while a seat is
  // financed, seats at half cost and upkeep, one seat plan per district, starting money for new peoples, goods tax
  // by need with its own term, the income check on 40 % of the potential (yearly) income, all free traders set out,
  // seats checked against the whole people's budget and planned first (benefit x2) in districts at 0 % tax.
  seatTax: 2,
  seatMargin: 0,
  seatCost: 0.5,
  seatUpkeep: 0.5,
  secureYears: 2,
  buyPartners: false,
  seatPerDistrict: true,
  startSeats: 1,
  seatLoan: false,
  allTraders: true,
  reserveUpkeep: false,
  seatsFirst: false,
  incomeShare: 0.4,
  goodsByNeed: true,
  goodsPlus: 5,
  goodsMinus: 10,
  potentialIncome: true,
  cashCheck: false,
  seatPeopleBudget: true,
  zeroPriority: 2,
};
/** Economy variants for the simulation: money earned per adult, as a factor (1 = today). */
export const ECON_TUNING = { money: 1 };

/** The tax rate the people accept without complaint, and the highest there is. */
export const TAX_NEUTRAL = 0.1;
export const TAX_MAX = 0.5;
/** The "Goods taxes" satisfaction term (goodsByNeed: the goods tax is its own rate): goodsPlus at 0, 0 at TAX_NEUTRAL, -goodsMinus at TAX_MAX. */
export function goodsTaxValue(rate: number): number {
  if (!GOV_TUNING.on || !GOV_TUNING.goodsByNeed) return 0;
  if (rate <= TAX_NEUTRAL) return GOV_TUNING.goodsPlus * (1 - rate / TAX_NEUTRAL);
  return -GOV_TUNING.goodsMinus * Math.min(1, (rate - TAX_NEUTRAL) / (TAX_MAX - TAX_NEUTRAL));
}

/** The highest goods tax rate whose term is at least `need`. */
export function goodsRateFor(need: number): number {
  if (need > GOV_TUNING.goodsPlus) return 0;
  if (need >= 0) return TAX_NEUTRAL * (1 - need / GOV_TUNING.goodsPlus);
  return TAX_NEUTRAL + (TAX_MAX - TAX_NEUTRAL) * Math.min(1, -need / GOV_TUNING.goodsMinus);
}

/** The "Taxes" satisfaction term at a money tax rate: taxPlus at 0, 0 at TAX_NEUTRAL, -taxMinus at TAX_MAX. */
export function taxValue(rate: number): number {
  if (!GOV_TUNING.on) return 0;
  if (rate <= TAX_NEUTRAL) return GOV_TUNING.taxPlus * (1 - rate / TAX_NEUTRAL);
  return -GOV_TUNING.taxMinus * Math.min(1, (rate - TAX_NEUTRAL) / (TAX_MAX - TAX_NEUTRAL));
}


// Prototype switches for the trade and satisfaction follow-up (removed once
// the user has picked the values; see "Design Documents/Requirement Handel.md").
export const PROTO = {
  /** Deliveries of a luxury good the target lacks count this many times when merchants pick a trip. */
  focusLuxury: 3,
  /** Deliveries to (or for) an unhappy settlement count this many times. */
  focusUnhappy: 2,
  /** Peoples send small groups towards free luxury deposits whose good they lack. */
  capture: true,
  captureGroup: 10,
  captureReach: 4,
  /** Settlements below this satisfaction build for it before they build for growth. */
  satisfactionFirstBelow: 5,
  satisfactionFirst: true,
  /** No settlers into a hex whose connection term would be below expandMinConnection. */
  expandOnlyHappy: true,
  expandMinConnection: 0,
  /**
   * Seats of government, second version: any settlement of 25+ may be the
   * site (the one whose seat serves the most new area), it saves up and gets
   * deliveries like any building, and replaces its least needed building
   * when no slot is free.
   */
  seatsV2: true,
  /** Settlements a people compares for its next seat (its worst connected first). */
  seatCandidates: 12,
  /** Seat planning weighs each settlement the stop holds back that the seat would free by this much. */
  frontierBonus: 20,
  /** Settlements the stop holds back build roads to the nearest seat. */
  supplyRoads: true,
  /** >0: a seat's upkeep is this much money a year instead of wood and stone. */
  seatUpkeepMoney: 0,
  /** Counters for the prototype measurements. */
  debug: { planned: 0, built: 0, expired: 0, noMaterial: 0, noUpkeep: 0, replaced: 0, lowBenefit: 0 },
};

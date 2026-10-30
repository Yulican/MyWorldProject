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
};

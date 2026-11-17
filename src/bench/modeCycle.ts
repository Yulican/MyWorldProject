import { MapModeId, allModes, type MapMode } from '../map/mapModes';

// The modes scenario (Requirement Kartenmodi 9): aged worlds, and during the
// swipes the map mode goes through every mode and sub-mode in turn, one switch
// every MODE_SWITCH_EVERY swipes, made between two swipes (the map's tiles are
// redrawn once it rests, as in the game). Political comes last, then the cycle
// starts over.

/** Swipes per mode: 11 modes and sub-modes x 7 = 77 of the 80 swipes, the last ones start the cycle again. */
export const MODE_SWITCH_EVERY = 7;

/** Every mode other than Political in list order, then Political. */
export function modeCycle(): MapMode[] {
  const modes = allModes();
  return [...modes.filter((m) => m.id !== MapModeId.Political), ...modes.filter((m) => m.id === MapModeId.Political)];
}

/** The mode for swipe `i` of a world (0-based); the first is set before the warm-up swipe. */
export function modeForSwipe(i: number): MapMode {
  const cycle = modeCycle();
  return cycle[Math.floor(i / MODE_SWITCH_EVERY) % cycle.length];
}

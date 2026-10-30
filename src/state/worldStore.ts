import { useSyncExternalStore } from 'react';
import { generateWorld, randomSeed, type World } from '../sim';

// Holds the current world outside React (see design doc: simulation state
// lives outside React, components subscribe to what they need).

let current: World | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Generates a new world (random seed if none given) and makes it current. */
export function createNewWorld(seed: number = randomSeed()): World {
  current = generateWorld({ seed });
  listeners.forEach((l) => l());
  return current;
}

export function getWorld(): World | null {
  return current;
}

/** The current world; React re-renders when a new world replaces it. */
export function useWorld(): World | null {
  return useSyncExternalStore(subscribe, getWorld);
}

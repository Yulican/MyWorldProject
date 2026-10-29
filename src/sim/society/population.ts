// Inhabitants as a "struct of arrays": one typed array per attribute, indexed
// by agent slot. Dead agents leave a hole that the free list hands out again,
// so slots stay stable and nothing is shifted around.

export type Population = {
  /** Number of slots; grows by doubling when full. */
  capacity: number;
  /** Living inhabitants. */
  count: number;
  /** One past the highest slot ever used, so loops can stop early. */
  end: number;
  alive: Uint8Array;
  /** Age in years. */
  age: Uint8Array;
  cell: Int32Array;
  /** Civilization id, see civilizations.ts. */
  civ: Uint8Array;
  /** Faith in the player 0..1. */
  faith: Float32Array;
  freeSlots: Int32Array;
  freeCount: number;
};

export function createPopulation(capacity: number): Population {
  return {
    capacity,
    count: 0,
    end: 0,
    alive: new Uint8Array(capacity),
    age: new Uint8Array(capacity),
    cell: new Int32Array(capacity),
    civ: new Uint8Array(capacity),
    faith: new Float32Array(capacity),
    freeSlots: new Int32Array(capacity),
    freeCount: 0,
  };
}

/** Takes a slot for a new inhabitant and returns it. Only the caller fills in the attributes. */
export function allocateSlot(pop: Population): number {
  if (pop.freeCount > 0) return pop.freeSlots[--pop.freeCount];
  if (pop.end === pop.capacity) grow(pop);
  return pop.end++;
}

export function releaseSlot(pop: Population, slot: number): void {
  pop.alive[slot] = 0;
  pop.freeSlots[pop.freeCount++] = slot;
}

function grow(pop: Population): void {
  const capacity = pop.capacity * 2;
  pop.alive = copyInto(new Uint8Array(capacity), pop.alive);
  pop.age = copyInto(new Uint8Array(capacity), pop.age);
  pop.cell = copyInto(new Int32Array(capacity), pop.cell);
  pop.civ = copyInto(new Uint8Array(capacity), pop.civ);
  pop.faith = copyInto(new Float32Array(capacity), pop.faith);
  pop.freeSlots = copyInto(new Int32Array(capacity), pop.freeSlots);
  pop.capacity = capacity;
}

function copyInto<T extends Uint8Array | Int32Array | Float32Array>(target: T, source: T): T {
  target.set(source as never);
  return target;
}

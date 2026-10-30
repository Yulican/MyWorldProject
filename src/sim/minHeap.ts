/** Binary min-heap of integer items with numeric priorities (typed arrays, no allocation per push). */
export class MinHeap {
  private items: Int32Array;
  private priorities: Float64Array;
  size = 0;

  constructor(capacity: number) {
    this.items = new Int32Array(capacity);
    this.priorities = new Float64Array(capacity);
  }

  push(item: number, priority: number): void {
    if (this.size === this.items.length) this.grow();
    let i = this.size++;
    // Sift up.
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= priority) break;
      this.items[i] = this.items[parent];
      this.priorities[i] = this.priorities[parent];
      i = parent;
    }
    this.items[i] = item;
    this.priorities[i] = priority;
  }

  /** Removes and returns the item with the lowest priority. Heap must not be empty. */
  pop(): number {
    const top = this.items[0];
    const lastItem = this.items[--this.size];
    const lastPriority = this.priorities[this.size];
    // Sift the last element down from the root.
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= this.size) break;
      const right = left + 1;
      const child =
        right < this.size && this.priorities[right] < this.priorities[left] ? right : left;
      if (this.priorities[child] >= lastPriority) break;
      this.items[i] = this.items[child];
      this.priorities[i] = this.priorities[child];
      i = child;
    }
    this.items[i] = lastItem;
    this.priorities[i] = lastPriority;
    return top;
  }

  private grow(): void {
    const items = new Int32Array(this.items.length * 2);
    items.set(this.items);
    this.items = items;
    const priorities = new Float64Array(this.priorities.length * 2);
    priorities.set(this.priorities);
    this.priorities = priorities;
  }
}

import { createRng, type Rng } from './rng';
import { createWorld, type World } from './world';

// Struct-of-Arrays: ein typisiertes Array je Eigenschaft statt Objekte pro Bewohner.
// Speicher- und cachefreundlich, Grundlage für 10.000+ Agenten.

export const TICKS_PER_YEAR = 52; // 1 Tick = 1 Woche
export const NEED_COUNT = 5; // Nahrung, Sicherheit, Gesundheit, Zugehörigkeit, Sinn

export type Personality = {
  agent: number; // Index im Agenten-Array
  traits: Float32Array; // z. B. Mut, Weisheit, Charisma, Grausamkeit, Frömmigkeit ...
  fame: number;
  chronicle: number; // Anzahl Ereignisse (Platzhalter für die Biografie)
};

export type SimOptions = {
  seed: number;
  agentCount: number;
  capacity?: number;
  width?: number;
  height?: number;
  civCount?: number;
  personalityCount?: number;
};

export class Simulation {
  readonly rng: Rng;
  readonly world: World;
  readonly capacity: number;
  tick = 0;
  alive = 0;

  readonly isAlive: Uint8Array;
  readonly age: Uint8Array;
  readonly cell: Int32Array;
  readonly civ: Uint8Array;
  readonly faith: Float32Array; // 0..1
  readonly needs: Float32Array; // NEED_COUNT je Agent, 1 = unerfüllt
  readonly pressure: Float32Array; // höchster Bedarf des letzten Ticks
  private readonly freeList: Int32Array;
  private freeCount = 0;

  private readonly cellFaithSum: Float32Array;
  private readonly cellCount: Int32Array;
  private readonly cellBoost: Float32Array;

  readonly prayers: Float64Array; // Gebete je Zivilisation im letzten Tick (Index 0 unbenutzt)
  influence = 0; // Einflusspunkte der Spieler-Zivilisation (Civ 1)

  readonly personalities: Personality[] = [];

  constructor(opts: SimOptions) {
    this.rng = createRng(opts.seed);
    const civCount = opts.civCount ?? 5;
    this.world = createWorld(opts.width ?? 96, opts.height ?? 96, civCount, this.rng);
    this.capacity = opts.capacity ?? Math.floor(opts.agentCount * 1.5);
    const n = this.capacity;

    this.isAlive = new Uint8Array(n);
    this.age = new Uint8Array(n);
    this.cell = new Int32Array(n);
    this.civ = new Uint8Array(n);
    this.faith = new Float32Array(n);
    this.needs = new Float32Array(n * NEED_COUNT);
    this.pressure = new Float32Array(n);
    this.freeList = new Int32Array(n);
    this.cellFaithSum = new Float32Array(this.world.cellCount);
    this.cellCount = new Int32Array(this.world.cellCount);
    this.cellBoost = new Float32Array(this.world.cellCount);
    this.prayers = new Float64Array(civCount + 1);

    this.spawnInitial(opts.agentCount);
    this.createPersonalities(opts.personalityCount ?? 300);
  }

  /** Grober Speicherbedarf der typisierten Arrays in Bytes. */
  get memoryBytes(): number {
    return (
      this.isAlive.byteLength + this.age.byteLength + this.cell.byteLength +
      this.civ.byteLength + this.faith.byteLength + this.needs.byteLength +
      this.pressure.byteLength + this.freeList.byteLength +
      this.world.food.byteLength + this.world.danger.byteLength +
      this.world.civ.byteLength + this.world.neighbors.byteLength +
      this.cellFaithSum.byteLength + this.cellCount.byteLength + this.cellBoost.byteLength
    );
  }

  private spawnInitial(count: number) {
    const owned: number[] = [];
    for (let c = 0; c < this.world.cellCount; c++) {
      if (this.world.civ[c] !== 0) owned.push(c);
    }
    for (let i = 0; i < this.capacity; i++) {
      this.freeList[this.freeCount++] = this.capacity - 1 - i;
    }
    for (let i = 0; i < count; i++) {
      const c = owned[Math.floor(this.rng() * owned.length)];
      this.addAgent(c, Math.floor(this.rng() * 60), 0.1 * this.rng());
    }
  }

  private addAgent(cell: number, age: number, faith: number): number {
    if (this.freeCount === 0) return -1;
    const i = this.freeList[--this.freeCount];
    this.isAlive[i] = 1;
    this.age[i] = age;
    this.cell[i] = cell;
    this.civ[i] = this.world.civ[cell];
    this.faith[i] = faith;
    const base = i * NEED_COUNT;
    for (let k = 0; k < NEED_COUNT; k++) this.needs[base + k] = 0.3 * this.rng();
    this.pressure[i] = 0;
    this.alive++;
    return i;
  }

  private createPersonalities(count: number) {
    let tries = 0;
    while (this.personalities.length < count && tries < count * 20) {
      tries++;
      const i = Math.floor(this.rng() * this.capacity);
      if (!this.isAlive[i]) continue;
      const traits = new Float32Array(8);
      for (let k = 0; k < 8; k++) traits[k] = this.rng();
      this.personalities.push({ agent: i, traits, fame: this.rng(), chronicle: 0 });
    }
  }

  /** Ein Zeitschritt = eine Woche. */
  step() {
    const { world, rng } = this;
    const n = this.capacity;
    const food = world.food;
    const danger = world.danger;
    const needs = this.needs;
    const faith = this.faith;
    const prayers = this.prayers;
    prayers.fill(0);

    // 1) Persönlichkeiten wirken auf ihre Zelle (Propheten verstärken Glauben)
    this.cellBoost.fill(0);
    for (const p of this.personalities) {
      if (!this.isAlive[p.agent]) continue;
      const boost = p.traits[2] * p.traits[4] * p.fame * 0.02;
      this.cellBoost[this.cell[p.agent]] += boost;
      p.chronicle += rng() < 0.001 ? 1 : 0;
      p.fame = Math.min(1, p.fame + (rng() - 0.5) * 0.002);
    }

    // 2) Hauptschleife: Bedürfnisse, Gebete, Bewegung
    this.cellFaithSum.fill(0);
    this.cellCount.fill(0);
    for (let i = 0; i < n; i++) {
      if (this.isAlive[i] === 0) continue;
      const c = this.cell[i];
      const base = i * NEED_COUNT;
      const prev = this.pressure[i];

      const n0 = needs[base] + ((1 - food[c]) - needs[base]) * 0.05 + (rng() - 0.5) * 0.02;
      const n1 = needs[base + 1] + (danger[c] - needs[base + 1]) * 0.05 + (rng() - 0.5) * 0.02;
      const n2 = needs[base + 2] + (0.2 + this.age[i] * 0.006 - needs[base + 2]) * 0.03;
      const n3 = needs[base + 3] + (0.3 - needs[base + 3]) * 0.02 + (rng() - 0.5) * 0.02;
      const n4 = needs[base + 4] + (0.5 - faith[i] * 0.5 - needs[base + 4]) * 0.02;
      needs[base] = n0 < 0 ? 0 : n0 > 1 ? 1 : n0;
      needs[base + 1] = n1 < 0 ? 0 : n1 > 1 ? 1 : n1;
      needs[base + 2] = n2 < 0 ? 0 : n2 > 1 ? 1 : n2;
      needs[base + 3] = n3 < 0 ? 0 : n3 > 1 ? 1 : n3;
      needs[base + 4] = n4 < 0 ? 0 : n4 > 1 ? 1 : n4;

      let maxNeed = needs[base];
      if (needs[base + 1] > maxNeed) maxNeed = needs[base + 1];
      if (needs[base + 2] > maxNeed) maxNeed = needs[base + 2];
      if (needs[base + 3] > maxNeed) maxNeed = needs[base + 3];
      if (needs[base + 4] > maxNeed) maxNeed = needs[base + 4];
      this.pressure[i] = maxNeed;

      // Gebete aus Not (hoher Druck) oder Dankbarkeit (Druck fällt stark)
      const f = faith[i];
      if (f > 0.05) {
        if (maxNeed > 0.7 && rng() < f * 0.15) {
          prayers[this.civ[i]]++;
        } else if (prev > 0.7 && maxNeed < 0.4 && rng() < f * 0.3) {
          prayers[this.civ[i]]++;
          faith[i] = f + 0.03 > 1 ? 1 : f + 0.03;
        }
      }

      this.cellFaithSum[c] += faith[i];
      this.cellCount[c]++;

      // Bewegung: 2 % wandern auf eine Nachbarzelle
      if (rng() < 0.02) {
        const nb = world.neighbors[c * 6 + Math.floor(rng() * 6)];
        if (nb >= 0 && world.civ[nb] !== 0) this.cell[i] = nb;
      }
    }

    // 3) Glaubensausbreitung über das Umfeld (Zellmittel + Prophetenwirkung)
    for (let i = 0; i < n; i++) {
      if (this.isAlive[i] === 0) continue;
      const c = this.cell[i];
      const cnt = this.cellCount[c];
      if (cnt === 0) continue;
      const mean = this.cellFaithSum[c] / cnt;
      let f = faith[i] + (mean - faith[i]) * 0.02 + this.cellBoost[c];
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      faith[i] = f;
    }

    this.influence += prayers[1];
    this.tick++;

    // 4) Jährlich: Altern, Tod, Geburten
    if (this.tick % TICKS_PER_YEAR === 0) this.yearly();
  }

  private yearly() {
    const { rng } = this;
    const n = this.capacity;
    for (let i = 0; i < n; i++) {
      if (this.isAlive[i] === 0) continue;
      const a = this.age[i] + 1;
      this.age[i] = a > 255 ? 255 : a;
      const dieChance = a < 50 ? 0.004 : 0.004 + (a - 50) * 0.01;
      if (rng() < dieChance) {
        this.isAlive[i] = 0;
        this.freeList[this.freeCount++] = i;
        this.alive--;
        continue;
      }
      if (a >= 18 && a <= 40 && rng() < 0.07 * this.world.food[this.cell[i]] * 1.4) {
        const inherited = this.faith[i] * 0.8 + 0.1 * rng();
        this.addAgent(this.cell[i], 0, inherited > 1 ? 1 : inherited);
      }
    }
  }
}

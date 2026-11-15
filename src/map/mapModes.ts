import { DEPOSITS, RESOURCE_COUNT, Resource, SUPPLY_KINDS, isWaterBiome, type DepositCategory, type Simulation } from '../sim';
import { DEPOSIT_COLORS, FERTILITY_SCALES, POPULATION_SCALE, SATISFACTION_SCALE, SUPPLY_SCALE } from './palette';

// Map modes (Requirement Kartenmodi): which value colors the map, its color
// buckets, the numbers drawn on settlements, and the per-hex buffer the map
// tiles read. Plain TypeScript (no Skia), so it is testable in Node. The
// simulation is only read, never changed.

export const MapModeId = {
  Political: 0,
  Satisfaction: 1,
  Population: 2,
  Supply: 3,
  Fertility: 4,
  Deposits: 5,
} as const;

export type MapMode = { id: number; sub: number };
export const POLITICAL: MapMode = { id: MapModeId.Political, sub: 0 };

export type ModeInfo = {
  /** Saved in the app trailer ("supply.water"); never rename. */
  key: string;
  /** Shown in the mode list and the legend bar. */
  name: string;
  /** Sub-modes, switchable in the legend bar; the first is the default. Empty: none. */
  subs: readonly string[];
  /** Hex fill with dimmed terrain (Requirement Kartenmodi 3); Deposits only draws a dot. */
  fill: boolean;
  /** Numbers on settlement hexes (zoom >= 1.15). */
  labels: boolean;
};

/** In the order of the mode list. Index = MapModeId. */
export const MODES: readonly ModeInfo[] = [
  { key: 'political', name: 'Political', subs: [], fill: false, labels: false },
  {
    key: 'satisfaction',
    name: 'Satisfaction',
    subs: [],
    fill: true,
    labels: true,
  },
  { key: 'population', name: 'Population', subs: [], fill: true, labels: true },
  {
    key: 'supply',
    name: 'Supply',
    subs: ['Food', 'Water', 'Space'],
    fill: true,
    labels: true,
  },
  {
    key: 'fertility',
    name: 'Fertility',
    subs: ['Food', 'Water', 'Wood', 'Stone'],
    fill: true,
    labels: false,
  },
  { key: 'deposits', name: 'Deposits', subs: [], fill: false, labels: false },
];

// ---------------------------------------------------------------------------
// Bucket boundaries: ALL map-mode scale edges live here (agreed with the
// user from tools/modeBucketStats.ts, Requirement Kartenmodi 4). A value v
// falls into bucket k = number of edges <= v, so n edges make n + 1 buckets.

/** Satisfaction -100..100: 10 buckets, 0 is the red/green boundary (legend about -30..+40). */
export const SATISFACTION_EDGES = [-20, -10, -5, 0, 5, 10, 15, 20, 30] as const;
/** Inhabitants per hex: 10 buckets. */
export const POPULATION_EDGES = [10, 20, 35, 50, 65, 80, 100, 125, 150] as const;
/** Supply load in percent (inhabitants / supply of the sub-mode's kind), all sub-modes: 8 buckets, green < 70, yellow 85-105, dark red >= 120. */
export const SUPPLY_EDGES = [25, 50, 70, 85, 95, 105, 120] as const;
/**
 * Fertility by sub-mode: Food and Water as the natural yield in people per
 * hex (baseSupply, as in the hex panel), Wood and Stone as the 0..1 resource
 * in percent.
 */
export const FERTILITY_EDGES: readonly (readonly number[])[] = [
  [10, 20, 30, 45, 60, 80, 100, 130], // Food (people)
  [10, 20, 35, 50, 70, 90, 120, 160], // Water (people)
  [5, 10, 20, 30, 50, 70, 90], // Wood (%)
  [10, 15, 20, 30, 50, 70, 90], // Stone (%)
];
/** Deposit categories in legend order; bucket = index + 1. */
export const DEPOSIT_ORDER: readonly DepositCategory[] = ['metal', 'mineral', 'bounty', 'mystic'];

/** Bucket of `v` for ascending `edges`: the number of edges <= v. */
export function bucketOf(v: number, edges: readonly number[]): number {
  let k = 0;
  while (k < edges.length && v >= edges[k]) k++;
  return k;
}

/** The colors of a mode's buckets (index = bucket); empty for Political. */
export function modeColors(mode: MapMode): readonly string[] {
  switch (mode.id) {
    case MapModeId.Satisfaction:
      return SATISFACTION_SCALE;
    case MapModeId.Population:
      return POPULATION_SCALE;
    case MapModeId.Supply:
      return SUPPLY_SCALE;
    case MapModeId.Fertility:
      return FERTILITY_SCALES[mode.sub] ?? FERTILITY_SCALES[0];
    case MapModeId.Deposits:
      return DEPOSIT_ORDER.map((c) => DEPOSIT_COLORS[c]);
    default:
      return [];
  }
}

function modeEdges(mode: MapMode): readonly number[] {
  switch (mode.id) {
    case MapModeId.Satisfaction:
      return SATISFACTION_EDGES;
    case MapModeId.Population:
      return POPULATION_EDGES;
    case MapModeId.Supply:
      return SUPPLY_EDGES;
    case MapModeId.Fertility:
      return FERTILITY_EDGES[mode.sub] ?? FERTILITY_EDGES[0];
    default:
      return [];
  }
}

export type LegendEntry = { color: string; label: string };
/** The legend bar: a color scale with its bucket starts, or a color list. */
export type Legend = { title: string; entries: LegendEntry[]; unit: string };

const DEPOSIT_TITLES: Record<DepositCategory, string> = {
  metal: 'Metal',
  mineral: 'Mineral',
  bounty: 'Bounty',
  mystic: 'Mystic',
};

export function modeLegend(mode: MapMode): Legend | null {
  const info = MODES[mode.id];
  if (!info || mode.id === MapModeId.Political) return null;
  const colors = modeColors(mode);
  const title = info.subs.length > 0 ? `${info.name} · ${info.subs[mode.sub] ?? info.subs[0]}` : info.name;
  if (mode.id === MapModeId.Deposits) {
    return {
      title,
      unit: '',
      entries: DEPOSIT_ORDER.map((cat, i) => ({
        color: colors[i],
        label: `${DEPOSIT_TITLES[cat]} (${DEPOSITS.filter((d, id) => id > 0 && d.category === cat)
          .map((d) => d.name)
          .join(', ')})`,
      })),
    };
  }
  const edges = modeEdges(mode);
  const entries = colors.map((color, k) => ({
    color,
    label: k === 0 ? `<${edges[0]}` : String(edges[k - 1]),
  }));
  const unit =
    mode.id === MapModeId.Satisfaction
      ? ''
      : mode.id === MapModeId.Population
        ? 'people'
        : mode.id === MapModeId.Supply
          ? '% load'
          : mode.sub < 2
            ? 'people'
            : '%';
  return { title, entries, unit };
}

// ---------------------------------------------------------------------------
// Saving (app trailer, Requirement Kartenmodi 7)

export function modeKey(mode: MapMode): string {
  const info = MODES[mode.id] ?? MODES[0];
  return info.subs.length > 0 ? `${info.key}.${info.subs[mode.sub]?.toLowerCase() ?? info.subs[0].toLowerCase()}` : info.key;
}

/** The mode a saved key names; Political for a missing or unknown one. */
export function parseModeKey(key: unknown): MapMode {
  if (typeof key !== 'string') return POLITICAL;
  const [name, sub] = key.split('.');
  const id = MODES.findIndex((m) => m.key === name);
  if (id < 0) return POLITICAL;
  const subs = MODES[id].subs;
  if (subs.length === 0) return sub === undefined ? { id, sub: 0 } : POLITICAL;
  const s = subs.findIndex((n) => n.toLowerCase() === sub);
  return s < 0 ? POLITICAL : { id, sub: s };
}

/** Every mode and sub-mode in list order (the benchmark's cycle). */
export function allModes(): MapMode[] {
  const out: MapMode[] = [];
  MODES.forEach((m, id) => {
    if (m.subs.length === 0) out.push({ id, sub: 0 });
    else m.subs.forEach((_, sub) => out.push({ id, sub }));
  });
  return out;
}

// ---------------------------------------------------------------------------
// The per-hex buffer (filled per snapshot, only outside Political)

/** `mark` bits per hex. */
export const MARK_LABEL = 1;
/** Satisfaction < 0, not the capital: may rebel (Requirement Krieg 8): a red frame around the number. */
export const MARK_REBEL = 2;
/** Largest label value kept; labelText shows up to 4 characters. */
const LABEL_MAX = 999_999;

/**
 * What the map tiles draw for the active mode: per hex its bucket + 1 (0 =
 * not colored), the number shown on it and marks. Arrays are reused; a new
 * world size replaces them.
 */
export type MapModeData = {
  id: number;
  sub: number;
  bucket: Uint8Array;
  label: Int32Array;
  mark: Uint8Array;
  /** Changes with the mode or the buffer's content. */
  version: number;
};

export function createModeData(): MapModeData {
  return {
    id: 0,
    sub: 0,
    bucket: new Uint8Array(0),
    label: new Int32Array(0),
    mark: new Uint8Array(0),
    version: 0,
  };
}

/**
 * Fills `data` for its mode from the simulation; true when anything a tile
 * shows changed. Political leaves the arrays as they are (nothing draws them).
 */
export function fillModeData(sim: Simulation, data: MapModeData): boolean {
  const world = sim.world;
  const n = world.cellCount;
  let changed = false;
  if (data.bucket.length !== n) {
    data.bucket = new Uint8Array(n);
    data.label = new Int32Array(n);
    data.mark = new Uint8Array(n);
    changed = true;
  }
  if (data.id === MapModeId.Political) return changed;
  const { bucket, label, mark } = data;
  const edges = modeEdges(data);
  const sub = data.sub;
  for (let c = 0; c < n; c++) {
    let b = 0;
    let v = 0;
    let m = 0;
    const pop = sim.cellPop[c];
    switch (data.id) {
      case MapModeId.Satisfaction:
        if (pop > 0 && world.owner[c] !== 0) {
          v = Math.round(sim.satisfaction[c]);
          b = bucketOf(sim.satisfaction[c], edges) + 1;
          m = MARK_LABEL;
          if (sim.satisfaction[c] < 0 && sim.civs[world.owner[c]]?.capital !== c) m |= MARK_REBEL;
        }
        break;
      case MapModeId.Population:
        if (pop > 0) {
          v = pop;
          b = bucketOf(pop, edges) + 1;
          m = MARK_LABEL;
        }
        break;
      case MapModeId.Supply:
        if (pop > 0) {
          const supply = sim.cellSupply[c * SUPPLY_KINDS + sub];
          v = supply > 0 ? Math.round((100 * pop) / supply) : LABEL_MAX;
          b = bucketOf(v, edges) + 1;
          m = MARK_LABEL;
        }
        break;
      case MapModeId.Fertility:
        if (!isWaterBiome(world.biome[c])) {
          const value =
            sub < 2
              ? sim.baseSupply[c * SUPPLY_KINDS + sub]
              : 100 * world.resources[c * RESOURCE_COUNT + (sub === 2 ? Resource.Wood : Resource.Stone)];
          b = bucketOf(value, edges) + 1;
        }
        break;
      case MapModeId.Deposits: {
        const id = world.deposit[c];
        if (id > 0) b = DEPOSIT_ORDER.indexOf(DEPOSITS[id].category) + 1;
        break;
      }
    }
    if (v > LABEL_MAX) v = LABEL_MAX;
    if (bucket[c] !== b || label[c] !== v || mark[c] !== m) {
      bucket[c] = b;
      label[c] = v;
      mark[c] = m;
      changed = true;
    }
  }
  return changed;
}

/**
 * Mixes what the mode draws on `cells` (mode, sub-mode, buckets, marks and
 * shown numbers) into the FNV hash `h` of a tile's signature; Political adds
 * nothing, so its tiles keep their signature.
 */
export function modeSignature(h: number, mode: MapModeData, cells: Int32Array): number {
  if (mode.id === MapModeId.Political || mode.bucket.length === 0) return h;
  h = Math.imul(h ^ (mode.id + 1), 0x01000193);
  h = Math.imul(h ^ mode.sub, 0x01000193);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const m = mode.mark[c];
    h = Math.imul(h ^ mode.bucket[c], 0x01000193);
    h = Math.imul(h ^ m, 0x01000193);
    if (m & MARK_LABEL) h = Math.imul(h ^ mode.label[c], 0x01000193);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Numbers on the map (Requirement Kartenmodi 9): at most 4 characters, drawn
// from vector glyphs into the tile images (no text in the frame).

/** The text of a label: up to 4 characters, thousands as "1k". */
export function labelText(v: number): string {
  if (v > 999) return `${Math.min(999, Math.floor(v / 1000))}k`;
  return String(v);
}

/**
 * Glyph strokes on a unit box (x 0..1 right, y 0..1 down), as polylines of
 * x, y pairs: digits, minus and k. Built once; tiles add them to one path.
 */
export const GLYPHS: Record<string, readonly (readonly number[])[]> = {
  '0': [[0, 0, 1, 0, 1, 1, 0, 1, 0, 0]],
  '1': [
    [0.2, 0.2, 0.55, 0, 0.55, 1],
    [0.2, 1, 0.9, 1],
  ],
  '2': [[0, 0, 1, 0, 1, 0.5, 0, 0.5, 0, 1, 1, 1]],
  '3': [
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0.2, 0.5, 1, 0.5],
  ],
  '4': [
    [0, 0, 0, 0.55, 1, 0.55],
    [0.8, 0, 0.8, 1],
  ],
  '5': [[1, 0, 0, 0, 0, 0.5, 1, 0.5, 1, 1, 0, 1]],
  '6': [[1, 0, 0, 0, 0, 1, 1, 1, 1, 0.5, 0, 0.5]],
  '7': [[0, 0, 1, 0, 0.4, 1]],
  '8': [
    [0, 0, 1, 0, 1, 1, 0, 1, 0, 0],
    [0, 0.5, 1, 0.5],
  ],
  '9': [[1, 0.5, 0, 0.5, 0, 0, 1, 0, 1, 1, 0, 1]],
  '-': [[0.1, 0.5, 0.9, 0.5]],
  k: [
    [0, 0, 0, 1],
    [0.9, 0.35, 0, 0.75],
    [0.35, 0.6, 0.9, 1],
  ],
};
/** Glyph advance in glyph widths (the gap between characters included). */
export const GLYPH_ADVANCE = 1.5;

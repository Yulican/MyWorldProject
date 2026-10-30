import { CHUNK_H, CHUNK_W } from './mapGeometry';

/** The parts of the map layers the tile math needs. */
type TileGrid = { width: number; chunkCols: number; chunkRows: number };

/**
 * Zoom range in which the sharp detail tiles switch on/off. Detail turns on
 * above DETAIL_ON and only turns off again below DETAIL_OFF, so a pinch
 * hovering around one value doesn't toggle all tiles every frame.
 */
export const DETAIL_ON = 0.75;
export const DETAIL_OFF = 0.65;

/**
 * Detail tiles are pre-rendered images. Each tier renders them sharp for zooms
 * up to TIER_ZOOMS[tier]; above the last one they are scaled up a little.
 */
export const TIER_ZOOMS = [1, 2, 3] as const;
/** How far past a tier's range the zoom may go before the tier changes. */
const TIER_HYSTERESIS = 0.1;

/**
 * The visible area quantized to tile units, plus whether detail is shown and
 * at which tier. Only changes when the view crosses a tile border or a zoom
 * threshold, so React re-renders rarely while panning.
 */
export type ViewTiles = { x0: number; x1: number; y0: number; y1: number; detail: boolean; tier: number };

/** Zoom range a tier covers. */
function tierRange(tier: number): [number, number] {
  'worklet';
  const lo = tier === 0 ? 0 : TIER_ZOOMS[tier - 1] + 0.15;
  const hi = tier === TIER_ZOOMS.length - 1 ? Infinity : TIER_ZOOMS[tier] + 0.15;
  return [lo, hi];
}

/** The tier for a zoom, sticking with `prev` while the zoom stays near its range. */
export function pickTier(scale: number, prev: number): number {
  'worklet';
  if (prev >= 0) {
    const [lo, hi] = tierRange(prev);
    if (scale >= lo - TIER_HYSTERESIS && scale <= hi + TIER_HYSTERESIS) return prev;
  }
  for (let t = 0; t < TIER_ZOOMS.length; t++) {
    if (scale <= tierRange(t)[1]) return t;
  }
  return TIER_ZOOMS.length - 1;
}

/**
 * `keepTier` holds the previous tier (during a pinch, so tiles aren't
 * re-rendered for every intermediate zoom; they are scaled meanwhile).
 */
export function viewTiles(
  tx: number,
  ty: number,
  scale: number,
  viewW: number,
  viewH: number,
  prev: ViewTiles | null,
  keepTier = false,
): ViewTiles {
  'worklet';
  const detailBefore = prev !== null && prev.detail;
  const prevTier = prev === null ? -1 : prev.tier;
  return {
    x0: Math.floor(-tx / scale / CHUNK_W),
    x1: Math.floor((viewW - tx) / scale / CHUNK_W),
    y0: Math.floor(-ty / scale / CHUNK_H),
    y1: Math.floor((viewH - ty) / scale / CHUNK_H),
    detail: detailBefore ? scale >= DETAIL_OFF : scale >= DETAIL_ON,
    tier: keepTier && prevTier >= 0 ? prevTier : pickTier(scale, prevTier),
  };
}

export function sameViewTiles(a: ViewTiles, b: ViewTiles): boolean {
  'worklet';
  return (
    a.x0 === b.x0 && a.x1 === b.x1 && a.y0 === b.y0 && a.y1 === b.y1 && a.detail === b.detail && a.tier === b.tier
  );
}

export type TileRef = {
  key: string;
  chunk: number;
  col: number;
  row: number;
  offsetX: number;
  /** Distance from the view center in tiles, for loading the nearest first. */
  distance: number;
};

/**
 * Tiles that overlap the visible area grown by `margin` tiles on each side,
 * across horizontal map copies (the map wraps, so a view can show the end of
 * one copy and the start of the next).
 */
export function visibleTiles(view: ViewTiles, layers: TileGrid, margin = 0): TileRef[] {
  'worklet';
  if (!view.detail) return [];
  const tiles: TileRef[] = [];
  const cx = (view.x0 + view.x1 + 1) / 2;
  const cy = (view.y0 + view.y1 + 1) / 2;
  const x0 = (view.x0 - margin) * CHUNK_W;
  const x1 = (view.x1 + 1 + margin) * CHUNK_W;
  const row0 = Math.max(0, view.y0 - margin);
  const row1 = Math.min(layers.chunkRows - 1, view.y1 + margin);
  for (let copy = Math.floor(x0 / layers.width); copy <= Math.floor(x1 / layers.width); copy++) {
    const offsetX = copy * layers.width;
    const lo = Math.max(0, x0 - offsetX);
    const hi = Math.min(layers.width, x1 - offsetX);
    if (lo >= hi) continue;
    const col0 = Math.floor(lo / CHUNK_W);
    const col1 = Math.min(layers.chunkCols - 1, Math.ceil(hi / CHUNK_W) - 1); // hi is exclusive
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const chunk = row * layers.chunkCols + col;
        const distance = Math.hypot(col + 0.5 + offsetX / CHUNK_W - cx, row + 0.5 - cy);
        tiles.push({ key: `${copy}:${chunk}`, chunk, col, row, offsetX, distance });
      }
    }
  }
  return tiles;
}

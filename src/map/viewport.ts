import { CHUNK_H, CHUNK_W } from './mapGeometry';

/** The parts of the map layers the tile math needs. */
type TileGrid = { width: number; chunkCols: number; chunkRows: number };

/**
 * Zoom range in which the sharp vector tiles with icons switch on/off. Detail
 * turns on above DETAIL_ON and only turns off again below DETAIL_OFF, so a
 * pinch hovering around one value doesn't toggle all tiles every frame.
 */
export const DETAIL_ON = 0.75;
export const DETAIL_OFF = 0.65;

/**
 * The visible area quantized to tile units, plus whether detail is shown.
 * Only changes when the view crosses a tile border, so React re-renders
 * rarely while panning.
 */
export type ViewTiles = { x0: number; x1: number; y0: number; y1: number; detail: boolean };

export function viewTiles(
  tx: number,
  ty: number,
  scale: number,
  viewW: number,
  viewH: number,
  detailBefore: boolean,
): ViewTiles {
  'worklet';
  return {
    x0: Math.floor(-tx / scale / CHUNK_W),
    x1: Math.floor((viewW - tx) / scale / CHUNK_W),
    y0: Math.floor(-ty / scale / CHUNK_H),
    y1: Math.floor((viewH - ty) / scale / CHUNK_H),
    detail: detailBefore ? scale >= DETAIL_OFF : scale >= DETAIL_ON,
  };
}

export function sameViewTiles(a: ViewTiles, b: ViewTiles): boolean {
  'worklet';
  return a.x0 === b.x0 && a.x1 === b.x1 && a.y0 === b.y0 && a.y1 === b.y1 && a.detail === b.detail;
}

export type TileRef = { key: string; chunk: number; offsetX: number };

/**
 * Tiles that overlap the visible area, across horizontal map copies (the map
 * wraps, so a view can show the end of one copy and the start of the next).
 */
export function visibleTiles(view: ViewTiles, layers: TileGrid): TileRef[] {
  if (!view.detail) return [];
  const tiles: TileRef[] = [];
  const x0 = view.x0 * CHUNK_W;
  const x1 = (view.x1 + 1) * CHUNK_W;
  const row0 = Math.max(0, view.y0);
  const row1 = Math.min(layers.chunkRows - 1, view.y1);
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
        tiles.push({ key: `${copy}:${chunk}`, chunk, offsetX });
      }
    }
  }
  return tiles;
}

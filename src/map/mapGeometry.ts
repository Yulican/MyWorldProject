// Map rendering sizes, kept free of Skia imports so tile math can be tested in Node.

/** Hex size (center to corner) in picture pixels. The map view scales from there. */
export const HEX_PX = 24;
/**
 * Hexes per side of a detail tile. Tiles are pre-rendered images; small tiles
 * keep the memory for the screen's tiles low at high zoom.
 */
export const CHUNK_HEXES = 4;
/** Tile size in picture pixels. */
export const CHUNK_W = CHUNK_HEXES * 1.5 * HEX_PX;
export const CHUNK_H = CHUNK_HEXES * Math.sqrt(3) * HEX_PX;

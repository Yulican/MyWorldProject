import {
  Skia,
  createPicture,
  drawAsImageFromPicture,
  type SkCanvas,
  type SkImage,
  type SkPathBuilder,
  type SkPicture,
} from '@shopify/react-native-skia';
import {
  Biome,
  DEPOSITS,
  DIRECTION_OFFSETS,
  hexCenterX,
  hexCenterY,
  isWaterBiome,
  mapHeight,
  wrapWidth,
  type World,
} from '../sim';
import { createIconLayers, drawBiomeIcon } from './hexIcons';
import { CHUNK_H, CHUNK_HEXES, CHUNK_W, HEX_PX } from './mapGeometry';
import { fillPaint, strokePaint } from './paints';
import { BIOME_COLORS, DEPOSIT_COLORS, RIVER_COLOR, START_COLOR } from './palette';

/** Largest overview image side; stays within the texture limit of every phone. */
const MAX_OVERVIEW_PX = 4096;
/** Overview resolution in pixels per hex size; about the on-screen size where tiles take over. */
const OVERVIEW_PX_PER_HEX = 18;

/**
 * Pre-rendered map layers, built once per world.
 *
 * - `overview`: the whole map (colors, rivers, deposits) as one image. Drawing
 *   a scaled image is almost free, so zoomed-out views and fast gestures stay
 *   smooth on any map size.
 * - `chunks`: vector tiles of CHUNK_HEXES² hexes with outlines and icons, used
 *   when zoomed in. Only tiles near the screen are drawn, so the cost depends
 *   on the screen, not on the map size.
 */
export type WorldLayers = {
  overview: SkImage;
  /** Region of picture space the overview image covers. */
  overviewRect: { x: number; y: number; width: number; height: number };
  /** Index = chunkRow * chunkCols + chunkCol. */
  chunks: { fills: SkPicture; icons: SkPicture }[];
  chunkCols: number;
  chunkRows: number;
  /** Size of one map copy in picture pixels (the map repeats horizontally). */
  width: number;
  height: number;
};

export function buildWorldLayers(world: World): WorldLayers {
  const width = wrapWidth(world) * HEX_PX;
  const height = mapHeight(world) * HEX_PX;
  const all = cellsInRange(world, 0, world.width, 0, world.height);

  // The overview reaches one hex beyond the wrap width, so neighboring map
  // copies overlap and the seam stays closed.
  const overviewRect = { x: -HEX_PX, y: -HEX_PX, width: width + 2 * HEX_PX, height: height + 2 * HEX_PX };
  const k = Math.min(OVERVIEW_PX_PER_HEX / HEX_PX, MAX_OVERVIEW_PX / Math.max(overviewRect.width, overviewRect.height));
  const size = { width: Math.ceil(overviewRect.width * k), height: Math.ceil(overviewRect.height * k) };
  const overviewPicture = createPicture((canvas) => {
    canvas.scale(k, k);
    canvas.translate(-overviewRect.x, -overviewRect.y);
    drawFills(canvas, world, all);
    drawFeatures(canvas, world, all);
  }, size);
  const image = drawAsImageFromPicture(overviewPicture, size);
  if (!image) throw new Error('Could not render the map overview.');
  // A plain (non-GPU) copy can be drawn by any Skia canvas.
  const overview = image.makeNonTextureImage() ?? image;

  const chunkCols = Math.ceil(world.width / CHUNK_HEXES);
  const chunkRows = Math.ceil(world.height / CHUNK_HEXES);
  const chunks: WorldLayers['chunks'] = [];
  for (let cy = 0; cy < chunkRows; cy++) {
    for (let cx = 0; cx < chunkCols; cx++) {
      const cells = cellsInRange(
        world,
        cx * CHUNK_HEXES,
        Math.min(world.width, (cx + 1) * CHUNK_HEXES),
        cy * CHUNK_HEXES,
        Math.min(world.height, (cy + 1) * CHUNK_HEXES),
      );
      const bounds = Skia.XYWHRect(
        cx * CHUNK_W - 2 * HEX_PX,
        cy * CHUNK_H - 2 * HEX_PX,
        CHUNK_W + 4 * HEX_PX,
        CHUNK_H + 4 * HEX_PX,
      );
      chunks.push({
        fills: createPicture((canvas) => {
          drawFills(canvas, world, cells);
          drawFeatures(canvas, world, cells);
        }, bounds),
        icons: createPicture((canvas) => drawIcons(canvas, world, cells), bounds),
      });
    }
  }

  return { overview, overviewRect, chunks, chunkCols, chunkRows, width, height };
}

function cellsInRange(world: World, col0: number, col1: number, row0: number, row1: number): Int32Array {
  const cells = new Int32Array((col1 - col0) * (row1 - row0));
  let i = 0;
  for (let row = row0; row < row1; row++) {
    for (let col = col0; col < col1; col++) cells[i++] = row * world.width + col;
  }
  return cells;
}

function forEachCenter(world: World, cells: Int32Array, fn: (cell: number, x: number, y: number) => void) {
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const col = c % world.width;
    const row = (c - col) / world.width;
    fn(c, hexCenterX(col) * HEX_PX, hexCenterY(col, row) * HEX_PX);
  }
}

function addHex(path: SkPathBuilder, x: number, y: number, r: number) {
  const h = (Math.sqrt(3) / 2) * r;
  path.moveTo(x + r, y);
  path.lineTo(x + r / 2, y + h);
  path.lineTo(x - r / 2, y + h);
  path.lineTo(x - r, y);
  path.lineTo(x - r / 2, y - h);
  path.lineTo(x + r / 2, y - h);
  path.close();
}

/** Lighter lowlands, darker highlands and deeper water, in a few steps so fills batch well. */
function shadeStep(elevation: number): number {
  return elevation >= 0 ? Math.min(3, Math.floor(elevation * 4)) : Math.min(3, Math.floor(-elevation * 4));
}

function shadeColor(color: string, elevation: number, step: number): string {
  const v = parseInt(color.slice(1), 16);
  const f = elevation >= 0 ? 1.08 - step * 0.09 : 1 - step * 0.08;
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((v >> shift) & 255) * f)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Hex fills, batched by color. Slightly oversized to hide anti-aliasing seams. */
function drawFills(canvas: SkCanvas, world: World, cells: Int32Array) {
  const fills = new Map<string, SkPathBuilder>();
  forEachCenter(world, cells, (c, x, y) => {
    const e = world.elevation[c];
    const color = shadeColor(BIOME_COLORS[world.biome[c]], e, shadeStep(e));
    let path = fills.get(color);
    if (!path) {
      path = Skia.PathBuilder.Make();
      fills.set(color, path);
    }
    addHex(path, x, y, HEX_PX + 0.5);
  });
  for (const [color, path] of fills) canvas.drawPath(path.detach(), fillPaint(color));
}

/** Rivers, deposits and the start marker. */
function drawFeatures(canvas: SkCanvas, world: World, cells: Int32Array) {
  // Rivers: a line from each river hex towards the next hex downstream,
  // in three widths by water volume.
  const rivers = [Skia.PathBuilder.Make(), Skia.PathBuilder.Make(), Skia.PathBuilder.Make()];
  forEachCenter(world, cells, (c, x, y) => {
    const flow = world.riverFlow[c];
    const dir = world.riverDir[c];
    if (flow <= 0 || dir < 0) return;
    const next = world.neighbors[c * 6 + dir];
    // Stop at the shore instead of running into the sea or lake.
    const reach = next >= 0 && isWaterBiome(world.biome[next]) ? 0.55 : 1;
    const [dx, dy] = DIRECTION_OFFSETS[dir];
    const size = flow < 2 ? 0 : flow < 5 ? 1 : 2;
    rivers[size].moveTo(x, y);
    rivers[size].lineTo(x + dx * HEX_PX * reach, y + dy * HEX_PX * reach);
  });
  rivers.forEach((path, size) => {
    canvas.drawPath(path.detach(), strokePaint(RIVER_COLOR, HEX_PX * (0.12 + size * 0.07)));
  });

  // Deposits: small colored dots with a dark rim, by category.
  const rim = Skia.PathBuilder.Make();
  const dots = new Map<string, SkPathBuilder>();
  forEachCenter(world, cells, (c, x, y) => {
    const id = world.deposit[c];
    if (!id) return;
    const color = DEPOSIT_COLORS[DEPOSITS[id].category];
    let path = dots.get(color);
    if (!path) {
      path = Skia.PathBuilder.Make();
      dots.set(color, path);
    }
    const dx = x + HEX_PX * 0.45;
    const dy = y + HEX_PX * 0.45;
    rim.addCircle(dx, dy, HEX_PX * 0.2);
    path.addCircle(dx, dy, HEX_PX * 0.14);
  });
  canvas.drawPath(rim.detach(), fillPaint('#1b1b1b'));
  for (const [color, path] of dots) canvas.drawPath(path.detach(), fillPaint(color));

  // Start marker: a ring with a small hut.
  forEachCenter(world, cells, (c, x, y) => {
    if (c !== world.startCell) return;
    const ring = Skia.PathBuilder.Make();
    ring.addCircle(x, y, HEX_PX * 0.72);
    canvas.drawPath(ring.detach(), strokePaint(START_COLOR, HEX_PX * 0.12));
    const s = HEX_PX * 0.3;
    const hut = Skia.PathBuilder.Make()
      .moveTo(x - s, y + s * 0.8)
      .lineTo(x - s, y)
      .lineTo(x, y - s)
      .lineTo(x + s, y)
      .lineTo(x + s, y + s * 0.8)
      .close();
    canvas.drawPath(hut.detach(), fillPaint(START_COLOR));
  });
}

/** Hex outlines and biome icons. */
function drawIcons(canvas: SkCanvas, world: World, cells: Int32Array) {
  const outlines = Skia.PathBuilder.Make();
  const layers = createIconLayers(HEX_PX);
  forEachCenter(world, cells, (c, x, y) => {
    addHex(outlines, x, y, HEX_PX);
    if (world.biome[c] !== Biome.Lake) drawBiomeIcon(layers, world, c, x, y, HEX_PX);
  });
  canvas.drawPath(outlines.detach(), strokePaint('rgba(0,0,0,0.12)', 1));
  for (const layer of layers.values()) canvas.drawPath(layer.path.detach(), layer.paint);
}

import {
  ClipOp,
  Skia,
  createPicture,
  drawAsImageFromPicture,
  type SkCanvas,
  type SkImage,
  type SkPathBuilder,
  type SkSurface,
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
import { CHUNK_H, CHUNK_W, HEX_PX } from './mapGeometry';
import { BuilderSet, keptBuilder, sharedFillPaint, sharedStrokePaint } from './paints';
import { BIOME_COLORS, DEPOSIT_COLORS, RIVER_COLOR, START_COLOR } from './palette';

/** Largest overview image side; stays within the texture limit of every phone. */
const MAX_OVERVIEW_PX = 4096;
/**
 * Extra picture pixels rendered around each detail tile. Neighbors overlap by
 * this much, so no seam shows where scaled tile images meet.
 */
export const TILE_BLEED = 2;
/** Overview resolution in pixels per hex size; about the on-screen size where tiles take over. */
const OVERVIEW_PX_PER_HEX = 18;

/**
 * Pre-rendered map layers, built once per world.
 *
 * - `overview`: the whole map (colors, rivers, deposits) as one image. Drawing
 *   a scaled image is almost free, so zoomed-out views and fast gestures stay
 *   smooth on any map size.
 * - Detail tiles of CHUNK_W x CHUNK_H with outlines and icons, used when
 *   zoomed in. They are rendered on demand by renderTile (see tileImages.ts),
 *   only near the screen, so the cost depends on the screen, not the map size.
 */
export type WorldLayers = {
  overview: SkImage;
  /** Region of picture space the overview image covers. */
  overviewRect: { x: number; y: number; width: number; height: number };
  /** Detail tiles per map copy; tile index = row * chunkCols + col. */
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

  const chunkCols = Math.ceil(width / CHUNK_W);
  const chunkRows = Math.ceil(height / CHUNK_H);
  return { overview, overviewRect, chunkCols, chunkRows, width, height };
}

/**
 * Renders one detail tile (colors, rivers, deposits, outlines and icons) into
 * a CPU image at `pxPerUnit` pixels per picture pixel. CPU images can be drawn
 * by the UI thread's canvas; rendering runs on the JS thread, off the frame.
 * Hexes of neighboring tiles and map copies are drawn too and clipped; the
 * image covers the tile plus TILE_BLEED on each side.
 */
export function renderTile(world: World, chunk: number, chunkCols: number, pxPerUnit: number): SkImage | null {
  return renderTileWith(world, chunk, chunkCols, pxPerUnit, [
    (canvas, cells) => drawFills(canvas, world, cells),
    (canvas, cells) => drawFeatures(canvas, world, cells),
    // Icons after all fills, so no hex covers the icons of its neighbor.
    (canvas, cells) => drawIcons(canvas, world, cells),
  ]);
}

/**
 * Hexes a tile has to draw, by map copy: those reaching into the tile plus
 * TILE_BLEED (rivers reach up to one hex beyond their own). Columns outside
 * the map belong to the neighboring map copies.
 */
export function tileCells(world: World, chunk: number, chunkCols: number): { offsetX: number; cells: Int32Array }[] {
  const col = chunk % chunkCols;
  const row = (chunk - col) / chunkCols;
  const x = col * CHUNK_W - TILE_BLEED;
  const y = row * CHUNK_H - TILE_BLEED;
  const unitX = 1.5 * HEX_PX;
  const unitY = Math.sqrt(3) * HEX_PX;
  const c0 = Math.floor(x / unitX) - 2;
  const c1 = Math.ceil((x + CHUNK_W + 2 * TILE_BLEED) / unitX) + 2;
  const r0 = Math.max(0, Math.floor(y / unitY) - 2);
  const r1 = Math.min(world.height - 1, Math.ceil((y + CHUNK_H + 2 * TILE_BLEED) / unitY) + 2);
  const segments: { offsetX: number; cells: Int32Array }[] = [];
  const copyWidth = wrapWidth(world) * HEX_PX;
  for (let copy = Math.floor(c0 / world.width); copy <= Math.floor(c1 / world.width); copy++) {
    const lo = Math.max(c0, copy * world.width) - copy * world.width;
    const hi = Math.min(c1 + 1, (copy + 1) * world.width) - copy * world.width;
    if (lo < hi && r0 <= r1) segments.push({ offsetX: copy * copyWidth, cells: cellsInRange(world, lo, hi, r0, r1 + 1) });
  }
  return segments;
}

/**
 * Renders a tile into a CPU image by running each pass over the tile's hexes
 * (all segments of a pass before the next pass), clipped to the tile plus
 * TILE_BLEED.
 */
export function renderTileWith(
  world: World,
  chunk: number,
  chunkCols: number,
  pxPerUnit: number,
  passes: ((canvas: SkCanvas, cells: Int32Array) => void)[],
): SkImage | null {
  const col = chunk % chunkCols;
  const row = (chunk - col) / chunkCols;
  const x = col * CHUNK_W - TILE_BLEED;
  const y = row * CHUNK_H - TILE_BLEED;
  const tileW = CHUNK_W + 2 * TILE_BLEED;
  const tileH = CHUNK_H + 2 * TILE_BLEED;
  const w = Math.ceil(tileW * pxPerUnit);
  const h = Math.ceil(tileH * pxPerUnit);
  const surface = tileSurface(w, h);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.save();
  canvas.clear(TRANSPARENT());
  canvas.scale(w / tileW, h / tileH);
  canvas.translate(-x, -y);
  canvas.clipRect(Skia.XYWHRect(x, y, tileW, tileH), ClipOp.Intersect, true);
  const segments = tileCells(world, chunk, chunkCols);
  for (const pass of passes) {
    for (const seg of segments) {
      canvas.save();
      canvas.translate(seg.offsetX, 0);
      pass(canvas, seg.cells);
      canvas.restore();
    }
  }

  canvas.restore();
  surface.flush();
  // The image takes the surface's pixels; the surface gets new ones when it is drawn into next (copy on write).
  // It goes into the JS object of a 1-pixel image: the object then tells the
  // garbage collector about 1 pixel instead of the whole tile. Tile images are
  // freed explicitly (TileImages disposes every one it drops), so the collector
  // needn't run for their memory, and doesn't set off collections while tiles
  // render during a swipe.
  return surface.makeImageSnapshot(undefined, smallImage());
}

/** A new 1-pixel image (a JS object with a small memory hint for the garbage collector). */
function smallImage(): SkImage {
  pixelSurface ??= Skia.Surface.Make(1, 1);
  return pixelSurface!.makeImageSnapshot();
}
let pixelSurface: SkSurface | null = null;

/**
 * One surface per tile size, kept for every tile of that size: a new surface
 * per tile would count its pixels as new memory for the JS garbage collector
 * each time (and set off collections while tiles render during a swipe).
 */
const surfaces = new Map<number, SkSurface>();
function tileSurface(w: number, h: number): SkSurface | null {
  const key = w * 100003 + h;
  let surface = surfaces.get(key);
  if (!surface) {
    surface = Skia.Surface.Make(w, h) ?? undefined;
    if (!surface) return null;
    surfaces.set(key, surface);
  }
  return surface;
}
let transparent: Float32Array | null = null;
const TRANSPARENT = () => (transparent ??= Skia.Color('transparent'));

export function cellsInRange(world: World, col0: number, col1: number, row0: number, row1: number): Int32Array {
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

/** shadeColor's results by biome color, lowland or water, and step: the same few strings for every tile. */
const shades = new Map<string, string>();
function shadeOf(color: string, elevation: number, step: number): string {
  const key = `${color}${elevation >= 0 ? '+' : '-'}${step}`;
  let shade = shades.get(key);
  if (shade === undefined) {
    shade = shadeColor(color, elevation, step);
    shades.set(key, shade);
  }
  return shade;
}

function shadeColor(color: string, elevation: number, step: number): string {
  const v = parseInt(color.slice(1), 16);
  const f = elevation >= 0 ? 1.08 - step * 0.09 : 1 - step * 0.08;
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((v >> shift) & 255) * f)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Hex fills, batched by color. Slightly oversized to hide anti-aliasing seams. */
const fills = new BuilderSet<string>();
function drawFills(canvas: SkCanvas, world: World, cells: Int32Array) {
  forEachCenter(world, cells, (c, x, y) => {
    const e = world.elevation[c];
    addHex(fills.get(shadeOf(BIOME_COLORS[world.biome[c]], e, shadeStep(e))), x, y, HEX_PX + 0.5);
  });
  fills.drawAll((color, path) => canvas.drawPath(path.detach(), sharedFillPaint(color)));
}

// Path builders kept between tiles (see BuilderSet).
const riverPaths = [keptBuilder(), keptBuilder(), keptBuilder()];
const rimPath = keptBuilder();
const dotPaths = new BuilderSet<string>();
const outlinePath = keptBuilder();

/** Rivers, deposits and the start marker. */
function drawFeatures(canvas: SkCanvas, world: World, cells: Int32Array) {
  // Rivers: a line from each river hex towards the next hex downstream,
  // in three widths by water volume.
  const rivers = [riverPaths[0](), riverPaths[1](), riverPaths[2]()];
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
    canvas.drawPath(path.detach(), sharedStrokePaint(RIVER_COLOR, HEX_PX * (0.12 + size * 0.07)));
  });

  // Deposits: small colored dots with a dark rim, by category.
  const rim = rimPath();
  forEachCenter(world, cells, (c, x, y) => {
    const id = world.deposit[c];
    if (!id) return;
    const path = dotPaths.get(DEPOSIT_COLORS[DEPOSITS[id].category]);
    const dx = x + HEX_PX * 0.45;
    const dy = y + HEX_PX * 0.45;
    rim.addCircle(dx, dy, HEX_PX * 0.2);
    path.addCircle(dx, dy, HEX_PX * 0.14);
  });
  canvas.drawPath(rim.detach(), sharedFillPaint('#1b1b1b'));
  dotPaths.drawAll((color, path) => canvas.drawPath(path.detach(), sharedFillPaint(color)));

  // Start marker: a ring with a small hut.
  forEachCenter(world, cells, (c, x, y) => {
    if (c !== world.startCell) return;
    const ring = Skia.PathBuilder.Make();
    ring.addCircle(x, y, HEX_PX * 0.72);
    canvas.drawPath(ring.detach(), sharedStrokePaint(START_COLOR, HEX_PX * 0.12));
    const s = HEX_PX * 0.3;
    const hut = Skia.PathBuilder.Make()
      .moveTo(x - s, y + s * 0.8)
      .lineTo(x - s, y)
      .lineTo(x, y - s)
      .lineTo(x + s, y)
      .lineTo(x + s, y + s * 0.8)
      .close();
    canvas.drawPath(hut.detach(), sharedFillPaint(START_COLOR));
  });
}

/** The icon layers, kept between tiles: drawIcons empties every one of them. */
let icons: ReturnType<typeof createIconLayers> | null = null;
const iconLayers = () => (icons ??= createIconLayers(HEX_PX));

/** Hex outlines and biome icons. */
function drawIcons(canvas: SkCanvas, world: World, cells: Int32Array) {
  const outlines = outlinePath();
  const layers = iconLayers();
  forEachCenter(world, cells, (c, x, y) => {
    addHex(outlines, x, y, HEX_PX);
    if (world.biome[c] !== Biome.Lake) drawBiomeIcon(layers, world, c, x, y, HEX_PX);
  });
  canvas.drawPath(outlines.detach(), sharedStrokePaint('rgba(0,0,0,0.12)', 1));
  for (const layer of layers.values()) canvas.drawPath(layer.path.detach(), layer.paint);
}

import { Skia, createPicture, type SkCanvas, type SkPathBuilder, type SkPicture } from '@shopify/react-native-skia';
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
import { fillPaint, strokePaint } from './paints';
import { BIOME_COLORS, DEPOSIT_COLORS, RIVER_COLOR, START_COLOR } from './palette';

/** Hex size (center to corner) in picture pixels. The map view scales from there. */
export const HEX_PX = 24;

/**
 * Pre-rendered map layers. Each is recorded once per world and then only
 * replayed with a transform while panning and zooming, which keeps gestures
 * smooth. Draw calls are batched per color: a few dozen paths for the whole
 * map instead of one call per hex.
 */
export type WorldPictures = {
  /** Biome fills, elevation shading, rivers, deposits, start marker. */
  base: SkPicture;
  /** Hex outlines and biome icons; faded out when zoomed far out. */
  detail: SkPicture;
  /** Size of one map copy in picture pixels (the map repeats horizontally). */
  width: number;
  height: number;
};

export function buildWorldPictures(world: World): WorldPictures {
  const width = wrapWidth(world) * HEX_PX;
  const height = mapHeight(world) * HEX_PX;
  // Hexes and icons stick out a little beyond the wrap width and the poles.
  const bounds = Skia.XYWHRect(-HEX_PX * 2, -HEX_PX, width + HEX_PX * 4, height + HEX_PX * 2);

  const base = createPicture((canvas) => drawBase(canvas, world), bounds);
  const detail = createPicture((canvas) => drawDetail(canvas, world), bounds);
  return { base, detail, width, height };
}

/**
 * Calls `fn` with the pixel center of every cell. The map view draws copies of
 * the pictures side by side, which closes the wrap seam.
 */
function forEachCellCenter(world: World, fn: (cell: number, x: number, y: number) => void) {
  for (let c = 0; c < world.cellCount; c++) {
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

function drawBase(canvas: SkCanvas, world: World) {
  // Hex fills, batched by color. Slightly oversized to hide anti-aliasing seams.
  const fills = new Map<string, SkPathBuilder>();
  forEachCellCenter(world, (c, x, y) => {
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

  // Rivers: a line from each river hex towards the next hex downstream,
  // in three widths by water volume.
  const rivers = [Skia.PathBuilder.Make(), Skia.PathBuilder.Make(), Skia.PathBuilder.Make()];
  forEachCellCenter(world, (c, x, y) => {
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
  forEachCellCenter(world, (c, x, y) => {
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
  if (world.startCell >= 0) {
    forEachCellCenter(world, (c, x, y) => {
      if (c !== world.startCell) return;
      const ring = Skia.PathBuilder.Make();
      ring.addCircle(x, y, HEX_PX * 0.72);
      canvas.drawPath(ring.detach(), strokePaint(START_COLOR, HEX_PX * 0.12));
      const hut = Skia.PathBuilder.Make();
      const s = HEX_PX * 0.3;
      hut.moveTo(x - s, y + s * 0.8);
      hut.lineTo(x - s, y);
      hut.lineTo(x, y - s);
      hut.lineTo(x + s, y);
      hut.lineTo(x + s, y + s * 0.8);
      hut.close();
      canvas.drawPath(hut.detach(), fillPaint(START_COLOR));
    });
  }
}

function drawDetail(canvas: SkCanvas, world: World) {
  const outlines = Skia.PathBuilder.Make();
  const layers = createIconLayers(HEX_PX);
  forEachCellCenter(world, (c, x, y) => {
    addHex(outlines, x, y, HEX_PX);
    if (world.biome[c] !== Biome.Lake) drawBiomeIcon(layers, world, c, x, y, HEX_PX);
  });
  canvas.drawPath(outlines.detach(), strokePaint('rgba(0,0,0,0.12)', 1));
  for (const layer of layers.values()) canvas.drawPath(layer.path.detach(), layer.paint);
}

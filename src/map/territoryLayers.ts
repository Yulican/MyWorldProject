import {
  Skia,
  createPicture,
  drawAsImageFromPicture,
  type SkCanvas,
  type SkImage,
  type SkPathBuilder,
} from '@shopify/react-native-skia';
import { DIRECTION_COUNT, DIRECTION_OFFSETS, hexCenterX, hexCenterY, type World } from '../sim';
import { HEX_PX } from './mapGeometry';
import { fillPaint, strokePaint } from './paints';
import { cellsInRange, renderTileWith, tileCells, type WorldLayers } from './worldPicture';

/**
 * Territory overview resolution in pixels per hex size. Lower than the
 * terrain overview: it is rebuilt with every snapshot, and borders and dots
 * stay readable when zoomed out.
 */
const OVERVIEW_PX_PER_HEX = 12;

/** Corner pair (unit offsets) of the hex edge facing each direction. */
const EDGE_CORNERS = DIRECTION_OFFSETS.map(([dx, dy]) => {
  const angle = Math.atan2(dy, dx);
  const a = angle - Math.PI / 6;
  const b = angle + Math.PI / 6;
  return [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)] as const;
});

/**
 * Detail tiles of territories are rendered at this share of the terrain
 * tiles' resolution: tints, borders and dots stay crisp enough, and they are
 * rendered again with every snapshot.
 */
export const TERRITORY_TILE_RESOLUTION = 0.5;

/**
 * Who lives where, drawn like the terrain: one image for zoomed-out views
 * (built here, from the current society snapshot), transparent tile images
 * near the screen when zoomed in (renderTerritoryTile, see tileImages.ts).
 */
export type TerritoryOverview = {
  overview: SkImage;
  /** Region of picture space the overview image covers (same as the terrain overview). */
  overviewRect: WorldLayers['overviewRect'];
};

export function buildTerritoryOverview(
  world: World,
  colorOf: (civ: number) => string,
  terrain: WorldLayers,
): TerritoryOverview {
  const rect = terrain.overviewRect;
  const k = OVERVIEW_PX_PER_HEX / HEX_PX;
  const size = { width: Math.ceil(rect.width * k), height: Math.ceil(rect.height * k) };
  const all = cellsInRange(world, 0, world.width, 0, world.height);
  const picture = createPicture((canvas) => {
    canvas.scale(k, k);
    canvas.translate(-rect.x, -rect.y);
    drawTerritory(canvas, world, all, colorOf);
  }, size);
  const image = drawAsImageFromPicture(picture, size);
  if (!image) throw new Error('Could not render the territory overview.');
  return { overview: image.makeNonTextureImage() ?? image, overviewRect: rect };
}

/** One territory detail tile as a transparent image; null where nobody lives. */
export function renderTerritoryTile(
  world: World,
  chunk: number,
  chunkCols: number,
  pxPerUnit: number,
  colorOf: (civ: number) => string,
): SkImage | null {
  const settled = tileCells(world, chunk, chunkCols).some(({ cells }) => cells.some((c) => world.owner[c] !== 0));
  if (!settled) return null;
  return renderTileWith(world, chunk, chunkCols, pxPerUnit, [(canvas, cells) => drawTerritory(canvas, world, cells, colorOf)]);
}

/** A tint and a border per civilization and a dot per settlement, sized by population. */
function drawTerritory(canvas: SkCanvas, world: World, cells: Int32Array, colorOf: (civ: number) => string) {
  const tints = new Map<number, SkPathBuilder>();
  const borders = new Map<number, SkPathBuilder>();
  const dots = new Map<number, SkPathBuilder>();
  const rim = Skia.PathBuilder.Make();
  const pathFor = (paths: Map<number, SkPathBuilder>, civ: number) => {
    let path = paths.get(civ);
    if (!path) {
      path = Skia.PathBuilder.Make();
      paths.set(civ, path);
    }
    return path;
  };

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const owner = world.owner[c];
    if (!owner) continue;
    const col = c % world.width;
    const row = (c - col) / world.width;
    const x = hexCenterX(col) * HEX_PX;
    const y = hexCenterY(col, row) * HEX_PX;

    addHex(pathFor(tints, owner), x, y, HEX_PX + 0.5);

    // Border on every edge towards a hex that isn't ours, slightly inset so
    // two neighboring civilizations both show their line.
    const r = HEX_PX * 0.88;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      const nb = world.neighbors[c * DIRECTION_COUNT + d];
      if (nb >= 0 && world.owner[nb] === owner) continue;
      const [ax, ay, bx, by] = EDGE_CORNERS[d];
      const border = pathFor(borders, owner);
      border.moveTo(x + ax * r, y + ay * r);
      border.lineTo(x + bx * r, y + by * r);
    }

    const people = world.population[c];
    const radius = HEX_PX * (people < 10 ? 0.14 : people < 25 ? 0.21 : 0.28);
    rim.addCircle(x, y, radius + HEX_PX * 0.06);
    pathFor(dots, owner).addCircle(x, y, radius);
  }

  for (const [civ, path] of tints) canvas.drawPath(path.detach(), fillPaint(withAlpha(colorOf(civ), 0.28)));
  for (const [civ, path] of borders) canvas.drawPath(path.detach(), strokePaint(colorOf(civ), HEX_PX * 0.12));
  canvas.drawPath(rim.detach(), fillPaint('#1b1b1b'));
  for (const [civ, path] of dots) canvas.drawPath(path.detach(), fillPaint(colorOf(civ)));
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

function withAlpha(hex: string, alpha: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}

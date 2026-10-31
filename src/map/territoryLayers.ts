import {
  Skia,
  createPicture,
  drawAsImageFromPicture,
  type SkCanvas,
  type SkImage,
  type SkPathBuilder,
} from '@shopify/react-native-skia';
import { DIRECTION_COUNT, DIRECTION_OFFSETS, hexCenterX, hexCenterY, isWaterBiome, type World } from '../sim';
import { HEX_PX } from './mapGeometry';
import { fillPaint, strokePaint } from './paints';
import { cellsInRange, renderTileWith, tileCells, type WorldLayers } from './worldPicture';

/**
 * Territory overview resolution in pixels per hex size. Lower than the
 * terrain overview: it is rebuilt with every snapshot, and borders and dots
 * stay readable when zoomed out.
 */
const OVERVIEW_PX_PER_HEX = 12;
const ROAD_COLOR = 'rgba(92,65,40,0.9)';
/** Settlement dot radius in hex sizes, by dotSize class. */
const DOT_RADIUS = [0.14, 0.21, 0.28];

const RUIN_COLOR = '#9a9284';
const OUTLINE_COLOR = '#1b1b1b';
const ANCHOR_COLOR = '#1f3b63';

/** Settlement dots come in three sizes by population. */
function dotSize(people: number): number {
  return people < 10 ? 0 : people < 25 ? 1 : 2;
}

/**
 * A settlement's icon by its standing buildings: 0 = tribe (a dot),
 * 1 = small city (1–2 buildings), 2 = big city (3–4).
 */
function cityLevel(buildings: number): number {
  return buildings === 0 ? 0 : buildings <= 2 ? 1 : 2;
}

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

/**
 * A fingerprint of everything a territory tile shows (owners and their
 * colors, dot sizes, city icons, ruins, roads). Equal fingerprints draw the same image, so a new
 * society snapshot only re-renders tiles that actually look different.
 */
export function territoryTileSignature(
  world: World,
  chunk: number,
  chunkCols: number,
  colorOf: (civ: number) => string,
): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h = Math.imul(h ^ v, 0x01000193);
  };
  for (const { cells } of tileCells(world, chunk, chunkCols)) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const owner = world.owner[c];
      mix(world.roads[c]);
      mix(owner);
      if (!owner) {
        mix(world.ruins[c] > 0 ? 1 : 0);
        continue;
      }
      mix(dotSize(world.population[c]));
      mix(cityLevel(world.buildings[c]));
      mix(world.harbors[c]);
      const color = colorOf(owner);
      for (let k = 1; k < color.length; k++) mix(color.charCodeAt(k));
    }
  }
  return h >>> 0;
}

/** One territory detail tile as a transparent image; null where nobody lives. */
export function renderTerritoryTile(
  world: World,
  chunk: number,
  chunkCols: number,
  pxPerUnit: number,
  colorOf: (civ: number) => string,
): SkImage | null {
  const settled = tileCells(world, chunk, chunkCols).some(({ cells }) =>
    cells.some((c) => world.owner[c] !== 0 || world.roads[c] !== 0 || world.ruins[c] !== 0),
  );
  if (!settled) return null;
  return renderTileWith(world, chunk, chunkCols, pxPerUnit, [(canvas, cells) => drawTerritory(canvas, world, cells, colorOf)]);
}

/**
 * A tint and a border per civilization, roads, a dot per tribe sized by
 * population, a city icon per settlement with buildings, and a ruin icon on
 * free hexes with ruins. Each hex draws its half of a road (center to edge),
 * so roads join across tiles and the map wrap.
 */
function drawTerritory(canvas: SkCanvas, world: World, cells: Int32Array, colorOf: (civ: number) => string) {
  const tints = new Map<number, SkPathBuilder>();
  const borders = new Map<number, SkPathBuilder>();
  const dots = new Map<number, SkPathBuilder>();
  const rim = Skia.PathBuilder.Make();
  const roads = Skia.PathBuilder.Make();
  const outlines = Skia.PathBuilder.Make();
  const ruins = Skia.PathBuilder.Make();
  const anchors = Skia.PathBuilder.Make();
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
    const roadBits = world.roads[c];
    if (!owner && !roadBits && !world.ruins[c]) continue;
    const col = c % world.width;
    const row = (c - col) / world.width;
    const x = hexCenterX(col) * HEX_PX;
    const y = hexCenterY(col, row) * HEX_PX;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      if (!(roadBits & (1 << d))) continue;
      const [dx, dy] = DIRECTION_OFFSETS[d];
      roads.moveTo(x, y);
      roads.lineTo(x + dx * HEX_PX * 0.5, y + dy * HEX_PX * 0.5);
    }
    if (!owner) {
      if (world.ruins[c]) {
        addRuin(ruins, x, y);
        addRuin(outlines, x, y);
      }
      continue;
    }

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

    if (world.harbors[c]) addAnchor(anchors, world, c, x, y);
    const level = cityLevel(world.buildings[c]);
    if (level > 0) {
      addCity(pathFor(dots, owner), x, y, level);
      addCity(outlines, x, y, level);
      continue;
    }
    const radius = HEX_PX * DOT_RADIUS[dotSize(world.population[c])];
    rim.addCircle(x, y, radius + HEX_PX * 0.06);
    pathFor(dots, owner).addCircle(x, y, radius);
  }

  for (const [civ, path] of tints) canvas.drawPath(path.detach(), fillPaint(withAlpha(colorOf(civ), 0.28)));
  canvas.drawPath(roads.detach(), strokePaint(ROAD_COLOR, HEX_PX * 0.1));
  for (const [civ, path] of borders) canvas.drawPath(path.detach(), strokePaint(colorOf(civ), HEX_PX * 0.12));
  canvas.drawPath(rim.detach(), fillPaint('#1b1b1b'));
  canvas.drawPath(ruins.detach(), fillPaint(RUIN_COLOR));
  for (const [civ, path] of dots) canvas.drawPath(path.detach(), fillPaint(colorOf(civ)));
  canvas.drawPath(outlines.detach(), strokePaint(OUTLINE_COLOR, HEX_PX * 0.05));
  canvas.drawPath(anchors.detach(), strokePaint(ANCHOR_COLOR, HEX_PX * 0.07));
}

/** A harbor's anchor, towards the first water next to the hex. */
function addAnchor(path: SkPathBuilder, world: World, cell: number, x: number, y: number) {
  let dx = 0.45;
  let dy = 0.45;
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const nb = world.neighbors[cell * DIRECTION_COUNT + d];
    if (nb >= 0 && isWaterBiome(world.biome[nb])) {
      [dx, dy] = DIRECTION_OFFSETS[d];
      dx *= 0.55;
      dy *= 0.55;
      break;
    }
  }
  const u = HEX_PX * 0.16;
  const ax = x + dx * HEX_PX;
  const ay = y + dy * HEX_PX;
  path.addCircle(ax, ay - u * 1.1, u * 0.3);
  path.moveTo(ax, ay - u * 0.8);
  path.lineTo(ax, ay + u);
  path.moveTo(ax - u * 0.6, ay - u * 0.3);
  path.lineTo(ax + u * 0.6, ay - u * 0.3);
  path.moveTo(ax - u, ay + u * 0.2);
  path.quadTo(ax - u * 0.8, ay + u * 1.1, ax, ay + u);
  path.quadTo(ax + u * 0.8, ay + u * 1.1, ax + u, ay + u * 0.2);
}

/** Houses in the hex: two for a small city, three and a tower for a big one. */
function addCity(path: SkPathBuilder, x: number, y: number, level: number) {
  const u = HEX_PX * (level === 1 ? 0.22 : 0.18);
  if (level === 1) {
    addHouse(path, x - u * 1.1, y + u * 0.3, u);
    addHouse(path, x + u * 1.1, y - u * 0.1, u);
    return;
  }
  const t = u * 0.6;
  path.moveTo(x - t, y + u * 0.3);
  path.lineTo(x + t, y + u * 0.3);
  path.lineTo(x + t, y - u * 1.8);
  path.lineTo(x, y - u * 2.5);
  path.lineTo(x - t, y - u * 1.8);
  path.close();
  addHouse(path, x - u * 1.8, y - u * 0.1, u);
  addHouse(path, x + u * 1.8, y - u * 0.1, u);
  addHouse(path, x, y + u * 1.5, u);
}

/** A house of half-width `u` standing on (x, y + 0.7 u). */
function addHouse(path: SkPathBuilder, x: number, y: number, u: number) {
  path.moveTo(x - u, y + u * 0.7);
  path.lineTo(x + u, y + u * 0.7);
  path.lineTo(x + u, y - u * 0.3);
  path.lineTo(x, y - u * 1.2);
  path.lineTo(x - u, y - u * 0.3);
  path.close();
}

/** Broken walls: two pillars of different height and a fallen block. */
function addRuin(path: SkPathBuilder, x: number, y: number) {
  const u = HEX_PX * 0.16;
  path.addRect(Skia.XYWHRect(x - u * 2, y - u * 1.6, u * 0.9, u * 2.6));
  path.addRect(Skia.XYWHRect(x + u * 0.8, y - u * 0.6, u * 0.9, u * 1.6));
  path.addRect(Skia.XYWHRect(x - u * 0.7, y + u * 0.6, u * 1.2, u * 0.5));
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

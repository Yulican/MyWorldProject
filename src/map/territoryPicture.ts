import { Skia, createPicture, type SkPathBuilder, type SkPicture } from '@shopify/react-native-skia';
import { DIRECTION_COUNT, DIRECTION_OFFSETS, hexCenterX, hexCenterY, mapHeight, wrapWidth, type World } from '../sim';
import { fillPaint, strokePaint } from './paints';
import { HEX_PX } from './worldPicture';

/** Corner pair (unit offsets) of the hex edge facing each direction. */
const EDGE_CORNERS = DIRECTION_OFFSETS.map(([dx, dy]) => {
  const angle = Math.atan2(dy, dx);
  const a = angle - Math.PI / 6;
  const b = angle + Math.PI / 6;
  return [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)] as const;
});

/**
 * Who lives where: a tint and a border per civilization and a dot per
 * settlement, sized by population. Rebuilt from the world's society snapshot
 * whenever it changes (a few times per second at most).
 */
export function buildTerritoryPicture(world: World, colorOf: (civ: number) => string): SkPicture {
  const width = wrapWidth(world) * HEX_PX;
  const height = mapHeight(world) * HEX_PX;
  const bounds = Skia.XYWHRect(-HEX_PX * 2, -HEX_PX, width + HEX_PX * 4, height + HEX_PX * 2);

  return createPicture((canvas) => {
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

    for (let c = 0; c < world.cellCount; c++) {
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
  }, bounds);
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

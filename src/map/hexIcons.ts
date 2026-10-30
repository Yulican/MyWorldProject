import { Skia, type SkPaint, type SkPathBuilder } from '@shopify/react-native-skia';
import { Biome, type World } from '../sim';
import { fillPaint, strokePaint } from './paints';

// Simple vector icons per biome, drawn in code. All icons of the map are
// collected into a few shared paths (one per color), so the whole layer is a
// handful of draw calls. Coordinates are in units of the hex size `r`.

type Layer = { path: SkPathBuilder; paint: SkPaint };
export type IconLayers = Map<string, Layer>;

type LayerName = (typeof LAYERS)[number][0];

// Layer order = drawing order (later layers on top). Stroke widths are in units of r.
const LAYERS = [
  ['wave', '#2c5d91', 0.06],
  ['ice', '#9fb9cc', 0.06],
  ['tundra', '#76856a', 0.06],
  ['grass', '#6a9a40', 0.06],
  ['dryGrass', '#8f8a3a', 0.06],
  ['dune', '#c7ac68', 0.07],
  ['swampWater', '#6f97a8', 0.05],
  ['reed', '#2f4a2c', 0.06],
  ['hillFill', '#8f8352', 0],
  ['hillLine', '#6a5f37', 0.06],
  ['mountain', '#665d55', 0],
  ['mountainLight', '#8a8075', 0],
  ['snow', '#f4f6f8', 0],
  ['trunk', '#5b4630', 0.07],
  ['tree', '#2a5c28', 0],
  ['jungle', '#164b2b', 0],
  ['jungleLight', '#2e7a43', 0],
  ['acacia', '#646c2c', 0],
] as const;

/** Creates the empty icon layers for hexes of size `r` (width 0 = filled shape). */
export function createIconLayers(r: number): IconLayers {
  const layers: IconLayers = new Map();
  for (const [name, color, width] of LAYERS) {
    const paint = width > 0 ? strokePaint(color, width * r) : fillPaint(color);
    layers.set(name, { path: Skia.PathBuilder.Make(), paint });
  }
  return layers;
}

function layer(layers: IconLayers, name: LayerName): SkPathBuilder {
  return layers.get(name)!.path;
}

/** Deterministic pseudo-random 0..1 per cell and salt, for icon variety. */
function hash(cell: number, salt: number): number {
  let h = Math.imul(cell ^ (salt * 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function drawBiomeIcon(layers: IconLayers, world: World, cell: number, x: number, y: number, r: number) {
  const j = (salt: number) => (hash(cell, salt) - 0.5) * 0.16 * r; // small position jitter
  switch (world.biome[cell]) {
    case Biome.Forest:
      for (const [ox, oy] of [[-0.32, 0.1], [0.3, 0.14], [0, -0.22]]) {
        tree(layers, x + ox * r + j(1), y + oy * r + j(2), r);
      }
      break;
    case Biome.Jungle:
      for (const [ox, oy] of [[-0.3, 0.12], [0.3, 0.1], [0, -0.2]]) {
        const cx = x + ox * r + j(3);
        const cy = y + oy * r + j(4);
        layer(layers, 'trunk').moveTo(cx, cy + 0.12 * r).lineTo(cx, cy + 0.3 * r);
        layer(layers, 'jungle').addCircle(cx, cy, 0.2 * r);
        layer(layers, 'jungleLight').addCircle(cx - 0.06 * r, cy - 0.06 * r, 0.08 * r);
      }
      break;
    case Biome.Mountains: {
      const top = y - 0.5 * r;
      const left = x - 0.55 * r;
      const right = x + 0.55 * r;
      const bottom = y + 0.35 * r;
      layer(layers, 'mountain').moveTo(x, top).lineTo(left, bottom).lineTo(right, bottom).close();
      layer(layers, 'mountainLight').moveTo(x, top).lineTo(left, bottom).lineTo(x - 0.08 * r, bottom).close();
      if (world.temperature[cell] < 2 || world.elevation[cell] > 0.93) {
        layer(layers, 'snow')
          .moveTo(x, top)
          .lineTo(x - 0.17 * r, top + 0.25 * r)
          .lineTo(x + 0.17 * r, top + 0.25 * r)
          .close();
      }
      break;
    }
    case Biome.Hills:
      hill(layers, x - 0.22 * r, y + 0.2 * r, 0.32 * r);
      hill(layers, x + 0.24 * r + j(5), y - 0.02 * r, 0.26 * r);
      break;
    case Biome.Desert:
      if (hash(cell, 6) < 0.6) {
        layer(layers, 'dune')
          .moveTo(x - 0.4 * r, y)
          .quadTo(x - 0.1 * r, y - 0.22 * r, x + 0.2 * r, y)
          .moveTo(x - 0.1 * r, y + 0.25 * r)
          .quadTo(x + 0.15 * r, y + 0.08 * r, x + 0.4 * r, y + 0.25 * r);
      }
      break;
    case Biome.Savanna:
      if (hash(cell, 7) < 0.55) {
        const cx = x + j(8);
        layer(layers, 'trunk').moveTo(cx, y + 0.3 * r).lineTo(cx, y - 0.05 * r);
        layer(layers, 'acacia').addOval(Skia.XYWHRect(cx - 0.32 * r, y - 0.2 * r, 0.64 * r, 0.17 * r));
      } else {
        tuft(layers, 'dryGrass', x - 0.2 * r + j(9), y + 0.1 * r, r);
        tuft(layers, 'dryGrass', x + 0.2 * r, y - 0.1 * r + j(10), r);
      }
      break;
    case Biome.Plains:
      if (hash(cell, 11) < 0.7) {
        tuft(layers, 'grass', x - 0.22 * r + j(12), y + 0.12 * r, r);
        tuft(layers, 'grass', x + 0.2 * r, y - 0.12 * r + j(13), r);
      }
      break;
    case Biome.Swamp:
      layer(layers, 'swampWater')
        .moveTo(x - 0.35 * r, y + 0.22 * r)
        .lineTo(x - 0.05 * r, y + 0.22 * r)
        .moveTo(x + 0.05 * r, y + 0.32 * r)
        .lineTo(x + 0.35 * r, y + 0.32 * r);
      for (const ox of [-0.2, 0, 0.2]) {
        const cx = x + ox * r;
        layer(layers, 'reed').moveTo(cx, y + 0.15 * r).lineTo(cx + ox * 0.3 * r, y - 0.25 * r);
      }
      break;
    case Biome.Tundra:
      tuft(layers, 'tundra', x - 0.18 * r + j(14), y + 0.05 * r, r * 0.8);
      if (hash(cell, 15) < 0.5) tuft(layers, 'tundra', x + 0.22 * r, y + 0.2 * r, r * 0.8);
      break;
    case Biome.Ice:
      layer(layers, 'ice')
        .moveTo(x - 0.3 * r + j(16), y - 0.1 * r)
        .lineTo(x, y + 0.05 * r)
        .lineTo(x + 0.25 * r, y - 0.15 * r)
        .moveTo(x, y + 0.05 * r)
        .lineTo(x + 0.05 * r, y + 0.3 * r);
      break;
    case Biome.DeepOcean:
      if (hash(cell, 17) < 0.25) {
        const cx = x + j(18);
        layer(layers, 'wave')
          .moveTo(cx - 0.25 * r, y)
          .quadTo(cx - 0.125 * r, y - 0.1 * r, cx, y)
          .quadTo(cx + 0.125 * r, y + 0.1 * r, cx + 0.25 * r, y);
      }
      break;
  }
}

function tree(layers: IconLayers, x: number, y: number, r: number) {
  layer(layers, 'trunk').moveTo(x, y + 0.1 * r).lineTo(x, y + 0.24 * r);
  layer(layers, 'tree')
    .moveTo(x, y - 0.3 * r)
    .lineTo(x - 0.18 * r, y + 0.12 * r)
    .lineTo(x + 0.18 * r, y + 0.12 * r)
    .close();
}

function hill(layers: IconLayers, x: number, y: number, w: number) {
  layer(layers, 'hillFill').moveTo(x - w, y).quadTo(x, y - w * 1.3, x + w, y).close();
  layer(layers, 'hillLine').moveTo(x - w, y).quadTo(x, y - w * 1.3, x + w, y);
}

function tuft(layers: IconLayers, name: LayerName, x: number, y: number, r: number) {
  layer(layers, name)
    .moveTo(x - 0.09 * r, y - 0.13 * r)
    .lineTo(x, y)
    .lineTo(x + 0.09 * r, y - 0.13 * r)
    .moveTo(x, y)
    .lineTo(x, y - 0.16 * r);
}

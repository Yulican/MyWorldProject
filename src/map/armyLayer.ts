import { Skia, createPicture, type SkImage, type SkPaint, type SkPathBuilder, type SkPicture } from '@shopify/react-native-skia';
import { ArmyState, hexCenterX, hexCenterY, type World } from '../sim';
import { HEX_PX } from './mapGeometry';
import { sharedFillPaint, sharedStrokePaint } from './paints';

// Army markers ("Design Documents/Requirement Krieg.md", section 10, phase
// 3a): a shield with crossed swords (dark when marching, grey while gathering,
// pale brown when retreating) and a flag in the people's color on every hex
// with an army, no march line. At most MAX_ARMIES (32) armies exist, so all
// markers are recorded into one small picture whenever an army moves (a few
// times a second at most, see worldStore.armyStore); drawing it in a frame
// only replays that picture.
//
// The marker's parts are small images (sprites, rendered once on the JS
// thread like the map tiles): the picture only places them. Drawing images is
// what the UI thread does for the tiles anyway, while paths there would be
// rasterized again for every new picture (and need their own GPU programs
// the first time an army appears).

/** Compact marker data (worldStore.mapArmies): `count` armies on `cell` of people `civ` in ArmyState `state`. */
export type ArmyMarkers = { readonly count: number; readonly cell: Int32Array; readonly civ: Uint8Array; readonly state: Uint8Array };

/** Shield color by ArmyState: marching dark, gathering grey, retreating pale brown. */
const SHIELD_COLORS = ['#2a2a2a', '#7a7a7a', '#9c7b55'] as const;
const SWORD_COLOR = '#f2f2f2';
const POLE_COLOR = '#1b1b1b';
/** Shield half-width in hex sizes; more armies on one hex stand side by side, this far apart. */
const SIZE = 0.2;
const SIDE_STEP = 0.32;
/** Marker unit in map pixels. */
const U = HEX_PX * SIZE;
const POLE_WIDTH = HEX_PX * 0.05;
const SWORD_WIDTH = HEX_PX * 0.045;

/** A sprite's box around the marker's anchor (x, y), in map pixels, with room for strokes and smoothing. */
type Box = { x: number; y: number; w: number; h: number };
/** Flag and pole: from the pole's foot at the shield's top up to the pennant. */
const FLAG_BOX: Box = { x: -0.95 * U, y: -3.55 * U, w: 2.6 * U, h: 2.9 * U };
/** Shield with swords. */
const SHIELD_BOX: Box = { x: -1.25 * U, y: -1.25 * U, w: 2.5 * U, h: 2.9 * U };

/**
 * The marker sprites (flags by people color, the pole with the flag's
 * outline, shields by state, the swords), rendered at `pxPerUnit` pixels per
 * map pixel (the sharpest zoom tier) and kept until `dispose`.
 */
/** A sprite image and a picture that draws it into its box around the anchor (placed by translating). */
type Sprite = { image: SkImage; picture: SkPicture } | null;

export class ArmySprites {
  private flags = new Map<string, Sprite>();
  readonly shields: Sprite[];
  readonly pole: Sprite;
  readonly swords: Sprite;

  constructor(private pxPerUnit: number) {
    this.shields = SHIELD_COLORS.map((color) =>
      makeSprite(SHIELD_BOX, pxPerUnit, sharedFillPaint(color), (path) => addShield(path, null, 0, 0)),
    );
    this.swords = makeSprite(SHIELD_BOX, pxPerUnit, sharedStrokePaint(SWORD_COLOR, SWORD_WIDTH), (path) =>
      addShield(null, path, 0, 0),
    );
    this.pole = makeSprite(FLAG_BOX, pxPerUnit, sharedStrokePaint(POLE_COLOR, POLE_WIDTH), (path) =>
      addFlag(null, path, 0, 0),
    );
  }

  flag(color: string): Sprite {
    let sprite = this.flags.get(color);
    if (sprite === undefined) {
      sprite = makeSprite(FLAG_BOX, this.pxPerUnit, sharedFillPaint(color), (path) => addFlag(path, null, 0, 0));
      this.flags.set(color, sprite);
    }
    return sprite;
  }

  /** Frees the sprites once no picture on screen can use them any more. */
  dispose() {
    const all = [...this.flags.values(), ...this.shields, this.pole, this.swords];
    this.flags.clear();
    setTimeout(
      () =>
        all.forEach((sprite) => {
          sprite?.picture.dispose();
          sprite?.image.dispose();
        }),
      1000,
    );
  }
}

/** Marker positions (map pixels), reused: an army picture is recorded several times a second. */
const markerX = new Float64Array(256);
const markerY = new Float64Array(256);

/**
 * Records all army markers into one picture, in two copies side by side (the
 * map wraps: its second copy is drawn at `+ mapWidth`), in layers: the flags
 * by people, the poles, the shields by state, the swords. Only the sprites'
 * pictures are placed, so recording allocates next to nothing.
 */
export function buildArmyPicture(
  world: World,
  markers: ArmyMarkers,
  colorOf: (civ: number) => string,
  mapWidth: number,
  sprites: ArmySprites,
): SkPicture {
  const count = Math.min(markers.count, markerX.length);
  const xs = markerX;
  const ys = markerY;
  for (let i = 0; i < count; i++) {
    const cell = markers.cell[i];
    // Armies earlier in the list on the same hex: this one stands beside them.
    let before = 0;
    for (let j = 0; j < i; j++) if (markers.cell[j] === cell) before++;
    const col = cell % world.width;
    const row = (cell - col) / world.width;
    xs[i] = (hexCenterX(col) + 0.3 + before * SIDE_STEP) * HEX_PX;
    ys[i] = (hexCenterY(col, row) + 0.3) * HEX_PX;
  }
  return createPicture((canvas) => {
    if (count === 0) return;
    const place = (sprite: Sprite, i: number) => {
      if (!sprite) return;
      for (let copy = 0; copy < 2; copy++) {
        canvas.save();
        canvas.translate(xs[i] + copy * mapWidth, ys[i]);
        canvas.drawPicture(sprite.picture);
        canvas.restore();
      }
    };
    // Flags grouped by people, in the order the peoples first appear.
    for (let i = 0; i < count; i++) {
      const civ = markers.civ[i];
      let first = true;
      for (let j = 0; j < i; j++) if (markers.civ[j] === civ) first = false;
      if (!first) continue;
      const flag = sprites.flag(colorOf(civ));
      for (let j = i; j < count; j++) if (markers.civ[j] === civ) place(flag, j);
    }
    for (let i = 0; i < count; i++) place(sprites.pole, i);
    for (let st = 0; st < SHIELD_COLORS.length; st++) {
      for (let i = 0; i < count; i++) if (stateOf(markers, i) === st) place(sprites.shields[st], i);
    }
    for (let i = 0; i < count; i++) place(sprites.swords, i);
  });
}

/** The marker's shield: 0 marching, 1 gathering, 2 retreating. */
function stateOf(markers: ArmyMarkers, i: number): number {
  const st = markers.state[i];
  return st === ArmyState.Gathering ? 1 : st === ArmyState.Retreating ? 2 : 0;
}

/** A sprite and the picture that draws it into `box` (see Sprite). */
function makeSprite(box: Box, pxPerUnit: number, paint: SkPaint, add: (path: SkPathBuilder) => void): Sprite {
  const image = renderSprite(box, pxPerUnit, paint, add);
  if (!image) return null;
  // Its bounds are the box (the default bounds start at 0 and would cut off the box's upper left).
  const dst = Skia.XYWHRect(box.x, box.y, box.w, box.h);
  const picture = createPicture((canvas) => {
    canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), dst, Skia.Paint(), true);
  }, dst);
  return { image, picture };
}

/** Renders one sprite: the path `add` makes, drawn with `paint` into the box. */
function renderSprite(box: Box, pxPerUnit: number, paint: SkPaint, add: (path: SkPathBuilder) => void): SkImage | null {
  const w = Math.ceil(box.w * pxPerUnit);
  const h = Math.ceil(box.h * pxPerUnit);
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.scale(w / box.w, h / box.h);
  canvas.translate(-box.x, -box.y);
  const path = Skia.PathBuilder.Make();
  add(path);
  canvas.drawPath(path.detach(), paint);
  surface.flush();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}

/** A shield (flat top, pointed bottom) and/or its crossed swords with hilts at (x, y). */
function addShield(shield: SkPathBuilder | null, swords: SkPathBuilder | null, x: number, y: number) {
  const u = U;
  if (shield) {
    shield.moveTo(x - u, y - u);
    shield.lineTo(x + u, y - u);
    shield.lineTo(x + u, y + u * 0.2);
    shield.quadTo(x + u * 0.8, y + u, x, y + u * 1.4);
    shield.quadTo(x - u * 0.8, y + u, x - u, y + u * 0.2);
    shield.close();
  }
  if (!swords) return;
  const s = u * 0.65;
  swords.moveTo(x - s, y - s);
  swords.lineTo(x + s, y + s);
  swords.moveTo(x + s, y - s);
  swords.lineTo(x - s, y + s);
  swords.moveTo(x + s * 0.3, y + s * 0.9);
  swords.lineTo(x + s * 0.9, y + s * 0.3);
  swords.moveTo(x - s * 0.3, y + s * 0.9);
  swords.lineTo(x - s * 0.9, y + s * 0.3);
}

/** The flag and/or the pole with the flag's outline, above the shield's left edge of a marker at (x, y). */
function addFlag(flag: SkPathBuilder | null, pole: SkPathBuilder | null, x: number, y: number) {
  const u = U;
  const px = x - u * 0.6;
  const top = y - u * 3.2;
  if (pole) {
    pole.moveTo(px, y - u);
    pole.lineTo(px, top);
  }
  for (const path of [flag, pole]) {
    if (!path) continue;
    path.moveTo(px, top);
    path.lineTo(px + u * 1.9, top + u * 0.55);
    path.lineTo(px, top + u * 1.1);
    path.close();
  }
}

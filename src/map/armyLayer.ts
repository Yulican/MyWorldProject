import { Skia, createPicture, type SkPathBuilder, type SkPicture } from '@shopify/react-native-skia';
import { ArmyState, hexCenterX, hexCenterY, type World } from '../sim';
import { HEX_PX } from './mapGeometry';
import { sharedFillPaint, sharedStrokePaint } from './paints';

// Army markers ("Design Documents/Requirement Krieg.md", section 10, phase
// 3a): a shield with crossed swords (dark when marching, grey while gathering,
// pale brown when retreating) and a flag in the people's color on every hex
// with an army, no march line. At most MAX_ARMIES (32) armies
// exist, so all markers are recorded into one small picture whenever an army
// moves (a few times a second at most, see worldStore.armyStore); drawing it
// in a frame only replays that picture.

/** Compact marker data (worldStore.mapArmies): `count` armies on `cell` of people `civ` in ArmyState `state`. */
export type ArmyMarkers = { readonly count: number; readonly cell: Int32Array; readonly civ: Uint8Array; readonly state: Uint8Array };

/** Shield color by ArmyState: marching dark, gathering grey, retreating pale brown. */
const SHIELD_COLORS = ['#2a2a2a', '#7a7a7a', '#9c7b55'] as const;
const SWORD_COLOR = '#f2f2f2';
const POLE_COLOR = '#1b1b1b';
/** Shield half-width in hex sizes; more armies on one hex stand side by side, this far apart. */
const SIZE = 0.2;
const SIDE_STEP = 0.32;

/**
 * Records all army markers into one picture, in two copies side by side (the
 * map wraps: its second copy is drawn at `+ mapWidth`).
 */
export function buildArmyPicture(world: World, markers: ArmyMarkers, colorOf: (civ: number) => string, mapWidth: number): SkPicture {
  const shields = SHIELD_COLORS.map(() => Skia.PathBuilder.Make());
  const used = [false, false, false];
  const swords = Skia.PathBuilder.Make();
  const poles = Skia.PathBuilder.Make();
  const flags = new Map<number, SkPathBuilder>();
  for (let i = 0; i < markers.count; i++) {
    const cell = markers.cell[i];
    // Armies earlier in the list on the same hex: this one stands beside them.
    let before = 0;
    for (let j = 0; j < i; j++) if (markers.cell[j] === cell) before++;
    const col = cell % world.width;
    const row = (cell - col) / world.width;
    const x = (hexCenterX(col) + 0.3 + before * SIDE_STEP) * HEX_PX;
    const y = (hexCenterY(col, row) + 0.3) * HEX_PX;
    const civ = markers.civ[i];
    let flag = flags.get(civ);
    if (!flag) {
      flag = Skia.PathBuilder.Make();
      flags.set(civ, flag);
    }
    const st = markers.state[i] === ArmyState.Gathering ? 1 : markers.state[i] === ArmyState.Retreating ? 2 : 0;
    used[st] = true;
    for (let copy = 0; copy < 2; copy++) addMarker(shields[st], swords, poles, flag, x + copy * mapWidth, y);
  }
  return createPicture((canvas) => {
    if (markers.count === 0) return;
    for (const [civ, flag] of flags) canvas.drawPath(flag.detach(), sharedFillPaint(colorOf(civ)));
    canvas.drawPath(poles.detach(), sharedStrokePaint(POLE_COLOR, HEX_PX * 0.05));
    for (let st = 0; st < shields.length; st++) if (used[st]) canvas.drawPath(shields[st].detach(), sharedFillPaint(SHIELD_COLORS[st]));
    canvas.drawPath(swords.detach(), sharedStrokePaint(SWORD_COLOR, HEX_PX * 0.045));
  });
}

/** One marker: a shield with crossed swords at (x, y) and a flag (outlined with the pole) rising from its upper left. */
function addMarker(shield: SkPathBuilder, swords: SkPathBuilder, pole: SkPathBuilder, flag: SkPathBuilder, x: number, y: number) {
  const u = HEX_PX * SIZE;
  // Shield: flat top, pointed bottom.
  shield.moveTo(x - u, y - u);
  shield.lineTo(x + u, y - u);
  shield.lineTo(x + u, y + u * 0.2);
  shield.quadTo(x + u * 0.8, y + u, x, y + u * 1.4);
  shield.quadTo(x - u * 0.8, y + u, x - u, y + u * 0.2);
  shield.close();
  // Crossed swords with hilts.
  const s = u * 0.65;
  swords.moveTo(x - s, y - s);
  swords.lineTo(x + s, y + s);
  swords.moveTo(x + s, y - s);
  swords.lineTo(x - s, y + s);
  swords.moveTo(x + s * 0.3, y + s * 0.9);
  swords.lineTo(x + s * 0.9, y + s * 0.3);
  swords.moveTo(x - s * 0.3, y + s * 0.9);
  swords.lineTo(x - s * 0.9, y + s * 0.3);
  // Flag on a pole above the shield's left edge.
  const px = x - u * 0.6;
  const top = y - u * 3.2;
  pole.moveTo(px, y - u);
  pole.lineTo(px, top);
  for (const path of [flag, pole]) {
    path.moveTo(px, top);
    path.lineTo(px + u * 1.9, top + u * 0.55);
    path.lineTo(px, top + u * 1.1);
    path.close();
  }
}

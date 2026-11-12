import { PaintStyle, Skia, StrokeCap, StrokeJoin, type SkPaint, type SkPathBuilder } from '@shopify/react-native-skia';

export function fillPaint(color: string): SkPaint {
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(color));
  paint.setStyle(PaintStyle.Fill);
  return paint;
}

export function strokePaint(color: string, width: number): SkPaint {
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(color));
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(width);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeJoin(StrokeJoin.Round);
  return paint;
}

const fills = new Map<string, SkPaint>();
const strokes = new Map<string, SkPaint>();

/** A shared fill paint per color, for drawing that runs often (tiles): no new paint objects per draw. */
export function sharedFillPaint(color: string): SkPaint {
  let paint = fills.get(color);
  if (!paint) {
    paint = fillPaint(color);
    fills.set(color, paint);
  }
  return paint;
}

/** A shared stroke paint per color and width (see sharedFillPaint). */
export function sharedStrokePaint(color: string, width: number): SkPaint {
  const key = `${color}|${width}`;
  let paint = strokes.get(key);
  if (!paint) {
    paint = strokePaint(color, width);
    strokes.set(key, paint);
  }
  return paint;
}

/**
 * Path builders by key (a color or a people), kept from one tile render to
 * the next instead of made anew: each builder is emptied by `drawAll`
 * (detach), which visits the keys used since the last `drawAll` in the order
 * they were first used.
 */
export class BuilderSet<K> {
  private builders = new Map<K, { path: SkPathBuilder; round: number }>();
  private used: K[] = [];
  private round = 1;

  get(key: K): SkPathBuilder {
    let entry = this.builders.get(key);
    if (!entry) {
      entry = { path: Skia.PathBuilder.Make(), round: 0 };
      this.builders.set(key, entry);
    }
    if (entry.round !== this.round) {
      entry.round = this.round;
      this.used.push(key);
    }
    return entry.path;
  }

  drawAll(draw: (key: K, path: SkPathBuilder) => void) {
    for (const key of this.used) draw(key, this.builders.get(key)!.path);
    this.used.length = 0;
    this.round++;
  }
}

/** One path builder kept between renders (see BuilderSet); `detach()` empties it. */
export function keptBuilder(): () => SkPathBuilder {
  let path: SkPathBuilder | null = null;
  return () => (path ??= Skia.PathBuilder.Make());
}

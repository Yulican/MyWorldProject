import { PaintStyle, Skia, StrokeCap, StrokeJoin, type SkPaint } from '@shopify/react-native-skia';

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

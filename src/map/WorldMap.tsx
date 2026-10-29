import { Canvas, Group, Path, Picture, Skia, type SkPicture } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { cellAtPoint, hexCenterX, hexCenterY, type World } from '../sim';
import { SELECTION_COLOR } from './palette';
import { HEX_PX, buildWorldPictures } from './worldPicture';

const MAX_SCALE = 3;
/** Below this zoom hex outlines and icons fade out (they'd only be noise). */
const DETAIL_FADE_START = 0.3;
const DETAIL_FADE_END = 0.5;

type Props = {
  world: World;
  selectedCell: number;
  onSelectCell: (cell: number) => void;
  /** Changing layer drawn above the terrain, e.g. territories. Same coordinates as the world pictures. */
  overlay?: SkPicture | null;
};

/**
 * Pannable, zoomable hex map. The world is pre-rendered into pictures once;
 * gestures only change a transform on the UI thread. The map wraps left and
 * right: three copies are drawn side by side and the horizontal offset is
 * kept within one map width.
 */
export function WorldMap({ world, selectedCell, onSelectCell, overlay }: Props) {
  const pictures = useMemo(() => buildWorldPictures(world), [world]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const minScale = useSharedValue(0.2);

  // Center the start location whenever a new world appears.
  useEffect(() => {
    if (size.width === 0) return;
    const fit = size.height / pictures.height;
    minScale.value = Math.min(1, fit);
    const s = 1;
    const col = world.startCell % world.width;
    const row = Math.floor(world.startCell / world.width);
    scale.value = s;
    tx.value = wrapX(size.width / 2 - hexCenterX(col) * HEX_PX * s, pictures.width * s);
    ty.value = clampY(size.height / 2 - hexCenterY(col, row) * HEX_PX * s, pictures.height * s, size.height);
  }, [world, pictures, size, tx, ty, scale, minScale]);

  const viewHeight = size.height;
  const mapWidth = pictures.width;
  const mapHeight = pictures.height;

  const pan = usePanGesture({
    onUpdate: (e) => {
      'worklet';
      tx.value = wrapX(tx.value + e.changeX, mapWidth * scale.value);
      ty.value = clampY(ty.value + e.changeY, mapHeight * scale.value, viewHeight);
    },
  });

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      'worklet';
      const next = Math.min(MAX_SCALE, Math.max(minScale.value, scale.value * e.scaleChange));
      const k = next / scale.value;
      // Zoom around the point between the fingers.
      tx.value = wrapX(e.focalX - (e.focalX - tx.value) * k, mapWidth * next);
      ty.value = clampY(e.focalY - (e.focalY - ty.value) * k, mapHeight * next, viewHeight);
      scale.value = next;
    },
  });

  const handleTap = (x: number, y: number) => {
    const cell = cellAtPoint(world, x / HEX_PX, y / HEX_PX);
    onSelectCell(cell);
  };

  const tap = useTapGesture({
    onActivate: (e) => {
      'worklet';
      scheduleOnRN(handleTap, (e.x - tx.value) / scale.value, (e.y - ty.value) / scale.value);
    },
  });

  const gesture = useSimultaneousGestures(pan, pinch, tap);

  const transform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: scale.value },
  ]);
  const detailOpacity = useDerivedValue(() =>
    Math.min(1, Math.max(0, (scale.value - DETAIL_FADE_START) / (DETAIL_FADE_END - DETAIL_FADE_START))),
  );

  const selection = useMemo(() => {
    if (selectedCell < 0) return null;
    const col = selectedCell % world.width;
    const row = Math.floor(selectedCell / world.width);
    const x = hexCenterX(col) * HEX_PX;
    const y = hexCenterY(col, row) * HEX_PX;
    const r = HEX_PX * 0.92;
    const h = (Math.sqrt(3) / 2) * r;
    return Skia.PathBuilder.Make()
      .moveTo(x + r, y)
      .lineTo(x + r / 2, y + h)
      .lineTo(x - r / 2, y + h)
      .lineTo(x - r, y)
      .lineTo(x - r / 2, y - h)
      .lineTo(x + r / 2, y - h)
      .close()
      .detach();
  }, [selectedCell, world]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View style={styles.container} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Canvas style={styles.canvas}>
          <Group transform={transform}>
            {[-1, 0, 1].map((copy) => (
              <Group key={copy} transform={[{ translateX: copy * mapWidth }]}>
                <Picture picture={pictures.base} />
                <Group opacity={detailOpacity}>
                  <Picture picture={pictures.detail} />
                </Group>
                {overlay && <Picture picture={overlay} />}
                {selection && (
                  <Path path={selection} style="stroke" strokeWidth={3} color={SELECTION_COLOR} />
                )}
              </Group>
            ))}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
}

/** Keeps the horizontal offset within one (scaled) map width; the map repeats. */
function wrapX(x: number, scaledWidth: number): number {
  'worklet';
  const m = x % scaledWidth;
  return m > 0 ? m - scaledWidth : m;
}

/** Keeps at least part of the map on screen vertically. */
function clampY(y: number, scaledHeight: number, viewHeight: number): number {
  'worklet';
  const margin = viewHeight * 0.3;
  const min = Math.min(margin, viewHeight - scaledHeight - margin);
  const max = Math.max(viewHeight - scaledHeight - margin, margin);
  return Math.min(max, Math.max(min, y));
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f2747', overflow: 'hidden' },
  canvas: { flex: 1 },
});

import { Canvas, Group, Image, Path, Picture, Skia } from '@shopify/react-native-skia';
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
import { recordMapBuild } from '../state/perfStats';
import { HEX_PX } from './mapGeometry';
import { SELECTION_COLOR } from './palette';
import { buildTerritoryLayers } from './territoryLayers';
import { sameViewTiles, viewTiles, visibleTiles, type ViewTiles } from './viewport';
import { buildWorldLayers } from './worldPicture';

const MAX_SCALE = 3;
const START_SCALE = 1;
/** A tap right after dragging or pinching is almost always a finger lifting off, not a tap. */
const TAP_COOLDOWN_MS = 300;

type Props = {
  world: World;
  selectedCell: number;
  onTapCell: (cell: number) => void;
  /** Changes whenever the world's society snapshot (owners, population) changes. */
  territoryVersion: number;
  /** Map color of a civilization id. */
  civColor: (civ: number) => string;
};

/**
 * Pannable, zoomable hex map. Gestures only change a transform on the UI
 * thread. Zoomed out, a single pre-rendered image is drawn; zoomed in, sharp
 * vector tiles near the screen are drawn on top of it. The map wraps left and
 * right: the horizontal offset is kept within one map width and the next map
 * copy is drawn beside the first.
 */
export function WorldMap({ world, selectedCell, onTapCell, territoryVersion, civColor }: Props) {
  const layers = useMemo(() => buildWorldLayers(world), [world]);
  // `territoryVersion` stands in for the world's mutable society arrays.
  const territory = useMemo(() => {
    const t0 = performance.now();
    const built = buildTerritoryLayers(world, civColor, layers);
    recordMapBuild(performance.now() - t0);
    return built;
  }, [world, layers, territoryVersion]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<ViewTiles>({ x0: 0, x1: -1, y0: 0, y1: -1, detail: false });
  const tiles = useMemo(() => visibleTiles(view, layers), [view, layers]);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(START_SCALE);
  const minScale = useSharedValue(0.2);
  const lastView = useSharedValue<ViewTiles>(view);
  const lastMoveAt = useSharedValue(0);

  const mapWidth = layers.width;
  const mapHeight = layers.height;
  const viewW = size.width;
  const viewH = size.height;

  // Center the start location whenever a new world appears.
  useEffect(() => {
    if (viewW === 0) return;
    minScale.value = Math.min(1, viewH / mapHeight);
    const col = world.startCell % world.width;
    const row = Math.floor(world.startCell / world.width);
    scale.value = START_SCALE;
    tx.value = wrapX(viewW / 2 - hexCenterX(col) * HEX_PX * START_SCALE, mapWidth * START_SCALE);
    ty.value = clampY(viewH / 2 - hexCenterY(col, row) * HEX_PX * START_SCALE, mapHeight * START_SCALE, viewH);
    const next = viewTiles(tx.value, ty.value, START_SCALE, viewW, viewH);
    lastView.value = next;
    setView(next);
  }, [world, mapWidth, mapHeight, viewW, viewH, tx, ty, scale, minScale, lastView]);

  /** Tells React when the view crosses a tile border, so the visible tiles get updated. */
  const reportView = () => {
    'worklet';
    const next = viewTiles(tx.value, ty.value, scale.value, viewW, viewH);
    if (sameViewTiles(next, lastView.value)) return;
    lastView.value = next;
    scheduleOnRN(setView, next);
  };

  const pan = usePanGesture({
    onUpdate: (e) => {
      'worklet';
      tx.value = wrapX(tx.value + e.changeX, mapWidth * scale.value);
      ty.value = clampY(ty.value + e.changeY, mapHeight * scale.value, viewH);
      lastMoveAt.value = Date.now();
      reportView();
    },
  });

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      'worklet';
      const next = Math.min(MAX_SCALE, Math.max(minScale.value, scale.value * e.scaleChange));
      const k = next / scale.value;
      // Zoom around the point between the fingers.
      tx.value = wrapX(e.focalX - (e.focalX - tx.value) * k, mapWidth * next);
      ty.value = clampY(e.focalY - (e.focalY - ty.value) * k, mapHeight * next, viewH);
      scale.value = next;
      lastMoveAt.value = Date.now();
      reportView();
    },
  });

  const handleTap = (x: number, y: number) => {
    onTapCell(cellAtPoint(world, x / HEX_PX, y / HEX_PX));
  };

  const tap = useTapGesture({
    maxDistance: 8,
    maxDuration: 250,
    onActivate: (e) => {
      'worklet';
      if (e.numberOfPointers > 1 || Date.now() - lastMoveAt.value < TAP_COOLDOWN_MS) return;
      scheduleOnRN(handleTap, (e.x - tx.value) / scale.value, (e.y - ty.value) / scale.value);
    },
  });

  const gesture = useSimultaneousGestures(pan, pinch, tap);

  const transform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: scale.value },
  ]);

  const selection = useMemo(() => (selectedCell < 0 ? null : hexOutline(world, selectedCell)), [selectedCell, world]);
  const { overview, overviewRect: o } = layers;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View style={styles.container} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Canvas style={styles.canvas}>
          <Group transform={transform}>
            {/* Two copies cover any view: the offset stays within one map width. */}
            {[0, 1].map((copy) => (
              <Image
                key={copy}
                image={overview}
                x={o.x + copy * mapWidth}
                y={o.y}
                width={o.width}
                height={o.height}
                fit="fill"
              />
            ))}
            {tiles.map((t) => (
              <Group key={`f${t.key}`} transform={[{ translateX: t.offsetX }]}>
                <Picture picture={layers.chunks[t.chunk].fills} />
              </Group>
            ))}
            {/* Icons after all fills, so no tile covers the icons of its neighbor. */}
            {tiles.map((t) => (
              <Group key={`i${t.key}`} transform={[{ translateX: t.offsetX }]}>
                <Picture picture={layers.chunks[t.chunk].icons} />
              </Group>
            ))}
            {/* Territories: sharp tiles when zoomed in, otherwise the overview image. */}
            {view.detail
              ? tiles.map((t) => (
                  <Group key={`t${t.key}`} transform={[{ translateX: t.offsetX }]}>
                    <Picture picture={territory.chunk(t.chunk)} />
                  </Group>
                ))
              : [0, 1].map((copy) => (
                  <Image
                    key={`t${copy}`}
                    image={territory.overview}
                    x={territory.overviewRect.x + copy * mapWidth}
                    y={territory.overviewRect.y}
                    width={territory.overviewRect.width}
                    height={territory.overviewRect.height}
                    fit="fill"
                  />
                ))}
            {selection &&
              [0, 1].map((copy) => (
                <Group key={`s${copy}`} transform={[{ translateX: copy * mapWidth }]}>
                  <Path path={selection} style="stroke" strokeWidth={3} color={SELECTION_COLOR} />
                </Group>
              ))}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
}

function hexOutline(world: World, cell: number) {
  const col = cell % world.width;
  const row = Math.floor(cell / world.width);
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

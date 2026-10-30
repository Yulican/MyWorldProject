import { Canvas, Group, Image, Path, Picture, Skia, createPicture, type SkImage } from '@shopify/react-native-skia';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import type { Swipe, SwipeStats } from '../bench/benchmark';
import { cellAtPoint, hexCenterX, hexCenterY, type World } from '../sim';
import { countEvent, recordMapBuild } from '../state/perfStats';
import { CHUNK_H, CHUNK_W, HEX_PX } from './mapGeometry';
import { MapPerfMeter } from './MapPerfMeter';
import { SELECTION_COLOR } from './palette';
import {
  buildTerritoryOverview,
  renderTerritoryTile,
  TERRITORY_TILE_RESOLUTION,
  territoryTileSignature,
} from './territoryLayers';
import { TileImages } from './tileImages';
import { sameViewTiles, TIER_ZOOMS, viewTiles, visibleTiles, type TileRef, type ViewTiles } from './viewport';
import { buildWorldLayers, renderTile, TILE_BLEED, type WorldLayers } from './worldPicture';

const MAX_SCALE = 3;
const START_SCALE = 1;
/** A tap right after dragging or pinching is almost always a finger lifting off, not a tap. */
const TAP_COOLDOWN_MS = 300;
/** Slower releases just stop; faster ones let the map glide on. */
const MIN_FLING_VELOCITY = 150;
/** Lifting the fingers after a pinch reports a pan velocity that isn't a fling. */
const FLING_AFTER_PINCH_MS = 150;
const NO_TILES: ViewTiles = { x0: 0, x1: -1, y0: 0, y1: -1, detail: false, tier: 0 };
/** Rings of tiles around the screen rendered ahead, so panning finds them ready. */
const PREFETCH_TILES = 1;

/**
 * Where the territory layer gets the society snapshot from: an external
 * store (as for useSyncExternalStore) whose version changes with every new
 * snapshot, plus each civilization's color. Should be stable per world.
 */
export type TerritorySource = {
  subscribe: (listener: () => void) => () => void;
  getVersion: () => number;
  civColor: (civ: number) => string;
};

/** Drives the map from code, for the performance benchmark. */
export type MapController = {
  /** Zooms to `scale` and centers the map. */
  zoomToCenter: (scale: number) => void;
  /** Moves the map at constant speed, like a drag, and measures its frames. */
  swipe: (swipe: Swipe) => Promise<SwipeStats>;
};

type Props = {
  world: World;
  selectedCell: number;
  onTapCell: (cell: number) => void;
  territory: TerritorySource;
  controller?: { current: MapController | null };
};

/**
 * Pannable, zoomable hex map. Gestures only change a transform on the UI
 * thread. Zoomed out, a single pre-rendered image is drawn; zoomed in, sharp
 * pre-rendered tile images near the screen are drawn on top of it. Drawing
 * images is cheap at any zoom, so moving the map never redraws vector paths;
 * tiles are rendered on the JS thread ahead of time (see tileImages.ts). The map wraps left and
 * right: the horizontal offset is kept within one map width and the next map
 * copy is drawn beside the first.
 *
 * Which tiles are visible lives in <TileLayer>, so crossing a tile border
 * re-renders only the tiles and never the gesture setup mid-gesture. The
 * territory layer follows the simulation there too, so new snapshots don't
 * re-render the map either.
 *
 * Releasing a drag lets the map glide on and slow down, so short repeated
 * swipes flow into each other instead of stopping hard. Touching the map
 * catches it.
 *
 * While pinching, tiles keep their zoom tier and are scaled; the sharper or
 * lighter tier is rendered when the fingers lift.
 */
export const WorldMap = memo(function WorldMap({ world, selectedCell, onTapCell, territory, controller }: Props) {
  const layers = useMemo(() => buildWorldLayers(world), [world]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(START_SCALE);
  const minScale = useSharedValue(0.2);
  const lastView = useSharedValue<ViewTiles>(NO_TILES);
  const lastMoveAt = useSharedValue(0);
  const zooming = useSharedValue(false);
  const pinchEndedAt = useSharedValue(0);
  // Glide after a drag: decaying offsets whose per-frame change moves the map.
  const glideX = useSharedValue(0);
  const glideY = useSharedValue(0);

  // The tile layer registers its state setter here; the stable forwarder can
  // be called from gesture worklets without re-creating them.
  const tileListener = useRef<(view: ViewTiles) => void>(() => {});
  const onViewChange = useCallback((view: ViewTiles) => tileListener.current(view), []);

  // Latest tap handler, called through a stable function for the same reason.
  const tapHandler = useRef<(x: number, y: number) => void>(() => {});
  tapHandler.current = (x, y) => onTapCell(cellAtPoint(world, x / HEX_PX, y / HEX_PX));
  const onTap = useCallback((x: number, y: number) => tapHandler.current(x, y), []);

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
    const next = viewTiles(tx.value, ty.value, START_SCALE, viewW, viewH, null);
    lastView.value = next;
    onViewChange(next);
  }, [world, mapWidth, mapHeight, viewW, viewH, tx, ty, scale, minScale, lastView, onViewChange]);

  /** Tells the tile layer when the view crosses a tile border or the detail threshold. */
  const reportView = () => {
    'worklet';
    const prev = lastView.value;
    const next = viewTiles(tx.value, ty.value, scale.value, viewW, viewH, prev, zooming.value);
    if (sameViewTiles(next, prev)) return;
    lastView.value = next;
    scheduleOnRN(onViewChange, next);
  };

  const stopGlide = () => {
    'worklet';
    cancelAnimation(glideX);
    cancelAnimation(glideY);
  };

  useAnimatedReaction(
    () => [glideX.value, glideY.value],
    (cur, prev) => {
      if (!prev) return;
      const dx = cur[0] - prev[0];
      const dy = cur[1] - prev[1];
      if (dx === 0 && dy === 0) return;
      tx.value = wrapX(tx.value + dx, mapWidth * scale.value);
      ty.value = clampY(ty.value + dy, mapHeight * scale.value, viewH);
      lastMoveAt.value = Date.now();
      reportView();
    },
    [mapWidth, mapHeight, viewW, viewH],
  );

  // Benchmark swipes: frames are counted on the UI thread while one runs.
  const benchSwipe = useSharedValue({ active: false, frames: 0, timeMs: 0, worstMs: 0 });
  // Times the swipe on its own: an animation of an offset that doesn't change
  // (dx = 0 for a north swipe) would end at once.
  const benchClock = useSharedValue(0);
  const swipeDone = useRef<(stats: SwipeStats) => void>(() => {});
  const onSwipeDone = useCallback((stats: SwipeStats) => swipeDone.current(stats), []);
  useFrameCallback((frame) => {
    'worklet';
    const dt = frame.timeSincePreviousFrame;
    if (!benchSwipe.value.active || dt === null) return;
    benchSwipe.modify((b) => {
      'worklet';
      b.frames += 1;
      b.timeMs += dt;
      if (dt > b.worstMs) b.worstMs = dt;
      return b;
    }, false);
  });
  if (controller) {
    controller.current = {
      zoomToCenter: (z) =>
        scheduleOnUI(() => {
          'worklet';
          stopGlide();
          scale.value = z;
          tx.value = wrapX(viewW / 2 - (mapWidth / 2) * z, mapWidth * z);
          ty.value = clampY(viewH / 2 - (mapHeight / 2) * z, mapHeight * z, viewH);
          reportView();
        }),
      swipe: ({ dx, dy, durationMs }) =>
        new Promise((resolve) => {
          swipeDone.current = resolve;
          scheduleOnUI(() => {
            'worklet';
            benchSwipe.value = { active: true, frames: 0, timeMs: 0, worstMs: 0 };
            // Ignore the system's reduce-motion setting (off on CI emulators),
            // which would otherwise end the swipe at once.
            const timing = { duration: durationMs, easing: Easing.linear, reduceMotion: ReduceMotion.Never };
            glideY.value = withTiming(glideY.value + dy, timing);
            glideX.value = withTiming(glideX.value + dx, timing);
            benchClock.value = 0;
            benchClock.value = withTiming(1, timing, () => {
              const b = benchSwipe.value;
              benchSwipe.value = { ...b, active: false };
              scheduleOnRN(onSwipeDone, { frames: b.frames, timeMs: b.timeMs, worstMs: b.worstMs });
            });
          });
        }),
    };
  }

  const pan = usePanGesture({
    // Follow the average of all fingers, so lifting one finger after a pinch doesn't jump.
    averageTouches: true,
    onBegin: () => {
      'worklet';
      stopGlide();
    },
    onDeactivate: (e) => {
      'worklet';
      if (zooming.value || Date.now() - pinchEndedAt.value < FLING_AFTER_PINCH_MS) return;
      if (Math.hypot(e.velocityX, e.velocityY) < MIN_FLING_VELOCITY) return;
      glideX.value = withDecay({ velocity: e.velocityX });
      glideY.value = withDecay({ velocity: e.velocityY });
    },
    onUpdate: (e) => {
      'worklet';
      tx.value = wrapX(tx.value + e.changeX, mapWidth * scale.value);
      ty.value = clampY(ty.value + e.changeY, mapHeight * scale.value, viewH);
      lastMoveAt.value = Date.now();
      reportView();
    },
  });

  const pinch = usePinchGesture({
    onBegin: () => {
      'worklet';
      stopGlide();
    },
    onActivate: () => {
      'worklet';
      zooming.value = true;
    },
    onFinalize: () => {
      'worklet';
      if (zooming.value) pinchEndedAt.value = Date.now();
      zooming.value = false;
      reportView();
    },
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

  const tap = useTapGesture({
    maxDistance: 8,
    maxDuration: 250,
    onActivate: (e) => {
      'worklet';
      if (e.numberOfPointers > 1 || Date.now() - lastMoveAt.value < TAP_COOLDOWN_MS) return;
      scheduleOnRN(onTap, (e.x - tx.value) / scale.value, (e.y - ty.value) / scale.value);
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
            <TileLayer world={world} layers={layers} listener={tileListener} territory={territory} />
            {selection &&
              [0, 1].map((copy) => (
                <Group key={`s${copy}`} transform={[{ translateX: copy * mapWidth }]}>
                  <Path path={selection} style="stroke" strokeWidth={3} color={SELECTION_COLOR} />
                </Group>
              ))}
          </Group>
        </Canvas>
      </GestureDetector>
      <MapPerfMeter tx={tx} ty={ty} scale={scale} mapWidth={mapWidth} />
    </View>
  );
});

const tilePaint = Skia.Paint();

/**
 * Territory tiles are semi-transparent, so unlike the opaque terrain tiles
 * they must not overlap: a strip drawn twice would show darker. Each image is
 * drawn exactly into its own tile; its bleed pixels only feed the smoothing
 * at the edges.
 */
function territoryPicture(tiles: readonly (readonly [TileRef, SkImage | null])[]) {
  return createPicture((canvas) => {
    for (const [t, image] of tiles) {
      if (!image) continue;
      const sx = image.width() / (CHUNK_W + 2 * TILE_BLEED);
      const sy = image.height() / (CHUNK_H + 2 * TILE_BLEED);
      const src = Skia.XYWHRect(TILE_BLEED * sx, TILE_BLEED * sy, CHUNK_W * sx, CHUNK_H * sy);
      const dst = Skia.XYWHRect(t.col * CHUNK_W + t.offsetX, t.row * CHUNK_H, CHUNK_W, CHUNK_H);
      canvas.drawImageRect(image, src, dst, tilePaint, true);
    }
  });
}

type TileLayerProps = {
  world: World;
  layers: WorldLayers;
  listener: { current: (view: ViewTiles) => void };
  territory: TerritorySource;
};

/**
 * The detail tile images near the screen and the territories above them.
 * Owns the visible-tile state and follows the society snapshot, so only it
 * re-renders. Tiles not rendered yet at the current tier show a ready tier
 * meanwhile, or the overview image underneath; after a new snapshot the old
 * territory tiles stay until the new ones are ready.
 */
const TileLayer = memo(function TileLayer({ world, layers, listener, territory }: TileLayerProps) {
  countEvent('tileLayerRenders');
  const [view, setView] = useState<ViewTiles>(NO_TILES);
  const [, setReady] = useState(0);
  listener.current = setView;
  const onReady = useCallback(() => setReady((n) => n + 1), []);
  const scales = useMemo(() => TIER_ZOOMS.map((zoom) => zoom * PixelRatio.get()), []);

  const terrainTiles = useMemo(
    () =>
      new TileImages(
        (chunk, px) => {
          countEvent('terrainTiles');
          return renderTile(world, chunk, layers.chunkCols, px);
        },
        null,
        scales,
        onReady,
      ),
    [world, layers, scales, onReady],
  );
  const territoryTiles = useMemo(
    () =>
      new TileImages(
        (chunk, px) => {
          countEvent('territoryTiles');
          return renderTerritoryTile(world, chunk, layers.chunkCols, px, territory.civColor);
        },
        (chunk) => territoryTileSignature(world, chunk, layers.chunkCols, territory.civColor),
        scales.map((s) => s * TERRITORY_TILE_RESOLUTION),
        onReady,
      ),
    [world, layers, scales, onReady, territory],
  );
  useEffect(() => () => terrainTiles.dispose(), [terrainTiles]);
  useEffect(() => () => territoryTiles.dispose(), [territoryTiles]);

  const version = useSyncExternalStore(territory.subscribe, territory.getVersion);
  // Runs before the request below, so the visible territory tiles are redone.
  useEffect(() => territoryTiles.invalidate(), [territoryTiles, version]);
  useEffect(() => {
    const wanted = visibleTiles(view, layers, PREFETCH_TILES).map((t) => ({ ...t, tier: view.tier }));
    terrainTiles.want(wanted);
    territoryTiles.want(wanted);
  }, [terrainTiles, territoryTiles, view, layers, version]);

  // Zoomed out, territories are one image, rebuilt per snapshot only while shown.
  const overview = useMemo(() => {
    if (view.detail) return null;
    const t0 = performance.now();
    const built = buildTerritoryOverview(world, territory.civColor, layers);
    recordMapBuild(performance.now() - t0);
    countEvent('territoryOverviews');
    return built;
    // `version` stands in for the world's mutable society arrays.
  }, [world, layers, territory, version, view.detail]);

  const tiles = visibleTiles(view, layers);
  const tileImage = (key: string, image: SkImage | null, t: (typeof tiles)[number]) =>
    image && (
      <Image
        key={key}
        image={image}
        x={t.col * CHUNK_W + t.offsetX - TILE_BLEED}
        y={t.row * CHUNK_H - TILE_BLEED}
        width={CHUNK_W + 2 * TILE_BLEED}
        height={CHUNK_H + 2 * TILE_BLEED}
        fit="fill"
      />
    );
  return (
    <>
      {tiles.map((t) => tileImage(`g${t.key}`, terrainTiles.get(t.chunk, view.tier), t))}
      <Picture picture={territoryPicture(tiles.map((t) => [t, territoryTiles.get(t.chunk, view.tier)] as const))} />
      {overview &&
        [0, 1].map((copy) => (
          <Image
            key={`t${copy}`}
            image={overview.overview}
            x={overview.overviewRect.x + copy * layers.width}
            y={overview.overviewRect.y}
            width={overview.overviewRect.width}
            height={overview.overviewRect.height}
            fit="fill"
          />
        ))}
    </>
  );
});

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

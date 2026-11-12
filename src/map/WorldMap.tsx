import { Canvas, Group, Image, Path, Picture, Skia, createPicture, type SkImage, type SkPaint, type SkPicture } from '@shopify/react-native-skia';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import type { Swipe, SwipeStats } from '../bench/benchmark';
import { cellAtPoint, hexCenterX, hexCenterY, type World } from '../sim';
import { countEvent, logWork, recordMapBuild } from '../state/perfStats';
import { setMapMoving } from '../state/worldStore';
import { CHUNK_H, CHUNK_W, HEX_PX } from './mapGeometry';
import { ArmySprites, buildArmyPicture, type ArmyMarkers } from './armyLayer';
import { MapPerfMeter } from './MapPerfMeter';
import { uiArmySwaps, uiTileDraws } from './uiCounters';
import { SELECTION_COLOR } from './palette';
import {
  buildTerritoryOverview,
  renderTerritoryTile,
  TERRITORY_TILE_RESOLUTION,
  territoryTileSignature,
  type MapWar,
} from './territoryLayers';
import { TileImages } from './tileImages';
import { sameViewTiles, TIER_ZOOMS, viewTiles, visibleTiles, type ViewTiles } from './viewport';
import { buildWorldLayers, renderTile, TILE_BLEED, type WorldLayers } from './worldPicture';

const MAX_SCALE = 3;
const START_SCALE = 1;
/** A tap right after dragging or pinching is almost always a finger lifting off, not a tap. */
const TAP_COOLDOWN_MS = 300;
/** The map rests once it hasn't moved for this long (outdated tiles are redone then, see TileImages.setResting). */
const REST_MS = 100;
/** A benchmark swipe's frame record (UI thread): totals, the worst frame and when it ended after `t0`, what the UI drew in it. */
const NO_BENCH_SWIPE = {
  active: false,
  frames: 0,
  timeMs: 0,
  worstMs: 0,
  t0: 0,
  worstEnd: 0,
  worstDraws: 0,
  worstSwaps: 0,
  draws: 0,
  swaps: 0,
  // The UI runtime's own garbage collections (they stop the UI thread): totals at the swipe's start and at the last frame, and in the worst frame.
  gc0: 0,
  gcMs0: 0,
  gc: 0,
  gcMs: 0,
  worstGc: 0,
  worstGcMs: 0,
  // How long after a frame's time its callback ran (the two clocks may differ by a constant: the shortest of the swipe is the base).
  worstLate: 0,
  minLate: 0,
};
/** Frames longer than this count as long for the benchmark's diagnostics (a frame is 16.7 ms). */
const LONG_FRAME_MS = 20;
type HermesGlobals = { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> }; gc?: () => void };
/** Memory for territory tile images (the terrain tiles have their own, see tileImages.ts). */
const TERRITORY_BUDGET_BYTES = 40 * 1024 * 1024;
/** Slower releases just stop; faster ones let the map glide on. */
const MIN_FLING_VELOCITY = 150;
/** Lifting the fingers after a pinch reports a pan velocity that isn't a fling. */
const FLING_AFTER_PINCH_MS = 150;
const NO_TILES: ViewTiles = { x0: 0, x1: -1, y0: 0, y1: -1, detail: false, tier: 0 };
/** Rings of tiles around the screen rendered ahead, so panning finds them ready. */
const PREFETCH_TILES = 1;
/**
 * Tile images first drawn ahead of time per frame (see TileLayer): each is
 * uploaded to the GPU when first drawn, which otherwise happens all at once
 * when the view crosses into the prefetched ring (a diagonal swipe reveals a
 * row and a column of tiles, both layers, in one frame).
 */
const WARM_PER_FRAME = 2;

/**
 * Where the territory layer gets the society snapshot from: an external
 * store (as for useSyncExternalStore) whose version changes with every new
 * snapshot, plus each civilization's color. Should be stable per world.
 */
export type TerritorySource = {
  subscribe: (listener: () => void) => () => void;
  getVersion: () => number;
  civColor: (civ: number) => string;
  /** Wars and sieges as of the current snapshot (red dashed borders, siege frames). */
  war: MapWar;
  /** Army markers: their own store, as armies move weekly, between snapshots. */
  armies: {
    subscribe: (listener: () => void) => () => void;
    getVersion: () => number;
    markers: ArmyMarkers;
  };
};

/** Drives the map from code, for the performance benchmark. */
export type MapController = {
  /** Zooms to `scale` and centers the map. */
  zoomToCenter: (scale: number) => void;
  /** Centers the map on a hex, zooming in to at least START_SCALE (e.g. "Go to" in the chronicle). */
  centerOn: (cell: number) => void;
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
  // Told when the map starts moving and when it rests again (outdated tiles are redone while it rests).
  const restListener = useRef<(resting: boolean) => void>(() => {});
  const onRest = useCallback((resting: boolean) => {
    restListener.current(resting);
    // Long simulation parts and snapshots wait while the map moves (worldStore).
    setMapMoving(!resting);
  }, []);
  const moving = useSharedValue(false);
  /** The map moved in this frame (UI thread). */
  const moved = () => {
    'worklet';
    lastMoveAt.value = Date.now();
    if (moving.value) return;
    moving.value = true;
    scheduleOnRN(onRest, false);
  };

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
    const x = wrapX(viewW / 2 - hexCenterX(col) * HEX_PX * START_SCALE, mapWidth * START_SCALE);
    const y = clampY(viewH / 2 - hexCenterY(col, row) * HEX_PX * START_SCALE, mapHeight * START_SCALE, viewH);
    // Placed and reported on the UI thread, the same way as every later view
    // change, so the tile layer gets the first view exactly like a movement.
    scheduleOnUI(
      (startX: number, startY: number, w: number, h: number) => {
        'worklet';
        scale.value = START_SCALE;
        tx.value = startX;
        ty.value = startY;
        const next = viewTiles(startX, startY, START_SCALE, w, h, null);
        lastView.value = next;
        scheduleOnRN(onViewChange, next);
      },
      x,
      y,
      viewW,
      viewH,
    );
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
      moved();
      reportView();
    },
    [mapWidth, mapHeight, viewW, viewH],
  );

  // Benchmark swipes: frames are counted on the UI thread while one runs.
  const benchSwipe = useSharedValue({ ...NO_BENCH_SWIPE });
  // Times the swipe on its own: an animation of an offset that doesn't change
  // (dx = 0 for a north swipe) would end at once.
  const benchClock = useSharedValue(0);
  const swipeDone = useRef<(stats: SwipeStats) => void>(() => {});
  const onSwipeDone = useCallback((stats: SwipeStats) => swipeDone.current(stats), []);
  useFrameCallback((frame) => {
    'worklet';
    const hermes = globalThis as HermesGlobals;
    if (moving.value && Date.now() - lastMoveAt.value >= REST_MS) {
      moving.value = false;
      scheduleOnRN(onRest, true);
    }
    const dt = frame.timeSincePreviousFrame;
    if (!benchSwipe.value.active || dt === null) return;
    const draws = uiTileDraws.value;
    const swaps = uiArmySwaps.value;
    // The runtime's collections so far, read only at the swipe's first frame and at long frames (reading allocates).
    const first = benchSwipe.value.frames === 0;
    const long = dt > LONG_FRAME_MS;
    const stats = first || long ? hermes.HermesInternal?.getInstrumentedStats?.() : undefined;
    const gc = stats?.js_numGCs ?? 0;
    const gcMs = (stats?.js_gcTime ?? 0) * 1000;
    const clock = (globalThis as { performance?: { now?: () => number } }).performance;
    const late = clock?.now ? clock.now() - frame.timestamp : 0;
    benchSwipe.modify((b) => {
      'worklet';
      if (first) {
        b.t0 = frame.timestamp - dt;
        b.gc0 = gc;
        b.gcMs0 = gcMs;
        b.gc = gc;
        b.gcMs = gcMs;
        b.minLate = late;
      }
      if (late < b.minLate) b.minLate = late;
      b.frames += 1;
      b.timeMs += dt;
      if (dt > b.worstMs) {
        b.worstMs = dt;
        b.worstEnd = frame.timestamp - b.t0;
        b.worstDraws = draws - b.draws;
        b.worstSwaps = swaps - b.swaps;
        // Collections since the swipe began or its last long frame, whichever is later.
        b.worstGc = long ? gc - b.gc : 0;
        b.worstGcMs = long ? gcMs - b.gcMs : 0;
        b.worstLate = late;
      }
      b.draws = draws;
      b.swaps = swaps;
      if (long) {
        b.gc = gc;
        b.gcMs = gcMs;
      }
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
      centerOn: (cell) => {
        const col = cell % world.width;
        const px = hexCenterX(col) * HEX_PX;
        const py = hexCenterY(col, Math.floor(cell / world.width)) * HEX_PX;
        scheduleOnUI(() => {
          'worklet';
          stopGlide();
          const z = Math.max(scale.value, START_SCALE);
          scale.value = z;
          tx.value = wrapX(viewW / 2 - px * z, mapWidth * z);
          ty.value = clampY(viewH / 2 - py * z, mapHeight * z, viewH);
          reportView();
        });
      },
      swipe: ({ dx, dy, durationMs }) =>
        new Promise((resolve) => {
          swipeDone.current = resolve;
          scheduleOnUI(() => {
            'worklet';
            benchSwipe.value = { ...NO_BENCH_SWIPE, active: true, draws: uiTileDraws.value, swaps: uiArmySwaps.value };
            // Ignore the system's reduce-motion setting (off on CI emulators),
            // which would otherwise end the swipe at once.
            const timing = { duration: durationMs, easing: Easing.linear, reduceMotion: ReduceMotion.Never };
            glideY.value = withTiming(glideY.value + dy, timing);
            glideX.value = withTiming(glideX.value + dx, timing);
            benchClock.value = 0;
            benchClock.value = withTiming(1, timing, () => {
              const b = benchSwipe.value;
              benchSwipe.value = { ...b, active: false };
              const end = (globalThis as HermesGlobals).HermesInternal?.getInstrumentedStats?.();
              scheduleOnRN(onSwipeDone, {
                frames: b.frames,
                timeMs: b.timeMs,
                worstMs: b.worstMs,
                worstStartMs: b.worstEnd - b.worstMs,
                worstEndMs: b.worstEnd,
                worstTileDraws: b.worstDraws,
                worstArmySwaps: b.worstSwaps,
                uiGcCount: (end?.js_numGCs ?? b.gc0) - b.gc0,
                uiGcMs: (end?.js_gcTime ?? 0) * 1000 - (end ? b.gcMs0 : 0),
                worstUiGcCount: b.worstGc,
                worstUiGcMs: b.worstGcMs,
                worstCallbackLateMs: b.worstLate - b.minLate,
              });
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
      moved();
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
      moved();
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
            <TileLayer
              world={world}
              layers={layers}
              listener={tileListener}
              restListener={restListener}
              territory={territory}
            />
            <ArmyLayer world={world} mapWidth={mapWidth} territory={territory} />
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

type TileLayerProps = {
  world: World;
  layers: WorldLayers;
  listener: { current: (view: ViewTiles) => void };
  /** Set by the tile layer: called when the map starts moving (false) and rests again (true). */
  restListener: { current: (resting: boolean) => void };
  territory: TerritorySource;
};

const EMPTY_PICTURE = createPicture(() => {});

/**
 * The detail tile images near the screen and the territories above them,
 * as one picture of the view's tiles plus a ring around it. The JS thread
 * records it whenever the view crosses a tile border or new tiles are ready
 * and hands it to the UI thread, which only replays it: the UI thread's own
 * JS runtime never holds the tile images (each would count with its full
 * size towards that runtime's garbage collections, which stop the UI thread)
 * and allocates nothing for the tiles. Moving the map never re-renders React.
 *
 * The JS thread renders tiles in the background and publishes the finished
 * ones for the view plus a ring around it (PREFETCH_TILES), so tiles coming
 * into view are usually there already. New society snapshots and new tiles
 * only update that set. Tiles not rendered yet at the current tier show a
 * ready tier meanwhile, or the overview image underneath; after a snapshot
 * the old territory tiles stay until the new ones are ready.
 */
const TileLayer = memo(function TileLayer({ world, layers, listener, restListener, territory }: TileLayerProps) {
  countEvent('tileLayerRenders');
  const picture = useSharedValue<SkPicture>(EMPTY_PICTURE);
  const warmPicture = useSharedValue<SkPicture>(EMPTY_PICTURE);
  /** Pictures handed to the UI thread, oldest first, to free the replaced ones (see show). */
  const shown = useRef<{ picture: SkPicture; at: number }[]>([]);
  const shownWarm = useRef<{ picture: SkPicture; at: number }[]>([]);
  /** Tile images the GPU has (drawn on screen or ahead), those still to draw ahead, and the ones in the current warm-up picture. */
  const uploaded = useRef(new WeakSet<SkImage>());
  const pending = useRef<SkImage[]>([]);
  const warming = useRef<SkImage[]>([]);
  const warmFrame = useRef<number | null>(null);
  const overviewRect = layers.overviewRect;
  const current = useRef<ViewTiles>(NO_TILES);
  const publish = useRef<() => void>(() => {});
  const onReady = useCallback(() => publish.current(), []);
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
        undefined,
        'terrain',
      ),
    [world, layers, scales, onReady],
  );
  const territoryTiles = useMemo(
    () =>
      new TileImages(
        (chunk, px) => {
          countEvent('territoryTiles');
          return renderTerritoryTile(world, chunk, layers.chunkCols, px, territory.civColor, territory.war);
        },
        (chunk) => territoryTileSignature(world, chunk, layers.chunkCols, territory.civColor, territory.war),
        scales.map((s) => s * TERRITORY_TILE_RESOLUTION),
        onReady,
        // Out-of-view tiles are kept through snapshots (see TileImages.invalidate): a smaller budget than the terrain's.
        TERRITORY_BUDGET_BYTES,
        'territory',
      ),
    [world, layers, scales, onReady, territory],
  );
  useEffect(() => () => terrainTiles.dispose(), [terrainTiles]);
  useEffect(() => () => territoryTiles.dispose(), [territoryTiles]);
  restListener.current = (resting) => {
    terrainTiles.setResting(resting);
    territoryTiles.setResting(resting);
  };

  // Zoomed out, territories are one image, rebuilt per snapshot only while shown.
  const overview = useRef<{ version: number; image: SkImage } | null>(null);
  const overviewFor = (version: number): SkImage => {
    if (overview.current?.version !== version) {
      const t0 = performance.now();
      const built = buildTerritoryOverview(world, territory.civColor, layers, territory.war);
      recordMapBuild(performance.now() - t0);
      countEvent('territoryOverviews');
      overview.current = { version, image: built.overview };
    }
    return overview.current.image;
  };

  publish.current = () => {
    const v = current.current;
    const t0 = performance.now();
    // The images to draw ahead are those of this picture's ring (earlier ones may have been replaced and freed).
    pending.current.length = 0;
    const next = createPicture((canvas) => {
      if (!v.detail) {
        // Zoomed out: territories as one image. Two copies cover any view: the offset stays within one map width.
        const image = overviewFor(territory.getVersion());
        const src = Skia.XYWHRect(0, 0, image.width(), image.height());
        for (let copy = 0; copy < 2; copy++) {
          const dst = Skia.XYWHRect(overviewRect.x + copy * layers.width, overviewRect.y, overviewRect.width, overviewRect.height);
          canvas.drawImageRect(image, src, dst, tilePaint(), true);
        }
        return;
      }
      const tiles = visibleTiles(v, layers, PREFETCH_TILES);
      const seen = visibleTiles(v, layers);
      const onScreen = new Set<number>();
      for (const t of seen) onScreen.add(t.chunk);
      // An image on screen is drawn (and uploaded to the GPU) with this picture; one in the ring is drawn ahead (warmUp).
      const note = (image: SkImage, chunk: number) => {
        if (onScreen.has(chunk)) uploaded.current.add(image);
        else if (!uploaded.current.has(image) && pending.current.indexOf(image) < 0) pending.current.push(image);
      };
      // Terrain tiles are opaque and overlap by their bleed, so no seam shows.
      for (const t of tiles) {
        const image = terrainTiles.get(t.chunk, v.tier);
        if (!image) continue;
        note(image, t.chunk);
        const src = Skia.XYWHRect(0, 0, image.width(), image.height());
        const dst = Skia.XYWHRect(
          t.col * CHUNK_W + t.offsetX - TILE_BLEED,
          t.row * CHUNK_H - TILE_BLEED,
          CHUNK_W + 2 * TILE_BLEED,
          CHUNK_H + 2 * TILE_BLEED,
        );
        canvas.drawImageRect(image, src, dst, tilePaint(), true);
      }
      // Territory tiles are semi-transparent and must not overlap (a strip
      // drawn twice would show darker): each is drawn exactly into its tile,
      // its bleed pixels only feed the smoothing at the edges.
      for (const t of tiles) {
        const image = territoryTiles.get(t.chunk, v.tier);
        if (!image) continue;
        note(image, t.chunk);
        const sx = image.width() / (CHUNK_W + 2 * TILE_BLEED);
        const sy = image.height() / (CHUNK_H + 2 * TILE_BLEED);
        const src = Skia.XYWHRect(TILE_BLEED * sx, TILE_BLEED * sy, CHUNK_W * sx, CHUNK_H * sy);
        const dst = Skia.XYWHRect(t.col * CHUNK_W + t.offsetX, t.row * CHUNK_H, CHUNK_W, CHUNK_H);
        canvas.drawImageRect(image, src, dst, tilePaint(), true);
      }
    });
    logWork('tile picture', t0, performance.now() - t0);
    scheduleOnUI((p: SkPicture) => {
      'worklet';
      uiTileDraws.value += 1;
      picture.value = p;
    }, next);
    keepPicture(next, shown.current);
    if (pending.current.length > 0 && warmFrame.current === null) warmFrame.current = requestAnimationFrame(warmUp);
  };
  /**
   * Images in the ring around the view, not drawn yet: WARM_PER_FRAME of
   * them per frame are drawn as an invisible dot in the middle of the view,
   * so the GPU uploads them now instead of when they come into view. Each
   * stays for two pictures in a row, in case the UI thread skips one.
   */
  const warmUp = () => {
    warmFrame.current = null;
    const batch = pending.current.splice(0, WARM_PER_FRAME);
    const before = warming.current;
    warming.current = batch;
    const v = current.current;
    let next = EMPTY_PICTURE;
    if (batch.length + before.length > 0) {
      try {
        next = createPicture((canvas) => {
          const dst = Skia.XYWHRect(((v.x0 + v.x1 + 1) / 2) * CHUNK_W, ((v.y0 + v.y1 + 1) / 2) * CHUNK_H, 0.5, 0.5);
          for (const image of [...before, ...batch]) {
            canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), dst, faintPaint(), true);
          }
        });
        for (const image of batch) uploaded.current.add(image);
      } catch {
        // An image was replaced and freed meanwhile: the next tile picture lists what is still to draw ahead.
        warming.current = [];
        pending.current.length = 0;
        next = EMPTY_PICTURE;
      }
    }
    scheduleOnUI((p: SkPicture) => {
      'worklet';
      warmPicture.value = p;
    }, next);
    keepPicture(next, shownWarm.current);
    if (batch.length > 0) warmFrame.current = requestAnimationFrame(warmUp);
  };
  useEffect(
    () => () => {
      if (warmFrame.current !== null) cancelAnimationFrame(warmFrame.current);
      warmFrame.current = null;
      pending.current = [];
      warming.current = [];
    },
    [terrainTiles, territoryTiles],
  );
  listener.current = (v) => {
    current.current = v;
    const wanted = visibleTiles(v, layers, PREFETCH_TILES).map((t) => ({ ...t, tier: v.tier }));
    terrainTiles.want(wanted);
    territoryTiles.want(wanted);
    publish.current();
  };

  // A new world or tile cache: start over from the current view.
  useEffect(() => {
    overview.current = null;
    listener.current(current.current);
  }, [terrainTiles, territoryTiles, listener]);

  // New society snapshots: redo the territory tiles that look different.
  useEffect(() => {
    let seen = territory.getVersion();
    return territory.subscribe(() => {
      const version = territory.getVersion();
      if (version === seen) return;
      seen = version;
      const t0 = performance.now();
      territoryTiles.invalidate();
      listener.current(current.current);
      logWork('tile check (snapshot)', t0, performance.now() - t0);
    });
  }, [territory, territoryTiles, listener]);

  return (
    <>
      <Picture picture={picture} />
      <Picture picture={warmPicture} />
    </>
  );
});

/** Paints for the tile pictures, made once: plain, and nearly invisible for the images drawn ahead. */
let plainPaint: SkPaint | null = null;
const tilePaint = () => (plainPaint ??= Skia.Paint());
let dotPaint: SkPaint | null = null;
function faintPaint(): SkPaint {
  if (!dotPaint) {
    dotPaint = Skia.Paint();
    dotPaint.setAlphaf(1 / 255);
  }
  return dotPaint;
}

/** A picture's earlier versions are freed this long after they were replaced (they hold their tile images' memory). */
const PICTURE_KEEP_MS = 1000;

/**
 * Notes a picture handed to the UI thread and frees the ones it replaced
 * once they can no longer be on screen: never the latest two, and only
 * PICTURE_KEEP_MS after their successor was shown.
 */
function keepPicture(next: SkPicture, earlier: { picture: SkPicture; at: number }[]) {
  const now = Date.now();
  while (earlier.length > 2 && now - earlier[1].at >= PICTURE_KEEP_MS) {
    const old = earlier.shift()!;
    if (old.picture !== EMPTY_PICTURE) old.picture.dispose();
  }
  earlier.push({ picture: next, at: now });
}

/**
 * The army markers above the territories: one small picture (at most 32
 * markers, both map copies), recorded on the JS thread when an army moved
 * and handed to the UI thread, which only replays it in a frame.
 */
const ArmyLayer = memo(function ArmyLayer({ world, mapWidth, territory }: { world: World; mapWidth: number; territory: TerritorySource }) {
  const picture = useSharedValue<SkPicture>(EMPTY_PICTURE);
  useEffect(() => {
    const { armies, civColor } = territory;
    // Sprites as sharp as the closest zoom tier, made before the first army appears.
    const sprites = new ArmySprites(TIER_ZOOMS[TIER_ZOOMS.length - 1] * PixelRatio.get());
    let seen = -1;
    const update = () => {
      const version = armies.getVersion();
      if (version === seen) return;
      seen = version;
      const t0 = performance.now();
      const next = buildArmyPicture(world, armies.markers, civColor, mapWidth, sprites);
      logWork('army picture', t0, performance.now() - t0);
      countEvent('armyPictures');
      scheduleOnUI((p: SkPicture) => {
        'worklet';
        uiArmySwaps.value += 1;
        picture.value = p;
      }, next);
    };
    update();
    const unsubscribe = armies.subscribe(update);
    // The sprites are a few small images: the garbage collector frees them with the last picture using them.
    return unsubscribe;
  }, [world, mapWidth, territory, picture]);
  return <Picture picture={picture} />;
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

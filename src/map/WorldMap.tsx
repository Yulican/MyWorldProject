import { Canvas, Group, Image, Path, Picture, Skia, createPicture, type SkImage, type SkPicture } from '@shopify/react-native-skia';
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
import { sameViewTiles, TIER_ZOOMS, viewTiles, visibleTiles, type ViewTiles } from './viewport';
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
            <TileLayer world={world} layers={layers} listener={tileListener} territory={territory} view={lastView} />
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
  territory: TerritorySource;
  /** The current view, kept on the UI thread by the gestures. */
  view: SharedValue<ViewTiles>;
};

/** Finished images the UI thread may draw, by tile, for the current zoom tier. */
type TileSet = {
  terrain: Record<number, SkImage>;
  territory: Record<number, SkImage>;
  /** Zoomed out: territories as one image. */
  overview: SkImage | null;
};
const EMPTY_TILE_SET: TileSet = { terrain: {}, territory: {}, overview: null };
const EMPTY_PICTURE = createPicture(() => {});

/**
 * The detail tile images near the screen and the territories above them,
 * drawn as one picture that the UI thread records again whenever the view
 * crosses a tile border, so moving the map never re-renders React.
 *
 * The JS thread renders tiles in the background and publishes the finished
 * ones for the view plus a ring around it (PREFETCH_TILES), so tiles coming
 * into view are usually there already. New society snapshots and new tiles
 * only update that set. Tiles not rendered yet at the current tier show a
 * ready tier meanwhile, or the overview image underneath; after a snapshot
 * the old territory tiles stay until the new ones are ready.
 */
const TileLayer = memo(function TileLayer({ world, layers, listener, territory, view }: TileLayerProps) {
  countEvent('tileLayerRenders');
  const tileSet = useSharedValue<TileSet>(EMPTY_TILE_SET);
  const picture = useSharedValue<SkPicture>(EMPTY_PICTURE);
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

  // Zoomed out, territories are one image, rebuilt per snapshot only while shown.
  const overview = useRef<{ version: number; image: SkImage } | null>(null);
  const overviewFor = (version: number): SkImage => {
    if (overview.current?.version !== version) {
      const t0 = performance.now();
      const built = buildTerritoryOverview(world, territory.civColor, layers);
      recordMapBuild(performance.now() - t0);
      countEvent('territoryOverviews');
      overview.current = { version, image: built.overview };
    }
    return overview.current.image;
  };

  publish.current = () => {
    const v = current.current;
    const set: TileSet = { terrain: {}, territory: {}, overview: null };
    if (v.detail) {
      for (const t of visibleTiles(v, layers, PREFETCH_TILES)) {
        const ground = terrainTiles.get(t.chunk, v.tier);
        if (ground) set.terrain[t.chunk] = ground;
        const people = territoryTiles.get(t.chunk, v.tier);
        if (people) set.territory[t.chunk] = people;
      }
    } else {
      set.overview = overviewFor(territory.getVersion());
    }
    showTiles(set);
  };
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
      territoryTiles.invalidate();
      listener.current(current.current);
    });
  }, [territory, territoryTiles, listener]);

  const grid = { width: layers.width, chunkCols: layers.chunkCols, chunkRows: layers.chunkRows };
  const overviewRect = layers.overviewRect;
  /** Records the tile picture for a view and image set (UI thread). */
  const draw = (v: ViewTiles, set: TileSet) => {
    'worklet';
    picture.value = createPicture((canvas) => {
      const paint = Skia.Paint();
      if (!v.detail) {
        const image = set.overview;
        if (!image) return;
        const src = Skia.XYWHRect(0, 0, image.width(), image.height());
        // Two copies cover any view: the offset stays within one map width.
        for (let copy = 0; copy < 2; copy++) {
          const dst = Skia.XYWHRect(overviewRect.x + copy * grid.width, overviewRect.y, overviewRect.width, overviewRect.height);
          canvas.drawImageRect(image, src, dst, paint, true);
        }
        return;
      }
      const tiles = visibleTiles(v, grid);
      // Terrain tiles are opaque and overlap by their bleed, so no seam shows.
      for (const t of tiles) {
        const image = set.terrain[t.chunk];
        if (!image) continue;
        const src = Skia.XYWHRect(0, 0, image.width(), image.height());
        const dst = Skia.XYWHRect(
          t.col * CHUNK_W + t.offsetX - TILE_BLEED,
          t.row * CHUNK_H - TILE_BLEED,
          CHUNK_W + 2 * TILE_BLEED,
          CHUNK_H + 2 * TILE_BLEED,
        );
        canvas.drawImageRect(image, src, dst, paint, true);
      }
      // Territory tiles are semi-transparent and must not overlap (a strip
      // drawn twice would show darker): each is drawn exactly into its tile,
      // its bleed pixels only feed the smoothing at the edges.
      for (const t of tiles) {
        const image = set.territory[t.chunk];
        if (!image) continue;
        const sx = image.width() / (CHUNK_W + 2 * TILE_BLEED);
        const sy = image.height() / (CHUNK_H + 2 * TILE_BLEED);
        const src = Skia.XYWHRect(TILE_BLEED * sx, TILE_BLEED * sy, CHUNK_W * sx, CHUNK_H * sy);
        const dst = Skia.XYWHRect(t.col * CHUNK_W + t.offsetX, t.row * CHUNK_H, CHUNK_W, CHUNK_H);
        canvas.drawImageRect(image, src, dst, paint, true);
      }
    });
  };

  // Redraw when the view crosses a tile border (gestures, UI thread)...
  useAnimatedReaction(
    () => view.value,
    (v) => draw(v, tileSet.value),
  );
  // ...and when JS hands over new images: applied and drawn on the UI thread
  // right away, without waiting for the next movement.
  function showTiles(set: TileSet) {
    scheduleOnUI((next: TileSet) => {
      'worklet';
      tileSet.value = next;
      draw(view.value, next);
    }, set);
  }

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

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { addFrame, newMotionStats, summarize, wrappedDelta, type MotionSummary } from './motionStats';

/** How often the live line updates. */
const WINDOW_MS = 500;
/** A movement ends after this long without the map moving. */
const MOVE_GAP_MS = 150;
/** Smoothing of the speed readout; touch events don't line up with frames. */
const SPEED_SMOOTHING_MS = 80;

type Live = { uiFps: number; worstMs: number; missedPct: number; speed: number; scale: number };

type Props = {
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  scale: SharedValue<number>;
  mapWidth: number;
};

/**
 * Performance readout for test builds, measured on the UI thread where
 * gestures and the map are drawn:
 * - Live: frames per second, slowest frame, missed frames and map speed.
 * - Last move: the same, only over the frames of the last pan or glide
 *   (zooming excluded), so idle frames don't hide stutter. Use this as the
 *   benchmark: e.g. "missed < 5% at 3000 pt/s".
 */
export function MapPerfMeter({ tx, ty, scale, mapWidth }: Props) {
  const [live, setLive] = useState<Live | null>(null);
  const [last, setLast] = useState<MotionSummary | null>(null);
  const [jsFps, setJsFps] = useState(0);

  const prev = useSharedValue({ tx: 0, ty: 0, scale: 0 });
  const speed = useSharedValue(0);
  const win = useSharedValue(newMotionStats());
  const move = useSharedValue(newMotionStats());
  /** Frames since the map last moved; added to the move if it continues. */
  const pause = useSharedValue(newMotionStats());
  const moving = useSharedValue(false);
  /** Shortest frame interval seen so far: the display's refresh interval. */
  const refresh = useSharedValue(Infinity);

  useFrameCallback((frame) => {
    'worklet';
    const dt = frame.timeSincePreviousFrame;
    const p = prev.value;
    const s = scale.value;
    const zoomed = s !== p.scale;
    const dx = wrappedDelta(tx.value - p.tx, mapWidth * s);
    const dy = ty.value - p.ty;
    prev.value = { tx: tx.value, ty: ty.value, scale: s };
    if (dt === null || dt <= 0) return;
    if (dt < refresh.value) refresh.value = dt;

    const distance = zoomed ? 0 : Math.hypot(dx, dy);
    const k = 1 - Math.exp(-dt / SPEED_SMOOTHING_MS);
    speed.value += ((distance * 1000) / dt - speed.value) * k;

    win.modify((w) => {
      'worklet';
      addFrame(w, dt, distance, speed.value);
      if (w.timeMs >= WINDOW_MS) {
        const sum = summarize(w, refresh.value);
        scheduleOnRN(setLive, {
          uiFps: sum.fps,
          worstMs: sum.worstMs,
          missedPct: sum.missedPct,
          speed: speed.value,
          scale: s,
        });
        return newMotionStats();
      }
      return w;
    }, false);

    if (distance > 0) {
      // Frames without movement inside a move belong to it (touch events can
      // skip a frame), so fold the pause back in.
      const gap = pause.value;
      move.modify((m) => {
        'worklet';
        if (moving.value && gap.frames > 0) {
          m.frames += gap.frames;
          m.timeMs += gap.timeMs;
          m.minMs = Math.min(m.minMs, gap.minMs);
          m.worstMs = Math.max(m.worstMs, gap.worstMs);
        }
        addFrame(m, dt, distance, speed.value);
        return m;
      }, false);
      pause.value = newMotionStats();
      moving.value = true;
    } else if (moving.value) {
      pause.modify((g) => {
        'worklet';
        addFrame(g, dt, 0, 0);
        return g;
      }, false);
      if (pause.value.timeMs >= MOVE_GAP_MS) {
        scheduleOnRN(setLast, summarize(move.value, refresh.value));
        move.value = newMotionStats();
        pause.value = newMotionStats();
        moving.value = false;
      }
    }
  });

  // JavaScript thread frame rate (React renders, tile updates).
  useEffect(() => {
    let id = 0;
    let frames = 0;
    let start = performance.now();
    const onFrame = (now: number) => {
      frames++;
      if (now - start >= WINDOW_MS) {
        setJsFps((frames * 1000) / (now - start));
        frames = 0;
        start = now;
      }
      id = requestAnimationFrame(onFrame);
    };
    id = requestAnimationFrame(onFrame);
    return () => cancelAnimationFrame(id);
  }, []);

  if (!live) return null;
  return (
    <View style={styles.box} pointerEvents="none">
      <Text style={styles.text}>
        UI {live.uiFps.toFixed(0)} fps · worst {live.worstMs.toFixed(0)} ms · missed {live.missedPct.toFixed(0)}% · JS{' '}
        {jsFps.toFixed(0)} fps
      </Text>
      <Text style={styles.text}>
        Speed {live.speed.toFixed(0)} pt/s · zoom {live.scale.toFixed(2)}×
      </Text>
      {last && (
        <Text style={styles.text}>
          Last move {(last.durationMs / 1000).toFixed(1)} s · avg {last.avgSpeed.toFixed(0)} / peak{' '}
          {last.peakSpeed.toFixed(0)} pt/s · {last.fps.toFixed(0)} fps · missed {last.missedPct.toFixed(0)}% · worst{' '}
          {last.worstMs.toFixed(0)} ms
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  text: { color: '#d8f5d0', fontSize: 10, fontVariant: ['tabular-nums'] },
});

// Frame and speed statistics for the on-screen performance meter. Plain
// functions on a mutable record, usable in UI-thread worklets and in Node tests.

/** Shortest frame interval taken as a real refresh interval (caps at 165 Hz). */
const MIN_INTERVAL_MS = 6;

export type MotionStats = {
  frames: number;
  timeMs: number;
  /** Shortest frame seen: the display's refresh interval while drawing smoothly. */
  minMs: number;
  worstMs: number;
  /** Map movement in screen points. */
  distance: number;
  /** Highest smoothed speed in points per second. */
  peakSpeed: number;
};

export type MotionSummary = {
  fps: number;
  worstMs: number;
  /** Share of frames the display could have shown but that were missed, 0..100. */
  missedPct: number;
  avgSpeed: number;
  peakSpeed: number;
  durationMs: number;
};

export function newMotionStats(): MotionStats {
  'worklet';
  return { frames: 0, timeMs: 0, minMs: Infinity, worstMs: 0, distance: 0, peakSpeed: 0 };
}

export function addFrame(s: MotionStats, dtMs: number, distance: number, speed: number) {
  'worklet';
  s.frames += 1;
  s.timeMs += dtMs;
  if (dtMs < s.minMs) s.minMs = dtMs;
  if (dtMs > s.worstMs) s.worstMs = dtMs;
  s.distance += distance;
  if (speed > s.peakSpeed) s.peakSpeed = speed;
}

export function summarize(s: MotionStats): MotionSummary {
  'worklet';
  const secs = s.timeMs / 1000;
  const interval = Math.max(MIN_INTERVAL_MS, s.minMs);
  // Frames the display would have shown at its refresh rate in the same time.
  const expected = Math.max(s.frames, Math.round(s.timeMs / interval));
  return {
    fps: secs > 0 ? s.frames / secs : 0,
    worstMs: s.worstMs,
    missedPct: expected > 0 ? ((expected - s.frames) / expected) * 100 : 0,
    avgSpeed: secs > 0 ? s.distance / secs : 0,
    peakSpeed: s.peakSpeed,
    durationMs: s.timeMs,
  };
}

/**
 * Horizontal movement between two frames. The map offset wraps by one map
 * width, so a jump of more than half a width is the wrap, not movement.
 */
export function wrappedDelta(dx: number, scaledWidth: number): number {
  'worklet';
  if (dx > scaledWidth / 2) return dx - scaledWidth;
  if (dx < -scaledWidth / 2) return dx + scaledWidth;
  return dx;
}

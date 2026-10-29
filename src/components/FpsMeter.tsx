import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { takePerfSample } from '../state/perfStats';

const SAMPLE_MS = 1000;

type FrameSample = { fps: number; worstMs: number };
type Sample = { ui: FrameSample; js: FrameSample; simMs: number; ticks: number; mapBuildMs: number };

/**
 * Small on-screen performance readout for test builds:
 * - UI: frames per second on the UI thread (gestures and map drawing) and the slowest frame.
 * - JS: frames per second on the JavaScript thread (simulation and React).
 * - Sim: JavaScript time spent simulating per second, and weeks simulated per second.
 * - Map: time of the last territory map rebuild.
 */
export function FpsMeter() {
  const [sample, setSample] = useState<Sample | null>(null);
  const uiSample = useRef<FrameSample>({ fps: 0, worstMs: 0 });

  // UI thread: count frames in a worklet, report once per sample period.
  const uiFrames = useSharedValue(0);
  const uiWorst = useSharedValue(0);
  const uiStart = useSharedValue(0);
  const reportUi = (fps: number, worstMs: number) => {
    uiSample.current = { fps, worstMs };
  };
  useFrameCallback((frame) => {
    'worklet';
    if (uiStart.value === 0) uiStart.value = frame.timestamp;
    uiFrames.value += 1;
    const dt = frame.timeSincePreviousFrame ?? 0;
    if (dt > uiWorst.value) uiWorst.value = dt;
    const elapsed = frame.timestamp - uiStart.value;
    if (elapsed >= SAMPLE_MS) {
      scheduleOnRN(reportUi, Math.round((uiFrames.value * 1000) / elapsed), Math.round(uiWorst.value));
      uiFrames.value = 0;
      uiWorst.value = 0;
      uiStart.value = frame.timestamp;
    }
  });

  // JS thread: count animation frames, publish everything once per sample period.
  useEffect(() => {
    let frame = 0;
    let frames = 0;
    let worst = 0;
    let start = performance.now();
    let last = start;
    const onFrame = (now: number) => {
      frames++;
      worst = Math.max(worst, now - last);
      last = now;
      const elapsed = now - start;
      if (elapsed >= SAMPLE_MS) {
        const perf = takePerfSample();
        setSample({
          ui: uiSample.current,
          js: { fps: Math.round((frames * 1000) / elapsed), worstMs: Math.round(worst) },
          simMs: (perf.simMs * 1000) / elapsed,
          ticks: (perf.ticks * 1000) / elapsed,
          mapBuildMs: perf.mapBuildMs,
        });
        frames = 0;
        worst = 0;
        start = now;
      }
      frame = requestAnimationFrame(onFrame);
    };
    frame = requestAnimationFrame(onFrame);
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!sample) return null;
  return (
    <View style={styles.box} pointerEvents="none">
      <Text style={styles.text}>
        UI {sample.ui.fps} fps ({sample.ui.worstMs} ms) · JS {sample.js.fps} fps ({sample.js.worstMs} ms)
      </Text>
      <Text style={styles.text}>
        Sim {sample.simMs.toFixed(0)} ms/s · {sample.ticks.toFixed(0)} weeks/s · Map {sample.mapBuildMs.toFixed(0)} ms
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: { color: '#d8f5d0', fontSize: 10, fontVariant: ['tabular-nums'] },
});

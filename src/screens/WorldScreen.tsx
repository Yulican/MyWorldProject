import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HexInfoPanel } from '../components/HexInfoPanel';
import { useBenchmark, type BenchmarkStatus } from '../bench/useBenchmark';
import { WorldMap, type MapController } from '../map/WorldMap';
import { createNewWorld, useWorld } from '../state/worldStore';
import { colors, spacing } from '../theme';

// Set by the CI build (branch · commit) so testers can see which build is installed.
const buildLabel = process.env.EXPO_PUBLIC_BUILD_LABEL ?? 'local dev build';
// Set for the CI benchmark build: the benchmark starts as soon as the app opens.
const autoBenchmark = process.env.EXPO_PUBLIC_BENCHMARK === '1';

export function WorldScreen() {
  const world = useWorld();
  const [selectedCell, setSelectedCell] = useState(-1);
  const mapController = useRef<MapController | null>(null);
  const benchmark = useBenchmark(mapController);
  const benchmarkRunning = benchmark.status?.running === true;

  useEffect(() => {
    if (!world) createNewWorld();
  }, [world]);

  const runBenchmark = benchmark.run;
  useEffect(() => {
    if (autoBenchmark && world) runBenchmark();
  }, [world, runBenchmark]);

  // Tapping the selected hex again closes the info bar.
  const onTapCell = (cell: number) => setSelectedCell((current) => (cell === current ? -1 : cell));

  const newWorld = () => {
    setSelectedCell(-1);
    createNewWorld();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <View style={styles.topText}>
          <Text style={styles.title}>MyWorld</Text>
          <Text style={styles.meta}>
            {world ? `Seed ${world.seed} · ${world.shape}` : 'Creating world…'}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.button, styles.benchButton, pressed && styles.buttonPressed]}
          disabled={benchmarkRunning}
          onPress={() => {
            setSelectedCell(-1);
            runBenchmark();
          }}
        >
          <Text style={styles.buttonText}>Bench</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          disabled={benchmarkRunning}
          onPress={newWorld}
        >
          <Text style={styles.buttonText}>New world</Text>
        </Pressable>
      </View>

      <View style={styles.mapArea}>
        {world && (
          <WorldMap world={world} selectedCell={selectedCell} onTapCell={onTapCell} controller={mapController} />
        )}
        {benchmark.status && <BenchmarkBanner status={benchmark.status} />}
        {world && selectedCell >= 0 && (
          <HexInfoPanel world={world} cell={selectedCell} onClose={() => setSelectedCell(-1)} />
        )}
      </View>

      <Text style={styles.build}>{buildLabel}</Text>
    </SafeAreaView>
  );
}

function BenchmarkBanner({ status }: { status: BenchmarkStatus }) {
  if (status.running) {
    return (
      <View style={styles.bench} pointerEvents="none">
        <Text style={styles.benchText}>
          Benchmark · world {status.world + 1}/5 · swipe {status.swipe}/80 · failed {status.failed}
        </Text>
      </View>
    );
  }
  const s = status.summary;
  return (
    <View style={[styles.bench, s.pass ? styles.benchPass : styles.benchFail]} pointerEvents="none">
      <Text style={styles.benchText}>
        Benchmark {s.pass ? 'PASSED' : 'FAILED'} · {s.failed}/{s.swipes} swipes failed
      </Text>
      <Text style={styles.benchText}>
        fps min {s.minFps.toFixed(0)} · median {s.medianFps.toFixed(0)} · worst frame {s.worstMs.toFixed(0)} ms
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.panel },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  topText: { flex: 1 },
  title: { color: colors.panelText, fontSize: 18, fontWeight: '700' },
  meta: { color: colors.panelMuted, fontSize: 13, marginTop: 2 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  benchButton: { marginRight: spacing.sm, backgroundColor: colors.panelMuted },
  buttonPressed: { opacity: 0.7 },
  bench: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  benchPass: { backgroundColor: 'rgba(30,110,50,0.9)' },
  benchFail: { backgroundColor: 'rgba(140,30,30,0.9)' },
  benchText: { color: '#ffffff', fontSize: 12, fontVariant: ['tabular-nums'] },
  buttonText: { color: colors.panel, fontWeight: '700', fontSize: 14 },
  mapArea: { flex: 1 },
  build: { color: colors.panelMuted, fontSize: 10, textAlign: 'center', paddingVertical: 2 },
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scenarioFromUrl } from '../bench/benchmark';
import { useBenchmark, type BenchmarkStatus } from '../bench/useBenchmark';
import { CivPanel } from '../components/CivPanel';
import { HexInfoPanel } from '../components/HexInfoPanel';
import { TimeControls } from '../components/TimeControls';
import { WorldMap, type MapController, type TerritorySource } from '../map/WorldMap';
import { hexEconomy, hexSupplyTerms, isWaterBiome, simulationYear } from '../sim';
import { createNewWorld, setSpeed, snapshotStore, useGameState } from '../state/worldStore';
import { colors, spacing } from '../theme';

// Set by the CI build (branch · commit) so testers can see which build is installed.
const buildLabel = process.env.EXPO_PUBLIC_BUILD_LABEL ?? 'local dev build';
// CI opens the app with this link to start the benchmark (scripts/run-benchmark.sh).
const BENCHMARK_URL = 'myworld://benchmark';

type OpenPanel = { kind: 'none' } | { kind: 'hex'; cell: number } | { kind: 'peoples' };

export function WorldScreen() {
  const { sim, speed } = useGameState();
  const world = sim?.world ?? null;
  const [panel, setPanel] = useState<OpenPanel>({ kind: 'none' });
  const mapController = useRef<MapController | null>(null);
  const benchmark = useBenchmark(mapController);
  const benchmarkRunning = benchmark.status?.running === true;

  useEffect(() => {
    if (!sim) createNewWorld();
  }, [sim]);

  const runBenchmark = benchmark.run;
  const hasWorld = sim !== null;
  useEffect(() => {
    if (!hasWorld) return;
    Linking.getInitialURL().then((url) => {
      if (url?.startsWith(BENCHMARK_URL)) runBenchmark(scenarioFromUrl(url));
    });
  }, [hasWorld, runBenchmark]);

  // Stable per world, so the map doesn't re-render with every simulation update.
  const territory = useMemo<TerritorySource>(
    () => ({ ...snapshotStore, civColor: (id) => sim?.civs[id]?.color ?? '#ffffff' }),
    [sim],
  );

  const newWorld = () => {
    setPanel({ kind: 'none' });
    createNewWorld();
  };

  const selectedCell = panel.kind === 'hex' ? panel.cell : -1;
  // Tapping the selected hex again (or off the map) closes the info bar.
  const onTapCell = useCallback(
    (cell: number) =>
      setPanel((open) =>
        cell < 0 || (open.kind === 'hex' && open.cell === cell) ? { kind: 'none' } : { kind: 'hex', cell },
      ),
    [],
  );
  const closePanel = () => setPanel({ kind: 'none' });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <View style={styles.topText}>
          <Text style={styles.title}>{sim ? `Year ${simulationYear(sim)}` : 'MyWorld'}</Text>
          <Text style={styles.meta}>
            {sim ? `${sim.pop.count} people · ${sim.believers} believe in you` : 'Creating world…'}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.button, styles.benchButton, pressed && styles.buttonPressed]}
          disabled={benchmarkRunning}
          onPress={() => {
            setPanel({ kind: 'none' });
            runBenchmark('young');
          }}
          // A long press runs the aged-worlds scenario (300 simulated years first).
          onLongPress={() => {
            setPanel({ kind: 'none' });
            runBenchmark('aged');
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
          <WorldMap
            world={world}
            selectedCell={selectedCell}
            onTapCell={onTapCell}
            territory={territory}
            controller={mapController}
          />
        )}
        {benchmark.status && <BenchmarkBanner status={benchmark.status} />}
        {sim && panel.kind === 'hex' && (
          <HexInfoPanel
            world={sim.world}
            cell={panel.cell}
            civName={sim.civs[sim.world.owner[panel.cell]]?.name ?? null}
            supply={isWaterBiome(sim.world.biome[panel.cell]) ? null : hexSupplyTerms(sim, panel.cell)}
            economy={isWaterBiome(sim.world.biome[panel.cell]) ? null : hexEconomy(sim, panel.cell)}
            onClose={closePanel}
          />
        )}
        {sim && panel.kind === 'peoples' && <CivPanel sim={sim} onClose={closePanel} />}
        {sim?.gameOver && (
          <View style={styles.gameOver}>
            <Text style={styles.gameOverTitle}>Nobody prays to you anymore</Text>
            <Text style={styles.gameOverText}>Your last believer is gone in year {simulationYear(sim)}.</Text>
            <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={newWorld}>
              <Text style={styles.buttonText}>New world</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.bottomBar}>
        <TimeControls speed={speed} onChange={setSpeed} disabled={!sim || sim.gameOver} />
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          onPress={() => setPanel(panel.kind === 'peoples' ? { kind: 'none' } : { kind: 'peoples' })}
        >
          <Text style={styles.secondaryText}>Peoples</Text>
        </Pressable>
      </View>

      <Text style={styles.build}>
        {world ? `Seed ${world.seed} · ${world.shape} · ` : ''}
        {buildLabel}
      </Text>
    </SafeAreaView>
  );
}

function BenchmarkBanner({ status }: { status: BenchmarkStatus }) {
  if (status.running) {
    return (
      <View style={styles.bench} pointerEvents="none">
        <Text style={styles.benchText}>
          Benchmark ({status.scenario}) · world {status.world + 1}/5 · swipe {status.swipe}/80 · failed {status.failed}
        </Text>
      </View>
    );
  }
  const s = status.summary;
  return (
    <View style={[styles.bench, s.pass ? styles.benchPass : styles.benchFail]} pointerEvents="none">
      <Text style={styles.benchText}>
        Benchmark{s.scenario ? ` (${s.scenario})` : ''} {s.pass ? 'PASSED' : 'FAILED'} · {s.failed}/{s.swipes} swipes failed
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
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md,
    height: 36,
    justifyContent: 'center',
  },
  secondaryText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  gameOver: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '30%',
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  gameOverTitle: { color: colors.panelText, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  gameOverText: { color: colors.panelMuted, fontSize: 14, textAlign: 'center', marginBottom: spacing.sm },
  build: { color: colors.panelMuted, fontSize: 10, textAlign: 'center', paddingVertical: 2 },
});

import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CivPanel } from '../components/CivPanel';
import { FpsMeter } from '../components/FpsMeter';
import { HexInfoPanel } from '../components/HexInfoPanel';
import { TimeControls } from '../components/TimeControls';
import { WorldMap } from '../map/WorldMap';
import { CIV_COLORS } from '../map/palette';
import { simulationYear } from '../sim';
import { createNewWorld, setSpeed, useGameState } from '../state/worldStore';
import { colors, spacing } from '../theme';

// Set by the CI build (branch · commit) so testers can see which build is installed.
const buildLabel = process.env.EXPO_PUBLIC_BUILD_LABEL ?? 'local dev build';

type OpenPanel = { kind: 'none' } | { kind: 'hex'; cell: number } | { kind: 'peoples' };

export function WorldScreen() {
  const { sim, speed } = useGameState();
  const world = sim?.world ?? null;
  const [panel, setPanel] = useState<OpenPanel>({ kind: 'none' });

  useEffect(() => {
    if (!sim) createNewWorld();
  }, [sim]);

  const civColor = useMemo(() => (id: number) => CIV_COLORS[sim?.civs[id]?.color ?? 0], [sim]);

  const newWorld = () => {
    setPanel({ kind: 'none' });
    createNewWorld();
  };

  const selectedCell = panel.kind === 'hex' ? panel.cell : -1;
  // Tapping the selected hex again (or off the map) closes the info bar.
  const onTapCell = (cell: number) =>
    setPanel(cell < 0 || cell === selectedCell ? { kind: 'none' } : { kind: 'hex', cell });
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
        <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={newWorld}>
          <Text style={styles.buttonText}>New world</Text>
        </Pressable>
      </View>

      <View style={styles.mapArea}>
        {world && (
          <WorldMap
            world={world}
            selectedCell={selectedCell}
            onTapCell={onTapCell}
            territoryVersion={sim?.snapshotVersion ?? 0}
            civColor={civColor}
          />
        )}
        <FpsMeter />
        {sim && panel.kind === 'hex' && (
          <HexInfoPanel
            world={sim.world}
            cell={panel.cell}
            civName={sim.civs[sim.world.owner[panel.cell]]?.name ?? null}
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
  buttonPressed: { opacity: 0.7 },
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

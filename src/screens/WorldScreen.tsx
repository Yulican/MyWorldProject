import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HexInfoPanel } from '../components/HexInfoPanel';
import { WorldMap } from '../map/WorldMap';
import { createNewWorld, useWorld } from '../state/worldStore';
import { colors, spacing } from '../theme';

// Set by the CI build (branch · commit) so testers can see which build is installed.
const buildLabel = process.env.EXPO_PUBLIC_BUILD_LABEL ?? 'local dev build';

export function WorldScreen() {
  const world = useWorld();
  const [selectedCell, setSelectedCell] = useState(-1);

  useEffect(() => {
    if (!world) createNewWorld();
  }, [world]);

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
        <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={newWorld}>
          <Text style={styles.buttonText}>New world</Text>
        </Pressable>
      </View>

      <View style={styles.mapArea}>
        {world && <WorldMap world={world} selectedCell={selectedCell} onTapCell={onTapCell} />}
        {world && selectedCell >= 0 && (
          <HexInfoPanel world={world} cell={selectedCell} onClose={() => setSelectedCell(-1)} />
        )}
      </View>

      <Text style={styles.build}>{buildLabel}</Text>
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
  build: { color: colors.panelMuted, fontSize: 10, textAlign: 'center', paddingVertical: 2 },
});

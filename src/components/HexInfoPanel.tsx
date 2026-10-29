import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BIOMES,
  DEPOSITS,
  RESOURCE_COUNT,
  RESOURCE_NAMES,
  elevationMeters,
  hasFreshWater,
  type World,
} from '../sim';
import { colors, spacing } from '../theme';

type Props = {
  world: World;
  cell: number;
  onClose: () => void;
};

/** Bottom panel with everything the world knows about one hex. */
export function HexInfoPanel({ world, cell, onClose }: Props) {
  const col = cell % world.width;
  const row = Math.floor(cell / world.width);
  const biome = BIOMES[world.biome[cell]];
  const deposit = world.deposit[cell] ? DEPOSITS[world.deposit[cell]] : null;
  const river = world.riverFlow[cell];
  const meters = elevationMeters(world, cell);

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{biome.name}</Text>
          <Text style={styles.subtitle}>
            Hex {col}, {row}
            {cell === world.startCell ? ' · Your tribe starts here' : ''}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll}>
        <Row label={meters >= 0 ? 'Elevation' : 'Depth'} value={`${Math.abs(meters)} m`} />
        <Row label="Temperature" value={`${world.temperature[cell].toFixed(0)} °C`} />
        {!biome.water && <Row label="Moisture" value={percent(world.moisture[cell])} />}
        {!biome.water && (
          <Row label="River" value={river > 0 ? riverSize(river) : hasFreshWater(world, cell) ? 'Nearby' : 'None'} />
        )}
        <Row label="Danger" value={percent(world.danger[cell])} />
        <Row label="Travel cost" value={`×${world.moveCost[cell]}`} />
        {deposit && <Row label="Deposit" value={`${deposit.name} (${deposit.category})`} highlight />}

        <Text style={styles.section}>Resources</Text>
        {RESOURCE_NAMES.map((name, r) => (
          <Bar
            key={name}
            label={name}
            value={world.resources[cell * RESOURCE_COUNT + r]}
            capacity={world.resourceCapacity[cell * RESOURCE_COUNT + r]}
          />
        ))}

        <Text style={styles.section}>People</Text>
        <Row label="Civilization" value={world.owner[cell] ? `#${world.owner[cell]}` : 'Nobody'} />
        <Row label="Population" value={String(Math.round(world.population[cell]))} />
        <Row label="Faith in you" value={world.population[cell] > 0 ? percent(world.faith[cell]) : '–'} />
      </ScrollView>
    </View>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, highlight && styles.highlight]}>{value}</Text>
    </View>
  );
}

function Bar({ label, value, capacity }: { label: string; value: number; capacity: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barCapacity, { width: `${capacity * 100}%` }]} />
        <View style={[styles.barFill, { width: `${value * 100}%` }]} />
      </View>
    </View>
  );
}

const percent = (v: number) => `${Math.round(v * 100)} %`;
const riverSize = (flow: number) => (flow < 2 ? 'Stream' : flow < 5 ? 'River' : 'Great river');

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    maxHeight: '45%',
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  headerText: { flex: 1 },
  title: { color: colors.panelText, fontSize: 20, fontWeight: '700' },
  subtitle: { color: colors.panelMuted, fontSize: 13, marginTop: 2 },
  close: { padding: spacing.xs },
  closeText: { color: colors.panelMuted, fontSize: 18 },
  scroll: { marginTop: spacing.sm },
  section: { color: colors.panelText, fontSize: 14, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  label: { color: colors.panelMuted, fontSize: 14, width: 110 },
  value: { color: colors.panelText, fontSize: 14, flex: 1 },
  highlight: { color: colors.accent, fontWeight: '600' },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.barTrack, overflow: 'hidden' },
  barCapacity: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.barCapacity },
  barFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.accent },
});

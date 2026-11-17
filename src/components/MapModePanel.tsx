import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MODES, MapModeId, POLITICAL, modeLegend, type MapMode } from '../map/mapModes';
import { colors, spacing } from '../theme';

// Map modes (Requirement Kartenmodi 2): the list behind the "Map" button and
// the legend bar at the map's top edge.

/** The small list of modes; the active one highlighted. Choosing one closes the list. */
export function MapModeList({ mode, onMode, onClose }: { mode: MapMode; onMode: (mode: MapMode) => void; onClose: () => void }) {
  return (
    <View style={styles.list}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Map mode</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>
      {MODES.map((m, id) => {
        const active = id === mode.id;
        return (
          <Pressable
            key={m.key}
            style={({ pressed }) => [styles.entry, active && styles.entryActive, pressed && styles.pressed]}
            // A mode keeps its last sub-mode only while active; chosen anew it starts with the first.
            onPress={() => onMode(active ? mode : { id, sub: 0 })}
          >
            <Text style={[styles.entryText, active && styles.entryTextActive]}>{m.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Name, sub-mode switch, legend and a quick way back to the political map; nothing in Political. */
export function MapModeBar({ mode, onMode }: { mode: MapMode; onMode: (mode: MapMode) => void }) {
  const legend = modeLegend(mode);
  if (!legend || mode.id === MapModeId.Political) return null;
  const info = MODES[mode.id];
  const categorical = mode.id === MapModeId.Deposits;
  return (
    <View style={styles.bar}>
      <View style={styles.barRow}>
        <Text style={styles.barTitle}>{info.name}</Text>
        {info.subs.map((name, sub) => (
          <Pressable
            key={name}
            hitSlop={4}
            style={({ pressed }) => [styles.chip, sub === mode.sub && styles.chipActive, pressed && styles.pressed]}
            onPress={() => onMode({ id: mode.id, sub })}
          >
            <Text style={[styles.chipText, sub === mode.sub && styles.chipTextActive]}>{name}</Text>
          </Pressable>
        ))}
        <View style={styles.spacer} />
        <Pressable
          hitSlop={4}
          style={({ pressed }) => [styles.political, pressed && styles.pressed]}
          onPress={() => onMode(POLITICAL)}
        >
          <Text style={styles.politicalText}>Political</Text>
        </Pressable>
      </View>
      {categorical ? (
        <View style={styles.categories}>
          {legend.entries.map((e) => (
            <View key={e.label} style={styles.category}>
              <View style={[styles.dot, { backgroundColor: e.color }]} />
              <Text style={styles.categoryText}>{e.label}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.scale}>
          {legend.entries.map((e, k) => (
            <View key={k} style={styles.step}>
              <View style={[styles.swatch, { backgroundColor: e.color }]} />
              <Text style={styles.stepText} numberOfLines={1}>
                {e.label}
              </Text>
            </View>
          ))}
          {legend.unit !== '' && <Text style={styles.unit}>{legend.unit}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    minWidth: 170,
    backgroundColor: colors.panel,
    borderRadius: 12,
    padding: spacing.sm,
    gap: 2,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  listTitle: { color: colors.panelText, fontWeight: '700', fontSize: 14 },
  close: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  entry: { paddingVertical: 7, paddingHorizontal: spacing.sm, borderRadius: 8 },
  entryActive: { backgroundColor: colors.accent },
  entryText: { color: colors.panelText, fontSize: 14 },
  entryTextActive: { color: colors.panel, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  bar: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(20,23,31,0.88)',
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    gap: 3,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  barTitle: {
    color: colors.panelText,
    fontWeight: '700',
    fontSize: 13,
    marginRight: spacing.xs,
  },
  chip: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.panelMuted,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.panelText, fontSize: 12 },
  chipTextActive: { color: colors.panel, fontWeight: '700' },
  spacer: { flex: 1 },
  political: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  politicalText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  scale: { flexDirection: 'row', alignItems: 'flex-end' },
  step: { flex: 1, alignItems: 'flex-start' },
  swatch: { alignSelf: 'stretch', height: 8 },
  stepText: {
    color: colors.panelMuted,
    fontSize: 9,
    fontVariant: ['tabular-nums'],
  },
  unit: { color: colors.panelMuted, fontSize: 9, marginLeft: 4 },
  categories: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: 1,
  },
  category: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#1b1b1b',
  },
  categoryText: { color: colors.panelMuted, fontSize: 10 },
});

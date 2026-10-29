import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CULTURE_NAMES,
  TICKS_PER_YEAR,
  livingCivilizations,
  simulationYear,
  type Civilization,
  type Simulation,
} from '../sim';
import { CIV_COLORS } from '../map/palette';
import { colors, spacing } from '../theme';

/** Chronicle entries shown, newest first. */
const CHRONICLE_LENGTH = 12;

type Props = {
  sim: Simulation;
  onClose: () => void;
};

/** Bottom panel listing the living peoples and the chronicle of events. */
export function CivPanel({ sim, onClose }: Props) {
  // The player's people first, then by size.
  const civs = livingCivilizations(sim).sort(
    (a, b) => Number(b.worshipsPlayer) - Number(a.worshipsPlayer) || b.population - a.population,
  );
  const chronicle = sim.chronicle.slice(-CHRONICLE_LENGTH).reverse();

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Peoples</Text>
          <Text style={styles.subtitle}>
            Year {simulationYear(sim)} · {sim.pop.count} people · {sim.believers} believe in you
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll}>
        {civs.map((civ) => (
          <CivRow key={civ.id} civ={civ} />
        ))}

        <Text style={styles.section}>Chronicle</Text>
        {chronicle.map((entry, i) => (
          <View key={i} style={styles.entry}>
            <Text style={styles.entryYear}>Year {Math.floor(entry.tick / TICKS_PER_YEAR) + 1}</Text>
            <Text style={styles.entryText}>{entry.text}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function CivRow({ civ }: { civ: Civilization }) {
  return (
    <View style={styles.civ}>
      <View style={styles.civHeader}>
        <View style={[styles.swatch, { backgroundColor: CIV_COLORS[civ.color] }]} />
        <Text style={styles.civName}>{civ.name}</Text>
        <Text style={[styles.tag, civ.worshipsPlayer && styles.tagHighlight]}>{originText(civ)}</Text>
      </View>
      <Text style={styles.stats}>
        {civ.population} people · {civ.territory} hexes · {percent(civ.believers, civ.population)} believe in you
      </Text>
      <Text style={styles.culture}>{cultureText(civ)}</Text>
    </View>
  );
}

function originText(civ: Civilization): string {
  if (civ.worshipsPlayer) return 'Worships you';
  if (civ.origin === 'secession') return `Broke away from the ${civ.parentName}`;
  return 'Without a god';
}

/** The culture's strong traits, strongest first, e.g. "Seafaring · Farming". */
function cultureText(civ: Civilization): string {
  const strong = CULTURE_NAMES.map((name, k) => ({ name, value: civ.culture[k] }))
    .filter((t) => t.value >= 0.5)
    .sort((a, b) => b.value - a.value)
    .map((t) => t.name);
  return strong.length > 0 ? strong.join(' · ') : 'No strong traits yet';
}

const percent = (part: number, whole: number) => `${whole > 0 ? Math.round((part / whole) * 100) : 0} %`;

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    maxHeight: '55%',
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
  civ: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.barTrack },
  civHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  civName: { color: colors.panelText, fontSize: 16, fontWeight: '700' },
  tag: { color: colors.panelMuted, fontSize: 12, flexShrink: 1 },
  tagHighlight: { color: colors.accent, fontWeight: '600' },
  stats: { color: colors.panelText, fontSize: 13, marginTop: 4 },
  culture: { color: colors.panelMuted, fontSize: 13, marginTop: 2 },
  section: { color: colors.panelText, fontSize: 14, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  entry: { flexDirection: 'row', paddingVertical: 3, gap: spacing.sm },
  entryYear: { color: colors.panelMuted, fontSize: 13, width: 64 },
  entryText: { color: colors.panelText, fontSize: 13, flex: 1 },
});

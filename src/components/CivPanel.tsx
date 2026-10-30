import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BELIEVER_FAITH,
  CULTURE_NAMES,
  Culture,
  TICKS_PER_YEAR,
  ledgerNet,
  livingCivilizations,
  simulationYear,
  type Civilization,
  type Simulation,
} from '../sim';
import { CIV_COLORS } from '../map/palette';
import { colors, spacing } from '../theme';

/** Chronicle entries shown, newest first. */
const CHRONICLE_LENGTH = 12;
/** Years shown in the trend chart. */
const TREND_YEARS = 100;

type Props = {
  sim: Simulation;
  onClose: () => void;
};

/** Bottom panel listing the living peoples, how faith in the player develops, and the chronicle. */
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
        <TrendChart population={sim.history.population} believers={sim.history.believers} />

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

/** Population (muted) and believers (accent) per year as bars, newest on the right. */
function TrendChart({ population, believers }: { population: number[]; believers: number[] }) {
  const from = Math.max(0, population.length - TREND_YEARS);
  const pop = population.slice(from);
  const bel = believers.slice(from);
  if (pop.length < 2) return null;
  const max = Math.max(...pop, 1);
  return (
    <View style={styles.trend}>
      <Text style={styles.trendLabel}>
        Last {pop.length} years: <Text style={styles.trendBelievers}>believers</Text> of all people
      </Text>
      <View style={styles.chart}>
        {pop.map((p, i) => (
          <View key={i} style={styles.chartColumn}>
            <View style={[styles.chartPopulation, { height: `${(p / max) * 100}%` }]}>
              <View style={[styles.chartBelievers, { height: `${p > 0 ? (bel[i] / p) * 100 : 0}%` }]} />
            </View>
          </View>
        ))}
      </View>
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
        {civ.population} people · {civ.territory} hexes · {cultureText(civ)}
      </Text>

      <View style={styles.faithRow}>
        <Text style={styles.faithLabel}>Faith</Text>
        <View style={styles.faithTrack}>
          <View style={[styles.faithFill, { width: `${civ.averageFaith * 100}%` }]} />
          <View style={[styles.faithLine, { left: `${BELIEVER_FAITH * 100}%` }]} />
        </View>
        <Text style={styles.faithValue}>
          {civ.believers} ({percent(civ.believers, civ.population)})
        </Text>
      </View>
      <Text style={styles.ledger}>{ledgerText(civ)}</Text>
      <Text style={styles.why}>{faithReason(civ)}</Text>
    </View>
  );
}

/** Last year's believer changes, e.g. "Last year +4: 12 born, 7 died, 1 swayed by neighbors". */
function ledgerText(civ: Civilization): string {
  const l = civ.faithLastYear;
  const net = ledgerNet(l);
  const parts = [
    l.born && `+${l.born} born believing`,
    l.died && `−${l.died} died`,
    l.grewDevout && `+${l.grewDevout} grew devout`,
    l.wonByNeighbors && `+${l.wonByNeighbors} won over by neighbors`,
    l.lostToNeighbors && `−${l.lostToNeighbors} swayed by doubting neighbors`,
    l.forgot && `−${l.forgot} forgot you`,
    l.brokeAway && `−${l.brokeAway} broke away`,
  ].filter(Boolean);
  const sign = net > 0 ? '+' : net < 0 ? '−' : '±';
  return `Believers last year ${sign}${Math.abs(net)}${parts.length ? ': ' + parts.join(', ') : ''}`;
}

/** The rule that currently drives this people's faith, in plain words. */
function faithReason(civ: Civilization): string {
  if (civ.worshipsPlayer) {
    const devout = Math.round(civ.culture[Culture.Devout] * 100);
    return `They worship you: faith grows every year with how devout they are (${devout} %). Children mostly share their parents' faith.`;
  }
  return 'They have no god yet: faith in you fades a little every year and among neighbors who doubt.';
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
    maxHeight: '60%',
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
  trend: { marginBottom: spacing.sm },
  trendLabel: { color: colors.panelMuted, fontSize: 12, marginBottom: 4 },
  trendBelievers: { color: colors.accent, fontWeight: '600' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 1 },
  chartColumn: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  chartPopulation: { backgroundColor: colors.barCapacity, justifyContent: 'flex-end' },
  chartBelievers: { backgroundColor: colors.accent },
  civ: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.barTrack },
  civHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  civName: { color: colors.panelText, fontSize: 16, fontWeight: '700' },
  tag: { color: colors.panelMuted, fontSize: 12, flexShrink: 1 },
  tagHighlight: { color: colors.accent, fontWeight: '600' },
  stats: { color: colors.panelText, fontSize: 13, marginTop: 4 },
  faithRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: spacing.sm },
  faithLabel: { color: colors.panelMuted, fontSize: 13, width: 40 },
  faithTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.barTrack, overflow: 'hidden' },
  faithFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.accent },
  faithLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.panelText },
  faithValue: { color: colors.panelText, fontSize: 13, minWidth: 80, textAlign: 'right' },
  ledger: { color: colors.panelText, fontSize: 12, marginTop: 4 },
  why: { color: colors.panelMuted, fontSize: 12, marginTop: 2 },
  section: { color: colors.panelText, fontSize: 14, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  entry: { flexDirection: 'row', paddingVertical: 3, gap: spacing.sm },
  entryYear: { color: colors.panelMuted, fontSize: 13, width: 64 },
  entryText: { color: colors.panelText, fontSize: 13, flex: 1 },
});

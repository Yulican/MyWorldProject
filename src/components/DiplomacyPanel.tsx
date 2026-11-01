import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { livingCivilizations, relationsOf, type Relation, type Simulation, type Term } from '../sim';
import { colors, spacing } from '../theme';

type Props = {
  sim: Simulation;
  onClose: () => void;
};

/**
 * Relations between the peoples, seen from one of them (tap a people to see
 * everything relative to it): trust and danger both ways, borders and
 * agreements. The player sees everything, also what the peoples don't know.
 */
export function DiplomacyPanel({ sim, onClose }: Props) {
  const civs = livingCivilizations(sim).sort(
    (a, b) => Number(b.worshipsPlayer) - Number(a.worshipsPlayer) || b.population - a.population,
  );
  const [chosen, setChosen] = useState(civs[0]?.id ?? 0);
  const [open, setOpen] = useState(-1);
  const self = sim.civs[chosen] ? chosen : (civs[0]?.id ?? 0);
  const relations = self ? relationsOf(sim, self) : [];

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Diplomacy</Text>
        <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <ScrollView horizontal style={styles.chips} contentContainerStyle={styles.chipRow} showsHorizontalScrollIndicator={false}>
        {civs.map((civ) => (
          <Pressable
            key={civ.id}
            onPress={() => {
              setChosen(civ.id);
              setOpen(-1);
            }}
            style={[styles.chip, civ.id === self && styles.chipActive]}
          >
            <View style={[styles.swatch, { backgroundColor: civ.color }]} />
            <Text style={styles.chipText}>{civ.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={styles.scroll}>
        {relations.length === 0 && <Text style={styles.note}>The {sim.civs[self]?.name} have not met anyone yet.</Text>}
        {relations.map((r) => (
          <RelationRow key={r.other} sim={sim} relation={r} expanded={open === r.other} onPress={() => setOpen(open === r.other ? -1 : r.other)} />
        ))}
        <Text style={styles.note}>
          Trust grows between peaceful neighbors. Borders open at trust 50 and danger up to 40; open borders let
          settlers and merchants pass for a toll. Tap a people for the details.
        </Text>
      </ScrollView>
    </View>
  );
}

function RelationRow({ sim, relation: r, expanded, onPress }: { sim: Simulation; relation: Relation; expanded: boolean; onPress: () => void }) {
  const other = sim.civs[r.other]!;
  const agreements = [r.freeTrade && 'free trade', r.migration && 'migration', ...r.deals].filter(Boolean);
  return (
    <Pressable onPress={onPress} style={styles.relation}>
      <View style={styles.relationHeader}>
        <View style={[styles.swatch, { backgroundColor: other.color }]} />
        <Text style={styles.name}>{other.name}</Text>
        <Text style={styles.distance}>{Number.isFinite(r.distance) ? `${r.distance.toFixed(1)} away` : 'out of reach'}</Text>
      </View>
      <Text style={styles.line}>
        Trust {Math.round(r.trust)} · danger {Math.round(r.danger)}
        <Text style={styles.muted}>
          {'  '}they: trust {Math.round(r.theirTrust)} · danger {Math.round(r.theirDanger)}
        </Text>
      </Text>
      <Text style={styles.line}>
        Borders: ours {r.weOpen ? 'open' : 'closed'} to them · theirs {r.theyOpen ? 'open' : 'closed'} to us
      </Text>
      {agreements.length > 0 && <Text style={styles.line}>Agreements: {agreements.join(', ')}</Text>}
      {expanded && (
        <>
          <Text style={styles.section}>Trust {Math.round(r.trust)}</Text>
          {r.trustTerms.map((t, i) => (
            <TermRow key={i} term={t} />
          ))}
          <Text style={styles.section}>Danger {Math.round(r.danger)}</Text>
          {r.dangerTerms.map((t, i) => (
            <TermRow key={i} term={t} />
          ))}
        </>
      )}
    </Pressable>
  );
}

function TermRow({ term }: { term: Term }) {
  const text = Math.abs(term.value).toFixed(1);
  const sign = Number(text) === 0 ? '±' : term.value < 0 ? '−' : '+';
  return (
    <View style={styles.termRow}>
      <Text style={styles.termLabel}>{term.label}</Text>
      <Text style={styles.termValue}>
        {sign}
        {text}
      </Text>
    </View>
  );
}

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
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { color: colors.panelText, fontSize: 20, fontWeight: '700', flex: 1 },
  close: { padding: spacing.xs },
  closeText: { color: colors.panelMuted, fontSize: 18 },
  chips: { marginTop: spacing.sm, flexGrow: 0 },
  chipRow: { gap: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.barTrack,
  },
  chipActive: { borderWidth: 2, borderColor: colors.accent },
  chipText: { color: colors.panelText, fontSize: 13, fontWeight: '600' },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  scroll: { marginTop: spacing.sm },
  relation: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.barTrack },
  relationHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { color: colors.panelText, fontSize: 16, fontWeight: '700', flex: 1 },
  distance: { color: colors.panelMuted, fontSize: 12 },
  line: { color: colors.panelText, fontSize: 13, marginTop: 4 },
  muted: { color: colors.panelMuted },
  section: { color: colors.panelText, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
  termRow: { flexDirection: 'row', paddingLeft: spacing.md, paddingVertical: 1 },
  termLabel: { color: colors.panelMuted, fontSize: 12, flex: 1 },
  termValue: { color: colors.panelMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  note: { color: colors.panelMuted, fontSize: 11, marginTop: spacing.sm, fontStyle: 'italic' },
});

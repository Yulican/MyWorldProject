import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { governmentOf, livingCivilizations, type District, type Simulation, type World } from '../sim';
import { colors, spacing } from '../theme';

type Props = {
  sim: Simulation;
  onClose: () => void;
};

/**
 * The government of a people (tap a people to switch): its districts, the
 * capital's first, with their taxes, treasuries, government buildings and
 * projects ("Design Documents/Requirement Zentralregierung.md").
 */
export function GovernmentPanel({ sim, onClose }: Props) {
  const civs = livingCivilizations(sim).sort(
    (a, b) => Number(b.worshipsPlayer) - Number(a.worshipsPlayer) || b.population - a.population,
  );
  const [chosen, setChosen] = useState(civs[0]?.id ?? 0);
  const [open, setOpen] = useState(-1);
  const self = sim.civs[chosen] ? chosen : (civs[0]?.id ?? 0);
  const districts = self ? governmentOf(sim, self) : [];

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Government</Text>
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
        {districts.length === 0 && <Text style={styles.note}>The {sim.civs[self]?.name} have no government yet.</Text>}
        {districts.map((d) => (
          <DistrictRow key={d.seat} world={sim.world} district={d} expanded={open === d.seat} onPress={() => setOpen(open === d.seat ? -1 : d.seat)} />
        ))}
        <Text style={styles.note}>
          Every seat of government taxes the settlements nearest to it: goods as much as its buildings need, money as much
          as its weakest settlement bears while it stays loyal. It builds seats first, then comfort and growth, as far as
          their upkeep stays within 40 % of what the district could raise. Tap a district for its buildings.
        </Text>
      </ScrollView>
    </View>
  );
}

/** A hex as "col, row". */
function place(world: World, cell: number): string {
  const col = cell % world.width;
  return `${col}, ${(cell - col) / world.width}`;
}

const percent = (v: number) => `${Math.round(v * 100)} %`;

function DistrictRow({ world, district: d, expanded, onPress }: { world: World; district: District; expanded: boolean; onPress: () => void }) {
  const standing = d.buildings.filter((b) => b.state === 'standing').length;
  const building = d.buildings.filter((b) => b.state === 'building').length;
  const ruins = d.buildings.filter((b) => b.state === 'ruin').length;
  const counts = [`${standing} standing`, building > 0 && `${building} being built`, ruins > 0 && `${ruins} ruined`].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} style={styles.district}>
      <View style={styles.districtHeader}>
        <Text style={styles.name}>{d.capital ? 'Capital' : 'Seat of government'}</Text>
        <Text style={styles.distance}>at {place(world, d.seat)}</Text>
      </View>
      <Text style={styles.line}>
        {d.settlements} settlement{d.settlements === 1 ? '' : 's'} · {d.people} people
      </Text>
      <Text style={styles.line}>
        Taxes: money {percent(d.rate)} · goods {percent(d.goodsRate)}
      </Text>
      <Text style={styles.line}>
        Treasury {Math.floor(d.treasury)} · wood {Math.floor(d.wood)} · stone {Math.floor(d.stone)}
      </Text>
      <Text style={styles.line}>
        Buildings: {counts} <Text style={styles.muted}>· upkeep {d.upkeep.toFixed(1)} of {d.budget.toFixed(1)} a year</Text>
      </Text>
      {d.project && (
        <Text style={styles.line}>
          Building next: {d.project.name} at {place(world, d.project.cell)}
          <Text style={styles.muted}>
            {'  '}wood {Math.floor(Math.min(d.project.wood, d.project.needWood))}/{Math.ceil(d.project.needWood)} · stone{' '}
            {Math.floor(Math.min(d.project.stone, d.project.needStone))}/{Math.ceil(d.project.needStone)}
          </Text>
        </Text>
      )}
      <Text style={styles.line}>
        Traders: {d.away} of {d.traders} on the way
      </Text>
      {expanded && (
        <>
          <Text style={styles.section}>Government buildings</Text>
          {d.buildings.length === 0 && <Text style={styles.termLabel}>None yet.</Text>}
          {d.buildings.map((b, i) => (
            <View key={i} style={styles.termRow}>
              <Text style={styles.termLabel}>
                {b.name} at {place(world, b.cell)}
              </Text>
              <Text style={styles.termValue}>{b.state === 'building' ? 'being built' : b.state === 'ruin' ? 'ruin' : 'standing'}</Text>
            </View>
          ))}
        </>
      )}
    </Pressable>
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
  district: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.barTrack },
  districtHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { color: colors.panelText, fontSize: 16, fontWeight: '700', flex: 1 },
  distance: { color: colors.panelMuted, fontSize: 12 },
  line: { color: colors.panelText, fontSize: 13, marginTop: 4 },
  muted: { color: colors.panelMuted },
  section: { color: colors.panelText, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
  termRow: { flexDirection: 'row', paddingLeft: spacing.md, paddingVertical: 1 },
  termLabel: { color: colors.panelMuted, fontSize: 12, flex: 1 },
  termValue: { color: colors.panelMuted, fontSize: 12 },
  note: { color: colors.panelMuted, fontSize: 11, marginTop: spacing.sm, fontStyle: 'italic' },
});

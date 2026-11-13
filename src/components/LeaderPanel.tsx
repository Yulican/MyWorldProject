import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  TickPart,
  leaderOf,
  livingCivilizations,
  simulationYear,
  type LeaderGoal,
  type LeaderInfo,
  type LeaderTrait,
  type Simulation,
} from '../sim';
import { LEADER } from '../sim/society/leaders';
import { colors, spacing } from '../theme';

/** A met part of the goal. */
const MET_TEXT = '#6fbf73';
/** Attributes a leader can have. */
const MAX_TRAITS = 3;

type Props = {
  sim: Simulation;
  onClose: () => void;
};

/**
 * The leader of a people (tap a people to switch): name, age, years in
 * office, the attributes and the goal with their effects in numbers and the
 * goal's progress ("Design Documents/Requirement Anführer.md", section 8).
 *
 * Leaders only change at a year's end, so what is shown is read from the
 * simulation once per year and people (leaderOf allocates), not with every
 * map snapshot the panel re-renders for.
 */
export function LeaderPanel({ sim, onClose }: Props) {
  const civs = livingCivilizations(sim).sort(
    (a, b) => Number(b.worshipsPlayer) - Number(a.worshipsPlayer) || b.population - a.population,
  );
  const [chosen, setChosen] = useState(civs[0]?.id ?? 0);
  const self = sim.civs[chosen] ? chosen : (civs[0]?.id ?? 0);
  const year = simulationYear(sim);
  // The year's number changes a tick part before the leaders' year does: read again once that tick is complete.
  const settled = sim.part === TickPart.Start;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- year and settled say when the simulation's leaders changed
  const leader = useMemo(() => (self ? leaderOf(sim, self) : null), [sim, self, year, settled]);
  const people = sim.civs[self]?.name ?? '';

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Leader</Text>
        <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <ScrollView horizontal style={styles.chips} contentContainerStyle={styles.chipRow} showsHorizontalScrollIndicator={false}>
        {civs.map((civ) => (
          <Pressable key={civ.id} onPress={() => setChosen(civ.id)} style={[styles.chip, civ.id === self && styles.chipActive]}>
            <View style={[styles.swatch, { backgroundColor: civ.color }]} />
            <Text style={styles.chipText}>{civ.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={styles.scroll}>
        {self !== 0 && !leader && (
          <>
            <Text style={styles.name}>No leader yet</Text>
            <Text style={styles.line}>
              The {people} are a new people. Their first leader takes office at the end of the year, with one trait and a
              goal.
            </Text>
          </>
        )}
        {leader && <LeaderBlock leader={leader} people={people} />}
        <Text style={styles.note}>
          Every people has one leader for life; a successor of the same line follows in the year of the death. A leader
          starts with one trait, gains a second after {LEADER.secondYears} years in office and a third when the goal is
          reached. The traits and the goal change how the whole people acts; a reached goal keeps{' '}
          {Math.round(LEADER.goalHalf * 100)} % of its effect. All satisfaction effects together are capped at ±
          {LEADER.capSatisfaction}.
        </Text>
      </ScrollView>
    </View>
  );
}

function LeaderBlock({ leader, people }: { leader: LeaderInfo; people: string }) {
  const { traits, goal } = leader;
  return (
    <>
      <Text style={styles.name}>{leader.name}</Text>
      <Text style={styles.line}>
        {ordinalText(leader.ordinal)} leader of the {people} · age {leader.age} · {yearsText(leader.yearsInOffice)} in office
      </Text>
      <Text style={styles.line}>
        Satisfaction of the people {signed(leader.satisfaction)}
        {leader.connection !== 0 && ` · connection to a seat ${signed(leader.connection)}`}
        <Text style={styles.muted}>{'  '}the part “Leader” in every settlement</Text>
      </Text>

      <Text style={styles.section}>
        Traits ({traits.length} of {MAX_TRAITS})
      </Text>
      {traits.map((t) => (
        <TraitBlock key={t.id} trait={t} />
      ))}
      {traits.length < 2 && (
        <Text style={styles.pending}>
          {leader.yearsToSecondTrait > 0
            ? `Second trait in ${yearsText(leader.yearsToSecondTrait)}.`
            : 'Second trait at the end of this year.'}
        </Text>
      )}
      {traits.length < MAX_TRAITS && !goal.reached && <Text style={styles.pending}>Third trait when the goal is reached.</Text>}

      <GoalBlock goal={goal} />
    </>
  );
}

function TraitBlock({ trait }: { trait: LeaderTrait }) {
  return (
    <View style={styles.block}>
      <Text style={styles.item}>
        {trait.name}
        <Text style={styles.about}>
          {'  '}
          {trait.about}
        </Text>
      </Text>
      {trait.effects.map((e, i) => (
        <Text key={i} style={styles.effect}>
          {e}
        </Text>
      ))}
    </View>
  );
}

function GoalBlock({ goal }: { goal: LeaderGoal }) {
  return (
    <>
      <Text style={styles.section}>Goal</Text>
      <View style={styles.block}>
        <Text style={styles.item}>
          {goal.name}
          <Text style={styles.about}>
            {'  '}
            {goal.about}
          </Text>
        </Text>
        <Text style={[styles.status, goal.reached && styles.met]}>
          {goal.reached
            ? `Reached after ${yearsText(goal.reachedAfterYears)} in office: half of its effect stays.`
            : 'Active: its full effect.'}
        </Text>
        {goal.effects.map((e, i) => (
          <Text key={i} style={styles.effect}>
            {e}
          </Text>
        ))}
      </View>
      <Text style={styles.section}>
        Progress
        <Text style={styles.about}>
          {'  '}
          {goal.progress.length < 2 ? 'reached with:' : goal.needs === 'all' ? 'all of these are needed:' : 'any one of these is enough:'}
        </Text>
      </Text>
      {goal.progress.map((p, i) => (
        <View key={i} style={styles.progressRow}>
          <Text style={[styles.progressLabel, p.met && styles.met]}>
            {p.met ? '✓ ' : ''}
            {p.label}
          </Text>
          <Text style={[styles.progressValue, p.met && styles.met]}>
            {p.value} / {p.target}
          </Text>
        </View>
      ))}
    </>
  );
}

/** "+3", "−2", "±0". */
function signed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded)}`;
}

const yearsText = (years: number) => `${years} year${years === 1 ? '' : 's'}`;

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
function ordinalText(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
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
  name: { color: colors.panelText, fontSize: 16, fontWeight: '700', marginTop: spacing.sm },
  line: { color: colors.panelText, fontSize: 13, marginTop: 4 },
  muted: { color: colors.panelMuted },
  section: { color: colors.panelText, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
  block: { paddingVertical: spacing.xs },
  item: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  about: { color: colors.panelMuted, fontSize: 12, fontWeight: '400' },
  effect: { color: colors.panelText, fontSize: 12, paddingLeft: spacing.md, paddingVertical: 1 },
  status: { color: colors.panelMuted, fontSize: 12, marginTop: 2, marginBottom: 2 },
  pending: { color: colors.panelMuted, fontSize: 12, marginTop: 2 },
  progressRow: { flexDirection: 'row', paddingLeft: spacing.md, paddingVertical: 1 },
  progressLabel: { color: colors.panelText, fontSize: 12, flex: 1 },
  progressValue: { color: colors.panelText, fontSize: 12, fontVariant: ['tabular-nums'] },
  met: { color: MET_TEXT },
  note: { color: colors.panelMuted, fontSize: 11, marginTop: spacing.sm, fontStyle: 'italic' },
});

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ArmyState,
  TICKS_PER_YEAR,
  WAR,
  civMilitary,
  Pact,
  civPacts,
  civTruces,
  civWars,
  livingCivilizations,
  relationsOf,
  type ArmyInfo,
  type CivWar,
  type Simulation,
  type Term,
  type World,
} from '../sim';
import { BATTLE } from '../sim/society/battle';
import { PAIRS } from '../sim/society/diplomacy';
import { colors, spacing } from '../theme';

/** Marks peoples at war (the map's war borders are red too). */
const WAR_TEXT = '#c62828';

type Props = {
  sim: Simulation;
  onClose: () => void;
};

/**
 * The war of a people (tap a people to switch): its strength, its war with
 * goal, siege and armies on both sides, its truces, and the danger between it
 * and every people it knows, both ways with their parts
 * ("Design Documents/Requirement Krieg.md", section 9).
 */
export function WarPanel({ sim, onClose }: Props) {
  const civs = livingCivilizations(sim).sort(
    (a, b) => Number(b.worshipsPlayer) - Number(a.worshipsPlayer) || b.population - a.population,
  );
  const [chosen, setChosen] = useState(civs[0]?.id ?? 0);
  const [open, setOpen] = useState(-1);
  const self = sim.civs[chosen] ? chosen : (civs[0]?.id ?? 0);
  const name = (civ: number) => sim.civs[civ]?.name ?? 'vanished people';
  const military = self ? civMilitary(sim, self) : null;
  const wars = self ? civWars(sim, self) : [];
  const pacts = self ? civPacts(sim, self) : [];
  const truces = self ? civTruces(sim, self) : [];
  const relations = self ? relationsOf(sim, self).sort((a, b) => b.danger + b.theirDanger - (a.danger + a.theirDanger)) : [];
  const year = (tick: number) => Math.floor(tick / TICKS_PER_YEAR) + 1;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>War</Text>
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
            {(sim.war.enemy[civ.id] !== 0 || sim.war.allyWarsOf[civ.id] > 0) && <View style={styles.warDot} />}
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={styles.scroll}>
        {military && (
          <Text style={styles.line}>
            Strength {Math.round(military.strength)} · {Math.round(military.soldiers)} soldiers
          </Text>
        )}

        {wars.length === 0 && <Text style={styles.line}>At peace.</Text>}
        {wars.map((war) => (
          <WarBlock key={war.war} sim={sim} war={war} name={name} year={year} />
        ))}

        {pacts.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.section}>Alliances and defense pacts</Text>
            {pacts.map((p) => (
              <Text key={p.civ} style={styles.termLabel}>
                {p.kind === Pact.Alliance
                  ? `Alliance with the ${name(p.civ)}`
                  : `Defense pact with the ${name(p.civ)}${sim.civs[p.threat] ? ` against the ${name(p.threat)}` : ''}`}
              </Text>
            ))}
          </View>
        )}

        {truces.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.section}>Truces</Text>
            {truces.map((t) => (
              <Text key={t.civ} style={styles.termLabel}>
                With the {name(t.civ)} until year {year(t.until)}
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.section}>Danger</Text>
        {relations.length === 0 && <Text style={styles.termLabel}>The {name(self)} have not met anyone yet.</Text>}
        {relations.map((r) => (
          <Pressable key={r.other} onPress={() => setOpen(open === r.other ? -1 : r.other)} style={styles.relation}>
            <View style={styles.relationHeader}>
              <View style={[styles.swatch, { backgroundColor: sim.civs[r.other]!.color }]} />
              <Text style={styles.relationName}>{name(r.other)}</Text>
              {sim.war.foe[self * PAIRS + r.other] > 0 && <Text style={styles.atWar}>at war</Text>}
            </View>
            <Text style={styles.line}>
              Danger from them {Math.round(r.danger)}
              <Text style={styles.muted}>
                {'  '}they feel from us {Math.round(r.theirDanger)} · their strength{' '}
                {Math.round(sim.military.strength[r.other] ?? 0)}
              </Text>
            </Text>
            {open === r.other &&
              r.dangerTerms.map((t, i) => (
                <TermRow key={i} term={t} />
              ))}
          </Pressable>
        ))}

        <Text style={styles.note}>
          A people may declare war on a neighbor it borders once it is at least {WAR.ratio} times as strong. Each side
          sends {Math.round(WAR.sendShare * 100)} % of its soldiers in up to {WAR.maxArmies} armies; they march to the
          goal seat and fight whoever they meet. A seat besieged for {WAR.occupyWeeks / TICKS_PER_YEAR} years whose
          settlement is unhappy is occupied. Only then may the defender give up, when it has less than{' '}
          {Math.round(BATTLE.giveUp * 100)} % of the attacker's strength; the goal's district changes hands. After {WAR.exhaustYears} years without success the war ends, followed by a truce of {WAR.truceYears} years. Allies join a war only when it starts, each with one army. Tap
          a people for the parts of its danger.
        </Text>
      </ScrollView>
    </View>
  );
}

/** One war of the people: as main party (attacker or defender) or as an ally of one. */
function WarBlock({
  sim,
  war,
  name,
  year,
}: {
  sim: Simulation;
  war: CivWar;
  name: (civ: number) => string;
  year: (tick: number) => number;
}) {
  const list = (civs: number[]) => civs.map((c) => `the ${name(c)}`).join(', ');
  const title = war.ally
    ? `Ally of the ${name(war.partner)} against the ${name(war.enemy)}`
    : war.attacker
      ? `At war against the ${name(war.enemy)}`
      : `Attacked by the ${name(war.enemy)}`;
  const goalOwner = war.attacker ? `the ${name(war.enemy)}` : war.ally ? `the ${name(war.partner)}` : 'ours';
  return (
    <View style={styles.block}>
      <Text style={styles.name}>{title}</Text>
      <Text style={styles.line}>
        Since year {year(war.startTick)} · {war.battles} battle{war.battles === 1 ? '' : 's'}
      </Text>
      {war.ownSide.length > 0 && <Text style={styles.line}>On our side: {list(war.ownSide)}</Text>}
      <Text style={styles.line}>Against: {list(war.otherSide)}</Text>
      <Text style={styles.line}>
        Goal: a seat of government ({goalOwner}) at {place(sim.world, war.goal)}
      </Text>
      <Text style={styles.line}>
        {war.siegeStart < 0
          ? 'The goal is not besieged.'
          : war.occupied
            ? `Occupied, besieged since year ${year(war.siegeStart)}`
            : `Besieged since year ${year(war.siegeStart)}`}
      </Text>
      <ArmyList sim={sim} title="Our armies" armies={war.ownArmies} name={null} />
      {war.allyArmies.length > 0 && <ArmyList sim={sim} title="Allied armies" armies={war.allyArmies} name={name} />}
      <ArmyList sim={sim} title="Their armies" armies={war.enemyArmies} name={war.otherSide.length > 1 ? name : null} />
    </View>
  );
}

function ArmyList({
  sim,
  title,
  armies,
  name,
}: {
  sim: Simulation;
  title: string;
  armies: ArmyInfo[];
  /** Shows each army's people (for lists of several peoples). */
  name: ((civ: number) => string) | null;
}) {
  return (
    <>
      <Text style={styles.section}>
        {title} ({armies.length})
      </Text>
      {armies.length === 0 && <Text style={styles.termLabel}>None in the field.</Text>}
      {armies.map((a) => (
        <ArmyRow key={a.slot} world={sim.world} army={a} people={name ? name(a.civ) : null} />
      ))}
    </>
  );
}

/** A hex as "col, row". */
function place(world: World, cell: number): string {
  const col = cell % world.width;
  return `${col}, ${(cell - col) / world.width}`;
}

function ArmyRow({ world, army, people }: { world: World; army: ArmyInfo; people: string | null }) {
  return (
    <View style={styles.termRow}>
      <Text style={styles.termLabel}>
        {people ? `${people} at ` : 'At '}
        {place(world, army.cell)}
        {army.state === ArmyState.Gathering ? ' · gathering' : army.state === ArmyState.Retreating ? ' · retreating' : ''}
        {army.besieging ? ' · besieging the goal' : ''}
      </Text>
      <Text style={styles.termValue}>
        {army.soldiers} soldiers · strength {Math.round(army.strength)}
      </Text>
    </View>
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
  atWar: { color: WAR_TEXT, fontSize: 12, fontWeight: '700' },
  warDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: WAR_TEXT },
  scroll: { marginTop: spacing.sm },
  block: { paddingVertical: spacing.xs },
  name: { color: colors.panelText, fontSize: 16, fontWeight: '700', marginTop: spacing.sm },
  line: { color: colors.panelText, fontSize: 13, marginTop: 4 },
  muted: { color: colors.panelMuted },
  section: { color: colors.panelText, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
  relation: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.barTrack },
  relationHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  relationName: { color: colors.panelText, fontSize: 15, fontWeight: '700', flex: 1 },
  termRow: { flexDirection: 'row', paddingLeft: spacing.md, paddingVertical: 1 },
  termLabel: { color: colors.panelMuted, fontSize: 12, flex: 1 },
  termValue: { color: colors.panelMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  note: { color: colors.panelMuted, fontSize: 11, marginTop: spacing.sm, fontStyle: 'italic' },
});

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ABILITIES, Ab, SHIFT_DRIER, SHIFT_WETTER, TIER_NAMES, TargetKind, livingCivilizations, type Simulation } from '../sim';
import { colors, spacing } from '../theme';
import { TIER_COLORS } from './GachaPanel';

/** A charge being cast: the ability, Biome Shift's direction, the chosen target (-1: none yet), a line of feedback. */
export type CastState = { ability: number; option: number; target: number; message: string | null };

type Props = {
  sim: Simulation;
  cast: CastState;
  /** Valid targets now (hexes, or people ids). */
  valid: ReadonlySet<number>;
  onOption: (option: number) => void;
  /** A people chosen in the list (people and leader abilities). */
  onPick: (target: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The target choice of a charge (Requirement Gacha 5, 8): what to tap,
 * Biome Shift's "Wetter / Drier", for peoples and leaders a list (or a tap
 * on one of their hexes), then Confirm or Cancel. Valid targets glow on the
 * map; an invalid one says why and costs no charge.
 */
export function CastBar({ sim, cast, valid, onOption, onPick, onConfirm, onCancel }: Props) {
  const ability = ABILITIES[cast.ability];
  const onHex = ability.target === TargetKind.Hex;
  const charges = sim.gacha.charges[cast.ability];
  const civs = onHex ? [] : livingCivilizations(sim).sort((a, b) => Number(b.worshipsPlayer) - Number(a.worshipsPlayer) || b.population - a.population);
  const chosen = cast.target >= 0 ? targetName(sim, cast.ability, cast.target) : null;

  return (
    <View style={styles.bar}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            {ability.name}
            <Text style={[styles.tier, { color: TIER_COLORS[ability.tier] }]}>{'  ' + TIER_NAMES[ability.tier]}</Text>
            <Text style={styles.count}>{`  ×${charges}`}</Text>
          </Text>
          <Text style={styles.line}>
            {chosen
              ? `Target: ${chosen}`
              : onHex
                ? 'Tap a glowing hex on the map.'
                : ability.target === TargetKind.Leader
                  ? "Choose a people's leader below, or tap one of its hexes."
                  : 'Choose a people below, or tap one of its hexes.'}
          </Text>
        </View>
        <Pressable onPress={onCancel} hitSlop={12} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      {cast.ability === Ab.BiomeShift && (
        <View style={styles.options}>
          {[SHIFT_WETTER, SHIFT_DRIER].map((o) => (
            <Pressable key={o} onPress={() => onOption(o)} style={[styles.option, cast.option === o && styles.optionActive]}>
              <Text style={[styles.optionText, cast.option === o && styles.optionTextActive]}>{o === SHIFT_WETTER ? 'Wetter' : 'Drier'}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {!onHex && (
        <ScrollView horizontal style={styles.chips} contentContainerStyle={styles.chipRow} showsHorizontalScrollIndicator={false}>
          {civs.map((civ) => {
            const ok = valid.has(civ.id);
            return (
              <Pressable
                key={civ.id}
                onPress={() => onPick(civ.id)}
                style={[styles.chip, civ.id === cast.target && styles.chipActive, !ok && styles.chipOff]}
              >
                <View style={[styles.swatch, { backgroundColor: civ.color }]} />
                <Text style={styles.chipText}>{civ.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {cast.message && <Text style={styles.message}>{cast.message}</Text>}

      <View style={styles.actions}>
        <Pressable onPress={onCancel} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={onConfirm}
          disabled={cast.target < 0}
          style={({ pressed }) => [styles.confirm, cast.target < 0 && styles.confirmOff, pressed && styles.pressed]}
        >
          <Text style={[styles.confirmText, cast.target < 0 && styles.confirmTextOff]}>Confirm</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** "the Varu", "the leader of the Varu", or a hex as "hex 12, 30 (Forest)". */
export function targetName(sim: Simulation, ability: number, target: number): string {
  const a = ABILITIES[ability];
  if (a.target === TargetKind.Hex) {
    const w = sim.world;
    return `hex ${target % w.width}, ${Math.floor(target / w.width)}`;
  }
  const name = sim.civs[target]?.name ?? 'a people';
  return a.target === TargetKind.Leader ? `the leader of the ${name}` : `the ${name}`;
}

/** Why a target may not take this charge, in plain words (the core's target check, Requirement Gacha 5). */
export function invalidText(ability: number): string {
  switch (ability) {
    case Ab.FertileBlessing:
    case Ab.Drought:
    case Ab.ExhaustedSoil:
    case Ab.GreatRiver:
    case Ab.WideFoundations:
      return 'Needs a land hex.';
    case Ab.CrampedGround:
      return 'Needs a land hex with a free building slot.';
    case Ab.RichVein:
      return 'Needs a land hex without a deposit.';
    case Ab.WildFire:
      return "Needs a forest, jungle or savanna that isn't burning.";
    case Ab.BiomeShift:
      return 'No land there can turn that way (sea, lakes, ice and holy places stay).';
    case Ab.GiftOfTrait:
    case Ab.MarkOfWeakness:
      return 'Needs a leader who can still gain such a trait.';
    case Ab.HonedMind:
      return 'Needs a leader with a trait.';
    case Ab.RerollDestiny:
      return 'Needs a leader whose goal is still open.';
  }
  return ABILITIES[ability].target === TargetKind.Hex ? 'Not a valid target.' : ABILITIES[ability].target === TargetKind.Leader ? 'Needs a people with a leader.' : 'Needs a living people.';
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  headerText: { flex: 1 },
  title: { color: colors.panelText, fontSize: 16, fontWeight: '700' },
  tier: { fontSize: 12, fontWeight: '600' },
  count: { color: colors.panelMuted, fontSize: 12, fontWeight: '600' },
  line: { color: colors.panelText, fontSize: 13, marginTop: 2 },
  close: { padding: spacing.xs },
  closeText: { color: colors.panelMuted, fontSize: 18 },
  options: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  option: { borderRadius: 8, paddingHorizontal: spacing.md, height: 32, justifyContent: 'center', backgroundColor: colors.barTrack },
  optionActive: { backgroundColor: colors.accent },
  optionText: { color: colors.panelText, fontWeight: '700', fontSize: 13 },
  optionTextActive: { color: colors.panel },
  chips: { marginTop: spacing.sm, flexGrow: 0 },
  chipRow: { gap: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, height: 32, borderRadius: 16, backgroundColor: colors.barTrack },
  chipActive: { borderWidth: 2, borderColor: colors.accent },
  chipOff: { opacity: 0.4 },
  chipText: { color: colors.panelText, fontSize: 13, fontWeight: '600' },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  message: { color: '#ff9b7a', fontSize: 13, marginTop: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  cancel: { borderRadius: 10, borderWidth: 1, borderColor: colors.panelMuted, paddingHorizontal: spacing.md, height: 36, justifyContent: 'center' },
  cancelText: { color: colors.panelMuted, fontWeight: '700', fontSize: 14 },
  confirm: { borderRadius: 10, backgroundColor: colors.accent, paddingHorizontal: spacing.md, height: 36, justifyContent: 'center' },
  confirmOff: { backgroundColor: colors.barTrack },
  confirmText: { color: colors.panel, fontWeight: '700', fontSize: 14 },
  confirmTextOff: { color: colors.panelMuted },
  pressed: { opacity: 0.7 },
});

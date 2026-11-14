import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ABILITIES, ABILITY_COUNT, CATEGORY_NAMES, GACHA, TICKS_PER_YEAR, TIER_NAMES, TargetKind, nextPullPrice, type Simulation } from '../sim';
import { pullCharges } from '../state/worldStore';
import { colors, spacing } from '../theme';

/** Rarity colors (Requirement Gacha 8): Common grey, Rare blue, Epic violet, Legendary gold. */
export const TIER_COLORS = ['#a3a8b3', '#4f9de8', '#b07cff', '#f0c24b'] as const;
/** Pause between revealing the drawn abilities one after another. */
const REVEAL_MS = 350;

type Props = {
  sim: Simulation;
  onClose: () => void;
  /** "Use" on a charge: closes the panel and starts the target choice. */
  onUse: (ability: number) => void;
};

/**
 * The gacha (Requirement Gacha 3-5, 8): Faith and the next price, "Pull (3)",
 * the abilities drawn (revealed one by one, in their rarity's color, kept
 * until the player closes them), and the inventory of charges by category
 * and rarity; tapping one shows what it does and "Use".
 */
export function GachaPanel({ sim, onClose, onUse }: Props) {
  const g = sim.gacha;
  const price = nextPullPrice(sim);
  const affordable = g.faith >= price && !sim.gameOver;
  const [drawn, setDrawn] = useState<number[] | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [open, setOpen] = useState(-1);

  useEffect(() => {
    if (!drawn || revealed >= drawn.length) return;
    const timer = setTimeout(() => setRevealed((n) => n + 1), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [drawn, revealed]);

  const pull = () => {
    const result = pullCharges();
    if (!result) return;
    setDrawn(result);
    setRevealed(0);
  };

  // Charges by category, then rarest first; an ability with several charges is one row with its count.
  const owned: number[] = [];
  for (let a = 0; a < ABILITY_COUNT; a++) if (g.charges[a] > 0) owned.push(a);
  owned.sort((a, b) => ABILITIES[a].category - ABILITIES[b].category || ABILITIES[b].tier - ABILITIES[a].tier || a - b);
  const total = owned.reduce((n, a) => n + g.charges[a], 0);

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Gacha</Text>
          <Text style={styles.subtitle}>
            Faith {formatFaith(g.faith)} · next pull {price} · {sim.believers} believers give{' '}
            {formatFaith(sim.believers * GACHA.faithPerBeliever * TICKS_PER_YEAR)} a year
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={pull}
        disabled={!affordable}
        style={({ pressed }) => [styles.pull, !affordable && styles.pullOff, pressed && styles.pressed]}
      >
        <Text style={[styles.pullText, !affordable && styles.pullTextOff]}>
          {affordable ? `Pull (3) · ${price} Faith` : `Pull (3) · ${formatFaith(price - g.faith)} Faith to go`}
        </Text>
      </Pressable>

      {drawn && (
        <View style={styles.drawn}>
          {drawn.map((a, i) => (
            <View key={i} style={[styles.card, { borderColor: i < revealed ? TIER_COLORS[ABILITIES[a].tier] : colors.barTrack }]}>
              {i < revealed ? (
                <>
                  <Text style={[styles.cardTier, { color: TIER_COLORS[ABILITIES[a].tier] }]}>{TIER_NAMES[ABILITIES[a].tier]}</Text>
                  <Text style={styles.cardName}>{ABILITIES[a].name}</Text>
                  <Text style={styles.cardCategory}>{CATEGORY_NAMES[ABILITIES[a].category]}</Text>
                </>
              ) : (
                <Text style={styles.cardHidden}>?</Text>
              )}
            </View>
          ))}
          {revealed >= drawn.length && (
            <Pressable onPress={() => setDrawn(null)} hitSlop={8} style={styles.dismiss}>
              <Text style={styles.dismissText}>OK</Text>
            </Pressable>
          )}
        </View>
      )}

      <ScrollView style={styles.scroll}>
        <Text style={styles.section}>
          Charges {total > 0 ? `(${total})` : ''}
        </Text>
        {owned.length === 0 && (
          <Text style={styles.note}>No charges yet. Each pull adds 3 abilities as charges; use them on the land, a people or a leader.</Text>
        )}
        {owned.map((a, i) => {
          const ability = ABILITIES[a];
          const newCategory = i === 0 || ABILITIES[owned[i - 1]].category !== ability.category;
          return (
            <View key={a}>
              {newCategory && <Text style={styles.category}>{CATEGORY_NAMES[ability.category]}</Text>}
              <Pressable onPress={() => setOpen(open === a ? -1 : a)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <View style={[styles.dot, { backgroundColor: TIER_COLORS[ability.tier] }]} />
                <Text style={styles.rowName}>{ability.name}</Text>
                <Text style={[styles.rowTier, { color: TIER_COLORS[ability.tier] }]}>{TIER_NAMES[ability.tier]}</Text>
                <Text style={styles.rowCount}>×{g.charges[a]}</Text>
              </Pressable>
              {open === a && (
                <View style={styles.detail}>
                  <Text style={styles.about}>{ability.about}</Text>
                  <Text style={styles.target}>{targetText(a)}</Text>
                  <Pressable
                    disabled={sim.gameOver}
                    onPress={() => onUse(a)}
                    style={({ pressed }) => [styles.use, pressed && styles.pressed]}
                  >
                    <Text style={styles.useText}>Use</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
        <Text style={styles.note}>
          All believers of you, in every people, give Faith as the weeks pass. Every pull costs more than the one before.
        </Text>
      </ScrollView>
    </View>
  );
}

/** What a charge is cast on, in plain words. */
export function targetText(ability: number): string {
  const a = ABILITIES[ability];
  if (a.target === TargetKind.People) return 'Target: a people (also your own).';
  if (a.target === TargetKind.Leader) return "Target: a people's leader.";
  const area = a.radius === 0 ? 'one hex' : a.radius === 1 ? '7 hexes' : a.radius === 3 ? '37 hexes' : 'a hex where it starts';
  return `Target: a hex on the map · ${area}${a.years > 0 ? ` · ${a.years} years` : ''}.`;
}

/** Faith with one decimal below 100, whole above. */
export function formatFaith(faith: number): string {
  return faith < 100 ? (Math.floor(faith * 10) / 10).toFixed(1) : String(Math.floor(faith));
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    maxHeight: '70%',
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
  pull: {
    marginTop: spacing.sm,
    backgroundColor: '#3fa860',
    borderRadius: 10,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pullOff: { backgroundColor: colors.barTrack },
  pullText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
  pullTextOff: { color: colors.panelMuted },
  pressed: { opacity: 0.7 },
  drawn: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, alignItems: 'stretch' },
  card: {
    flex: 1,
    minHeight: 72,
    borderWidth: 2,
    borderRadius: 10,
    padding: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c2029',
  },
  cardTier: { fontSize: 11, fontWeight: '700' },
  cardName: { color: colors.panelText, fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  cardCategory: { color: colors.panelMuted, fontSize: 11, marginTop: 2 },
  cardHidden: { color: colors.panelMuted, fontSize: 24, fontWeight: '700' },
  dismiss: { justifyContent: 'center', paddingHorizontal: spacing.xs },
  dismissText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  scroll: { marginTop: spacing.sm },
  section: { color: colors.panelText, fontSize: 14, fontWeight: '700', marginBottom: spacing.xs },
  category: { color: colors.panelMuted, fontSize: 12, fontWeight: '700', marginTop: spacing.sm, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowName: { color: colors.panelText, fontSize: 14, fontWeight: '600', flex: 1 },
  rowTier: { fontSize: 12, fontWeight: '600' },
  rowCount: { color: colors.panelText, fontSize: 14, fontWeight: '700', minWidth: 32, textAlign: 'right' },
  detail: { paddingLeft: 18, paddingBottom: spacing.sm },
  about: { color: colors.panelText, fontSize: 13 },
  target: { color: colors.panelMuted, fontSize: 12, marginTop: 2 },
  use: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    height: 32,
    justifyContent: 'center',
  },
  useText: { color: colors.panel, fontWeight: '700', fontSize: 14 },
  note: { color: colors.panelMuted, fontSize: 11, marginTop: spacing.sm, fontStyle: 'italic' },
});

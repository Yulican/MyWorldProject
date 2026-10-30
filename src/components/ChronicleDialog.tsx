import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TICKS_PER_YEAR, type ChronicleEntry } from '../sim';
import { colors, spacing } from '../theme';
import { TimeControls } from './TimeControls';

type Props = {
  entry: ChronicleEntry;
  /** Entries still waiting after this one. */
  more: number;
  /** Speed the game continues at when the dialog closes; the player can change it here (pause keeps it paused). */
  resumeSpeed: number;
  onResumeSpeed: (speed: number) => void;
  /** Jumps to the entry's hex (only for entries that have one). */
  onGoTo: (cell: number) => void;
  onOk: () => void;
};

/**
 * A notable event of the chronicle. The game pauses while it is open and
 * continues at the speed chosen in it.
 */
export function ChronicleDialog({ entry, more, resumeSpeed, onResumeSpeed, onGoTo, onOk }: Props) {
  return (
    <View style={styles.backdrop}>
      <View style={styles.dialog}>
        <Text style={styles.year}>Year {Math.floor(entry.tick / TICKS_PER_YEAR) + 1}</Text>
        <Text style={styles.text}>{entry.text}</Text>
        <Text style={styles.note}>Paused. The game continues at this speed:</Text>
        <TimeControls speed={resumeSpeed} onChange={onResumeSpeed} />
        <View style={styles.buttons}>
          {entry.cell >= 0 && (
            <Pressable
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={() => onGoTo(entry.cell)}
            >
              <Text style={styles.secondaryText}>Go to</Text>
            </Pressable>
          )}
          <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={onOk}>
            <Text style={styles.primaryText}>{more > 0 ? `Next (${more} more)` : 'OK'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  dialog: { backgroundColor: colors.panel, borderRadius: 14, padding: spacing.lg, gap: spacing.sm },
  year: { color: colors.panelMuted, fontSize: 13 },
  text: { color: colors.panelText, fontSize: 17, fontWeight: '600' },
  note: { color: colors.panelMuted, fontSize: 12, marginTop: spacing.sm },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  primary: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  primaryText: { color: colors.panel, fontWeight: '700', fontSize: 14 },
  secondary: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  pressed: { opacity: 0.7 },
});

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SPEEDS } from '../state/worldStore';
import { colors, spacing } from '../theme';

const LABELS = ['❚❚', '▶', '▶▶', '▶▶▶'];

type Props = {
  speed: number;
  onChange: (speed: number) => void;
  disabled?: boolean;
};

/** Pause and the time-lapse speed levels. */
export function TimeControls({ speed, onChange, disabled }: Props) {
  return (
    <View style={styles.row}>
      {SPEEDS.map((_, level) => {
        const active = level === speed;
        return (
          <Pressable
            key={level}
            disabled={disabled}
            onPress={() => onChange(level)}
            hitSlop={4}
            style={({ pressed }) => [styles.button, active && styles.active, (pressed || disabled) && styles.dimmed]}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>{LABELS[level]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
  button: {
    minWidth: 44,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.barTrack,
    paddingHorizontal: spacing.sm,
  },
  active: { backgroundColor: colors.accent },
  dimmed: { opacity: 0.6 },
  label: { color: colors.panelText, fontSize: 13, fontWeight: '700' },
  activeLabel: { color: colors.panel },
});

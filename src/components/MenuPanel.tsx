import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SaveState } from '../state/saveGame';
import { colors, spacing } from '../theme';

type Props = {
  save: SaveState;
  onSave: () => Promise<boolean>;
  onLoad: () => void;
  onNewWorld: (saveFirst: boolean) => void;
  onClose: () => void;
};

/** How long "Saved" stays after a manual save. */
const SAVED_MS = 2000;

/** "2026-11-15 14:05": the save time, local. */
export function formatSaveTime(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * The menu (Requirement Speichern und Laden 4): the saved world (its age and
 * save time), Save, Load (asks first) and New World (save first, or not).
 * The game pauses while it is open.
 */
export function MenuPanel({ save, onSave, onLoad, onNewWorld, onClose }: Props) {
  const [ask, setAsk] = useState<'none' | 'load' | 'new'>('none');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);
  const busy = save.busy;

  return (
    <View style={styles.backdrop}>
      <View style={styles.dialog}>
        <View style={styles.header}>
          <Text style={styles.title}>Menu</Text>
          <Pressable onPress={onClose} hitSlop={8} disabled={busy}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
        {save.saved ? (
          <Text style={styles.info}>
            Saved world: year {save.saved.year} · saved {formatSaveTime(save.saved.savedAt)}
          </Text>
        ) : (
          <Text style={styles.info}>No saved world</Text>
        )}
        {save.autosaveFailed && <Text style={styles.hint}>Autosave failed.</Text>}
        {save.autosave === 'off' && <Text style={styles.hint}>Autosave is off for this world until you save.</Text>}
        <Text style={styles.note}>Paused while the menu is open.</Text>

        {ask === 'none' && (
          <View style={styles.buttons}>
            <Pressable
              style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
              disabled={busy}
              onPress={async () => {
                if (await onSave()) setSaved(true);
              }}
            >
              <Text style={styles.primaryText}>{busy ? 'Saving…' : saved ? 'Saved' : 'Save'}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondary, (pressed || busy || !save.saved) && styles.pressed]}
              disabled={busy || !save.saved}
              onPress={() => setAsk('load')}
            >
              <Text style={styles.secondaryText}>Load</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}
              disabled={busy}
              onPress={() => setAsk('new')}
            >
              <Text style={styles.secondaryText}>New World</Text>
            </Pressable>
          </View>
        )}
        {ask === 'load' && (
          <View style={styles.question}>
            <Text style={styles.text}>Load the saved world? Unsaved progress will be lost.</Text>
            <View style={styles.buttons}>
              <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => setAsk('none')}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                onPress={() => {
                  setAsk('none');
                  onLoad();
                }}
              >
                <Text style={styles.primaryText}>Load</Text>
              </Pressable>
            </View>
          </View>
        )}
        {ask === 'new' && (
          <View style={styles.question}>
            <Text style={styles.text}>Start a new world? The current world is lost unless it is saved.</Text>
            <View style={styles.buttons}>
              <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => setAsk('none')}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}
                disabled={busy}
                onPress={() => {
                  setAsk('none');
                  onNewWorld(false);
                }}
              >
                <Text style={styles.secondaryText}>New World</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
                disabled={busy}
                onPress={() => {
                  setAsk('none');
                  onNewWorld(true);
                }}
              >
                <Text style={styles.primaryText}>Save & New World</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

/** "Overwrite saved world?": the first autosave of a new world asks first; the game pauses meanwhile. */
export function OverwriteDialog({ onAnswer }: { onAnswer: (overwrite: boolean) => void }) {
  return (
    <View style={styles.backdrop}>
      <View style={styles.dialog}>
        <Text style={styles.text}>Overwrite saved world?</Text>
        <Text style={styles.note}>Autosave would replace your saved world with this one.</Text>
        <View style={styles.buttons}>
          <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => onAnswer(false)}>
            <Text style={styles.secondaryText}>Keep old save</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={() => onAnswer(true)}>
            <Text style={styles.primaryText}>Overwrite</Text>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.panelText, fontSize: 18, fontWeight: '700' },
  close: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  info: { color: colors.panelText, fontSize: 14 },
  hint: { color: colors.danger, fontSize: 12 },
  note: { color: colors.panelMuted, fontSize: 12 },
  text: { color: colors.panelText, fontSize: 16, fontWeight: '600' },
  question: { gap: spacing.sm, marginTop: spacing.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
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
  pressed: { opacity: 0.6 },
});

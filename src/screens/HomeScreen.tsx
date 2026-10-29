import { StyleSheet, Text } from 'react-native';
import { Screen } from '../components/Screen';
import { useApp } from '../hooks/useApp';
import { colors } from '../theme';

// Set by the CI build (branch · commit) so testers can see which build is installed.
const buildLabel = process.env.EXPO_PUBLIC_BUILD_LABEL ?? 'local dev build';

export function HomeScreen() {
  const { userName } = useApp();

  return (
    <Screen style={styles.center}>
      <Text style={styles.title}>MyWorldProject</Text>
      <Text style={styles.subtitle}>
        {userName ? `Hello, ${userName}!` : 'Setup complete.'}
      </Text>
      <Text style={styles.build}>{buildLabel}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 16, color: colors.textMuted, marginTop: 8 },
  build: { position: 'absolute', bottom: 8, fontSize: 11, color: colors.textMuted },
});

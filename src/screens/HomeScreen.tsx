import { StyleSheet, Text } from 'react-native';
import { Screen } from '../components/Screen';
import { useApp } from '../hooks/useApp';
import { colors } from '../theme';

export function HomeScreen() {
  const { userName } = useApp();

  return (
    <Screen style={styles.center}>
      <Text style={styles.title}>MyWorldProject</Text>
      <Text style={styles.subtitle}>
        {userName ? `Hallo, ${userName}!` : 'Setup erfolgreich.'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 16, color: colors.textMuted, marginTop: 8 },
});

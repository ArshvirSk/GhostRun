import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Card } from '../../src/ui/Card';
import { Button } from '../../src/ui/Button';
import { getAllBaseModes } from '../../src/modes/registry';

export default function ModesTab() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const modes = getAllBaseModes();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { padding: spacing.lg }]}>
        <Text variant="display" style={{ color: colors.text, marginTop: spacing.xl }}>
          MODES LIBRARY
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginBottom: spacing.lg }}>
          Tactical GPS game types built for physical outdoor evasion and intelligence.
        </Text>

        {modes.map((mode) => (
          <Card key={mode.id} variant="default" style={{ marginBottom: spacing.md, padding: spacing.md }}>
            <View style={styles.cardHeader}>
              <Text variant="title" style={{ color: colors.text }}>
                {mode.name}
              </Text>
              <Text variant="label" style={{ color: colors.accent }}>
                {mode.idealPlayers}
              </Text>
            </View>
            <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.md }}>
              {mode.tagline}
            </Text>
            <Button
              title="Host this Mode"
              variant="secondary"
              size="sm"
              onPress={() => {
                router.push({ pathname: '/host/mode' as any, params: { mode: mode.id } });
              }}
            />
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 100,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});

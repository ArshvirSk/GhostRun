import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { Button } from '../../src/ui/Button';
import { RulesCard } from '../../src/ui/RulesCard';
import { getModeModule } from '../../src/modes/registry';
import { useHostStore } from '../../src/stores/hostStore';

export default function ModeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const modeId = Array.isArray(id) ? id[0] : id;
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const module = modeId ? getModeModule(modeId) : undefined;

  if (!module) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name="alert-circle-outline" size={48} color={colors.warning} />
        <Text variant="title" style={{ color: colors.text, marginTop: spacing.md }}>
          UNKNOWN MISSION PROFILE
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' }}>
          The requested game mode is not in active registry service.
        </Text>
        <Button
          title="Return to Modes Library"
          variant="secondary"
          size="sm"
          style={{ marginTop: spacing.lg }}
          onPress={() => router.replace('/modes' as any)}
        />
      </View>
    );
  }

  const difficultyStars = '★'.repeat(module.difficulty) + '☆'.repeat(3 - module.difficulty);

  const handleHostMode = () => {
    useHostStore.getState().setMode(module.id);
    router.push('/host/rules' as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 80 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.backRow}
        >
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
          <Text variant="label" style={{ color: colors.primary, marginLeft: spacing.xs }}>
            MODES LIBRARY
          </Text>
        </Pressable>

        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="display" style={{ color: colors.text }}>
              {module.name}
            </Text>
            <Text variant="body" style={{ color: colors.textMuted, marginTop: 2 }}>
              {module.tagline}
            </Text>
          </View>
        </View>

        <View style={styles.badgeRow}>
          <Chip label={`PLAYERS: ${module.idealPlayers}`} variant="muted" size="sm" />
          <Chip label={`DIFFICULTY: ${difficultyStars}`} variant="accent" size="sm" />
          <Chip label={module.layer.toUpperCase()} variant="default" size="sm" />
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <RulesCard module={module} />
        </View>

        {module.briefing?.intel && module.briefing.intel.length > 0 && (
          <Card variant="default" style={[styles.intelCard, { marginTop: spacing.md }]}>
            <Text variant="label" style={{ color: colors.radarScan, marginBottom: spacing.xs }}>
              TACTICAL INTEL & BRIEFS
            </Text>
            {module.briefing.intel.map((bullet, idx) => (
              <View key={idx} style={styles.bulletRow}>
                <Text variant="mono" style={{ color: colors.radarScan, marginRight: spacing.xs }}>
                  ▸
                </Text>
                <Text variant="body" style={{ color: colors.text, flex: 1, fontSize: 13, lineHeight: 18 }}>
                  {bullet}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {module.compatibleWith && module.compatibleWith.length > 0 && (
          <Card variant="default" style={[styles.compatCard, { marginTop: spacing.md }]}>
            <Text variant="label" style={{ color: colors.ghostTrail, marginBottom: spacing.xs }}>
              COMPATIBLE MODIFIERS & ROLES
            </Text>
            <View style={styles.compatChips}>
              {module.compatibleWith.map((item: string) => (
                <Chip key={item} label={item.replace(/_/g, ' ').toUpperCase()} variant="muted" size="sm" />
              ))}
            </View>
          </Card>
        )}

        <View style={[styles.bottomCtaWrap, { marginTop: spacing.xl }]}>
          <Button
            title={`Host ${module.name}`}
            variant="primary"
            size="lg"
            icon="play"
            onPress={handleHostMode}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    paddingBottom: 64,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  intelCard: {
    padding: 16,
  },
  compatCard: {
    padding: 16,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 6,
  },
  compatChips: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 6,
  },
  bottomCtaWrap: {
    paddingTop: 12,
  },
});

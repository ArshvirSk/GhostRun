import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { Button } from '../../src/ui/Button';
import { RulesCard } from '../../src/ui/RulesCard';
import { getModeModule } from '../../src/modes/registry';
import { useHostStore } from '../../src/stores/hostStore';
import { triggerHaptic } from '../../src/motion/haptics';
import { ModeSimulationView } from '../../src/modes/components/ModeSimulationView';

const EXTRA_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  noise_meter: 'volume-high-outline',
  dead_drops: 'cube-outline',
  hot_cold: 'thermometer-outline',
  shrinking_zone: 'contract-outline',
  ai_gm: 'hardware-chip-outline',
  double_agent: 'finger-print-outline',
  vip: 'shield-checkmark-outline',
  operator: 'radio-outline',
};

class SimulationErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: any) {
    console.warn('ModeSimulationView caught error:', error);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default function ModeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const modeId = Array.isArray(id) ? id[0] : id;
  const { colors, spacing, radii } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [modifiersOpen, setModifiersOpen] = useState(false);
  const module = modeId ? getModeModule(modeId) : undefined;

  if (!module) {
    return (
      <View
        style={[
          styles.centerContainer,
          {
            backgroundColor: colors.background,
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
          },
        ]}
      >
        <MaterialCommunityIcons name="alert-circle-outline" size={48} color={colors.warning} />
        <Text variant="title" style={{ color: colors.text, marginTop: spacing.md }}>
          UNKNOWN MISSION PROFILE
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' }}>
          The requested game mode is not in active registry service.
        </Text>
        <Button
          title="Return to Game Modes"
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
    triggerHaptic('buttonTap');
    useHostStore.getState().setMode(module.id);
    router.push('/host/rules' as any);
  };

  const compatibleModules = (module.compatibleWith || [])
    .map((itemKey) => getModeModule(itemKey))
    .filter(Boolean);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: spacing.lg,
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 32,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Game Modes"
          onPress={() => router.back()}
          style={styles.backRow}
        >
          <Ionicons name="arrow-back" size={20} color={colors.primary} />
          <Text variant="label" style={{ color: colors.primary, marginLeft: spacing.xs }}>
            GAME MODES
          </Text>
        </Pressable>

        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="display" style={{ color: colors.text }}>
              {module.name}
            </Text>
            <Text variant="body" numberOfLines={2} style={{ color: colors.textMuted, marginTop: 4, lineHeight: 20 }}>
              {module.tagline}
            </Text>
          </View>
        </View>

        <View style={styles.badgeRow}>
          <Chip label={`PLAYERS: ${module.idealPlayers}`} variant="muted" size="sm" />
          <Chip label={`TIER: ${difficultyStars}`} variant="accent" size="sm" />
          <Chip label={module.layer.toUpperCase()} variant="default" size="sm" />
        </View>

        {/* Mode Rules Overview */}
        <View style={{ marginTop: spacing.md }}>
          <RulesCard module={module} />
        </View>

        {/* Tactical Intel & Briefing */}
        {module.briefing?.intel && module.briefing.intel.length > 0 && (
          <Card variant="default" style={[styles.intelCard, { marginTop: spacing.md, backgroundColor: colors.surface }]}>
            <Text variant="label" style={{ color: colors.radarScan, marginBottom: spacing.xs }}>
              TACTICAL INTEL & KEY MECHANICS
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

        {/* Compatible Modifiers & Roles Accordion */}
        {compatibleModules.length > 0 && (
          <View style={{ marginTop: spacing.md }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Toggle compatible modifiers for ${module.name}`}
              onPress={() => {
                triggerHaptic('buttonTap');
                setModifiersOpen(!modifiersOpen);
              }}
              style={[
                styles.modAccordionHeader,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderDark,
                  borderRadius: radii.md,
                },
              ]}
            >
              <View style={styles.modAccordionTitleRow}>
                <View style={[styles.modAccordionIconWrap, { backgroundColor: 'rgba(234, 179, 8, 0.12)' }]}>
                  <Ionicons name="sparkles-outline" size={16} color={colors.warning} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="label" style={{ color: colors.warning, fontSize: 12 }}>
                    COMPATIBLE MODIFIERS & ROLES ({compatibleModules.length})
                  </Text>
                  <Text variant="caption" style={{ color: colors.textMuted, marginTop: 1 }}>
                    {modifiersOpen ? 'Tap to collapse mutators list' : 'Tap to expand mutators & roles'}
                  </Text>
                </View>
              </View>
              <Ionicons
                name={modifiersOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textMuted}
              />
            </Pressable>

            {modifiersOpen && (
              <View style={[styles.modTileGrid, { marginTop: spacing.sm }]}>
                {compatibleModules.map((item) => {
                  if (!item) return null;
                  const icon = EXTRA_ICONS[item.id] || 'sparkles-outline';

                  return (
                    <Card
                      key={item.id}
                      variant="default"
                      style={[
                        styles.modDetailTile,
                        { backgroundColor: colors.surface, borderColor: colors.borderDark },
                      ]}
                    >
                      <View style={styles.modTileTop}>
                        <View
                          style={[
                            styles.modIconWrap,
                            {
                              backgroundColor:
                                item.layer === 'role'
                                  ? 'rgba(184, 163, 255, 0.12)'
                                  : 'rgba(234, 179, 8, 0.12)',
                            },
                          ]}
                        >
                          <Ionicons
                            name={icon}
                            size={16}
                            color={item.layer === 'role' ? colors.accent : colors.warning}
                          />
                        </View>
                        <Chip
                          label={item.layer === 'role' ? 'ROLE' : 'MODIFIER'}
                          variant={item.layer === 'role' ? 'accent' : 'default'}
                          size="sm"
                        />
                      </View>
                      <Text variant="title" style={{ color: colors.text, fontSize: 13, marginTop: 6 }}>
                        {item.name}
                      </Text>
                      <Text variant="caption" numberOfLines={2} style={{ color: colors.textMuted, marginTop: 2, fontSize: 11, lineHeight: 15 }}>
                        {item.tagline}
                      </Text>
                    </Card>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Visual Tactical Simulation: Mode in Action */}
        <SimulationErrorBoundary>
          <ModeSimulationView modeId={module.id} />
        </SimulationErrorBoundary>

        {/* Host Mode Action Button */}
        <View style={[styles.bottomCtaWrap, { marginTop: spacing.md }]}>
          <Button
            title={`Host ${module.name}`}
            variant="primary"
            size="lg"
            icon={<Ionicons name="play" size={18} color={colors.primaryText} />}
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
    borderWidth: 1,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 6,
  },
  modAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderWidth: 1,
  },
  modAccordionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  modAccordionIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modTileGrid: {
    gap: 8,
  },
  modDetailTile: {
    padding: 12,
    borderWidth: 1,
  },
  modTileTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomCtaWrap: {
    paddingTop: 8,
  },
});

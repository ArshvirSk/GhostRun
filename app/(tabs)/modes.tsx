import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { Button } from '../../src/ui/Button';
import { SegmentBar } from '../../src/ui/SegmentBar';
import {
  getAllBaseModes,
  getAllModifiers,
  getAllRoles,
  getModeModule,
} from '../../src/modes/registry';
import { useHostStore } from '../../src/stores/hostStore';
import { triggerHaptic } from '../../src/motion/haptics';

type PlayerFilter = 'all' | 'solo' | 'squad' | 'massive';
type DifficultyFilter = 'all' | '1' | '2' | '3';
type TabKey = 'modes' | 'modifiers';

const MODIFIER_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  // Global Modifiers
  noise_meter: 'volume-high-outline',
  dead_drops: 'cube-outline',
  hot_cold: 'thermometer-outline',
  shrinking_zone: 'contract-outline',
  ai_gm: 'hardware-chip-outline',
  // Player Modifiers / Roles
  double_agent: 'finger-print-outline',
  vip: 'shield-checkmark-outline',
  operator: 'radio-outline',
};

export default function ModesTab() {
  const { colors, spacing, radii } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>('modes');
  const [playerFilter, setPlayerFilter] = useState<PlayerFilter>('all');
  const [diffFilter, setDiffFilter] = useState<DifficultyFilter>('all');

  const allModes = getAllBaseModes();
  const allModifiers = getAllModifiers();
  const allRoles = getAllRoles();

  const filteredModes = useMemo(() => {
    return allModes.filter((m) => {
      // Player filter
      if (playerFilter === 'solo' && m.minPlayers !== 1) return false;
      if (playerFilter === 'squad' && (m.minPlayers < 2 || m.minPlayers > 4)) return false;
      if (playerFilter === 'massive' && m.minPlayers < 5) return false;

      // Difficulty filter
      if (diffFilter !== 'all' && m.difficulty.toString() !== diffFilter) return false;

      return true;
    });
  }, [allModes, playerFilter, diffFilter]);

  const handleHost = (modeId: string) => {
    triggerHaptic('buttonTap');
    useHostStore.getState().setMode(modeId);
    router.push('/host/rules' as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: 18,
            paddingTop: Math.max(insets.top, 20) + spacing.md,
            paddingBottom: Math.max(insets.bottom, 20) + 100,
          },
        ]}
      >
        <Text variant="display" style={{ color: colors.text, marginTop: spacing.xs }}>
          GAME MODES & MUTATORS
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginTop: 4, marginBottom: spacing.md }}>
          Outdoor tactical GPS game modes, field modifiers, and specialized roles.
        </Text>

        {/* Top 2-Tab Switcher */}
        <SegmentBar
          items={[
            { id: 'modes', label: `MODES (${allModes.length})` },
            { id: 'modifiers', label: `MODIFIERS (${allModifiers.length + allRoles.length})` },
          ]}
          activeId={activeTab}
          onChange={(id) => {
            triggerHaptic('buttonTap');
            setActiveTab(id as TabKey);
          }}
          style={{ marginBottom: spacing.md }}
        />

        {activeTab === 'modes' ? (
          <>
            {/* Squad Size & Complexity Filters */}
            <View style={styles.filterSection}>
              <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
                SQUAD SIZE
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterScrollView}
                contentContainerStyle={styles.filterRow}
              >
                {(
                  [
                    { id: 'all', label: 'ALL SIZES' },
                    { id: 'solo', label: 'SOLO (1)' },
                    { id: 'squad', label: 'SQUAD (2–4)' },
                    { id: 'massive', label: 'MASSIVE (5+)' },
                  ] as const
                ).map((opt) => (
                  <Chip
                    key={opt.id}
                    label={opt.label}
                    variant={playerFilter === opt.id ? 'accent' : 'muted'}
                    size="sm"
                    onPress={() => setPlayerFilter(opt.id)}
                  />
                ))}
              </ScrollView>

              <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.xs }}>
                COMPLEXITY
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterScrollView}
                contentContainerStyle={styles.filterRow}
              >
                {(
                  [
                    { id: 'all', label: 'ALL TIERS' },
                    { id: '1', label: 'CASUAL ★' },
                    { id: '2', label: 'TACTICAL ★★' },
                    { id: '3', label: 'HARDCORE ★★★' },
                  ] as const
                ).map((opt) => (
                  <Chip
                    key={opt.id}
                    label={opt.label}
                    variant={diffFilter === opt.id ? 'accent' : 'muted'}
                    size="sm"
                    onPress={() => setDiffFilter(opt.id)}
                  />
                ))}
              </ScrollView>
            </View>

            {/* Mode Cards */}
            <View style={{ marginTop: spacing.md }}>
              {filteredModes.map((mode) => {
                const stars = '★'.repeat(mode.difficulty) + '☆'.repeat(3 - mode.difficulty);
                return (
                  <Card
                    key={mode.id}
                    variant="default"
                    style={[
                      styles.modeCard,
                      { backgroundColor: colors.surface, borderColor: colors.borderDark, marginBottom: spacing.md },
                    ]}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1, marginRight: spacing.sm }}>
                        <Text variant="title" style={{ color: colors.text }}>
                          {mode.name}
                        </Text>
                        <Text variant="body" numberOfLines={2} style={{ color: colors.textMuted, marginTop: 3, fontSize: 13, lineHeight: 18 }}>
                          {mode.tagline}
                        </Text>
                      </View>
                      <Chip label={stars} variant="accent" size="sm" />
                    </View>

                    <View style={styles.badgeRow}>
                      <Chip label={`PLAYERS: ${mode.idealPlayers}`} variant="muted" size="sm" />
                      <Chip label={mode.layer.toUpperCase()} variant="default" size="sm" />
                    </View>

                    <View style={styles.cardActions}>
                      <Button
                        title="Details"
                        variant="secondary"
                        size="sm"
                        style={{ flex: 1 }}
                        onPress={() => router.push({ pathname: '/modes/[id]', params: { id: mode.id } } as any)}
                      />
                      <Button
                        title="Host Mode"
                        variant="primary"
                        size="sm"
                        icon={<Ionicons name="play" size={13} color={colors.primaryText} />}
                        style={{ flex: 1 }}
                        onPress={() => handleHost(mode.id)}
                      />
                    </View>
                  </Card>
                );
              })}

              {filteredModes.length === 0 && (
                <View style={[styles.emptyBox, { borderColor: colors.borderDark }]}>
                  <MaterialCommunityIcons name="filter-remove-outline" size={32} color={colors.textMuted} />
                  <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs }}>
                    No modes match the selected filters.
                  </Text>
                  <Button
                    title="Reset Filters"
                    variant="secondary"
                    size="sm"
                    style={{ marginTop: spacing.sm }}
                    onPress={() => {
                      setPlayerFilter('all');
                      setDiffFilter('all');
                    }}
                  />
                </View>
              )}
            </View>
          </>
        ) : (
          /* Modifiers & Roles Tab */
          <View style={styles.modifiersTabContainer}>
            {/* Section 1: Global Modifiers */}
            <View style={styles.sectionHeaderWrap}>
              <View style={[styles.sectionDot, { backgroundColor: colors.warning }]} />
              <Text variant="label" style={{ color: colors.warning, fontSize: 12 }}>
                GLOBAL MODIFIERS ({allModifiers.length})
              </Text>
            </View>
            <Text variant="caption" style={{ color: colors.textMuted, marginBottom: spacing.sm }}>
              Environmental conditions, mechanics, and hazards that affect every player.
            </Text>

            <View style={styles.modList}>
              {allModifiers.map((mod) => {
                const iconName = MODIFIER_ICONS[mod.id] || 'sparkles-outline';
                const supportedModeNames = mod.compatibleWith
                  .map((id) => getModeModule(id)?.name || id)
                  .slice(0, 3)
                  .join(', ');
                const moreCount = mod.compatibleWith.length > 3 ? ` +${mod.compatibleWith.length - 3}` : '';

                return (
                  <Card
                    key={mod.id}
                    variant="default"
                    style={[
                      styles.modifierCard,
                      { backgroundColor: colors.surface, borderColor: colors.borderDark },
                    ]}
                  >
                    <View style={styles.modCardTop}>
                      <View style={[styles.modIconWrap, { backgroundColor: 'rgba(234, 179, 8, 0.12)' }]}>
                        <Ionicons name={iconName} size={18} color={colors.warning} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text variant="title" style={{ color: colors.text, fontSize: 15 }}>
                          {mod.name}
                        </Text>
                        <Text variant="caption" numberOfLines={2} style={{ color: colors.textMuted, marginTop: 2, lineHeight: 16 }}>
                          {mod.tagline}
                        </Text>
                      </View>
                      <Chip
                        label={mod.complexity === 'high' ? 'ADVANCED' : 'MUTATOR'}
                        variant="default"
                        size="sm"
                      />
                    </View>

                    {mod.briefing?.intel?.[0] ? (
                      <View style={styles.modIntelRow}>
                        <Text variant="mono" style={{ color: colors.warning, marginRight: 6 }}>▸</Text>
                        <Text variant="caption" style={{ color: colors.textSecondary, flex: 1, fontSize: 11, lineHeight: 15 }}>
                          {mod.briefing.intel[0]}
                        </Text>
                      </View>
                    ) : null}

                    <View style={[styles.modFooterRow, { borderTopColor: colors.borderLight }]}>
                      <Ionicons name="layers-outline" size={12} color={colors.textSubtle} />
                      <Text variant="caption" numberOfLines={1} style={{ color: colors.textSubtle, fontSize: 11, flex: 1, marginLeft: 4 }}>
                        Available in: {supportedModeNames}{moreCount}
                      </Text>
                    </View>
                  </Card>
                );
              })}
            </View>

            {/* Section 2: Player Modifiers & Roles */}
            <View style={[styles.sectionHeaderWrap, { marginTop: spacing.xl }]}>
              <View style={[styles.sectionDot, { backgroundColor: colors.accent }]} />
              <Text variant="label" style={{ color: colors.accent, fontSize: 12 }}>
                PLAYER MODIFIERS & SPECIAL ROLES ({allRoles.length})
              </Text>
            </View>
            <Text variant="caption" style={{ color: colors.textMuted, marginBottom: spacing.sm }}>
              Specialized operative classes and hidden assignments assigned to individual players.
            </Text>

            <View style={styles.modList}>
              {allRoles.map((role) => {
                const iconName = MODIFIER_ICONS[role.id] || 'person-outline';
                const supportedModeNames = role.compatibleWith
                  .map((id) => getModeModule(id)?.name || id)
                  .slice(0, 3)
                  .join(', ');
                const moreCount = role.compatibleWith.length > 3 ? ` +${role.compatibleWith.length - 3}` : '';

                return (
                  <Card
                    key={role.id}
                    variant="default"
                    style={[
                      styles.modifierCard,
                      { backgroundColor: colors.surface, borderColor: colors.borderDark },
                    ]}
                  >
                    <View style={styles.modCardTop}>
                      <View style={[styles.modIconWrap, { backgroundColor: 'rgba(184, 163, 255, 0.12)' }]}>
                        <Ionicons name={iconName} size={18} color={colors.accent} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text variant="title" style={{ color: colors.text, fontSize: 15 }}>
                          {role.name}
                        </Text>
                        <Text variant="caption" numberOfLines={2} style={{ color: colors.textMuted, marginTop: 2, lineHeight: 16 }}>
                          {role.tagline}
                        </Text>
                      </View>
                      <Chip
                        label="ROLE"
                        variant="accent"
                        size="sm"
                      />
                    </View>

                    {role.briefing?.intel?.[0] ? (
                      <View style={styles.modIntelRow}>
                        <Text variant="mono" style={{ color: colors.accent, marginRight: 6 }}>▸</Text>
                        <Text variant="caption" style={{ color: colors.textSecondary, flex: 1, fontSize: 11, lineHeight: 15 }}>
                          {role.briefing.intel[0]}
                        </Text>
                      </View>
                    ) : null}

                    <View style={[styles.modFooterRow, { borderTopColor: colors.borderLight }]}>
                      <Ionicons name="people-outline" size={12} color={colors.textSubtle} />
                      <Text variant="caption" numberOfLines={1} style={{ color: colors.textSubtle, fontSize: 11, flex: 1, marginLeft: 4 }}>
                        Available in: {supportedModeNames}{moreCount}
                      </Text>
                    </View>
                  </Card>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 110,
  },
  filterSection: {
    marginVertical: 4,
  },
  filterScrollView: {
    marginHorizontal: -18,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 4,
  },
  modeCard: {
    padding: 16,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  emptyBox: {
    padding: 32,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginTop: 16,
  },
  modifiersTabContainer: {
    marginTop: 4,
  },
  sectionHeaderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  sectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  modList: {
    gap: 10,
  },
  modifierCard: {
    padding: 14,
    borderWidth: 1,
  },
  modCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  modIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modIntelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  modFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
  },
});

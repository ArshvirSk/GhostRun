import React, { useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
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
import { TacticalPullRefreshScrollView } from '../../src/components/TacticalPullRefresh';

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

export function ModesContent() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const [activeTab, setActiveTab] = useState<TabKey>('modes');
  const [playerFilter, setPlayerFilter] = useState<PlayerFilter>('all');
  const [diffFilter, setDiffFilter] = useState<DifficultyFilter>('all');

  const allModes = getAllBaseModes();
  const allModifiers = getAllModifiers();
  const allRoles = getAllRoles();

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    triggerHaptic('buttonTap');
    await new Promise((r) => setTimeout(r, 600));
    setRefreshing(false);
  };

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

  const handleTabChange = (id: string) => {
    const tabKey = id as TabKey;
    setActiveTab(tabKey);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Sticky Top Header */}
      <View
        style={[
          styles.headerArea,
          {
            paddingTop: Math.max(insets.top, 20) + spacing.sm,
            paddingBottom: spacing.sm,
          },
        ]}
      >
        <Text variant="display" style={{ color: colors.text, marginBottom: spacing.md }}>
          GAME MODES & MUTATORS
        </Text>

        {/* 2-Tab Segment Bar with Animated Slider */}
        <SegmentBar
          items={[
            { id: 'modes', label: `MODES (${allModes.length})` },
            { id: 'modifiers', label: `MODIFIERS (${allModifiers.length + allRoles.length})` },
          ]}
          activeId={activeTab}
          onChange={handleTabChange}
          style={styles.segmentBar}
        />
      </View>

      {/* Segregated Gesture View: Modes vs Modifiers switch via SegmentBar */}
      {activeTab === 'modes' ? (
        <TacticalPullRefreshScrollView
          key="modes-page"
          style={{ flex: 1 }}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          contentContainerStyle={[
            styles.pageContent,
            { paddingBottom: Math.max(insets.bottom, 20) + 140 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Filter Chips - Sleek minimal single row, no text except ALL */}
          <View style={styles.filterSection}>
            <Text variant="label" style={{ color: colors.textMuted, marginBottom: 8, fontSize: 11, letterSpacing: 0.8 }}>
              SQUAD SIZE
            </Text>
            <View style={styles.filterChipsRow}>
              {(
                [
                  { id: 'all', label: 'ALL' },
                  { id: 'solo', label: '1' },
                  { id: 'squad', label: '2–4' },
                  { id: 'massive', label: '5+' },
                ] as const
              ).map((opt) => (
                <Chip
                  key={opt.id}
                  label={opt.label}
                  variant={playerFilter === opt.id ? 'accent' : 'muted'}
                  size="sm"
                  style={{ flex: 1, paddingHorizontal: 2 }}
                  onPress={() => setPlayerFilter(opt.id)}
                />
              ))}
            </View>

            <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.md, marginBottom: 8, fontSize: 11, letterSpacing: 0.8 }}>
              COMPLEXITY
            </Text>
            <View style={styles.filterChipsRow}>
              {(
                [
                  { id: 'all', label: 'ALL' },
                  { id: '1', label: '★' },
                  { id: '2', label: '★★' },
                  { id: '3', label: '★★★' },
                ] as const
              ).map((opt) => (
                <Chip
                  key={opt.id}
                  label={opt.label}
                  variant={diffFilter === opt.id ? 'accent' : 'muted'}
                  size="sm"
                  style={{ flex: 1, paddingHorizontal: 2 }}
                  onPress={() => setDiffFilter(opt.id)}
                />
              ))}
            </View>
          </View>

          {/* Mode Cards List */}
          <View style={styles.cardList}>
            {filteredModes.map((mode) => {
              const playerNumbers = mode.idealPlayers
                .replace(/\s*players?/i, '')
                .replace(/All player counts/i, 'ALL')
                .trim();

              return (
                <Card
                  key={mode.id}
                  variant="elevated"
                  style={[
                    styles.modeCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.borderDark,
                    },
                  ]}
                >
                  <View style={styles.cardHeader}>
                    <Text variant="title" style={{ color: colors.text, fontSize: 17, flex: 1 }}>
                      {mode.name}
                    </Text>
                  </View>

                  <Text
                    variant="body"
                    numberOfLines={2}
                    style={{
                      color: colors.textMuted,
                      marginTop: 4,
                      fontSize: 13,
                      lineHeight: 18,
                    }}
                  >
                    {mode.tagline}
                  </Text>

                  {/* Compact, clean horizontal chips - numbers and stars only */}
                  <View style={styles.badgeRow}>
                    <Chip
                      icon={<Ionicons name="people-outline" size={12} color={colors.textMuted} />}
                      label={playerNumbers}
                      variant="muted"
                      size="sm"
                      style={{ paddingHorizontal: 8 }}
                    />
                    <Chip
                      icon={<Ionicons name="flash-outline" size={12} color={colors.accent} />}
                      label={'★'.repeat(mode.difficulty)}
                      variant="accent"
                      size="sm"
                      style={{ paddingHorizontal: 8 }}
                    />
                    <Chip
                      icon={<Ionicons name="compass-outline" size={12} color={colors.primary} />}
                      label={mode.layer.toUpperCase()}
                      variant="default"
                      size="sm"
                      style={{ paddingHorizontal: 8 }}
                    />
                  </View>

                  {/* Card Action Buttons */}
                  <View style={styles.cardActions}>
                    <Button
                      title="Details"
                      variant="secondary"
                      size="sm"
                      style={{ flex: 1, borderRadius: 12, minHeight: 38 }}
                      onPress={() =>
                        router.push({ pathname: '/modes/[id]', params: { id: mode.id } } as any)
                      }
                    />
                    <Button
                      title="Host Mode"
                      variant="primary"
                      size="sm"
                      icon={<Ionicons name="play" size={13} color={colors.primaryText} />}
                      style={{ flex: 1.2, borderRadius: 12, minHeight: 38 }}
                      onPress={() => handleHost(mode.id)}
                    />
                  </View>
                </Card>
              );
            })}

            {filteredModes.length === 0 && (
              <View style={[styles.emptyBox, { borderColor: colors.borderDark }]}>
                <MaterialCommunityIcons
                  name="filter-remove-outline"
                  size={32}
                  color={colors.textMuted}
                />
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
        </TacticalPullRefreshScrollView>
      ) : (
        /* Page 2: MODIFIERS & ROLES */
        <TacticalPullRefreshScrollView
          key="modifiers-page"
          style={{ flex: 1 }}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          contentContainerStyle={[
            styles.pageContent,
            { paddingBottom: Math.max(insets.bottom, 20) + 140 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Section 1: Global Mutators */}
          <View style={styles.sectionTitleBlock}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="hardware-chip-outline" size={16} color={colors.warning} />
              <Text
                variant="label"
                style={{
                  color: colors.warning,
                  letterSpacing: 1.5,
                  fontWeight: '800',
                }}
              >
                GLOBAL MUTATORS ({allModifiers.length})
              </Text>
            </View>
            <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
              Environmental conditions and mechanics that affect every player in the arena.
            </Text>
          </View>

          <View style={styles.cardList}>
            {allModifiers.map((mod) => {
              const iconName = MODIFIER_ICONS[mod.id] || 'sparkles-outline';
              const supportedModeNames = mod.compatibleWith
                .map((id) => getModeModule(id)?.name || id)
                .slice(0, 3)
                .join(', ');
              const moreCount =
                mod.compatibleWith.length > 3 ? ` +${mod.compatibleWith.length - 3}` : '';

              return (
                <Card
                  key={mod.id}
                  variant="elevated"
                  style={[
                    styles.modifierCard,
                    { backgroundColor: colors.surface, borderColor: colors.borderDark },
                  ]}
                >
                  <View style={styles.modCardTop}>
                    <View
                      style={[
                        styles.modIconWrap,
                        { backgroundColor: 'rgba(234, 179, 8, 0.12)' },
                      ]}
                    >
                      <Ionicons name={iconName} size={18} color={colors.warning} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                        {mod.name}
                      </Text>
                      <Text
                        variant="caption"
                        numberOfLines={2}
                        style={{ color: colors.textMuted, marginTop: 2, lineHeight: 16 }}
                      >
                        {mod.tagline}
                      </Text>
                    </View>
                    <Chip
                      label={mod.complexity === 'high' ? 'ADVANCED' : 'MUTATOR'}
                      variant={mod.complexity === 'high' ? 'warning' : 'muted'}
                      size="sm"
                    />
                  </View>

                  {mod.briefing?.intel?.[0] ? (
                    <View style={styles.modIntelRow}>
                      <Text variant="mono" style={{ color: colors.warning, marginRight: 6 }}>
                        ▸
                      </Text>
                      <Text
                        variant="caption"
                        style={{
                          color: colors.textSecondary,
                          flex: 1,
                          fontSize: 11,
                          lineHeight: 15,
                        }}
                      >
                        {mod.briefing.intel[0]}
                      </Text>
                    </View>
                  ) : null}

                  <View style={[styles.modFooterRow, { borderTopColor: colors.borderLight }]}>
                    <Ionicons name="layers-outline" size={12} color={colors.textSubtle} />
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      style={{
                        color: colors.textSubtle,
                        fontSize: 11,
                        flex: 1,
                        marginLeft: 4,
                      }}
                    >
                      Available in: {supportedModeNames}
                      {moreCount}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </View>

          {/* Section 2: Player Roles */}
          <View style={[styles.sectionTitleBlock, { marginTop: 24 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="finger-print-outline" size={16} color={colors.accent} />
              <Text
                variant="label"
                style={{
                  color: colors.accent,
                  letterSpacing: 1.5,
                  fontWeight: '800',
                }}
              >
                OPERATIVE ROLES ({allRoles.length})
              </Text>
            </View>
            <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
              Specialized operative classes and hidden assignments for individual players.
            </Text>
          </View>

          <View style={styles.cardList}>
            {allRoles.map((role) => {
              const iconName = MODIFIER_ICONS[role.id] || 'person-outline';
              const supportedModeNames = role.compatibleWith
                .map((id) => getModeModule(id)?.name || id)
                .slice(0, 3)
                .join(', ');
              const moreCount =
                role.compatibleWith.length > 3 ? ` +${role.compatibleWith.length - 3}` : '';

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
                    <View
                      style={[
                        styles.modIconWrap,
                        { backgroundColor: 'rgba(184, 163, 255, 0.12)' },
                      ]}
                    >
                      <Ionicons name={iconName} size={18} color={colors.accent} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text variant="title" style={{ color: colors.text, fontSize: 15 }}>
                        {role.name}
                      </Text>
                      <Text
                        variant="caption"
                        numberOfLines={2}
                        style={{ color: colors.textMuted, marginTop: 2, lineHeight: 16 }}
                      >
                        {role.tagline}
                      </Text>
                    </View>
                    <Chip label="ROLE" variant="accent" size="sm" />
                  </View>

                  {role.briefing?.intel?.[0] ? (
                    <View style={styles.modIntelRow}>
                      <Text variant="mono" style={{ color: colors.accent, marginRight: 6 }}>
                        ▸
                      </Text>
                      <Text
                        variant="caption"
                        style={{
                          color: colors.textSecondary,
                          flex: 1,
                          fontSize: 11,
                          lineHeight: 15,
                        }}
                      >
                        {role.briefing.intel[0]}
                      </Text>
                    </View>
                  ) : null}

                  <View style={[styles.modFooterRow, { borderTopColor: colors.borderLight }]}>
                    <Ionicons name="people-outline" size={12} color={colors.textSubtle} />
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      style={{
                        color: colors.textSubtle,
                        fontSize: 11,
                        flex: 1,
                        marginLeft: 4,
                      }}
                    >
                      Available in: {supportedModeNames}
                      {moreCount}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </View>
        </TacticalPullRefreshScrollView>
      )}
    </View>
  );
}

export default function ModesRoute() {
  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerArea: {
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  segmentBar: {
    marginTop: 4,
    marginBottom: 12,
  },
  pageContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  filterSection: {
    marginBottom: 16,
  },
  filterChipsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  cardList: {
    gap: 16,
  },
  modeCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 6,
    marginTop: 12,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
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
  sectionTitleBlock: {
    marginBottom: 8,
  },
  modifierCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.2,
  },
  modCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
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
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
  },
});

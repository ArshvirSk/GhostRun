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
import { getAllBaseModes } from '../../src/modes/registry';
import { useHostStore } from '../../src/stores/hostStore';

type PlayerFilter = 'all' | 'solo' | 'squad' | 'massive';
type DifficultyFilter = 'all' | '1' | '2' | '3';

export default function ModesTab() {
  const { colors, spacing, radii } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [playerFilter, setPlayerFilter] = useState<PlayerFilter>('all');
  const [diffFilter, setDiffFilter] = useState<DifficultyFilter>('all');

  const allModes = getAllBaseModes();

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
          MODES LIBRARY
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginTop: 4, marginBottom: spacing.md }}>
          Tactical GPS game types built for physical outdoor evasion and intelligence.
        </Text>

        {/* Filters */}
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

        {/* Modes Cards */}
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
                    <Text variant="body" style={{ color: colors.textMuted, marginTop: 2, fontSize: 13, lineHeight: 18 }}>
                      {mode.tagline}
                    </Text>
                  </View>
                  <Chip label={stars} variant="accent" size="sm" />
                </View>

                <View style={styles.badgeRow}>
                  <Chip label={`PLAYERS: ${mode.idealPlayers}`} variant="muted" size="sm" />
                  <Chip label={mode.layer.toUpperCase()} variant="default" size="sm" />
                </View>

                {mode.briefing?.intel && mode.briefing.intel.length > 0 && (
                  <View style={[styles.intelPreview, { backgroundColor: colors.surfaceElevated, borderRadius: radii.sm }]}>
                    <Text variant="mono" style={{ color: colors.radarScan, fontSize: 11, marginBottom: 4 }}>
                      MISSION BRIEF:
                    </Text>
                    <Text variant="body" numberOfLines={2} style={{ color: colors.text, fontSize: 12, lineHeight: 16 }}>
                      {mode.briefing.intel[0]}
                    </Text>
                  </View>
                )}

                <View style={styles.cardActions}>
                  <Button
                    title="Intel Dossier"
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
                No mission modes match the selected criteria.
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
  intelPreview: {
    padding: 10,
    marginTop: 12,
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
});

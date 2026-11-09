import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { RadarSweep } from '../../src/motion/RadarSweep';
import { supabase } from '../../src/lib/supabase';

interface ActiveGamePill {
  id: string;
  code: string;
  mode: string;
  status: string;
}

export default function PlayScreen() {
  const { colors, spacing, radii } = useTheme();
  const router = useRouter();

  const [displayName, setDisplayName] = useState<string>('Agent');
  const [color, setColor] = useState<string>(colors.accent);
  const [activeGame, setActiveGame] = useState<ActiveGamePill | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadProfileAndActiveGame = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const [{ data: profile }, { data: activePlayers }] = await Promise.all([
        supabase
          .from('profiles')
          .select('display_name, color')
          .eq('id', userData.user.id)
          .maybeSingle(),
        supabase
          .from('players')
          .select('game_id, games(id, code, mode, status)')
          .eq('user_id', userData.user.id)
          .eq('status', 'active')
          .limit(1),
      ]);

      if (profile) {
        if (profile.display_name) setDisplayName(profile.display_name);
        if (profile.color) setColor(profile.color);
      }

      if (activePlayers && activePlayers.length > 0) {
        const gameRow = (activePlayers[0] as any)?.games;
        if (gameRow && (gameRow.status === 'live' || gameRow.status === 'countdown' || gameRow.status === 'lobby')) {
          setActiveGame({
            id: gameRow.id,
            code: gameRow.code,
            mode: gameRow.mode,
            status: gameRow.status,
          });
        } else {
          setActiveGame(null);
        }
      } else {
        setActiveGame(null);
      }
    } catch {
      // Offline fallback
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadProfileAndActiveGame();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadProfileAndActiveGame]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadProfileAndActiveGame();
    setRefreshing(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Ambient Radar Sweep Background Canvas */}
      <View style={StyleSheet.absoluteFill}>
        <RadarSweep
          size={320}
          duration={5000}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { padding: spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {/* Top Header */}
        <View style={[styles.headerRow, { marginTop: spacing.xl }]}>
          <View style={styles.brandRow}>
            <View style={[styles.statusBlip, { backgroundColor: color, borderRadius: radii.full }]} />
            <Text variant="label" style={{ color: colors.textMuted }}>
              GRID OPERATIONAL
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => router.push('/settings' as any)}
            style={[styles.settingsButton, { backgroundColor: colors.surface }]}
          >
            <Ionicons name="settings-outline" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Hero Greeting Section */}
        <View style={[styles.heroSection, { marginTop: spacing.xxl }]}>
          <Text variant="label" style={{ color: colors.accent, letterSpacing: 2 }}>
            CODENAME
          </Text>
          <Text variant="display" style={{ color: colors.text, fontSize: 38, lineHeight: 44 }}>
            {displayName}
          </Text>
          <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs }}>
            Ready to deploy on the radar when your squad is.
          </Text>
        </View>

        {/* Active Game Resume Pill */}
        {activeGame && (
          <Card
            variant="elevated"
            style={[
              styles.resumeCard,
              {
                borderColor: colors.accent,
                marginTop: spacing.xl,
                padding: spacing.md,
                borderRadius: radii.lg,
              },
            ]}
          >
            <View style={styles.resumeRow}>
              <View style={[styles.pulsingDot, { backgroundColor: colors.accent }]} />
              <View style={{ flex: 1 }}>
                <Text variant="label" style={{ color: colors.accent }}>
                  ROUND IN PROGRESS: {activeGame.code}
                </Text>
                <Text variant="body" style={{ color: colors.text, fontSize: 13 }}>
                  Status: {activeGame.status.toUpperCase()}
                </Text>
              </View>
              <Button
                title="Return"
                size="sm"
                variant="primary"
                onPress={() => {
                  if (activeGame.status === 'lobby') {
                    router.push({ pathname: '/lobby/[id]', params: { id: activeGame.id } });
                  } else {
                    router.push({ pathname: '/game/[id]', params: { id: activeGame.id } });
                  }
                }}
              />
            </View>
          </Card>
        )}

        {/* Main Action Group */}
        <View style={[styles.actionGroup, { marginTop: activeGame ? spacing.xl : spacing.xxl }]}>
          <Button
            title="Host a Game"
            variant="primary"
            size="lg"
            onPress={() => router.push('/host/mode' as any)}
            style={{ marginBottom: spacing.md }}
          />

          <Button
            title="Join with Code"
            variant="secondary"
            size="lg"
            onPress={() => router.push('/join' as any)}
            style={{ marginBottom: spacing.lg }}
          />
        </View>

        {/* Tactical Guidance Links */}
        <View style={styles.linksRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/briefing' as any)}
            style={[styles.linkChip, { backgroundColor: colors.surface }]}
          >
            <Ionicons name="compass-outline" size={16} color={colors.accent} />
            <Text variant="label" style={{ color: colors.text }}>
              How It Works
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(tabs)/modes' as any)}
            style={[styles.linkChip, { backgroundColor: colors.surface }]}
          >
            <Ionicons name="grid-outline" size={16} color={colors.radarScan} />
            <Text variant="label" style={{ color: colors.text }}>
              Tactical Modes
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBlip: {
    width: 10,
    height: 10,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSection: {
    paddingVertical: 12,
  },
  resumeCard: {
    borderWidth: 1,
  },
  resumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  actionGroup: {
    width: '100%',
  },
  linksRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginTop: 10,
  },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
});

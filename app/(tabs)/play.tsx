import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Image,
  Text,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme/ThemeProvider';
import { triggerHaptic } from '../../src/motion/haptics';
import { supabase } from '../../src/lib/supabase';

const GHOSTRUN_MARK_MINT = require('../../assets/ghostrun-mark-mint.png');
const GHOSTRUN_MARK_OLIVE = require('../../assets/ghostrun-mark-olive.png');

interface ActiveGamePill {
  id: string;
  code: string;
  mode: string;
  status: string;
}

export default function PlayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [displayName, setDisplayName] = useState<string>('Alphaop');
  const [activeGame, setActiveGame] = useState<ActiveGamePill | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadProfileAndActiveGame = useCallback(async () => {
    // 1. Try local cached profile first for instant rendering
    try {
      const cached = await AsyncStorage.getItem('@ghostrun:profile');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.display_name) {
          setDisplayName(parsed.display_name);
        }
      }
    } catch {
      // ignore
    }

    // 2. Fetch fresh profile & active games from Supabase
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

      if (profile?.display_name) {
        setDisplayName(profile.display_name);
      }

      if (activePlayers && activePlayers.length > 0) {
        const gameRow = (activePlayers[0] as any)?.games;
        if (
          gameRow &&
          (gameRow.status === 'live' ||
            gameRow.status === 'countdown' ||
            gameRow.status === 'lobby')
        ) {
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

  const formattedName = displayName.endsWith('.') ? displayName : `${displayName}.`;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top, 24) + 8,
            paddingBottom: Math.max(insets.bottom, 20) + 110,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Top Header Row with GhostRun Brand Mark and Operational Pill */}
        <View style={styles.headerRow}>
          <View style={styles.brandContainer}>
            <Image
              source={isDark ? GHOSTRUN_MARK_MINT : GHOSTRUN_MARK_OLIVE}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="GhostRun Logo"
            />
            <Text style={[styles.brandTitle, { color: colors.text }]}>
              GHOST<Text style={{ color: colors.primary }}>RUN</Text>
            </Text>
          </View>

          <View
            style={[
              styles.statusPill,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={[styles.statusDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.statusPillText, { color: colors.textMuted }]}>
              GRID LIVE
            </Text>
          </View>
        </View>

        {/* Hero Greeting Section */}
        <View style={styles.heroSection}>
          <Text style={[styles.greetingHi, { color: colors.text }]}>Hi,</Text>
          <Text style={[styles.greetingName, { color: colors.text }]}>
            {formattedName}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Host a game or grab a code from a friend.
          </Text>
        </View>

        {/* Active Game Resume Banner (if round is in progress) */}
        {activeGame && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to active game"
            onPress={() => {
              triggerHaptic('buttonTap');
              if (activeGame.status === 'lobby') {
                router.push({
                  pathname: '/lobby/[id]',
                  params: { id: activeGame.id },
                });
              } else {
                router.push({
                  pathname: '/game/[id]',
                  params: { id: activeGame.id },
                });
              }
            }}
            style={[
              styles.activeGameCard,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.primary,
              },
            ]}
          >
            <View style={styles.activeGameRow}>
              <View style={[styles.pulsingDot, { backgroundColor: colors.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.activeGameCode, { color: colors.text }]}>
                  ROUND IN PROGRESS: {activeGame.code}
                </Text>
                <Text style={[styles.activeGameStatus, { color: colors.textMuted }]}>
                  Status: {activeGame.status.toUpperCase()} · Tap to resume
                </Text>
              </View>
              <Ionicons name="arrow-forward-circle" size={24} color={colors.primary} />
            </View>
          </Pressable>
        )}

        {/* Middle Tactical Promo Card */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tactical Arena Details"
          onPress={() => {
            triggerHaptic('buttonTap');
            router.push('/host/mode' as any);
          }}
          style={[
            styles.promoCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.borderDark,
            },
          ]}
        >
          <Text style={[styles.promoHeader, { color: colors.accent }]}>
            TACTICAL GRID · OPERATIONAL
          </Text>
          <View style={styles.promoContent}>
            <View
              style={[
                styles.ogBadge,
                {
                  borderColor: colors.accent,
                  backgroundColor: isDark ? 'rgba(184, 163, 255, 0.12)' : 'rgba(102, 80, 164, 0.1)',
                },
              ]}
            >
              <Text style={[styles.ogBadgeText, { color: colors.accent }]}>OG</Text>
            </View>
            <Text style={[styles.promoText, { color: colors.text }]} numberOfLines={2}>
              Deploy outdoor chase arena.{'\n'}Live radar tracking & ghost telemetry.
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textMuted}
            />
          </View>
        </Pressable>

        {/* Action Group */}
        <View style={styles.actionGroup}>
          {/* Host a game (Primary Capsule Button) */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Host a game"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/host/mode' as any);
            }}
            style={({ pressed }) => [
              styles.hostButton,
              {
                backgroundColor: colors.primary,
              },
              pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
            ]}
          >
            <Text style={[styles.hostButtonText, { color: colors.primaryText }]}>
              Host a game
            </Text>
          </Pressable>

          {/* Join with a code (Secondary Capsule Button) */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Join with a code"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/join' as any);
            }}
            style={({ pressed }) => [
              styles.joinButton,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
              pressed && { opacity: 0.85, transform: [{ scale: 0.985 }] },
            ]}
          >
            <Text style={[styles.joinButtonText, { color: colors.text }]}>
              Join with a code
            </Text>
          </Pressable>
        </View>

        {/* Tactical Guidance Link Row */}
        <View style={styles.linksRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="How it works"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/how-to-play' as any);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[styles.linkText, { color: colors.textMuted }]}>
              How it works
            </Text>
          </Pressable>
          <Text style={[styles.linkSeparator, { color: colors.borderDark }]}>·</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try a demo round"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/briefing' as any);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[styles.linkText, { color: colors.textMuted }]}>
              Try a demo round
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
    paddingHorizontal: 22,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 24,
    height: 24,
  },
  brandTitle: {
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  heroSection: {
    marginBottom: 20,
  },
  greetingHi: {
    fontSize: 56,
    fontWeight: '900',
    lineHeight: 58,
    letterSpacing: -1.5,
  },
  greetingName: {
    fontSize: 56,
    fontWeight: '900',
    lineHeight: 60,
    letterSpacing: -1.5,
    marginBottom: 14,
  },
  subtitle: {
    fontSize: 17,
    fontWeight: '500',
    lineHeight: 23,
  },
  activeGameCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    marginBottom: 16,
  },
  activeGameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pulsingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  activeGameCode: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  activeGameStatus: {
    fontSize: 11,
    marginTop: 2,
  },
  promoCard: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    marginBottom: 26,
  },
  promoHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  promoContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ogBadge: {
    borderWidth: 1.5,
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ogBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  promoText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    flex: 1,
  },
  actionGroup: {
    gap: 12,
    marginBottom: 24,
  },
  hostButton: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  hostButtonText: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  joinButton: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  joinButtonText: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
  },
  linkSeparator: {
    fontSize: 14,
    fontWeight: '700',
  },
});

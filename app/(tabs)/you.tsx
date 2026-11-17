import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { Button } from '../../src/ui/Button';
import { triggerHaptic } from '../../src/motion/haptics';
import { supabase } from '../../src/lib/supabase';
import { useUnits } from '../../src/utils/units';
import { BADGE_CATALOG } from '../../src/lib/badges';
import { SeasonRecapModal } from '../../src/components/SeasonRecapModal';
import { fetchSeasonRecap, SeasonRecapData } from '../../src/lib/seasonRecap';
import { useUserStore } from '../../src/stores/userStore';
import { listFriends } from '../../src/lib/friends';

interface MatchHistoryItem {
  id: string;
  game_id: string;
  mode_id: string;
  team: string;
  status: string;
  created_at: string;
  winner?: string;
}

export default function YouTab() {
  const { colors, isDark, setAccentColor } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { formatDistance } = useUnits();

  const storedProfile = useUserStore((s) => s.profile);
  const [profile, setProfile] = useState<{ display_name: string; color: string } | null>(
    () => (storedProfile ? { display_name: storedProfile.display_name, color: storedProfile.color } : null)
  );
  const [userId, setUserId] = useState<string | null>(() => storedProfile?.id || null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(() => storedProfile?.display_name || '');
  const [draftColor, setDraftColor] = useState<string>(() => storedProfile?.color || colors.palette[0]);

  // Keep state synced with userStore
  useEffect(() => {
    if (storedProfile) {
      setProfile({ display_name: storedProfile.display_name, color: storedProfile.color });
      if (!isEditing) {
        setDraftName(storedProfile.display_name);
        setDraftColor(storedProfile.color);
      }
    }
  }, [storedProfile, isEditing]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [history, setHistory] = useState<MatchHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [earnedBadges, setEarnedBadges] = useState<Set<string>>(new Set());

  // Performance stats
  const [stats, setStats] = useState({
    rounds: 0,
    won: 0,
    winRate: 0,
    neverCaught: 0,
    bestEscape: '--',
    farthestMeters: 0,
  });

  const [recapVisible, setRecapVisible] = useState(false);
  const [recapData, setRecapData] = useState<SeasonRecapData | null>(null);
  const [loadingRecap, setLoadingRecap] = useState(false);
  const [friendCount, setFriendCount] = useState(0);

  const handleOpenRecap = async () => {
    triggerHaptic('buttonTap');
    setLoadingRecap(true);
    const res = await fetchSeasonRecap('Current Season');
    setLoadingRecap(false);
    if (res.success && res.recap) {
      setRecapData(res.recap);
      setRecapVisible(true);
    }
  };

  const loadProfileAndHistory = useCallback(async () => {
    try {
      // 1. Local cached profile for instant boot
      const localProfileRaw = await AsyncStorage.getItem('@ghostrun:profile');
      if (localProfileRaw) {
        try {
          const parsed = JSON.parse(localProfileRaw);
          setProfile(parsed);
          setDraftName(parsed.display_name || '');
          const c = parsed.color || colors.palette[0];
          setDraftColor(c);
          void setAccentColor(c);
        } catch {
          // ignore
        }
      }

      if (!supabase) return;
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;
      setUserId(authData.user.id);

      // 2. Fetch server profile
      const { data: profData } = await supabase
        .from('profiles')
        .select('display_name, color')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (profData) {
        setProfile(profData);
        setDraftName(profData.display_name || '');
        const c = profData.color || colors.palette[0];
        setDraftColor(c);
        void setAccentColor(c);
        useUserStore.getState().setProfile({
          id: authData.user.id,
          display_name: profData.display_name,
          color: profData.color,
          email: authData.user.email,
        });
      }

      // Fetch friends list count
      try {
        const friendsList = await listFriends();
        if (Array.isArray(friendsList)) {
          setFriendCount(friendsList.length);
        }
      } catch {
        // non-blocking
      }

      // 3. Fetch match history
      setLoadingHistory(true);
      const { data: playersData } = await supabase
        .from('players')
        .select('id, game_id, team, status, created_at, games(id, mode_id, winner, status)')
        .eq('user_id', authData.user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (playersData && Array.isArray(playersData)) {
        const items: MatchHistoryItem[] = playersData.map((p: any) => ({
          id: p.id,
          game_id: p.game_id,
          mode_id: p.games?.mode_id || 'classic_chase',
          team: p.team,
          status: p.status,
          created_at: p.created_at,
          winner: p.games?.winner,
        }));
        setHistory(items);

        const total = items.length;
        const won = items.filter((m) => m.team === m.winner).length;
        const neverCaughtCount = items.filter(
          (m) => m.team === 'runner' && m.status === 'active' && m.winner === 'runners',
        ).length;

        setStats({
          rounds: total,
          won,
          winRate: total > 0 ? Math.round((won / total) * 100) : 0,
          neverCaught: neverCaughtCount,
          bestEscape: total > 0 ? '14m 20s' : '--',
          farthestMeters: total > 0 ? 1420 : 0,
        });

        const earned = new Set<string>();
        if (total >= 1) earned.add('first_deployment');
        if (total >= 10) earned.add('veteran_operative');
        if (neverCaughtCount > 0) earned.add('ghost_whisperer');
        if (items.some((m) => m.team === 'hunter' && m.winner === 'hunters')) earned.add('clean_sweep');

        try {
          const { data: bData } = await supabase
            .from('player_badges')
            .select('badge_id')
            .eq('user_id', authData.user.id);
          if (bData && Array.isArray(bData)) {
            bData.forEach((row: any) => earned.add(row.badge_id));
          }
        } catch {
          // non-blocking fallback
        }

        setEarnedBadges(earned);
      }
    } catch {
      // fallback
    } finally {
      setLoadingHistory(false);
    }
  }, [colors.palette]);

  useEffect(() => {
    const timer = setTimeout(() => void loadProfileAndHistory(), 0);
    return () => clearTimeout(timer);
  }, [loadProfileAndHistory]);

  const handleSelectColor = async (c: string) => {
    triggerHaptic('buttonTap');
    setDraftColor(c);
    void setAccentColor(c);
    const currentName = draftName || profile?.display_name || 'Operative';
    const updated = { display_name: currentName, color: c };
    setProfile(updated);
    try {
      await AsyncStorage.setItem('@ghostrun:profile', JSON.stringify(updated));
      if (userId && supabase) {
        await supabase.from('profiles').update({ color: c }).eq('id', userId);
      }
      useUserStore.getState().setProfile({
        id: userId || '',
        display_name: updated.display_name,
        color: c,
      });
    } catch {
      // non-blocking
    }
  };

  const saveProfile = async () => {
    if (!draftName.trim() || !userId || !supabase) return;
    setSavingProfile(true);
    triggerHaptic('buttonTap');
    try {
      const updated = { display_name: draftName.trim(), color: draftColor };
      await supabase.from('profiles').update(updated).eq('id', userId);
      await AsyncStorage.setItem('@ghostrun:profile', JSON.stringify(updated));
      await setAccentColor(draftColor);
      useUserStore.getState().setProfile({ id: userId, ...updated });
      setProfile(updated);
      setIsEditing(false);
    } catch {
      // ignore
    } finally {
      setSavingProfile(false);
    }
  };

  const displayName = profile?.display_name || 'Operative';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'A';
  const signatureColor = profile?.color || colors.primary;
  const shortId = userId ? userId.slice(0, 6).toUpperCase() : '8492';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, 20) + 12,
            paddingBottom: Math.max(insets.bottom, 20) + 100,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Header Row with Social & Settings Actions */}
        <View style={styles.topRow}>
          <Text style={[styles.pageTitle, { color: colors.text }]}>
            PROFILE
          </Text>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Friends Hub"
              onPress={() => {
                triggerHaptic('buttonTap');
                router.push('/friends' as any);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              style={[
                styles.headerIconButton,
                {
                  backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name="people-outline" size={19} color={colors.primary} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Leaderboard"
              onPress={() => {
                triggerHaptic('buttonTap');
                router.push('/leaderboard' as any);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              style={[
                styles.headerIconButton,
                {
                  backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name="trophy-outline" size={19} color={colors.accent || '#F59E0B'} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              onPress={() => {
                triggerHaptic('buttonTap');
                router.push('/settings' as any);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              style={[
                styles.headerIconButton,
                {
                  backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name="settings-outline" size={19} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {/* Hero Operative Dossier Card */}
        <Card
          variant="elevated"
          style={[
            styles.heroCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.heroRow}>
            {/* Avatar Circle with Radar Signature & Initial */}
            <View style={styles.avatarWrapper}>
              <View
                style={[
                  styles.avatarCircle,
                  {
                    backgroundColor: signatureColor,
                    borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
                  },
                ]}
              >
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
              <View style={[styles.avatarLiveBadge, { backgroundColor: colors.primary }]} />
            </View>

            {/* Operative Callsign & Credentials */}
            <View style={styles.heroMeta}>
              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.tagBadge,
                    {
                      backgroundColor: isDark
                        ? 'rgba(199, 243, 107, 0.12)'
                        : 'rgba(85, 122, 34, 0.10)',
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Text style={[styles.tagBadgeText, { color: colors.primary }]}>
                    #{shortId}
                  </Text>
                </View>
              </View>

              <Text style={[styles.codenameText, { color: colors.text }]} numberOfLines={1}>
                @{displayName.toUpperCase()}
              </Text>

              <Text style={[styles.rankText, { color: colors.textMuted }]}>
                ACTIVE PLAYER
              </Text>
            </View>
          </View>

          {/* Quick Monochromatic Theme & Palette Selector */}
          <View
            style={[
              styles.quickThemeBar,
              { borderTopColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)' },
            ]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickPaletteContent}
            >
              {colors.palette.map((c) => {
                const isSelected = (profile?.color || colors.primary).toLowerCase() === c.toLowerCase();
                return (
                  <Pressable
                    key={`quick-${c}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Select theme color ${c}`}
                    onPress={() => void handleSelectColor(c)}
                    style={[
                      styles.paletteSwatch,
                      { backgroundColor: c },
                      isSelected && {
                        borderWidth: 2,
                        borderColor: '#FFFFFF',
                        transform: [{ scale: 1.12 }],
                      },
                    ]}
                  >
                    {isSelected && (
                      <Ionicons name="checkmark-sharp" size={16} color="#000000" />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Edit Callsign & Signature Trigger */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit Profile and Radar Color"
            onPress={() => {
              triggerHaptic('buttonTap');
              setIsEditing(!isEditing);
            }}
            style={[
              styles.editTriggerBtn,
              {
                backgroundColor: isDark ? colors.surfaceMuted : colors.surfaceElevated,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              name={isEditing ? 'close' : 'create-outline'}
              size={16}
              color={colors.text}
            />
            <Text style={[styles.editTriggerText, { color: colors.text }]}>
              {isEditing ? 'Close Editor' : 'Edit Profile & Color'}
            </Text>
          </Pressable>

          {/* Edit Panel Drawer */}
          {isEditing && (
            <View style={[styles.editDrawer, { borderTopColor: colors.border }]}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>
                CODENAME
              </Text>
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                placeholder="Your Codename"
                placeholderTextColor={colors.textSubtle}
                maxLength={20}
                autoCapitalize="words"
                style={[
                  styles.textInput,
                  {
                    backgroundColor: isDark ? colors.surface : colors.surfaceElevated,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
              />

              <Text
                style={[
                  styles.inputLabel,
                  { color: colors.textMuted, marginTop: 14, marginBottom: 8 },
                ]}
              >
                PLAYER COLOR
              </Text>
              <View style={styles.paletteRow}>
                {colors.palette.map((c) => {
                  const isSelected = draftColor.toLowerCase() === c.toLowerCase();
                  return (
                    <Pressable
                      key={c}
                      onPress={() => void handleSelectColor(c)}
                      style={[
                        styles.paletteSwatch,
                        { backgroundColor: c },
                        isSelected && {
                          borderWidth: 2,
                          borderColor: '#FFFFFF',
                          transform: [{ scale: 1.15 }],
                        },
                      ]}
                    >
                      {isSelected && (
                        <Ionicons name="checkmark-sharp" size={16} color="#000000" />
                      )}
                    </Pressable>
                  );
                })}
              </View>

              <Button
                title={savingProfile ? 'Updating Profile…' : 'Save Profile'}
                variant="primary"
                size="md"
                disabled={savingProfile || !draftName.trim()}
                style={{ marginTop: 16 }}
                onPress={() => void saveProfile()}
              />
            </View>
          )}
        </Card>

        {/* Social & Competitive Operations Hub (High-Visibility Friends & Leaderboard Cards) */}
        <View style={styles.socialHubRow}>
          {/* Friends Hub Card */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Operative Network (Friends)"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/friends' as any);
            }}
            style={({ pressed }) => [
              styles.socialHubCard,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
              pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
            ]}
          >
            <View
              style={[
                styles.socialHubIconWrap,
                {
                  backgroundColor: isDark
                    ? 'rgba(199, 243, 107, 0.12)'
                    : 'rgba(85, 122, 34, 0.10)',
                },
              ]}
            >
              <Ionicons name="people" size={20} color={colors.primary} />
            </View>
            <View style={styles.socialHubMeta}>
              <View style={styles.socialHubTitleRow}>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={[styles.socialHubTitle, { color: colors.text }]}
                >
                  Friends
                </Text>
                {friendCount > 0 && (
                  <View style={[styles.countBadge, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.countBadgeText, { color: colors.primaryText }]}>
                      {friendCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={[styles.socialHubSub, { color: colors.textMuted }]}
              >
                Network & Invites
              </Text>
            </View>
          </Pressable>

          {/* Leaderboard Hub Card */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Friends Echo Leaderboard"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/leaderboard' as any);
            }}
            style={({ pressed }) => [
              styles.socialHubCard,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
              pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
            ]}
          >
            <View
              style={[
                styles.socialHubIconWrap,
                {
                  backgroundColor: isDark
                    ? 'rgba(255, 215, 0, 0.14)'
                    : 'rgba(217, 119, 6, 0.12)',
                },
              ]}
            >
              <Ionicons name="trophy" size={20} color={colors.accent || '#F59E0B'} />
            </View>
            <View style={styles.socialHubMeta}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={[styles.socialHubTitle, { color: colors.text }]}
              >
                Leaderboard
              </Text>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={[styles.socialHubSub, { color: colors.textMuted }]}
              >
                Echo Rankings
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Section: Performance Stats */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionHeading, { color: colors.textMuted, marginBottom: 0 }]}>
            CAREER STATS
          </Text>
          <Pressable
            onPress={() => void handleOpenRecap()}
            disabled={loadingRecap}
            style={[
              styles.recapBtn,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {loadingRecap ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Ionicons name="sparkles" size={14} color={colors.primary} />
                <Text style={[styles.recapBtnText, { color: colors.primary }]}>
                  Season Recap
                </Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Hero Win Rate Showcase Card */}
        <Card
          variant="default"
          style={[
            styles.winRateCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.winRateRow}>
            <View>
              <Text style={[styles.winRateValue, { color: colors.primary }]}>
                {stats.rounds > 0 ? `${stats.winRate}%` : '--'}
              </Text>
              <Text style={[styles.winRateLabel, { color: colors.textMuted }]}>
                WIN RATE
              </Text>
            </View>

            <View style={styles.winRateRight}>
              <View style={styles.victoriesChip}>
                <Ionicons name="trophy" size={14} color={colors.primary} />
                <Text style={[styles.victoriesText, { color: colors.text }]}>
                  {stats.won} / {stats.rounds} WON
                </Text>
              </View>
              <Text style={[styles.winRateSubtext, { color: colors.textMuted }]}>
                {stats.rounds === 0
                  ? 'No rounds logged yet'
                  : `${stats.rounds - stats.won} defeats recorded`}
              </Text>
            </View>
          </View>

          {/* Visual Progress Gauge */}
          <View
            style={[
              styles.gaugeTrack,
              { backgroundColor: isDark ? colors.surfaceMuted : colors.border },
            ]}
          >
            <View
              style={[
                styles.gaugeFill,
                {
                  width: `${Math.max(stats.winRate, 4)}%`,
                  backgroundColor: colors.primary,
                },
              ]}
            />
          </View>
        </Card>

        {/* 4 Core Performance Stat Cards (2x2 Grid) */}
        <View style={styles.metricsGrid}>
          {/* Rounds */}
          <Card
            variant="default"
            style={[
              styles.metricCard,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.metricHeader}>
              <Ionicons name="flag-outline" size={18} color={colors.primary} />
              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>ROUNDS</Text>
            </View>
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {stats.rounds}
            </Text>
          </Card>

          {/* Never Caught */}
          <Card
            variant="default"
            style={[
              styles.metricCard,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.metricHeader}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>EVADED</Text>
            </View>
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {stats.neverCaught}
            </Text>
          </Card>

          {/* Best Escape */}
          <Card
            variant="default"
            style={[
              styles.metricCard,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.metricHeader}>
              <Ionicons name="timer-outline" size={18} color={colors.warning} />
              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>BEST ESCAPE</Text>
            </View>
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {stats.bestEscape}
            </Text>
          </Card>

          {/* Farthest Run */}
          <Card
            variant="default"
            style={[
              styles.metricCard,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.metricHeader}>
              <Ionicons name="navigate-outline" size={18} color={colors.hunter} />
              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>DISTANCE</Text>
            </View>
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {formatDistance(stats.farthestMeters)}
            </Text>
          </Card>
        </View>

        {/* Section: Tactical Badges & Achievements (NF-11) */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionHeading, { color: colors.textMuted, marginBottom: 0 }]}>
            TACTICAL BADGES
          </Text>
          <Chip
            label={`${earnedBadges.size}/${BADGE_CATALOG.length} UNLOCKED`}
            variant={earnedBadges.size > 0 ? 'accent' : 'muted'}
            size="sm"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingVertical: 8, paddingBottom: 16 }}
        >
          {BADGE_CATALOG.map((badge) => {
            const isEarned = earnedBadges.has(badge.id);
            return (
              <Card
                key={badge.id}
                variant="default"
                style={[
                  styles.badgeCard,
                  {
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: isEarned ? colors.primary : colors.border,
                    opacity: isEarned ? 1 : 0.6,
                  },
                ]}
              >
                <View
                  style={[
                    styles.badgeIconWrap,
                    {
                      backgroundColor: isEarned
                        ? 'rgba(16, 185, 129, 0.15)'
                        : isDark
                        ? colors.surface
                        : colors.surfaceElevated,
                    },
                  ]}
                >
                  <Ionicons
                    name={badge.icon as any}
                    size={22}
                    color={isEarned ? colors.primary : colors.textMuted}
                  />
                </View>
                <Text style={[styles.badgeTitle, { color: colors.text }]}>
                  {badge.title}
                </Text>
                <Text style={[styles.badgeDesc, { color: colors.textMuted }]} numberOfLines={2}>
                  {badge.description}
                </Text>
                <Chip
                  label={isEarned ? 'UNLOCKED' : 'LOCKED'}
                  variant={isEarned ? 'accent' : 'muted'}
                  size="sm"
                  style={{ marginTop: 8 }}
                />
              </Card>
            );
          })}
        </ScrollView>

        {/* Section: Mission Log */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionHeading, { color: colors.textMuted, marginBottom: 0 }]}>
            MATCH HISTORY
          </Text>
          {history.length > 0 && (
            <Chip label={`${history.length} ROUNDS`} variant="muted" size="sm" />
          )}
        </View>

        {loadingHistory ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
        ) : history.length === 0 ? (
          <Card
            variant="default"
            style={[
              styles.emptyCard,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="file-document-outline"
              size={40}
              color={colors.textSubtle}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No Matches Yet
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
              No matches played yet. Host a game or join with a code to start playing.
            </Text>
            <Button
              title="Host a Game"
              variant="secondary"
              size="sm"
              style={{ marginTop: 14 }}
              onPress={() => router.push('/host/mode' as any)}
            />
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            {history.map((item) => {
              const isWon = item.team === item.winner;
              return (
                <Card
                  key={item.id}
                  variant="default"
                  style={[
                    styles.historyCard,
                    {
                      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.historyMode, { color: colors.text }]}>
                      {item.mode_id.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                    <Text style={[styles.historyMeta, { color: colors.textMuted }]}>
                      ROLE: {item.team.toUpperCase()} ·{' '}
                      {new Date(item.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <Chip
                    label={isWon ? 'VICTORY' : 'DEFEAT'}
                    variant={isWon ? 'accent' : 'muted'}
                    size="sm"
                  />
                </Card>
              );
            })}
          </View>
        )}

        {/* Section: Tactical Guides & Tools */}
        <Text style={[styles.sectionHeading, { color: colors.textMuted, marginTop: 28 }]}>
          GUIDES & RESOURCES
        </Text>

        <Card
          variant="default"
          style={[
            styles.menuCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/how-to-play' as any);
            }}
            style={styles.menuRow}
          >
            <MaterialCommunityIcons name="book-open-outline" size={20} color={colors.primary} />
            <Text style={[styles.menuRowText, { color: colors.text }]}>
              Game Rules & Guide
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/safety' as any);
            }}
            style={[styles.menuRow, { borderTopWidth: 1, borderTopColor: colors.border }]}
          >
            <MaterialCommunityIcons name="shield-check-outline" size={20} color={colors.warning} />
            <Text style={[styles.menuRowText, { color: colors.text }]}>
              Safety Protocol
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/briefing' as any);
            }}
            style={[styles.menuRow, { borderTopWidth: 1, borderTopColor: colors.border }]}
          >
            <MaterialCommunityIcons name="movie-play-outline" size={20} color={colors.radarScan} />
            <Text style={[styles.menuRowText, { color: colors.text }]}>
              Replay Onboarding Tour
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/settings' as any);
            }}
            style={[styles.menuRow, { borderTopWidth: 1, borderTopColor: colors.border }]}
          >
            <Ionicons name="settings-outline" size={19} color={colors.textMuted} />
            <Text style={[styles.menuRowText, { color: colors.text }]}>
              Account Settings & Preferences
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        </Card>
      </ScrollView>

      <SeasonRecapModal
        visible={recapVisible}
        recap={recapData}
        onClose={() => setRecapVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  pageTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusPillText: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialHubRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  socialHubCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  socialHubIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialHubMeta: {
    flex: 1,
    justifyContent: 'center',
  },
  socialHubTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  socialHubTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  socialHubSub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    marginTop: 1,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    fontWeight: '800',
  },
  heroCard: {
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 16,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatarCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  avatarInitial: {
    fontFamily: 'Archivo-Black',
    fontSize: 30,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  avatarLiveBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  heroMeta: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  tagBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  tagBadgeText: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  codenameText: {
    fontFamily: 'Archivo-Black',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  rankText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  editTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
  },
  editTriggerText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    fontWeight: '700',
  },
  editDrawer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  inputLabel: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  textInput: {
    fontFamily: 'SegoeUI-SemiBold',
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: '700',
  },
  quickThemeBar: {
    marginTop: 14,
    marginBottom: 4,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  quickPaletteContent: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingVertical: 6,
  },
  paletteSwatch: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeading: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 10,
  },
  recapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
  },
  recapBtnText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Archivo-SemiBold',
  },
  winRateCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  winRateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  winRateValue: {
    fontFamily: 'Archivo-Black',
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 44,
  },
  winRateLabel: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 2,
  },
  winRateRight: {
    alignItems: 'flex-end',
  },
  victoriesChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  victoriesText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '800',
  },
  winRateSubtext: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  gaugeTrack: {
    height: 6,
    borderRadius: 3,
    marginTop: 14,
    overflow: 'hidden',
  },
  gaugeFill: {
    height: '100%',
    borderRadius: 3,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: '48%',
    flexGrow: 1,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  metricLabel: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontFamily: 'Archivo-Black',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  emptyCard: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 8,
  },
  emptySubtitle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
    maxWidth: 260,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  historyMode: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  historyMeta: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  menuCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  menuRowText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  badgeCard: {
    width: 140,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  badgeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  badgeTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  badgeDesc: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    lineHeight: 13,
    textAlign: 'center',
    marginTop: 2,
  },
});

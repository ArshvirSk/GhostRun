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
import { listFriends, fetchOperativeProfile } from '../../src/lib/friends';
import { getPlayerEchoProfile, PlayerEchoProfile } from '../../src/lib/echo';
import { TacticalPullRefreshScrollView } from '../../src/components/TacticalPullRefresh';
import { TACTICAL_GOLD } from '../../src/theme/tokens';
import { sanitizeCodename, sanitizeTagline, validateTagline } from '../../src/lib/codename';

interface MatchHistoryItem {
  id: string;
  game_id: string;
  mode_id: string;
  team: string;
  status: string;
  created_at: string;
  winner?: string;
}

export function YouContent() {
  const { colors, isDark, setAccentColor } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { formatDistance } = useUnits();

  const storedProfile = useUserStore((s) => s.profile);
  const [profile, setProfile] = useState<{ display_name: string; tagline?: string | null; color: string; is_cipher?: boolean; is_vanguard?: boolean } | null>(
    () => (storedProfile ? { display_name: storedProfile.display_name, tagline: storedProfile.tagline, color: storedProfile.color, is_cipher: storedProfile.is_cipher, is_vanguard: storedProfile.is_vanguard } : null)
  );
  const [userId, setUserId] = useState<string | null>(() => storedProfile?.id || null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(() => storedProfile?.display_name || '');
  const [draftTagline, setDraftTagline] = useState(() => storedProfile?.tagline || '');
  const [taglineError, setTaglineError] = useState<string | null>(null);
  const [draftColor, setDraftColor] = useState<string>(() => storedProfile?.color || colors.palette[0]);

  // Keep state synced with userStore
  useEffect(() => {
    if (storedProfile) {
      setProfile({
        display_name: storedProfile.display_name,
        tagline: storedProfile.tagline,
        color: storedProfile.color,
        is_cipher: storedProfile.is_cipher,
        is_vanguard: storedProfile.is_vanguard,
      });
      if (!isEditing) {
        setDraftName(storedProfile.display_name);
        setDraftTagline(storedProfile.tagline || '');
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
  const [echoProfile, setEchoProfile] = useState<PlayerEchoProfile | null>(null);

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
          if (parsed.tagline) setDraftTagline(parsed.tagline);
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
        .select('display_name, tagline, color')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (profData) {
        const defaultTag = profData.tagline || authData.user.id.slice(0, 4).toUpperCase();
        const mergedProf = { ...profData, tagline: defaultTag };
        setProfile(mergedProf);
        setDraftName(profData.display_name || '');
        setDraftTagline(defaultTag);
        const c = profData.color || colors.palette[0];
        setDraftColor(c);
        void setAccentColor(c);
        useUserStore.getState().setProfile({
          id: authData.user.id,
          display_name: profData.display_name,
          tagline: defaultTag,
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

      // Fetch personal Season Echo profile
      try {
        const ep = await getPlayerEchoProfile(authData.user.id);
        if (ep) {
          setEchoProfile(ep);
        }
      } catch {
        // non-blocking
      }

      // 3. Fetch operative dossier via fetchOperativeProfile for real career metrics
      let opDossier: any = null;
      try {
        opDossier = await fetchOperativeProfile(authData.user.id);
      } catch {
        // non-blocking
      }

      // 4. Fetch match history
      setLoadingHistory(true);
      const { data: playersData } = await supabase
        .from('players')
        .select('id, game_id, team, status, created_at, games(id, mode_id, winner, status, duration_s, live_at, ended_at)')
        .eq('user_id', authData.user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (playersData && Array.isArray(playersData)) {
        const items: MatchHistoryItem[] = playersData.map((p: any) => {
          const g: any = Array.isArray(p.games) ? p.games[0] : p.games;
          return {
            id: p.id,
            game_id: p.game_id,
            mode_id: g?.mode_id || 'classic_chase',
            team: p.team,
            status: p.status,
            created_at: p.created_at,
            winner: g?.winner,
          };
        });
        setHistory(items);

        const total = items.length;
        const won = items.filter((m) => m.team === m.winner).length;
        const neverCaughtCount = items.filter(
          (m) => m.team === 'runner' && m.status === 'active' && m.winner === 'runners',
        ).length;

        // Dynamic best escape calculation from actual runner victory matches
        let fallbackEscapeStr = '--';
        let maxEscapeSeconds = 0;
        for (const p of (playersData as any[])) {
          const g: any = Array.isArray(p.games) ? p.games[0] : p.games;
          const isRunnerEscape = p.team === 'runner' && p.status === 'active' && g?.winner === 'runners';
          if (isRunnerEscape && g) {
            let dur = 0;
            if (g.live_at && g.ended_at) {
              dur = Math.max(0, Math.round((new Date(g.ended_at).getTime() - new Date(g.live_at).getTime()) / 1000));
            } else if (g.duration_s) {
              dur = g.duration_s;
            }
            if (dur > maxEscapeSeconds) {
              maxEscapeSeconds = dur;
            }
          }
        }
        if (maxEscapeSeconds > 0) {
          fallbackEscapeStr = `${Math.floor(maxEscapeSeconds / 60)}m ${(maxEscapeSeconds % 60).toString().padStart(2, '0')}s`;
        }

        const realBestEscape = opDossier?.bestEscape && opDossier.bestEscape !== '--'
          ? opDossier.bestEscape
          : fallbackEscapeStr;

        const realFarthestMeters = typeof opDossier?.farthestMeters === 'number'
          ? opDossier.farthestMeters
          : 0;

        setStats({
          rounds: opDossier?.rounds ?? total,
          won: opDossier?.won ?? won,
          winRate: opDossier?.winRate ?? (total > 0 ? Math.round((won / total) * 100) : 0),
          neverCaught: opDossier?.neverCaught ?? neverCaughtCount,
          bestEscape: realBestEscape,
          farthestMeters: realFarthestMeters,
        });

        const earned = new Set<string>();
        if (opDossier?.badges && Array.isArray(opDossier.badges)) {
          opDossier.badges.forEach((b: string) => earned.add(b));
        }
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

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadProfileAndHistory();
    } finally {
      setRefreshing(false);
    }
  }, [loadProfileAndHistory]);

  const handleSelectColor = async (c: string) => {
    triggerHaptic('buttonTap');
    setDraftColor(c);
    void setAccentColor(c);
    const currentName = draftName || profile?.display_name || 'Operative';
    const updated = { display_name: currentName, tagline: profile?.tagline || null, color: c };
    setProfile(updated);
    try {
      await AsyncStorage.setItem('@ghostrun:profile', JSON.stringify(updated));
      if (userId && supabase) {
        await supabase.from('profiles').update({ color: c }).eq('id', userId);
      }
      useUserStore.getState().setProfile({
        id: userId || '',
        display_name: updated.display_name,
        tagline: updated.tagline,
        color: c,
      });
    } catch {
      // non-blocking
    }
  };

  const saveProfile = async () => {
    const cleanName = sanitizeCodename(draftName);
    if (!cleanName || !userId || !supabase) return;

    const fallbackTag = userId ? userId.slice(0, 4).toUpperCase() : '10D1';
    let cleanTag = draftTagline.trim() ? sanitizeTagline(draftTagline) : (profile?.tagline || fallbackTag);
    if (cleanTag) {
      const tagVal = validateTagline(cleanTag);
      if (!tagVal.valid) {
        setTaglineError(tagVal.error || 'Tagline must be 3-5 alphanumeric characters.');
        return;
      }
      cleanTag = tagVal.clean;
    }

    setSavingProfile(true);
    setTaglineError(null);
    triggerHaptic('buttonTap');
    try {
      const updated = { display_name: cleanName, tagline: cleanTag, color: draftColor };
      const { error: updateErr } = await supabase.from('profiles').update(updated).eq('id', userId);
      if (updateErr) {
        setTaglineError(updateErr.message);
        return;
      }
      await AsyncStorage.setItem('@ghostrun:profile', JSON.stringify(updated));
      await setAccentColor(draftColor);
      useUserStore.getState().setProfile({ id: userId, ...updated });
      setProfile(updated);
      setDraftName(cleanName);
      setDraftTagline(cleanTag || '');
      setIsEditing(false);
    } catch (err: any) {
      setTaglineError(err?.message || 'Failed to update credentials');
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
      <TacticalPullRefreshScrollView
        refreshing={refreshing}
        onRefresh={handleRefresh}
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
              <View style={[styles.avatarLiveBadge, { backgroundColor: signatureColor }]} />
            </View>

            {/* Operative Callsign & Credentials */}
            <View style={styles.heroMeta}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <Text style={[styles.codenameText, { color: colors.text }]} numberOfLines={1}>
                  @{displayName.toUpperCase()}
                </Text>
                {Boolean(profile?.tagline) && (
                  <Text style={[styles.taglineText, { color: colors.textMuted }]}>
                    #{profile?.tagline?.toUpperCase()}
                  </Text>
                )}
                {Boolean(profile?.is_cipher || profile?.is_vanguard) && (
                  <View style={styles.cpBadgePill}>
                    <Text style={styles.cpBadgePillText}>CP</Text>
                  </View>
                )}
              </View>

              <Text style={[styles.rankText, { color: colors.textMuted }]}>
                ACTIVE PLAYER
              </Text>
            </View>
          </View>

          {/* Quick Monochromatic Theme & Palette Selector (2 Rows of 8, Perfectly Aligned) */}
          <View
            style={[
              styles.quickThemeBar,
              { borderTopColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)' },
            ]}
          >
            <View style={styles.paletteGrid}>
              <View style={styles.paletteRow}>
                {colors.palette.slice(0, 8).map((c) => {
                  const isSelected = (profile?.color || colors.primary).toLowerCase() === c.toLowerCase();
                  const isLight = ['#c7f36b', '#fbbf24', '#38bdf8', '#b8a3ff', '#14b8a6', '#84cc16'].includes(c.toLowerCase());
                  return (
                    <Pressable
                      key={`quick-${c}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Select theme color ${c}`}
                      onPress={() => void handleSelectColor(c)}
                      style={[
                        styles.paletteSwatch,
                        { backgroundColor: c },
                        isSelected && styles.paletteSwatchSelected,
                      ]}
                    >
                      {isSelected && (
                        <Ionicons name="checkmark-sharp" size={16} color={isLight ? '#000000' : '#FFFFFF'} />
                      )}
                    </Pressable>
                  );
                })}
              </View>

              <View style={[styles.paletteRow, { marginTop: 10 }]}>
                {colors.palette.slice(8, 16).map((c) => {
                  const isSelected = (profile?.color || colors.primary).toLowerCase() === c.toLowerCase();
                  const isLight = ['#c7f36b', '#fbbf24', '#38bdf8', '#b8a3ff', '#14b8a6', '#84cc16'].includes(c.toLowerCase());
                  return (
                    <Pressable
                      key={`quick-${c}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Select theme color ${c}`}
                      onPress={() => void handleSelectColor(c)}
                      style={[
                        styles.paletteSwatch,
                        { backgroundColor: c },
                        isSelected && styles.paletteSwatchSelected,
                      ]}
                    >
                      {isSelected && (
                        <Ionicons name="checkmark-sharp" size={16} color={isLight ? '#000000' : '#FFFFFF'} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Operative Action Triggers (Preview Profile & Edit Callsign) */}
          <View style={styles.avatarActionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Preview Public Profile"
              onPress={() => {
                triggerHaptic('buttonTap');
                if (userId) {
                  router.push({
                    pathname: '/profile/[id]',
                    params: { id: userId, name: profile?.display_name || '', color: profile?.color || '' },
                  });
                }
              }}
              style={({ pressed }) => [
                styles.avatarActionBtn,
                {
                  backgroundColor: isDark ? colors.surfaceMuted : colors.surfaceElevated,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Ionicons name="person-outline" size={14} color={colors.text} />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={[styles.avatarActionBtnText, { color: colors.text }]}
              >
                Preview Profile
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit Codename"
              onPress={() => {
                triggerHaptic('buttonTap');
                setIsEditing(!isEditing);
              }}
              style={({ pressed }) => [
                styles.avatarActionBtn,
                {
                  backgroundColor: isDark ? colors.surfaceMuted : colors.surfaceElevated,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Ionicons
                name={isEditing ? 'close' : 'create-outline'}
                size={14}
                color={colors.text}
              />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={[styles.avatarActionBtnText, { color: colors.text }]}
              >
                {isEditing ? 'Close Editor' : 'Edit Codename'}
              </Text>
            </Pressable>
          </View>

          {/* Edit Panel Drawer */}
          {isEditing && (
            <View style={[styles.editDrawer, { borderTopColor: colors.border }]}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {/* CODENAME INPUT */}
                <View style={{ flex: 2 }}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>
                    CODENAME
                  </Text>
                  <TextInput
                    value={draftName}
                    onChangeText={(text) => {
                      setDraftName(sanitizeCodename(text));
                      if (taglineError) setTaglineError(null);
                    }}
                    placeholder="YOUR CODENAME"
                    placeholderTextColor={colors.textSubtle}
                    maxLength={20}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={[
                      styles.textInput,
                      {
                        backgroundColor: isDark ? colors.surface : colors.surfaceElevated,
                        color: colors.text,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                </View>

                {/* DISCRIMINATOR TAGLINE INPUT */}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>
                    TAG (#)
                  </Text>
                  <View
                    style={[
                      styles.tagInputWrapper,
                      {
                        backgroundColor: isDark ? colors.surface : colors.surfaceElevated,
                        borderColor: taglineError ? (colors.danger || '#ef4444') : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.tagPrefix, { color: colors.textMuted }]}>#</Text>
                    <TextInput
                      value={draftTagline}
                      onChangeText={(text) => {
                        setDraftTagline(sanitizeTagline(text));
                        if (taglineError) setTaglineError(null);
                      }}
                      placeholder="10D1"
                      placeholderTextColor={colors.textSubtle}
                      maxLength={5}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      style={[
                        styles.tagInput,
                        {
                          color: colors.text,
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>

              {taglineError && (
                <Text style={[styles.errorHelperText, { color: colors.danger || '#ef4444' }]}>
                  {taglineError}
                </Text>
              )}

              <Button
                title={savingProfile ? 'Updating Credentials…' : 'Save Codename & Tag'}
                variant="primary"
                size="md"
                disabled={savingProfile || !draftName.trim()}
                style={{ marginTop: 16 }}
                onPress={() => void saveProfile()}
              />
            </View>
          )}
        </Card>

        {/* Season Echo Tier & Standing Card - Direct Leaderboard Access */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Season Echo Division and Leaderboard"
          onPress={() => {
            triggerHaptic('buttonTap');
            router.push('/leaderboard' as any);
          }}
          style={({ pressed }) => [
            styles.echoTierCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.border,
            },
            pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
          ]}
        >
          {/* Main Echo Metrics Row */}
          <View style={styles.echoTierHeaderRow}>
            {/* Left: Label & Tier */}
            <View>
              <Text style={[styles.echoTierSeasonLabel, { color: colors.textMuted }]}>
                SEASON ECHO
              </Text>
              <Text style={[styles.echoTierTitle, { color: colors.primary }]}>
                Tier {echoProfile?.tier || 'Whisper'}
              </Text>
            </View>

            {/* Right: Points & Rates */}
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.echoTierPts, { color: colors.text }]}>
                {echoProfile?.echoTotal ?? 0}{' '}
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primary }}>PTS</Text>
              </Text>
              <Text style={[styles.echoTierSubRates, { color: colors.textMuted }]}>
                {Math.round((echoProfile?.avgGhost || 0) * 100)}% Ghost • {Math.round((echoProfile?.avgCash || 0) * 100)}% Cash
              </Text>
            </View>
          </View>

          {/* Sleek Leaderboard Access Footer */}
          <View
            style={[
              styles.echoTierFooterRow,
              {
                borderTopColor: isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)',
              },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="trophy-outline" size={14} color={colors.accent || '#F59E0B'} />
              <Text style={[styles.echoTierFooterText, { color: colors.textSecondary }]}>
                Echo Rankings
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.echoTierFooterAction, { color: colors.primary }]}>
                View Leaderboard
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.primary} />
            </View>
          </View>
        </Pressable>

        {/* Friends (Operative Network & Invites) - Full Width Hub Card */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Operative Network (Friends)"
          onPress={() => {
            triggerHaptic('buttonTap');
            router.push('/friends' as any);
          }}
          style={({ pressed }) => [
            styles.friendsCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.border,
            },
            pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] },
          ]}
        >
          <View
            style={[
              styles.friendsIconWrap,
              {
                backgroundColor: isDark
                  ? 'rgba(199, 243, 107, 0.12)'
                  : 'rgba(85, 122, 34, 0.10)',
              },
            ]}
          >
            <Ionicons name="people" size={20} color={colors.primary} />
          </View>
          <View style={styles.friendsMeta}>
            <View style={styles.friendsTitleRow}>
              <Text style={[styles.friendsTitle, { color: colors.text }]}>
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
            <Text style={[styles.friendsSub, { color: colors.textMuted }]}>
              Network & Invites
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>

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
          nestedScrollEnabled={true}
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
      </TacticalPullRefreshScrollView>

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
  friendsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    marginBottom: 20,
  },
  friendsIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendsMeta: {
    flex: 1,
    justifyContent: 'center',
  },
  friendsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  friendsTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  friendsSub: {
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
  taglineText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cpBadgePill: {
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderColor: TACTICAL_GOLD.primary,
    backgroundColor: TACTICAL_GOLD.bgMedium,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  cpBadgePillText: {
    fontFamily: 'Archivo-Black',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    color: TACTICAL_GOLD.primary,
  },
  rankText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  avatarActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  avatarActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 38,
    paddingHorizontal: 8,
    borderRadius: 19,
    borderWidth: 1,
  },
  avatarActionBtnText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
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
  tagInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  tagPrefix: {
    fontFamily: 'Archivo-Black',
    fontSize: 15,
    fontWeight: '900',
    marginRight: 4,
  },
  tagInput: {
    flex: 1,
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 15,
    fontWeight: '700',
    padding: 0,
    height: '100%',
  },
  errorHelperText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  quickThemeBar: {
    marginTop: 14,
    marginBottom: 4,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  paletteGrid: {
    paddingVertical: 4,
  },
  paletteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paletteSwatch: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paletteSwatchSelected: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.14 }],
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
  echoTierCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  echoTierHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  echoTierSeasonLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  echoTierTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  echoTierPts: {
    fontFamily: 'Archivo-Black',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 2,
  },
  echoTierSubRates: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
  },
  echoTierFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  echoTierFooterText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 12,
    fontWeight: '600',
  },
  echoTierFooterAction: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});

export default function YouRoute() {
  return null;
}

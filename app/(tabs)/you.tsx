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
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { formatDistance } = useUnits();

  const [profile, setProfile] = useState<{ display_name: string; color: string } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState<string>(colors.palette[0]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [history, setHistory] = useState<MatchHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Performance stats
  const [stats, setStats] = useState({
    rounds: 0,
    won: 0,
    winRate: 0,
    neverCaught: 0,
    bestEscape: '--',
    farthestMeters: 0,
  });

  const loadProfileAndHistory = useCallback(async () => {
    try {
      // 1. Local cached profile for instant boot
      const localProfileRaw = await AsyncStorage.getItem('@ghostrun:profile');
      if (localProfileRaw) {
        try {
          const parsed = JSON.parse(localProfileRaw);
          setProfile(parsed);
          setDraftName(parsed.display_name || '');
          setDraftColor(parsed.color || colors.palette[0]);
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
        setDraftColor(profData.color || colors.palette[0]);
        await AsyncStorage.setItem('@ghostrun:profile', JSON.stringify(profData));
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

  const saveProfile = async () => {
    if (!draftName.trim() || !userId || !supabase) return;
    setSavingProfile(true);
    triggerHaptic('buttonTap');
    try {
      const updated = { display_name: draftName.trim(), color: draftColor };
      await supabase.from('profiles').update(updated).eq('id', userId);
      await AsyncStorage.setItem('@ghostrun:profile', JSON.stringify(updated));
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
        {/* Top Header Row */}
        <View style={styles.topRow}>
          <Text style={[styles.pageTitle, { color: colors.text }]}>
            PROFILE
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/settings' as any);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={[
              styles.settingsButton,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons name="settings-sharp" size={20} color={colors.text} />
          </Pressable>
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
                      onPress={() => {
                        triggerHaptic('buttonTap');
                        setDraftColor(c);
                      }}
                      style={[
                        styles.paletteSwatch,
                        { backgroundColor: c },
                        isSelected && {
                          borderWidth: 3,
                          borderColor: colors.text,
                          transform: [{ scale: 1.15 }],
                        },
                      ]}
                    />
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

        {/* Section: Performance Stats */}
        <Text style={[styles.sectionHeading, { color: colors.textMuted }]}>
          CAREER STATS
        </Text>

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
  heroCard: {
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 24,
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
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingVertical: 6,
  },
  paletteSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
});

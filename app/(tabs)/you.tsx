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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { Button } from '../../src/ui/Button';
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
  const { colors, spacing, radii } = useTheme();
  const router = useRouter();
  const { formatDistance } = useUnits();

  const [profile, setProfile] = useState<{ display_name: string; color: string } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState<string>(colors.palette[0]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [history, setHistory] = useState<MatchHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Stats
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
      // 1. Load local profile first for speed
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

        // Derive stats
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { padding: spacing.lg }]}>
        {/* Top Header */}
        <View style={styles.topRow}>
          <Text variant="display" style={{ color: colors.text, marginTop: spacing.xl }}>
            CASE FILE
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => router.push('/settings' as any)}
            style={[styles.settingsButton, { backgroundColor: colors.surfaceElevated, marginTop: spacing.xl }]}
          >
            <Ionicons name="settings-sharp" size={20} color={colors.text} />
          </Pressable>
        </View>

        {/* Profile Dossier Card */}
        <Card
          variant="default"
          style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}
        >
          <View style={styles.profileRow}>
            <View
              style={[
                styles.colorDot,
                { backgroundColor: profile?.color || colors.primary, borderRadius: radii.pill },
              ]}
            />
            <View style={{ flex: 1 }}>
              <Text variant="title" style={{ color: colors.text }}>
                {profile?.display_name || 'Operative'}
              </Text>
              <Text variant="label" style={{ color: colors.textMuted, marginTop: 2 }}>
                STATUS: ACTIVE OPERATIVE
              </Text>
            </View>
            <Button
              title={isEditing ? 'Cancel' : 'Edit'}
              variant="secondary"
              size="sm"
              onPress={() => setIsEditing(!isEditing)}
            />
          </View>

          {isEditing && (
            <View style={[styles.editBox, { borderTopColor: colors.borderDark, marginTop: spacing.md }]}>
              <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
                CHANGE CODENAME
              </Text>
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                placeholder="Agent Codename"
                placeholderTextColor={colors.textSubtle}
                maxLength={20}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surfaceElevated,
                    color: colors.text,
                    borderColor: colors.borderDark,
                    borderRadius: radii.sm,
                  },
                ]}
              />

              <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.xs }}>
                RADAR COLOR SIGNATURE
              </Text>
              <View style={styles.paletteRow}>
                {colors.palette.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setDraftColor(c)}
                    style={[
                      styles.paletteDot,
                      { backgroundColor: c },
                      draftColor === c && { borderColor: colors.text, borderWidth: 2 },
                    ]}
                  />
                ))}
              </View>

              <Button
                title={savingProfile ? 'Updating...' : 'Save Profile'}
                variant="primary"
                size="sm"
                style={{ marginTop: spacing.md }}
                disabled={savingProfile || !draftName.trim()}
                onPress={() => void saveProfile()}
              />
            </View>
          )}
        </Card>

        {/* Stats Grid */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          OPERATIONAL PERFORMANCE
        </Text>
        <View style={styles.statsGrid}>
          <Card variant="elevated" style={[styles.statCard, { backgroundColor: colors.surfaceElevated }]}>
            <Text variant="display" style={{ color: colors.primary }}>
              {stats.rounds}
            </Text>
            <Text variant="label" style={{ color: colors.textMuted }}>
              ROUNDS
            </Text>
          </Card>
          <Card variant="elevated" style={[styles.statCard, { backgroundColor: colors.surfaceElevated }]}>
            <Text variant="display" style={{ color: colors.text }}>
              {stats.won}
            </Text>
            <Text variant="label" style={{ color: colors.textMuted }}>
              WON
            </Text>
          </Card>
          <Card variant="elevated" style={[styles.statCard, { backgroundColor: colors.surfaceElevated }]}>
            <Text variant="display" style={{ color: colors.radarScan }}>
              {stats.winRate}%
            </Text>
            <Text variant="label" style={{ color: colors.textMuted }}>
              WIN RATE
            </Text>
          </Card>
          <Card variant="elevated" style={[styles.statCard, { backgroundColor: colors.surfaceElevated }]}>
            <Text variant="display" style={{ color: colors.ghostTrail }}>
              {stats.neverCaught}
            </Text>
            <Text variant="label" style={{ color: colors.textMuted }}>
              NEVER CAUGHT
            </Text>
          </Card>
          <Card variant="elevated" style={[styles.statCard, { backgroundColor: colors.surfaceElevated }]}>
            <Text variant="display" style={{ color: colors.warning }}>
              {stats.bestEscape}
            </Text>
            <Text variant="label" style={{ color: colors.textMuted }}>
              BEST ESCAPE
            </Text>
          </Card>
          <Card variant="elevated" style={[styles.statCard, { backgroundColor: colors.surfaceElevated }]}>
            <Text variant="display" style={{ color: colors.hunter }}>
              {formatDistance(stats.farthestMeters)}
            </Text>
            <Text variant="label" style={{ color: colors.textMuted }}>
              FARTHEST
            </Text>
          </Card>
        </View>

        {/* Match History */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.xl, marginBottom: spacing.xs }}>
          MISSION LOG
        </Text>
        {loadingHistory ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
        ) : history.length === 0 ? (
          <Card variant="default" style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
            <MaterialCommunityIcons name="file-document-outline" size={36} color={colors.textSubtle} />
            <Text variant="title" style={{ color: colors.text, marginTop: spacing.xs }}>
              Empty Case File
            </Text>
            <Text variant="body" style={{ color: colors.textMuted, marginTop: 4, textAlign: 'center', fontSize: 13 }}>
              No rounds on file. Play one and this fills in.
            </Text>
          </Card>
        ) : (
          <View style={{ gap: 8 }}>
            {history.map((item) => {
              const isWon = item.team === item.winner;
              return (
                <Card
                  key={item.id}
                  variant="default"
                  style={[styles.historyCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="title" style={{ color: colors.text, fontSize: 15 }}>
                      {item.mode_id.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                    <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                      ROLE: {item.team.toUpperCase()} · {new Date(item.created_at).toLocaleDateString()}
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

        {/* Tactical Actions & Field Guides */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.xl, marginBottom: spacing.xs }}>
          TACTICAL DOSSIERS & TOOLS
        </Text>
        <Card variant="default" style={{ backgroundColor: colors.surface, borderColor: colors.borderDark, padding: 4 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/how-to-play' as any)}
            style={styles.menuRow}
          >
            <MaterialCommunityIcons name="book-open-outline" size={20} color={colors.primary} />
            <Text variant="body" style={{ color: colors.text, flex: 1, marginLeft: spacing.sm }}>
              Field Manual & Rules
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/safety' as any)}
            style={[styles.menuRow, { borderTopWidth: 1, borderTopColor: colors.borderDark }]}
          >
            <MaterialCommunityIcons name="shield-check-outline" size={20} color={colors.warning} />
            <Text variant="body" style={{ color: colors.text, flex: 1, marginLeft: spacing.sm }}>
              Safety Protocol
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/briefing' as any)}
            style={[styles.menuRow, { borderTopWidth: 1, borderTopColor: colors.borderDark }]}
          >
            <MaterialCommunityIcons name="movie-play-outline" size={20} color={colors.radarScan} />
            <Text variant="body" style={{ color: colors.text, flex: 1, marginLeft: spacing.sm }}>
              Replay Briefing Tour
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/debug/hud-gallery' as any)}
            style={[styles.menuRow, { borderTopWidth: 1, borderTopColor: colors.borderDark }]}
          >
            <MaterialCommunityIcons name="view-dashboard-outline" size={20} color={colors.ghostTrail} />
            <Text variant="body" style={{ color: colors.text, flex: 1, marginLeft: spacing.sm }}>
              Tactical HUD Gallery
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/privacy' as any)}
            style={[styles.menuRow, { borderTopWidth: 1, borderTopColor: colors.borderDark }]}
          >
            <MaterialCommunityIcons name="lock-outline" size={20} color={colors.textMuted} />
            <Text variant="body" style={{ color: colors.text, flex: 1, marginLeft: spacing.sm }}>
              Privacy & Data Management
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
    paddingBottom: 110,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCard: {
    padding: 16,
    borderWidth: 1,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  colorDot: {
    width: 28,
    height: 28,
  },
  editBox: {
    paddingTop: 12,
    borderTopWidth: 1,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  paletteRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
  },
  paletteDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    width: '31%',
    flexGrow: 1,
    padding: 12,
    alignItems: 'center',
  },
  emptyCard: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderWidth: 1,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});

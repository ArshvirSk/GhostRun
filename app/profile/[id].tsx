import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Card } from '../../src/ui/Card';
import { Button } from '../../src/ui/Button';
import { triggerHaptic } from '../../src/motion/haptics';
import {
  fetchOperativeProfile,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
} from '../../src/lib/friends';
import { OperativeProfileDossier } from '../../src/lib/friendsCore';
import { BADGE_CATALOG } from '../../src/lib/badges';
import { useUnits } from '../../src/utils/units';

export default function OperativeProfileScreen() {
  const { id, name, color } = useLocalSearchParams<{
    id: string | string[];
    name?: string;
    color?: string;
  }>();
  const rawId = Array.isArray(id) ? id[0] : id;
  const targetId = typeof rawId === 'string' ? rawId.trim() : '';

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { formatDistance } = useUnits();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dossier, setDossier] = useState<OperativeProfileDossier | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorDetail, setErrorDetail] = useState('');

  const loadProfile = useCallback(async () => {
    if (!targetId) {
      setErrorDetail(`Invalid ID received: "${String(id)}"`);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchOperativeProfile(targetId);
      if (!data) {
        setErrorDetail(`Operative dossier returned null for "${targetId}"`);
        setDossier(null);
      } else {
        setDossier(data);
        setErrorDetail('');
      }
    } catch (err: any) {
      setErrorDetail(err?.message || String(err));
      setDossier(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [targetId, id]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadProfile();
  }, [loadProfile]);

  const handleSendRequest = async () => {
    if (!dossier) return;
    const identifier = dossier.tagline ? `${dossier.displayName}#${dossier.tagline}` : (dossier.handle || dossier.displayName);
    if (!identifier) return;

    triggerHaptic('buttonTap');
    setActionLoading(true);
    const res = await sendFriendRequest(identifier);
    setActionLoading(false);

    if (res.success) {
      triggerHaptic('tagConfirmed');
      setDossier((prev) =>
        prev
          ? {
              ...prev,
              friendshipStatus:
                res.status === 'accepted' || res.status === 'already_friends'
                  ? 'friend'
                  : 'pending_outgoing',
              isFriend: res.status === 'accepted' || res.status === 'already_friends',
            }
          : null,
      );
    } else {
      triggerHaptic('error');
      Alert.alert('Request Failed', res.error || res.reason || 'Could not send friend request');
    }
  };

  const handleAcceptRequest = async () => {
    if (!dossier) return;
    triggerHaptic('buttonTap');
    setActionLoading(true);
    const res = await respondFriendRequest(dossier.userId, 'accept');
    setActionLoading(false);

    if (res.success) {
      triggerHaptic('tagConfirmed');
      setDossier((prev) => (prev ? { ...prev, friendshipStatus: 'friend', isFriend: true } : null));
      void loadProfile();
    } else {
      triggerHaptic('error');
      Alert.alert('Error', res.error || 'Failed to accept friend request');
    }
  };

  const handleRemoveOperative = () => {
    if (!dossier) return;
    triggerHaptic('buttonTap');
    Alert.alert(
      'Remove Friend',
      `Remove @${dossier.displayName} from your friends?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            const ok = await removeFriend(dossier.userId);
            setActionLoading(false);
            if (ok) {
              triggerHaptic('tagConfirmed');
              setDossier((prev) =>
                prev
                  ? {
                      ...prev,
                      friendshipStatus: 'none',
                      isFriend: false,
                      isRedacted: prev.visibility === 'private',
                    }
                  : null,
              );
            } else {
              triggerHaptic('error');
              Alert.alert('Error', 'Failed to remove friend');
            }
          },
        },
      ],
    );
  };

  const displayName = (dossier?.displayName || name || 'OPERATIVE').toUpperCase();
  const displayHandle = dossier?.handle ? `@${dossier.handle}` : null;
  const avatarColor = dossier?.color || color || colors.primary;
  const firstLetter = displayName.charAt(0).toUpperCase();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Top Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => {
            triggerHaptic('buttonTap');
            router.back();
          }}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>BACK</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>OPERATIVE DOSSIER</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 24, 40) },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Identity Card */}
        <Card
          variant="default"
          style={[
            styles.identityCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.identityRow}>
            <View style={[styles.avatarCircle, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarInitial}>{firstLetter}</Text>
            </View>

            <View style={styles.identityMeta}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <Text numberOfLines={1} style={[styles.displayName, { color: colors.text }]}>
                  {displayName}
                </Text>
                {Boolean(dossier?.tagline) && (
                  <Text style={[styles.taglineText, { color: colors.textMuted }]}>
                    #{dossier?.tagline?.toUpperCase()}
                  </Text>
                )}
                {dossier?.isSelf && (
                  <View
                    style={[
                      styles.tagBadge,
                      {
                        backgroundColor: isDark
                          ? 'rgba(199, 243, 107, 0.2)'
                          : 'rgba(85, 122, 34, 0.2)',
                      },
                    ]}
                  >
                    <Text style={[styles.tagBadgeText, { color: colors.primary }]}>YOU</Text>
                  </View>
                )}
              </View>

              {displayHandle && (
                <Text style={[styles.displayHandle, { color: colors.textMuted }]}>
                  {displayHandle}
                </Text>
              )}

              {/* Status Row */}
              <View style={styles.statusRow}>
                {dossier?.isFriend ? (
                  <View
                    style={[
                      styles.pillBadge,
                      {
                        backgroundColor: isDark
                          ? 'rgba(74, 222, 128, 0.15)'
                          : 'rgba(22, 101, 52, 0.12)',
                        borderColor: colors.success,
                      },
                    ]}
                  >
                    <Ionicons name="shield-checkmark" size={12} color={colors.success} />
                    <Text style={[styles.pillBadgeText, { color: colors.success }]}>
                      FRIENDS
                    </Text>
                  </View>
                ) : dossier?.isRedacted ? (
                  <View
                    style={[
                      styles.pillBadge,
                      {
                        backgroundColor: isDark
                          ? 'rgba(248, 113, 113, 0.15)'
                          : 'rgba(153, 27, 27, 0.12)',
                        borderColor: colors.danger,
                      },
                    ]}
                  >
                    <Ionicons name="lock-closed" size={12} color={colors.danger} />
                    <Text style={[styles.pillBadgeText, { color: colors.danger }]}>
                      PRIVATE PROFILE
                    </Text>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.pillBadge,
                      {
                        backgroundColor: isDark
                          ? 'rgba(199, 243, 107, 0.15)'
                          : 'rgba(85, 122, 34, 0.12)',
                        borderColor: colors.primary,
                      },
                    ]}
                  >
                    <Ionicons name="globe-outline" size={12} color={colors.primary} />
                    <Text style={[styles.pillBadgeText, { color: colors.primary }]}>
                      PUBLIC PROFILE
                    </Text>
                  </View>
                )}

                {dossier?.presence?.online && (
                  <View
                    style={[
                      styles.pillBadge,
                      {
                        backgroundColor: isDark
                          ? 'rgba(199, 243, 107, 0.15)'
                          : 'rgba(85, 122, 34, 0.12)',
                        borderColor: colors.primary,
                      },
                    ]}
                  >
                    <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
                    <Text style={[styles.pillBadgeText, { color: colors.primary }]}>
                      {dossier.presence.gameId ? 'HOSTING LOBBY' : 'ONLINE'}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </Card>

        {/* Loading State */}
        {loading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.stateText, { color: colors.textMuted }]}>
              Loading profile…
            </Text>
          </View>
        ) : !dossier ? (
          <View style={styles.stateContainer}>
            <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.stateText, { color: colors.textMuted, marginTop: 12 }]}>
              Could not load profile. Pull to retry.
            </Text>
            {errorDetail ? (
              <Text style={{ color: colors.danger, marginTop: 8, fontSize: 12, textAlign: 'center', paddingHorizontal: 20 }}>
                {errorDetail}
              </Text>
            ) : null}
          </View>
        ) : dossier.isRedacted ? (
          /* ============================================================== */
          /* REDACTED / PRIVATE VIEW (Non-Friend + Private Profile) */
          /* ============================================================== */
          <View style={{ marginTop: 16 }}>
            <Card
              variant="default"
              style={[
                styles.redactedCard,
                {
                  backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name="shield-half-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.redactedTitle, { color: colors.text }]}>
                PRIVATE PROFILE
              </Text>
              <Text style={[styles.redactedSub, { color: colors.textMuted }]}>
                This player has a private profile. Match history, points, and stats are only visible to friends.
              </Text>
            </Card>

            {/* Friendship Action Area */}
            <View style={{ marginTop: 24 }}>
              {dossier.friendshipStatus === 'none' && (
                <Button
                  title={actionLoading ? 'Sending…' : '+ Add Friend'}
                  variant="primary"
                  size="lg"
                  disabled={actionLoading}
                  onPress={() => void handleSendRequest()}
                />
              )}
              {dossier.friendshipStatus === 'pending_outgoing' && (
                <Button
                  title="Friend Request Sent"
                  variant="secondary"
                  size="lg"
                  disabled
                />
              )}
              {dossier.friendshipStatus === 'pending_incoming' && (
                <Button
                  title={actionLoading ? 'Accepting…' : 'Accept Request'}
                  variant="primary"
                  size="lg"
                  disabled={actionLoading}
                  onPress={() => void handleAcceptRequest()}
                />
              )}
            </View>
          </View>
        ) : (
          /* ============================================================== */
          /* UNREDACTED VIEW (Friend OR Non-Friend with Public Profile) */
          /* ============================================================== */
          <View style={{ marginTop: 16 }}>
            {/* Echo & Tier Overview */}
            <Card
              variant="default"
              style={[
                styles.tierCard,
                {
                  backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.tierHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
                    SEASON ECHO TIER
                  </Text>
                  <Text style={[styles.tierTitle, { color: colors.primary }]}>
                    {dossier.tier || 'Whisper'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.echoPts, { color: colors.primary }]}>
                    {dossier.seasonEcho ?? 0}{' '}
                    <Text style={{ fontSize: 13, fontWeight: '700' }}>PTS</Text>
                  </Text>
                  <Text style={[styles.rateLine, { color: colors.textMuted }]}>
                    {Math.round(dossier.avgGhost ?? 0)}% Ghost • {Math.round(dossier.avgCash ?? 0)}% Cash
                  </Text>
                </View>
              </View>
            </Card>

            {/* Career Deployments Grid */}
            <View style={styles.statGrid}>
              <View
                style={[
                  styles.statBox,
                  {
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.statVal, { color: colors.text }]}>
                  {dossier.rounds ?? 0}
                </Text>
                <Text style={[styles.statLbl, { color: colors.textMuted }]}>MISSIONS</Text>
              </View>
              <View
                style={[
                  styles.statBox,
                  {
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.statVal, { color: colors.primary }]}>
                  {dossier.winRate ?? 0}%
                </Text>
                <Text style={[styles.statLbl, { color: colors.textMuted }]}>WIN RATE</Text>
              </View>
              <View
                style={[
                  styles.statBox,
                  {
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.statVal, { color: colors.accent || colors.primary }]}>
                  {dossier.neverCaught ?? 0}
                </Text>
                <Text style={[styles.statLbl, { color: colors.textMuted }]}>EVASIONS</Text>
              </View>
            </View>

            {/* Tactical Personal Records */}
            <View style={[styles.statGrid, { marginTop: 10 }]}>
              <View
                style={[
                  styles.statBox,
                  {
                    flex: 1,
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.statVal, { color: colors.warning }]}>
                  {dossier.bestEscape || '--'}
                </Text>
                <Text style={[styles.statLbl, { color: colors.textMuted }]}>BEST ESCAPE</Text>
              </View>
              <View
                style={[
                  styles.statBox,
                  {
                    flex: 1,
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.statVal, { color: colors.hunter }]}>
                  {formatDistance(dossier.farthestMeters || 0)}
                </Text>
                <Text style={[styles.statLbl, { color: colors.textMuted }]}>FARTHEST RUN</Text>
              </View>
            </View>

            {/* Badges Section */}
            <View style={{ marginTop: 20 }}>
              <Text style={[styles.sectionSubtitle, { color: colors.textMuted, marginBottom: 10 }]}>
                TACTICAL BADGES ({dossier.badges?.length || 0})
              </Text>
              {(!dossier.badges || dossier.badges.length === 0) ? (
                <Card
                  variant="default"
                  style={[
                    styles.emptyBox,
                    {
                      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.emptyBoxText, { color: colors.textMuted }]}>
                    No tactical honors unlocked yet.
                  </Text>
                </Card>
              ) : (
                <View style={styles.badgeWrap}>
                  {dossier.badges.slice(0, 8).map((badgeId) => {
                    const meta = BADGE_CATALOG.find((b) => b.id === badgeId);
                    return (
                      <View
                        key={badgeId}
                        style={[
                          styles.badgeChip,
                          {
                            backgroundColor: isDark
                              ? 'rgba(255,255,255,0.05)'
                              : 'rgba(0,0,0,0.04)',
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Ionicons
                          name={(meta?.icon as any) || 'ribbon-outline'}
                          size={15}
                          color={colors.primary}
                        />
                        <Text numberOfLines={1} style={[styles.badgeChipText, { color: colors.text }]}>
                          {meta?.title || badgeId}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Friend-Only Head-to-Head */}
            {dossier.isFriend && !dossier.isSelf && dossier.headToHead && (
              <View style={{ marginTop: 22 }}>
                <Text style={[styles.sectionSubtitle, { color: colors.textMuted, marginBottom: 10 }]}>
                  HEAD-TO-HEAD VS YOU
                </Text>
                <Card
                  variant="default"
                  style={[
                    styles.h2hCard,
                    {
                      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.h2hGrid}>
                    <View style={styles.h2hBox}>
                      <Text style={[styles.h2hNum, { color: colors.primary }]}>
                        {dossier.headToHead.myWins}
                      </Text>
                      <Text style={[styles.h2hLbl, { color: colors.textMuted }]}>YOUR WINS</Text>
                    </View>
                    <View style={styles.h2hBox}>
                      <Text style={[styles.h2hNum, { color: colors.danger }]}>
                        {dossier.headToHead.friendWins}
                      </Text>
                      <Text style={[styles.h2hLbl, { color: colors.textMuted }]}>THEIR WINS</Text>
                    </View>
                  </View>
                  <View style={[styles.h2hDetailRow, { borderTopColor: colors.border }]}>
                    <Text style={[styles.h2hDetailText, { color: colors.textMuted }]}>
                      Times Ghosted: <Text style={{ color: colors.success, fontWeight: '700' }}>{dossier.headToHead.timesGhostedThem}</Text>
                    </Text>
                    <Text style={[styles.h2hDetailText, { color: colors.textMuted }]}>
                      Times Tagged: <Text style={{ color: colors.danger, fontWeight: '700' }}>{dossier.headToHead.timesTheyCashedMe}</Text>
                    </Text>
                  </View>
                </Card>
              </View>
            )}

            {/* Friend-Only Recent Matches */}
            {dossier.isFriend && !dossier.isSelf && dossier.recentMatches && dossier.recentMatches.length > 0 && (
              <View style={{ marginTop: 22 }}>
                <Text style={[styles.sectionSubtitle, { color: colors.textMuted, marginBottom: 10 }]}>
                  RECENT MATCHES
                </Text>
                {dossier.recentMatches.map((m, idx) => (
                  <Card
                    key={`${m.game_id}_${idx}`}
                    variant="default"
                    style={[
                      styles.matchRow,
                      {
                        backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.matchMode, { color: colors.text }]}>
                        {m.mode_id ? m.mode_id.toUpperCase() : 'STANDARD'} • {m.team ? m.team.toUpperCase() : 'RUNNER'}
                      </Text>
                      <Text style={[styles.matchDate, { color: colors.textMuted }]}>
                        {m.created_at ? new Date(m.created_at).toLocaleDateString() : 'Recent'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.outcomeBadge,
                        {
                          backgroundColor: m.won
                            ? isDark ? 'rgba(74, 222, 128, 0.15)' : 'rgba(22, 101, 52, 0.12)'
                            : isDark ? 'rgba(248, 113, 113, 0.15)' : 'rgba(153, 27, 27, 0.12)',
                          borderColor: m.won ? colors.success : colors.danger,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.outcomeText,
                          { color: m.won ? colors.success : colors.danger },
                        ]}
                      >
                        {m.won ? 'VICTORY' : 'DEFEAT'}
                      </Text>
                    </View>
                  </Card>
                ))}
              </View>
            )}

            {/* Friendship Action Area at Bottom */}
            <View style={{ marginTop: 30 }}>
              {dossier.isFriend && !dossier.isSelf ? (
                <Button
                  title={actionLoading ? 'Removing…' : 'Remove Friend'}
                  variant="ghost"
                  size="md"
                  disabled={actionLoading}
                  onPress={handleRemoveOperative}
                />
              ) : !dossier.isSelf && dossier.friendshipStatus ? (
                dossier.friendshipStatus === 'pending_outgoing' ? (
                  <Button title="Friend Request Sent" variant="secondary" size="lg" disabled />
                ) : dossier.friendshipStatus === 'pending_incoming' ? (
                  <Button
                    title={actionLoading ? 'Accepting…' : 'Accept Request'}
                    variant="primary"
                    size="lg"
                    disabled={actionLoading}
                    onPress={() => void handleAcceptRequest()}
                  />
                ) : dossier.friendshipStatus === 'none' ? (
                  <Button
                    title={actionLoading ? 'Sending…' : '+ Add Friend'}
                    variant="primary"
                    size="lg"
                    disabled={actionLoading}
                    onPress={() => void handleSendRequest()}
                  />
                ) : null
              ) : null}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingRight: 12,
  },
  backText: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'Orbitron_700Bold',
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'Orbitron_700Bold',
    letterSpacing: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  identityCard: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  avatarInitial: {
    fontSize: 26,
    fontWeight: '800',
    fontFamily: 'Orbitron_700Bold',
    color: '#000000',
  },
  identityMeta: {
    marginLeft: 16,
    flex: 1,
  },
  displayName: {
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'Orbitron_700Bold',
    letterSpacing: 0.5,
  },
  taglineText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Orbitron_700Bold',
    letterSpacing: 0.5,
  },
  displayHandle: {
    fontSize: 13,
    marginTop: 2,
    fontFamily: 'Orbitron_400Regular',
  },
  tagBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tagBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'Orbitron_700Bold',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  pillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  pillBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: 'Orbitron_700Bold',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  stateContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateText: {
    fontSize: 14,
    marginTop: 8,
    fontFamily: 'Orbitron_400Regular',
  },
  redactedCard: {
    alignItems: 'center',
    padding: 30,
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  redactedTitle: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'Orbitron_700Bold',
    letterSpacing: 1,
    marginTop: 14,
  },
  redactedSub: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 8,
  },
  tierCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  tierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionSubtitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: 'Orbitron_700Bold',
  },
  tierTitle: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: 'Orbitron_700Bold',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  echoPts: {
    fontSize: 22,
    fontWeight: '900',
    fontFamily: 'Orbitron_700Bold',
  },
  rateLine: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  statVal: {
    fontSize: 22,
    fontWeight: '900',
    fontFamily: 'Orbitron_700Bold',
  },
  statLbl: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 3,
    fontFamily: 'Orbitron_700Bold',
  },
  emptyBox: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyBoxText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  badgeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  h2hCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  h2hGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
  },
  h2hBox: {
    alignItems: 'center',
  },
  h2hNum: {
    fontSize: 26,
    fontWeight: '900',
    fontFamily: 'Orbitron_700Bold',
  },
  h2hLbl: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 2,
    fontFamily: 'Orbitron_700Bold',
  },
  h2hDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
  },
  h2hDetailText: {
    fontSize: 12,
    fontWeight: '600',
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  matchMode: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'Orbitron_700Bold',
  },
  matchDate: {
    fontSize: 11,
    marginTop: 2,
  },
  outcomeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  outcomeText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Orbitron_700Bold',
    letterSpacing: 0.5,
  },
});

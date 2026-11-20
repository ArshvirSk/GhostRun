import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import { useDialogModalAnimation } from '../motion';
import {
  fetchOperativeProfile,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
} from '../lib/friends';
import { OperativeProfileDossier } from '../lib/friendsCore';
import { BADGE_CATALOG } from '../lib/badges';

interface OperativeProfileModalProps {
  visible: boolean;
  targetUserId: string | null;
  initialName?: string;
  initialColor?: string;
  onClose: () => void;
  onFriendshipChanged?: () => void;
}

export function OperativeProfileModal({
  visible,
  targetUserId,
  initialName,
  initialColor,
  onClose,
  onFriendshipChanged,
}: OperativeProfileModalProps) {
  const { colors, isDark } = useTheme();
  const { mounted, fadeAnim, scaleAnim, handleClose } = useDialogModalAnimation(visible, onClose);
  const [loading, setLoading] = useState(false);
  const [dossier, setDossier] = useState<OperativeProfileDossier | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!visible || !targetUserId) {
      setDossier(null);
      return;
    }

    let isMounted = true;
    setLoading(true);

    fetchOperativeProfile(targetUserId)
      .then((res) => {
        if (isMounted) {
          setDossier(res);
        }
      })
      .catch(() => {
        if (isMounted) setDossier(null);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [visible, targetUserId]);

  const handleSendRequest = async () => {
    if (!dossier) return;
    const identifier = dossier.handle || dossier.displayName;
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
      onFriendshipChanged?.();
    } else {
      triggerHaptic('error');
      Alert.alert('Request Failed', res.error || res.reason || 'Could not send request');
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
      onFriendshipChanged?.();
      // Re-fetch full dossier now that friendship is established
      void fetchOperativeProfile(dossier.userId).then((updated) => {
        if (updated) setDossier(updated);
      });
    } else {
      triggerHaptic('error');
      Alert.alert('Error', res.error || 'Failed to accept request');
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
                  ? { ...prev, friendshipStatus: 'none', isFriend: false, isRedacted: prev.visibility === 'private' }
                  : null,
              );
              onFriendshipChanged?.();
            } else {
              Alert.alert('Error', 'Failed to remove friend');
            }
          },
        },
      ],
    );
  };

  const displayName = dossier?.displayName || initialName || 'Operative';
  const displayHandle = dossier?.handle ? `@${dossier.handle}` : null;
  const avatarColor = dossier?.color || initialColor || colors.primary;
  const firstLetter = displayName.charAt(0).toUpperCase();

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0,0,0,0.72)', opacity: fadeAnim },
          ]}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <Animated.View
          style={{
            width: '100%',
            maxWidth: 440,
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          }}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
          {/* Header Bar */}
          <View style={styles.headerBar}>
            <View style={styles.headerLeft}>
              <View style={[styles.avatarCircle, { backgroundColor: avatarColor }]}>
                <Text style={styles.avatarInitial}>{firstLetter}</Text>
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text numberOfLines={1} style={[styles.dossierName, { color: colors.text }]}>
                    {displayName}
                  </Text>
                  {dossier?.isSelf && (
                    <View
                      style={[
                        styles.youTag,
                        {
                          backgroundColor: isDark
                            ? 'rgba(199, 243, 107, 0.2)'
                            : 'rgba(85, 122, 34, 0.2)',
                        },
                      ]}
                    >
                      <Text style={[styles.youTagText, { color: colors.primary }]}>YOU</Text>
                    </View>
                  )}
                </View>
                {displayHandle && (
                  <Text style={[styles.dossierHandle, { color: colors.textMuted }]}>
                    {displayHandle}
                  </Text>
                )}
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={handleClose}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {/* Visibility / Status Badges Row */}
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
                <Ionicons name="shield-checkmark" size={13} color={colors.success} />
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
                <Ionicons name="lock-closed" size={13} color={colors.danger} />
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
                <Ionicons name="globe-outline" size={13} color={colors.primary} />
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

          {/* Loading Indicator */}
          {loading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                Loading profile…
              </Text>
            </View>
          ) : !dossier ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <Ionicons name="alert-circle-outline" size={44} color={colors.textMuted} />
              <Text style={[styles.loadingText, { color: colors.textMuted, marginTop: 8 }]}>
                Could not load profile.
              </Text>
            </View>
          ) : dossier.isRedacted ? (
            /* ============================================================== */
            /* REDACTED / PRIVATE VIEW (Non-Friend + Private Profile) */
            /* ============================================================== */
            <View style={styles.redactedContainer}>
              <View
                style={[
                  styles.redactedCard,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons name="shield-half-outline" size={44} color={colors.textMuted} />
                <Text style={[styles.redactedTitle, { color: colors.text }]}>
                  PRIVATE PROFILE
                </Text>
                <Text style={[styles.redactedSub, { color: colors.textMuted }]}>
                  This player has a private profile. Match history, points, and stats are only visible to friends.
                </Text>
              </View>

              {/* Friendship Action Area */}
              <View style={{ marginTop: 20 }}>
                {dossier.friendshipStatus === 'none' && (
                  <Button
                    title={actionLoading ? 'Sending…' : '+ Add Friend'}
                    variant="primary"
                    size="md"
                    disabled={actionLoading}
                    onPress={() => void handleSendRequest()}
                  />
                )}
                {dossier.friendshipStatus === 'pending_outgoing' && (
                  <Button
                    title="Friend Request Sent"
                    variant="secondary"
                    size="md"
                    disabled
                  />
                )}
                {dossier.friendshipStatus === 'pending_incoming' && (
                  <Button
                    title={actionLoading ? 'Accepting…' : 'Accept Request'}
                    variant="primary"
                    size="md"
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
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {/* Echo & Tier Overview */}
              <View
                style={[
                  styles.sectionCard,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.statRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
                      SEASON ECHO TIER
                    </Text>
                    <Text style={[styles.tierTitle, { color: colors.accent || colors.primary }]}>
                      {dossier?.tier || 'Whisper'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.echoPts, { color: colors.primary }]}>
                      {dossier?.seasonEcho ?? 0}{' '}
                      <Text style={{ fontSize: 12, fontWeight: '700' }}>PTS</Text>
                    </Text>
                    <Text style={[styles.rateLine, { color: colors.textMuted }]}>
                      {Math.round(dossier?.avgGhost ?? 0)}% Ghost • {Math.round(dossier?.avgCash ?? 0)}% Cash
                    </Text>
                  </View>
                </View>
              </View>

              {/* Career Deployments Grid */}
              <View style={styles.statGrid}>
                <View
                  style={[
                    styles.statBox,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.statVal, { color: colors.text }]}>
                    {dossier?.rounds ?? 0}
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.textMuted }]}>MISSIONS</Text>
                </View>
                <View
                  style={[
                    styles.statBox,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.statVal, { color: colors.primary }]}>
                    {dossier?.winRate ?? 0}%
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.textMuted }]}>WIN RATE</Text>
                </View>
                <View
                  style={[
                    styles.statBox,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.statVal, { color: colors.accent || colors.primary }]}>
                    {dossier?.neverCaught ?? 0}
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.textMuted }]}>EVASIONS</Text>
                </View>
              </View>

              {/* Badges Section */}
              <View style={{ marginTop: 12 }}>
                <Text style={[styles.sectionSubtitle, { color: colors.textMuted, marginBottom: 8 }]}>
                  TACTICAL BADGES ({dossier?.badges?.length || 0})
                </Text>
                {(!dossier?.badges || dossier.badges.length === 0) ? (
                  <View
                    style={[
                      styles.emptySubBox,
                      {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.emptySubText, { color: colors.textMuted }]}>
                      No tactical honors unlocked yet.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.badgeWrap}>
                    {dossier.badges.slice(0, 6).map((badgeId) => {
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
                            size={14}
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

              {/* Friend-Only Sections */}
              {dossier?.isFriend && !dossier.isSelf && dossier.headToHead && (
                <View style={{ marginTop: 16 }}>
                  <Text style={[styles.sectionSubtitle, { color: colors.textMuted, marginBottom: 8 }]}>
                    HEAD-TO-HEAD VS YOU
                  </Text>
                  <View
                    style={[
                      styles.sectionCard,
                      {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
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
                        Times Cashed: <Text style={{ color: colors.danger, fontWeight: '700' }}>{dossier.headToHead.timesTheyCashedMe}</Text>
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Actions Area */}
              <View style={{ marginTop: 20 }}>
                {dossier?.isFriend && !dossier.isSelf ? (
                  <Button
                    title={actionLoading ? 'Removing…' : 'Remove Friend'}
                    variant="ghost"
                    size="sm"
                    disabled={actionLoading}
                    onPress={handleRemoveOperative}
                  />
                ) : !dossier?.isSelf && dossier?.friendshipStatus ? (
                  dossier.friendshipStatus === 'pending_outgoing' ? (
                    <Button title="Friend Request Sent" variant="secondary" size="md" disabled />
                  ) : dossier.friendshipStatus === 'pending_incoming' ? (
                    <Button
                      title={actionLoading ? 'Accepting…' : 'Accept Request'}
                      variant="primary"
                      size="md"
                      disabled={actionLoading}
                      onPress={() => void handleAcceptRequest()}
                    />
                  ) : dossier.friendshipStatus === 'none' ? (
                    <Button
                      title={actionLoading ? 'Sending…' : '+ Add Friend'}
                      variant="primary"
                      size="md"
                      disabled={actionLoading}
                      onPress={() => void handleSendRequest()}
                    />
                  ) : null
                ) : null}
              </View>
            </ScrollView>
          )}
        </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: 'Archivo-Black',
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  dossierName: {
    fontFamily: 'Archivo-Black',
    fontSize: 18,
    fontWeight: '900',
  },
  dossierHandle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    marginTop: 1,
  },
  youTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  youTagText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  closeBtn: {
    padding: 6,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  pillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  pillBadgeText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  loadingText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    marginTop: 10,
  },
  redactedContainer: {
    paddingVertical: 10,
  },
  redactedCard: {
    padding: 24,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redactedTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginTop: 12,
    textAlign: 'center',
  },
  redactedSub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 8,
  },
  sectionCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  sectionSubtitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  tierTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 2,
  },
  echoPts: {
    fontFamily: 'Archivo-Black',
    fontSize: 20,
    fontWeight: '900',
  },
  rateLine: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    marginTop: 2,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  statBox: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
  },
  statVal: {
    fontFamily: 'Archivo-Black',
    fontSize: 18,
    fontWeight: '900',
  },
  statLbl: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  badgeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  badgeChipText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 11,
  },
  emptySubBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptySubText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
  },
  h2hGrid: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  h2hBox: {
    flex: 1,
    alignItems: 'center',
  },
  h2hNum: {
    fontFamily: 'Archivo-Black',
    fontSize: 22,
    fontWeight: '900',
  },
  h2hLbl: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  h2hDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
  },
  h2hDetailText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
  },
});

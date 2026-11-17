import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';
import { Button } from '../src/ui/Button';
import { SegmentBar } from '../src/ui/SegmentBar';
import { triggerHaptic } from '../src/motion/haptics';
import {
  FriendsBoardEntry,
  HeadToHeadStats,
  HOW_ECHO_WORKS_EXPLAINER,
  getBoardEmptyStateMessage,
} from '../src/lib/friendsBoardCore';
import {
  fetchFriendsBoard,
  fetchHeadToHead,
} from '../src/lib/friendsBoard';
import { updateFriendSettings } from '../src/lib/friends';

type LeaderboardTabKey = 'current' | 'previous' | 'guide';

export default function LeaderboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { colors, spacing, isDark } = useTheme();

  const [activeTab, setActiveTab] = useState<LeaderboardTabKey>('current');
  const [loading, setLoading] = useState(true);
  const [boardEntries, setBoardEntries] = useState<FriendsBoardEntry[]>([]);
  const [canView, setCanView] = useState(true);
  const [enablingEcho, setEnablingEcho] = useState(false);
  const [currentSeason, setCurrentSeason] = useState('2026-11');

  // Head-to-Head inspection modal
  const [h2hStats, setH2hStats] = useState<HeadToHeadStats | null>(null);
  const [loadingH2h, setLoadingH2h] = useState(false);

  const pagerRef = useRef<React.ElementRef<typeof ScrollView>>(null);

  const loadBoard = useCallback(async (tab: LeaderboardTabKey) => {
    setLoading(true);
    try {
      const now = new Date();
      const currentMonth = now.toISOString().slice(0, 7);
      const prevMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 7);
      const seasonToFetch = tab === 'previous' ? prevMonth : currentMonth;
      setCurrentSeason(seasonToFetch);

      const res = await fetchFriendsBoard(seasonToFetch);
      // Only lock the view if explicitly refused because share_echo is turned off by user
      if (res.reason === 'share_echo_disabled') {
        setCanView(false);
      } else {
        setCanView(true);
      }
      setBoardEntries(res.board);
    } catch {
      setBoardEntries([]);
      setCanView(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'current' || activeTab === 'previous') {
      void loadBoard(activeTab);
    }
  }, [activeTab, loadBoard]);

  const handleTabChange = (id: string) => {
    const tabKey = id as LeaderboardTabKey;
    setActiveTab(tabKey);
    const pageIndex = tabKey === 'current' ? 0 : tabKey === 'previous' ? 1 : 2;
    pagerRef.current?.scrollTo({ x: pageIndex * screenWidth, animated: true });
  };

  const handlePagerScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const pageIndex = Math.round(offsetX / screenWidth);
    const newTab: LeaderboardTabKey =
      pageIndex === 0 ? 'current' : pageIndex === 1 ? 'previous' : 'guide';
    if (newTab !== activeTab) {
      triggerHaptic('buttonTap');
      setActiveTab(newTab);
    }
  };

  const handleInspectFriend = async (friendId: string) => {
    triggerHaptic('buttonTap');
    setLoadingH2h(true);
    const stats = await fetchHeadToHead(friendId);
    setLoadingH2h(false);
    setH2hStats(stats);
  };

  const handleEnableShareEcho = async () => {
    triggerHaptic('buttonTap');
    setEnablingEcho(true);
    try {
      await updateFriendSettings({
        allowFriendRequests: true,
        showPresence: true,
        shareEcho: true,
      });
    } catch (e) {
      console.warn('Update friend settings error:', e);
    }
    // Optimistically unlock view and refresh
    setCanView(true);
    await loadBoard(activeTab);
    setEnablingEcho(false);
  };

  const getRankBadgeStyle = (rank: number) => {
    if (rank === 1) {
      return {
        bg: isDark ? 'rgba(255, 215, 0, 0.20)' : 'rgba(217, 119, 6, 0.16)',
        color: '#F59E0B',
      };
    }
    if (rank === 2) {
      return {
        bg: isDark ? 'rgba(203, 213, 225, 0.20)' : 'rgba(100, 116, 139, 0.16)',
        color: '#94A3B8',
      };
    }
    if (rank === 3) {
      return {
        bg: isDark ? 'rgba(249, 115, 22, 0.20)' : 'rgba(194, 65, 12, 0.16)',
        color: '#F97316',
      };
    }
    return {
      bg: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
      color: colors.textMuted,
    };
  };

  const renderBoardContent = () => {
    if (!canView) {
      return (
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
          <Ionicons name="lock-closed-outline" size={40} color={colors.warning} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Leaderboard Sharing Disabled
          </Text>
          <Text style={[styles.emptySub, { color: colors.textMuted }]}>
            To view the seasonal leaderboard, enable Echo score sharing with accepted friends.
            Coordinates and locations are never shared.
          </Text>
          <Button
            title={enablingEcho ? 'Enabling...' : 'Enable Season Echo'}
            variant="primary"
            size="md"
            loading={enablingEcho}
            disabled={enablingEcho}
            onPress={() => void handleEnableShareEcho()}
            style={{ marginTop: 14 }}
          />
        </Card>
      );
    }

    if (boardEntries.length === 0) {
      const msg = getBoardEmptyStateMessage(0);
      return (
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
          <Ionicons name="trophy-outline" size={44} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>{msg.title}</Text>
          <Text style={[styles.emptySub, { color: colors.textMuted }]}>{msg.subtitle}</Text>
          <Button
            title="Add an Operative"
            variant="primary"
            size="md"
            onPress={() => router.push('/friends' as any)}
            style={{ marginTop: 14 }}
          />
        </Card>
      );
    }

    return boardEntries.map((entry) => {
      const rankBadge = getRankBadgeStyle(entry.rank);
      return (
        <Pressable
          key={entry.userId}
          accessibilityRole="button"
          onPress={() => !entry.isSelf && void handleInspectFriend(entry.userId)}
        >
          <Card
            variant="default"
            style={[
              styles.entryCard,
              {
                backgroundColor: entry.isSelf
                  ? isDark
                    ? 'rgba(199, 243, 107, 0.08)'
                    : 'rgba(85, 122, 34, 0.06)'
                  : isDark
                  ? colors.surfaceElevated
                  : colors.surface,
                borderColor: entry.isSelf ? colors.primary : colors.border,
              },
            ]}
          >
            <View style={styles.entryRow}>
              {/* Rank Badge */}
              <View style={[styles.rankBadge, { backgroundColor: rankBadge.bg }]}>
                <Text style={[styles.rankBadgeText, { color: rankBadge.color }]}>
                  #{entry.rank}
                </Text>
              </View>

              {/* Operative Info */}
              <View style={styles.entryMeta}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text
                    style={[
                      styles.entryName,
                      { color: entry.isSelf ? colors.primary : colors.text },
                    ]}
                  >
                    {entry.displayName}
                  </Text>
                  {entry.isSelf && (
                    <View
                      style={[
                        styles.youTag,
                        {
                          backgroundColor: isDark
                            ? 'rgba(199, 243, 107, 0.18)'
                            : 'rgba(85, 122, 34, 0.14)',
                        },
                      ]}
                    >
                      <Text style={[styles.youTagText, { color: colors.primary }]}>YOU</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.entrySub, { color: colors.textMuted }]}>
                  {entry.handle ? `@${entry.handle}` : 'Operative'} • Tier: {entry.tier}
                </Text>
              </View>

              {/* Season Echo Score */}
              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={[
                    styles.echoScore,
                    { color: entry.isSelf ? colors.primary : colors.text },
                  ]}
                >
                  {entry.seasonEcho}
                </Text>
                <Text style={[styles.ratesText, { color: colors.textMuted }]}>
                  G: {entry.avgGhost}% • C: {entry.avgCash}%
                </Text>
              </View>
            </View>
          </Card>
        </Pressable>
      );
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Sticky Header Area */}
      <View
        style={[
          styles.headerArea,
          {
            paddingTop: Math.max(insets.top, 16) + 4,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.backRow}
        >
          <Ionicons name="arrow-back" size={20} color={colors.primary} />
          <Text variant="label" style={{ color: colors.primary, marginLeft: spacing.xs }}>
            BACK
          </Text>
        </Pressable>

        <Text variant="display" style={{ color: colors.text, marginTop: spacing.xs, marginBottom: spacing.sm }}>
          LEADERBOARD
        </Text>

        {/* 3-Tab Segment Bar with Animated Slider */}
        <SegmentBar
          items={[
            { id: 'current', label: 'THIS SEASON' },
            { id: 'previous', label: 'PREVIOUS' },
            { id: 'guide', label: 'ECHO GUIDE' },
          ]}
          activeId={activeTab}
          onChange={handleTabChange}
          style={{ marginBottom: 4 }}
        />
      </View>

      {/* Full-Screen Horizontal Swipeable Pager */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handlePagerScrollEnd}
        style={styles.pager}
      >
        {/* ============================================================== */}
        {/* TAB 1: CURRENT SEASON STANDINGS */}
        {/* ============================================================== */}
        <View style={{ width: screenWidth }}>
          <ScrollView
            contentContainerStyle={[
              styles.tabContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 80 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {loading && activeTab === 'current' ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              renderBoardContent()
            )}
          </ScrollView>
        </View>

        {/* ============================================================== */}
        {/* TAB 2: PREVIOUS SEASON ARCHIVE */}
        {/* ============================================================== */}
        <View style={{ width: screenWidth }}>
          <ScrollView
            contentContainerStyle={[
              styles.tabContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 80 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {loading && activeTab === 'previous' ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              renderBoardContent()
            )}
          </ScrollView>
        </View>

        {/* ============================================================== */}
        {/* TAB 3: ECHO SCORING GUIDE */}
        {/* ============================================================== */}
        <View style={{ width: screenWidth }}>
          <ScrollView
            contentContainerStyle={[
              styles.tabContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 80 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {HOW_ECHO_WORKS_EXPLAINER.sections.map((sec, idx) => (
              <Card
                key={idx}
                variant="default"
                style={[
                  styles.guideCard,
                  {
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.guideTitle, { color: colors.text }]}>{sec.title}</Text>
                <Text style={[styles.guideBody, { color: colors.textMuted }]}>{sec.body}</Text>
              </Card>
            ))}

            <Text style={[styles.sectionHeading, { color: colors.textMuted, marginTop: 16 }]}>
              CALIBRATED WORKED EXAMPLES
            </Text>

            {HOW_ECHO_WORKS_EXPLAINER.workedExamples.map((ex, idx) => (
              <Card
                key={idx}
                variant="default"
                style={[
                  styles.exampleCard,
                  {
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.exampleHeader, { color: colors.primary }]}>
                  {ex.agent} → {ex.result}
                </Text>
                <Text style={[styles.exampleContext, { color: colors.text }]}>{ex.context}</Text>
                <Text style={[styles.exampleFormula, { color: colors.textMuted }]}>
                  Formula: {ex.formula}
                </Text>
              </Card>
            ))}
          </ScrollView>
        </View>
      </ScrollView>

      {/* Head-to-Head Tactical Modal */}
      {h2hStats && (
        <Modal
          visible={Boolean(h2hStats)}
          animationType="slide"
          transparent
          onRequestClose={() => setH2hStats(null)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.modalContent,
                {
                  backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>
                    HEAD-TO-HEAD INTEL
                  </Text>
                  <Text style={[styles.modalSub, { color: colors.textMuted }]}>
                    vs {h2hStats.friendName || 'Operative'}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setH2hStats(null)}
                  style={styles.closeBtn}
                >
                  <Ionicons name="close" size={20} color={colors.text} />
                </Pressable>
              </View>

              {!h2hStats.available ? (
                <Text style={[styles.emptySub, { color: colors.textMuted, marginVertical: 20 }]}>
                  {h2hStats.reason || 'No matches played against each other yet.'}
                </Text>
              ) : (
                <View style={{ marginTop: 14 }}>
                  <View style={styles.statGrid}>
                    <View style={styles.statBox}>
                      <Text style={[styles.statValue, { color: colors.primary }]}>
                        {h2hStats.myWins}
                      </Text>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>Your Wins</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={[styles.statValue, { color: colors.text }]}>
                        {h2hStats.oppositeRounds}
                      </Text>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                        Rounds Together
                      </Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={[styles.statValue, { color: colors.danger }]}>
                        {h2hStats.friendWins}
                      </Text>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                        Their Wins
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.h2hRow, { marginTop: 14, borderColor: colors.border }]}>
                    <Text style={[styles.h2hLabel, { color: colors.text }]}>
                      Times You Ghosted Them
                    </Text>
                    <Text style={[styles.h2hVal, { color: colors.success }]}>
                      {h2hStats.timesGhostedThem}
                    </Text>
                  </View>

                  <View style={[styles.h2hRow, { borderColor: colors.border }]}>
                    <Text style={[styles.h2hLabel, { color: colors.text }]}>
                      Times They Tagged You
                    </Text>
                    <Text style={[styles.h2hVal, { color: colors.warning }]}>
                      {h2hStats.timesTheyCashedMe}
                    </Text>
                  </View>
                </View>
              )}

              <Button
                title="Dismiss"
                variant="secondary"
                size="md"
                onPress={() => setH2hStats(null)}
                style={{ marginTop: 18 }}
              />
            </View>
          </View>
        </Modal>
      )}

      {loadingH2h && (
        <View style={styles.loadingH2hOverlay}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerArea: {
    paddingBottom: 8,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  pager: {
    flex: 1,
  },
  tabContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  centerContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rankBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeText: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    fontWeight: '900',
  },
  entryMeta: {
    flex: 1,
    marginLeft: 12,
  },
  entryName: {
    fontFamily: 'Archivo-Bold',
    fontSize: 15,
    fontWeight: '800',
  },
  youTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
  },
  youTagText: {
    fontFamily: 'Archivo-Black',
    fontSize: 9,
    fontWeight: '900',
  },
  entrySub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    marginTop: 1,
  },
  echoScore: {
    fontFamily: 'Archivo-Black',
    fontSize: 20,
    fontWeight: '900',
  },
  ratesText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 10,
    marginTop: 1,
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
  },
  emptyTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 12,
    textAlign: 'center',
    alignSelf: 'center',
    width: '100%',
  },
  emptySub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  guideCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  guideTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  guideBody: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  sectionHeading: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  exampleCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  exampleHeader: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    fontWeight: '800',
  },
  exampleContext: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    marginTop: 2,
  },
  exampleFormula: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 34,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 18,
    fontWeight: '900',
  },
  modalSub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statBox: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  statValue: {
    fontFamily: 'Archivo-Black',
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    marginTop: 2,
  },
  h2hRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  h2hLabel: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 13,
  },
  h2hVal: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '800',
  },
  loadingH2hOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { useUserStore } from '../src/stores/userStore';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';
import { Button } from '../src/ui/Button';
import { SegmentBar } from '../src/ui/SegmentBar';
import { triggerHaptic } from '../src/motion/haptics';
import { TacticalPullRefreshScrollView } from '../src/components/TacticalPullRefresh';
import {
  FriendProfile,
  FriendRequest,
  FriendSettings,
  SearchedOperative,
  formatFriendInviteUrl,
  formatFriendDeepLink,
  formatFriendWebInviteUrl,
} from '../src/lib/friendsCore';
import {
  listFriends,
  listFriendRequests,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  updateFriendSettings,
  fetchFriendSettings,
  searchOperatives,
} from '../src/lib/friends';
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
import { listMyBlocks, unblockUser } from '../src/lib/moderation';
import { BlockItem } from '../src/lib/moderationCore';

type FriendsTabKey = 'standings' | 'friends' | 'requests' | 'add' | 'privacy';

export default function FriendsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ add?: string; tab?: string }>();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { colors, spacing, radii, isDark } = useTheme();
  const userProfile = useUserStore((s) => s.profile);

  const [activeTab, setActiveTab] = useState<FriendsTabKey>('standings');
  const [loading, setLoading] = useState(true);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [blocks, setBlocks] = useState<BlockItem[]>([]);

  // Standings / Leaderboard state
  const [boardEntries, setBoardEntries] = useState<FriendsBoardEntry[]>([]);
  const [canViewBoard, setCanViewBoard] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState<'current' | 'previous'>('current');
  const [enablingEcho, setEnablingEcho] = useState(false);
  const [h2hStats, setH2hStats] = useState<HeadToHeadStats | null>(null);
  const [loadingH2h, setLoadingH2h] = useState(false);
  const [explainerVisible, setExplainerVisible] = useState(false);

  // Filter in Tab 2 (Friends)
  const [friendSearchQuery, setFriendSearchQuery] = useState('');

  // Add friend state
  const [targetHandle, setTargetHandle] = useState('');
  const [sendingRequest, setSendingRequest] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusType, setStatusType] = useState<'success' | 'error' | ''>('');

  // Live search state
  const [searchResults, setSearchResults] = useState<SearchedOperative[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Privacy settings state
  const [settings, setSettings] = useState<FriendSettings>({
    allowFriendRequests: true,
    showPresence: false,
    shareEcho: true,
  });

  const loadBoard = useCallback(async (seasonType: 'current' | 'previous') => {
    try {
      const now = new Date();
      const currentMonth = now.toISOString().slice(0, 7);
      const prevMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 7);
      const targetSeason = seasonType === 'previous' ? prevMonth : currentMonth;

      const res = await fetchFriendsBoard(targetSeason);
      if (res.reason === 'share_echo_disabled') {
        setCanViewBoard(false);
      } else {
        setCanViewBoard(true);
      }
      setBoardEntries(res.board);
    } catch {
      setBoardEntries([]);
      setCanViewBoard(true);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [friendsList, reqs, blockList, currentSettings] = await Promise.all([
        listFriends(),
        listFriendRequests(),
        listMyBlocks(),
        fetchFriendSettings(),
      ]);
      setFriends(friendsList);
      setIncomingRequests(reqs.incoming);
      setOutgoingRequests(reqs.outgoing);
      setBlocks(blockList);
      setSettings(currentSettings);
      await loadBoard(selectedSeason);
    } catch {
      // offline fallback
    } finally {
      setLoading(false);
    }
  }, [loadBoard, selectedSeason]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const pagerRef = useRef<React.ElementRef<typeof ScrollView>>(null);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Handle deep link / navigation parameter (e.g. ghost-run://friends?add=AlphaOP or ?tab=standings)
  useEffect(() => {
    if (params.add) {
      const decoded = decodeURIComponent(params.add).trim();
      if (decoded) {
        setTargetHandle(decoded);
        setActiveTab('add');
        setTimeout(() => {
          pagerRef.current?.scrollTo({ x: 3 * screenWidth, animated: true });
        }, 100);
      }
    } else if (params.tab && ['standings', 'friends', 'requests', 'add', 'privacy'].includes(params.tab)) {
      handleTabChange(params.tab as FriendsTabKey);
    }
  }, [params.add, params.tab, screenWidth]);

  const handleSeasonChange = (season: 'current' | 'previous') => {
    triggerHaptic('buttonTap');
    setSelectedSeason(season);
    void loadBoard(season);
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
        allowFriendRequests: settings.allowFriendRequests,
        showPresence: settings.showPresence,
        shareEcho: true,
      });
      setSettings((s) => ({ ...s, shareEcho: true }));
      setCanViewBoard(true);
      await loadBoard(selectedSeason);
    } catch (e) {
      console.warn('Update friend settings error:', e);
    } finally {
      setEnablingEcho(false);
    }
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

  // Live debounced search for operatives in registry
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const trimmed = targetHandle.trim().replace(/^@/, '');
    if (trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchOperatives(trimmed);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [targetHandle]);

  const handleTabChange = (id: string) => {
    const tabKey = id as FriendsTabKey;
    setActiveTab(tabKey);
    setStatusMessage('');
    const pageIndex =
      tabKey === 'standings'
        ? 0
        : tabKey === 'friends'
        ? 1
        : tabKey === 'requests'
        ? 2
        : tabKey === 'add'
        ? 3
        : 4;
    pagerRef.current?.scrollTo({ x: pageIndex * screenWidth, animated: true });
  };

  const handlePagerScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const pageIndex = Math.round(offsetX / screenWidth);
    const newTab: FriendsTabKey =
      pageIndex === 0
        ? 'standings'
        : pageIndex === 1
        ? 'friends'
        : pageIndex === 2
        ? 'requests'
        : pageIndex === 3
        ? 'add'
        : 'privacy';
    if (newTab !== activeTab) {
      triggerHaptic('buttonTap');
      setActiveTab(newTab);
      setStatusMessage('');
    }
  };

  const handleSendRequestTo = async (handleOrName: string) => {
    const clean = handleOrName.trim().replace(/^@/, '');
    if (!clean) return;

    setSendingRequest(true);
    setStatusMessage('');
    triggerHaptic('buttonTap');

    const res = await sendFriendRequest(clean);
    setSendingRequest(false);

    if (res.success) {
      triggerHaptic('tagConfirmed');
      setStatusType('success');
      setStatusMessage(
        res.status === 'already_friends'
          ? `You and ${clean} are already connected!`
          : res.status === 'accepted'
          ? `Friend request accepted! You and ${clean} are now connected.`
          : `Tactical friend request dispatched to ${clean}.`
      );
      void loadData();
      // Re-query search to update status badge
      void searchOperatives(clean).then(setSearchResults);
    } else {
      triggerHaptic('error');
      setStatusType('error');
      setStatusMessage(res.error || res.reason || 'Could not send request.');
    }
  };

  const handleSendRequest = () => handleSendRequestTo(targetHandle);

  const handleRespond = async (requesterId: string | undefined, action: 'accept' | 'decline') => {
    if (!requesterId) return;
    triggerHaptic('buttonTap');
    const res = await respondFriendRequest(requesterId, action);
    if (res.success) {
      triggerHaptic(action === 'accept' ? 'tagConfirmed' : 'error');
      void loadData();
      const currentQuery = targetHandle.trim().replace(/^@/, '');
      if (currentQuery.length >= 2) {
        void searchOperatives(currentQuery).then(setSearchResults);
      }
    } else {
      Alert.alert('Error', res.error || 'Failed to update request');
    }
  };

  const handleRemoveFriend = (friendId: string, name: string) => {
    triggerHaptic('buttonTap');
    Alert.alert(
      'Remove Operative',
      `Disconnect @${name} from your operative network?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const ok = await removeFriend(friendId);
            if (ok) {
              triggerHaptic('tagConfirmed');
              void loadData();
            } else {
              Alert.alert('Error', 'Failed to disconnect friend');
            }
          },
        },
      ]
    );
  };

  const handleShareInvite = async () => {
    triggerHaptic('buttonTap');
    try {
      const tag = userProfile?.handle
        ? `@${userProfile.handle}`
        : userProfile?.display_name
        ? `@${userProfile.display_name}`
        : 'Operative';
      const myIdentifier = userProfile?.handle || userProfile?.display_name || 'Operative';
      const webInviteUrl = formatFriendWebInviteUrl(myIdentifier);

      await Share.share({
        title: 'Join my GhostRun Network',
        message: `Deploy with me on GhostRun! Connect to my operative network (${tag}):\n${webInviteUrl}`,
        url: webInviteUrl,
      });
    } catch {
      // share dismissed
    }
  };

  const handleToggleSetting = async (key: keyof FriendSettings, val: boolean) => {
    triggerHaptic('buttonTap');
    const updated = { ...settings, [key]: val };
    setSettings(updated);
    await updateFriendSettings(updated);
  };

  const handleUnblock = async (blockedId: string, name: string) => {
    triggerHaptic('buttonTap');
    const ok = await unblockUser(blockedId);
    if (ok) {
      triggerHaptic('tagConfirmed');
      void loadData();
    } else {
      Alert.alert('Error', `Failed to unblock ${name}`);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
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
          FRIENDS
        </Text>

        {/* 5-Tab Segment Bar with Animated Slider */}
        <SegmentBar
          items={[
            { id: 'standings', label: 'STANDINGS' },
            { id: 'friends', label: 'FRIENDS', badge: friends.length > 0 ? friends.length : undefined },
            {
              id: 'requests',
              label: 'REQUESTS',
              badge: incomingRequests.length > 0 ? incomingRequests.length : undefined,
            },
            { id: 'add', label: 'ADD' },
            { id: 'privacy', label: 'PRIVACY' },
          ]}
          activeId={activeTab}
          onChange={handleTabChange}
          style={{ marginBottom: 4 }}
        />
      </View>

      {/* Loading Overlay */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        /* Full-Screen Horizontal Swipeable Pager */
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handlePagerScrollEnd}
          style={styles.pager}
        >
          {/* ============================================================== */}
          {/* TAB 0: STANDINGS / ECHO LEADERBOARD */}
          {/* ============================================================== */}
          <View style={{ width: screenWidth }}>
            <TacticalPullRefreshScrollView
              refreshing={refreshing}
              onRefresh={handleRefresh}
              contentContainerStyle={[
                styles.tabContent,
                { paddingBottom: Math.max(insets.bottom, 16) + 80 },
              ]}
              showsVerticalScrollIndicator={false}
            >
              {/* Standings Sub-Header: Season toggle & Echo Guide */}
              <View style={styles.standingsHeaderRow}>
                <View
                  style={[
                    styles.seasonToggleContainer,
                    {
                      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => handleSeasonChange('current')}
                    style={[
                      styles.seasonBtn,
                      selectedSeason === 'current' && [
                        styles.seasonBtnActive,
                        { backgroundColor: colors.primary },
                      ],
                    ]}
                  >
                    <Text
                      style={[
                        styles.seasonBtnText,
                        {
                          color: selectedSeason === 'current' ? '#000000' : colors.textMuted,
                        },
                      ]}
                    >
                      CURRENT
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => handleSeasonChange('previous')}
                    style={[
                      styles.seasonBtn,
                      selectedSeason === 'previous' && [
                        styles.seasonBtnActive,
                        { backgroundColor: colors.primary },
                      ],
                    ]}
                  >
                    <Text
                      style={[
                        styles.seasonBtnText,
                        {
                          color: selectedSeason === 'previous' ? '#000000' : colors.textMuted,
                        },
                      ]}
                    >
                      PREVIOUS
                    </Text>
                  </Pressable>
                </View>

                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    triggerHaptic('buttonTap');
                    setExplainerVisible(true);
                  }}
                  style={[
                    styles.explainerBtn,
                    {
                      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
                  <Text style={[styles.explainerBtnText, { color: colors.primary }]}>ECHO GUIDE</Text>
                </Pressable>
              </View>

              {/* Share Echo Disabled Card */}
              {!canViewBoard ? (
                <Card
                  variant="default"
                  style={[
                    styles.formCard,
                    {
                      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                      borderColor: colors.border,
                      marginTop: 8,
                    },
                  ]}
                >
                  <View style={styles.cardHeaderRow}>
                    <Ionicons name="eye-off-outline" size={22} color={colors.accent || colors.primary} />
                    <Text style={[styles.cardHeaderTitle, { color: colors.text }]}>
                      ECHO SHARING DISABLED
                    </Text>
                  </View>
                  <Text style={[styles.cardHeaderSub, { color: colors.textMuted }]}>
                    To access the Friends Standings and compare tactical metrics with allies, enable "Share Season Echo" in your privacy settings.
                  </Text>
                  <Button
                    title={enablingEcho ? 'Enabling…' : 'Enable Season Echo'}
                    variant="primary"
                    size="md"
                    disabled={enablingEcho}
                    onPress={() => void handleEnableShareEcho()}
                    style={{ marginTop: 10 }}
                  />
                </Card>
              ) : boardEntries.length === 0 ? (
                (() => {
                  const emptyInfo = getBoardEmptyStateMessage(friends.length);
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
                      <Ionicons name="trophy-outline" size={48} color={colors.textMuted} />
                      <Text style={[styles.emptyTitle, { color: colors.text }]}>
                        {emptyInfo.title.toUpperCase()}
                      </Text>
                      <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                        {emptyInfo.subtitle}
                      </Text>
                      {friends.length === 0 && (
                        <Button
                          title="Add Operatives"
                          variant="primary"
                          size="sm"
                          onPress={() => handleTabChange('add')}
                          style={{ marginTop: 16 }}
                        />
                      )}
                    </Card>
                  );
                })()
              ) : (
                boardEntries.map((entry) => {
                  const badgeStyle = getRankBadgeStyle(entry.rank);
                  const isCurrentUser = userProfile?.id === entry.userId || entry.isSelf;
                  return (
                    <Pressable
                      key={entry.userId}
                      accessibilityRole="button"
                      onPress={() => {
                        if (!isCurrentUser) {
                          void handleInspectFriend(entry.userId);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.entryCard,
                        {
                          backgroundColor: isCurrentUser
                            ? isDark
                              ? 'rgba(199, 243, 107, 0.08)'
                              : 'rgba(85, 122, 34, 0.08)'
                            : isDark
                            ? colors.surfaceElevated
                            : colors.surface,
                          borderColor: isCurrentUser ? colors.primary : colors.border,
                        },
                        !isCurrentUser && pressed && { opacity: 0.85 },
                      ]}
                    >
                      <View style={styles.entryRow}>
                        {/* Rank Badge */}
                        <View style={[styles.rankBadge, { backgroundColor: badgeStyle.bg }]}>
                          <Text style={[styles.rankBadgeText, { color: badgeStyle.color }]}>
                            #{entry.rank}
                          </Text>
                        </View>

                        {/* Name and Tag */}
                        <View style={styles.entryMeta}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.entryName,
                                { color: isCurrentUser ? colors.primary : colors.text },
                              ]}
                            >
                              {entry.displayName}
                            </Text>
                            {isCurrentUser && (
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
                          <Text style={[styles.entrySub, { color: colors.textMuted }]}>
                            Tier {entry.tier} • {entry.roundsCounted} matches
                          </Text>
                        </View>

                        {/* Echo Score & Rate */}
                        <View style={{ alignItems: 'flex-end', marginRight: isCurrentUser ? 0 : 8 }}>
                          <Text style={[styles.echoScore, { color: colors.accent || colors.primary }]}>
                            {entry.seasonEcho} <Text style={{ fontSize: 11, fontWeight: '700' }}>PTS</Text>
                          </Text>
                          <Text style={[styles.ratesText, { color: colors.textMuted }]}>
                            {Math.round(entry.avgGhost)}% Ghost • {Math.round(entry.avgCash)}% Cash
                          </Text>
                        </View>

                        {/* Chevron for inspecting friend (head-to-head) */}
                        {!isCurrentUser && (
                          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                        )}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </TacticalPullRefreshScrollView>
          </View>

          {/* ============================================================== */}
          {/* TAB 1: OPERATIVES LIST */}
          {/* ============================================================== */}
          <View style={{ width: screenWidth }}>
            <TacticalPullRefreshScrollView
              refreshing={refreshing}
              onRefresh={handleRefresh}
              contentContainerStyle={[
                styles.tabContent,
                { paddingBottom: Math.max(insets.bottom, 16) + 80 },
              ]}
              showsVerticalScrollIndicator={false}
            >
              {/* Share Invite Link Banner */}
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleShareInvite()}
                style={({ pressed }) => [
                  styles.inviteBanner,
                  {
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                  pressed && { opacity: 0.85, transform: [{ scale: 0.985 }] },
                ]}
              >
                <View
                  style={[
                    styles.inviteBannerIcon,
                    {
                      backgroundColor: isDark
                        ? 'rgba(199, 243, 107, 0.12)'
                        : 'rgba(85, 122, 34, 0.10)',
                    },
                  ]}
                >
                  <Ionicons name="share-social-outline" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inviteBannerTitle, { color: colors.text }]}>
                    Share Tactical Invite Link
                  </Text>
                  <Text style={[styles.inviteBannerSub, { color: colors.textMuted }]}>
                    Invite allies via WhatsApp, Discord, or tactical link
                  </Text>
                </View>
                <Ionicons name="arrow-forward" size={16} color={colors.primary} />
              </Pressable>

              {/* Filter Bar when friends exist */}
              {friends.length > 0 && (
                <View
                  style={[
                    styles.filterBox,
                    {
                      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons name="search-outline" size={16} color={colors.textMuted} />
                  <TextInput
                    value={friendSearchQuery}
                    onChangeText={setFriendSearchQuery}
                    placeholder="Filter connected operatives..."
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.filterInput, { color: colors.text }]}
                  />
                  {friendSearchQuery.length > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear filter"
                      onPress={() => setFriendSearchQuery('')}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </Pressable>
                  )}
                </View>
              )}

              {friends.length === 0 ? (
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
                  <Ionicons name="people-outline" size={44} color={colors.textMuted} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>
                    No Operatives Connected
                  </Text>
                  <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                    Add operatives by codename or share your invite link to form a persistent network.
                  </Text>
                  <Button
                    title="Add an Operative"
                    variant="primary"
                    size="md"
                    onPress={() => handleTabChange('add')}
                    style={{ marginTop: 14 }}
                  />
                </Card>
              ) : friends.filter((f) => {
                  if (!friendSearchQuery.trim()) return true;
                  const q = friendSearchQuery.toLowerCase().trim();
                  return (
                    f.displayName.toLowerCase().includes(q) ||
                    (f.handle && f.handle.toLowerCase().includes(q))
                  );
                }).length === 0 ? (
                <Card
                  variant="default"
                  style={[
                    styles.emptySubCard,
                    {
                      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                      borderColor: colors.border,
                      marginTop: 8,
                    },
                  ]}
                >
                  <Text style={[styles.emptySubText, { color: colors.textMuted }]}>
                    No connected operatives match "{friendSearchQuery}".
                  </Text>
                </Card>
              ) : (
                friends
                  .filter((f) => {
                    if (!friendSearchQuery.trim()) return true;
                    const q = friendSearchQuery.toLowerCase().trim();
                    return (
                      f.displayName.toLowerCase().includes(q) ||
                      (f.handle && f.handle.toLowerCase().includes(q))
                    );
                  })
                  .map((f) => {
                  const initial = (f.displayName || '?')[0].toUpperCase();
                  return (
                    <Card
                      key={f.userId}
                      variant="default"
                      style={[
                        styles.friendCard,
                        {
                          backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.friendRow}>
                        {/* Avatar */}
                        <View
                          style={[
                            styles.avatarCircle,
                            { backgroundColor: f.color || colors.primary },
                          ]}
                        >
                          <Text style={styles.avatarInitial}>{initial}</Text>
                        </View>

                        {/* Operative Info */}
                        <View style={styles.friendMeta}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={[styles.friendName, { color: colors.text }]}>
                              {f.displayName}
                            </Text>
                            {f.showPresence && (
                              <View
                                style={[
                                  styles.liveBadge,
                                  {
                                    backgroundColor: isDark
                                      ? 'rgba(74, 222, 128, 0.15)'
                                      : 'rgba(22, 101, 52, 0.12)',
                                  },
                                ]}
                              >
                                <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
                                <Text style={[styles.liveText, { color: colors.success }]}>
                                  LIVE
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={[styles.friendHandle, { color: colors.textMuted }]}>
                            {f.handle ? `@${f.handle}` : 'Active Operative'}
                          </Text>
                        </View>

                        {/* Remove Action */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${f.displayName}`}
                          onPress={() => handleRemoveFriend(f.userId, f.displayName)}
                          style={[styles.removeBtn, { borderColor: colors.border }]}
                        >
                          <Ionicons name="person-remove-outline" size={16} color={colors.danger} />
                        </Pressable>
                      </View>
                    </Card>
                  );
                })
              )}
            </TacticalPullRefreshScrollView>
          </View>

          {/* ============================================================== */}
          {/* TAB 2: REQUESTS */}
          {/* ============================================================== */}
          <View style={{ width: screenWidth }}>
            <ScrollView
              contentContainerStyle={[
                styles.tabContent,
                { paddingBottom: Math.max(insets.bottom, 16) + 80 },
              ]}
              showsVerticalScrollIndicator={false}
            >
              {/* Incoming Requests */}
              <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                INCOMING REQUESTS ({incomingRequests.length})
              </Text>

              {incomingRequests.length === 0 ? (
                <Card
                  variant="default"
                  style={[
                    styles.emptySubCard,
                    {
                      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.emptySubText, { color: colors.textMuted }]}>
                    No incoming requests right now.
                  </Text>
                </Card>
              ) : (
                incomingRequests.map((req) => (
                  <Card
                    key={req.requesterId}
                    variant="default"
                    style={[
                      styles.friendCard,
                      {
                        backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.friendRow}>
                      <View
                        style={[
                          styles.avatarCircle,
                          { backgroundColor: req.color || colors.primary },
                        ]}
                      >
                        <Text style={styles.avatarInitial}>
                          {(req.displayName || '?')[0].toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.friendMeta}>
                        <Text style={[styles.friendName, { color: colors.text }]}>
                          {req.displayName}
                        </Text>
                        <Text style={[styles.friendHandle, { color: colors.textMuted }]}>
                          {req.handle ? `@${req.handle}` : 'Tactical Operative'}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Button
                          title="Decline"
                          variant="secondary"
                          size="sm"
                          onPress={() => void handleRespond(req.requesterId, 'decline')}
                        />
                        <Button
                          title="Accept"
                          variant="primary"
                          size="sm"
                          onPress={() => void handleRespond(req.requesterId, 'accept')}
                        />
                      </View>
                    </View>
                  </Card>
                ))
              )}

              {/* Outgoing Pending Requests */}
              <Text style={[styles.sectionTitle, { color: colors.textMuted, marginTop: 24 }]}>
                OUTGOING PENDING ({outgoingRequests.length})
              </Text>

              {outgoingRequests.length === 0 ? (
                <Card
                  variant="default"
                  style={[
                    styles.emptySubCard,
                    {
                      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.emptySubText, { color: colors.textMuted }]}>
                    No pending invitations dispatched.
                  </Text>
                </Card>
              ) : (
                outgoingRequests.map((out) => (
                  <Card
                    key={out.targetId}
                    variant="default"
                    style={[
                      styles.friendCard,
                      {
                        backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.friendRow}>
                      <View
                        style={[
                          styles.avatarCircle,
                          { backgroundColor: out.color || colors.primary },
                        ]}
                      >
                        <Text style={styles.avatarInitial}>
                          {(out.displayName || '?')[0].toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.friendMeta}>
                        <Text style={[styles.friendName, { color: colors.text }]}>
                          {out.displayName}
                        </Text>
                        <Text style={[styles.friendHandle, { color: colors.textMuted }]}>
                          {out.handle ? `@${out.handle}` : 'Pending Confirmation'}
                        </Text>
                      </View>
                      <Button
                        title="Cancel"
                        variant="secondary"
                        size="sm"
                        onPress={() => void handleRespond(out.targetId, 'decline')}
                      />
                    </View>
                  </Card>
                ))
              )}
            </ScrollView>
          </View>

          {/* ============================================================== */}
          {/* TAB 3: ADD OPERATIVE */}
          {/* ============================================================== */}
          <View style={{ width: screenWidth }}>
            <ScrollView
              contentContainerStyle={[
                styles.tabContent,
                { paddingBottom: Math.max(insets.bottom, 16) + 80 },
              ]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Card
                variant="default"
                style={[
                  styles.formCard,
                  {
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.cardHeaderRow}>
                  <Ionicons name="person-add-outline" size={20} color={colors.primary} />
                  <Text style={[styles.cardHeaderTitle, { color: colors.text }]}>
                    Find & Add Operative
                  </Text>
                </View>
                <Text style={[styles.cardHeaderSub, { color: colors.textMuted }]}>
                  Type a codename or @handle to search the operative network live.
                </Text>

                <View style={styles.inputRow}>
                  <TextInput
                    value={targetHandle}
                    onChangeText={setTargetHandle}
                    placeholder="e.g. AlphaOP or @AlphaOP"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    onSubmitEditing={() => void handleSendRequest()}
                    style={[
                      styles.textInput,
                      {
                        backgroundColor: isDark ? colors.surface : colors.surfaceElevated,
                        color: colors.text,
                        borderColor: colors.border,
                        flex: 1,
                        paddingRight: targetHandle ? 40 : 14,
                      },
                    ]}
                  />
                  {targetHandle.length > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear input"
                      onPress={() => {
                        setTargetHandle('');
                        setSearchResults([]);
                        setStatusMessage('');
                      }}
                      style={styles.inputClearBtn}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                    </Pressable>
                  )}
                </View>

                {isSearching && (
                  <View style={styles.searchingRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.searchingText, { color: colors.textMuted }]}>
                      Searching operative registry…
                    </Text>
                  </View>
                )}

                {/* Live Search Results */}
                {searchResults.length > 0 && (
                  <View style={{ marginTop: 14 }}>
                    <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                      MATCHING OPERATIVES ({searchResults.length})
                    </Text>
                    {searchResults.map((op) => {
                      const initial = (op.displayName || '?')[0].toUpperCase();
                      return (
                        <View
                          key={op.id}
                          style={[
                            styles.searchResultCard,
                            {
                              backgroundColor: isDark ? colors.surface : colors.surfaceElevated,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.avatarCircleSmall,
                              { backgroundColor: op.color || colors.primary },
                            ]}
                          >
                            <Text style={styles.avatarInitialSmall}>{initial}</Text>
                          </View>
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={[styles.friendName, { color: colors.text }]}>
                              {op.displayName}
                            </Text>
                            <Text style={[styles.friendHandle, { color: colors.textMuted }]}>
                              {op.handle ? `@${op.handle}` : `@${op.displayName}`}
                            </Text>
                          </View>
                          {op.relationship === 'friend' ? (
                            <View
                              style={[
                                styles.statusBadge,
                                {
                                  backgroundColor: isDark
                                    ? 'rgba(74, 222, 128, 0.15)'
                                    : 'rgba(22, 101, 52, 0.12)',
                                  borderColor: colors.success,
                                },
                              ]}
                            >
                              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                              <Text style={[styles.statusBadgeText, { color: colors.success }]}>
                                Connected
                              </Text>
                            </View>
                          ) : op.relationship === 'pending_outgoing' ? (
                            <View
                              style={[
                                styles.statusBadge,
                                {
                                  backgroundColor: isDark
                                    ? 'rgba(234, 179, 8, 0.15)'
                                    : 'rgba(161, 98, 7, 0.12)',
                                  borderColor: '#EAB308',
                                },
                              ]}
                            >
                              <Ionicons name="time-outline" size={14} color="#EAB308" />
                              <Text style={[styles.statusBadgeText, { color: '#EAB308' }]}>
                                Sent
                              </Text>
                            </View>
                          ) : op.relationship === 'pending_incoming' ? (
                            <Button
                              title="Accept"
                              variant="primary"
                              size="sm"
                              onPress={() => void handleRespond(op.id, 'accept')}
                            />
                          ) : (
                            <Button
                              title="Add"
                              variant="primary"
                              size="sm"
                              disabled={sendingRequest}
                              onPress={() => void handleSendRequestTo(op.handle || op.displayName)}
                            />
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                {!isSearching && targetHandle.trim().length >= 2 && searchResults.length === 0 && (
                  <View style={[styles.searchEmptyNote, { borderColor: colors.border }]}>
                    <Text style={[styles.searchEmptyNoteText, { color: colors.textMuted }]}>
                      No registered operative matches "{targetHandle.trim()}". You can still dispatch an invitation below.
                    </Text>
                  </View>
                )}

                {statusMessage !== '' && (
                  <View
                    style={[
                      styles.statusBox,
                      {
                        backgroundColor:
                          statusType === 'success'
                            ? isDark
                              ? 'rgba(74, 222, 128, 0.15)'
                              : 'rgba(22, 101, 52, 0.12)'
                            : isDark
                            ? 'rgba(248, 113, 113, 0.15)'
                            : 'rgba(153, 27, 27, 0.12)',
                        borderColor:
                          statusType === 'success' ? colors.success : colors.danger,
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        statusType === 'success'
                          ? 'checkmark-circle-outline'
                          : 'alert-circle-outline'
                      }
                      size={18}
                      color={statusType === 'success' ? colors.success : colors.danger}
                    />
                    <Text
                      style={[
                        styles.statusBoxText,
                        {
                          color:
                            statusType === 'success' ? colors.success : colors.danger,
                        },
                      ]}
                    >
                      {statusMessage}
                    </Text>
                  </View>
                )}

                <Button
                  title={sendingRequest ? 'Dispatching…' : 'Send Friend Request'}
                  variant="primary"
                  size="md"
                  disabled={sendingRequest || !targetHandle.trim()}
                  onPress={() => void handleSendRequest()}
                  style={{ marginTop: 14 }}
                />
              </Card>

              {/* Share Invite Section */}
              <Card
                variant="default"
                style={[
                  styles.formCard,
                  {
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                    marginTop: 16,
                  },
                ]}
              >
                <View style={styles.cardHeaderRow}>
                  <Ionicons name="link-outline" size={20} color={colors.accent || colors.primary} />
                  <Text style={[styles.cardHeaderTitle, { color: colors.text }]}>
                    Tactical Invite Link
                  </Text>
                </View>
                <Text style={[styles.cardHeaderSub, { color: colors.textMuted }]}>
                  Broadcast your personalized operative link to recruit allies and squadmates.
                </Text>

                <Button
                  title="Share Invite Link"
                  variant="secondary"
                  size="md"
                  onPress={() => void handleShareInvite()}
                  style={{ marginTop: 10 }}
                />
              </Card>
            </ScrollView>
          </View>

          {/* ============================================================== */}
          {/* TAB 4: PRIVACY & MODERATION */}
          {/* ============================================================== */}
          <View style={{ width: screenWidth }}>
            <ScrollView
              contentContainerStyle={[
                styles.tabContent,
                { paddingBottom: Math.max(insets.bottom, 16) + 80 },
              ]}
              showsVerticalScrollIndicator={false}
            >
              <Card
                variant="default"
                style={[
                  styles.formCard,
                  {
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.cardHeaderTitle, { color: colors.text }]}>
                  OPERATIVE VISIBILITY
                </Text>
                <Text style={[styles.cardHeaderSub, { color: colors.textMuted }]}>
                  Control how other operatives discover and interact with you.
                </Text>

                {/* Allow Friend Requests Toggle */}
                <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={[styles.toggleLabel, { color: colors.text }]}>
                      Allow Friend Requests
                    </Text>
                    <Text style={[styles.toggleSub, { color: colors.textMuted }]}>
                      Permit other players to send you tactical invitations.
                    </Text>
                  </View>
                  <Switch
                    value={settings.allowFriendRequests}
                    onValueChange={(val) => void handleToggleSetting('allowFriendRequests', val)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                  />
                </View>

                {/* Show Presence Toggle */}
                <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={[styles.toggleLabel, { color: colors.text }]}>
                      Share Lobby Presence
                    </Text>
                    <Text style={[styles.toggleSub, { color: colors.textMuted }]}>
                      Show friends when you are hosting an active match lobby.
                    </Text>
                  </View>
                  <Switch
                    value={settings.showPresence}
                    onValueChange={(val) => void handleToggleSetting('showPresence', val)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                  />
                </View>

                {/* Share Echo Toggle */}
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={[styles.toggleLabel, { color: colors.text }]}>
                      Share Season Echo
                    </Text>
                    <Text style={[styles.toggleSub, { color: colors.textMuted }]}>
                      Display your ranking and stats on the Friends Leaderboard.
                    </Text>
                  </View>
                  <Switch
                    value={settings.shareEcho}
                    onValueChange={(val) => void handleToggleSetting('shareEcho', val)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                  />
                </View>
              </Card>

              {/* Blocked Operatives */}
              <Text style={[styles.sectionTitle, { color: colors.textMuted, marginTop: 24 }]}>
                BLOCKED OPERATIVES ({blocks.length})
              </Text>

              {blocks.length === 0 ? (
                <Card
                  variant="default"
                  style={[
                    styles.emptySubCard,
                    {
                      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.emptySubText, { color: colors.textMuted }]}>
                    Your blocked operatives roster is empty.
                  </Text>
                </Card>
              ) : (
                blocks.map((b) => (
                  <Card
                    key={b.blockedUserId}
                    variant="default"
                    style={[
                      styles.friendCard,
                      {
                        backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.friendRow}>
                      <View style={styles.friendMeta}>
                        <Text style={[styles.friendName, { color: colors.text }]}>
                          {b.displayName}
                        </Text>
                        <Text style={[styles.friendHandle, { color: colors.textMuted }]}>
                          {b.handle ? `@${b.handle} • ` : ''}Blocked on {new Date(b.blockedAt).toLocaleDateString()}
                        </Text>
                      </View>
                      <Button
                        title="Unblock"
                        variant="secondary"
                        size="sm"
                        onPress={() => void handleUnblock(b.blockedUserId, b.displayName)}
                      />
                    </View>
                  </Card>
                ))
              )}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      {/* Head to Head Inspection Modal */}
      <Modal
        visible={!!h2hStats || loadingH2h}
        transparent
        animationType="fade"
        onRequestClose={() => setH2hStats(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setH2hStats(null)} />
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {loadingH2h ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text
                  style={{
                    color: colors.textMuted,
                    marginTop: 12,
                    fontFamily: 'SegoeUI-Regular',
                    fontSize: 13,
                  }}
                >
                  Retrieving tactical telemetry…
                </Text>
              </View>
            ) : h2hStats ? (
              <>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>
                      VS {(h2hStats.friendName || 'Operative').toUpperCase()}
                    </Text>
                    <Text style={[styles.modalSub, { color: colors.textMuted }]}>
                      Head-to-head match history across all tactical deployments
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    onPress={() => setH2hStats(null)}
                    style={styles.closeBtn}
                  >
                    <Ionicons name="close" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>

                {h2hStats.oppositeRounds === 0 ? (
                  <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                    <Ionicons name="time-outline" size={40} color={colors.textMuted} />
                    <Text
                      style={{
                        color: colors.textMuted,
                        marginTop: 10,
                        textAlign: 'center',
                        fontFamily: 'SegoeUI-Regular',
                        fontSize: 13,
                      }}
                    >
                      No head-to-head rounds recorded with {h2hStats.friendName || 'this operative'} yet. Deploy in the same match to generate telemetry!
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.statGrid}>
                      <View
                        style={[
                          styles.statBox,
                          {
                            backgroundColor: isDark
                              ? 'rgba(255,255,255,0.04)'
                              : 'rgba(0,0,0,0.03)',
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text style={[styles.statValue, { color: colors.primary }]}>
                          {h2hStats.myWins}
                        </Text>
                        <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                          YOUR WINS
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.statBox,
                          {
                            backgroundColor: isDark
                              ? 'rgba(255,255,255,0.04)'
                              : 'rgba(0,0,0,0.03)',
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text style={[styles.statValue, { color: colors.danger }]}>
                          {h2hStats.friendWins}
                        </Text>
                        <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                          THEIR WINS
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.h2hRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.h2hLabel, { color: colors.textMuted }]}>
                        Common Deployments
                      </Text>
                      <Text style={[styles.h2hVal, { color: colors.text }]}>
                        {h2hStats.oppositeRounds}
                      </Text>
                    </View>
                    <View style={[styles.h2hRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.h2hLabel, { color: colors.textMuted }]}>
                        Times You Ghosted Them
                      </Text>
                      <Text style={[styles.h2hVal, { color: colors.success }]}>
                        {h2hStats.timesGhostedThem}
                      </Text>
                    </View>
                    <View style={styles.h2hRow}>
                      <Text style={[styles.h2hLabel, { color: colors.textMuted }]}>
                        Times They Cashed You
                      </Text>
                      <Text style={[styles.h2hVal, { color: colors.danger }]}>
                        {h2hStats.timesTheyCashedMe}
                      </Text>
                    </View>
                  </>
                )}

                <Button
                  title="Close Telemetry"
                  variant="secondary"
                  size="md"
                  onPress={() => setH2hStats(null)}
                  style={{ marginTop: 18 }}
                />
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Echo Guide Modal */}
      <Modal
        visible={explainerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setExplainerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setExplainerVisible(false)} />
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
                maxHeight: '80%',
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {HOW_ECHO_WORKS_EXPLAINER.title.toUpperCase()}
                </Text>
                <Text style={[styles.modalSub, { color: colors.textMuted }]}>
                  {HOW_ECHO_WORKS_EXPLAINER.subtitle}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setExplainerVisible(false)}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ marginVertical: 8 }}>
              {HOW_ECHO_WORKS_EXPLAINER.sections.map((sec, idx) => (
                <View key={idx} style={{ marginBottom: 14 }}>
                  <Text style={[styles.explainerSecTitle, { color: colors.primary }]}>
                    {sec.title}
                  </Text>
                  <Text style={[styles.explainerSecBody, { color: colors.textMuted }]}>
                    {sec.body}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <Button
              title="Acknowledge Briefing"
              variant="primary"
              size="md"
              onPress={() => setExplainerVisible(false)}
              style={{ marginTop: 8 }}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
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
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pager: {
    flex: 1,
  },
  tabContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  inviteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    marginBottom: 16,
  },
  inviteBannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteBannerTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '800',
  },
  inviteBannerSub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    marginTop: 1,
  },
  friendCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: 'Archivo-Black',
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  friendMeta: {
    flex: 1,
    marginLeft: 12,
  },
  friendName: {
    fontFamily: 'Archivo-Bold',
    fontSize: 15,
    fontWeight: '800',
  },
  friendHandle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    marginTop: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  removeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  emptySubCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptySubText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    textAlign: 'center',
  },
  sectionTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  formCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  cardHeaderTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    fontWeight: '900',
  },
  cardHeaderSub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 14,
  },
  textInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontFamily: 'SegoeUI-Regular',
    fontSize: 15,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
  },
  statusBoxText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 12,
    flex: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  toggleLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '800',
  },
  toggleSub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    marginTop: 2,
  },
  filterBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  filterInput: {
    flex: 1,
    fontFamily: 'SegoeUI-Regular',
    fontSize: 14,
    paddingVertical: 0,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  inputClearBtn: {
    position: 'absolute',
    right: 12,
    padding: 4,
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  searchingText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
  },
  searchResultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  avatarCircleSmall: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitialSmall: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '800',
  },
  searchEmptyNote: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
    alignItems: 'center',
  },
  searchEmptyNoteText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    textAlign: 'center',
  },
  standingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  seasonToggleContainer: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    padding: 2,
  },
  seasonBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  seasonBtnActive: {},
  seasonBtnText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '800',
  },
  explainerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  explainerBtnText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rankBadgeText: {
    fontFamily: 'Archivo-Black',
    fontSize: 15,
    fontWeight: '900',
  },
  entryMeta: {
    flex: 1,
  },
  entryName: {
    fontFamily: 'Archivo-Bold',
    fontSize: 15,
    fontWeight: '800',
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
  entrySub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    marginTop: 2,
  },
  echoScore: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    fontWeight: '900',
  },
  ratesText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  modalSub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  closeBtn: {
    padding: 4,
  },
  statGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: 'Archivo-Black',
    fontSize: 26,
    fontWeight: '900',
  },
  statLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  h2hRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  h2hLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
  },
  h2hVal: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '800',
  },
  explainerSecTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  explainerSecBody: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    lineHeight: 18,
  },
});

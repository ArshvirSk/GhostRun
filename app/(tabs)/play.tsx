import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Image,
  Text,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme/ThemeProvider';
import { triggerHaptic } from '../../src/motion/haptics';
import { supabase } from '../../src/lib/supabase';
import { fetchActiveSeasonAndBanners, ActiveSeasonData } from '../../src/lib/seasons';
import { getFriendsHosting, listFriends, listFriendRequests } from '../../src/lib/friends';
import { HostPresence } from '../../src/lib/friendsCore';
import { useUserStore } from '../../src/stores/userStore';
import { useHostStore } from '../../src/stores/hostStore';
import { startLocationPrewarm } from '../../src/lib/locationCache';
import { CipherEventModal } from '../../src/components/CipherEventModal';
import { PrivacyDefaultsModal, PRIVACY_DEFAULTS_ACK_KEY } from '../../src/components/PrivacyDefaultsModal';
import { WhatsNewModal, PATCH_NOTES_LAST_SEEN_KEY } from '../../src/components/WhatsNewModal';
import { UpdateAvailableBanner } from '../../src/components/UpdateAvailableBanner';
import { shouldDisplayPatchNotes, LOCAL_PATCH_NOTES, PatchNotesPayload } from '../../src/lib/patchNotesCore';
import { fetchRemoteConfigFlags } from '../../src/lib/admin';
import { TacticalPullRefreshScrollView } from '../../src/components/TacticalPullRefresh';
import { TACTICAL_GOLD } from '../../src/theme/tokens';

const GHOSTRUN_MARK_MINT = require('../../assets/ghostrun-mark-mint.png');
const GHOSTRUN_MARK_OLIVE = require('../../assets/ghostrun-mark-olive.png');

interface ActiveGamePill {
  id: string;
  code: string;
  mode: string;
  status: string;
}

export function PlayContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const storedProfile = useUserStore((s) => s.profile);
  const [displayName, setDisplayName] = useState<string>(
    () => storedProfile?.display_name || 'Operative'
  );
  const [activeGame, setActiveGame] = useState<ActiveGamePill | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [seasonData, setSeasonData] = useState<ActiveSeasonData | null>(null);
  const [friendsHosting, setFriendsHosting] = useState<HostPresence[]>([]);
  const [friendCount, setFriendCount] = useState<number>(0);
  const [pendingRequestCount, setPendingRequestCount] = useState<number>(0);
  const [cipherModalVisible, setCipherModalVisible] = useState(false);
  const [privacyModalVisible, setPrivacyModalVisible] = useState(false);
  const [whatsNewModalVisible, setWhatsNewModalVisible] = useState(false);
  const [activePatchNotes, setActivePatchNotes] = useState<PatchNotesPayload>(LOCAL_PATCH_NOTES);

  const checkPatchNotesAck = useCallback(async () => {
    try {
      const lastSeen = await AsyncStorage.getItem(PATCH_NOTES_LAST_SEEN_KEY);
      const { flags } = await fetchRemoteConfigFlags();
      const remoteNotes: PatchNotesPayload = flags?.latest_patch_notes || LOCAL_PATCH_NOTES;
      setActivePatchNotes(remoteNotes);

      if (
        shouldDisplayPatchNotes({
          currentVersion: remoteNotes.version,
          lastSeenVersion: lastSeen,
          patchNotes: remoteNotes,
        })
      ) {
        setWhatsNewModalVisible(true);
      }
    } catch {
      // Non-blocking fallback
    }
  }, []);

  const checkPrivacyDefaultsAck = useCallback(async () => {
    try {
      const acknowledged = await AsyncStorage.getItem(PRIVACY_DEFAULTS_ACK_KEY);
      if (!acknowledged) {
        setPrivacyModalVisible(true);
      } else {
        // If privacy was already acknowledged, evaluate patch notes directive
        void checkPatchNotesAck();
      }
    } catch {
      // Non-blocking fallback
    }
  }, [checkPatchNotesAck]);

  // Check whether operative has acknowledged privacy defaults directive
  useEffect(() => {
    void checkPrivacyDefaultsAck();
  }, [checkPrivacyDefaultsAck]);

  // Keep displayName synced instantly whenever userStore updates
  useEffect(() => {
    if (storedProfile?.display_name) {
      setDisplayName(storedProfile.display_name);
    }
  }, [storedProfile?.display_name]);

  // Pre-warm GPS coordinates in background as soon as user opens Play screen
  useEffect(() => {
    void startLocationPrewarm();
  }, []);

  const loadProfileAndActiveGame = useCallback(async () => {
    // 1. Instant rendering from userStore / local cache
    const currentName = useUserStore.getState().profile?.display_name;
    if (currentName) {
      setDisplayName(currentName);
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
        const currentProfile = useUserStore.getState().profile;
        if (
          currentProfile?.display_name !== profile.display_name ||
          currentProfile?.color !== profile.color
        ) {
          useUserStore.getState().setProfile({
            id: userData.user.id,
            display_name: profile.display_name,
            color: profile.color,
            email: userData.user.email,
          });
        }
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

      // Fetch active season & banners (NF-31)
      const seasonRes = await fetchActiveSeasonAndBanners();
      if (seasonRes.success) {
        setSeasonData(seasonRes.data);
      }

      // Fetch friends list, incoming requests and hosting presence (FL-P1)
      const [friendsList, requestsData, hosts] = await Promise.all([
        listFriends().catch(() => []),
        listFriendRequests().catch(() => ({ incoming: [], outgoing: [] })),
        getFriendsHosting().catch(() => []),
      ]);
      if (Array.isArray(friendsList)) {
        setFriendCount(friendsList.length);
      }
      if (requestsData?.incoming) {
        setPendingRequestCount(requestsData.incoming.length);
      }
      setFriendsHosting(hosts || []);
    } catch {
      // Offline fallback
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProfileAndActiveGame();
      void checkPrivacyDefaultsAck();
      const interval = setInterval(() => {
        void Promise.all([
          listFriends().catch(() => []),
          listFriendRequests().catch(() => ({ incoming: [], outgoing: [] })),
          getFriendsHosting().catch(() => []),
        ])
          .then(([friendsList, requestsData, hosts]) => {
            if (Array.isArray(friendsList)) setFriendCount(friendsList.length);
            if (requestsData?.incoming) setPendingRequestCount(requestsData.incoming.length);
            setFriendsHosting(hosts || []);
          })
          .catch(() => {});
      }, 15000);
      return () => clearInterval(interval);
    }, [loadProfileAndActiveGame])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadProfileAndActiveGame();
    } finally {
      setRefreshing(false);
    }
  };

  const upper = (displayName || 'OPERATIVE').toUpperCase();
  const formattedName = upper.endsWith('.') ? upper : `${upper}.`;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <TacticalPullRefreshScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top, 24) + 8,
            paddingBottom: Math.max(insets.bottom, 24) + 140,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        {/* Top Header Row with GhostRun Brand Mark and Quick Access Icons */}
        <View style={styles.headerRow}>
          <View style={styles.brandContainer}>
            <Image
              source={isDark ? GHOSTRUN_MARK_MINT : GHOSTRUN_MARK_OLIVE}
              style={[
                styles.logo,
                { tintColor: isDark ? '#FFFFFF' : '#000000' },
              ]}
              resizeMode="contain"
              accessibilityLabel="GhostRun Logo"
            />
            <Text style={[styles.brandTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
              GHOST<Text style={{ color: colors.primary }}>RUN</Text>
            </Text>
          </View>

          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                pendingRequestCount > 0
                  ? `Friends Hub, ${pendingRequestCount} new friend request${pendingRequestCount > 1 ? 's' : ''}`
                  : `Friends Hub, ${friendCount} friend${friendCount === 1 ? '' : 's'}`
              }
              onPress={() => {
                triggerHaptic('buttonTap');
                router.push('/friends' as any);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              style={[
                styles.headerIconButton,
                {
                  backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                  borderColor: pendingRequestCount > 0 ? (colors.accent || '#F59E0B') : colors.border,
                },
              ]}
            >
              <Ionicons name="people-outline" size={19} color={colors.primary} />
              {(pendingRequestCount > 0 || friendCount > 0) && (
                <View
                  style={[
                    styles.friendsBadgeBlob,
                    {
                      backgroundColor: pendingRequestCount > 0
                        ? (colors.accent || '#F59E0B')
                        : colors.primary,
                      borderColor: isDark ? '#0C0E14' : '#FFFFFF',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.friendsBadgeBlobText,
                      {
                        color: pendingRequestCount > 0 ? '#000000' : colors.primaryText,
                      },
                    ]}
                  >
                    {pendingRequestCount > 0 ? `+${pendingRequestCount}` : friendCount}
                  </Text>
                </View>
              )}
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
        {/* In-App Tactical Update Notification Banner */}
        <UpdateAvailableBanner />

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

        {/* Season Countdown / Announcement Banner (NF-31) */}
        {seasonData && (seasonData.countdown || seasonData.banners.length > 0) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View Season Leaderboard & Echo Standings"
            onPress={() => {
              triggerHaptic('buttonTap');
              router.push('/leaderboard' as any);
            }}
            style={({ pressed }) => [
              styles.seasonBanner,
              {
                backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                borderColor: colors.borderDark || colors.border,
              },
              pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] },
            ]}
          >
            <View style={styles.seasonBannerRow}>
              <View style={[styles.pulsingDot, { backgroundColor: colors.accent }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.seasonBannerTitle, { color: colors.text }]}>
                  {seasonData.banners.length > 0
                    ? seasonData.banners[0].title
                    : seasonData.season?.name || 'Tactical Operations'}
                </Text>
                <Text style={[styles.seasonBannerSubtitle, { color: colors.textMuted }]}>
                  {seasonData.banners.length > 0
                    ? seasonData.banners[0].subtitle || ''
                    : seasonData.countdown?.label || ''}
                </Text>
              </View>
              <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
            </View>
          </Pressable>
        )}

        {/* Friends Hosting Now Presence Radar (FL-P1) */}
        {friendsHosting.length > 0 && (
          <View style={styles.radarSection}>
            <View style={styles.radarHeader}>
              <View style={[styles.pulsingDot, { backgroundColor: '#10B981' }]} />
              <Text style={[styles.radarTitle, { color: colors.text }]}>
                LIVE SQUAD RADAR ({friendsHosting.length})
              </Text>
            </View>
            {friendsHosting.map((host) => (
              <View
                key={host.gameId}
                style={[
                  styles.radarCard,
                  {
                    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.06)',
                    borderColor: '#10B981',
                  },
                ]}
              >
                <View style={styles.radarRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.radarHostName, { color: colors.text }]}>
                        {host.hostName}
                      </Text>
                      <View style={styles.hostingBadge}>
                        <View style={styles.livePulseDot} />
                        <Text style={styles.hostingBadgeText}>HOSTING</Text>
                      </View>
                    </View>
                    <Text style={[styles.radarHostDetails, { color: colors.textMuted }]}>
                      Mode: {host.modeId.replace(/_/g, ' ').toUpperCase()} • {host.playerCount} {host.playerCount === 1 ? 'Operative' : 'Operatives'} in Grid
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Join ${host.hostName}'s lobby`}
                    onPress={() => {
                      triggerHaptic('tagConfirmed');
                      router.push({
                        pathname: '/lobby/[id]',
                        params: { id: host.gameId },
                      } as any);
                    }}
                    style={styles.quickJoinBtn}
                  >
                    <Text style={styles.quickJoinBtnText}>Quick Join</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Outbreak Horde Flagship Mode Card */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Outbreak Horde Mode"
          onPress={() => {
            triggerHaptic('buttonTap');
            useHostStore.getState().setMode('outbreak_horde');
            router.push({
              pathname: '/modes/[id]',
              params: { id: 'outbreak_horde' },
            } as any);
          }}
          style={({ pressed }) => [
            styles.cipherCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.accent,
              marginBottom: 12,
            },
            pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] },
          ]}
        >
          <View style={styles.cipherCardInner}>
            {/* Iconic 2-Letter Emerald [OB] Tag */}
            <View
              style={[
                styles.cpTagBox,
                {
                  borderColor: colors.accent,
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                },
              ]}
            >
              <Text style={[styles.cpTagText, { color: colors.accent }]}>
                OB
              </Text>
            </View>

            {/* Clean Middle Column */}
            <View style={styles.cipherTextCol}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.cipherTitleText, { color: colors.text }]} numberOfLines={1}>
                  OUTBREAK HORDE
                </Text>
                <View
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    borderColor: colors.accent,
                    borderWidth: 1,
                    paddingHorizontal: 5,
                    paddingVertical: 1,
                    borderRadius: 4,
                  }}
                >
                  <Text style={{ color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>
                    NEW
                  </Text>
                </View>
              </View>
              <Text style={[styles.cipherSubText, { color: colors.textMuted }]}>
                PvP Infection Swarm • 1 Patient Zero vs Survivors
              </Text>
            </View>

            {/* Trailing Navigation Chevron */}
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textMuted}
            />
          </View>
        </Pressable>

        {/* Tactical Cipher Protocol Event Card with Iconic [CP] Tag */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cipher Protocol Launch Event"
          onPress={() => {
            triggerHaptic('buttonTap');
            setCipherModalVisible(true);
          }}
          style={({ pressed }) => [
            styles.cipherCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.borderDark,
            },
            pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] },
          ]}
        >
          <View style={styles.cipherCardInner}>
            {/* Iconic 2-Letter Gold [CP] Tag (like Scram's OG, but Cipher Protocol) */}
            <View
              style={[
                styles.cpTagBox,
                {
                  borderColor: TACTICAL_GOLD.primary,
                  backgroundColor: TACTICAL_GOLD.bgMedium,
                },
              ]}
            >
              <Text style={[styles.cpTagText, { color: TACTICAL_GOLD.primary }]}>
                CP
              </Text>
            </View>

            {/* Clean Middle Column - No colliding chips, No overflow */}
            <View style={styles.cipherTextCol}>
              <Text style={[styles.cipherTitleText, { color: colors.text }]} numberOfLines={1}>
                CIPHER PROTOCOL
              </Text>
              <Text style={[styles.cipherSubText, { color: colors.textMuted }]}>
                Classified gold radar pulse • 14 days left
              </Text>
            </View>

            {/* Trailing Navigation Chevron */}
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

          {/* Secondary Tactical Actions: Squads (NF-16) & Schedule (NF-13) */}
          <View style={styles.secondaryActionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Squads"
              onPress={() => {
                triggerHaptic('buttonTap');
                router.push('/squads' as any);
              }}
              style={({ pressed }) => [
                styles.secondaryActionBtn,
                {
                  backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.85, transform: [{ scale: 0.985 }] },
              ]}
            >
              <Ionicons name="people-outline" size={16} color={colors.primary} />
              <Text style={[styles.secondaryActionText, { color: colors.text }]}>
                Squads
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Schedule Match"
              onPress={() => {
                triggerHaptic('buttonTap');
                router.push('/schedule' as any);
              }}
              style={({ pressed }) => [
                styles.secondaryActionBtn,
                {
                  backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.85, transform: [{ scale: 0.985 }] },
              ]}
            >
              <Ionicons name="calendar-outline" size={16} color={colors.primary} />
              <Text style={[styles.secondaryActionText, { color: colors.text }]}>
                Schedule
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Pre-Flight Hardware Check"
              onPress={() => {
                triggerHaptic('buttonTap');
                router.push('/preflight' as any);
              }}
              style={({ pressed }) => [
                styles.secondaryActionBtn,
                {
                  backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.85, transform: [{ scale: 0.985 }] },
              ]}
            >
              <Ionicons name="hardware-chip-outline" size={16} color={colors.primary} />
              <Text style={[styles.secondaryActionText, { color: colors.text }]}>
                Pre-Flight
              </Text>
            </Pressable>
          </View>
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
      </TacticalPullRefreshScrollView>

      {/* GhostRun's Native Tactical Cipher Protocol Event Modal */}
      <CipherEventModal
        visible={cipherModalVisible}
        onClose={() => setCipherModalVisible(false)}
      />

      {/* GhostRun Tactical Privacy Defaults Modal */}
      <PrivacyDefaultsModal
        visible={privacyModalVisible}
        onClose={() => {
          setPrivacyModalVisible(false);
          // When privacy defaults is dismissed, evaluate patch notes display
          void checkPatchNotesAck();
        }}
      />

      {/* GhostRun Tactical What's New & Mission Patch Directive Modal */}
      <WhatsNewModal
        visible={whatsNewModalVisible}
        onClose={() => setWhatsNewModalVisible(false)}
        patchNotes={activePatchNotes}
      />
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
    flexGrow: 1,
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
    fontFamily: 'Archivo-Black',
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendsBadgeBlob: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  friendsBadgeBlobText: {
    fontFamily: 'Archivo-Black',
    fontSize: 10,
    fontWeight: '900',
    includeFontPadding: false,
    textAlign: 'center',
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
    fontFamily: 'Archivo-SemiBold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  heroSection: {
    marginBottom: 20,
  },
  greetingHi: {
    fontFamily: 'Archivo-Black',
    fontSize: 56,
    fontWeight: '900',
    lineHeight: 58,
    letterSpacing: -1.5,
  },
  greetingName: {
    fontFamily: 'Archivo-Black',
    fontSize: 56,
    fontWeight: '900',
    lineHeight: 60,
    letterSpacing: -1.5,
    marginBottom: 14,
  },
  subtitle: {
    fontFamily: 'SegoeUI-Regular',
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
  cipherCard: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    marginBottom: 24,
  },
  cipherCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cpTagBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cpTagText: {
    fontFamily: 'Archivo-Black',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  cipherTextCol: {
    flex: 1,
    justifyContent: 'center',
  },
  cipherTitleText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  cipherSubText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    lineHeight: 16,
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
    fontFamily: 'Archivo-Bold',
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
    fontFamily: 'Archivo-Bold',
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
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 14,
    fontWeight: '600',
  },
  linkSeparator: {
    fontSize: 14,
    fontWeight: '700',
  },
  radarSection: {
    marginBottom: 16,
  },
  radarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  radarTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  radarCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 8,
  },
  radarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  radarHostName: {
    fontFamily: 'Archivo-Bold',
    fontSize: 15,
    fontWeight: '800',
  },
  hostingBadge: {
    backgroundColor: '#10B981',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  livePulseDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#000000',
  },
  hostingBadgeText: {
    color: '#000000',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  radarHostDetails: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    marginTop: 2,
  },
  quickJoinBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickJoinBtnText: {
    color: '#000000',
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  seasonBanner: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  seasonBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  seasonBannerTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    fontWeight: '800',
  },
  seasonBannerSubtitle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    marginTop: 1,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  secondaryActionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryActionText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default function PlayRoute() {
  return null;
}

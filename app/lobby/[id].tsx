import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { Button } from '../../src/ui/Button';
import { SegmentBar } from '../../src/ui/SegmentBar';
import { RulesCard } from '../../src/ui/RulesCard';
import { RoleBriefingCard } from '../../src/ui/RoleBriefingCard';
import { getModeModule } from '../../src/modes/registry';
import { useUnits } from '../../src/utils/units';
import { supabase } from '../../src/lib/supabase';
import { ReadyCheckModal } from '../../src/components/ReadyCheckModal';
import { LobbyInviteModal } from '../../src/components/LobbyInviteModal';
import { buildInvitePayload } from '../../src/lib/invite';
import {
  runTrackingHealthDiagnostic,
  type TrackingHealthReport,
} from '../../src/lib/trackingHealth';

type Team = 'runner' | 'hunter' | 'unassigned';

interface LobbyPlayer {
  id: string;
  user_id: string;
  display_name: string;
  color: string;
  team: Team;
  status: 'active' | 'tagged' | 'left' | 'jailed';
  is_ready: boolean;
  is_remote?: boolean;
  tracking_health?: 'healthy' | 'warning' | 'degraded' | 'unknown';
}

interface LobbyGame {
  id: string;
  code: string;
  host_id: string;
  mode: string;
  mode_id: string;
  modifiers: string[];
  roles: string[];
  mode_params: Record<string, unknown>;
  status: string;
  jail?: {
    id: string;
    latitude: number;
    longitude: number;
    radius_m: number;
  } | null;
  extraction?: {
    id: string;
    latitude: number;
    longitude: number;
    radius_m: number;
  } | null;
  safe_zones?: {
    id: string;
    latitude: number;
    longitude: number;
    radius_m: number;
    zone_index: number;
  }[];
  area_center?: { latitude: number; longitude: number } | [number, number];
  area_radius_m?: number;
}

interface LobbyState {
  game: LobbyGame;
  players: LobbyPlayer[];
  my_player_id: string;
  my_team: Team;
  server_time: string;
}

type RpcResult = { error: { message: string } | null; data?: unknown };

export default function LobbyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii } = useTheme();
  const { formatDistance } = useUnits();
  const gameId = Array.isArray(id) ? id[0] : id;

  const [activeSegment, setActiveSegment] = useState('roster');
  const [state, setState] = useState<LobbyState | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [kickingPlayerId, setKickingPlayerId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string>('');
  const [shareChoice, setShareChoice] = useState<boolean | null | undefined>(undefined);
  const [savingShare, setSavingShare] = useState(false);
  const [mySecretRole, setMySecretRole] = useState<string | null>(null);
  const [roleAcknowledged, setRoleAcknowledged] = useState(false);

  // Ready check tracking health (NF-04)
  const [readyCheckVisible, setReadyCheckVisible] = useState(false);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [healthReport, setHealthReport] = useState<TrackingHealthReport | null>(null);
  const [isProbingHealth, setIsProbingHealth] = useState(false);

  const submitHealth = useCallback(
    async (health: string) => {
      if (!supabase || !gameId) return;
      try {
        await (supabase.rpc as any)('submit_tracking_health', { game_id: gameId, health });
      } catch {
        // Non-blocking fallback if RPC is unmigrated
      }
    },
    [gameId],
  );

  const handleRunDiagnostic = useCallback(async () => {
    setIsProbingHealth(true);
    try {
      const rep = await runTrackingHealthDiagnostic();
      setHealthReport(rep);
      void submitHealth(rep.overall);
      return rep;
    } finally {
      setIsProbingHealth(false);
    }
  }, [submitHealth]);

  // Host draft modifiers/roles
  const [draftModifiers, setDraftModifiers] = useState<string[]>([]);
  const [draftRoles, setDraftRoles] = useState<string[]>([]);
  const [draftLockedMap, setDraftLockedMap] = useState<boolean>(true);
  const [draftBlackout, setDraftBlackout] = useState<boolean>(false);
  const [scrambleCharges, setScrambleCharges] = useState<number>(1);
  const draftTouchedRef = useRef(false);
  const [savingModes, setSavingModes] = useState(false);
  const [modesMessage, setModesMessage] = useState('');

  const loadState = useCallback(async () => {
    if (!supabase || !gameId) return;
    const [{ data: authData }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('get_game_state', { game_id: gameId }),
    ]);

    setUserId(authData.user?.id ?? null);
    if (error) {
      if (error.message.includes('not a member')) {
        router.replace('/play' as any);
        return;
      }
      setErrorMessage(error.message);
      return;
    }

    if (data) {
      setState(data as LobbyState);
      setErrorMessage('');
      const loaded = data as LobbyState;
      if (!draftTouchedRef.current) {
        setDraftModifiers(loaded.game.modifiers ?? []);
        setDraftRoles(loaded.game.roles ?? []);
        const currentLocked = (loaded.game.mode_params as any)?.locked_map;
        if (currentLocked !== undefined && currentLocked !== null) {
          setDraftLockedMap(Boolean(currentLocked));
        } else {
          setDraftLockedMap(true);
        }
        const isBlackout = Boolean(
          (loaded.game.mode_params as any)?.blackout ||
          (loaded.game.mode_params as any)?.radar_only ||
          (loaded.game as any).difficulty === 'blackout'
        );
        setDraftBlackout(isBlackout);
        const daParams = loaded.game.mode_params?.double_agent as
          | { scramble_charges?: number }
          | undefined;
        if (daParams?.scramble_charges) {
          setScrambleCharges(Number(daParams.scramble_charges));
        }
      }
    }

    if (authData.user) {
      const [{ data: selfRow }, { data: roleData }] = await Promise.all([
        supabase
          .from('players')
          .select('share_trail')
          .eq('game_id', gameId)
          .eq('user_id', authData.user.id)
          .maybeSingle(),
        supabase.rpc('get_my_role', { game_id: gameId }),
      ]);

      if (selfRow) {
        setShareChoice((selfRow.share_trail as boolean | null) ?? null);
      }
      if (roleData && typeof roleData === 'object' && (roleData as any).role) {
        setMySecretRole((roleData as any).role);
      }
    }
  }, [gameId, router]);

  useEffect(() => {
    const timer = setTimeout(() => void loadState(), 0);
    if (!supabase || !gameId) return;

    const channel = supabase
      .channel(`lobby-${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => void loadState(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` },
        () => void loadState(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events', filter: `game_id=eq.${gameId}` },
        (payload: { new?: { type?: string; payload?: { kicked?: boolean } } }) => {
          if (payload.new?.type === 'player_left' && payload.new?.payload?.kicked) {
            setBannerMessage('A player was removed from the lobby.');
          }
          void loadState();
        },
      )
      .subscribe();

    return () => {
      clearTimeout(timer);
      void supabase?.removeChannel(channel);
    };
  }, [gameId, loadState]);

  // Phase follow
  useEffect(() => {
    if (!state || !gameId) return;
    if (state.game.status === 'target_selection') {
      router.replace({ pathname: '/target/[id]', params: { id: gameId } });
    } else if (
      ['countdown', 'head_start', 'live', 'ended', 'cancelled'].includes(state.game.status)
    ) {
      router.replace({ pathname: '/game/[id]', params: { id: gameId } });
    }
  }, [gameId, router, state]);

  const isHost = Boolean(state && userId && state.game.host_id === userId);
  const activePlayers = useMemo(
    () => state?.players.filter((p) => p.status === 'active') ?? [],
    [state],
  );

  const isSoloMode = state?.game.mode_id === 'ghost_duel' || state?.game.mode_id === 'assassin_ring';
  const isJailbreak = state?.game.mode_id === 'jailbreak';
  const isRelayHeist = state?.game.mode_id === 'relay_heist';

  const hasBothTeams = isSoloMode
    ? activePlayers.length >= (state?.game.mode_id === 'assassin_ring' ? 3 : 1)
    : activePlayers.some((p) => p.team === 'runner') &&
      activePlayers.some((p) => p.team === 'hunter');

  const everyoneReady =
    activePlayers.length >= (state?.game.mode_id === 'ghost_duel' ? 1 : state?.game.mode_id === 'assassin_ring' ? 3 : 2) &&
    activePlayers.every((p) => p.is_ready);

  const everyoneAssigned = isSoloMode
    ? true
    : activePlayers.every((p) => p.team !== 'unassigned');

  const jailPlaced = Boolean(state?.game.jail);
  const canStart = hasBothTeams && everyoneAssigned && (!isJailbreak || jailPlaced);

  const activeModule = getModeModule(state?.game.mode_id || 'classic_chase');

  // Ensure push notifications and location permissions are ready before match begins
  const ensureGamePermissions = useCallback(async () => {
    try {
      const notifStatus = await Notifications.getPermissionsAsync();
      if (!notifStatus.granted && notifStatus.canAskAgain) {
        await Notifications.requestPermissionsAsync();
      }
      const locStatus = await Location.getForegroundPermissionsAsync();
      if (!locStatus.granted && locStatus.canAskAgain) {
        await Location.requestForegroundPermissionsAsync();
      }
    } catch {
      // Non-blocking fallback
    }
  }, []);

  // Request notifications & GPS on lobby entry
  useEffect(() => {
    void ensureGamePermissions();
  }, [ensureGamePermissions]);

  // RPC wrappers
  async function runAction(action: string, call: () => PromiseLike<RpcResult>) {
    setBusyAction(action);
    setErrorMessage('');
    const result = await call();
    setBusyAction('');
    if (result.error) {
      setErrorMessage(result.error.message);
      return false;
    }
    await loadState();
    return true;
  }

  async function setTeam(player: LobbyPlayer, team: Team) {
    if (!supabase || !gameId) return;
    await runAction('team', () =>
      supabase!.rpc('set_team', { game_id: gameId, player_id: player.id, team }),
    );
  }

  async function toggleRemote(player: LobbyPlayer) {
    if (!supabase || !gameId) return;
    await runAction('remote', () =>
      supabase!.rpc('set_player_remote', {
        p_game_id: gameId,
        p_is_remote: !player.is_remote,
        p_player_id: player.id,
      }),
    );
  }

  async function randomizeTeams() {
    if (!supabase || !gameId) return;
    const hunterCount = Math.max(1, Math.floor(activePlayers.length / 3));
    await runAction('randomize', () =>
      supabase!.rpc('randomize_teams', { game_id: gameId, hunter_count: hunterCount }),
    );
  }

  async function rotateRoles() {
    if (!supabase || !gameId) return;
    await runAction('rotate', () =>
      (supabase!.rpc as any)('rotate_teams', { game_id: gameId }),
    );
  }

  async function continueLobby() {
    if (!supabase || !gameId) return;
    await runAction('continue', () => supabase!.rpc('begin_target_selection', { game_id: gameId }));
  }

  async function startRound() {
    if (!supabase || !gameId) return;
    await ensureGamePermissions();
    const started = await runAction('start', () =>
      supabase!.rpc('start_game', { game_id: gameId }),
    );
    if (started) router.replace({ pathname: '/game/[id]', params: { id: gameId } });
  }

  async function confirmReadyFromCheck() {
    setReadyCheckVisible(false);
    if (!supabase || !gameId) return;
    if (healthReport) {
      void submitHealth(healthReport.overall);
    }
    await runAction('ready', () =>
      supabase!.rpc('set_ready', { game_id: gameId, ready: true }),
    );
  }

  async function toggleReady() {
    if (!supabase || !gameId) return;
    const ownPlayer = state?.players.find((p) => p.id === state.my_player_id);

    // If standing down, unready immediately
    if (ownPlayer?.is_ready) {
      await runAction('ready', () =>
        supabase!.rpc('set_ready', { game_id: gameId, ready: false }),
      );
      return;
    }

    // Guard: In team mode, require operative to pick a team before readying up
    if (!isSoloMode && ownPlayer?.team === 'unassigned') {
      setErrorMessage('Please join either Runners or Hunters before readying up.');
      return;
    }

    // Privacy guard: If replay trail consent hasn't been explicitly selected yet, default to Keep Private
    if (shareChoice === null || shareChoice === undefined) {
      const ok = await chooseShare(false);
      if (!ok) return;
    }

    // If becoming ready, ensure match notifications & location permissions are active
    await ensureGamePermissions();

    // If role has high complexity and unacknowledged, switch to rules tab and warn
    const effectiveRole = mySecretRole || ownPlayer?.team;
    const isHighComplexity = ['double_agent', 'operator', 'vip'].includes(effectiveRole || '');
    if (isHighComplexity && !roleAcknowledged) {
      setActiveSegment('rules');
      setBannerMessage('Please review and acknowledge your tactical role directives in Rules & Intel.');
      return;
    }

    // NF-04: If health report not yet run or has warnings/degraded, show ready check modal
    if (!healthReport || healthReport.overall === 'degraded' || healthReport.overall === 'warning') {
      setReadyCheckVisible(true);
      void handleRunDiagnostic();
      return;
    }

    void submitHealth(healthReport.overall);

    await runAction('ready', () =>
      supabase!.rpc('set_ready', { game_id: gameId, ready: true }),
    );
  }

  async function confirmKick(player: LobbyPlayer) {
    if (!supabase || !gameId) return;
    setKickingPlayerId(null);
    await runAction('kick', () =>
      supabase!.rpc('kick_player', { game_id: gameId, player_id: player.id }),
    );
  }

  async function leaveLobby() {
    if (!supabase || !gameId) return;
    setBusyAction('leave');
    const { error } = await supabase.rpc('leave_game', { game_id: gameId });
    setBusyAction('');
    if (error) setErrorMessage(error.message);
    else router.replace('/play' as any);
  }

  async function cancelGame() {
    if (!supabase || !gameId) return;
    setBusyAction('cancel');
    const { error } = await supabase.rpc('cancel_game', { game_id: gameId });
    setBusyAction('');
    if (error) setErrorMessage(error.message);
    else router.replace('/play' as any);
  }

  function handleExitLobby() {
    if (isHost) {
      Alert.alert(
        'Cancel Mission?',
        'As the host, leaving will cancel this mission and disband the lobby for all operatives.',
        [
          { text: 'Keep Lobby', style: 'cancel' },
          { text: 'Cancel Mission', style: 'destructive', onPress: () => void cancelGame() },
        ]
      );
    } else {
      Alert.alert(
        'Leave Lobby?',
        'Are you sure you want to leave this mission lobby?',
        [
          { text: 'Stay', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: () => void leaveLobby() },
        ]
      );
    }
  }

  async function shareCode() {
    if (!state) return;
    const payload = buildInvitePayload({
      code: state.game.code,
      modeId: state.game.mode_id,
      modeName: activeModule?.name,
      playerCount: state.players.length,
    });
    try {
      await Share.share({
        title: payload.title,
        message: payload.message,
        url: payload.webLink,
      });
    } catch {
      // User cancelled share or dismissed
    }
  }

  async function chooseShare(share: boolean): Promise<boolean> {
    if (!supabase || !gameId) return false;
    setSavingShare(true);
    setErrorMessage('');
    const { error } = await supabase.rpc('set_share_trail', { game_id: gameId, share });
    setSavingShare(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setShareChoice(share);
    await loadState();
    return true;
  }

  function toggleDraft(list: 'modifiers' | 'roles', modId: string) {
    draftTouchedRef.current = true;
    setModesMessage('');
    const setter = list === 'modifiers' ? setDraftModifiers : setDraftRoles;
    setter((curr) =>
      curr.includes(modId) ? curr.filter((v) => v !== modId) : [...curr, modId],
    );
  }

  async function saveModeConfig() {
    if (!supabase || !gameId) return;
    setSavingModes(true);
    setModesMessage('');
    const modeParams: Record<string, unknown> = {
      ...(state?.game.mode_params ?? {}),
      locked_map: draftLockedMap,
      ...(draftBlackout
        ? { blackout: true, radar_only: true, difficulty: 'blackout' }
        : { blackout: false, radar_only: false }),
    };
    if (draftRoles.includes('double_agent')) {
      modeParams.double_agent = {
        scramble_charges: scrambleCharges,
        scramble_cooldown_s: 120,
      };
    } else {
      delete modeParams.double_agent;
    }
    const { error } = await supabase.rpc('set_game_modes', {
      game_id: gameId,
      modifiers: draftModifiers,
      roles: draftRoles,
      mode_params: modeParams,
    });
    setSavingModes(false);
    if (error) {
      setModesMessage(error.message);
      return;
    }
    draftTouchedRef.current = false;
    await loadState();
  }

  async function placeJail() {
    if (!supabase || !gameId) return;
    const center = state?.game.area_center;
    let targetLat = 0;
    let targetLng = 0;
    if (center) {
      if (Array.isArray(center)) {
        targetLng = center[0];
        targetLat = center[1];
      } else {
        targetLat = center.latitude;
        targetLng = center.longitude;
      }
    }
    await runAction('place_jail', () =>
      supabase!.rpc('set_jail_location', {
        game_id: gameId,
        lat: targetLat,
        lng: targetLng,
      }),
    );
    await loadState();
  }

  async function placeExtraction() {
    if (!supabase || !gameId) return;
    const center = state?.game.area_center;
    let targetLat = 0;
    let targetLng = 0;
    if (center) {
      if (Array.isArray(center)) {
        targetLng = center[0];
        targetLat = center[1];
      } else {
        targetLat = center.latitude;
        targetLng = center.longitude;
      }
    }
    await runAction('place_extraction', () =>
      supabase!.rpc('set_extraction_location', {
        p_game_id: gameId,
        p_lat: targetLat,
        p_lng: targetLng,
      }),
    );
    await loadState();
  }

  if (!state) {
    return (
      <View
        style={[
          styles.loading,
          {
            backgroundColor: colors.background,
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
          },
        ]}
      >
        {errorMessage ? (
          <Text variant="body" style={{ color: colors.danger }}>
            {errorMessage}
          </Text>
        ) : (
          <ActivityIndicator color={colors.primary} size="large" />
        )}
        <Button
          title="Refresh Lobby"
          variant="secondary"
          size="sm"
          style={{ marginTop: spacing.md }}
          onPress={() => void loadState()}
        />
      </View>
    );
  }

  function handleTogglePrivacy() {
    Alert.alert(
      'Post-Match Route Privacy',
      'Choose whether opponents can inspect your movement trail during post-match replays.',
      [
        {
          text: 'Share with Crew',
          onPress: () => void chooseShare(true),
        },
        {
          text: 'Keep Private (Default)',
          onPress: () => void chooseShare(false),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  const ownPlayer = state.players.find((p) => p.id === state.my_player_id);
  const runners = activePlayers.filter((p) => p.team === 'runner');
  const hunters = activePlayers.filter((p) => p.team === 'hunter');
  const unassigned = activePlayers.filter((p) => p.team === 'unassigned');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: spacing.lg,
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 210,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Navigation Bar with Back / Leave Button */}
        <View style={styles.topNavRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isHost ? 'Cancel Mission' : 'Leave Lobby'}
            onPress={handleExitLobby}
            style={[styles.exitIconButton, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
          >
            <Ionicons name="arrow-back" size={18} color={colors.text} />
          </Pressable>

          <View style={{ flex: 1, marginHorizontal: spacing.sm }}>
            <Text variant="caption" numberOfLines={1} style={{ color: colors.accent, fontWeight: '800', letterSpacing: 1.5, fontSize: 10 }}>
              MISSION LOBBY
            </Text>
            <Text variant="title" numberOfLines={1} style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>
              {activeModule?.name || 'Classic Chase'}
            </Text>
          </View>

          <View style={[styles.statusChipWrap, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}>
            <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700', marginRight: 6 }}>
              {everyoneReady ? 'READY' : 'PREPARING'}
            </Text>
            <View style={[styles.statusPulseDot, { backgroundColor: everyoneReady ? colors.accent : colors.radarScan }]} />
          </View>
        </View>

        {/* Mission Code & Share Card */}
        <Card
          variant="default"
          style={[styles.missionCodeCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
        >
          <View style={styles.missionCodeTopRow}>
            <View style={styles.missionCodeLeft}>
              <Text style={styles.missionCodeCaption}>ACCESS CODE:</Text>
              <Text style={styles.missionCodeValue}>{state.game.code}</Text>
            </View>
            <View style={styles.missionCodeActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share invite code"
                onPress={() => void shareCode()}
                style={[styles.shareActionBtn, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
              >
                <Ionicons name="share-outline" size={15} color={colors.runner} />
                <Text style={[styles.shareActionText, { color: colors.runner }]}>SHARE</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show QR code and invite link"
                onPress={() => setInviteModalVisible(true)}
                style={[styles.shareActionBtn, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
              >
                <Ionicons name="qr-code-outline" size={15} color={colors.accent} />
                <Text style={[styles.shareActionText, { color: colors.accent }]}>QR</Text>
              </Pressable>
            </View>
          </View>

          {activePlayers.length < 2 && !isSoloMode && (
            <View style={styles.warningAlertRow}>
              <Ionicons name="warning-outline" size={14} color={colors.warning} />
              <Text style={styles.warningAlertText}>
                At least 2 players needed to assign teams.
              </Text>
            </View>
          )}
        </Card>

        {bannerMessage !== '' && (
          <Card
            variant="elevated"
            style={[styles.bannerCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.warning, marginTop: 8 }]}
          >
            <Text variant="body" style={{ color: colors.warning, fontSize: 13 }}>
              {bannerMessage}
            </Text>
          </Card>
        )}

        {errorMessage !== '' && (
          <Card
            variant="elevated"
            style={[styles.bannerCard, { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder, marginTop: 8 }]}
          >
            <Text variant="body" style={{ color: colors.dangerText, fontSize: 13 }}>
              {errorMessage}
            </Text>
          </Card>
        )}

        {/* 3-Segment Bar */}
        <View style={{ marginTop: 10 }}>
          <SegmentBar
            items={[
              { id: 'roster', label: `ROSTER (${activePlayers.length})` },
              { id: 'rules', label: 'RULES & INTEL' },
              { id: 'map', label: 'TACTICAL AREA' },
            ]}
            activeId={activeSegment}
            onChange={setActiveSegment}
          />
        </View>

        {/* Compact Quick-Bar: Route Privacy & Sensor Diagnostics (Side-by-side pills from mockup) */}
        <View style={styles.quickBarRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Configure route privacy"
            onPress={handleTogglePrivacy}
            style={[
              styles.quickPill,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: shareChoice === true ? colors.accent : colors.borderDark,
              },
            ]}
          >
            <Ionicons
              name={shareChoice === true ? 'eye-outline' : 'shield-checkmark-outline'}
              size={14}
              color={shareChoice === true ? colors.accent : colors.textMuted}
            />
            <Text
              variant="caption"
              numberOfLines={1}
              style={{
                color: colors.text,
                fontSize: 11,
                fontWeight: '600',
                marginLeft: 5,
                flex: 1,
              }}
            >
              Privacy: {shareChoice === true ? 'Shared' : 'Keep Private'}
            </Text>
            <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check Sensors and GPS"
            onPress={() => {
              setReadyCheckVisible(true);
              void handleRunDiagnostic();
            }}
            style={[
              styles.quickPill,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor:
                  healthReport?.overall === 'healthy'
                    ? colors.accent
                    : healthReport?.overall === 'warning'
                    ? colors.warning
                    : colors.borderDark,
              },
            ]}
          >
            <Ionicons
              name={
                healthReport?.overall === 'healthy'
                  ? 'checkmark-circle'
                  : healthReport?.overall === 'warning'
                  ? 'alert-circle'
                  : 'shield-checkmark-outline'
              }
              size={14}
              color={
                healthReport?.overall === 'healthy'
                  ? colors.accent
                  : healthReport?.overall === 'warning'
                  ? colors.warning
                  : colors.primary
              }
            />
            <Text
              variant="caption"
              numberOfLines={1}
              style={{
                color:
                  healthReport?.overall === 'healthy'
                    ? colors.accent
                    : healthReport?.overall === 'warning'
                    ? colors.warning
                    : colors.text,
                fontSize: 11,
                fontWeight: '600',
                marginLeft: 5,
                flex: 1,
              }}
            >
              Diagnostics: {healthReport?.overall === 'healthy' ? 'Ready' : healthReport?.overall === 'warning' ? 'Warning' : 'Check'}
            </Text>
            <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* ==================== SEGMENT 1: ROSTER ==================== */}
        {activeSegment === 'roster' && (
          <View style={{ marginTop: 8 }}>
            {isSoloMode ? (
              <View>
                <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
                  SOLO OPERATIVES ({activePlayers.length})
                </Text>
                {activePlayers.map((player) => (
                  <PlayerRow
                    key={player.id}
                    player={player}
                    isHost={isHost}
                    isSelf={player.id === state.my_player_id}
                    isGameHost={player.user_id === state.game.host_id}
                    kickingId={kickingPlayerId}
                    colors={colors}
                    radii={radii}
                    onStartKick={setKickingPlayerId}
                    onConfirmKick={() => void confirmKick(player)}
                    onCancelKick={() => setKickingPlayerId(null)}
                  />
                ))}
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {/* Squad Arena: Side-by-Side Runners vs Hunters (Mockup Layout) */}
                <View style={styles.squadArenaRow}>
                  {/* RUNNERS COLUMN */}
                  <Card
                    variant="default"
                    style={[
                      styles.squadColumnCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: ownPlayer?.team === 'runner' ? colors.runner : colors.borderDark,
                      },
                    ]}
                  >
                    <View style={styles.squadColHeader}>
                      <View style={[styles.squadColDot, { backgroundColor: colors.runner }]} />
                      <Text style={[styles.squadColTitle, { color: colors.runner }]}>
                        RUNNERS ({runners.length})
                      </Text>
                    </View>

                    {ownPlayer?.team !== 'runner' ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Join Runners squad"
                        onPress={() => ownPlayer && void setTeam(ownPlayer, 'runner')}
                        style={[styles.squadJoinButton, { borderColor: colors.runner }]}
                      >
                        <Text style={[styles.squadJoinText, { color: colors.runner }]}>JOIN</Text>
                      </Pressable>
                    ) : null}

                    {runners.length === 0 ? (
                      <Text style={styles.squadEmptyText}>No operatives assigned</Text>
                    ) : (
                      <View style={{ gap: 6 }}>
                        {runners.map((p) => {
                          const isSelf = p.id === state.my_player_id;
                          return (
                            <View
                              key={p.id}
                              style={[
                                styles.miniPlayerCard,
                                {
                                  backgroundColor: isSelf ? colors.surfaceElevated : 'transparent',
                                  borderColor: isSelf ? colors.runner : colors.borderDark,
                                },
                              ]}
                            >
                              <View style={styles.miniPlayerTop}>
                                <View style={[styles.miniAvatarDot, { backgroundColor: p.color || colors.runner }]} />
                                <Text style={styles.miniPlayerName} numberOfLines={1}>
                                  {p.display_name} {isSelf ? '(YOU)' : ''}
                                </Text>
                              </View>
                              <View style={styles.miniPlayerBottom}>
                                <Chip
                                  label={p.is_ready ? 'READY' : 'PREPARING'}
                                  variant={p.is_ready ? 'accent' : 'muted'}
                                  size="sm"
                                />
                                {isSelf && (
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Leave Runners squad"
                                    onPress={() => void setTeam(ownPlayer!, 'unassigned')}
                                    style={styles.miniLeaveBtn}
                                  >
                                    <Ionicons name="exit-outline" size={11} color={colors.textMuted} />
                                    <Text style={styles.miniLeaveText}>LEAVE</Text>
                                  </Pressable>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </Card>

                  {/* HUNTERS COLUMN */}
                  <Card
                    variant="default"
                    style={[
                      styles.squadColumnCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: ownPlayer?.team === 'hunter' ? colors.hunter : colors.borderDark,
                      },
                    ]}
                  >
                    <View style={styles.squadColHeader}>
                      <View style={[styles.squadColDot, { backgroundColor: colors.hunter }]} />
                      <Text style={[styles.squadColTitle, { color: colors.hunter }]}>
                        HUNTERS ({hunters.length})
                      </Text>
                    </View>

                    {ownPlayer?.team !== 'hunter' ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Join Hunters squad"
                        onPress={() => ownPlayer && void setTeam(ownPlayer, 'hunter')}
                        style={[styles.squadJoinButton, { borderColor: colors.hunter }]}
                      >
                        <Text style={[styles.squadJoinText, { color: colors.hunter }]}>JOIN</Text>
                      </Pressable>
                    ) : null}

                    {hunters.length === 0 ? (
                      <Text style={styles.squadEmptyText}>No operatives assigned</Text>
                    ) : (
                      <View style={{ gap: 6 }}>
                        {hunters.map((p) => {
                          const isSelf = p.id === state.my_player_id;
                          return (
                            <View
                              key={p.id}
                              style={[
                                styles.miniPlayerCard,
                                {
                                  backgroundColor: isSelf ? colors.surfaceElevated : 'transparent',
                                  borderColor: isSelf ? colors.hunter : colors.borderDark,
                                },
                              ]}
                            >
                              <View style={styles.miniPlayerTop}>
                                <View style={[styles.miniAvatarDot, { backgroundColor: p.color || colors.hunter }]} />
                                <Text style={styles.miniPlayerName} numberOfLines={1}>
                                  {p.display_name} {isSelf ? '(YOU)' : ''}
                                </Text>
                              </View>
                              <View style={styles.miniPlayerBottom}>
                                <Chip
                                  label={p.is_ready ? 'READY' : 'PREPARING'}
                                  variant={p.is_ready ? 'accent' : 'muted'}
                                  size="sm"
                                />
                                {isSelf && (
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Leave Hunters squad"
                                    onPress={() => void setTeam(ownPlayer!, 'unassigned')}
                                    style={styles.miniLeaveBtn}
                                  >
                                    <Ionicons name="exit-outline" size={11} color={colors.textMuted} />
                                    <Text style={styles.miniLeaveText}>LEAVE</Text>
                                  </Pressable>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </Card>
                </View>

                {/* Unassigned Operatives Card */}
                <Card
                  variant="default"
                  style={[
                    styles.unassignedCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: unassigned.length > 0 && ownPlayer?.team === 'unassigned' ? colors.warning : colors.borderDark,
                    },
                  ]}
                >
                  <View style={styles.unassignedHeader}>
                    <Ionicons name="people-outline" size={15} color={colors.textMuted} />
                    <Text style={styles.unassignedTitle}>
                      UNASSIGNED OPERATIVES ({unassigned.length})
                    </Text>
                  </View>

                  {unassigned.length === 0 ? (
                    <Text style={styles.unassignedEmptyText}>No unassigned operatives</Text>
                  ) : (
                    <View style={{ gap: 6, marginTop: 4 }}>
                      {unassigned.map((p) => {
                        const isSelf = p.id === state.my_player_id;
                        return (
                          <View
                            key={p.id}
                            style={[
                              styles.unassignedRow,
                              {
                                backgroundColor: isSelf ? colors.surfaceElevated : 'transparent',
                                borderColor: isSelf ? colors.borderAccent : colors.borderDark,
                              },
                            ]}
                          >
                            <View style={styles.unassignedRowLeft}>
                              <View style={[styles.miniAvatarDot, { backgroundColor: p.color || colors.primary }]} />
                              <Text style={styles.unassignedRowName} numberOfLines={1}>
                                {p.display_name} {isSelf ? '(YOU)' : ''}
                              </Text>
                              {p.user_id === state.game.host_id && (
                                <MaterialCommunityIcons name="crown" size={14} color={colors.warning} style={{ marginLeft: 4 }} />
                              )}
                            </View>
                            <View style={styles.unassignedRowRight}>
                              <Chip
                                label={p.is_ready ? 'READY' : 'PREPARING'}
                                variant={p.is_ready ? 'accent' : 'muted'}
                                size="sm"
                              />
                              {isSelf && (
                                <View style={styles.quickJoinRow}>
                                  <Pressable
                                    onPress={() => void setTeam(ownPlayer!, 'runner')}
                                    style={[styles.quickJoinBtn, { borderColor: colors.runner }]}
                                  >
                                    <Text style={[styles.quickJoinText, { color: colors.runner }]}>JOIN RUNNERS</Text>
                                  </Pressable>
                                  <Pressable
                                    onPress={() => void setTeam(ownPlayer!, 'hunter')}
                                    style={[styles.quickJoinBtn, { borderColor: colors.hunter }]}
                                  >
                                    <Text style={[styles.quickJoinText, { color: colors.hunter }]}>JOIN HUNTERS</Text>
                                  </Pressable>
                                </View>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </Card>

                {/* Host Squad Controls Card */}
                {isHost && !isSoloMode && (
                  <Card
                    variant="default"
                    style={[
                      styles.hostControlsCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.borderDark,
                      },
                    ]}
                  >
                    <Text style={styles.hostControlsLabel}>HOST CONTROLS</Text>
                    <View style={styles.hostControlsButtons}>
                      <Button
                        title="Rotate Roles"
                        variant="secondary"
                        size="sm"
                        style={{ flex: 1 }}
                        disabled={activePlayers.length < 2 || busyAction === 'rotate'}
                        onPress={() => void rotateRoles()}
                      />
                      <Button
                        title="Shuffle Squads"
                        variant="secondary"
                        size="sm"
                        style={{ flex: 1 }}
                        disabled={activePlayers.length < 2 || busyAction === 'randomize'}
                        onPress={() => void randomizeTeams()}
                      />
                    </View>
                  </Card>
                )}
              </View>
            )}
          </View>
        )}

        {/* ==================== SEGMENT 2: RULES & INTEL ==================== */}
        {activeSegment === 'rules' && (
          <View style={{ marginTop: spacing.md }}>
            {/* Private Role Briefing Card (Addendum C #3) */}
            <Text variant="label" style={{ color: colors.radarScan, marginBottom: spacing.xs }}>
              YOUR ASSIGNED BRIEFING (PRIVATE · EYES ONLY)
            </Text>
            <RoleBriefingCard
              roleId={mySecretRole || ownPlayer?.team || 'runner'}
              team={ownPlayer?.team}
              acknowledged={roleAcknowledged}
              onToggleAcknowledge={setRoleAcknowledged}
            />

            {/* Mode Rules Dossier */}
            <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
              TACTICAL RULES DOSSIER
            </Text>
            {activeModule && <RulesCard module={activeModule} />}

            {/* Modifiers & Roles Summary */}
            <Card
              variant="default"
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}
            >
              <Text variant="label" style={{ color: colors.primary, marginBottom: spacing.xs }}>
                ACTIVE MODIFIERS & PARAMETERS
              </Text>
              {(state.game.modifiers?.length ?? 0) === 0 ? (
                <Text variant="caption" style={{ color: colors.textMuted }}>
                  Standard mode rules active (no modifiers added).
                </Text>
              ) : (
                <View style={styles.chipRow}>
                  {state.game.modifiers?.map((mod) => (
                    <Chip key={mod} label={mod.replace(/_/g, ' ').toUpperCase()} variant="accent" size="sm" />
                  ))}
                </View>
              )}

              {isHost && (
                <View style={[styles.hostModBox, { borderTopColor: colors.borderDark, marginTop: spacing.md }]}>
                  <Text variant="label" style={{ color: colors.warning, marginBottom: spacing.xs }}>
                    HOST MODIFIER MANAGEMENT
                  </Text>
                  <View style={styles.chipRow}>
                    {['ai_gm', 'hot_cold', 'noise_meter', 'shrinking_zone', 'dead_drops'].map((mod) => {
                      const active = draftModifiers.includes(mod);
                      return (
                        <Chip
                          key={mod}
                          label={mod.replace(/_/g, ' ').toUpperCase()}
                          variant={active ? 'accent' : 'muted'}
                          size="sm"
                          onPress={() => toggleDraft('modifiers', mod)}
                        />
                      );
                    })}
                  </View>
                  <Button
                    title={savingModes ? 'Saving...' : 'Apply Modifier Updates'}
                    variant="secondary"
                    size="sm"
                    style={{ marginTop: spacing.sm }}
                    disabled={savingModes}
                    onPress={() => void saveModeConfig()}
                  />
                  {modesMessage !== '' && (
                    <Text variant="caption" style={{ color: colors.primary, marginTop: 4 }}>
                      {modesMessage}
                    </Text>
                  )}
                </View>
              )}
            </Card>

            {/* Tactical Map Orientation & Heading Lock Setting */}
            <Card
              variant="default"
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
                <Ionicons name="compass-outline" size={18} color={colors.primary} style={{ marginRight: 8 }} />
                <Text variant="label" style={{ color: colors.primary }}>
                  TACTICAL MAP INTERACTION & HEADING LOCK
                </Text>
              </View>
              <Text variant="caption" style={{ color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 }}>
                Locks touch gestures during the round to prevent manual panning/zooming, keeping the operative centered and automatically rotating the map to your phone's physical compass heading.
              </Text>
              {isHost ? (
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Button
                      title={draftLockedMap ? 'LOCKED (COMPASS) ✓' : 'LOCKED (COMPASS)'}
                      variant={draftLockedMap ? 'primary' : 'secondary'}
                      size="sm"
                      style={{ flex: 1 }}
                      onPress={() => {
                        draftTouchedRef.current = true;
                        setDraftLockedMap(true);
                      }}
                    />
                    <Button
                      title={!draftLockedMap ? 'FREE MAP ✓' : 'FREE MAP'}
                      variant={!draftLockedMap ? 'primary' : 'secondary'}
                      size="sm"
                      style={{ flex: 1 }}
                      onPress={() => {
                        draftTouchedRef.current = true;
                        setDraftLockedMap(false);
                      }}
                    />
                  </View>
                  <Button
                    title={savingModes ? 'Saving...' : 'Save Map Orientation Setting'}
                    variant="ghost"
                    size="sm"
                    disabled={savingModes}
                    onPress={() => void saveModeConfig()}
                  />
                </View>
              ) : (
                <Chip
                  label={draftLockedMap ? 'MAP LOCKED · COMPASS HEADING' : 'FREE INTERACTION MAP'}
                  variant={draftLockedMap ? 'accent' : 'muted'}
                  size="sm"
                />
              )}
            </Card>

            {/* Tactical Visibility & Blackout Radar Mode */}
            <Card
              variant="default"
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
                <Ionicons
                  name="radio"
                  size={18}
                  color={draftBlackout ? colors.danger : colors.primary}
                  style={{ marginRight: 8 }}
                />
                <Text variant="label" style={{ color: draftBlackout ? colors.danger : colors.primary }}>
                  TACTICAL VISIBILITY & COMBAT DISPLAY
                </Text>
              </View>
              <Text variant="caption" style={{ color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 }}>
                {draftBlackout
                  ? 'Extreme Blackout Active: Street map tiles are removed. Operatives navigate via 360° radial sonar with operative fixed at center, thermal proximity heat signatures, and vector guide lines to objectives.'
                  : 'Standard street map tiles active.'}
              </Text>
              {isHost ? (
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Button
                      title={!draftBlackout ? 'STANDARD MAP ✓' : 'STANDARD MAP'}
                      variant={!draftBlackout ? 'primary' : 'secondary'}
                      size="sm"
                      style={{ flex: 1 }}
                      onPress={() => {
                        draftTouchedRef.current = true;
                        setDraftBlackout(false);
                      }}
                    />
                    <Button
                      title={draftBlackout ? 'BLACKOUT RADAR ✓' : 'BLACKOUT RADAR'}
                      variant={draftBlackout ? 'danger' : 'secondary'}
                      size="sm"
                      style={{ flex: 1.1 }}
                      onPress={() => {
                        draftTouchedRef.current = true;
                        setDraftBlackout(true);
                      }}
                    />
                  </View>
                  <Button
                    title={savingModes ? 'Saving...' : 'Save Visibility Setting'}
                    variant="ghost"
                    size="sm"
                    disabled={savingModes}
                    onPress={() => void saveModeConfig()}
                  />
                </View>
              ) : (
                <Chip
                  label={draftBlackout ? 'DIFFICULTY: EXTREME · BLACKOUT RADAR' : 'DIFFICULTY: STANDARD MAP'}
                  variant={draftBlackout ? 'accent' : 'muted'}
                  size="sm"
                />
              )}
            </Card>
          </View>
        )}

        {/* ==================== SEGMENT 3: TACTICAL MAP ==================== */}
        {activeSegment === 'map' && (
          <View style={{ marginTop: spacing.md }}>
            <Card
              variant="default"
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
            >
              <Text variant="label" style={{ color: colors.primary, marginBottom: spacing.xs }}>
                OPERATIONAL PERIMETER
              </Text>
              <Text variant="body" style={{ color: colors.text, fontSize: 15 }}>
                Boundary Radius: {formatDistance(state.game.area_radius_m || 500)}
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 4 }}>
                Center Lat/Lng: {Array.isArray(state.game.area_center)
                  ? `${state.game.area_center[1].toFixed(5)}, ${state.game.area_center[0].toFixed(5)}`
                  : state.game.area_center
                    ? `${state.game.area_center.latitude.toFixed(5)}, ${state.game.area_center.longitude.toFixed(5)}`
                    : 'Tactical Center Set'}
              </Text>
            </Card>

            {/* Placements info */}
            {isJailbreak && (
              <Card
                variant="default"
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}
              >
                <View style={styles.placementHeader}>
                  <Text variant="label" style={{ color: colors.warning }}>
                    JAILBREAK FACILITY
                  </Text>
                  <Chip
                    label={jailPlaced ? 'PLACED' : 'REQUIRED'}
                    variant={jailPlaced ? 'accent' : 'danger'}
                    size="sm"
                  />
                </View>
                <Text variant="caption" style={{ color: colors.textMuted, marginTop: 4 }}>
                  {jailPlaced
                    ? `Facility armed at coordinates (${state.game.jail?.latitude.toFixed(4)}, ${state.game.jail?.longitude.toFixed(4)})`
                    : 'The jail facility must be set inside the boundary before the match can launch.'}
                </Text>
                {isHost && !jailPlaced && (
                  <Button
                    title="Set Jail at Boundary Center"
                    variant="primary"
                    size="sm"
                    style={{ marginTop: spacing.sm }}
                    onPress={() => void placeJail()}
                  />
                )}
              </Card>
            )}

            {isRelayHeist && (
              <Card
                variant="default"
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}
              >
                <View style={styles.placementHeader}>
                  <Text variant="label" style={{ color: colors.radarScan }}>
                    EXTRACTION TOUCHDOWN
                  </Text>
                  <Chip
                    label={state.game.extraction ? 'PLACED' : 'STANDBY'}
                    variant={state.game.extraction ? 'accent' : 'muted'}
                    size="sm"
                  />
                </View>
                {isHost && !state.game.extraction && (
                  <Button
                    title="Set Extraction at Boundary Center"
                    variant="secondary"
                    size="sm"
                    style={{ marginTop: spacing.sm }}
                    onPress={() => void placeExtraction()}
                  />
                )}
              </Card>
            )}

            {state.game.mode === 'classic_chase' && (
              <Card
                variant="default"
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}
              >
                <Text variant="label" style={{ color: colors.primary, marginBottom: spacing.xs }}>
                  CLASSIC CHASE TARGET
                </Text>
                <Text variant="caption" style={{ color: colors.textMuted }}>
                  Target coordinates are kept strictly secret and revealed only when the countdown phase initiates.
                </Text>
              </Card>
            )}
          </View>
        )}
      </ScrollView>

      {/* ==================== FIXED BOTTOM ACTION DOCK ==================== */}
      <View
        style={[
          styles.actionDock,
          {
            backgroundColor: colors.surfaceElevated,
            borderTopColor: colors.borderDark,
            paddingBottom: Math.max(insets.bottom, 14) + 6,
            paddingTop: 10,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        {/* Primary Action Buttons Row */}
        <View style={styles.dockPrimaryRow}>
          {!isHost && (
            <Button
              title="Leave"
              variant="ghost"
              size="md"
              disabled={busyAction === 'leave'}
              onPress={() => void handleExitLobby()}
            />
          )}

          <Button
            title={ownPlayer?.is_ready ? 'STAND DOWN' : 'READY UP'}
            variant={ownPlayer?.is_ready ? 'secondary' : 'primary'}
            size="md"
            style={{ flex: 1 }}
            onPress={() => void toggleReady()}
          />

          {isHost && (
            state.game.mode === 'classic_chase' ? (
              <Button
                title={busyAction === 'start' ? 'Starting...' : 'Target Select'}
                variant="primary"
                size="md"
                style={{ flex: 1.2 }}
                disabled={!canStart || !everyoneReady || busyAction !== ''}
                onPress={() => void continueLobby()}
              />
            ) : (
              <Button
                title={busyAction === 'start' ? 'Launching...' : 'Launch Round'}
                variant="primary"
                size="md"
                style={{ flex: 1.2 }}
                disabled={!canStart || !everyoneReady || busyAction !== ''}
                onPress={() => void startRound()}
              />
            )
          )}
        </View>

        {/* Status hint below dock buttons */}
        <View style={styles.dockStatusRow}>
          {!everyoneReady && (
            <Text variant="caption" style={{ color: colors.textMuted, fontSize: 11 }}>
              {activePlayers.filter((p) => !p.is_ready).length} operative(s) awaiting ready status
            </Text>
          )}
          {everyoneReady && canStart && (
            <Text variant="caption" style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>
              ALL OPERATIVES READY · READY TO ENGAGE
            </Text>
          )}
          {!canStart && isHost && (
            <Text variant="caption" style={{ color: colors.warning, fontSize: 11 }}>
              {!hasBothTeams ? 'Teams require at least 1 Runner & 1 Hunter' : 'Deploy jail facility in Tactical Area'}
            </Text>
          )}
        </View>
      </View>

      <ReadyCheckModal
        visible={readyCheckVisible}
        report={healthReport}
        isProbing={isProbingHealth}
        onRetest={() => void handleRunDiagnostic()}
        onConfirmReady={() => void confirmReadyFromCheck()}
        onClose={() => setReadyCheckVisible(false)}
      />

      <LobbyInviteModal
        visible={inviteModalVisible}
        code={state?.game.code || ''}
        modeName={activeModule?.name}
        modeId={state?.game.mode_id}
        playerCount={state?.players.length}
        onClose={() => setInviteModalVisible(false)}
      />
    </View>
  );
}

function PlayerRow({
  player,
  isHost,
  isSelf,
  isGameHost,
  kickingId,
  colors,
  radii,
  onStartKick,
  onConfirmKick,
  onCancelKick,
  onToggleRemote,
}: {
  player: LobbyPlayer;
  isHost: boolean;
  isSelf: boolean;
  isGameHost: boolean;
  kickingId: string | null;
  colors: any;
  radii: any;
  onStartKick: (id: string) => void;
  onConfirmKick: () => void;
  onCancelKick: () => void;
  onToggleRemote?: () => void;
}) {
  const isKickingThis = kickingId === player.id;

  return (
    <Card
      variant="default"
      style={[
        styles.playerRow,
        {
          backgroundColor: isSelf ? colors.surfaceElevated : colors.surface,
          borderColor: isSelf ? colors.borderAccent : colors.borderDark,
        },
      ]}
    >
      <View style={styles.playerInfo}>
        <View style={[styles.avatarDot, { backgroundColor: player.color || colors.primary, borderRadius: radii.pill }]} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={styles.nameRow}>
            <Text variant="title" style={{ color: colors.text, fontSize: 15 }}>
              {player.display_name} {isSelf && '(YOU)'}
            </Text>
            {isGameHost && (
              <MaterialCommunityIcons name="crown" size={16} color={colors.warning} style={{ marginLeft: 4 }} />
            )}
          </View>
          {player.is_remote && (
            <Text variant="caption" style={{ color: colors.radarScan }}>
              REMOTE OPERATIVE
            </Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {player.tracking_health && player.tracking_health !== 'unknown' && (
            <View
              accessibilityLabel={`Tracking health: ${player.tracking_health}`}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor:
                  player.tracking_health === 'healthy'
                    ? colors.primary
                    : player.tracking_health === 'warning'
                      ? '#FFB800'
                      : '#FF3B30',
              }}
            />
          )}
          <Chip
            label={player.is_ready ? 'READY' : 'PREPARING'}
            variant={player.is_ready ? 'accent' : 'muted'}
            size="sm"
          />
        </View>
      </View>

      {isHost && !isSelf && (
        <View style={[styles.playerActionsRow, { borderTopWidth: 1, borderTopColor: colors.borderDark }]}>
          {onToggleRemote && (
            <Button
              title={player.is_remote ? 'Revoke Remote' : 'Make Remote'}
              variant="ghost"
              size="sm"
              onPress={onToggleRemote}
            />
          )}

          {!isKickingThis ? (
            <Button
              title="Kick"
              variant="danger"
              size="sm"
              onPress={() => onStartKick(player.id)}
            />
          ) : (
            <View style={styles.confirmKickRow}>
              <Text variant="caption" style={{ color: colors.danger, marginRight: 6 }}>
                Kick {player.display_name}?
              </Text>
              <Button title="Yes" variant="danger" size="sm" onPress={onConfirmKick} />
              <Button title="No" variant="secondary" size="sm" onPress={onCancelKick} />
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    paddingBottom: 48,
  },
  topNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  exitIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statusChipWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  statusPulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  missionCodeCard: {
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  missionCodeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  missionCodeLeft: {
    flex: 1,
  },
  missionCodeCaption: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
  },
  missionCodeValue: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 3,
  },
  missionCodeActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  shareActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  shareActionText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  warningAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 69, 58, 0.25)',
  },
  warningAlertText: {
    color: '#FF6961',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  quickBarRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  quickPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  squadArenaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  squadColumnCard: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 120,
  },
  squadColHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  squadColDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  squadColTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  squadJoinButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  squadJoinText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  squadEmptyText: {
    color: '#636366',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 12,
  },
  miniPlayerCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    gap: 6,
    marginBottom: 4,
  },
  miniPlayerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniAvatarDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  miniPlayerName: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  miniPlayerBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  miniLeaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  miniLeaveText: {
    color: '#8E8E93',
    fontSize: 9,
    fontWeight: '700',
  },
  unassignedCard: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  unassignedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  unassignedTitle: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  unassignedEmptyText: {
    color: '#636366',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 2,
  },
  unassignedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  unassignedRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  unassignedRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unassignedRowName: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  quickJoinRow: {
    flexDirection: 'row',
    gap: 4,
  },
  quickJoinBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  quickJoinText: {
    fontSize: 9,
    fontWeight: '800',
  },
  hostControlsCard: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  hostControlsLabel: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  hostControlsButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  teamCard: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  teamCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  teamTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  teamDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  myTeamBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  codeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  bannerCard: {
    padding: 12,
    borderWidth: 1,
  },
  shareSheetCard: {
    padding: 14,
    borderWidth: 1,
  },
  shareActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  card: {
    padding: 16,
    borderWidth: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  hostModBox: {
    paddingTop: 12,
    borderTopWidth: 1,
  },
  actionSection: {
    gap: 12,
  },
  playerRow: {
    padding: 10,
    borderWidth: 1,
    marginBottom: 0,
  },
  playerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarDot: {
    width: 24,
    height: 24,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playerActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
  },
  confirmKickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  placementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    zIndex: 100,
  },
  dockPrimaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dockStatusRow: {
    alignItems: 'center',
    marginTop: 6,
  },
  sensorCheckPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
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
import { MatchDurationTimeline } from '../../src/ui/MatchDurationTimeline';
import { AreaCompatibilityBadge } from '../../src/ui/AreaCompatibilityBadge';
import { TacticalDivider } from '../../src/ui/TacticalDivider';
import { TacticalMetricChip } from '../../src/ui/TacticalMetricChip';
import { getModeModule } from '../../src/modes/registry';
import { useUnits } from '../../src/utils/units';
import { supabase } from '../../src/lib/supabase';
import { ReadyCheckModal } from '../../src/components/ReadyCheckModal';
import { LobbyInviteModal } from '../../src/components/LobbyInviteModal';
import { LobbyExitConfirmModal } from '../../src/components/LobbyExitConfirmModal';
import { LobbyPrivacyModal } from '../../src/components/LobbyPrivacyModal';
import { triggerHaptic } from '../../src/motion/haptics';
import { buildInvitePayload } from '../../src/lib/invite';
import { pregenerateQrUri } from '../../src/lib/qrCache';
import { OperativeProfileModal } from '../../src/components/OperativeProfileModal';
import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, type CameraRef } from '../../src/lib/map';
import { circleRing } from '../../src/lib/geo';
import { getInstantLocation } from '../../src/lib/locationCache';
import {
  runTrackingHealthDiagnostic,
  type TrackingHealthReport,
} from '../../src/lib/trackingHealth';

const DARK_MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_DARK_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';

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

  const { width: screenWidth } = useWindowDimensions();
  const pagerRef = useRef<any>(null);
  const [activeSegment, setActiveSegment] = useState<'roster' | 'rules' | 'map'>('roster');
  const [exitConfirmModalVisible, setExitConfirmModalVisible] = useState(false);
  const [privacyModalVisible, setPrivacyModalVisible] = useState(false);
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

  // Operative Profile Modal state
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [inspectedUserId, setInspectedUserId] = useState<string | null>(null);
  const [inspectedUserName, setInspectedUserName] = useState<string | undefined>(undefined);
  const [inspectedUserColor, setInspectedUserColor] = useState<string | undefined>(undefined);

  const handleInspectPlayer = (targetId: string, name?: string, color?: string) => {
    triggerHaptic('buttonTap');
    setInspectedUserId(targetId);
    setInspectedUserName(name);
    setInspectedUserColor(color);
    setProfileModalVisible(true);
  };

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

  const activeModule = getModeModule(state?.game.mode_id || 'classic_chase');

  // Eagerly pregenerate QR Code in memory so modal opens with 0ms delay
  useEffect(() => {
    if (state?.game?.code) {
      const payload = buildInvitePayload({
        code: state.game.code,
        modeId: state.game.mode_id,
        modeName: activeModule?.name,
        playerCount: activePlayers.length,
      });
      void pregenerateQrUri(payload.webLink);
    }
  }, [state?.game?.code, state?.game?.mode_id, activePlayers.length, activeModule?.name]);

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

  const cameraRef = useRef<CameraRef>(null);
  const [mapZoom, setMapZoom] = useState(14.2);

  const centerCoords = useMemo<[number, number]>(() => {
    if (state?.game?.area_center) {
      if (Array.isArray(state.game.area_center)) {
        return [state.game.area_center[0], state.game.area_center[1]];
      }
      if (typeof state.game.area_center === 'object') {
        return [state.game.area_center.longitude, state.game.area_center.latitude];
      }
    }
    const instant = getInstantLocation();
    if (instant) return instant;
    return [0, 0];
  }, [state?.game?.area_center]);

  const boundaryGeoJSON = useMemo(() => {
    return circleRing(
      { longitude: centerCoords[0], latitude: centerCoords[1] },
      state?.game?.area_radius_m || 500,
    );
  }, [centerCoords, state?.game?.area_radius_m]);

  const targetCoords = useMemo<[number, number]>(() => {
    if (state?.game?.extraction) {
      return [state.game.extraction.longitude, state.game.extraction.latitude];
    }
    return [centerCoords[0] + 0.0018, centerCoords[1] + 0.0012];
  }, [state?.game?.extraction, centerCoords]);

  const targetGeoJSON = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Point' as const,
            coordinates: targetCoords,
          },
        },
      ],
    };
  }, [targetCoords]);

  const youCoords = useMemo<[number, number]>(() => {
    const instant = getInstantLocation();
    if (instant) return instant;
    return [centerCoords[0] - 0.0012, centerCoords[1] - 0.001];
  }, [centerCoords]);

  const youGeoJSON = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Point' as const,
            coordinates: youCoords,
          },
        },
      ],
    };
  }, [youCoords]);

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
    triggerHaptic('buttonTap');
    setExitConfirmModalVisible(true);
  }

  function handleConfirmExit() {
    setExitConfirmModalVisible(false);
    if (isHost) {
      void cancelGame();
    } else {
      void leaveLobby();
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
    triggerHaptic('buttonTap');
    setPrivacyModalVisible(true);
  }

  function handleSelectPrivacyOption(share: boolean) {
    setPrivacyModalVisible(false);
    void chooseShare(share);
  }

  const TAB_SEGMENTS: Array<'roster' | 'rules' | 'map'> = ['roster', 'rules', 'map'];

  function handleTabPress(segment: 'roster' | 'rules' | 'map') {
    triggerHaptic('buttonTap');
    setActiveSegment(segment);
    const index = TAB_SEGMENTS.indexOf(segment);
    if (index !== -1 && pagerRef.current) {
      pagerRef.current.scrollTo({ x: index * screenWidth, animated: true });
    }
  }

  function handlePagerScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const offsetX = e.nativeEvent.contentOffset.x;
    const pageIndex = Math.round(offsetX / screenWidth);
    const safeIndex = Math.max(0, Math.min(TAB_SEGMENTS.length - 1, pageIndex));
    const nextSegment = TAB_SEGMENTS[safeIndex];
    if (nextSegment && nextSegment !== activeSegment) {
      triggerHaptic('buttonTap');
      setActiveSegment(nextSegment);
    }
  }

  function handleScrollEndDrag(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (Math.abs(e.nativeEvent.velocity?.x || 0) < 0.1) {
      const offsetX = e.nativeEvent.contentOffset.x;
      const pageIndex = Math.round(offsetX / screenWidth);
      const safeIndex = Math.max(0, Math.min(TAB_SEGMENTS.length - 1, pageIndex));
      const nextSegment = TAB_SEGMENTS[safeIndex];
      if (nextSegment && nextSegment !== activeSegment) {
        triggerHaptic('buttonTap');
        setActiveSegment(nextSegment);
      }
    }
  }

  const ownPlayer = state.players.find((p) => p.id === state.my_player_id);
  const runners = activePlayers.filter((p) => p.team === 'runner');
  const hunters = activePlayers.filter((p) => p.team === 'hunter');
  const unassigned = activePlayers.filter((p) => p.team === 'unassigned');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* FIXED TOP HEADER */}
      <View
        style={[
          styles.fixedTopHeader,
          {
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingHorizontal: spacing.lg,
          },
        ]}
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

        {/* Mission Code Bar (Chunky Squircle Tactical Card with Breathing Room) */}
        <View
          style={[
            styles.compactCodeBar,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.borderDark,
            },
          ]}
        >
          <Pressable
            onPress={() => void shareCode()}
            style={styles.codeTextContainer}
            accessibilityRole="button"
            accessibilityLabel={`Room code ${state.game.code}`}
          >
            <Text style={[styles.codeLabelPrefix, { color: colors.textMuted }]}>CODE: </Text>
            <Text style={[styles.codeValueBold, { color: colors.text }]}>{state.game.code}</Text>
          </Pressable>

          <View style={styles.codeIconButtons}>
            <TacticalMetricChip
              icon="share-outline"
              value="SHARE"
              size="sm"
              variant="muted"
              onPress={() => void shareCode()}
            />
            <TacticalMetricChip
              icon="qr-code-outline"
              value="QR"
              size="sm"
              variant="accent"
              onPress={() => setInviteModalVisible(true)}
            />
          </View>
        </View>

        <TacticalDivider variant="dashed" style={{ marginVertical: 6 }} />

        {activePlayers.length < 2 && !isSoloMode && (
          <View style={styles.warningAlertRow}>
            <Ionicons name="warning-outline" size={14} color={colors.warning} />
            <Text style={styles.warningAlertText}>
              At least 2 players needed to assign teams.
            </Text>
          </View>
        )}

        {bannerMessage !== '' && (
          <Card
            variant="elevated"
            style={[styles.bannerCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.warning, marginTop: 6 }]}
          >
            <Text variant="body" style={{ color: colors.warning, fontSize: 13 }}>
              {bannerMessage}
            </Text>
          </Card>
        )}

        {errorMessage !== '' && (
          <Card
            variant="elevated"
            style={[styles.bannerCard, { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder, marginTop: 6 }]}
          >
            <Text variant="body" style={{ color: colors.dangerText, fontSize: 13 }}>
              {errorMessage}
            </Text>
          </Card>
        )}

        {/* Underline Tab Bar (ROSTER | RULES | AREA) */}
        <View style={styles.underlineTabBar}>
          {[
            { id: 'roster' as const, label: `ROSTER (${activePlayers.length})` },
            { id: 'rules' as const, label: 'RULES' },
            { id: 'map' as const, label: 'AREA' },
          ].map((tab) => {
            const isActive = activeSegment === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => handleTabPress(tab.id)}
                style={styles.underlineTabItem}
              >
                <Text
                  variant="label"
                  weight="bold"
                  style={[
                    styles.underlineTabText,
                    { color: isActive ? colors.accent : colors.textMuted },
                  ]}
                >
                  {tab.label}
                </Text>
                {isActive && <View style={[styles.activeUnderlineBar, { backgroundColor: colors.accent }]} />}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* HORIZONTAL SWIPABLE PAGER */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        scrollEventThrottle={16}
        onMomentumScrollEnd={handlePagerScrollEnd}
        onScrollEndDrag={handleScrollEndDrag}
        style={styles.horizontalPager}
      >
        {/* ==================== PAGE 1: ROSTER ==================== */}
        <View style={{ width: screenWidth, flex: 1 }}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            contentContainerStyle={[
              styles.tabContentScroll,
              {
                paddingHorizontal: spacing.lg,
                paddingBottom: Math.max(insets.bottom, 12) + 120,
              },
            ]}
          >
            <View style={{ gap: 8 }}>
            {/* Quick Status Row: 🔒 Privacy: Keep Private • 📡 GPS Ready */}
            <View style={styles.quickStatusRow}>
              <Pressable
                onPress={handleTogglePrivacy}
                style={styles.quickStatusItem}
                accessibilityRole="button"
                accessibilityLabel="Configure route privacy"
              >
                <Ionicons
                  name={shareChoice === true ? 'eye-outline' : 'lock-closed-outline'}
                  size={13}
                  color={shareChoice === true ? colors.accent : '#8E8E93'}
                />
                <Text style={styles.quickStatusText}>
                  Privacy: <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{shareChoice === true ? 'Shared' : 'Keep Private'}</Text>
                </Text>
              </Pressable>

              <Text style={styles.quickStatusDot}>•</Text>

              <Pressable
                onPress={() => {
                  setReadyCheckVisible(true);
                  void handleRunDiagnostic();
                }}
                style={styles.quickStatusItem}
                accessibilityRole="button"
                accessibilityLabel="Check Sensors and GPS"
              >
                <Ionicons
                  name={healthReport?.overall === 'healthy' ? 'radio' : 'radio-outline'}
                  size={13}
                  color={healthReport?.overall === 'healthy' ? colors.accent : '#8E8E93'}
                />
                <Text style={styles.quickStatusText}>
                  <Text style={{ color: healthReport?.overall === 'healthy' ? colors.accent : '#FFFFFF', fontWeight: '700' }}>
                    GPS Ready
                  </Text>
                </Text>
              </Pressable>
            </View>

            {isSoloMode ? (
              <View>
                <TacticalDivider
                  label="SOLO ROSTER"
                  sublabel={`${activePlayers.length} OPERATIVES`}
                  variant="bracket"
                  style={{ marginVertical: 8 }}
                />
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
                    onInspectPlayer={handleInspectPlayer}
                  />
                ))}
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {/* Squad Arena: Side-by-Side Runners vs Hunters */}
                <TacticalDivider
                  label="SQUAD ARENA"
                  sublabel="PVP REAL-WORLD"
                  variant="bracket"
                  style={{ marginVertical: 8 }}
                />
                <View style={styles.squadArenaRow}>
                  {/* RUNNERS COLUMN */}
                  <View
                    style={[
                      styles.squadColumnCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: ownPlayer?.team === 'runner' ? colors.runner : colors.borderDark,
                      },
                    ]}
                  >
                    <View style={styles.squadColHeader}>
                      <TacticalMetricChip
                        icon="walk"
                        value={runners.length}
                        label="RUNNERS"
                        variant="runner"
                        size="sm"
                      />
                    </View>

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
                                styles.squadPlayerBox,
                                {
                                  backgroundColor: isSelf ? colors.surfaceElevated : 'transparent',
                                  borderColor: isSelf ? colors.runner : colors.borderDark,
                                },
                              ]}
                            >
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => {
                                  if (!isSelf && p.user_id) {
                                    handleInspectPlayer(p.user_id, p.display_name, p.color);
                                  }
                                }}
                                style={styles.squadPlayerHeader}
                              >
                                <View style={[styles.avatarDotSmall, { backgroundColor: p.color || colors.warning }]} />
                                <Text style={styles.squadPlayerName} numberOfLines={1}>
                                  {p.display_name} {isSelf ? '(YOU)' : ''}
                                </Text>
                                {!isSelf && (
                                  <Ionicons name="person-circle-outline" size={13} color={colors.textMuted} style={{ marginLeft: 3 }} />
                                )}
                              </Pressable>
                              <Text style={styles.squadPlayerStatus}>
                                {p.is_ready ? 'Ready' : 'Preparing'}
                              </Text>
                              {isSelf && (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="Leave Runners squad"
                                  onPress={() => void setTeam(ownPlayer!, 'unassigned')}
                                  style={styles.squadLeaveBtn}
                                >
                                  <Ionicons name="exit-outline" size={12} color={colors.textMuted} />
                                  <Text style={styles.squadLeaveText}>Leave</Text>
                                </Pressable>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {ownPlayer?.team !== 'runner' && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Join Runners squad"
                        onPress={() => ownPlayer && void setTeam(ownPlayer, 'runner')}
                        style={[styles.squadColJoinBtn, { borderColor: colors.runner }]}
                      >
                        <Text style={[styles.squadColJoinText, { color: colors.runner }]}>JOIN</Text>
                      </Pressable>
                    )}
                  </View>

                  {/* HUNTERS COLUMN */}
                  <View
                    style={[
                      styles.squadColumnCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: ownPlayer?.team === 'hunter' ? colors.hunter : colors.borderDark,
                      },
                    ]}
                  >
                    <View style={styles.squadColHeader}>
                      <TacticalMetricChip
                        icon="skull-outline"
                        value={hunters.length}
                        label="HUNTERS"
                        variant="hunter"
                        size="sm"
                      />
                    </View>

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
                                styles.squadPlayerBox,
                                {
                                  backgroundColor: isSelf ? colors.surfaceElevated : 'transparent',
                                  borderColor: isSelf ? colors.hunter : colors.borderDark,
                                },
                              ]}
                            >
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => {
                                  if (!isSelf && p.user_id) {
                                    handleInspectPlayer(p.user_id, p.display_name, p.color);
                                  }
                                }}
                                style={styles.squadPlayerHeader}
                              >
                                <View style={[styles.avatarDotSmall, { backgroundColor: p.color || colors.hunter }]} />
                                <Text style={styles.squadPlayerName} numberOfLines={1}>
                                  {p.display_name} {isSelf ? '(YOU)' : ''}
                                </Text>
                                {!isSelf && (
                                  <Ionicons name="person-circle-outline" size={13} color={colors.textMuted} style={{ marginLeft: 3 }} />
                                )}
                              </Pressable>
                              <Text style={styles.squadPlayerStatus}>
                                {p.is_ready ? 'Ready' : 'Preparing'}
                              </Text>
                              {isSelf && (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="Leave Hunters squad"
                                  onPress={() => void setTeam(ownPlayer!, 'unassigned')}
                                  style={styles.squadLeaveBtn}
                                >
                                  <Ionicons name="exit-outline" size={12} color={colors.textMuted} />
                                  <Text style={styles.squadLeaveText}>Leave</Text>
                                </Pressable>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {ownPlayer?.team !== 'hunter' && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Join Hunters squad"
                        onPress={() => ownPlayer && void setTeam(ownPlayer, 'hunter')}
                        style={[styles.squadColJoinBtn, { borderColor: colors.hunter }]}
                      >
                        <Text style={[styles.squadColJoinText, { color: colors.hunter }]}>JOIN</Text>
                      </Pressable>
                    )}
                  </View>
                </View>

                {/* Unassigned Operatives Card (Only rendered if operatives are unassigned) */}
                {unassigned.length > 0 && (
                  <Card
                    variant="default"
                    style={[
                      styles.unassignedCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.borderDark,
                      },
                    ]}
                  >
                    <View style={styles.unassignedHeader}>
                      <Ionicons name="people-outline" size={15} color={colors.textMuted} />
                      <Text style={styles.unassignedTitle}>
                        UNASSIGNED OPERATIVES ({unassigned.length})
                      </Text>
                    </View>

                    <View style={{ gap: 8, marginTop: 4 }}>
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
                            <View style={styles.unassignedRowTop}>
                              <View style={styles.unassignedRowLeft}>
                                <View style={[styles.avatarDotSmall, { backgroundColor: p.color || colors.primary }]} />
                                <Text style={styles.unassignedRowName} numberOfLines={1}>
                                  {p.display_name} {isSelf ? '(YOU)' : ''}
                                </Text>
                                {p.user_id === state.game.host_id && (
                                  <MaterialCommunityIcons name="crown" size={14} color={colors.warning} style={{ marginLeft: 4 }} />
                                )}
                              </View>
                              <Chip
                                label={p.is_ready ? 'READY' : 'PREPARING'}
                                variant={p.is_ready ? 'accent' : 'muted'}
                                size="sm"
                              />
                            </View>

                            {isSelf && (
                              <View style={styles.unassignedJoinButtonsRow}>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="Join Runners"
                                  onPress={() => void setTeam(ownPlayer!, 'runner')}
                                  style={[styles.unassignedJoinBtn, { borderColor: colors.runner }]}
                                >
                                  <Text style={[styles.unassignedJoinText, { color: colors.runner }]}>JOIN RUNNERS</Text>
                                </Pressable>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="Join Hunters"
                                  onPress={() => void setTeam(ownPlayer!, 'hunter')}
                                  style={[styles.unassignedJoinBtn, { borderColor: colors.hunter }]}
                                >
                                  <Text style={[styles.unassignedJoinText, { color: colors.hunter }]}>JOIN HUNTERS</Text>
                                </Pressable>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </Card>
                )}

                {/* Host Squad Controls Card */}
                {isHost && !isSoloMode && (
                  <View
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
                        title="ROTATE ROLES"
                        variant="secondary"
                        size="sm"
                        style={{ flex: 1 }}
                        disabled={activePlayers.length < 2 || busyAction === 'rotate'}
                        onPress={() => void rotateRoles()}
                      />
                      <Button
                        title="SHUFFLE SQUADS"
                        variant="secondary"
                        size="sm"
                        style={{ flex: 1 }}
                        disabled={activePlayers.length < 2 || busyAction === 'randomize'}
                        onPress={() => void randomizeTeams()}
                      />
                    </View>
                  </View>
                )}
              </View>
            )}
            </View>
          </ScrollView>
        </View>

        {/* ==================== PAGE 2: RULES ==================== */}
        <View style={{ width: screenWidth, flex: 1 }}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            contentContainerStyle={[
              styles.tabContentScroll,
              {
                paddingHorizontal: spacing.lg,
                paddingBottom: Math.max(insets.bottom, 12) + 120,
              },
            ]}
          >
            <View style={{ gap: 12, marginTop: 4 }}>
            {/* GAME MODE CARD */}
            <View style={[styles.rulesSectionCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
              <Text style={styles.rulesCardCaption}>GAME MODE</Text>
              <View style={styles.modeTitleRow}>
                <View style={[styles.modeIconSquare, { backgroundColor: colors.surfaceElevated }]}>
                  <Ionicons name="map-outline" size={20} color={colors.accent} />
                </View>
                <Text style={styles.modeTitleText}>
                  {activeModule?.name || 'Classic Chase'}
                </Text>
              </View>
              <Text style={styles.modeDescriptionText}>
                {activeModule?.rules?.summary ||
                  activeModule?.tagline ||
                  'One runner team infiltrates to reach a secret extraction target or survive the clock. Hunters must track, corner, and physically tag them.'}
              </Text>
            </View>

            {/* TACTICAL RULES CARD */}
            <View style={[styles.rulesSectionCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
              <Text style={styles.rulesCardCaption}>TACTICAL RULES</Text>

              {/* 3-Segment Timeline Formula (Start > Play > End) */}
              <MatchDurationTimeline
                headStartS={((state.game.mode_params as any)?.head_start_seconds || 90)}
                durationMinutes={((state.game.mode_params as any)?.time_limit_minutes || 15)}
                regroupMinutes={2}
              />

              {/* Area & Duration Compatibility Badge */}
              <AreaCompatibilityBadge
                radiusM={state.game.area_radius_m || 500}
                durationMinutes={((state.game.mode_params as any)?.time_limit_minutes || 15)}
                showDetail
              />

              <View style={styles.tacticalRulesList}>
                {/* Game Duration */}
                <View style={styles.tacticalRuleRow}>
                  <View style={styles.ruleIconCircle}>
                    <Ionicons name="time-outline" size={18} color="#A1A1AA" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ruleTitle}>Game Duration</Text>
                    <Text style={styles.ruleSubtext}>
                      {((state.game.mode_params as any)?.time_limit_minutes || 15)} mins
                    </Text>
                  </View>
                </View>

                {/* Head Start */}
                <View style={styles.tacticalRuleRow}>
                  <View style={styles.ruleIconCircle}>
                    <Ionicons name="walk-outline" size={18} color="#A1A1AA" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ruleTitle}>Head Start</Text>
                    <Text style={styles.ruleSubtext}>
                      {((state.game.mode_params as any)?.head_start_seconds || 90)}s countdown for Runners to scatter before Hunters release
                    </Text>
                  </View>
                </View>

                {/* Radar Pings */}
                <View style={styles.tacticalRuleRow}>
                  <View style={styles.ruleIconCircle}>
                    <Ionicons name="radio-outline" size={18} color="#A1A1AA" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ruleTitle}>Radar Pings</Text>
                    <Text style={styles.ruleSubtext}>
                      Server broadcasts a delayed location pulse every {((state.game.mode_params as any)?.ping_interval_seconds || 45)}s (visible for {((state.game.mode_params as any)?.ping_duration_seconds || 10)}s only). Expect haptic pulse when it fires.
                    </Text>
                  </View>
                </View>

                {/* Victory Conditions */}
                <View style={styles.tacticalRuleRow}>
                  <View style={styles.ruleIconCircle}>
                    <Ionicons name="locate-outline" size={18} color="#A1A1AA" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ruleTitle}>Victory Conditions</Text>
                    <Text style={styles.ruleSubtext}>
                      {state.game.mode_id === 'jailbreak'
                        ? 'Runners win by freeing captured teammates and evading capture. Hunters win by securing all Runners in the jail facility.'
                        : 'Runners win by reaching the secret extraction point undetected. Hunters win if all Runners are tagged, or time expires.'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* SAFETY & FAIR PLAY ALERT CARD */}
            <View style={[styles.safetyCard, { backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.3)' }]}>
              <View style={styles.safetyHeader}>
                <Ionicons name="warning-outline" size={15} color="#F87171" style={{ marginRight: 6 }} />
                <Text style={styles.safetyTitle}>SAFETY & FAIR PLAY</Text>
              </View>
              <Text style={styles.safetyBody}>
                Play in pedestrian-friendly public spaces only. Respect private property. Check the SOS button in active game HUD for emergencies.
              </Text>
            </View>

            {/* Private Role Briefing Card (if assigned) */}
            {mySecretRole && (
              <RoleBriefingCard
                roleId={mySecretRole || ownPlayer?.team || 'runner'}
                team={ownPlayer?.team}
                acknowledged={roleAcknowledged}
                onToggleAcknowledge={setRoleAcknowledged}
              />
            )}

            {/* Host Modifiers Management (For Host) */}
            {isHost && (
              <Card
                variant="default"
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
              >
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
              </Card>
            )}
            </View>
          </ScrollView>
        </View>

        {/* ==================== PAGE 3: AREA ==================== */}
        <View style={{ width: screenWidth, flex: 1 }}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            contentContainerStyle={[
              styles.tabContentScroll,
              {
                paddingHorizontal: spacing.lg,
                paddingBottom: Math.max(insets.bottom, 12) + 120,
              },
            ]}
          >
            <View style={{ gap: 12, marginTop: 4 }}>
              {/* EMBEDDED INTERACTIVE MAP PREVIEW CARD */}
              <View style={[styles.mapContainerCard, { borderColor: 'rgba(167, 139, 250, 0.4)' }]}>
                <MapLibreMap
                  style={StyleSheet.absoluteFill}
                  mapStyle={DARK_MAP_STYLE}
                  compass={false}
                  logo={false}
                  attribution={false}
                  dragPan={false}
                  touchRotate={false}
                  touchPitch={false}
                >
                <Camera
                  ref={cameraRef}
                  initialViewState={{ center: centerCoords, zoom: mapZoom }}
                />

                {/* Boundary Geofence Circle */}
                <GeoJSONSource id="lobby-boundary" data={boundaryGeoJSON}>
                  <Layer
                    id="lobby-boundary-fill"
                    type="fill"
                    paint={{
                      'fill-color': '#8B5CF6',
                      'fill-opacity': 0.08,
                    }}
                  />
                  <Layer
                    id="lobby-boundary-line"
                    type="line"
                    paint={{
                      'line-color': '#A78BFA',
                      'line-width': 2.5,
                      'line-opacity': 0.85,
                    }}
                  />
                </GeoJSONSource>

                {/* Extraction Target Concentric Rings */}
                <GeoJSONSource id="lobby-target" data={targetGeoJSON}>
                  <Layer
                    id="lobby-target-outer"
                    type="circle"
                    paint={{
                      'circle-radius': 28,
                      'circle-color': '#A3E635',
                      'circle-opacity': 0.15,
                    }}
                  />
                  <Layer
                    id="lobby-target-ring"
                    type="circle"
                    paint={{
                      'circle-radius': 18,
                      'circle-color': '#A3E635',
                      'circle-opacity': 0.35,
                      'circle-stroke-width': 2,
                      'circle-stroke-color': '#A3E635',
                    }}
                  />
                  <Layer
                    id="lobby-target-core"
                    type="circle"
                    paint={{
                      'circle-radius': 7,
                      'circle-color': '#A3E635',
                    }}
                  />
                </GeoJSONSource>

                {/* Operative YOU Marker */}
                <GeoJSONSource id="lobby-you" data={youGeoJSON}>
                  <Layer
                    id="lobby-you-halo"
                    type="circle"
                    paint={{
                      'circle-radius': 18,
                      'circle-color': '#A78BFA',
                      'circle-opacity': 0.3,
                    }}
                  />
                  <Layer
                    id="lobby-you-core"
                    type="circle"
                    paint={{
                      'circle-radius': 8,
                      'circle-color': '#A78BFA',
                      'circle-stroke-width': 2,
                      'circle-stroke-color': '#FFFFFF',
                    }}
                  />
                </GeoJSONSource>
              </MapLibreMap>

              {/* Floating Badges on Map */}
              <View style={styles.mapPlayAreaBadge}>
                <Text style={styles.mapPlayAreaBadgeText}>
                  PLAY AREA ({formatDistance(state.game.area_radius_m || 500)})
                </Text>
              </View>

              {/* Map Zoom Controls (+ / -) */}
              <View style={styles.mapZoomControls}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Zoom In"
                  onPress={() => {
                    const next = Math.min(mapZoom + 1, 18);
                    setMapZoom(next);
                    cameraRef.current?.easeTo({ center: centerCoords, zoom: next, duration: 250 });
                  }}
                  style={styles.mapZoomBtn}
                >
                  <Ionicons name="add" size={18} color="#FFFFFF" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Zoom Out"
                  onPress={() => {
                    const next = Math.max(mapZoom - 1, 10);
                    setMapZoom(next);
                    cameraRef.current?.easeTo({ center: centerCoords, zoom: next, duration: 250 });
                  }}
                  style={styles.mapZoomBtn}
                >
                  <Ionicons name="remove" size={18} color="#FFFFFF" />
                </Pressable>
              </View>

              {/* Re-Center Button */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Re-center Map"
                onPress={() => {
                  cameraRef.current?.easeTo({ center: centerCoords, zoom: 14.5, duration: 300 });
                }}
                style={styles.mapRecenterPill}
              >
                <Ionicons name="search" size={12} color="#FFFFFF" style={{ marginRight: 4 }} />
                <Text style={styles.mapRecenterText}>RE-CENTER</Text>
              </Pressable>
            </View>

            {/* AREA DETAILS CARD */}
            <View style={[styles.areaDetailsCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
              <View style={styles.areaDetailsHeader}>
                <Ionicons name="location-sharp" size={16} color="#EF4444" style={{ marginRight: 6 }} />
                <Text style={styles.areaDetailsHeaderTitle}>PEDESTRIAN PLAY ZONE</Text>
              </View>

              <View style={styles.areaDetailRow}>
                <Ionicons name="earth-outline" size={16} color="#8E8E93" style={styles.areaDetailIcon} />
                <Text style={styles.areaDetailLabel}>Area Radius</Text>
                <Text style={styles.areaDetailValue}>
                  {formatDistance(state.game.area_radius_m || 500)} (Safe pedestrian boundary)
                </Text>
              </View>

              <View style={styles.areaDetailRow}>
                <Ionicons name="key-outline" size={16} color="#8E8E93" style={styles.areaDetailIcon} />
                <Text style={styles.areaDetailLabel}>extraction</Text>
                <Text style={styles.areaDetailValue}>Secret location within boundary</Text>
              </View>

              <View style={styles.areaDetailRow}>
                <Ionicons name="ban-outline" size={16} color="#8E8E93" style={styles.areaDetailIcon} />
                <Text style={styles.areaDetailLabel}>out of bounds</Text>
                <Text style={styles.areaDetailValue}>Stealth penalty triggers after 30s exiting geofence</Text>
              </View>

              {/* Traversal Compatibility Badge */}
              <AreaCompatibilityBadge
                radiusM={state.game.area_radius_m || 500}
                durationMinutes={((state.game.mode_params as any)?.time_limit_minutes || 15)}
                showDetail
                style={{ marginTop: 8 }}
              />

              {isHost && (
                <Button
                  title="CHANGE AREA"
                  variant="secondary"
                  size="sm"
                  icon="location-outline"
                  style={{ marginTop: 12 }}
                  onPress={() => router.push('/host/area' as any)}
                />
              )}
            </View>

            {/* Jailbreak Placement Helper Card */}
            {isJailbreak && (
              <Card
                variant="default"
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
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

            {/* Relay Heist Placement Helper Card */}
            {isRelayHeist && (
              <Card
                variant="default"
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
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
            </View>
          </ScrollView>
        </View>
      </ScrollView>

      {/* ==================== FIXED BOTTOM ACTION DOCK ==================== */}
      <View
        style={[
          styles.actionDock,
          {
            backgroundColor: '#0F0F14',
            borderTopColor: colors.borderDark,
            paddingBottom: Math.max(insets.bottom, 12) + 6,
            paddingTop: 10,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        <View style={styles.dockPrimaryRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              canStart && everyoneReady && isHost
                ? 'Launch mission'
                : ownPlayer?.is_ready
                ? 'Stand down'
                : 'Ready up'
            }
            onPress={() => {
              if (canStart && everyoneReady && isHost) {
                if (state.game.mode === 'classic_chase') {
                  void continueLobby();
                } else {
                  void startRound();
                }
              } else {
                void toggleReady();
              }
            }}
            style={[
              styles.dockReadyBtn,
              {
                backgroundColor:
                  canStart && everyoneReady && isHost
                    ? '#CCFF00'
                    : ownPlayer?.is_ready
                    ? colors.surfaceElevated
                    : '#CCFF00',
              },
            ]}
          >
            <Text
              style={[
                styles.dockReadyBtnText,
                {
                  color:
                    canStart && everyoneReady && isHost
                      ? '#000000'
                      : ownPlayer?.is_ready
                      ? colors.accent
                      : '#000000',
                },
              ]}
            >
              {canStart && everyoneReady && isHost
                ? 'LAUNCH MISSION'
                : ownPlayer?.is_ready
                ? 'STAND DOWN'
                : 'READY UP'}
            </Text>
            {canStart && everyoneReady && isHost && (
              <Ionicons name="rocket-outline" size={16} color="#000000" style={{ marginLeft: 6 }} />
            )}
          </Pressable>
        </View>

        <View style={styles.dockStatusRow}>
          <Text style={styles.dockStatusText}>
            {!everyoneReady
              ? `${activePlayers.filter((p) => !p.is_ready).length} operative(s) awaiting ready status`
              : 'ALL OPERATIVES READY • READY TO ENGAGE'}
          </Text>
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

      <LobbyExitConfirmModal
        visible={exitConfirmModalVisible}
        isHost={isHost}
        onConfirm={handleConfirmExit}
        onCancel={() => setExitConfirmModalVisible(false)}
        busy={busyAction === 'cancel' || busyAction === 'leave'}
      />

      <LobbyPrivacyModal
        visible={privacyModalVisible}
        shareWithCrew={shareChoice === true}
        onSelectOption={handleSelectPrivacyOption}
        onClose={() => setPrivacyModalVisible(false)}
      />

      <OperativeProfileModal
        visible={profileModalVisible}
        targetUserId={inspectedUserId}
        initialName={inspectedUserName}
        initialColor={inspectedUserColor}
        onClose={() => setProfileModalVisible(false)}
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
  onInspectPlayer,
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
  onInspectPlayer?: (targetId: string, name?: string, color?: string) => void;
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
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (!isSelf && player.user_id && onInspectPlayer) {
            onInspectPlayer(player.user_id, player.display_name, player.color);
          }
        }}
        style={styles.playerInfo}
      >
        <View style={[styles.avatarDot, { backgroundColor: player.color || colors.primary, borderRadius: radii.pill }]} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={styles.nameRow}>
            <Text variant="title" style={{ color: colors.text, fontSize: 15 }}>
              {player.display_name} {isSelf && '(YOU)'}
            </Text>
            {isGameHost && (
              <MaterialCommunityIcons name="crown" size={16} color={colors.warning} style={{ marginLeft: 4 }} />
            )}
            {!isSelf && (
              <Ionicons name="person-circle-outline" size={15} color={colors.textMuted} style={{ marginLeft: 4 }} />
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
          <TacticalMetricChip
            value={player.is_ready ? 'READY' : 'PREPARING'}
            variant={player.is_ready ? 'success' : 'muted'}
            size="sm"
          />
        </View>
      </Pressable>

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
  compactCodeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1.5,
    marginTop: 6,
    marginBottom: 6,
  },
  codeTextContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingVertical: 4,
  },
  codeLabelPrefix: {
    color: '#8E8E93',
    fontSize: 13,
    fontFamily: 'Archivo-Bold',
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  codeValueBold: {
    color: '#FFFFFF',
    fontSize: 26,
    fontFamily: 'Archivo-Bold',
    fontWeight: '900',
    letterSpacing: 2.5,
  },
  fixedTopHeader: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: '#0F0F14',
    zIndex: 10,
  },
  horizontalPager: {
    flex: 1,
  },
  tabContentScroll: {
    paddingTop: 10,
  },
  codeIconButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  squareIconButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
  },
  warningAlertText: {
    color: '#FF6961',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  bannerCard: {
    padding: 12,
    borderWidth: 1,
  },
  underlineTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 10,
    marginBottom: 6,
  },
  underlineTabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    position: 'relative',
  },
  underlineTabText: {
    fontSize: 12,
    fontFamily: 'Archivo-Bold',
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  activeUnderlineBar: {
    position: 'absolute',
    bottom: -1,
    left: 8,
    right: 8,
    height: 2.5,
    borderRadius: 2,
  },
  quickStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginVertical: 4,
  },
  quickStatusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  quickStatusText: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '600',
  },
  quickStatusDot: {
    color: '#636366',
    fontSize: 12,
  },
  squadArenaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  squadColumnCard: {
    flex: 1,
    padding: 14,
    borderWidth: 1.5,
    borderRadius: 18,
    minHeight: 140,
    justifyContent: 'space-between',
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
  squadEmptyText: {
    color: '#636366',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 14,
  },
  squadPlayerBox: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 10,
    marginBottom: 6,
    gap: 4,
  },
  squadPlayerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  avatarDotSmall: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  squadPlayerName: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  squadPlayerStatus: {
    color: '#8E8E93',
    fontSize: 10,
    marginLeft: 16,
  },
  squadLeaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3F3F46',
    backgroundColor: '#1F1F24',
    marginTop: 4,
  },
  squadLeaveText: {
    color: '#D4D4D8',
    fontSize: 10,
    fontWeight: '700',
  },
  squadColJoinBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  squadColJoinText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
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
  unassignedRow: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  unassignedRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  unassignedRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  unassignedRowName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  unassignedJoinButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  unassignedJoinBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1A22',
  },
  unassignedJoinText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
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
  rulesSectionCard: {
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  rulesCardCaption: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  modeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modeIconSquare: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTitleText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  modeDescriptionText: {
    color: '#A1A1AA',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  tacticalRulesList: {
    gap: 12,
    marginTop: 4,
  },
  tacticalRuleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  ruleIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1F1F24',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  ruleTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  ruleSubtext: {
    color: '#A1A1AA',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  safetyCard: {
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  safetyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  safetyTitle: {
    color: '#F87171',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  safetyBody: {
    color: '#FCA5A5',
    fontSize: 11,
    lineHeight: 16,
  },
  mapContainerCard: {
    height: 280,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    backgroundColor: '#0B0B0E',
    position: 'relative',
  },
  mapPlayAreaBadge: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(20, 20, 26, 0.85)',
    borderWidth: 1,
    borderColor: '#A78BFA',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  mapPlayAreaBadgeText: {
    color: '#A78BFA',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  mapZoomControls: {
    position: 'absolute',
    right: 12,
    top: 90,
    gap: 4,
  },
  mapZoomBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: 'rgba(26, 26, 32, 0.9)',
    borderWidth: 1,
    borderColor: '#3F3F46',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapRecenterPill: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26, 26, 32, 0.9)',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  mapRecenterText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  areaDetailsCard: {
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  areaDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  areaDetailsHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  areaDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  areaDetailIcon: {
    width: 20,
  },
  areaDetailLabel: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '700',
    width: 95,
  },
  areaDetailValue: {
    color: '#D4D4D8',
    fontSize: 11,
    flex: 1,
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
  dockReadyBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockReadyBtnText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  dockStatusRow: {
    alignItems: 'center',
    marginTop: 6,
  },
  dockStatusText: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
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
});

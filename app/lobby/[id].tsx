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

  const handleInspectPlayer = (targetId: string, name?: string, color?: string) => {
    triggerHaptic('buttonTap');
    router.push({
      pathname: '/profile/[id]',
      params: { id: targetId, name: name ?? '', color: color ?? '' },
    });
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
    if (['countdown', 'head_start', 'live', 'ended', 'cancelled'].includes(state.game.status)) {
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
    const area = state?.game?.area;
    if (area && typeof area.longitude === 'number' && typeof area.latitude === 'number') {
      return [area.longitude, area.latitude];
    }
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
  }, [state?.game?.area, state?.game?.area_center]);

  const boundaryGeoJSON = useMemo(() => {
    return circleRing(
      { longitude: centerCoords[0], latitude: centerCoords[1] },
      state?.game?.area?.radius_m || state?.game?.area_radius_m || 500,
    );
  }, [centerCoords, state?.game?.area?.radius_m, state?.game?.area_radius_m]);

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
    const center = state?.game.area || state?.game.area_center;
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
    const center = state?.game.area || state?.game.area_center;
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
      {/* COMPACT TACTICAL TOP HEADER */}
      <View
        style={[
          styles.fixedTopHeader,
          {
            paddingTop: Math.max(insets.top, 16) + 4,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        {/* Row 1: Back | Mode Title (Full Width) | Live Status Chip */}
        <View style={styles.topNavRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isHost ? 'Cancel Mission' : 'Leave Lobby'}
            onPress={handleExitLobby}
            style={[styles.exitIconButton, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
          >
            <Ionicons name="arrow-back" size={18} color={colors.text} />
          </Pressable>

          <View style={styles.navTitleWrap}>
            <Text
              variant="caption"
              numberOfLines={1}
              style={{ color: colors.textMuted, fontWeight: '800', letterSpacing: 1.2, fontSize: 10 }}
            >
              MISSION LOBBY
            </Text>
            <Text
              variant="title"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}
            >
              {activeModule?.name || 'Classic Chase'}
            </Text>
          </View>

          <View style={styles.headerRightActions}>
            <Chip
              label={everyoneReady ? 'READY' : 'PREPARING'}
              variant={everyoneReady ? 'accent' : 'muted'}
              size="sm"
            />
          </View>
        </View>

        {/* Row 2: Unified Tactical Bar (Room Code, QR, Privacy, GPS) */}
        <View style={styles.tacticalUtilityBar}>
          <Pressable
            onPress={() => void shareCode()}
            accessibilityRole="button"
            accessibilityLabel={`Room code ${state.game.code}`}
            style={[styles.tacticalCodePill, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
          >
            <Text numberOfLines={1} style={[styles.tacticalPillPrefix, { color: colors.textMuted }]}>CODE</Text>
            <Text numberOfLines={1} style={[styles.tacticalPillCode, { color: colors.accent }]}>{state.game.code}</Text>
            <Ionicons name="share-outline" size={12} color={colors.accent} />
          </Pressable>

          <Pressable
            onPress={() => setInviteModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Show QR invite"
            style={[styles.tacticalCompactPill, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
          >
            <Ionicons name="qr-code-outline" size={13} color={colors.accent} />
            <Text numberOfLines={1} style={[styles.tacticalPillText, { color: colors.text }]}>QR</Text>
          </Pressable>

          <Pressable
            onPress={handleTogglePrivacy}
            style={[styles.tacticalPill, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
            accessibilityRole="button"
            accessibilityLabel="Configure route privacy"
          >
            <Ionicons
              name={shareChoice === true ? 'eye-outline' : 'lock-closed-outline'}
              size={12}
              color={shareChoice === true ? colors.accent : colors.textMuted}
            />
            <Text numberOfLines={1} style={[styles.tacticalPillText, { color: colors.textSecondary }]}>
              {shareChoice === true ? 'Shared' : 'Private'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              setReadyCheckVisible(true);
              void handleRunDiagnostic();
            }}
            style={[styles.tacticalCompactPill, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
            accessibilityRole="button"
            accessibilityLabel="Check Sensors and GPS"
          >
            <Ionicons
              name={healthReport?.overall === 'healthy' ? 'radio' : 'radio-outline'}
              size={12}
              color={healthReport?.overall === 'healthy' ? colors.accent : colors.warning}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.tacticalPillText,
                { color: healthReport?.overall === 'healthy' ? colors.accent : colors.textSecondary },
              ]}
            >
              GPS
            </Text>
          </Pressable>
        </View>

        {/* Banners (Errors or notices) */}
        {bannerMessage !== '' && (
          <Card
            variant="elevated"
            style={[styles.bannerCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.warning, marginBottom: 8 }]}
          >
            <Text variant="body" style={{ color: colors.warning, fontSize: 12 }}>
              {bannerMessage}
            </Text>
          </Card>
        )}

        {errorMessage !== '' && (
          <Card
            variant="elevated"
            style={[styles.bannerCard, { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder, marginBottom: 8 }]}
          >
            <Text variant="body" style={{ color: colors.dangerText, fontSize: 12 }}>
              {errorMessage}
            </Text>
          </Card>
        )}

        {/* Sliding SegmentBar Tabs */}
        <SegmentBar
          items={[
            { id: 'roster', label: `ROSTER (${activePlayers.length})` },
            { id: 'rules', label: 'RULES & INTEL' },
            { id: 'map', label: 'ARENA MAP' },
          ]}
          activeId={activeSegment}
          onChange={(id) => handleTabPress(id as 'roster' | 'rules' | 'map')}
          style={{ marginBottom: 6, marginTop: 4 }}
        />
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
            <View style={{ gap: 14 }}>
              {/* 2+ Players Warning Banner (if active) */}
              {activePlayers.length < 2 && !isSoloMode && (
                <View style={styles.warningPillBanner}>
                  <Ionicons name="warning-outline" size={15} color={colors.warning} />
                  <Text style={[styles.warningPillText, { color: colors.warning }]}>
                    At least 2 players needed to launch. Share room code or QR to invite operatives.
                  </Text>
                </View>
              )}

              {/* Unassigned Operative Prompt (if local player has no squad yet) */}
              {!isSoloMode && ownPlayer?.team === 'unassigned' && (
                <View style={[styles.unassignedPromptCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.accent }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Ionicons name="shield-outline" size={16} color={colors.accent} />
                    <Text style={[styles.unassignedPromptTitle, { color: colors.accent }]}>
                      DEPLOYMENT REQUIRED
                    </Text>
                  </View>
                  <Text style={[styles.unassignedPromptSubtitle, { color: colors.textMuted }]}>
                    Choose a squad to join before readying up for the operation.
                  </Text>
                  <View style={styles.unassignedPromptButtons}>
                    <Pressable
                      onPress={() => void setTeam(ownPlayer, 'runner')}
                      style={[styles.unassignedSquadBtn, { backgroundColor: 'rgba(52, 199, 89, 0.15)', borderColor: colors.runner }]}
                    >
                      <Ionicons name="walk" size={16} color={colors.runner} />
                      <Text style={[styles.unassignedSquadBtnText, { color: colors.runner }]}>
                        JOIN RUNNERS
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void setTeam(ownPlayer, 'hunter')}
                      style={[styles.unassignedSquadBtn, { backgroundColor: 'rgba(255, 69, 58, 0.15)', borderColor: colors.hunter }]}
                    >
                      <Ionicons name="skull" size={16} color={colors.hunter} />
                      <Text style={[styles.unassignedSquadBtnText, { color: colors.hunter }]}>
                        JOIN HUNTERS
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* SQUAD ARENA: SQUADS LIST */}
              {isSoloMode ? (
                <View style={{ gap: 8 }}>
                  <TacticalDivider
                    label="SOLO ROSTER"
                    sublabel={`${activePlayers.length} OPERATIVES`}
                    variant="bracket"
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
                <View style={{ gap: 14 }}>
                  <TacticalDivider
                    label="SQUAD DEPLOYMENT"
                    sublabel={`${activePlayers.length} OPERATIVE${activePlayers.length === 1 ? '' : 'S'}`}
                    variant="bracket"
                  />

                  {/* RUNNERS SQUAD CARD */}
                  <View style={[styles.squadSectionCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
                    <View style={styles.squadSectionHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[styles.squadIconBadge, { backgroundColor: 'rgba(52, 199, 89, 0.15)' }]}>
                          <Ionicons name="walk" size={16} color={colors.runner} />
                        </View>
                        <Text style={[styles.squadSectionTitle, { color: colors.text }]}>RUNNERS SQUAD</Text>
                      </View>
                      <Chip
                        label={`${runners.length} OPERATIVE${runners.length === 1 ? '' : 'S'}`}
                        variant={runners.length > 0 ? 'accent' : 'muted'}
                        size="sm"
                      />
                    </View>

                    {runners.length === 0 ? (
                      <Pressable
                        onPress={() => ownPlayer && void setTeam(ownPlayer, 'runner')}
                        style={[styles.emptySquadSlot, { borderColor: colors.borderDark }]}
                      >
                        <Ionicons name="add" size={16} color={colors.runner} />
                        <Text style={[styles.emptySquadText, { color: colors.runner }]}>
                          Tap to join Runners Squad
                        </Text>
                      </Pressable>
                    ) : (
                      <View style={{ gap: 8, marginTop: 4 }}>
                        {runners.map((p) => (
                          <View key={p.id}>
                            <PlayerRow
                              player={p}
                              isHost={isHost}
                              isSelf={p.id === state.my_player_id}
                              isGameHost={p.user_id === state.game.host_id}
                              kickingId={kickingPlayerId}
                              colors={colors}
                              radii={radii}
                              onStartKick={setKickingPlayerId}
                              onConfirmKick={() => void confirmKick(p)}
                              onCancelKick={() => setKickingPlayerId(null)}
                              onInspectPlayer={handleInspectPlayer}
                            />
                            {p.id === state.my_player_id && (
                              <View style={styles.selfSquadActionsRow}>
                                <Pressable
                                  onPress={() => void setTeam(p, 'hunter')}
                                  style={[styles.switchSquadLink, { borderColor: colors.hunter }]}
                                >
                                  <Ionicons name="skull-outline" size={12} color={colors.hunter} />
                                  <Text style={[styles.switchSquadLinkText, { color: colors.hunter }]}>
                                    Switch to Hunters
                                  </Text>
                                </Pressable>
                                <Pressable
                                  onPress={() => void setTeam(p, 'unassigned')}
                                  style={styles.benchLink}
                                >
                                  <Ionicons name="pause-outline" size={12} color={colors.textMuted} />
                                  <Text style={[styles.benchLinkText, { color: colors.textMuted }]}>
                                    Bench
                                  </Text>
                                </Pressable>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>

                  {/* HUNTERS SQUAD CARD */}
                  <View style={[styles.squadSectionCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
                    <View style={styles.squadSectionHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[styles.squadIconBadge, { backgroundColor: 'rgba(255, 69, 58, 0.15)' }]}>
                          <Ionicons name="skull" size={16} color={colors.hunter} />
                        </View>
                        <Text style={[styles.squadSectionTitle, { color: colors.text }]}>HUNTERS SQUAD</Text>
                      </View>
                      <Chip
                        label={`${hunters.length} OPERATIVE${hunters.length === 1 ? '' : 'S'}`}
                        variant={hunters.length > 0 ? 'warning' : 'muted'}
                        size="sm"
                      />
                    </View>

                    {hunters.length === 0 ? (
                      <Pressable
                        onPress={() => ownPlayer && void setTeam(ownPlayer, 'hunter')}
                        style={[styles.emptySquadSlot, { borderColor: colors.borderDark }]}
                      >
                        <Ionicons name="add" size={16} color={colors.hunter} />
                        <Text style={[styles.emptySquadText, { color: colors.hunter }]}>
                          Tap to join Hunters Squad
                        </Text>
                      </Pressable>
                    ) : (
                      <View style={{ gap: 8, marginTop: 4 }}>
                        {hunters.map((p) => (
                          <View key={p.id}>
                            <PlayerRow
                              player={p}
                              isHost={isHost}
                              isSelf={p.id === state.my_player_id}
                              isGameHost={p.user_id === state.game.host_id}
                              kickingId={kickingPlayerId}
                              colors={colors}
                              radii={radii}
                              onStartKick={setKickingPlayerId}
                              onConfirmKick={() => void confirmKick(p)}
                              onCancelKick={() => setKickingPlayerId(null)}
                              onInspectPlayer={handleInspectPlayer}
                            />
                            {p.id === state.my_player_id && (
                              <View style={styles.selfSquadActionsRow}>
                                <Pressable
                                  onPress={() => void setTeam(p, 'runner')}
                                  style={[styles.switchSquadLink, { borderColor: colors.runner }]}
                                >
                                  <Ionicons name="walk-outline" size={12} color={colors.runner} />
                                  <Text style={[styles.switchSquadLinkText, { color: colors.runner }]}>
                                    Switch to Runners
                                  </Text>
                                </Pressable>
                                <Pressable
                                  onPress={() => void setTeam(p, 'unassigned')}
                                  style={styles.benchLink}
                                >
                                  <Ionicons name="pause-outline" size={12} color={colors.textMuted} />
                                  <Text style={[styles.benchLinkText, { color: colors.textMuted }]}>
                                    Bench
                                  </Text>
                                </Pressable>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>

                  {/* UNASSIGNED / BENCH OPERATIVES (if other players are unassigned) */}
                  {unassigned.filter((p) => p.id !== state.my_player_id).length > 0 && (
                    <View style={[styles.squadSectionCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
                      <View style={styles.squadSectionHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Ionicons name="people-outline" size={16} color={colors.textMuted} />
                          <Text style={[styles.squadSectionTitle, { color: colors.textMuted }]}>
                            RESERVES / UNASSIGNED
                          </Text>
                        </View>
                        <Chip
                          label={`${unassigned.filter((p) => p.id !== state.my_player_id).length}`}
                          variant="muted"
                          size="sm"
                        />
                      </View>
                      <View style={{ gap: 8, marginTop: 4 }}>
                        {unassigned
                          .filter((p) => p.id !== state.my_player_id)
                          .map((p) => (
                            <PlayerRow
                              key={p.id}
                              player={p}
                              isHost={isHost}
                              isSelf={false}
                              isGameHost={p.user_id === state.game.host_id}
                              kickingId={kickingPlayerId}
                              colors={colors}
                              radii={radii}
                              onStartKick={setKickingPlayerId}
                              onConfirmKick={() => void confirmKick(p)}
                              onCancelKick={() => setKickingPlayerId(null)}
                              onInspectPlayer={handleInspectPlayer}
                            />
                          ))}
                      </View>
                    </View>
                  )}

                  {/* HOST TACTICAL CONTROLS */}
                  {isHost && (
                    <View style={[styles.hostControlsCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}>
                      <Text style={styles.hostControlsLabel}>HOST TACTICAL COMMANDS</Text>
                      <View style={styles.hostControlsButtons}>
                        <Button
                          title="SHUFFLE SQUADS"
                          variant="secondary"
                          size="sm"
                          icon={<Ionicons name="shuffle-outline" size={14} color={colors.text} />}
                          style={{ flex: 1, borderRadius: 12 }}
                          disabled={activePlayers.length < 2 || busyAction === 'randomize'}
                          onPress={() => void randomizeTeams()}
                        />
                        <Button
                          title="ROTATE ROLES"
                          variant="secondary"
                          size="sm"
                          icon={<Ionicons name="sync-outline" size={14} color={colors.text} />}
                          style={{ flex: 1, borderRadius: 12 }}
                          disabled={activePlayers.length < 2 || busyAction === 'rotate'}
                          onPress={() => void rotateRoles()}
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
                void startRound();
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
          borderColor: isSelf ? colors.accent : colors.borderDark,
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
        <View style={{ flex: 1, marginLeft: 8, marginRight: 6, justifyContent: 'center' }}>
          <View style={styles.nameRow}>
            <Text
              variant="title"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                color: colors.text,
                fontSize: 12.5,
                fontWeight: '800',
                letterSpacing: 0.2,
                flexShrink: 1,
              }}
            >
              {player.display_name.toUpperCase()}
            </Text>
            {isGameHost ? (
              <View style={styles.hostBadge}>
                <MaterialCommunityIcons name="crown" size={10} color="#000000" />
                <Text style={styles.hostBadgeText}>HOST</Text>
              </View>
            ) : isSelf ? (
              <View style={styles.youBadge}>
                <Text style={styles.youBadgeText}>YOU</Text>
              </View>
            ) : null}
          </View>
          {player.is_remote && (
            <Text variant="caption" style={{ color: colors.radarScan, marginTop: 2 }}>
              REMOTE OPERATIVE
            </Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {player.tracking_health && player.tracking_health !== 'unknown' && (
            <View
              accessibilityLabel={`Tracking health: ${player.tracking_health}`}
              style={{
                width: 7,
                height: 7,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  navTitleWrap: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tacticalUtilityBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  tacticalPill: {
    flex: 0.95,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    minHeight: 36,
  },
  tacticalCodePill: {
    flex: 1.9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 5,
    minHeight: 36,
  },
  tacticalCompactPill: {
    flex: 0.65,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 1,
    gap: 3,
    minHeight: 36,
  },
  tacticalPillPrefix: {
    fontSize: 8.5,
    fontFamily: 'Archivo-Bold',
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  tacticalPillCode: {
    fontSize: 12.5,
    fontFamily: 'Archivo-Bold',
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  tacticalPillText: {
    fontSize: 11,
    fontFamily: 'Archivo-Bold',
    fontWeight: '700',
  },
  fixedTopHeader: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#0F0F14',
    zIndex: 10,
  },
  bannerCard: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  horizontalPager: {
    flex: 1,
  },
  tabContentScroll: {
    paddingTop: 12,
  },
  warningPillBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.3)',
  },
  warningPillText: {
    fontSize: 11,
    fontFamily: 'Archivo-Bold',
    fontWeight: '600',
    flex: 1,
  },
  unassignedPromptCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  unassignedPromptTitle: {
    fontSize: 12,
    fontFamily: 'Archivo-Bold',
    fontWeight: '900',
    letterSpacing: 1,
  },
  unassignedPromptSubtitle: {
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 10,
  },
  unassignedPromptButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  unassignedSquadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  unassignedSquadBtnText: {
    fontSize: 10.5,
    fontFamily: 'Archivo-Bold',
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  squadSectionCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  squadSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  squadIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squadSectionTitle: {
    fontSize: 13,
    fontFamily: 'Archivo-Bold',
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  emptySquadSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: 8,
    marginTop: 6,
  },
  emptySquadText: {
    fontSize: 12,
    fontFamily: 'Archivo-Bold',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  selfSquadActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 6,
    paddingRight: 4,
  },
  switchSquadLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  switchSquadLinkText: {
    fontSize: 10,
    fontFamily: 'Archivo-Bold',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  benchLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  benchLinkText: {
    fontSize: 10,
    fontFamily: 'Archivo-Bold',
    fontWeight: '700',
  },
  hostControlsCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  hostControlsLabel: {
    color: '#8E8E93',
    fontSize: 10,
    fontFamily: 'Archivo-Bold',
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
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
    flex: 1,
  },
  youBadge: {
    backgroundColor: 'rgba(167, 139, 250, 0.2)',
    borderColor: '#A78BFA',
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 5,
    marginLeft: 6,
    flexShrink: 0,
  },
  youBadgeText: {
    color: '#A78BFA',
    fontSize: 9,
    fontFamily: 'Archivo-Bold',
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  hostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 5,
    gap: 2,
    flexShrink: 0,
  },
  hostBadgeText: {
    color: '#000000',
    fontSize: 8.5,
    fontFamily: 'Archivo-Bold',
    fontWeight: '900',
    letterSpacing: 0.4,
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

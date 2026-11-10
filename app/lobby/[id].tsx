import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

  // Host draft modifiers/roles
  const [draftModifiers, setDraftModifiers] = useState<string[]>([]);
  const [draftRoles, setDraftRoles] = useState<string[]>([]);
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

  async function setTeam(player: LobbyPlayer, team: Exclude<Team, 'unassigned'>) {
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

  async function toggleReady() {
    if (!supabase || !gameId) return;
    const ownPlayer = state?.players.find((p) => p.id === state.my_player_id);

    // If becoming ready, ensure match notifications & location permissions are active
    if (!ownPlayer?.is_ready) {
      await ensureGamePermissions();
    }

    // If role has high complexity and unacknowledged, switch to rules tab and warn
    const effectiveRole = mySecretRole || ownPlayer?.team;
    const isHighComplexity = ['double_agent', 'operator', 'vip'].includes(effectiveRole || '');
    if (!ownPlayer?.is_ready && isHighComplexity && !roleAcknowledged) {
      setActiveSegment('rules');
      setBannerMessage('Please review and acknowledge your tactical role directives in Rules & Intel.');
      return;
    }

    await runAction('ready', () =>
      supabase!.rpc('set_ready', { game_id: gameId, ready: !ownPlayer?.is_ready }),
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

  async function shareCode() {
    if (!state) return;
    await Share.share({ message: `Join my GhostRun match with code: ${state.game.code}` });
  }

  async function chooseShare(share: boolean) {
    if (!supabase || !gameId) return;
    setSavingShare(true);
    setErrorMessage('');
    const { error } = await supabase.rpc('set_share_trail', { game_id: gameId, share });
    setSavingShare(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setShareChoice(share);
    await loadState();
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
            paddingBottom: Math.max(insets.bottom, 16) + 40,
          },
        ]}
      >
        {/* Top Header Card */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <Text variant="label" numberOfLines={1} style={{ color: colors.primary }}>
              MISSION LOBBY · {activeModule?.name.toUpperCase() || 'OPERATIONAL GRID'}
            </Text>
            <View style={styles.codeWrap}>
              <Text variant="display" style={{ color: colors.text, letterSpacing: 2 }}>
                {state.game.code}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void shareCode()}
                style={[styles.sharePill, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
              >
                <Ionicons name="share-outline" size={16} color={colors.primary} />
                <Text variant="label" style={{ color: colors.primary, marginLeft: 4 }}>
                  SHARE
                </Text>
              </Pressable>
            </View>
          </View>

          <Chip
            label={everyoneReady ? 'READY TO DEPLOY' : 'PREPARING'}
            variant={everyoneReady ? 'accent' : 'muted'}
            size="sm"
            style={{ flexShrink: 0 }}
          />
        </View>

        {bannerMessage !== '' && (
          <Card
            variant="elevated"
            style={[styles.bannerCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.warning, marginTop: spacing.sm }]}
          >
            <Text variant="body" style={{ color: colors.warning, fontSize: 13 }}>
              {bannerMessage}
            </Text>
          </Card>
        )}

        {errorMessage !== '' && (
          <Card
            variant="elevated"
            style={[styles.bannerCard, { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder, marginTop: spacing.sm }]}
          >
            <Text variant="body" style={{ color: colors.dangerText, fontSize: 13 }}>
              {errorMessage}
            </Text>
          </Card>
        )}

        {/* C3 Replay Sharing Choice Banner */}
        {shareChoice === null && (
          <Card
            variant="elevated"
            style={[
              styles.shareSheetCard,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.borderAccent, marginTop: spacing.md },
            ]}
          >
            <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
              Route Privacy in Mission Replays
            </Text>
            <Text variant="caption" style={{ color: colors.textMuted, marginTop: 4, lineHeight: 18 }}>
              After the match, a tactical replay reconstructs movements. Choose whether opponents can inspect your exact route trail.
            </Text>
            <View style={styles.shareActionRow}>
              <Button
                title={savingShare ? 'Saving...' : 'Share with Crew'}
                variant="primary"
                size="sm"
                disabled={savingShare}
                style={{ flex: 1 }}
                onPress={() => void chooseShare(true)}
              />
              <Button
                title="Keep Private"
                variant="secondary"
                size="sm"
                disabled={savingShare}
                style={{ flex: 1 }}
                onPress={() => void chooseShare(false)}
              />
            </View>
          </Card>
        )}

        {/* 3-Segment Bar */}
        <View style={{ marginTop: spacing.lg }}>
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

        {/* ==================== SEGMENT 1: ROSTER ==================== */}
        {activeSegment === 'roster' && (
          <View style={{ marginTop: spacing.md }}>
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
              <View>
                {/* Runners Section */}
                <View style={styles.sectionHeaderRow}>
                  <Text variant="label" style={{ color: colors.runner }}>
                    RUNNERS ({runners.length})
                  </Text>
                  {ownPlayer?.team !== 'runner' && (
                    <Button
                      title="Join Runners"
                      variant="ghost"
                      size="sm"
                      onPress={() => ownPlayer && void setTeam(ownPlayer, 'runner')}
                    />
                  )}
                </View>
                {runners.map((player) => (
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
                    onToggleRemote={
                      state.game.roles?.includes('operator')
                        ? () => void toggleRemote(player)
                        : undefined
                    }
                  />
                ))}

                {/* Hunters Section */}
                <View style={[styles.sectionHeaderRow, { marginTop: spacing.md }]}>
                  <Text variant="label" style={{ color: colors.hunter }}>
                    HUNTERS ({hunters.length})
                  </Text>
                  {ownPlayer?.team !== 'hunter' && (
                    <Button
                      title="Join Hunters"
                      variant="ghost"
                      size="sm"
                      onPress={() => ownPlayer && void setTeam(ownPlayer, 'hunter')}
                    />
                  )}
                </View>
                {hunters.map((player) => (
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
                    onToggleRemote={
                      state.game.roles?.includes('operator')
                        ? () => void toggleRemote(player)
                        : undefined
                    }
                  />
                ))}

                {/* Unassigned Section */}
                {unassigned.length > 0 && (
                  <View style={{ marginTop: spacing.md }}>
                    <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
                      UNASSIGNED ({unassigned.length})
                    </Text>
                    {unassigned.map((player) => (
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
                )}
              </View>
            )}

            {/* Ready & Host Action Controls */}
            <View style={[styles.actionSection, { marginTop: spacing.xl }]}>
              <Button
                title={ownPlayer?.is_ready ? 'STAND DOWN' : 'READY UP'}
                variant={ownPlayer?.is_ready ? 'secondary' : 'primary'}
                size="lg"
                disabled={shareChoice === null}
                onPress={() => void toggleReady()}
              />

              {isHost && (
                <View style={{ gap: 10, marginTop: spacing.md }}>
                  {!isSoloMode && (
                    <Button
                      title="Randomize Teams"
                      variant="secondary"
                      size="sm"
                      disabled={busyAction === 'randomize'}
                      onPress={() => void randomizeTeams()}
                    />
                  )}

                  {state.game.mode === 'classic_chase' ? (
                    <Button
                      title="Begin Target Selection"
                      variant="primary"
                      size="lg"
                      disabled={!canStart || !everyoneReady || busyAction !== ''}
                      onPress={() => void continueLobby()}
                    />
                  ) : (
                    <Button
                      title="Launch Round"
                      variant="primary"
                      size="lg"
                      disabled={!canStart || !everyoneReady || busyAction !== ''}
                      onPress={() => void startRound()}
                    />
                  )}

                  <Button
                    title="Cancel Mission"
                    variant="danger"
                    size="sm"
                    disabled={busyAction === 'cancel'}
                    onPress={() => void cancelGame()}
                  />
                </View>
              )}

              {!isHost && (
                <Button
                  title="Abort & Leave Lobby"
                  variant="ghost"
                  size="sm"
                  style={{ marginTop: spacing.md }}
                  disabled={busyAction === 'leave'}
                  onPress={() => void leaveLobby()}
                />
              )}
            </View>
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
        <Chip
          label={player.is_ready ? 'READY' : 'PREPARING'}
          variant={player.is_ready ? 'accent' : 'muted'}
          size="sm"
        />
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
  sharePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  bannerCard: {
    padding: 12,
    borderWidth: 1,
  },
  shareSheetCard: {
    padding: 16,
    borderWidth: 1,
  },
  shareActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
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
    padding: 12,
    borderWidth: 1,
    marginBottom: 8,
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

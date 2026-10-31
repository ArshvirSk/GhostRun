import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '../../src/lib/map';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  circleRing,
  formatAge,
  type LngLat,
  type PointCollection,
  type PointFeature,
} from '../../src/lib/geo';
import {
  openLocationSettings,
  startLocationSharing,
  stopLocationSharing,
  uploadLocation,
  watchLocation,
  type GeoFix,
  type StartLocationResult,
} from '../../src/lib/location';
import { supabase } from '../../src/lib/supabase';

const MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

type Team = 'runner' | 'hunter' | 'unassigned';
type Phase =
  'lobby' | 'target_selection' | 'countdown' | 'head_start' | 'live' | 'ended' | 'cancelled';

type GamePlayer = {
  id: string;
  user_id: string;
  display_name: string;
  color: string;
  team: Team;
  status: 'active' | 'tagged' | 'left';
  is_ready: boolean;
};

type RoundPosition = {
  player_id: string;
  display_name: string;
  color: string;
  team: Team;
  longitude: number;
  latitude: number;
  accuracy_m: number | null;
  recorded_at: string;
  is_mock: boolean;
};

type OwnPosition = {
  player_id: string;
  longitude: number;
  latitude: number;
  accuracy_m: number | null;
  recorded_at: string;
  is_mock: boolean;
};

type RoundPing = {
  id: number;
  seq: number;
  player_id: string;
  longitude: number | null;
  latitude: number | null;
  accuracy_m: number | null;
  position_age_s: number | null;
  reason: 'scheduled' | 'boundary';
  released_at: string;
};

type RoundState = {
  server_time: string;
  game: {
    id: string;
    code: string;
    host_id: string;
    mode: 'classic_chase' | 'tag_hunt';
    status: Phase;
    head_start_s: number;
    duration_s: number;
    ping_interval_s: number;
    tag_radius_m: number;
    target_radius_m: number;
    head_start_at: string | null;
    live_at: string | null;
    ends_at: string | null;
    next_ping_at: string | null;
    winner: 'runners' | 'hunters' | null;
    end_reason: string | null;
    area: LngLat & { radius_m: number };
    target_set: boolean;
  };
  players: GamePlayer[];
  my_player_id: string;
  my_team: Team;
  my_position: OwnPosition | null;
  positions: RoundPosition[];
  pings: RoundPing[];
  target: LngLat | null;
};

type SharingState = 'idle' | 'starting' | 'on' | 'denied' | 'error';

type TagResult = {
  success: boolean;
  reason?: 'cooldown' | 'stale_position' | 'no_target';
  runner_id?: string;
  phase?: Phase;
  winner?: 'runners' | 'hunters' | null;
  end_reason?: string | null;
};

const COUNTDOWN_LABEL = 'The round starts after a 10-second countdown.';

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function earliest(...timestamps: (string | null | undefined)[]) {
  const values = timestamps
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  if (values.length === 0) return null;
  return new Date(Math.min(...values)).toISOString();
}

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const gameId = Array.isArray(id) ? id[0] : id;

  const [state, setState] = useState<RoundState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const offsetRef = useRef(0);
  const advancingRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [tagMessage, setTagMessage] = useState('');

  const [sharing, setSharing] = useState<SharingState>('idle');
  const [sharingMessage, setSharingMessage] = useState('');
  const [backgroundSharing, setBackgroundSharing] = useState(false);
  const [fix, setFix] = useState<GeoFix | null>(null);
  const autoStartedRef = useRef(false);
  const startingRef = useRef(false);
  const sharingRef = useRef<SharingState>('idle');
  const mountedRef = useRef(true);

  useEffect(() => {
    sharingRef.current = sharing;
  }, [sharing]);

  const loadState = useCallback(async () => {
    if (!supabase || !gameId) return;
    const { data, error } = await supabase.rpc('get_game_state', { game_id: gameId });
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    if (data) {
      const offset = Date.parse((data as RoundState).server_time) - Date.now();
      offsetRef.current = offset;
      setServerOffset(offset);
      setState(data as RoundState);
      setErrorMessage('');
    }
  }, [gameId]);

  useEffect(() => {
    const initialLoad = setTimeout(() => void loadState(), 0);
    if (!supabase || !gameId) return () => clearTimeout(initialLoad);
    const channel = supabase
      .channel(`game-${gameId}`)
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
        {
          event: '*',
          schema: 'public',
          table: 'player_positions',
          filter: `game_id=eq.${gameId}`,
        },
        () => void loadState(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pings', filter: `game_id=eq.${gameId}` },
        () => void loadState(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tags', filter: `game_id=eq.${gameId}` },
        () => void loadState(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events', filter: `game_id=eq.${gameId}` },
        () => void loadState(),
      )
      .subscribe();
    return () => {
      clearTimeout(initialLoad);
      void supabase?.removeChannel(channel);
    };
  }, [gameId, loadState]);

  // Purely visual tick; every displayed deadline is measured against server time.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, []);

  // A cold start or a return from the background can miss realtime messages.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void loadState();
    });
    return () => subscription.remove();
  }, [loadState]);

  const status = state?.game.status ?? null;
  const selfPlayer = state?.players.find((player) => player.id === state?.my_player_id) ?? null;
  const taggedSelf = selfPlayer?.status === 'tagged';

  const phaseDeadline =
    status === 'countdown'
      ? state?.game.head_start_at
      : status === 'head_start'
        ? state?.game.live_at
        : status === 'live'
          ? earliest(state?.game.ends_at, state?.game.next_ping_at)
          : null;

  // Ask the server to advance at the next phase or ping boundary. Any member's
  // read releases a due ping round, so no scheduled job is required.
  useEffect(() => {
    if (!phaseDeadline) return;
    const timer = setInterval(() => {
      if (Date.now() + offsetRef.current < Date.parse(phaseDeadline)) return;
      if (advancingRef.current) return;
      advancingRef.current = true;
      void loadState().finally(() => {
        advancingRef.current = false;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [phaseDeadline, loadState]);

  const beginSharing = useCallback(async () => {
    if (!gameId || startingRef.current || sharingRef.current === 'on') return;
    startingRef.current = true;
    sharingRef.current = 'starting';
    setSharing('starting');
    setSharingMessage('');
    let result: StartLocationResult;
    try {
      result = await startLocationSharing(gameId);
    } catch {
      result = {
        ok: false as const,
        reason: 'error' as const,
        message: 'Location sharing could not start. Try again from this screen.',
      };
    }
    startingRef.current = false;
    // The player may have left the round while the OS permission sheet was open.
    // In that case the freshly started task must be stopped again.
    if (!mountedRef.current || sharingRef.current !== 'starting') {
      await stopLocationSharing();
      return;
    }
    if (result.ok) {
      sharingRef.current = 'on';
      setSharing('on');
      setBackgroundSharing(result.background);
      setSharingMessage(result.message);
    } else {
      const nextState = result.reason === 'denied' ? 'denied' : 'error';
      sharingRef.current = nextState;
      setSharing(nextState);
      setBackgroundSharing(false);
      setSharingMessage(result.message);
    }
  }, [gameId]);

  // Location sharing begins with the countdown, before anyone has to move.
  useEffect(() => {
    if (!status) return;
    const inRound = status === 'countdown' || status === 'head_start' || status === 'live';
    if (inRound && !autoStartedRef.current && !taggedSelf) {
      autoStartedRef.current = true;
      void beginSharing();
    }
    if (status === 'ended' || status === 'cancelled' || status === 'lobby') {
      autoStartedRef.current = false;
      sharingRef.current = 'idle';
      void stopLocationSharing().finally(() => {
        setSharing('idle');
        setBackgroundSharing(false);
      });
    }
  }, [beginSharing, status, taggedSelf]);

  // A tagged runner becomes a spectator; their position is no longer gameplay.
  useEffect(() => {
    if (!taggedSelf) return;
    autoStartedRef.current = false;
    sharingRef.current = 'idle';
    void stopLocationSharing().finally(() => {
      setSharing('idle');
      setBackgroundSharing(false);
    });
  }, [taggedSelf]);

  // Leaving the round screen stops the tracker. The task would otherwise keep
  // uploading after the player returned to the home screen.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void stopLocationSharing();
    };
  }, []);

  // Smooth marker while the screen is open. With background permission the task
  // is the uploader; otherwise this becomes the uploader as well.
  useEffect(() => {
    if (sharing !== 'on') return;
    return watchLocation((nextFix) => {
      setFix(nextFix);
      if (!backgroundSharing) void uploadLocation(nextFix);
    });
  }, [backgroundSharing, sharing]);

  // A player who is not routed to the right screen yet is sent there.
  useEffect(() => {
    if (!state || !gameId) return;
    if (state.game.status === 'lobby') {
      router.replace({ pathname: '/lobby/[id]', params: { id: gameId } });
    } else if (state.game.status === 'target_selection') {
      router.replace({ pathname: '/target/[id]', params: { id: gameId } });
    } else if (state.game.status === 'ended') {
      // The live screen stops here; the recap owns the finished round.
      router.replace({ pathname: '/result/[id]', params: { id: gameId } });
    }
  }, [gameId, router, state]);

  async function attemptTag() {
    if (!supabase || !gameId || busy !== '') return;
    setBusy('tag');
    setTagMessage('');
    const { data, error } = await supabase.rpc('attempt_tag', { game_id: gameId });
    setBusy('');
    if (error) {
      setTagMessage(error.message);
      return;
    }
    const result = data as TagResult;
    if (result.success) {
      setTagMessage(
        result.phase === 'ended' ? 'Tag confirmed. The round is over.' : 'Tag confirmed.',
      );
      await loadState();
      return;
    }
    setTagMessage(
      result.reason === 'cooldown'
        ? 'Tag cooldown. Try again in a few seconds.'
        : result.reason === 'stale_position'
          ? 'Waiting for a fresh GPS fix before tagging.'
          : 'No runner in range.',
    );
  }

  async function leaveGame() {
    if (!supabase || !gameId) return;
    if (state?.game.status === 'ended' || state?.game.status === 'cancelled') {
      router.replace('/home');
      return;
    }
    setBusy('leave');
    const { error } = await supabase.rpc('leave_game', { game_id: gameId });
    setBusy('');
    if (error) setErrorMessage(error.message);
    else router.replace('/home');
  }

  const game = state?.game ?? null;
  const players = state?.players ?? [];
  const myPlayerId = state?.my_player_id ?? '';
  const myTeam = state?.my_team ?? 'unassigned';
  const isRunner = myTeam === 'runner';
  const activePlayers = players.filter((player) => player.status === 'active');
  const runnersRemaining = activePlayers.filter((player) => player.team === 'runner').length;
  const serverNow = now + serverOffset;

  const ownFix: LngLat | null =
    fix !== null
      ? { longitude: fix.longitude, latitude: fix.latitude }
      : state?.my_position
        ? { longitude: state.my_position.longitude, latitude: state.my_position.latitude }
        : null;

  const pingFeatures: PointFeature[] = (state?.pings ?? [])
    .filter(
      (ping): ping is RoundPing & { longitude: number; latitude: number } =>
        ping.longitude !== null && ping.latitude !== null,
    )
    .map((ping) => {
      const releasedAgo = Math.max(0, (serverNow - Date.parse(ping.released_at)) / 1000);
      const age = releasedAgo + (ping.position_age_s ?? 0);
      return {
        type: 'Feature',
        properties: { age_s: age, reason: ping.reason },
        geometry: { type: 'Point', coordinates: [ping.longitude, ping.latitude] },
      };
    });

  const teammateFeatures: PointFeature[] = (state?.positions ?? [])
    .filter((position) => position.player_id !== myPlayerId)
    .map((position) => ({
      type: 'Feature',
      properties: { color: position.color, name: position.display_name },
      geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] },
    }));

  const pingsData: PointCollection = { type: 'FeatureCollection', features: pingFeatures };
  const teammatesData: PointCollection = {
    type: 'FeatureCollection',
    features: teammateFeatures,
  };
  const ownData: PointCollection = ownFix
    ? {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [ownFix.longitude, ownFix.latitude] },
          },
        ],
      }
    : { type: 'FeatureCollection', features: [] };

  const targetData: PointCollection | null = state?.target
    ? {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Point',
              coordinates: [state.target.longitude, state.target.latitude],
            },
          },
        ],
      }
    : null;

  if (!state) {
    return (
      <View style={styles.centered}>
        {errorMessage ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorMessage}
          </Text>
        ) : (
          <ActivityIndicator color="#1D4ED8" size="large" />
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/home')}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>Back to home</Text>
        </Pressable>
      </View>
    );
  }

  if (game!.status === 'lobby' || game!.status === 'target_selection') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1D4ED8" size="large" />
        <Text style={styles.loadingText}>Returning to the pre-game screen…</Text>
      </View>
    );
  }

  const zoom = Math.max(10, Math.min(16, 15 - Math.log2(game!.area.radius_m / 200)));
  const isLive = game!.status === 'live';
  const inPlay = ['head_start', 'live'].includes(game!.status);
  const tagRingData = isLive && !isRunner && ownFix ? circleRing(ownFix, game!.tag_radius_m) : null;

  let eyebrow = game!.mode === 'classic_chase' ? 'CLASSIC CHASE' : 'TAG HUNT';
  let title = '';
  let subtitle = '';
  let timerLabel = '';
  let timerValue: number | null = null;
  let accent = '#1D4ED8';

  if (game!.status === 'countdown') {
    title = 'Get ready';
    subtitle = COUNTDOWN_LABEL;
    timerLabel = 'COUNTDOWN';
    timerValue = game!.head_start_at ? (Date.parse(game!.head_start_at) - serverNow) / 1000 : null;
  } else if (game!.status === 'head_start') {
    accent = isRunner ? '#059669' : '#B45309';
    title = isRunner ? 'Head start' : 'Hunters locked';
    subtitle = isRunner
      ? 'Move away from the target and stay inside the play area. Hunters cannot see you yet.'
      : 'The runners are moving. The map unlocks when the timer reaches zero.';
    timerLabel = isRunner ? 'HUNTERS UNLOCK IN' : 'UNLOCKING IN';
    timerValue = game!.live_at ? (Date.parse(game!.live_at) - serverNow) / 1000 : null;
  } else if (game!.status === 'live') {
    accent = '#DB2777';
    title = isRunner ? 'Reach the target' : 'Hunt the runners';
    subtitle = isRunner
      ? 'Your team is on the map. Hunters only get delayed pings of your position.'
      : 'Runners are only visible as delayed pings. Use the age, not the dot, to decide.';
    timerLabel = 'TIME LEFT';
    timerValue = game!.ends_at ? (Date.parse(game!.ends_at) - serverNow) / 1000 : null;
  } else if (game!.status === 'ended') {
    eyebrow = 'ROUND OVER';
    accent = game!.winner === 'runners' ? '#059669' : '#B91C1C';
    title =
      game!.winner === 'runners'
        ? 'Runners win'
        : game!.winner === 'hunters'
          ? 'Hunters win'
          : 'Round over';
    subtitle =
      game!.end_reason === 'time_expired'
        ? 'Time ran out.'
        : game!.end_reason === 'all_tagged'
          ? 'Every runner was tagged.'
          : game!.end_reason === 'all_hunters_left'
            ? 'Every hunter left the round.'
            : game!.end_reason === 'target_reached'
              ? 'A runner reached the secret target.'
              : 'This round has finished.';
  } else if (game!.status === 'cancelled') {
    eyebrow = 'ROUND CANCELLED';
    accent = '#64748B';
    title = 'Round cancelled';
    subtitle = 'The host cancelled this round before it started.';
  }

  if (taggedSelf && game!.status === 'live') {
    eyebrow = 'SPECTATING';
    accent = '#64748B';
    title = 'You were tagged';
    subtitle = 'Your team can still win. Watch the rest of the round.';
    timerLabel = 'TIME LEFT';
  }

  const nextPingIn =
    isLive && game!.next_ping_at
      ? Math.max(0, (Date.parse(game!.next_ping_at) - serverNow) / 1000)
      : null;
  const newestPing = state.pings[0] ?? null;
  const newestPingAge = newestPing
    ? (newestPing.position_age_s ?? 0) +
      Math.max(0, (serverNow - Date.parse(newestPing.released_at)) / 1000)
    : null;

  const sharingTitle =
    sharing === 'on'
      ? backgroundSharing
        ? 'Location sharing on'
        : 'Sharing only while open'
      : sharing === 'starting'
        ? 'Starting location sharing…'
        : 'Location sharing off';
  const sharingBody =
    sharingMessage ||
    'Your team sees your position while the round runs. Opponents only receive scheduled pings.';

  return (
    <View style={styles.screen}>
      <MapLibreMap attribution mapStyle={MAP_STYLE} style={StyleSheet.absoluteFill}>
        <Camera
          initialViewState={{
            center: [game!.area.longitude, game!.area.latitude],
            zoom,
          }}
        />
        <GeoJSONSource id="play-area" data={circleRing(game!.area, game!.area.radius_m)}>
          <Layer
            id="play-area-fill"
            type="fill"
            paint={{ 'fill-color': '#1D4ED8', 'fill-opacity': 0.06 }}
          />
          <Layer
            id="play-area-outline"
            type="line"
            paint={{ 'line-color': '#1D4ED8', 'line-width': 2, 'line-dasharray': [2, 2] }}
          />
        </GeoJSONSource>

        {tagRingData && (
          <GeoJSONSource id="tag-radius" data={tagRingData}>
            <Layer
              id="tag-radius-fill"
              type="fill"
              paint={{ 'fill-color': '#DC2626', 'fill-opacity': 0.05 }}
            />
            <Layer
              id="tag-radius-line"
              type="line"
              paint={{ 'line-color': '#DC2626', 'line-width': 1.5, 'line-dasharray': [2, 2] }}
            />
          </GeoJSONSource>
        )}

        {state.target && (
          <GeoJSONSource id="target-radius" data={circleRing(state.target, game!.target_radius_m)}>
            <Layer
              id="target-radius-fill"
              type="fill"
              paint={{ 'fill-color': '#DB2777', 'fill-opacity': 0.08 }}
            />
            <Layer
              id="target-radius-line"
              type="line"
              paint={{ 'line-color': '#DB2777', 'line-width': 1.5, 'line-dasharray': [2, 2] }}
            />
          </GeoJSONSource>
        )}

        {teammateFeatures.length > 0 && (
          <GeoJSONSource id="teammates" data={teammatesData}>
            <Layer
              id="teammate-points"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': ['get', 'color'],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}

        {pingFeatures.length > 0 && (
          <GeoJSONSource id="pings" data={pingsData}>
            <Layer
              id="ping-points"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': [
                  'case',
                  ['==', ['get', 'reason'], 'boundary'],
                  '#F59E0B',
                  '#DB2777',
                ],
                'circle-opacity': ['interpolate', ['linear'], ['get', 'age_s'], 0, 0.9, 600, 0.25],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}

        {targetData && (
          <GeoJSONSource id="target-point" data={targetData}>
            <Layer
              id="target-circle"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': '#DB2777',
                'circle-stroke-width': 3,
                'circle-stroke-color': '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}

        {ownFix && (
          <GeoJSONSource id="own-position" data={ownData}>
            <Layer
              id="own-point"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': '#1D4ED8',
                'circle-stroke-width': 3,
                'circle-stroke-color': '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      <View style={styles.hud}>
        <Text style={[styles.eyebrow, { color: accent }]}>
          {eyebrow} · {game!.code}
        </Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.statsRow}>
          {timerValue !== null && game!.status !== 'ended' && game!.status !== 'cancelled' && (
            <View style={styles.stat}>
              <Text style={styles.statLabel}>{timerLabel}</Text>
              <Text style={styles.statValue}>{formatClock(timerValue)}</Text>
            </View>
          )}
          {isLive && nextPingIn !== null && (
            <View style={styles.stat}>
              <Text style={styles.statLabel}>NEXT PING</Text>
              <Text style={styles.statSmall}>{formatClock(nextPingIn)}</Text>
            </View>
          )}
          {isLive && (
            <View style={styles.stat}>
              <Text style={styles.statLabel}>RUNNERS</Text>
              <Text style={styles.statSmall}>{runnersRemaining}</Text>
            </View>
          )}
        </View>

        {errorMessage !== '' && (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorMessage}
          </Text>
        )}
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent}>
        {isLive && !isRunner && !taggedSelf && (
          <>
            <Pressable
              accessibilityRole="button"
              disabled={busy !== ''}
              onPress={() => void attemptTag()}
              style={[styles.tagButton, busy !== '' && styles.disabled]}
            >
              {busy === 'tag' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.tagText}>TAG A RUNNER</Text>
              )}
            </Pressable>
            <Text style={styles.tagHint}>
              Get within {game!.tag_radius_m} m of a runner and tap. Both positions must be fresh.
            </Text>
            {tagMessage !== '' && <Text style={styles.tagMessage}>{tagMessage}</Text>}
          </>
        )}

        {!taggedSelf && (inPlay || game!.status === 'countdown') && (
          <View style={styles.locationCard}>
            <View
              style={[
                styles.locationDot,
                { backgroundColor: sharing === 'on' ? '#059669' : '#B45309' },
              ]}
            />
            <View style={styles.locationDetails}>
              <Text style={styles.locationTitle}>{sharingTitle}</Text>
              <Text style={styles.locationBody}>{sharingBody}</Text>
              {sharing !== 'on' && sharing !== 'starting' && (
                <View style={styles.locationActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void beginSharing()}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryText}>Share location</Text>
                  </Pressable>
                  {sharing === 'denied' && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void openLocationSettings()}
                      style={styles.linkButtonInline}
                    >
                      <Text style={styles.linkText}>Open settings</Text>
                    </Pressable>
                  )}
                </View>
              )}
              {sharing === 'starting' && (
                <ActivityIndicator color="#1D4ED8" size="small" style={styles.inlineSpinner} />
              )}
            </View>
          </View>
        )}

        {taggedSelf && game!.status === 'live' && (
          <Text style={styles.sectionHint}>
            You are spectating. Location sharing stopped when you were tagged.
          </Text>
        )}

        {(game!.status === 'ended' || game!.status === 'cancelled') && (
          <Text style={styles.sectionHint}>Location sharing stopped when the round ended.</Text>
        )}

        <Text style={styles.sectionLabel}>PLAYERS · {activePlayers.length}</Text>
        {players.map((player) => (
          <View key={player.id} style={styles.playerRow}>
            <View style={[styles.playerDot, { backgroundColor: player.color }]} />
            <Text style={styles.playerName}>
              {player.display_name}
              {player.user_id === game!.host_id ? '  ♛' : ''}
              {player.id === myPlayerId ? '  (you)' : ''}
            </Text>
            <Text
              style={[
                styles.playerMeta,
                player.status === 'tagged' && styles.playerTagged,
                player.team === 'runner' && player.status !== 'tagged' && styles.playerRunner,
              ]}
            >
              {player.status === 'tagged'
                ? 'Tagged'
                : player.team === 'runner'
                  ? 'Runner'
                  : player.team === 'hunter'
                    ? 'Hunter'
                    : 'No team'}
            </Text>
          </View>
        ))}

        {isLive && (
          <Text style={styles.sectionHint}>
            {isRunner
              ? `Rings show what hunters have been told about runner positions.${
                  newestPingAge !== null
                    ? ` Latest: ${formatAge(newestPingAge)}.`
                    : ' No ping released yet.'
                }`
              : `Rings are runner snapshots, not live positions.${
                  newestPingAge !== null
                    ? ` Latest: ${formatAge(newestPingAge)}.`
                    : ' No ping released yet.'
                } Older rings fade.`}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={busy !== ''}
          onPress={() => void leaveGame()}
          style={[styles.primaryButton, { backgroundColor: accent }]}
        >
          {busy === 'leave' ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryText}>
              {game!.status === 'ended' || game!.status === 'cancelled'
                ? 'Back to home'
                : 'Leave round'}
            </Text>
          )}
        </Pressable>

        <Text style={styles.footer}>
          All timers use the server clock. Pings are released on a server schedule; older rings are
          less reliable.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#E2E8F0', flex: 1 },
  centered: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
  },
  loadingText: { color: '#64748B', fontSize: 14, marginTop: 14 },
  hud: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    elevation: 3,
    left: 16,
    padding: 16,
    position: 'absolute',
    right: 16,
    top: 48,
  },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: '#0F172A', fontSize: 24, fontWeight: '900', marginTop: 6 },
  subtitle: { color: '#475569', fontSize: 13, lineHeight: 19, marginTop: 6 },
  statsRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 18, marginTop: 14 },
  stat: { flexShrink: 1 },
  statLabel: { color: '#64748B', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  statValue: { color: '#0F172A', fontSize: 34, fontWeight: '900', letterSpacing: 0.5 },
  statSmall: { color: '#0F172A', fontSize: 20, fontWeight: '900' },
  error: { color: '#B91C1C', fontSize: 13, lineHeight: 19, marginTop: 12 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    bottom: 0,
    left: 0,
    maxHeight: '38%',
    position: 'absolute',
    right: 0,
  },
  sheetContent: { padding: 20, paddingBottom: 30 },
  locationCard: {
    alignItems: 'flex-start',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    flexDirection: 'row',
    marginBottom: 16,
    padding: 12,
  },
  locationDot: { borderRadius: 5, height: 10, marginTop: 5, width: 10 },
  locationDetails: { flex: 1, marginLeft: 10 },
  locationTitle: { color: '#0F172A', fontSize: 14, fontWeight: '900' },
  locationBody: { color: '#475569', fontSize: 12, lineHeight: 17, marginTop: 3 },
  locationActions: { alignItems: 'center', flexDirection: 'row', gap: 12, marginTop: 10 },
  secondaryButton: {
    borderColor: '#1D4ED8',
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryText: { color: '#1D4ED8', fontSize: 13, fontWeight: '800' },
  linkButtonInline: { justifyContent: 'center', minHeight: 34 },
  inlineSpinner: { alignSelf: 'flex-start', marginTop: 8 },
  sectionLabel: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginBottom: 4,
    marginTop: 4,
  },
  sectionHint: { color: '#64748B', fontSize: 12, lineHeight: 17, marginTop: 10 },
  playerRow: {
    alignItems: 'center',
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 40,
  },
  playerDot: { borderRadius: 5, height: 10, width: 10 },
  playerName: { color: '#0F172A', flex: 1, fontSize: 13, fontWeight: '700', marginLeft: 8 },
  playerMeta: { color: '#94A3B8', fontSize: 12, fontWeight: '700' },
  playerRunner: { color: '#059669' },
  playerTagged: { color: '#B91C1C' },
  tagButton: {
    alignItems: 'center',
    backgroundColor: '#DC2626',
    borderRadius: 13,
    justifyContent: 'center',
    marginBottom: 12,
    minHeight: 54,
  },
  tagText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  tagHint: { color: '#64748B', fontSize: 12, lineHeight: 17, marginBottom: 10 },
  tagMessage: { color: '#0F172A', fontSize: 13, fontWeight: '700', marginBottom: 12 },
  disabled: { opacity: 0.5 },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 13,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 50,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  footer: { color: '#94A3B8', fontSize: 11, lineHeight: 17, marginTop: 14 },
  linkButton: { alignItems: 'center', justifyContent: 'center', marginTop: 16, minHeight: 44 },
  linkText: { color: '#1D4ED8', fontSize: 15, fontWeight: '700' },
});

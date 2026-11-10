import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '../../src/lib/map';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  circleRing,
  distanceM,
  type LngLat,
  type PointCollection,
  type PointFeature,
} from '../../src/lib/geo';
import { stopLocationSharing } from '../../src/lib/location';
import { supabase } from '../../src/lib/supabase';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { Button, Card, Chip, Text } from '../../src/ui';
import { formatDistance, useUnits } from '../../src/utils/units';

const MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

type GhostPreview = {
  can_contribute: boolean;
  reason: string | null;
  original_point_count: number;
  trimmed_point_count: number;
  original_length_m: number;
  trimmed_length_m: number;
  trimmed_start_m: number;
  trimmed_end_m: number;
  duration_s: number;
  difficulty: string;
  already_contributed: boolean;
};

type GhostDuelScore = {
  id: string;
  game_id: string;
  user_id: string;
  variant: 'time_trial' | 'evade' | 'mirror_chase';
  player_time_s: number;
  ghost_time_s: number;
  delta_s: number;
  efficiency: number;
  score: number;
  created_at: string;
};

type Team = 'runner' | 'hunter' | 'solo' | 'unassigned';

type GamePlayer = {
  id: string;
  user_id: string;
  display_name: string;
  color: string;
  team: Team;
  status: 'active' | 'tagged' | 'left' | 'jailed';
  is_ready: boolean;
  secret_role?: string | null;
};

type PlayerStat = {
  player_id: string;
  user_id: string;
  display_name: string;
  color: string;
  team: Team;
  status: string;
  secret_role?: string | null;
  share_trail: boolean | null;
  closest_call_m: number | null;
  longest_unseen_s: number;
  loudest_noise: number;
  peak_speed_mps: number;
  drops_claimed: number;
  heat_presses?: number;
  heat_hits?: number;
  heat_hit_rate_pct?: number;
  best_bluff?: {
    achieved: boolean;
    title: string;
    detail: string;
  } | null;
};

type GameStats = {
  game_id: string;
  status: string;
  winner: string | null;
  end_reason: string | null;
  duration_s: number;
  players: PlayerStat[];
  heat_stats: {
    total_presses: number;
    hot_hits: number;
    hit_rate_pct: number;
  };
  total_drops_claimed: number;
  mode_recap?: {
    mode_id?: string;
    total_handoffs?: number;
    package_drops?: number;
    package_secured?: boolean;
    pulse_seq?: number;
    scores?: { runner: number; hunter: number };
    dominance_pct?: number;
    total_rescues?: number;
    total_jailed?: number;
    active_survivors?: number;
    safe_zone_count?: number;
    variant?: string;
    ai_gm?: {
      total_events: number;
      max_events: number;
      last_event_type: string | null;
      last_narration: string | null;
    };
  };
};

type FinalPosition = {
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

type TrailPoint = {
  player_id: string;
  longitude: number;
  latitude: number;
  accuracy_m: number | null;
  recorded_at: string;
};

type RoundResultState = {
  server_time: string;
  game: {
    id: string;
    code: string;
    host_id: string;
    mode: string;
    status: string;
    winner: 'runners' | 'hunters' | null;
    end_reason: string | null;
    live_at: string | null;
    ends_at: string | null;
    ended_at: string | null;
    tag_radius_m: number;
    target_radius_m: number;
    rematch_game_id: string | null;
    area: LngLat & { radius_m: number };
  };
  players: GamePlayer[];
  my_player_id: string;
  my_team: Team;
  positions: FinalPosition[];
  target: LngLat | null;
};

type TrailFeature = {
  type: 'Feature';
  properties: { color: string; name: string };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
};

type TrailCollection = {
  type: 'FeatureCollection';
  features: TrailFeature[];
};

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function teamLabel(team: Team) {
  return team === 'runner' ? 'Runner' : team === 'hunter' ? 'Hunter' : 'No team';
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = SCREEN_WIDTH - 32;

export default function ResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { unitSystem } = useUnits();
  const gameId = Array.isArray(id) ? id[0] : id;

  const [state, setState] = useState<RoundResultState | null>(null);
  const [gameStats, setGameStats] = useState<GameStats | null>(null);
  const [trails, setTrails] = useState<TrailPoint[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchError, setRematchError] = useState('');
  const [ghostPreview, setGhostPreview] = useState<GhostPreview | null>(null);
  const [ghostBusy, setGhostBusy] = useState(false);
  const [ghostSuccess, setGhostSuccess] = useState(false);
  const [ghostDismissed, setGhostDismissed] = useState(false);
  const [ghostPermanentlyDeclined, setGhostPermanentlyDeclined] = useState(false);
  const [ghostScore, setGhostScore] = useState<GhostDuelScore | null>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [shareRecapFeedback, setShareRecapFeedback] = useState(false);

  const mountedRef = useRef(true);
  const leavingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Stop background location updates once result is reached
  useEffect(() => {
    void stopLocationSharing();
  }, []);

  const load = useCallback(async () => {
    if (!gameId) return;
    if (!supabase) {
      setErrorMessage('Supabase is not configured in this build.');
      return;
    }

    const { data, error } = await supabase.rpc('get_game_state', { game_id: gameId });
    if (!mountedRef.current) return;
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const snapshot = data as RoundResultState;
    setState(snapshot);
    setErrorMessage('');

    if (snapshot.game.status !== 'ended') {
      return;
    }

    const isGhostDuel =
      snapshot.game.mode === 'ghost_duel' ||
      (snapshot.game as unknown as { mode_id?: string }).mode_id === 'ghost_duel';

    const [trailRes, statsRes, ghostRes, consentsRes] = await Promise.all([
      supabase.rpc('get_game_trails', { game_id: gameId }),
      supabase.rpc('get_game_stats', { game_id: gameId }),
      snapshot.my_team === 'runner' || isGhostDuel
        ? supabase.rpc('preview_ghost', { game_id: gameId })
        : Promise.resolve({ data: null, error: null }),
      supabase.rpc('get_my_consents'),
    ]);

    if (!mountedRef.current) return;

    if (!consentsRes.error && consentsRes.data) {
      const c4 = (consentsRes.data as any)?.ghost;
      if (c4?.granted === false) {
        setGhostPermanentlyDeclined(true);
      }
    }

    if (!trailRes.error && trailRes.data) {
      setTrails((trailRes.data as TrailPoint[] | null) ?? []);
    }

    if (!statsRes.error && statsRes.data) {
      setGameStats(statsRes.data as GameStats);
    }

    if (!ghostRes.error && ghostRes.data) {
      setGhostPreview(ghostRes.data as GhostPreview);
    }

    if (isGhostDuel) {
      const { data: scoreRow } = await supabase
        .from('ghost_duel_scores')
        .select('*')
        .eq('game_id', gameId)
        .maybeSingle();
      if (!mountedRef.current) return;
      if (scoreRow) {
        setGhostScore(scoreRow as GhostDuelScore);
      }
    }
  }, [gameId]);

  async function handleContributeGhost() {
    if (!supabase || !gameId || ghostBusy) return;
    setGhostBusy(true);
    setErrorMessage('');
    const { error } = await supabase.rpc('contribute_ghost', { game_id: gameId });
    if (!mountedRef.current) return;
    setGhostBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setGhostSuccess(true);
  }

  async function handleNeverAskGhost() {
    if (!supabase) return;
    setGhostDismissed(true);
    setGhostPermanentlyDeclined(true);
    await supabase.rpc('set_consent', {
      consent_type: 'ghost',
      granted: false,
      policy_version: null,
    });
  }

  useEffect(() => {
    const initialLoad = setTimeout(() => void load(), 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  // Direct link routing guard
  useEffect(() => {
    if (!state || !gameId) return;
    const phase = state.game.status;
    if (phase === 'lobby') {
      router.replace({ pathname: '/lobby/[id]', params: { id: gameId } });
    } else if (phase === 'target_selection') {
      router.replace({ pathname: '/target/[id]', params: { id: gameId } });
    } else if (phase === 'countdown' || phase === 'head_start' || phase === 'live') {
      router.replace({ pathname: '/game/[id]', params: { id: gameId } });
    } else if (phase === 'cancelled') {
      router.replace('/play' as any);
    }
  }, [gameId, router, state]);

  async function playAgain() {
    if (!supabase || !gameId || rematchBusy) return;
    setRematchBusy(true);
    setRematchError('');
    const { data, error } = await supabase.rpc('rematch_game', { p_game_id: gameId });
    if (!mountedRef.current) return;
    if (error) {
      setRematchBusy(false);
      setRematchError(error.message);
      return;
    }
    const created = (Array.isArray(data) ? data[0] : data) as { game_id?: string } | null;
    if (!created?.game_id) {
      setRematchBusy(false);
      setRematchError('The server did not return the rematch lobby. Please try again.');
      return;
    }
    leavingRef.current = true;
    router.replace({ pathname: '/lobby/[id]', params: { id: created.game_id } });
  }

  // Rematch follower polling
  useEffect(() => {
    if (!supabase || !gameId || state?.game.status !== 'ended') return;
    const rematchId = state.game.rematch_game_id;
    if (rematchId) {
      if (!leavingRef.current) {
        leavingRef.current = true;
        router.replace({ pathname: '/lobby/[id]', params: { id: rematchId } });
      }
      return;
    }

    let cancelled = false;
    const follow = async () => {
      const { data } = await supabase!
        .from('games')
        .select('rematch_game_id')
        .eq('id', gameId)
        .maybeSingle();
      const nextId = (data as { rematch_game_id: string | null } | null)?.rematch_game_id;
      if (cancelled || leavingRef.current || !nextId) return;
      leavingRef.current = true;
      router.replace({ pathname: '/lobby/[id]', params: { id: nextId } });
    };

    const timer = setInterval(() => void follow(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [gameId, router, state]);

  const playerById = useMemo(
    () => new Map((state?.players ?? []).map((player) => [player.id, player])),
    [state],
  );

  const myPlayerStats = useMemo(() => {
    if (!gameStats || !state) return null;
    return gameStats.players.find((p) => p.player_id === state.my_player_id) || null;
  }, [gameStats, state]);

  const trailsByPlayer = useMemo(() => {
    const grouped = new Map<string, TrailPoint[]>();
    for (const point of trails) {
      const list = grouped.get(point.player_id);
      if (list) list.push(point);
      else grouped.set(point.player_id, [point]);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
    }
    return grouped;
  }, [trails]);

  const trailFeatures = useMemo(() => {
    if (!state) return [];
    const features: TrailFeature[] = [];
    for (const player of state.players) {
      const points = trailsByPlayer.get(player.id) ?? [];
      if (points.length < 2) continue;
      features.push({
        type: 'Feature',
        properties: { color: player.color, name: player.display_name },
        geometry: {
          type: 'LineString',
          coordinates: points.map((point): [number, number] => [point.longitude, point.latitude]),
        },
      });
    }
    return features;
  }, [state, trailsByPlayer]);

  const winnerId = useMemo(() => {
    if (!state || state.game.end_reason !== 'target_reached' || !state.target) return null;
    const target = state.target;
    const winner = state.positions.find(
      (position) =>
        position.team === 'runner' && distanceM(position, target) <= state.game.target_radius_m,
    );
    return winner?.player_id ?? null;
  }, [state]);

  const handleCardScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / CARD_WIDTH);
    if (index !== activeCardIndex && index >= 0) {
      setActiveCardIndex(index);
    }
  };

  if (!gameId) {
    return (
      <View
        style={[
          styles.centered,
          {
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
          },
        ]}
      >
        <Text variant="headline" color={colors.danger} style={{ marginBottom: spacing.md }}>
          Operation not found.
        </Text>
        <Button title="Return to Base" variant="primary" size="md" onPress={() => router.replace('/play' as any)} />
      </View>
    );
  }

  if (!state) {
    return (
      <View
        style={[
          styles.centered,
          {
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
          },
        ]}
      >
        {errorMessage ? (
          <>
            <Text variant="body" color={colors.danger} style={{ marginBottom: spacing.md }}>
              {errorMessage}
            </Text>
            <Button title="Return to Base" variant="secondary" size="md" onPress={() => router.replace('/play' as any)} />
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
              Decrypting mission debrief…
            </Text>
          </>
        )}
      </View>
    );
  }

  if (state.game.status !== 'ended') {
    return (
      <View
        style={[
          styles.centered,
          {
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
          },
        ]}
      >
        <ActivityIndicator color={colors.primary} size="large" />
        <Text variant="body" color={colors.textMuted} style={{ marginTop: spacing.md }}>
          Finalizing round telemetry…
        </Text>
      </View>
    );
  }

  const game = state.game;
  const target = state.target;
  const players = state.players;
  const positions = state.positions;
  const zoom = Math.max(10, Math.min(16, 15 - Math.log2(game.area.radius_m / 200)));

  const isGhostDuel =
    game.mode === 'ghost_duel' ||
    (game as unknown as { mode_id?: string }).mode_id === 'ghost_duel';
  const isAssassinRing =
    game.mode === 'assassin_ring' ||
    (game as unknown as { mode_id?: string }).mode_id === 'assassin_ring';
  const isTerritoryPulse =
    game.mode === 'territory_pulse' ||
    (game as unknown as { mode_id?: string }).mode_id === 'territory_pulse';
  const isRelayHeist =
    game.mode === 'relay_heist' ||
    (game as unknown as { mode_id?: string }).mode_id === 'relay_heist';
  const isJailbreak =
    game.mode === 'jailbreak' ||
    (game as unknown as { mode_id?: string }).mode_id === 'jailbreak';

  const isVictory =
    (state.my_team === 'runner' && game.winner === 'runners') ||
    (state.my_team === 'hunter' && game.winner === 'hunters') ||
    (isGhostDuel && ['ghost_beaten', 'evaded', 'ghost_tagged'].includes(game.end_reason ?? ''));

  const winnerTitle = game.end_reason === 'curfew_reached'
    ? 'Curfew Reached'
    : isGhostDuel
    ? ['ghost_beaten', 'evaded', 'ghost_tagged'].includes(game.end_reason ?? '')
      ? game.end_reason === 'ghost_tagged'
        ? 'Ghost Intercepted'
        : game.end_reason === 'evaded'
          ? 'Evaded Successfully'
          : 'Ghost Record Beaten'
      : game.end_reason === 'ghost_escaped'
        ? 'Ghost Escaped'
        : game.end_reason === 'haunted'
          ? 'Haunted by Ghost'
          : 'Ghost Victorious'
    : isAssassinRing
      ? 'Contract Fulfilled'
      : isTerritoryPulse
        ? game.end_reason === 'territory_dominance'
          ? game.winner === 'runners'
            ? 'Runners Dominance'
            : 'Hunters Dominance'
          : game.end_reason === 'points_victory'
            ? game.winner === 'runners'
              ? 'Runners Victory by Points'
              : 'Hunters Victory by Points'
            : 'Territory Stalemate'
        : game.winner === 'runners'
          ? 'Runners Victory'
          : game.winner === 'hunters'
            ? 'Hunters Victory'
            : 'Mission Concluded';

  const outcomeAccent = game.end_reason === 'curfew_reached'
    ? colors.warning
    : isVictory
      ? colors.success
      : game.winner
        ? colors.danger
        : colors.textMuted;

  const reasonCopy = game.end_reason === 'curfew_reached'
    ? 'The match concluded automatically for player safety because the curfew deadline was reached.'
    : isGhostDuel
    ? game.end_reason === 'ghost_beaten'
      ? 'You reached the finish line faster than the recorded ghost runner.'
      : game.end_reason === 'ghost_won'
        ? 'The ghost runner reached the extraction perimeter first.'
        : game.end_reason === 'evaded'
          ? 'You navigated to the target without getting caught by the ghost hunter.'
          : game.end_reason === 'haunted'
            ? 'The ghost hunter approached within critical tag proximity.'
            : game.end_reason === 'ghost_tagged'
              ? 'You neutralized the ghost runner before it completed the route.'
              : game.end_reason === 'ghost_escaped'
                ? 'The ghost runner finished its route before tag engagement.'
                : 'The solo ghost duel debrief is finalized.'
    : isTerritoryPulse
      ? game.end_reason === 'territory_dominance'
        ? 'A squad achieved territory dominance by holding at least 70% of sectors across pulse boundaries.'
        : game.end_reason === 'points_victory'
          ? 'Victorious through superior sector control points accumulated across periodic pulses.'
          : 'Both squads finished with equal territory pulse scores.'
      : game.end_reason === 'vip_eliminated'
      ? 'Hunters successfully identified and eliminated the clandestine VIP.'
      : game.end_reason === 'last_survivor'
        ? 'The last operative standing survived the elimination ring.'
        : game.end_reason === 'all_jailed'
          ? 'All runner operatives were incarcerated simultaneously.'
          : game.end_reason === 'extraction_complete'
            ? 'The active package carrier reached the extraction point safely.'
            : game.end_reason === 'package_secured'
              ? 'Hunters intercepted and secured the dropped package.'
              : game.end_reason === 'target_reached'
                ? 'A runner infiltrated the secret target perimeter.'
                : game.end_reason === 'all_tagged'
                  ? 'All runners were tagged before target infiltration.'
                  : game.end_reason === 'all_hunters_left'
                    ? 'All hunters disconnected from the operation.'
                    : game.end_reason === 'time_expired'
                      ? isAssassinRing
                        ? 'Operation duration elapsed. Most eliminations determines victory.'
                        : game.mode === 'classic_chase'
                          ? 'Time expired before runners could reach the extraction target.'
                          : 'Time expired. Runners evaded hunters throughout the operational duration.'
                      : 'The round has concluded.';

  const finishAt = game.end_reason === 'time_expired' ? game.ends_at : game.ended_at;
  const roundSeconds =
    game.live_at && finishAt ? (Date.parse(finishAt) - Date.parse(game.live_at)) / 1000 : null;
  const taggedCount = players.filter(
    (player) => player.team === 'runner' && player.status === 'tagged',
  ).length;

  const positionFeatures: PointFeature[] = positions.map((position) => {
    const player = playerById.get(position.player_id);
    return {
      type: 'Feature',
      properties: {
        color: position.color,
        tagged: player?.status === 'tagged',
        winner: position.player_id === winnerId,
      },
      geometry: {
        type: 'Point',
        coordinates: [position.longitude, position.latitude],
      },
    };
  });

  const positionsData: PointCollection = {
    type: 'FeatureCollection',
    features: positionFeatures,
  };
  const trailsData: TrailCollection = {
    type: 'FeatureCollection',
    features: trailFeatures,
  };
  const targetData: PointCollection | null = target
    ? {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [target.longitude, target.latitude] },
          },
        ],
      }
    : null;

  const cardsCount = 7;

  return (
    <View style={styles.screen}>
      {/* Tactical Map Layer */}
      <MapLibreMap attribution mapStyle={MAP_STYLE} style={StyleSheet.absoluteFill}>
        <Camera
          initialViewState={{
            center: [game.area.longitude, game.area.latitude],
            zoom,
          }}
        />
        {/* Play Area Perimeter */}
        <GeoJSONSource id="play-area" data={circleRing(game.area, game.area.radius_m)}>
          <Layer
            id="play-area-fill"
            type="fill"
            paint={{ 'fill-color': colors.primary, 'fill-opacity': 0.05 }}
          />
          <Layer
            id="play-area-outline"
            type="line"
            paint={{ 'line-color': colors.primary, 'line-width': 2, 'line-dasharray': [2, 2] }}
          />
        </GeoJSONSource>

        {/* Ghost Echo Trail Glow Underlay */}
        {trailFeatures.length > 0 && (
          <GeoJSONSource id="trails-glow" data={trailsData}>
            <Layer
              id="trail-echo-glow"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': ['get', 'color'],
                'line-width': 8,
                'line-opacity': 0.25,
                'line-blur': 3,
              }}
            />
            <Layer
              id="trail-lines"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': ['get', 'color'],
                'line-width': 3,
                'line-opacity': 0.85,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Secret Target Perimeter & Marker */}
        {target && (
          <GeoJSONSource id="target-radius" data={circleRing(target, game.target_radius_m)}>
            <Layer
              id="target-radius-fill"
              type="fill"
              paint={{ 'fill-color': colors.danger, 'fill-opacity': 0.12 }}
            />
            <Layer
              id="target-radius-line"
              type="line"
              paint={{ 'line-color': colors.danger, 'line-width': 2, 'line-dasharray': [2, 2] }}
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
                'circle-color': colors.danger,
                'circle-stroke-width': 3,
                'circle-stroke-color': colors.textLight,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Final Positions */}
        {positionFeatures.length > 0 && (
          <GeoJSONSource id="final-positions" data={positionsData}>
            <Layer
              id="final-position-points"
              type="circle"
              paint={{
                'circle-radius': ['case', ['==', ['get', 'winner'], true], 12, 9],
                'circle-color': ['get', 'color'],
                'circle-opacity': ['case', ['==', ['get', 'tagged'], true], 0.55, 1],
                'circle-stroke-width': 3,
                'circle-stroke-color': [
                  'case',
                  ['==', ['get', 'tagged'], true],
                  colors.surface,
                  colors.textLight,
                ],
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      {/* Top Mission HUD */}
      <View style={[styles.topHud, { top: Math.max(insets.top, 16) + 8 }]}>
        <View style={styles.topHudRow}>
          <Chip
            label={
              isTerritoryPulse
                ? 'TERRITORY PULSE'
                : isGhostDuel
                  ? 'SOLO GHOST DUEL'
                  : isAssassinRing
                    ? 'ASSASSIN RING'
                    : isRelayHeist
                      ? 'RELAY HEIST'
                      : isJailbreak
                        ? 'JAILBREAK'
                        : game.mode === 'classic_chase'
                          ? 'CLASSIC CHASE'
                          : 'TAG HUNT'
            }
            variant="accent"
            size="sm"
          />
          <Chip label={`#${game.code}`} variant="default" size="sm" />
        </View>
        <Text variant="headline" color={outcomeAccent} style={{ marginTop: spacing.xs }}>
          {winnerTitle}
        </Text>
      </View>

      {/* Bottom Swipeable Cards Deck (Addendum C #4) */}
      <View style={[styles.bottomDeck, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {/* Pagination & Indicator Header */}
        <View style={styles.deckHeader}>
          <View style={styles.deckCategoryRow}>
            <Ionicons color={colors.primary} name="layers-outline" size={14} />
            <Text variant="caption" color={colors.primary} weight="bold">
              CARD {activeCardIndex + 1} OF {cardsCount} · {
                activeCardIndex === 0
                  ? 'OUTCOME DOSSIER'
                  : activeCardIndex === 1
                    ? 'MATCH HIGHLIGHTS'
                    : activeCardIndex === 2
                      ? 'TACTICAL DEBRIEF'
                      : activeCardIndex === 3
                        ? 'OPERATIVE ROSTER'
                        : activeCardIndex === 4
                          ? 'GHOST ARCHIVE'
                          : activeCardIndex === 5
                            ? 'MISSION RECAP'
                            : 'COMMAND ACTIONS'
              }
            </Text>
          </View>
          <View style={styles.indicatorDotsRow}>
            {Array.from({ length: cardsCount }).map((_, idx) => (
              <View
                key={idx}
                style={[
                  styles.dot,
                  idx === activeCardIndex && styles.activeDot,
                ]}
              />
            ))}
          </View>
        </View>

        {/* Horizontal Swipeable Card Scroller */}
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleCardScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.cardsScrollerContent}
        >
          {/* CARD 1: MISSION OUTCOME DOSSIER */}
          <View style={[styles.cardSlide, { width: CARD_WIDTH }]}>
            <Card variant="elevated" style={styles.cardInner}>
              <View style={styles.cardHeaderRow}>
                <Text variant="label" color={outcomeAccent}>
                  {isVictory ? 'MISSION ACCOMPLISHED' : 'MISSION CONCLUDED'}
                </Text>
                <Chip
                  label={game.end_reason?.replace('_', ' ').toUpperCase() || 'ENDED'}
                  variant="default"
                  size="sm"
                />
              </View>

              <Text variant="body" color={colors.text} style={{ marginTop: spacing.sm, lineHeight: 20 }}>
                {reasonCopy}
              </Text>

              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text variant="caption" color={colors.textMuted}>OPERATIONAL DURATION</Text>
                  <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                    {roundSeconds !== null && roundSeconds > 0 ? formatDuration(roundSeconds) : '—'}
                  </Text>
                </View>

                {isGhostDuel ? (
                  <>
                    <View style={styles.statBox}>
                      <Text variant="caption" color={colors.textMuted}>SPLIT DELTA</Text>
                      <Text variant="headline" color={colors.primary} style={{ marginTop: 2 }}>
                        {ghostScore?.delta_s !== undefined
                          ? `${ghostScore.delta_s > 0 ? '+' : ''}${ghostScore.delta_s.toFixed(1)}s`
                          : '—'}
                      </Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text variant="caption" color={colors.textMuted}>PERFORMANCE SCORE</Text>
                      <Text variant="headline" color={colors.primary} style={{ marginTop: 2 }}>
                        {ghostScore?.score ?? '—'}
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.statBox}>
                      <Text variant="caption" color={colors.textMuted}>OPERATIVES TAGGED</Text>
                      <Text variant="headline" color={colors.hunter} style={{ marginTop: 2 }}>
                        {taggedCount}
                      </Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text variant="caption" color={colors.textMuted}>TOTAL IN SQUAD</Text>
                      <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                        {players.length}
                      </Text>
                    </View>
                  </>
                )}
              </View>

              <Text variant="caption" color={colors.textSubtle} style={{ marginTop: spacing.md }}>
                Swipe left for match highlights and tactical telemetry →
              </Text>
            </Card>
          </View>

          {/* CARD 2: MATCH HIGHLIGHTS & STRATEGIC STATS */}
          <View style={[styles.cardSlide, { width: CARD_WIDTH }]}>
            <Card variant="elevated" style={styles.cardInner}>
              <Text variant="label" color={colors.primary} style={{ marginBottom: spacing.sm }}>
                PERSONAL TELEMETRY & HIGHLIGHTS
              </Text>

              <View style={styles.statsGrid}>
                {myPlayerStats && (
                  <View style={styles.statBoxHighlight}>
                    <Text variant="caption" color={colors.primary}>CLOSEST CALL</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {myPlayerStats.closest_call_m !== null
                        ? formatDistance(myPlayerStats.closest_call_m, unitSystem)
                        : myPlayerStats.share_trail === false
                          ? 'Private Route'
                          : '—'}
                    </Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                      {myPlayerStats.share_trail === false ? 'Route kept confidential' : 'Opponent nearest vector'}
                    </Text>
                  </View>
                )}

                {myPlayerStats?.best_bluff && (
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.warning}>BEST BLUFF</Text>
                    <Text variant="body" weight="bold" color={colors.textLight} style={{ marginTop: 2 }}>
                      {myPlayerStats.best_bluff.title}
                    </Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                      {myPlayerStats.best_bluff.detail}
                    </Text>
                  </View>
                )}

                {myPlayerStats && myPlayerStats.team === 'runner' && (
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>LONGEST UNSEEN</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {formatDuration(myPlayerStats.longest_unseen_s)}
                    </Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                      Undetected stealth streak
                    </Text>
                  </View>
                )}

                {myPlayerStats && (
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>PEAK NOISE LEVEL</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {myPlayerStats.loudest_noise}
                      <Text variant="caption" color={colors.textMuted}> / 100</Text>
                    </Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                      Acoustic telemetry max
                    </Text>
                  </View>
                )}

                {gameStats && gameStats.heat_stats.total_presses > 0 && (
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>HEAT HIT RATE</Text>
                    <Text variant="headline" color={colors.primary} style={{ marginTop: 2 }}>
                      {gameStats.heat_stats.hit_rate_pct}%
                    </Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                      {gameStats.heat_stats.hot_hits} of {gameStats.heat_stats.total_presses} probes hot
                    </Text>
                  </View>
                )}

                {gameStats && gameStats.total_drops_claimed > 0 && (
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>DROPS CLAIMED</Text>
                    <Text variant="headline" color={colors.primary} style={{ marginTop: 2 }}>
                      {myPlayerStats?.drops_claimed ?? 0}
                      <Text variant="caption" color={colors.textMuted}> / {gameStats.total_drops_claimed}</Text>
                    </Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                      Tactical field caches
                    </Text>
                  </View>
                )}
              </View>
            </Card>
          </View>

          {/* CARD 3: TACTICAL MODE DEBRIEF */}
          <View style={[styles.cardSlide, { width: CARD_WIDTH }]}>
            <Card variant="elevated" style={styles.cardInner}>
              <Text variant="label" color={colors.primary} style={{ marginBottom: spacing.sm }}>
                MODE DEBRIEF & PARAMETERS
              </Text>

              {isGhostDuel && ghostScore && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBoxHighlight}>
                    <Text variant="caption" color={colors.primary}>FINAL TIME TRIAL SCORE</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {ghostScore.score}
                    </Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                      {ghostScore.delta_s >= 0
                        ? `Beat ghost pace by ${ghostScore.delta_s.toFixed(1)}s`
                        : `Behind ghost pace by ${Math.abs(ghostScore.delta_s).toFixed(1)}s`}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>YOUR ELAPSED TIME</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {formatDuration(ghostScore.player_time_s)}
                    </Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                      Ghost: {formatDuration(ghostScore.ghost_time_s)}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>ROUTE EFFICIENCY</Text>
                    <Text variant="headline" color={colors.primary} style={{ marginTop: 2 }}>
                      {Math.round(ghostScore.efficiency * 100)}%
                    </Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                      Direct vs traveled vector
                    </Text>
                  </View>
                </View>
              )}

              {isTerritoryPulse && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBoxHighlight}>
                    <Text variant="caption" color={colors.primary}>TERRITORY CONTROL OUTCOME</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {game.end_reason === 'territory_dominance' ? 'DOMINANCE' : 'POINTS'}
                    </Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                      {game.winner === 'runners' ? 'Runners Victory' : game.winner === 'hunters' ? 'Hunters Victory' : 'Draw'}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>SECTORS</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>7</Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>Radial map grid</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>THRESHOLD</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>70%</Text>
                    <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>Dominance pulse</Text>
                  </View>
                </View>
              )}

              {isRelayHeist && gameStats?.mode_recap && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBoxHighlight}>
                    <Text variant="caption" color={colors.primary}>PACKAGE STATUS</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {gameStats.mode_recap.package_secured
                        ? 'SECURED BY HUNTERS'
                        : game.end_reason === 'extraction_complete'
                          ? 'EXTRACTED BY RUNNERS'
                          : 'INTERCEPTED'}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>SQUAD HANDOFFS</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {gameStats.mode_recap.total_handoffs ?? 0}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>PACKAGE DROPS</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {gameStats.mode_recap.package_drops ?? 0}
                    </Text>
                  </View>
                </View>
              )}

              {isJailbreak && gameStats?.mode_recap && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBoxHighlight}>
                    <Text variant="caption" color={colors.primary}>JAILBREAK OUTCOME</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {game.end_reason === 'all_jailed' ? 'ALL JAILED' : 'PRISONERS ESCAPED'}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>RESCUES TRIGGERED</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {gameStats.mode_recap.total_rescues ?? 0}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>TOTAL JAILED</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {gameStats.mode_recap.total_jailed ?? 0}
                    </Text>
                  </View>
                </View>
              )}

              {gameStats?.mode_recap?.ai_gm && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBoxHighlight}>
                    <Text variant="caption" color={colors.primary}>AI GAME MASTER INTERVENTIONS</Text>
                    <Text variant="headline" color={colors.textLight} style={{ marginTop: 2 }}>
                      {gameStats.mode_recap.ai_gm.total_events} / {gameStats.mode_recap.ai_gm.max_events}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>LAST DISPATCH</Text>
                    <Text variant="body" weight="bold" color={colors.textLight} style={{ marginTop: 2, textTransform: 'uppercase' }}>
                      {gameStats.mode_recap.ai_gm.last_event_type?.replace('_', ' ') || 'None'}
                    </Text>
                  </View>
                </View>
              )}

              {!isGhostDuel && !isTerritoryPulse && !isRelayHeist && !isJailbreak && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>EXTRACTION TARGET</Text>
                    <Text variant="body" color={colors.textLight} style={{ marginTop: 2 }}>
                      {target ? 'Placed & Infiltrated' : 'None Configured'}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text variant="caption" color={colors.textMuted}>RADAR PING INTERVAL</Text>
                    <Text variant="body" color={colors.textLight} style={{ marginTop: 2 }}>
                      Standard 10s Pings
                    </Text>
                  </View>
                </View>
              )}
            </Card>
          </View>

          {/* CARD 4: OPERATIVE ROSTER & SECRECY LIFT */}
          <View style={[styles.cardSlide, { width: CARD_WIDTH }]}>
            <Card variant="elevated" style={styles.cardInner}>
              <View style={styles.cardHeaderRow}>
                <Text variant="label" color={colors.primary}>
                  SECRECY LIFTED // OPERATIVE ROSTER ({players.length})
                </Text>
                <Chip label="UNCLASSIFIED" variant="default" size="sm" />
              </View>

              <ScrollView style={{ maxHeight: 220, marginTop: spacing.sm }}>
                {players.map((player) => {
                  const position = positions.find((entry) => entry.player_id === player.id);
                  const isWinner = player.id === winnerId;
                  const isAgent = player.secret_role === 'agent';

                  return (
                    <View key={player.id} style={styles.playerRow}>
                      <View style={[styles.playerDot, { backgroundColor: player.color }]} />
                      <View style={{ flex: 1, marginLeft: spacing.sm }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text variant="body" weight="bold" color={colors.textLight}>
                            {player.display_name}
                          </Text>
                          {player.user_id === game.host_id && (
                            <MaterialCommunityIcons color={colors.warning} name="crown" size={13} />
                          )}
                          {isAgent && (
                            <Chip label="DOUBLE AGENT" variant="accent" size="sm" />
                          )}
                          {player.secret_role === 'vip' && (
                            <Chip label="VIP" variant="accent" size="sm" />
                          )}
                          {player.secret_role === 'bodyguard' && (
                            <Chip label="GUARD" variant="default" size="sm" />
                          )}
                          {player.id === state.my_player_id && (
                            <Text variant="caption" color={colors.primary}>(you)</Text>
                          )}
                        </View>
                        <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                          {teamLabel(player.team)} · {position ? 'Position recorded' : 'No fix'}
                        </Text>
                      </View>
                      <Text
                        variant="caption"
                        weight="bold"
                        color={
                          isWinner
                            ? colors.success
                            : player.status === 'tagged'
                              ? colors.danger
                              : colors.textMuted
                        }
                      >
                        {isWinner ? 'Reached Target' : player.status === 'tagged' ? 'Tagged' : teamLabel(player.team)}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            </Card>
          </View>

          {/* CARD 5: GHOST LIBRARY CONTRIBUTION */}
          <View style={[styles.cardSlide, { width: CARD_WIDTH }]}>
            <Card variant="elevated" style={styles.cardInner}>
              <View style={styles.cardHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialCommunityIcons color={colors.ghostTrail} name="ghost" size={18} />
                  <Text variant="label" color={colors.ghostTrail}>
                    GHOST LIBRARY CONTRIBUTION
                  </Text>
                </View>
                <Chip label="PRIVACY BUFFER" variant="default" size="sm" />
              </View>

              {ghostPreview && ghostPreview.can_contribute && !ghostDismissed && !ghostPermanentlyDeclined ? (
                <>
                  {ghostSuccess || ghostPreview.already_contributed ? (
                    <View style={styles.ghostStatusBox}>
                      <Ionicons color={colors.success} name="checkmark-circle" size={20} />
                      <Text variant="body" color={colors.text} style={{ marginLeft: spacing.sm, flex: 1 }}>
                        {ghostSuccess
                          ? 'Thank you! Route trimmed by 150m and contributed to the solo training archive.'
                          : 'This route is already archived in the ghost library.'}
                      </Text>
                    </View>
                  ) : (
                    <>
                      <Text variant="body" color={colors.text} style={{ marginTop: spacing.sm, lineHeight: 19 }}>
                        Help solo operatives train against authentic pace. Your path is anonymized and trimmed by 150m at start and end.
                      </Text>

                      <View style={[styles.statsGrid, { marginVertical: spacing.md }]}>
                        <View style={styles.statBox}>
                          <Text variant="caption" color={colors.textMuted}>TRIMMED LENGTH</Text>
                          <Text variant="body" weight="bold" color={colors.textLight}>
                            {formatDistance(ghostPreview.trimmed_length_m, unitSystem)}
                          </Text>
                        </View>
                        <View style={styles.statBox}>
                          <Text variant="caption" color={colors.textMuted}>DURATION</Text>
                          <Text variant="body" weight="bold" color={colors.textLight}>
                            {formatDuration(ghostPreview.duration_s)}
                          </Text>
                        </View>
                        <View style={styles.statBox}>
                          <Text variant="caption" color={colors.textMuted}>DIFFICULTY</Text>
                          <Text variant="body" weight="bold" color={colors.textLight} style={{ textTransform: 'capitalize' }}>
                            {ghostPreview.difficulty}
                          </Text>
                        </View>
                      </View>

                      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                        <Button
                          title={ghostBusy ? 'Archiving…' : 'Contribute Route'}
                          variant="primary"
                          size="sm"
                          disabled={ghostBusy}
                          onPress={() => void handleContributeGhost()}
                        />
                        <Button
                          title="Not Now"
                          variant="secondary"
                          size="sm"
                          onPress={() => setGhostDismissed(true)}
                        />
                        <Button
                          title="Never"
                          variant="secondary"
                          size="sm"
                          onPress={() => void handleNeverAskGhost()}
                        />
                      </View>
                    </>
                  )}
                </>
              ) : (
                <View style={styles.ghostStatusBox}>
                  <MaterialCommunityIcons color={colors.textMuted} name="shield-check" size={20} />
                  <Text variant="body" color={colors.textMuted} style={{ marginLeft: spacing.sm, flex: 1 }}>
                    Ghost contribution is {ghostPermanentlyDeclined ? 'permanently disabled in your privacy settings' : 'reserved for runner routes with sufficient length'}.
                  </Text>
                </View>
              )}
            </Card>
          </View>

          {/* CARD 6: SHAREABLE RECAP CARD PLACEHOLDER (Addendum C #4) */}
          <View style={[styles.cardSlide, { width: CARD_WIDTH }]}>
            <Card variant="elevated" style={styles.cardInner}>
              <View style={styles.cardHeaderRow}>
                <Text variant="label" color={colors.primary}>
                  MISSION RECAP CARD // EXPORT
                </Text>
                <Chip label="PREVIEW" variant="accent" size="sm" />
              </View>

              {/* Shareable Card Visual Frame */}
              <View style={styles.recapCardPreview}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="headline" color={colors.primary}>GHOSTRUN</Text>
                  <Chip label={winnerTitle.toUpperCase()} variant="accent" size="sm" />
                </View>

                <View style={{ marginVertical: spacing.md }}>
                  <Text variant="body" weight="bold" color={colors.textLight}>
                    OPERATIVE: {playerById.get(state.my_player_id)?.display_name || 'CLASSIFIED'}
                  </Text>
                  <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                    MODE: {game.mode.toUpperCase()} · CODE: #{game.code}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View>
                    <Text variant="caption" color={colors.textMuted}>TIME</Text>
                    <Text variant="body" weight="bold" color={colors.textLight}>
                      {roundSeconds ? formatDuration(roundSeconds) : '—'}
                    </Text>
                  </View>
                  <View>
                    <Text variant="caption" color={colors.textMuted}>SQUAD</Text>
                    <Text variant="body" weight="bold" color={colors.textLight}>
                      {players.length} PLAYERS
                    </Text>
                  </View>
                  <View>
                    <Text variant="caption" color={colors.textMuted}>STATUS</Text>
                    <Text variant="body" weight="bold" color={outcomeAccent}>
                      {isVictory ? 'VICTORIOUS' : 'COMPLETED'}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ marginTop: spacing.md }}>
                <Button
                  title={shareRecapFeedback ? 'Recap Card Export Ready (Phase D)' : 'Share Mission Recap'}
                  variant="primary"
                  size="md"
                  onPress={() => setShareRecapFeedback(true)}
                />
                <Text variant="caption" color={colors.textMuted} style={{ textAlign: 'center', marginTop: spacing.xs }}>
                  Card sharing slot (Addendum C #4) — Image generation enabled in Phase D.
                </Text>
              </View>
            </Card>
          </View>

          {/* CARD 7: MISSION COMMAND ACTIONS & REMATCH */}
          <View style={[styles.cardSlide, { width: CARD_WIDTH }]}>
            <Card variant="elevated" style={styles.cardInner}>
              <Text variant="label" color={colors.primary} style={{ marginBottom: spacing.sm }}>
                MISSION ACTIONS & REMATCH
              </Text>

              {rematchError !== '' && (
                <Text variant="body" color={colors.danger} style={{ marginBottom: spacing.sm }}>
                  {rematchError}
                </Text>
              )}

              <View style={{ gap: spacing.sm }}>
                <Button
                  title={rematchBusy ? 'Opening Rematch Lobby…' : 'Play Again (Rematch)'}
                  variant="primary"
                  size="lg"
                  disabled={rematchBusy}
                  onPress={() => void playAgain()}
                />
                <Button
                  title="Watch Replay (±15s Controls)"
                  variant="secondary"
                  size="md"
                  onPress={() => router.push({ pathname: '/replay/[id]', params: { id: gameId } })}
                />
                <Button
                  title="Return to Base (Play)"
                  variant="secondary"
                  size="sm"
                  onPress={() => router.replace('/play' as any)}
                />
              </View>

              <Text variant="caption" color={colors.textSubtle} style={{ marginTop: spacing.md, lineHeight: 16 }}>
                Routes are recorded by the server at 10-second intervals. Final positions reflect the last valid fixes stored before the round concluded.
              </Text>
            </Card>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  topHud: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    left: spacing.base,
    padding: spacing.md,
    position: 'absolute',
    right: spacing.base,
    top: spacing.xl + spacing.base,
    zIndex: 10,
  },
  topHudRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bottomDeck: {
    backgroundColor: colors.surfaceDark,
    borderColor: colors.border,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    maxHeight: '56%',
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
    position: 'absolute',
    right: 0,
    zIndex: 10,
  },
  deckHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
  },
  deckCategoryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  indicatorDotsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  dot: {
    backgroundColor: colors.borderDark,
    borderRadius: radii.full,
    height: 6,
    width: 6,
  },
  activeDot: {
    backgroundColor: colors.primary,
    width: 14,
  },
  cardsScrollerContent: {
    paddingHorizontal: spacing.base,
    gap: spacing.md,
  },
  cardSlide: {
    flex: 1,
  },
  cardInner: {
    padding: spacing.md,
  },
  cardHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statBox: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    minWidth: '45%',
    padding: spacing.sm,
  },
  statBoxHighlight: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.borderAccent,
    borderRadius: radii.md,
    borderWidth: 1,
    width: '100%',
    padding: spacing.sm,
  },
  playerRow: {
    alignItems: 'center',
    borderBottomColor: colors.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
  playerDot: {
    borderRadius: radii.full,
    height: 10,
    width: 10,
  },
  ghostStatusBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  recapCardPreview: {
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.base,
  },
});

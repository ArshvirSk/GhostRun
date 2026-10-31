import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '../../src/lib/map';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  circleRing,
  distanceM,
  type LngLat,
  type PointCollection,
  type PointFeature,
} from '../../src/lib/geo';
import { stopLocationSharing } from '../../src/lib/location';
import { supabase } from '../../src/lib/supabase';

const MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

type Team = 'runner' | 'hunter' | 'unassigned';

type GamePlayer = {
  id: string;
  user_id: string;
  display_name: string;
  color: string;
  team: Team;
  status: 'active' | 'tagged' | 'left';
  is_ready: boolean;
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
    mode: 'classic_chase' | 'tag_hunt';
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

export default function ResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const gameId = Array.isArray(id) ? id[0] : id;

  const [state, setState] = useState<RoundResultState | null>(null);
  const [trails, setTrails] = useState<TrailPoint[]>([]);
  const [loadingTrails, setLoadingTrails] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [trailError, setTrailError] = useState('');
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchError, setRematchError] = useState('');
  const mountedRef = useRef(true);
  const leavingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A result is terminal. The background task would otherwise keep uploading
  // the player's position after the round has already ended.
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
      setLoadingTrails(false);
      return;
    }

    setLoadingTrails(true);
    const { data: trailData, error: trailLoadError } = await supabase.rpc('get_game_trails', {
      game_id: gameId,
    });
    if (!mountedRef.current) return;
    if (trailLoadError) {
      setTrailError(trailLoadError.message);
    } else {
      setTrails((trailData as TrailPoint[] | null) ?? []);
      setTrailError('');
    }
    setLoadingTrails(false);
  }, [gameId]);

  useEffect(() => {
    const initialLoad = setTimeout(() => void load(), 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  // A direct link can arrive before the round is over. The live screen owns
  // those phases; the result screen only renders a finished game.
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
      router.replace('/home');
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

  // A rematch is created for the whole crew at once, so players who stay on the
  // result follow the finished game's pointer into the fresh lobby.
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

  if (!gameId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Game not found.</Text>
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

  if (state.game.status !== 'ended') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1D4ED8" size="large" />
        <Text style={styles.loadingText}>Loading the result…</Text>
      </View>
    );
  }

  const game = state.game;
  const target = state.target;
  const players = state.players;
  const positions = state.positions;
  const zoom = Math.max(10, Math.min(16, 15 - Math.log2(game.area.radius_m / 200)));

  const winnerTitle =
    game.winner === 'runners'
      ? 'Runners win'
      : game.winner === 'hunters'
        ? 'Hunters win'
        : 'Round over';
  const accent =
    game.winner === 'runners' ? '#059669' : game.winner === 'hunters' ? '#B91C1C' : '#475569';
  const reasonCopy =
    game.end_reason === 'target_reached'
      ? 'A runner reached the secret target.'
      : game.end_reason === 'all_tagged'
        ? 'Every runner was tagged.'
        : game.end_reason === 'all_hunters_left'
          ? 'Every hunter left the round.'
          : game.end_reason === 'time_expired'
            ? game.mode === 'classic_chase'
              ? 'Time ran out before the runners reached the target.'
              : 'Time ran out. The runners stayed hidden.'
            : 'This round has finished.';

  // Time expiry is stamped when a client next reads state, which can be later
  // than the actual finish; the scheduled end is the honest round length.
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

  const recapCopy = loadingTrails
    ? 'Loading the recorded routes…'
    : trails.length === 0
      ? 'No trail points were recorded for this round. The dots are the final positions.'
      : trailFeatures.length === 0
        ? `${trails.length} trail point${
            trails.length === 1 ? '' : 's'
          } recorded; a route needs at least two. The dots are still the final positions.`
        : `${trailFeatures.length} route${trailFeatures.length === 1 ? '' : 's'} · ${
            trails.length
          } recorded point${
            trails.length === 1 ? '' : 's'
          }. Colored lines join each player’s recorded fixes; dots are their final positions.`;

  return (
    <View style={styles.screen}>
      <MapLibreMap attribution mapStyle={MAP_STYLE} style={StyleSheet.absoluteFill}>
        <Camera
          initialViewState={{
            center: [game.area.longitude, game.area.latitude],
            zoom,
          }}
        />
        <GeoJSONSource id="play-area" data={circleRing(game.area, game.area.radius_m)}>
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

        {trailFeatures.length > 0 && (
          <GeoJSONSource id="trails" data={trailsData}>
            <Layer
              id="trail-lines"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': ['get', 'color'],
                'line-width': 3,
                'line-opacity': 0.72,
              }}
            />
          </GeoJSONSource>
        )}

        {target && (
          <GeoJSONSource id="target-radius" data={circleRing(target, game.target_radius_m)}>
            <Layer
              id="target-radius-fill"
              type="fill"
              paint={{ 'fill-color': '#DB2777', 'fill-opacity': 0.1 }}
            />
            <Layer
              id="target-radius-line"
              type="line"
              paint={{ 'line-color': '#DB2777', 'line-width': 2, 'line-dasharray': [2, 2] }}
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
                  '#0F172A',
                  '#FFFFFF',
                ],
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      <View style={styles.hud}>
        <Text style={[styles.eyebrow, { color: accent }]}>
          {game.mode === 'classic_chase' ? 'CLASSIC CHASE' : 'TAG HUNT'} · {game.code}
        </Text>
        <Text style={[styles.title, { color: accent }]}>{winnerTitle}</Text>
        <Text style={styles.subtitle}>{reasonCopy}</Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>ROUND TIME</Text>
            <Text style={styles.statValue}>
              {roundSeconds !== null && roundSeconds > 0 ? formatDuration(roundSeconds) : '—'}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>TAGGED</Text>
            <Text style={styles.statValue}>{taggedCount}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>PLAYERS</Text>
            <Text style={styles.statValue}>{players.length}</Text>
          </View>
        </View>

        {errorMessage !== '' && (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorMessage}
          </Text>
        )}
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent}>
        <Text style={styles.sectionLabel}>ROUND RECAP</Text>
        <Text style={styles.recapText}>{recapCopy}</Text>

        {target && (
          <View style={styles.targetCard}>
            <View style={styles.targetDot} />
            <View style={styles.targetDetails}>
              <Text style={styles.targetTitle}>Target revealed</Text>
              <Text style={styles.targetBody}>
                {game.end_reason === 'target_reached'
                  ? 'The pink ring is the place the winning runner reached.'
                  : 'The pink ring is where the runners had to finish.'}
              </Text>
            </View>
          </View>
        )}

        {trailError !== '' && (
          <Text accessibilityRole="alert" style={styles.error}>
            Routes could not be loaded: {trailError}
          </Text>
        )}
        {loadingTrails && (
          <ActivityIndicator color="#1D4ED8" size="small" style={styles.trailSpinner} />
        )}

        <View style={styles.legendRow}>
          <View style={[styles.legendLine, { backgroundColor: '#1D4ED8' }]} />
          <Text style={styles.legendText}>Recorded route</Text>
          <View style={[styles.legendDot, { backgroundColor: '#475569' }]} />
          <Text style={styles.legendText}>Final position</Text>
          {target && <View style={[styles.legendDot, { backgroundColor: '#DB2777' }]} />}
          {target && <Text style={styles.legendText}>Target</Text>}
        </View>

        <Text style={styles.sectionLabel}>FINAL POSITIONS · {positions.length}</Text>
        {players.map((player) => {
          const position = positions.find((entry) => entry.player_id === player.id);
          const isWinner = player.id === winnerId;
          return (
            <View key={player.id} style={styles.playerRow}>
              <View style={[styles.playerDot, { backgroundColor: player.color }]} />
              <View style={styles.playerText}>
                <View style={styles.playerNameRow}>
                  <Text style={styles.playerName}>{player.display_name}</Text>
                  {player.user_id === game.host_id && (
                    <MaterialCommunityIcons color="#EAB308" name="crown" size={13} />
                  )}
                  {player.id === state.my_player_id && <Text style={styles.playerYou}>(you)</Text>}
                </View>
                <Text style={styles.playerSub}>
                  {teamLabel(player.team)} ·{' '}
                  {position ? 'Final position recorded' : 'No final position'}
                </Text>
              </View>
              <Text
                style={[
                  styles.playerMeta,
                  isWinner && styles.playerWinner,
                  !isWinner && player.status === 'tagged' && styles.playerTagged,
                ]}
              >
                {isWinner
                  ? 'Reached target'
                  : player.status === 'tagged'
                    ? 'Tagged'
                    : teamLabel(player.team)}
              </Text>
            </View>
          );
        })}

        <Pressable
          accessibilityRole="button"
          disabled={rematchBusy}
          onPress={() => void playAgain()}
          style={styles.playAgainButton}
        >
          {rematchBusy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.playAgainText}>Play again</Text>
          )}
        </Pressable>
        <Text style={styles.playAgainHint}>
          {game.mode === 'classic_chase'
            ? 'Same crew, sides and settings. A runner picks a new target in the fresh lobby.'
            : 'Same crew, sides and settings. The fresh lobby starts a new Tag Hunt.'}
        </Text>
        {rematchError !== '' && (
          <Text accessibilityRole="alert" style={styles.error}>
            {rematchError}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/replay/[id]', params: { id: gameId } })}
          style={styles.replayButton}
        >
          <Text style={styles.replayText}>Watch replay</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/home')}
          style={styles.homeLink}
        >
          <Text style={styles.homeLinkText}>Back to home</Text>
        </Pressable>

        <Text style={styles.footer}>
          Routes are the trail recorded by the server, at most one point every ten seconds. Final
          positions are the last fixes stored before the round ended.
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
  title: { fontSize: 30, fontWeight: '900', letterSpacing: 0.2, marginTop: 4 },
  subtitle: { color: '#475569', fontSize: 13, lineHeight: 19, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 22, marginTop: 14 },
  stat: { flexShrink: 1 },
  statLabel: { color: '#64748B', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  statValue: { color: '#0F172A', fontSize: 22, fontWeight: '900', marginTop: 2 },
  error: { color: '#B91C1C', fontSize: 13, lineHeight: 19, marginTop: 10 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    bottom: 0,
    left: 0,
    maxHeight: '46%',
    position: 'absolute',
    right: 0,
  },
  sheetContent: { padding: 20, paddingBottom: 30 },
  sectionLabel: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginBottom: 6,
    marginTop: 8,
  },
  recapText: { color: '#475569', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  targetCard: {
    alignItems: 'flex-start',
    backgroundColor: '#FDF2F8',
    borderRadius: 14,
    flexDirection: 'row',
    marginBottom: 12,
    padding: 12,
  },
  targetDot: { backgroundColor: '#DB2777', borderRadius: 5, height: 10, marginTop: 4, width: 10 },
  targetDetails: { flex: 1, marginLeft: 10 },
  targetTitle: { color: '#831843', fontSize: 14, fontWeight: '900' },
  targetBody: { color: '#9D174D', fontSize: 12, lineHeight: 17, marginTop: 3 },
  trailSpinner: { alignSelf: 'flex-start', marginBottom: 10 },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
    marginTop: 2,
  },
  legendLine: { borderRadius: 2, height: 3, width: 16 },
  legendDot: { borderRadius: 5, height: 9, width: 9 },
  legendText: { color: '#64748B', fontSize: 11, fontWeight: '700', marginRight: 6 },
  playerRow: {
    alignItems: 'center',
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 52,
    paddingVertical: 6,
  },
  playerDot: { borderRadius: 5, height: 10, width: 10 },
  playerText: { flex: 1, marginLeft: 8 },
  playerNameRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  playerName: { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  playerYou: { color: '#64748B', fontSize: 11, fontWeight: '600' },
  playerSub: { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginTop: 2 },
  playerMeta: { color: '#475569', fontSize: 12, fontWeight: '800' },
  playerWinner: { color: '#047857' },
  playerTagged: { color: '#B91C1C' },
  playAgainButton: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 13,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 50,
  },
  playAgainText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  playAgainHint: { color: '#64748B', fontSize: 11, lineHeight: 17, marginTop: 7 },
  replayButton: {
    alignItems: 'center',
    borderColor: '#1D4ED8',
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 50,
  },
  replayText: { color: '#1D4ED8', fontSize: 15, fontWeight: '900' },
  homeLink: { alignItems: 'center', justifyContent: 'center', marginTop: 4, minHeight: 44 },
  homeLinkText: { color: '#475569', fontSize: 15, fontWeight: '700' },
  footer: { color: '#94A3B8', fontSize: 11, lineHeight: 17, marginTop: 14 },
  linkButton: { alignItems: 'center', justifyContent: 'center', marginTop: 16, minHeight: 44 },
  linkText: { color: '#1D4ED8', fontSize: 15, fontWeight: '700' },
});

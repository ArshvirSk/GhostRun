import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '@maplibre/maplibre-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  circleRing,
  type LngLat,
  type PointCollection,
  type PointFeature,
} from '../../src/lib/geo';
import { stopLocationSharing } from '../../src/lib/location';
import { supabase } from '../../src/lib/supabase';

const MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

type Team = 'runner' | 'hunter' | 'unassigned';

type ReplayState = {
  game: {
    id: string;
    code: string;
    mode: 'classic_chase' | 'tag_hunt';
    status: string;
    winner: 'runners' | 'hunters' | null;
    end_reason: string | null;
    live_at: string | null;
    ends_at: string | null;
    ended_at: string | null;
    target_radius_m: number;
    area: LngLat & { radius_m: number };
  };
  players: {
    id: string;
    user_id: string;
    display_name: string;
    color: string;
    team: Team;
    status: 'active' | 'tagged' | 'left';
  }[];
  positions: {
    player_id: string;
    longitude: number;
    latitude: number;
    color: string;
    recorded_at: string;
  }[];
  target: LngLat | null;
};

type TrailPoint = {
  player_id: string;
  longitude: number;
  latitude: number;
  recorded_at: string;
};

type ReplayTag = {
  id: number;
  hunter_id: string;
  runner_id: string;
  hunter_name: string;
  runner_name: string;
  distance_m: number;
  tagged_at: string;
};

type ReplayPing = {
  id: number;
  seq: number;
  player_id: string;
  display_name: string;
  color: string;
  longitude: number;
  latitude: number;
  accuracy_m: number | null;
  position_age_s: number | null;
  reason: 'scheduled' | 'boundary';
  released_at: string;
};

type ReplayData = {
  tags: ReplayTag[];
  pings: ReplayPing[];
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

type ReplayEvent =
  { kind: 'tag'; at: number; tag: ReplayTag } | { kind: 'ping'; at: number; ping: ReplayPing };

type TimelineMarker = {
  key: string;
  position: number;
  color: string;
  height: number;
  top: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function TimelineScrubber({
  duration,
  value,
  markers,
  onChange,
}: {
  duration: number;
  value: number;
  markers: TimelineMarker[];
  onChange: (seconds: number) => void;
}) {
  const widthRef = useRef(0);
  const durationRef = useRef(duration);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const seekFromEvent = (event: GestureResponderEvent) => {
    const width = widthRef.current;
    if (width <= 0) return;
    onChangeRef.current(
      clamp((event.nativeEvent.locationX / width) * durationRef.current, 0, durationRef.current),
    );
  };

  const progress = duration > 0 ? clamp(value / duration, 0, 1) : 0;

  return (
    <View
      accessibilityLabel="Replay timeline"
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(value) }}
      onLayout={(event) => {
        widthRef.current = event.nativeEvent.layout.width;
      }}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={seekFromEvent}
      onResponderMove={seekFromEvent}
      onStartShouldSetResponder={() => true}
      style={styles.track}
    >
      <View pointerEvents="none" style={styles.rail} />
      <View pointerEvents="none" style={[styles.railFill, { width: `${progress * 100}%` }]} />
      {markers.map((marker) => (
        <View
          key={marker.key}
          pointerEvents="none"
          style={[
            styles.marker,
            {
              backgroundColor: marker.color,
              height: marker.height,
              left: `${clamp(marker.position, 0, 1) * 100}%`,
              top: marker.top,
            },
          ]}
        />
      ))}
      <View pointerEvents="none" style={[styles.thumb, { left: `${progress * 100}%` }]} />
    </View>
  );
}

export default function ReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const gameId = Array.isArray(id) ? id[0] : id;

  const [state, setState] = useState<ReplayState | null>(null);
  const [trails, setTrails] = useState<TrailPoint[]>([]);
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [trailError, setTrailError] = useState('');
  const [replayError, setReplayError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);

  const mountedRef = useRef(true);
  const cursorRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The replay is a terminal view; never leave the background tracker alive.
  useEffect(() => {
    void stopLocationSharing();
  }, []);

  const load = useCallback(async () => {
    if (!gameId) return;
    if (!supabase) {
      setErrorMessage('Supabase is not configured in this build.');
      setLoading(false);
      return;
    }

    const stateResult = await supabase.rpc('get_game_state', { game_id: gameId });
    if (!mountedRef.current) return;
    if (stateResult.error) {
      setErrorMessage(stateResult.error.message);
      setLoading(false);
      return;
    }

    const snapshot = stateResult.data as ReplayState;
    setState(snapshot);
    setErrorMessage('');

    if (snapshot.game.status !== 'ended') {
      setLoading(false);
      return;
    }

    const [trailResult, replayResult] = await Promise.all([
      supabase.rpc('get_game_trails', { game_id: gameId }),
      supabase.rpc('get_game_replay', { game_id: gameId }),
    ]);
    if (!mountedRef.current) return;

    if (trailResult.error) setTrailError(trailResult.error.message);
    else {
      setTrails((trailResult.data as TrailPoint[] | null) ?? []);
      setTrailError('');
    }

    if (replayResult.error) setReplayError(replayResult.error.message);
    else {
      setReplay(replayResult.data as ReplayData);
      setReplayError('');
    }
    setLoading(false);
  }, [gameId]);

  useEffect(() => {
    const initialLoad = setTimeout(() => void load(), 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

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

  const game = state?.game ?? null;
  const liveAtMs = game?.live_at ? Date.parse(game.live_at) : NaN;
  const finishIso =
    game?.end_reason === 'time_expired' ? game?.ends_at : (game?.ended_at ?? game?.ends_at ?? null);
  const finishMs = finishIso ? Date.parse(finishIso) : NaN;
  const hasTimeline = Number.isFinite(liveAtMs) && Number.isFinite(finishMs) && finishMs > liveAtMs;
  const durationS = hasTimeline ? (finishMs - liveAtMs) / 1000 : 0;
  const cursorS = durationS > 0 ? clamp(cursor, 0, durationS) : 0;
  const cursorMs = hasTimeline ? liveAtMs + cursorS * 1000 : Number.POSITIVE_INFINITY;

  const seek = useCallback(
    (seconds: number) => {
      const next = clamp(seconds, 0, durationS);
      cursorRef.current = next;
      setCursor(next);
    },
    [durationS],
  );

  useEffect(() => {
    if (!playing || durationS <= 0) return;
    const tick = setInterval(() => {
      const next = Math.min(durationS, cursorRef.current + (speed * 250) / 1000);
      cursorRef.current = next;
      setCursor(next);
      if (next >= durationS) setPlaying(false);
    }, 250);
    return () => clearInterval(tick);
  }, [durationS, playing, speed]);

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
    const features: TrailFeature[] = [];
    if (!state) return features;
    for (const player of state.players) {
      const points = (trailsByPlayer.get(player.id) ?? []).filter(
        (point) => !hasTimeline || Date.parse(point.recorded_at) <= cursorMs,
      );
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
  }, [state, trailsByPlayer, cursorMs, hasTimeline]);

  const taggedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tag of replay?.tags ?? []) {
      if (!hasTimeline || Date.parse(tag.tagged_at) <= cursorMs) ids.add(tag.runner_id);
    }
    return ids;
  }, [replay, cursorMs, hasTimeline]);

  const positionFeatures = useMemo(() => {
    const features: PointFeature[] = [];
    if (!state) return features;
    for (const player of state.players) {
      const finalPosition = state.positions.find((position) => position.player_id === player.id);
      let longitude: number | null = null;
      let latitude: number | null = null;

      if (hasTimeline && cursorS >= durationS && finalPosition) {
        longitude = finalPosition.longitude;
        latitude = finalPosition.latitude;
      } else {
        const points = trailsByPlayer.get(player.id) ?? [];
        let last: TrailPoint | null = null;
        for (const point of points) {
          if (!hasTimeline || Date.parse(point.recorded_at) <= cursorMs) last = point;
          else break;
        }
        if (last) {
          longitude = last.longitude;
          latitude = last.latitude;
        } else if (!hasTimeline && finalPosition) {
          longitude = finalPosition.longitude;
          latitude = finalPosition.latitude;
        }
      }

      if (longitude === null || latitude === null) continue;
      features.push({
        type: 'Feature',
        properties: { color: player.color, tagged: taggedIds.has(player.id) },
        geometry: { type: 'Point', coordinates: [longitude, latitude] },
      });
    }
    return features;
  }, [state, trailsByPlayer, cursorMs, hasTimeline, cursorS, durationS, taggedIds]);

  const pingFeatures = useMemo(() => {
    const features: PointFeature[] = [];
    for (const ping of replay?.pings ?? []) {
      const releasedAt = Date.parse(ping.released_at);
      if (hasTimeline && releasedAt > cursorMs) continue;
      const ageS = hasTimeline
        ? Math.max(0, (cursorMs - releasedAt) / 1000) + (ping.position_age_s ?? 0)
        : 0;
      features.push({
        type: 'Feature',
        properties: { age_s: ageS, reason: ping.reason },
        geometry: { type: 'Point', coordinates: [ping.longitude, ping.latitude] },
      });
    }
    return features;
  }, [replay, cursorMs, hasTimeline]);

  const tagFeatures = useMemo(() => {
    const features: PointFeature[] = [];
    for (const tag of replay?.tags ?? []) {
      const taggedAt = Date.parse(tag.tagged_at);
      if (hasTimeline && taggedAt > cursorMs) continue;
      const points = trailsByPlayer.get(tag.runner_id) ?? [];
      let atTag: TrailPoint | null = null;
      for (const point of points) {
        if (Date.parse(point.recorded_at) <= taggedAt) atTag = point;
        else break;
      }
      if (!atTag) continue;
      features.push({
        type: 'Feature',
        properties: { runner: tag.runner_name },
        geometry: { type: 'Point', coordinates: [atTag.longitude, atTag.latitude] },
      });
    }
    return features;
  }, [replay, trailsByPlayer, cursorMs, hasTimeline]);

  const markers = useMemo(() => {
    const result: TimelineMarker[] = [];
    if (!hasTimeline || durationS <= 0) return result;
    const offset = (iso: string) => clamp((Date.parse(iso) - liveAtMs) / 1000, 0, durationS);
    for (const tag of replay?.tags ?? []) {
      result.push({
        key: `tag-${tag.id}`,
        position: offset(tag.tagged_at) / durationS,
        color: '#DC2626',
        height: 24,
        top: 2,
      });
    }
    for (const ping of replay?.pings ?? []) {
      result.push({
        key: `ping-${ping.id}`,
        position: offset(ping.released_at) / durationS,
        color: ping.reason === 'boundary' ? '#F59E0B' : '#DB2777',
        height: 10,
        top: 18,
      });
    }
    return result;
  }, [replay, hasTimeline, durationS, liveAtMs]);

  const events = useMemo(() => {
    const result: ReplayEvent[] = [];
    if (!hasTimeline || durationS <= 0) return result;
    const offset = (iso: string) => clamp((Date.parse(iso) - liveAtMs) / 1000, 0, durationS);
    for (const tag of replay?.tags ?? []) {
      result.push({ kind: 'tag', at: offset(tag.tagged_at), tag });
    }
    for (const ping of replay?.pings ?? []) {
      result.push({ kind: 'ping', at: offset(ping.released_at), ping });
    }
    return result.sort((a, b) => a.at - b.at);
  }, [replay, hasTimeline, durationS, liveAtMs]);

  const activeEvent = useMemo(() => {
    let nearest: ReplayEvent | null = null;
    let nearestDelta = Infinity;
    for (const event of events) {
      const delta = Math.abs(event.at - cursorS);
      if (delta < nearestDelta) {
        nearest = event;
        nearestDelta = delta;
      }
    }
    if (nearest && nearestDelta <= 3) return nearest;
    let latest: ReplayEvent | null = null;
    for (const event of events) {
      if (event.at <= cursorS) latest = event;
    }
    return latest;
  }, [events, cursorS]);

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
        <Text style={styles.loadingText}>Loading the replay…</Text>
      </View>
    );
  }

  const accent =
    game?.winner === 'runners' ? '#059669' : game?.winner === 'hunters' ? '#B91C1C' : '#475569';
  const zoom = Math.max(10, Math.min(16, 15 - Math.log2((game?.area.radius_m ?? 600) / 200)));
  const positionsData: PointCollection = {
    type: 'FeatureCollection',
    features: positionFeatures,
  };
  const trailsData: TrailCollection = {
    type: 'FeatureCollection',
    features: trailFeatures,
  };
  const pingData: PointCollection = {
    type: 'FeatureCollection',
    features: pingFeatures,
  };
  const tagData: PointCollection = {
    type: 'FeatureCollection',
    features: tagFeatures,
  };
  const targetData: PointCollection | null = state.target
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

  const tagCount = replay?.tags.length ?? 0;
  const pingCount = replay?.pings.length ?? 0;
  const tagsSoFar = replay?.tags.filter(
    (tag) => !hasTimeline || Date.parse(tag.tagged_at) <= cursorMs,
  ).length;
  const pingsSoFar = replay?.pings.filter(
    (ping) => !hasTimeline || Date.parse(ping.released_at) <= cursorMs,
  ).length;
  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (durationS <= 0) return;
    if (cursorRef.current >= durationS) {
      cursorRef.current = 0;
      setCursor(0);
    }
    setPlaying(true);
  };

  const eventTitle =
    activeEvent?.kind === 'tag'
      ? `${activeEvent.tag.hunter_name} tagged ${activeEvent.tag.runner_name}`
      : activeEvent?.kind === 'ping'
        ? `Ping · ${activeEvent.ping.display_name}`
        : 'No event at this moment';
  const eventDetail =
    activeEvent?.kind === 'tag'
      ? `${formatClock(activeEvent.at)} · ${Math.round(activeEvent.tag.distance_m)} m apart`
      : activeEvent?.kind === 'ping'
        ? `${formatClock(activeEvent.at)} · ${activeEvent.ping.position_age_s ?? 0}s-old fix${
            activeEvent.ping.reason === 'boundary' ? ' · boundary penalty' : ''
          }`
        : 'Drag the timeline or press play to move through the round.';

  return (
    <View style={styles.screen}>
      <MapLibreMap attribution mapStyle={MAP_STYLE} style={StyleSheet.absoluteFill}>
        <Camera
          initialViewState={{
            center: [game?.area.longitude ?? 0, game?.area.latitude ?? 0],
            zoom,
          }}
        />
        <GeoJSONSource
          id="play-area"
          data={circleRing(
            { longitude: game?.area.longitude ?? 0, latitude: game?.area.latitude ?? 0 },
            game?.area.radius_m ?? 600,
          )}
        >
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
          <GeoJSONSource id="replay-trails" data={trailsData}>
            <Layer
              id="replay-trail-lines"
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

        {state.target && (
          <GeoJSONSource
            id="replay-target-radius"
            data={circleRing(state.target, game?.target_radius_m ?? 25)}
          >
            <Layer
              id="replay-target-fill"
              type="fill"
              paint={{ 'fill-color': '#DB2777', 'fill-opacity': 0.1 }}
            />
            <Layer
              id="replay-target-line"
              type="line"
              paint={{ 'line-color': '#DB2777', 'line-width': 2, 'line-dasharray': [2, 2] }}
            />
          </GeoJSONSource>
        )}

        {targetData && (
          <GeoJSONSource id="replay-target-point" data={targetData}>
            <Layer
              id="replay-target-circle"
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

        {pingFeatures.length > 0 && (
          <GeoJSONSource id="replay-pings" data={pingData}>
            <Layer
              id="replay-ping-points"
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

        {tagFeatures.length > 0 && (
          <GeoJSONSource id="replay-tags" data={tagData}>
            <Layer
              id="replay-tag-halo"
              type="circle"
              paint={{
                'circle-radius': 15,
                'circle-color': '#DC2626',
                'circle-opacity': 0.22,
              }}
            />
            <Layer
              id="replay-tag-dot"
              type="circle"
              paint={{
                'circle-radius': 5,
                'circle-color': '#DC2626',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}

        {positionFeatures.length > 0 && (
          <GeoJSONSource id="replay-positions" data={positionsData}>
            <Layer
              id="replay-position-points"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': ['get', 'color'],
                'circle-opacity': ['case', ['==', ['get', 'tagged'], true], 0.55, 1],
                'circle-stroke-width': 2,
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
        <Text style={[styles.eyebrow, { color: accent }]}>ROUND REPLAY · {game?.code ?? ''}</Text>
        <Text style={styles.title}>
          {game?.winner === 'runners'
            ? 'Runners win'
            : game?.winner === 'hunters'
              ? 'Hunters win'
              : 'Round replay'}
        </Text>
        <Text style={styles.subtitle}>
          {formatClock(cursorS)} / {formatClock(durationS)} ·{' '}
          {hasTimeline ? 'Recorded round' : 'No timeline recorded'}
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>TAGS</Text>
            <Text style={styles.statValue}>
              {tagsSoFar ?? 0}/{tagCount}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>PINGS</Text>
            <Text style={styles.statValue}>
              {pingsSoFar ?? 0}/{pingCount}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>PLAYERS</Text>
            <Text style={styles.statValue}>{state.players.length}</Text>
          </View>
        </View>
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent}>
        <Text style={styles.sectionLabel}>TIMELINE</Text>
        <View style={styles.timeRow}>
          <Text style={styles.timeValue}>{formatClock(cursorS)}</Text>
          <Text style={styles.timeTotal}>of {formatClock(durationS)}</Text>
        </View>

        {hasTimeline ? (
          <TimelineScrubber
            duration={durationS}
            markers={markers}
            onChange={(seconds) => {
              setPlaying(false);
              seek(seconds);
            }}
            value={cursorS}
          />
        ) : (
          <Text style={styles.emptyText}>This round did not record a replay timeline.</Text>
        )}

        <View style={styles.controlsRow}>
          <Pressable
            accessibilityRole="button"
            disabled={!hasTimeline}
            onPress={togglePlay}
            style={[styles.playButton, !hasTimeline && styles.disabled]}
          >
            <Text style={styles.playText}>{playing ? 'Pause' : 'Play'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!hasTimeline}
            onPress={() => {
              setPlaying(false);
              seek(0);
            }}
            style={[styles.secondaryButton, !hasTimeline && styles.disabled]}
          >
            <Text style={styles.secondaryText}>Start</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!hasTimeline}
            onPress={() => {
              setPlaying(false);
              seek(durationS);
            }}
            style={[styles.secondaryButton, !hasTimeline && styles.disabled]}
          >
            <Text style={styles.secondaryText}>End</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!hasTimeline}
            onPress={() => setSpeed((value) => (value === 1 ? 10 : 1))}
            style={[styles.secondaryButton, !hasTimeline && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{speed}×</Text>
          </Pressable>
        </View>

        <View style={styles.eventCard}>
          <Text style={styles.eventLabel}>
            {activeEvent
              ? Math.abs(activeEvent.at - cursorS) <= 3
                ? 'AT THE PLAYHEAD'
                : 'LATEST EVENT'
              : 'NO EVENTS YET'}
          </Text>
          <Text style={styles.eventTitle}>{eventTitle}</Text>
          <Text style={styles.eventDetail}>{eventDetail}</Text>
        </View>

        {trailError !== '' && (
          <Text accessibilityRole="alert" style={styles.error}>
            Routes could not be loaded: {trailError}
          </Text>
        )}
        {replayError !== '' && (
          <Text accessibilityRole="alert" style={styles.error}>
            Events could not be loaded: {replayError}
          </Text>
        )}
        {loading && <ActivityIndicator color="#1D4ED8" size="small" style={styles.spinner} />}

        <View style={styles.legendRow}>
          <View style={[styles.legendLine, { backgroundColor: '#1D4ED8' }]} />
          <Text style={styles.legendText}>Recorded route</Text>
          <View style={[styles.legendDot, { backgroundColor: '#DC2626' }]} />
          <Text style={styles.legendText}>Tag</Text>
          <View style={[styles.legendDot, { backgroundColor: '#DB2777' }]} />
          <Text style={styles.legendText}>Ping</Text>
          {state.target && <View style={[styles.legendDot, { backgroundColor: '#DB2777' }]} />}
          {state.target && <Text style={styles.legendText}>Target</Text>}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace({ pathname: '/result/[id]', params: { id: gameId } });
          }}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryText}>Back to result</Text>
        </Pressable>

        <Text style={styles.footer}>
          Tags and pings are placed with server timestamps. Routes are the recorded trail, at most
          one point every ten seconds.
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
  title: { color: '#0F172A', fontSize: 26, fontWeight: '900', marginTop: 4 },
  subtitle: { color: '#475569', fontSize: 13, lineHeight: 19, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 22, marginTop: 12 },
  stat: { flexShrink: 1 },
  statLabel: { color: '#64748B', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  statValue: { color: '#0F172A', fontSize: 20, fontWeight: '900', marginTop: 2 },
  error: { color: '#B91C1C', fontSize: 12, lineHeight: 18, marginTop: 8 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    bottom: 0,
    left: 0,
    maxHeight: '48%',
    position: 'absolute',
    right: 0,
  },
  sheetContent: { padding: 20, paddingBottom: 28 },
  sectionLabel: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginBottom: 6,
    marginTop: 2,
  },
  timeRow: { alignItems: 'baseline', flexDirection: 'row', gap: 8, marginBottom: 2 },
  timeValue: { color: '#0F172A', fontSize: 28, fontWeight: '900', letterSpacing: 0.4 },
  timeTotal: { color: '#64748B', fontSize: 13, fontWeight: '700' },
  track: { height: 32, justifyContent: 'center', marginTop: 6 },
  rail: {
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    height: 6,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 13,
  },
  railFill: {
    backgroundColor: '#1D4ED8',
    borderRadius: 3,
    height: 6,
    left: 0,
    position: 'absolute',
    top: 13,
  },
  marker: { borderRadius: 2, marginLeft: -1.5, position: 'absolute', width: 3 },
  thumb: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1D4ED8',
    borderRadius: 9,
    borderWidth: 3,
    height: 18,
    marginLeft: -9,
    position: 'absolute',
    top: 7,
    width: 18,
  },
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 20,
  },
  playText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  secondaryText: { color: '#334155', fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  eventCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    marginTop: 12,
    padding: 12,
  },
  eventLabel: { color: '#64748B', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  eventTitle: { color: '#0F172A', fontSize: 15, fontWeight: '900', marginTop: 4 },
  eventDetail: { color: '#475569', fontSize: 12, lineHeight: 17, marginTop: 3 },
  emptyText: { color: '#64748B', fontSize: 13, lineHeight: 19 },
  spinner: { alignSelf: 'flex-start', marginTop: 10 },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
    marginTop: 12,
  },
  legendLine: { borderRadius: 2, height: 3, width: 16 },
  legendDot: { borderRadius: 5, height: 9, width: 9 },
  legendText: { color: '#64748B', fontSize: 11, fontWeight: '700', marginRight: 6 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 48,
  },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  footer: { color: '#94A3B8', fontSize: 11, lineHeight: 17, marginTop: 12 },
  linkButton: { alignItems: 'center', justifyContent: 'center', marginTop: 16, minHeight: 44 },
  linkText: { color: '#1D4ED8', fontSize: 15, fontWeight: '700' },
});

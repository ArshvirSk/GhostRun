import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '../../src/lib/map';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  circleRing,
  type CircleFeature,
  type LngLat,
  type PointCollection,
  type PointFeature,
} from '../../src/lib/geo';
import { stopLocationSharing } from '../../src/lib/location';
import { supabase } from '../../src/lib/supabase';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { Button, Card, Chip, Text } from '../../src/ui';

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
  reason: 'scheduled' | 'boundary' | 'noise' | 'camping' | 'item' | 'ghost_sighting' | 'ai_gm_double_ping';
  released_at: string;
};

type ReplayHeatMark = {
  id: number;
  hunter_id: string;
  display_name: string;
  color: string;
  result: 'hot' | 'cold' | 'no_change';
  longitude: number;
  latitude: number;
  nearest_runner_m: number | null;
  pressed_at: string;
};

type ReplayZone = {
  id: string;
  name: string;
  zone_index: number;
  longitude: number;
  latitude: number;
  radius_m: number;
  controller: 'runner' | 'hunter' | 'neutral' | null;
};

type ReplayPulse = {
  id: number;
  pulse_seq: number;
  scores: { runner: number; hunter: number } | null;
  controlled: Record<string, string> | null;
  created_at: string;
};

type ReplayNpcPath = {
  id: string;
  kind: string;
  path_wkt: string | null;
  duration_s: number;
  longitude: number;
  latitude: number;
};

type ReplayDrop = {
  id: string;
  type: string;
  claimed: boolean;
  longitude: number;
  latitude: number;
  claimed_at: string | null;
};

type ReplayEventRow = {
  id: number;
  type: string;
  payload: any;
  created_at: string;
};

type ReplayData = {
  tags: ReplayTag[];
  pings: ReplayPing[];
  heat_marks?: ReplayHeatMark[];
  zones?: ReplayZone[];
  pulse_history?: ReplayPulse[];
  npc_paths?: ReplayNpcPath[];
  handoffs?: ReplayEventRow[];
  drops?: ReplayDrop[];
  jail_events?: ReplayEventRow[];
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
  | { kind: 'tag'; at: number; tag: ReplayTag }
  | { kind: 'ping'; at: number; ping: ReplayPing }
  | { kind: 'heat'; at: number; heat: ReplayHeatMark }
  | { kind: 'handoff'; at: number; event: ReplayEventRow }
  | { kind: 'jail'; at: number; event: ReplayEventRow };

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

function parseWktLineString(wkt: string | null): [number, number][] {
  if (!wkt) return [];
  const match = wkt.trim().match(/^LINESTRING\s*\((.*)\)$/i);
  if (!match) return [];
  const points: [number, number][] = [];
  for (const part of match[1].split(',')) {
    const coords = part.trim().split(/\s+/).map(Number);
    if (coords.length >= 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
      points.push([coords[0], coords[1]]);
    }
  }
  return points;
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
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [visibleLayers, setVisibleLayers] = useState({
    trails: true,
    pings: true,
    heat: true,
    zones: true,
    npc: true,
    drops: true,
  });

  const mountedRef = useRef(true);
  const cursorRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Stop background tracker once replay mounts
  useEffect(() => {
    void stopLocationSharing();
  }, []);

  const load = useCallback(async () => {
    if (!gameId) return;
    if (!supabase) {
      setErrorMessage('Supabase is not configured in this build.');
      return;
    }

    const stateResult = await supabase.rpc('get_game_state', { game_id: gameId });
    if (!mountedRef.current) return;
    if (stateResult.error) {
      setErrorMessage(stateResult.error.message);
      return;
    }

    const snapshot = stateResult.data as ReplayState;
    setState(snapshot);
    setErrorMessage('');

    if (snapshot.game.status !== 'ended') {
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
      router.replace('/play' as any);
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

  // ±15s Skip Helpers (Addendum C #4)
  const skipBackward15 = useCallback(() => {
    seek(cursorRef.current - 15);
  }, [seek]);

  const skipForward15 = useCallback(() => {
    seek(cursorRef.current + 15);
  }, [seek]);

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
    if (!state || !visibleLayers.trails) return features;
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
  }, [state, trailsByPlayer, cursorMs, hasTimeline, visibleLayers.trails]);

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
    if (!visibleLayers.pings) return features;
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
  }, [replay, cursorMs, hasTimeline, visibleLayers.pings]);

  const heatFeatures = useMemo(() => {
    const features: PointFeature[] = [];
    if (!visibleLayers.heat) return features;
    for (const mark of replay?.heat_marks ?? []) {
      const pressedAt = Date.parse(mark.pressed_at);
      if (hasTimeline && pressedAt > cursorMs) continue;
      const color =
        mark.result === 'hot' ? colors.heatHot : mark.result === 'cold' ? colors.heatCold : colors.textMuted;
      features.push({
        type: 'Feature',
        properties: { color, result: mark.result, hunter: mark.display_name },
        geometry: { type: 'Point', coordinates: [mark.longitude, mark.latitude] },
      });
    }
    return features;
  }, [replay, cursorMs, hasTimeline, visibleLayers.heat]);

  const zoneFeatures = useMemo(() => {
    if (!visibleLayers.zones || !replay?.zones || replay.zones.length === 0) return [];
    return replay.zones.map((zone) => {
      const color =
        zone.controller === 'runner'
          ? colors.runner
          : zone.controller === 'hunter'
            ? colors.hunter
            : colors.textSubtle;
      const ring = circleRing(
        { longitude: zone.longitude, latitude: zone.latitude },
        zone.radius_m || 60,
      );
      return {
        ...ring,
        properties: {
          name: zone.name,
          color,
          controller: zone.controller ?? 'neutral',
        },
      };
    });
  }, [replay, visibleLayers.zones]);

  const { npcLineFeatures, npcPointFeatures } = useMemo(() => {
    const lines: {
      type: 'Feature';
      properties: { color: string; kind: string };
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    }[] = [];
    const points: PointFeature[] = [];
    if (!visibleLayers.npc) return { npcLineFeatures: lines, npcPointFeatures: points };

    for (const npc of replay?.npc_paths ?? []) {
      const coords = parseWktLineString(npc.path_wkt);
      if (coords.length >= 2) {
        lines.push({
          type: 'Feature',
          properties: { color: colors.ghostTrail, kind: npc.kind },
          geometry: { type: 'LineString', coordinates: coords },
        });
      }
      if (npc.longitude && npc.latitude) {
        points.push({
          type: 'Feature',
          properties: { color: colors.ghostTrail, kind: npc.kind },
          geometry: { type: 'Point', coordinates: [npc.longitude, npc.latitude] },
        });
      }
    }
    return { npcLineFeatures: lines, npcPointFeatures: points };
  }, [replay, visibleLayers.npc]);

  const dropFeatures = useMemo(() => {
    const features: PointFeature[] = [];
    if (!visibleLayers.drops) return features;
    for (const drop of replay?.drops ?? []) {
      const isClaimedAtTime =
        drop.claimed &&
        (!hasTimeline || (drop.claimed_at && Date.parse(drop.claimed_at) <= cursorMs));
      features.push({
        type: 'Feature',
        properties: {
          claimed: isClaimedAtTime,
          color: isClaimedAtTime ? colors.textMuted : colors.warning,
          type: drop.type,
        },
        geometry: { type: 'Point', coordinates: [drop.longitude, drop.latitude] },
      });
    }
    return features;
  }, [replay, cursorMs, hasTimeline, visibleLayers.drops]);

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
        color: colors.danger,
        height: 24,
        top: 2,
      });
    }
    for (const ping of replay?.pings ?? []) {
      result.push({
        key: `ping-${ping.id}`,
        position: offset(ping.released_at) / durationS,
        color: ping.reason === 'boundary' ? colors.warning : colors.radarScan,
        height: 10,
        top: 18,
      });
    }
    for (const mark of replay?.heat_marks ?? []) {
      result.push({
        key: `heat-${mark.id}`,
        position: offset(mark.pressed_at) / durationS,
        color: mark.result === 'hot' ? colors.heatHot : mark.result === 'cold' ? colors.heatCold : colors.textMuted,
        height: 8,
        top: 24,
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
    for (const mark of replay?.heat_marks ?? []) {
      result.push({ kind: 'heat', at: offset(mark.pressed_at), heat: mark });
    }
    for (const ev of replay?.handoffs ?? []) {
      result.push({ kind: 'handoff', at: offset(ev.created_at), event: ev });
    }
    for (const ev of replay?.jail_events ?? []) {
      result.push({ kind: 'jail', at: offset(ev.created_at), event: ev });
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
        <Text variant="headline" color={colors.danger} style={{ marginBottom: spacing.md }}>
          Operation not found.
        </Text>
        <Button title="Return to Base" variant="primary" size="md" onPress={() => router.replace('/play' as any)} />
      </View>
    );
  }

  if (!state) {
    return (
      <View style={styles.centered}>
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
              Loading operational replay…
            </Text>
          </>
        )}
      </View>
    );
  }

  if (state.game.status !== 'ended') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text variant="body" color={colors.textMuted} style={{ marginTop: spacing.md }}>
          Awaiting operation completion…
        </Text>
      </View>
    );
  }

  const accent =
    game?.winner === 'runners' ? colors.success : game?.winner === 'hunters' ? colors.danger : colors.textMuted;
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
  const heatData: PointCollection = {
    type: 'FeatureCollection',
    features: heatFeatures,
  };
  const zoneData: { type: 'FeatureCollection'; features: CircleFeature[] } = {
    type: 'FeatureCollection',
    features: zoneFeatures,
  };
  const npcLineData: {
    type: 'FeatureCollection';
    features: {
      type: 'Feature';
      properties: { color: string; kind: string };
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    }[];
  } = {
    type: 'FeatureCollection',
    features: npcLineFeatures,
  };
  const npcPointData: PointCollection = {
    type: 'FeatureCollection',
    features: npcPointFeatures,
  };
  const dropData: PointCollection = {
    type: 'FeatureCollection',
    features: dropFeatures,
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
        : activeEvent?.kind === 'heat'
          ? `Heat Probe · ${activeEvent.heat.display_name}`
          : activeEvent?.kind === 'handoff'
            ? `Relay · ${activeEvent.event.type.replace('_', ' ')}`
            : activeEvent?.kind === 'jail'
              ? `Jail · ${activeEvent.event.type.replace('_', ' ')}`
              : 'No event at this moment';

  const eventDetail =
    activeEvent?.kind === 'tag'
      ? `${formatClock(activeEvent.at)} · ${Math.round(activeEvent.tag.distance_m)}m vector apart`
      : activeEvent?.kind === 'ping'
        ? `${formatClock(activeEvent.at)} · ${activeEvent.ping.position_age_s ?? 0}s fix age${
            activeEvent.ping.reason === 'boundary' ? ' · boundary excursion' : ''
          }`
        : activeEvent?.kind === 'heat'
          ? `${formatClock(activeEvent.at)} · ${activeEvent.heat.result.toUpperCase()}${
              activeEvent.heat.nearest_runner_m !== null
                ? ` · ${Math.round(activeEvent.heat.nearest_runner_m)}m range`
                : ''
            }`
          : activeEvent?.kind === 'handoff' || activeEvent?.kind === 'jail'
            ? `${formatClock(activeEvent.at)} · recorded tactical mission event`
            : 'Drag the timeline scrubber or use ±15s controls to navigate playback.';

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
            paint={{ 'fill-color': colors.primary, 'fill-opacity': 0.05 }}
          />
          <Layer
            id="play-area-outline"
            type="line"
            paint={{ 'line-color': colors.primary, 'line-width': 2, 'line-dasharray': [2, 2] }}
          />
        </GeoJSONSource>

        {zoneFeatures.length > 0 && (
          <GeoJSONSource id="replay-zones" data={zoneData}>
            <Layer
              id="replay-zone-fill"
              type="fill"
              paint={{
                'fill-color': ['get', 'color'],
                'fill-opacity': 0.12,
              }}
            />
            <Layer
              id="replay-zone-line"
              type="line"
              paint={{
                'line-color': ['get', 'color'],
                'line-width': 2,
                'line-dasharray': [2, 2],
              }}
            />
          </GeoJSONSource>
        )}

        {npcLineFeatures.length > 0 && (
          <GeoJSONSource id="replay-npc-lines" data={npcLineData}>
            <Layer
              id="replay-npc-line"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': colors.ghostTrail,
                'line-width': 3,
                'line-dasharray': [3, 3],
                'line-opacity': 0.85,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Ghost Echo on Replay Trails (Addendum C #4) */}
        {trailFeatures.length > 0 && (
          <GeoJSONSource id="replay-trails" data={trailsData}>
            <Layer
              id="replay-trail-echo"
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
              id="replay-trail-lines"
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

        {state.target && (
          <GeoJSONSource
            id="replay-target-radius"
            data={circleRing(state.target, game?.target_radius_m ?? 25)}
          >
            <Layer
              id="replay-target-fill"
              type="fill"
              paint={{ 'fill-color': colors.danger, 'fill-opacity': 0.1 }}
            />
            <Layer
              id="replay-target-line"
              type="line"
              paint={{ 'line-color': colors.danger, 'line-width': 2, 'line-dasharray': [2, 2] }}
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
                'circle-color': colors.danger,
                'circle-stroke-width': 3,
                'circle-stroke-color': colors.textLight,
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
                  colors.warning,
                  colors.radarScan,
                ],
                'circle-opacity': ['interpolate', ['linear'], ['get', 'age_s'], 0, 0.9, 600, 0.25],
                'circle-stroke-width': 2,
                'circle-stroke-color': colors.textLight,
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
                'circle-radius': 16,
                'circle-color': colors.danger,
                'circle-opacity': 0.25,
              }}
            />
            <Layer
              id="replay-tag-dot"
              type="circle"
              paint={{
                'circle-radius': 6,
                'circle-color': colors.danger,
                'circle-stroke-width': 2,
                'circle-stroke-color': colors.textLight,
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
                  colors.surface,
                  colors.textLight,
                ],
              }}
            />
          </GeoJSONSource>
        )}

        {npcPointFeatures.length > 0 && (
          <GeoJSONSource id="replay-npc-points" data={npcPointData}>
            <Layer
              id="replay-npc-circle"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': colors.ghostTrail,
                'circle-stroke-width': 2,
                'circle-stroke-color': colors.textLight,
              }}
            />
          </GeoJSONSource>
        )}

        {dropFeatures.length > 0 && (
          <GeoJSONSource id="replay-drops" data={dropData}>
            <Layer
              id="replay-drop-circle"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': ['get', 'color'],
                'circle-stroke-width': 2,
                'circle-stroke-color': colors.textLight,
              }}
            />
          </GeoJSONSource>
        )}

        {heatFeatures.length > 0 && (
          <GeoJSONSource id="replay-heat-marks" data={heatData}>
            <Layer
              id="replay-heat-circle"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': ['get', 'color'],
                'circle-stroke-width': 2,
                'circle-stroke-color': colors.textLight,
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      {/* Top HUD */}
      <View style={styles.hud}>
        <View style={styles.topHudRow}>
          <Chip label={`REPLAY // #${game?.code ?? ''}`} variant="accent" size="sm" />
          <Chip
            label={game?.winner === 'runners' ? 'RUNNERS WON' : game?.winner === 'hunters' ? 'HUNTERS WON' : 'ENDED'}
            variant="default"
            size="sm"
          />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: spacing.xs }}>
          <Text variant="headline" color={colors.textLight}>
            {formatClock(cursorS)}
            <Text variant="caption" color={colors.textMuted}> / {formatClock(durationS)}</Text>
          </Text>
          <Text variant="caption" color={accent} weight="bold">
            {hasTimeline ? 'TIMELINE ACTIVE' : 'STATIC SNAPSHOT'}
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text variant="caption" color={colors.textMuted}>TAGS</Text>
            <Text variant="body" weight="bold" color={colors.hunter}>
              {tagsSoFar ?? 0}/{tagCount}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text variant="caption" color={colors.textMuted}>PINGS</Text>
            <Text variant="body" weight="bold" color={colors.radarScan}>
              {pingsSoFar ?? 0}/{pingCount}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text variant="caption" color={colors.textMuted}>SQUAD</Text>
            <Text variant="body" weight="bold" color={colors.textLight}>
              {state.players.length} Operatives
            </Text>
          </View>
        </View>
      </View>

      {/* Bottom Controls Sheet */}
      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          {/* Layer Filter Chips */}
          <Text variant="label" color={colors.primary} style={{ marginBottom: spacing.xs }}>
            TACTICAL LAYERS
          </Text>
          <View style={styles.layerRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisibleLayers((l) => ({ ...l, trails: !l.trails }))}
            >
              <Chip
                label="Trails"
                variant={visibleLayers.trails ? 'accent' : 'default'}
                size="sm"
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisibleLayers((l) => ({ ...l, pings: !l.pings }))}
            >
              <Chip
                label="Pings"
                variant={visibleLayers.pings ? 'accent' : 'default'}
                size="sm"
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisibleLayers((l) => ({ ...l, heat: !l.heat }))}
            >
              <Chip
                label="Heat"
                variant={visibleLayers.heat ? 'accent' : 'default'}
                size="sm"
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisibleLayers((l) => ({ ...l, zones: !l.zones }))}
            >
              <Chip
                label="Sectors"
                variant={visibleLayers.zones ? 'accent' : 'default'}
                size="sm"
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisibleLayers((l) => ({ ...l, npc: !l.npc }))}
            >
              <Chip
                label="Ghost"
                variant={visibleLayers.npc ? 'accent' : 'default'}
                size="sm"
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisibleLayers((l) => ({ ...l, drops: !l.drops }))}
            >
              <Chip
                label="Drops"
                variant={visibleLayers.drops ? 'accent' : 'default'}
                size="sm"
              />
            </Pressable>
          </View>

          {/* Timeline Scrubber */}
          <View style={{ marginTop: spacing.xs }}>
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
              <Text variant="caption" color={colors.textMuted} style={{ marginVertical: spacing.sm }}>
                This operation concluded without recorded trajectory timestamps.
              </Text>
            )}
          </View>

          {/* Playback Controls Row with ±15s Skip (Addendum C #4) */}
          <View style={styles.controlsRow}>
            {/* Start */}
            <Pressable
              accessibilityRole="button"
              disabled={!hasTimeline}
              onPress={() => {
                setPlaying(false);
                seek(0);
              }}
              style={[styles.controlPill, !hasTimeline && styles.disabled]}
            >
              <Ionicons color={colors.textLight} name="play-skip-back" size={14} />
            </Pressable>

            {/* -15s Skip */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip backward 15 seconds"
              disabled={!hasTimeline}
              onPress={skipBackward15}
              style={[styles.controlPill, !hasTimeline && styles.disabled]}
            >
              <Text variant="caption" weight="bold" color={colors.textLight}>-15s</Text>
            </Pressable>

            {/* Play / Pause Primary */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause replay' : 'Play replay'}
              disabled={!hasTimeline}
              onPress={togglePlay}
              style={[styles.playButtonPrimary, !hasTimeline && styles.disabled]}
            >
              <Ionicons color={colors.backgroundDark} name={playing ? 'pause' : 'play'} size={18} />
              <Text variant="body" weight="bold" color={colors.backgroundDark} style={{ marginLeft: 6 }}>
                {playing ? 'Pause' : 'Play'}
              </Text>
            </Pressable>

            {/* +15s Skip */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip forward 15 seconds"
              disabled={!hasTimeline}
              onPress={skipForward15}
              style={[styles.controlPill, !hasTimeline && styles.disabled]}
            >
              <Text variant="caption" weight="bold" color={colors.textLight}>+15s</Text>
            </Pressable>

            {/* End */}
            <Pressable
              accessibilityRole="button"
              disabled={!hasTimeline}
              onPress={() => {
                setPlaying(false);
                seek(durationS);
              }}
              style={[styles.controlPill, !hasTimeline && styles.disabled]}
            >
              <Ionicons color={colors.textLight} name="play-skip-forward" size={14} />
            </Pressable>

            {/* Speed Toggle */}
            <Pressable
              accessibilityRole="button"
              disabled={!hasTimeline}
              onPress={() => setSpeed((val) => (val === 1 ? 10 : 1))}
              style={[styles.controlPill, !hasTimeline && styles.disabled]}
            >
              <Text variant="caption" weight="bold" color={colors.primary}>{speed}×</Text>
            </Pressable>
          </View>

          {/* Active Event Dossier Banner */}
          <Card variant="default" style={styles.eventCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="caption" color={colors.primary} weight="bold">
                {activeEvent
                  ? Math.abs(activeEvent.at - cursorS) <= 3
                    ? 'CURRENT EVENT'
                    : 'RECENT EVENT'
                  : 'STATUS MONITOR'}
              </Text>
              <Chip label={formatClock(cursorS)} variant="default" size="sm" />
            </View>
            <Text variant="body" weight="bold" color={colors.textLight} style={{ marginTop: 4 }}>
              {eventTitle}
            </Text>
            <Text variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
              {eventDetail}
            </Text>
          </Card>

          {trailError !== '' && (
            <Text variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
              Routes telemetry error: {trailError}
            </Text>
          )}
          {replayError !== '' && (
            <Text variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
              Replay events error: {replayError}
            </Text>
          )}

          {/* Return Action */}
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            <Button
              title="Back to Mission Debrief"
              variant="secondary"
              size="md"
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace({ pathname: '/result/[id]', params: { id: gameId } });
              }}
            />
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
  hud: {
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
  statsRow: {
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
  },
  stat: {
    flexShrink: 1,
  },
  sheet: {
    backgroundColor: colors.surfaceDark,
    borderColor: colors.border,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    maxHeight: '52%',
    position: 'absolute',
    right: 0,
    zIndex: 10,
  },
  sheetContent: {
    padding: spacing.base,
    paddingBottom: spacing.xl,
  },
  layerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  track: {
    height: 36,
    justifyContent: 'center',
    position: 'relative',
  },
  rail: {
    backgroundColor: colors.borderDark,
    borderRadius: radii.full,
    height: 4,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  railFill: {
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    height: 4,
    left: 0,
    position: 'absolute',
  },
  marker: {
    borderRadius: radii.xs,
    marginLeft: -1.5,
    position: 'absolute',
    width: 3,
  },
  thumb: {
    backgroundColor: colors.primary,
    borderColor: colors.surfaceDark,
    borderRadius: radii.full,
    borderWidth: 2,
    height: 16,
    marginLeft: -8,
    position: 'absolute',
    top: 10,
    width: 16,
  },
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: spacing.sm,
  },
  controlPill: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    minWidth: 42,
    paddingHorizontal: spacing.xs,
  },
  playButtonPrimary: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flexDirection: 'row',
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
  },
  disabled: {
    opacity: 0.35,
  },
  eventCard: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
});

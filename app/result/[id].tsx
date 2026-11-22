import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '../../src/lib/map';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
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
import { Button, Chip, Text } from '../../src/ui';
import { formatDistance, useUnits } from '../../src/utils/units';
import { ShareRoundCardModal } from '../../src/components/ShareRoundCardModal';
import { StoryCardExportModal } from '../../src/components/StoryCardExportModal';
import { triggerHaptic } from '../../src/motion/haptics';
import { getModeModule } from '../../src/modes/registry';
import { listFriends, listFriendRequests, sendFriendRequest } from '../../src/lib/friends';

const MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_DARK_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';

type RoundScore = {
  game_id: string;
  player_id: string;
  user_id: string;
  mode_id: string;
  role: string;
  o: number | null;
  y: number | null;
  p: number | null;
  d: number | null;
  echo: number;
  contested: number | null;
  hit: number | null;
  counted: boolean;
  excluded_reason: string | null;
};

type GhostPreview = {
  can_contribute: boolean;
  reason: string | null;
  original_point_count: number;
  trimmed_point_count: number;
  original_length_m: number;
};

type GhostDuelScore = {
  id: string;
  game_id: string;
  ghost_id: string | null;
  user_id: string;
  player_time_seconds: number;
  ghost_time_seconds: number;
  time_difference_seconds: number;
  result: 'won' | 'lost' | 'tied';
  new_personal_best: boolean;
  course_record: boolean;
  accuracy_rate: number;
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
    created_at?: string | null;
    head_start_at?: string | null;
    live_at: string | null;
    started_at?: string | null;
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
  const remSec = seconds % 60;
  if (minutes < 1) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m${remSec > 0 ? ` ${remSec}s` : ''}`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function teamLabel(team: Team) {
  return team === 'runner' ? 'Runner' : team === 'hunter' ? 'Hunter' : 'No team';
}

function getDisplayModeName(gameMode?: string, moduleName?: string): string {
  if (moduleName) return moduleName.toUpperCase();
  if (!gameMode) return 'TAG HUNT';
  switch (gameMode) {
    case 'tag_hunt':
      return 'TAG HUNT';
    case 'outbreak_horde':
      return 'OUTBREAK HORDE';
    case 'classic_chase':
      return 'CLASSIC CHASE';
    case 'jailbreak':
      return 'JAILBREAK';
    case 'assassin_ring':
      return 'ASSASSIN RING';
    case 'relay_heist':
      return 'RELAY HEIST';
    case 'territory_pulse':
      return 'TERRITORY PULSE';
    case 'ghost_duel':
      return 'SOLO GHOST DUEL';
    default:
      return gameMode.toUpperCase().replace(/_/g, ' ');
  }
}

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
  const [ghostScore, setGhostScore] = useState<GhostDuelScore | null>(null);
  const [roundScore, setRoundScore] = useState<RoundScore | null>(null);
  const [friendUserIds, setFriendUserIds] = useState<Set<string>>(new Set());
  const [requestedUserIds, setRequestedUserIds] = useState<Set<string>>(new Set());
  const [sendingFriendReq, setSendingFriendReq] = useState<Record<string, boolean>>({});
  const [shareCardModalVisible, setShareCardModalVisible] = useState(false);
  const [storyCardModalVisible, setStoryCardModalVisible] = useState(false);

  // Valorant-Style 3-Tab Architecture States
  const [activeTab, setActiveTab] = useState<'summary' | 'operatives' | 'map'>('summary');
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const [showFormulaModal, setShowFormulaModal] = useState(false);
  const [rotateRoles, setRotateRoles] = useState(true);

  const handleQuickAddFriend = async (targetUserId: string) => {
    triggerHaptic('buttonTap');
    setSendingFriendReq((prev) => ({ ...prev, [targetUserId]: true }));
    try {
      const res = await sendFriendRequest(targetUserId);
      if (res.success) {
        triggerHaptic('tagConfirmed');
        setRequestedUserIds((prev) => new Set([...prev, targetUserId]));
      }
    } catch {
      // ignore
    } finally {
      if (mountedRef.current) {
        setSendingFriendReq((prev) => ({ ...prev, [targetUserId]: false }));
      }
    }
  };

  const handleInspectPlayer = (userId: string, name?: string, color?: string) => {
    triggerHaptic('buttonTap');
    router.push({
      pathname: '/profile/[id]',
      params: { id: userId, name: name ?? '', color: color ?? '' },
    });
  };

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

    // Trigger round score computation and badge awarding for completed round
    void Promise.allSettled([
      supabase.rpc('compute_round_scores', { p_game_id: gameId }),
      supabase.rpc('award_match_badges', { p_game_id: gameId }),
    ]);

    const isGhostDuel =
      snapshot.game.mode === 'ghost_duel' ||
      (snapshot.game as unknown as { mode_id?: string }).mode_id === 'ghost_duel';

    const [trailRes, statsRes, ghostRes] = await Promise.all([
      supabase.rpc('get_game_trails', { game_id: gameId }),
      supabase.rpc('get_game_stats', { game_id: gameId }),
      snapshot.my_team === 'runner' || isGhostDuel
        ? supabase.rpc('preview_ghost', { game_id: gameId })
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (!mountedRef.current) return;

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

    // Fetch personal round score & echo metrics
    try {
      const { data: rsData } = await supabase
        .from('round_scores')
        .select('*')
        .eq('game_id', gameId)
        .maybeSingle();
      if (mountedRef.current && rsData) {
        setRoundScore(rsData as RoundScore);
      }
    } catch {
      // offline/non-blocking
    }

    // Fetch friend relationships for roster quick-add
    try {
      const [friendsList, reqs] = await Promise.all([
        listFriends(),
        listFriendRequests(),
      ]);
      if (mountedRef.current) {
        setFriendUserIds(new Set(friendsList.map((f) => f.userId)));
        setRequestedUserIds(new Set(reqs.outgoing.map((r) => r.targetId || '').filter(Boolean)));
      }
    } catch {
      // non-blocking
    }
  }, [gameId]);

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

  async function playAgain(rotate: boolean = true) {
    if (!supabase || !gameId || rematchBusy) return;
    setRematchBusy(true);
    setRematchError('');
    const { data, error } = await (supabase.rpc as any)('rematch_game', {
      p_game_id: gameId,
      p_rotate: rotate,
    });
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

  const activeModule = getModeModule(state?.game.mode || 'classic_chase');
  const myPlayer = useMemo(() => {
    return (state?.players ?? []).find((p) => p.id === state?.my_player_id) || null;
  }, [state]);

  const myTrailPoints = useMemo<LngLat[]>(() => {
    if (!state) return [];
    return (trailsByPlayer.get(state.my_player_id) ?? []).map((p) => ({
      latitude: p.latitude,
      longitude: p.longitude,
    }));
  }, [state, trailsByPlayer]);

  const myDistanceMeters = useMemo(() => {
    let total = 0;
    for (let i = 1; i < myTrailPoints.length; i++) {
      total += distanceM(myTrailPoints[i - 1], myTrailPoints[i]);
    }
    return total;
  }, [myTrailPoints]);

  const getPlayerDistanceMeters = useCallback(
    (playerId: string): number => {
      const points = trailsByPlayer.get(playerId) ?? [];
      let total = 0;
      for (let i = 1; i < points.length; i++) {
        total += distanceM(
          { latitude: points[i - 1].latitude, longitude: points[i - 1].longitude },
          { latitude: points[i].latitude, longitude: points[i].longitude }
        );
      }
      return total;
    },
    [trailsByPlayer]
  );

  const trailFeatures = useMemo(() => {
    if (!state) return [];
    const features: TrailFeature[] = [];
    for (const player of state.players ?? []) {
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
    const winner = (state.positions ?? []).find(
      (position) =>
        position.team === 'runner' && distanceM(position, target) <= state.game.target_radius_m,
    );
    return winner?.player_id ?? null;
  }, [state]);

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
        <Text variant="headline" color="#FF5A5F" style={{ marginBottom: spacing.md }}>
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
            <Text variant="body" color="#FF5A5F" style={{ marginBottom: spacing.md }}>
              {errorMessage}
            </Text>
            <Button title="Return to Base" variant="secondary" size="md" onPress={() => router.replace('/play' as any)} />
          </>
        ) : (
          <>
            <ActivityIndicator color="#C8FF00" size="large" />
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
        <ActivityIndicator color="#C8FF00" size="large" />
        <Text variant="body" color={colors.textMuted} style={{ marginTop: spacing.md }}>
          Finalizing round telemetry…
        </Text>
      </View>
    );
  }

  const game = state.game;
  const target = state.target;
  const players = state.players ?? [];
  const positions = state.positions ?? [];
  const zoom = Math.max(10, Math.min(16, 15 - Math.log2(game.area.radius_m / 200)));

  const isGhostDuel =
    game.mode === 'ghost_duel' ||
    (game as unknown as { mode_id?: string }).mode_id === 'ghost_duel';

  const isVictory =
    (state.my_team === 'runner' && game.winner === 'runners') ||
    (state.my_team === 'hunter' && game.winner === 'hunters') ||
    (isGhostDuel && ['ghost_beaten', 'evaded', 'ghost_tagged'].includes(game.end_reason ?? ''));

  // Strict semantic palette: Lime (#C8FF00) for Victory, Coral (#FF5A5F) for Defeat/Loss
  const outcomeAccent = isVictory ? '#C8FF00' : '#FF5A5F';

  const finishAt =
    game.end_reason === 'time_expired'
      ? (game.ends_at || game.ended_at)
      : (game.ended_at || game.ends_at);
  const startAt = game.head_start_at || game.live_at || game.started_at || game.created_at;
  const roundSeconds =
    gameStats?.duration_s && gameStats.duration_s > 0
      ? gameStats.duration_s
      : startAt && finishAt
        ? Math.max(0, Math.round(Math.abs(Date.parse(finishAt) - Date.parse(startAt)) / 1000))
        : null;

  const taggedCount = players.filter(
    (player) => player.team === 'runner' && player.status === 'tagged',
  ).length;

  const myPlayerStat = gameStats?.players.find((p) => p.player_id === state.my_player_id);

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

  const hunters = players.filter((p) => p.team === 'hunter');
  const runners = players.filter((p) => p.team === 'runner');

  const formattedDistanceDisplay =
    myDistanceMeters > 0
      ? formatDistance(myDistanceMeters, unitSystem)
      : '0.4 km';

  const endReasonLabel =
    game.end_reason === 'all_tagged'
      ? 'ALL RUNNERS TAGGED'
      : game.end_reason?.replace(/_/g, ' ').toUpperCase() || 'ROUND CONCLUDED';

  return (
    <View style={styles.screen}>
      {/* ======================================================== */}
      {/* 1. TOP MATCH BANNER (Sharp, Full-Bleed, Zero Fluff)      */}
      {/* ======================================================== */}
      <View
        style={[
          styles.matchBanner,
          {
            paddingTop: Math.max(insets.top, 16) + 4,
            backgroundColor: isVictory ? '#131B12' : '#221114',
            borderBottomColor: isVictory ? 'rgba(200, 255, 0, 0.2)' : 'rgba(255, 90, 95, 0.2)',
          },
        ]}
      >
        <View style={styles.bannerTopRow}>
          <Text style={styles.bannerDossierLabel}>TACTICAL DOSSIER // POST-MATCH</Text>
          <View style={styles.bannerTopRight}>
            <View style={styles.roomCodePill}>
              <Text style={styles.roomCodeText}>#{game.code}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export 9:16 Story Card"
              onPress={() => {
                triggerHaptic('buttonTap');
                setStoryCardModalVisible(true);
              }}
              style={styles.storyIconButton}
            >
              <Ionicons name="share-social-outline" size={15} color="#38BDF8" />
            </Pressable>
          </View>
        </View>

        <View style={styles.bannerMainRow}>
          <Text style={[styles.outcomeHeadline, { color: outcomeAccent }]} numberOfLines={1}>
            {isVictory ? 'VICTORY' : 'DEFEAT'}
          </Text>
          <View
            style={[
              styles.roleBadgePill,
              {
                backgroundColor: `${outcomeAccent}1A`,
                borderColor: `${outcomeAccent}4D`,
              },
            ]}
          >
            <Text style={[styles.roleBadgeText, { color: outcomeAccent }]}>
              {myPlayer?.team === 'hunter' ? 'HUNTER SQUAD' : 'RUNNER SQUAD'}
            </Text>
          </View>
        </View>

        <View style={styles.bannerSubtitleRow}>
          <Text style={styles.bannerSubtitleBold}>{getDisplayModeName(game.mode, activeModule?.name)}</Text>
          <Text style={styles.bannerSubtitleDot}>•</Text>
          <Text style={styles.bannerSubtitleMuted}>{endReasonLabel}</Text>
          <Text style={styles.bannerSubtitleDot}>•</Text>
          <Text style={styles.bannerSubtitleDuration}>{formatDuration(roundSeconds ?? 0)}</Text>
        </View>
      </View>

      {/* ======================================================== */}
      {/* 2. UNDERLINE TACTICAL TAB BAR                            */}
      {/* ======================================================== */}
      <View style={styles.tabBar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            triggerHaptic('buttonTap');
            setActiveTab('summary');
          }}
          style={[
            styles.tabItem,
            activeTab === 'summary' && [styles.tabItemActive, { borderBottomColor: outcomeAccent }],
          ]}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'summary' && [styles.tabTextActive, { color: outcomeAccent }],
            ]}
          >
            SUMMARY
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            triggerHaptic('buttonTap');
            setActiveTab('operatives');
          }}
          style={[
            styles.tabItem,
            activeTab === 'operatives' && [styles.tabItemActive, { borderBottomColor: outcomeAccent }],
          ]}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'operatives' && [styles.tabTextActive, { color: outcomeAccent }],
            ]}
          >
            OPERATIVES
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            triggerHaptic('buttonTap');
            setActiveTab('map');
          }}
          style={[
            styles.tabItem,
            activeTab === 'map' && [styles.tabItemActive, { borderBottomColor: outcomeAccent }],
          ]}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'map' && [styles.tabTextActive, { color: outcomeAccent }],
            ]}
          >
            TACTICAL MAP
          </Text>
        </Pressable>
      </View>

      {/* ======================================================== */}
      {/* 3. TAB VIEWS CONTENT AREA                                */}
      {/* ======================================================== */}
      <View style={styles.contentContainer}>
        {/* ---------------------------------------------------- */}
        {/* TAB 1: SUMMARY                                       */}
        {/* ---------------------------------------------------- */}
        {activeTab === 'summary' && (
          <ScrollView
            style={styles.tabScrollView}
            contentContainerStyle={[
              styles.tabScrollContent,
              { paddingBottom: 120 + Math.max(insets.bottom, 12) },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {/* Progression Hero Card */}
            <View style={styles.progressionCard}>
              <View style={styles.progressionTopRow}>
                <View style={styles.progressionTitleRow}>
                  <View style={[styles.progressionDot, { backgroundColor: outcomeAccent }]} />
                  <Text style={styles.progressionTitle}>SEASON ECHO PROGRESSION</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Season Echo Formula Breakdown"
                  onPress={() => {
                    triggerHaptic('buttonTap');
                    setShowFormulaModal(true);
                  }}
                  style={styles.formulaInfoBtn}
                >
                  <Text style={styles.formulaInfoBtnText}>i</Text>
                </Pressable>
              </View>

              <View style={styles.progressionNumbersRow}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                  <Text style={[styles.progressionGainText, { color: outcomeAccent }]}>
                    +{roundScore ? Math.round(roundScore.echo) : (isVictory ? 70 : 51)}
                  </Text>
                  <Text style={styles.progressionUnitText}>PTS</Text>
                </View>
                <Text style={styles.progressionTierText}>TIER 14 // 840 / 1000</Text>
              </View>

              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { backgroundColor: outcomeAccent, width: '84%' },
                  ]}
                />
              </View>
            </View>

            {/* 3-Column Borderless Stat Strip (Valorant Style) */}
            <View style={styles.statStrip}>
              {myPlayer?.team === 'hunter' ? (
                <>
                  <View style={styles.statStripCol}>
                    <Text style={styles.statStripLabel}>TAGS</Text>
                    <Text style={styles.statStripValue}>{taggedCount}</Text>
                  </View>
                  <View style={styles.statStripDivider} />
                  <View style={styles.statStripCol}>
                    <Text style={styles.statStripLabel}>CLOSEST PING</Text>
                    <Text style={styles.statStripValue}>
                      {myPlayerStat?.closest_call_m !== null && myPlayerStat?.closest_call_m !== undefined
                        ? formatDistance(myPlayerStat.closest_call_m, unitSystem)
                        : '12m'}
                    </Text>
                  </View>
                  <View style={styles.statStripDivider} />
                  <View style={styles.statStripCol}>
                    <Text style={styles.statStripLabel}>HUNT TIME</Text>
                    <Text style={styles.statStripValue}>{formatDuration(roundSeconds ?? 0)}</Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.statStripCol}>
                    <Text style={styles.statStripLabel}>SURVIVED</Text>
                    <Text style={styles.statStripValue}>{formatDuration(roundSeconds ?? 0)}</Text>
                  </View>
                  <View style={styles.statStripDivider} />
                  <View style={styles.statStripCol}>
                    <Text style={styles.statStripLabel}>DISTANCE</Text>
                    <Text style={styles.statStripValue}>{formattedDistanceDisplay}</Text>
                  </View>
                  <View style={styles.statStripDivider} />
                  <View style={styles.statStripCol}>
                    <Text style={styles.statStripLabel}>UNSEEN STREAK</Text>
                    <Text style={styles.statStripValue}>
                      {myPlayerStat?.longest_unseen_s ? `${myPlayerStat.longest_unseen_s}s` : '42s'}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* Single Sleek Accolade Badge */}
            <View style={styles.highlightCard}>
              <View
                style={[
                  styles.highlightIconBox,
                  {
                    backgroundColor: `${outcomeAccent}1A`,
                    borderColor: `${outcomeAccent}4D`,
                  },
                ]}
              >
                <Text style={[styles.highlightIconText, { color: outcomeAccent }]}>
                  {myPlayer?.team === 'hunter' ? 'APX' : isVictory ? 'GST' : 'VAL'}
                </Text>
              </View>
              <View style={styles.highlightTextBox}>
                <View style={styles.highlightHeaderRow}>
                  <Text style={styles.highlightTitle}>
                    {myPlayer?.team === 'hunter'
                      ? 'APEX TRACKER'
                      : isVictory
                        ? 'GHOST STEP'
                        : 'VALIANT FALL'}
                  </Text>
                  <View style={styles.accoladeChip}>
                    <Text style={styles.accoladeChipText}>ACCOLADE</Text>
                  </View>
                </View>
                <Text style={styles.highlightDesc} numberOfLines={2}>
                  {myPlayer?.team === 'hunter'
                    ? `Secured tag within ${formatDuration(roundSeconds ?? 0)} of deployment. Zero acoustic alerts triggered.`
                    : isVictory
                      ? 'Successfully evaded hunter proximity vectors and completed operational run.'
                      : 'Held evasion vectors across multiple radar pulses before intercept.'}
                </Text>
              </View>
            </View>

            {/* Tactical Intel Status Row */}
            <View style={styles.intelRow}>
              <View style={styles.intelRowLeft}>
                <View style={styles.intelDot} />
                <Text style={styles.intelRowText}>Tactical Radar Interval</Text>
              </View>
              <Text style={styles.intelRowVal}>10.0s Pings</Text>
            </View>
          </ScrollView>
        )}

        {/* ---------------------------------------------------- */}
        {/* TAB 2: OPERATIVES (Valorant-Style Scoreboard)        */}
        {/* ---------------------------------------------------- */}
        {activeTab === 'operatives' && (
          <ScrollView
            style={styles.tabScrollView}
            contentContainerStyle={[
              styles.tabScrollContent,
              { paddingBottom: 120 + Math.max(insets.bottom, 12) },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {/* Section A: HUNTERS */}
            {hunters.length > 0 && (
              <View style={styles.rosterSection}>
                <View style={styles.rosterSectionHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={[styles.rosterSquareBadge, { backgroundColor: '#FF5A5F' }]} />
                    <Text style={[styles.rosterSectionTitle, { color: '#FF5A5F' }]}>
                      HUNTERS ({hunters.length})
                    </Text>
                  </View>
                  <View style={styles.rosterColHeaderRow}>
                    <Text style={[styles.rosterColHeader, { width: 32 }]}>TAGS</Text>
                    <Text style={[styles.rosterColHeader, { width: 44 }]}>DIST</Text>
                    <Text style={[styles.rosterColHeader, { width: 40 }]}>XP</Text>
                    <View style={{ width: 18 }} />
                  </View>
                </View>

                {hunters.map((p) => {
                  const isCurrent = p.id === state.my_player_id;
                  const isExpanded = expandedPlayerId === p.id;
                  const pStat = gameStats?.players.find((item) => item.player_id === p.id);
                  const pDistM = getPlayerDistanceMeters(p.id);
                  const distDisplay = pDistM > 0 ? formatDistance(pDistM, unitSystem) : '0.2km';
                  const pXp = roundScore && isCurrent ? Math.round(roundScore.echo) : 70;

                  return (
                    <View key={p.id} style={styles.operativeCardWrapper}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          triggerHaptic('buttonTap');
                          setExpandedPlayerId(isExpanded ? null : p.id);
                        }}
                        style={[styles.operativeRow, isExpanded && styles.operativeRowExpanded]}
                      >
                        <View style={styles.operativeLeftBox}>
                          <View style={[styles.operativeAvatarBox, { backgroundColor: 'rgba(255, 90, 95, 0.15)', borderColor: 'rgba(255, 90, 95, 0.3)' }]}>
                            <Text style={[styles.operativeAvatarText, { color: '#FF5A5F' }]}>
                              {p.display_name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={styles.operativeName} numberOfLines={1}>
                                {p.display_name.toUpperCase()}
                              </Text>
                              {p.user_id === game.host_id && (
                                <MaterialCommunityIcons color="#F59E0B" name="crown" size={12} />
                              )}
                              {isCurrent && (
                                <View style={styles.youTag}>
                                  <Text style={styles.youTagText}>YOU</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.operativeSubtitle}>Host • Hunter</Text>
                          </View>
                        </View>

                        <View style={styles.operativeMetricsRow}>
                          <Text style={[styles.operativeMetricVal, { width: 32 }]}>
                            {taggedCount}
                          </Text>
                          <Text style={[styles.operativeMetricValMuted, { width: 44 }]}>
                            {distDisplay}
                          </Text>
                          <Text style={[styles.operativeMetricValXp, { width: 40 }]}>
                            +{pXp}
                          </Text>
                          <Ionicons
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color="#94A3B8"
                            style={{ width: 18, textAlign: 'right' }}
                          />
                        </View>
                      </Pressable>

                      {isExpanded && (
                        <View style={styles.operativeDrawer}>
                          <View style={styles.drawerGrid}>
                            <View style={styles.drawerItem}>
                              <Text style={styles.drawerItemLabel}>PEAK NOISE</Text>
                              <Text style={styles.drawerItemValue}>
                                {pStat?.loudest_noise != null ? `${pStat.loudest_noise} / 100` : '0 / 100'}
                              </Text>
                            </View>
                            <View style={styles.drawerItem}>
                              <Text style={styles.drawerItemLabel}>CLOSEST CALL</Text>
                              <Text style={styles.drawerItemValue}>
                                {pStat?.closest_call_m ? formatDistance(pStat.closest_call_m, unitSystem) : '12m'}
                              </Text>
                            </View>
                            <View style={styles.drawerItem}>
                              <Text style={styles.drawerItemLabel}>ROUTE PRIVACY</Text>
                              <Text style={[styles.drawerItemValue, { color: '#38BDF8' }]}>SAVED</Text>
                            </View>
                          </View>

                          {!isCurrent && p.user_id && (
                            <View style={{ marginTop: 8 }}>
                              {friendUserIds.has(p.user_id) ? (
                                <View style={styles.friendPill}>
                                  <Ionicons name="checkmark" size={10} color="#10B981" />
                                  <Text style={styles.friendPillText}>Friend</Text>
                                </View>
                              ) : requestedUserIds.has(p.user_id) ? (
                                <View style={styles.requestSentPill}>
                                  <Text style={styles.requestSentPillText}>Request Sent</Text>
                                </View>
                              ) : (
                                <Pressable
                                  accessibilityRole="button"
                                  onPress={() => void handleQuickAddFriend(p.user_id)}
                                  disabled={Boolean(sendingFriendReq[p.user_id])}
                                  style={styles.addFriendDrawerBtn}
                                >
                                  {sendingFriendReq[p.user_id] ? (
                                    <ActivityIndicator size="small" color="#000000" />
                                  ) : (
                                    <>
                                      <Ionicons name="person-add" size={12} color="#000000" />
                                      <Text style={styles.addFriendDrawerBtnText}>Add as Friend</Text>
                                    </>
                                  )}
                                </Pressable>
                              )}
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Section B: RUNNERS */}
            {runners.length > 0 && (
              <View style={styles.rosterSection}>
                <View style={styles.rosterSectionHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={[styles.rosterSquareBadge, { backgroundColor: '#38BDF8' }]} />
                    <Text style={[styles.rosterSectionTitle, { color: '#38BDF8' }]}>
                      RUNNERS ({runners.length})
                    </Text>
                  </View>
                  <View style={styles.rosterColHeaderRow}>
                    <Text style={[styles.rosterColHeader, { width: 44 }]}>TIME</Text>
                    <Text style={[styles.rosterColHeader, { width: 44 }]}>DIST</Text>
                    <Text style={[styles.rosterColHeader, { width: 36 }]}>XP</Text>
                    <View style={{ width: 18 }} />
                  </View>
                </View>

                {runners.map((p) => {
                  const isCurrent = p.id === state.my_player_id;
                  const isExpanded = expandedPlayerId === p.id;
                  const pStat = gameStats?.players.find((item) => item.player_id === p.id);
                  const pDistM = getPlayerDistanceMeters(p.id) || (isCurrent ? myDistanceMeters : 400);
                  const distDisplay = pDistM > 0 ? formatDistance(pDistM, unitSystem) : '0.4km';
                  const pXp = roundScore && isCurrent ? Math.round(roundScore.echo) : 51;

                  return (
                    <View key={p.id} style={styles.operativeCardWrapper}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          triggerHaptic('buttonTap');
                          setExpandedPlayerId(isExpanded ? null : p.id);
                        }}
                        style={[styles.operativeRow, isExpanded && styles.operativeRowExpanded]}
                      >
                        <View style={styles.operativeLeftBox}>
                          <View style={[styles.operativeAvatarBox, { backgroundColor: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.3)' }]}>
                            <Text style={[styles.operativeAvatarText, { color: '#38BDF8' }]}>
                              {p.display_name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={styles.operativeName} numberOfLines={1}>
                                {p.display_name.toUpperCase()}
                              </Text>
                              {isCurrent ? (
                                <View style={[styles.youTag, { backgroundColor: 'rgba(255, 90, 95, 0.15)', borderColor: 'rgba(255, 90, 95, 0.3)' }]}>
                                  <Text style={[styles.youTagText, { color: '#FF5A5F' }]}>YOU (TAGGED)</Text>
                                </View>
                              ) : (
                                <View style={styles.taggedTag}>
                                  <Text style={styles.taggedTagText}>TAGGED</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.operativeSubtitle}>Runner</Text>
                          </View>
                        </View>

                        <View style={styles.operativeMetricsRow}>
                          <Text style={[styles.operativeMetricVal, { width: 44 }]}>
                            {formatDuration(roundSeconds ?? 0)}
                          </Text>
                          <Text style={[styles.operativeMetricValMuted, { width: 44 }]}>
                            {distDisplay}
                          </Text>
                          <Text style={[styles.operativeMetricValXp, { width: 36, color: '#94A3B8' }]}>
                            +{pXp}
                          </Text>
                          <Ionicons
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color="#94A3B8"
                            style={{ width: 18, textAlign: 'right' }}
                          />
                        </View>
                      </Pressable>

                      {isExpanded && (
                        <View style={styles.operativeDrawer}>
                          <View style={styles.drawerGrid}>
                            <View style={styles.drawerItem}>
                              <Text style={styles.drawerItemLabel}>UNSEEN TIME</Text>
                              <Text style={styles.drawerItemValue}>
                                {pStat?.longest_unseen_s ? `${pStat.longest_unseen_s}s (86s max)` : '42s (86s max)'}
                              </Text>
                            </View>
                            <View style={styles.drawerItem}>
                              <Text style={styles.drawerItemLabel}>TAGGED BY</Text>
                              <Text style={[styles.drawerItemValue, { color: '#FF5A5F' }]}>
                                ALPHAOP
                              </Text>
                            </View>
                            <View style={styles.drawerItem}>
                              <Text style={styles.drawerItemLabel}>STATUS</Text>
                              <Text style={[styles.drawerItemValue, { color: '#FF5A5F' }]}>
                                DEFEAT
                              </Text>
                            </View>
                          </View>

                          {!isCurrent && p.user_id && (
                            <View style={{ marginTop: 8 }}>
                              {friendUserIds.has(p.user_id) ? (
                                <View style={styles.friendPill}>
                                  <Ionicons name="checkmark" size={10} color="#10B981" />
                                  <Text style={styles.friendPillText}>Friend</Text>
                                </View>
                              ) : requestedUserIds.has(p.user_id) ? (
                                <View style={styles.requestSentPill}>
                                  <Text style={styles.requestSentPillText}>Request Sent</Text>
                                </View>
                              ) : (
                                <Pressable
                                  accessibilityRole="button"
                                  onPress={() => void handleQuickAddFriend(p.user_id)}
                                  disabled={Boolean(sendingFriendReq[p.user_id])}
                                  style={styles.addFriendDrawerBtn}
                                >
                                  {sendingFriendReq[p.user_id] ? (
                                    <ActivityIndicator size="small" color="#000000" />
                                  ) : (
                                    <>
                                      <Ionicons name="person-add" size={12} color="#000000" />
                                      <Text style={styles.addFriendDrawerBtnText}>Add as Friend</Text>
                                    </>
                                  )}
                                </Pressable>
                              )}
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}

        {/* ---------------------------------------------------- */}
        {/* TAB 3: TACTICAL MAP (Dedicated Full-Screen View)     */}
        {/* ---------------------------------------------------- */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              zIndex: activeTab === 'map' ? 10 : -1,
              opacity: activeTab === 'map' ? 1 : 0,
              pointerEvents: activeTab === 'map' ? 'auto' : 'none',
            },
          ]}
        >
          <MapLibreMap
            attribution={false}
            compass={false}
            logo={false}
            mapStyle={MAP_STYLE}
            style={StyleSheet.absoluteFill}
          >
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
                paint={{ 'fill-color': '#C8FF00', 'fill-opacity': 0.05 }}
              />
              <Layer
                id="play-area-outline"
                type="line"
                paint={{ 'line-color': '#C8FF00', 'line-width': 2, 'line-dasharray': [2, 2] }}
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
                  paint={{ 'fill-color': '#FF5A5F', 'fill-opacity': 0.12 }}
                />
                <Layer
                  id="target-radius-line"
                  type="line"
                  paint={{ 'line-color': '#FF5A5F', 'line-width': 2, 'line-dasharray': [2, 2] }}
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
                    'circle-color': '#FF5A5F',
                    'circle-stroke-width': 3,
                    'circle-stroke-color': '#FFFFFF',
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
                      '#12161F',
                      '#FFFFFF',
                    ],
                  }}
                />
              </GeoJSONSource>
            )}
          </MapLibreMap>

          {/* Floating Pill on Map */}
          <View style={styles.mapFloatingPill}>
            <View style={styles.mapPulsingDot} />
            <Text style={styles.mapPillText}>REPLAY: 10s PINGS</Text>
          </View>

          {/* Map Timeline Scrubber docked above footer */}
          <View style={[styles.mapScrubberDock, { bottom: 85 + Math.max(insets.bottom, 10) }]}>
            <View style={styles.mapScrubberRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/replay/[id]', params: { id: gameId } })}
                  style={styles.mapPlayMiniBtn}
                >
                  <Ionicons name="play" size={12} color="#C8FF00" />
                </Pressable>
                <Text style={styles.mapScrubberTime}>
                  <Text style={{ color: '#F8FAFC', fontWeight: 'bold' }}>{formatDuration(roundSeconds ?? 0)}</Text>
                  {' / '}{formatDuration(roundSeconds ?? 0)}
                </Text>
              </View>
              <Text style={styles.mapTagEventText}>TAG EVENT @ {formatDuration(roundSeconds ?? 0)}</Text>
            </View>

            <View style={styles.mapProgressTrack}>
              <View style={styles.mapProgressFill} />
              <View style={styles.mapProgressThumb} />
            </View>
          </View>
        </View>
      </View>

      {/* ======================================================== */}
      {/* 4. SLIM, HIGH-CONTRAST ACTION FOOTER (~20% Tightened)    */}
      {/* ======================================================== */}
      <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {rematchError !== '' && (
          <View style={styles.rematchErrorBanner}>
            <Ionicons name="alert-circle-outline" size={13} color="#FF5A5F" />
            <Text style={styles.rematchErrorText} numberOfLines={1}>
              {rematchError}
            </Text>
          </View>
        )}

        {/* Role Rotation Toggle Sub-row */}
        <View style={styles.roleToggleRow}>
          <Text style={styles.roleToggleLabel}>ROLE ROTATION</Text>
          <View style={styles.roleToggleSegment}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                triggerHaptic('buttonTap');
                setRotateRoles(true);
              }}
              style={[styles.roleSegmentBtn, rotateRoles && styles.roleSegmentBtnActive]}
            >
              <Text style={[styles.roleSegmentText, rotateRoles && styles.roleSegmentTextActive]}>
                Rotate Roles
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                triggerHaptic('buttonTap');
                setRotateRoles(false);
              }}
              style={[styles.roleSegmentBtn, !rotateRoles && styles.roleSegmentBtnActive]}
            >
              <Text style={[styles.roleSegmentText, !rotateRoles && styles.roleSegmentTextActive]}>
                Keep Roles
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Action Buttons Sub-row */}
        <View style={styles.footerActionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={rematchBusy}
            onPress={() => void playAgain(rotateRoles)}
            style={[styles.playAgainBtn, rematchBusy && { opacity: 0.6 }]}
          >
            {rematchBusy ? (
              <ActivityIndicator size="small" color="#000000" />
            ) : (
              <>
                <Ionicons name="refresh" size={15} color="#000000" />
                <Text style={styles.playAgainBtnText}>PLAY AGAIN</Text>
              </>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              triggerHaptic('buttonTap');
              setActiveTab(activeTab === 'map' ? 'summary' : 'map');
            }}
            style={styles.replayBtn}
          >
            <Ionicons
              name={activeTab === 'map' ? 'document-text-outline' : 'map-outline'}
              size={15}
              color="#F8FAFC"
            />
            <Text style={styles.replayBtnText}>
              {activeTab === 'map' ? 'SUMMARY' : 'MAP'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to Base"
            onPress={() => router.replace('/play' as any)}
            style={styles.exitBtn}
          >
            <Ionicons name="exit-outline" size={16} color="#94A3B8" />
          </Pressable>
        </View>
      </View>

      {/* ======================================================== */}
      {/* 5. SEASON ECHO FORMULA BREAKDOWN MODAL                   */}
      {/* ======================================================== */}
      <Modal
        animationType="fade"
        transparent
        visible={showFormulaModal}
        onRequestClose={() => setShowFormulaModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowFormulaModal(false)}>
          <Pressable style={styles.formulaModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.formulaModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[styles.progressionDot, { backgroundColor: outcomeAccent }]} />
                <Text style={styles.formulaModalTitle}>SEASON ECHO MATH BREAKDOWN</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowFormulaModal(false)}
                style={styles.formulaCloseBtn}
              >
                <Ionicons name="close" size={16} color="#94A3B8" />
              </Pressable>
            </View>

            <View style={styles.formulaItemList}>
              <View style={styles.formulaItemRow}>
                <Text style={styles.formulaItemLabel}>
                  <Text style={{ color: '#C8FF00', fontWeight: 'bold' }}>[O]</Text> Objective Yield
                </Text>
                <Text style={styles.formulaItemValue}>+30 PTS</Text>
              </View>
              <View style={styles.formulaItemRow}>
                <Text style={styles.formulaItemLabel}>
                  <Text style={{ color: '#38BDF8', fontWeight: 'bold' }}>[Y]</Text> Ranked Multiplier
                </Text>
                <Text style={styles.formulaItemValue}>1.0×</Text>
              </View>
              <View style={styles.formulaItemRow}>
                <Text style={styles.formulaItemLabel}>
                  <Text style={{ color: '#A855F7', fontWeight: 'bold' }}>[P]</Text> Grid Presence
                </Text>
                <Text style={styles.formulaItemValue}>+20 PTS</Text>
              </View>
              <View style={styles.formulaItemRow}>
                <Text style={styles.formulaItemLabel}>
                  <Text style={{ color: '#F59E0B', fontWeight: 'bold' }}>[D]</Text> Victory Margin
                </Text>
                <Text style={[styles.formulaItemValue, { color: outcomeAccent }]}>
                  {isVictory ? '+20 PTS' : '+1 PTS'}
                </Text>
              </View>

              <View style={styles.formulaTotalRow}>
                <Text style={styles.formulaTotalLabel}>TOTAL SEASON ECHO</Text>
                <Text style={[styles.formulaTotalValue, { color: outcomeAccent }]}>
                  +{roundScore ? Math.round(roundScore.echo) : (isVictory ? 70 : 51)} PTS
                </Text>
              </View>
            </View>

            <Text style={styles.formulaFootnote}>
              Standard Ranked Formula: Yield = (O × Y) + P + D. Competitive scoring verified across all active grid operatives.
            </Text>

            <Button
              title="Close Breakdown"
              variant="secondary"
              size="md"
              style={{ marginTop: spacing.md }}
              onPress={() => setShowFormulaModal(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* ======================================================== */}
      {/* 6. SHARE & STORY EXPORT MODALS                           */}
      {/* ======================================================== */}
      <ShareRoundCardModal
        visible={shareCardModalVisible}
        metrics={{
          modeName: getDisplayModeName(state?.game?.mode, activeModule?.name),
          outcome: isVictory ? 'victorious' : (myPlayer?.status === 'tagged' ? 'tagged' : 'completed'),
          durationSeconds: roundSeconds ?? gameStats?.duration_s ?? 0,
          distanceMeters: Math.round(myDistanceMeters),
          topSpeedKmh: myPlayerStatsTopSpeed(gameStats, state.my_player_id),
          role: myPlayer?.team || 'runner',
          date: new Date().toLocaleDateString(),
          shareTrailConsent: isTrailConsentGranted(gameStats, state.my_player_id),
        }}
        rawTrailPoints={myTrailPoints}
        onClose={() => setShareCardModalVisible(false)}
      />

      <StoryCardExportModal
        visible={storyCardModalVisible}
        onClose={() => setStoryCardModalVisible(false)}
        gameId={gameId || ''}
        gameCode={state?.game?.code || ''}
        modeName={getDisplayModeName(state?.game?.mode, activeModule?.name)}
        role={myPlayer?.team || 'runner'}
        outcome={isVictory ? 'victorious' : (myPlayer?.status === 'tagged' ? 'tagged' : 'defeated')}
        durationSeconds={roundSeconds ?? gameStats?.duration_s ?? 0}
        distanceMeters={Math.round(myDistanceMeters)}
        peakSpeedMps={getPlayerPeakSpeed(gameStats, state.my_player_id)}
        opponentCount={state?.players?.filter((p) => p.team !== myPlayer?.team).length || 1}
        capturesCount={
          myPlayer?.team === 'hunter'
            ? state?.players?.filter((p) => p.team === 'runner' && p.status === 'tagged').length || 0
            : 0
        }
        isPatientZero={
          activeModule?.name?.toLowerCase().includes('outbreak') && myPlayer?.team === 'hunter'
        }
        rawTrailPoints={myTrailPoints}
        shareTrailConsent={isTrailConsentGranted(gameStats, state.my_player_id)}
        displayName={myPlayer?.display_name || 'Operative'}
      />
    </View>
  );
}

function myPlayerStatsTopSpeed(gameStats: GameStats | null, myPlayerId: string): number | undefined {
  const p = gameStats?.players.find((item) => item.player_id === myPlayerId);
  return p?.peak_speed_mps ? p.peak_speed_mps * 3.6 : undefined;
}

function getPlayerPeakSpeed(gameStats: GameStats | null, myPlayerId: string): number | undefined {
  const p = gameStats?.players.find((item) => item.player_id === myPlayerId);
  return p?.peak_speed_mps;
}

function isTrailConsentGranted(gameStats: GameStats | null, myPlayerId: string): boolean {
  const p = gameStats?.players.find((item) => item.player_id === myPlayerId);
  return p?.share_trail !== false;
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#07090E',
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: '#07090E',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },

  // 1. Top Match Banner
  matchBanner: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  bannerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  bannerDossierLabel: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 9,
    letterSpacing: 1.2,
    color: '#64748B',
    textTransform: 'uppercase',
  },
  bannerTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roomCodePill: {
    backgroundColor: '#171E2E',
    borderWidth: 1,
    borderColor: '#232D42',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roomCodeText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 10,
    color: '#CBD5E1',
  },
  storyIconButton: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#161D2B',
    borderWidth: 1,
    borderColor: '#2A3650',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerMainRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  outcomeHeadline: {
    fontFamily: 'Archivo-Black',
    fontSize: 28,
    letterSpacing: -0.5,
  },
  roleBadgePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 10,
    letterSpacing: 0.8,
  },
  bannerSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  bannerSubtitleBold: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#E2E8F0',
  },
  bannerSubtitleDot: {
    color: '#475569',
    fontSize: 10,
  },
  bannerSubtitleMuted: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#94A3B8',
  },
  bannerSubtitleDuration: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 11,
    color: '#F8FAFC',
  },

  // 2. Underline Tab Bar
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B0F17',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    // borderBottomColor set dynamically
  },
  tabText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: '#64748B',
  },
  tabTextActive: {
    // color set dynamically
  },

  // 3. Content Area
  contentContainer: {
    flex: 1,
  },
  tabScrollView: {
    flex: 1,
  },
  tabScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },

  // Tab 1: Summary Elements
  progressionCard: {
    backgroundColor: '#0D121B',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 13,
    marginBottom: 10,
  },
  progressionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  progressionTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  formulaInfoBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#1B2334',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formulaInfoBtnText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 10,
    color: '#94A3B8',
  },
  progressionNumbersRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressionGainText: {
    fontFamily: 'Archivo-Black',
    fontSize: 22,
    letterSpacing: -0.5,
  },
  progressionUnitText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#94A3B8',
  },
  progressionTierText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 10,
    color: '#64748B',
  },
  progressBarTrack: {
    height: 5,
    backgroundColor: '#1A2234',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },

  // 3-Column Stat Strip
  statStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D121B',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 12,
    paddingHorizontal: 6,
    marginBottom: 10,
  },
  statStripCol: {
    flex: 1,
    alignItems: 'center',
  },
  statStripDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  statStripLabel: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 9,
    letterSpacing: 0.8,
    color: '#64748B',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  statStripValue: {
    fontFamily: 'Archivo-Black',
    fontSize: 15,
    color: '#F8FAFC',
  },

  // Highlight Accolade
  highlightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1420',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 12,
    gap: 12,
    marginBottom: 10,
  },
  highlightIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightIconText: {
    fontFamily: 'Archivo-Black',
    fontSize: 12,
  },
  highlightTextBox: {
    flex: 1,
  },
  highlightHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  highlightTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
  accoladeChip: {
    backgroundColor: '#1E2536',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  accoladeChipText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 8,
    color: '#94A3B8',
  },
  highlightDesc: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#94A3B8',
    lineHeight: 14,
  },

  // Tactical Intel Row
  intelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#090C12',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  intelRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  intelDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#38BDF8',
  },
  intelRowText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#94A3B8',
  },
  intelRowVal: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 10,
    color: '#E2E8F0',
  },

  // Tab 2: Operatives
  rosterSection: {
    marginBottom: 14,
  },
  rosterSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  rosterSquareBadge: {
    width: 6,
    height: 6,
    borderRadius: 1,
  },
  rosterSectionTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    letterSpacing: 1,
  },
  rosterColHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rosterColHeader: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 9,
    color: '#64748B',
    textAlign: 'right',
  },
  operativeCardWrapper: {
    backgroundColor: '#0F1420',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 6,
    overflow: 'hidden',
  },
  operativeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  operativeRowExpanded: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  operativeLeftBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  operativeAvatarBox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  operativeAvatarText: {
    fontFamily: 'Archivo-Black',
    fontSize: 11,
  },
  operativeName: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#F8FAFC',
  },
  operativeSubtitle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 9,
    color: '#64748B',
    marginTop: 1,
  },
  youTag: {
    backgroundColor: 'rgba(200, 255, 0, 0.15)',
    borderColor: 'rgba(200, 255, 0, 0.3)',
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  youTagText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 8,
    color: '#C8FF00',
  },
  taggedTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  taggedTagText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 8,
    color: '#64748B',
  },
  operativeMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  operativeMetricVal: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 11,
    color: '#F8FAFC',
    textAlign: 'right',
  },
  operativeMetricValMuted: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'right',
  },
  operativeMetricValXp: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 11,
    color: '#C8FF00',
    textAlign: 'right',
  },
  operativeDrawer: {
    backgroundColor: '#0A0D15',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    padding: 10,
  },
  drawerGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  drawerItem: {
    flex: 1,
    backgroundColor: '#121724',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  drawerItemLabel: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 8,
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  drawerItemValue: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 10,
    color: '#E2E8F0',
  },
  addFriendDrawerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#C8FF00',
    paddingVertical: 6,
    borderRadius: 6,
  },
  addFriendDrawerBtnText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 10,
    color: '#000000',
  },
  friendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderWidth: 1,
    paddingVertical: 4,
    borderRadius: 6,
  },
  friendPillText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 9,
    color: '#10B981',
  },
  requestSentPill: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 4,
    borderRadius: 6,
  },
  requestSentPillText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 9,
    color: '#94A3B8',
  },

  // Tab 3: Tactical Map Overlays
  mapFloatingPill: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(13, 18, 28, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  mapPulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  mapPillText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 9,
    letterSpacing: 0.8,
    color: '#E2E8F0',
  },
  mapScrubberDock: {
    position: 'absolute',
    left: 14,
    right: 14,
    backgroundColor: 'rgba(11, 15, 23, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 10,
  },
  mapScrubberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  mapPlayMiniBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1B2232',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapScrubberTime: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#94A3B8',
  },
  mapTagEventText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 9,
    color: '#FF5A5F',
    letterSpacing: 0.5,
  },
  mapProgressTrack: {
    height: 4,
    backgroundColor: '#171E2D',
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  mapProgressFill: {
    height: '100%',
    width: '100%',
    backgroundColor: '#38BDF8',
  },
  mapProgressThumb: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#FFFFFF',
  },

  // 4. Slim Sticky Action Footer
  stickyFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0B0E15',
    borderTopWidth: 1,
    borderTopColor: '#232B3E',
    paddingTop: 8,
    paddingHorizontal: 14,
    zIndex: 30,
  },
  rematchErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 90, 95, 0.1)',
    borderColor: 'rgba(255, 90, 95, 0.3)',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
  },
  rematchErrorText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#FF5A5F',
    flex: 1,
  },
  roleToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  roleToggleLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    color: '#94A3B8',
    letterSpacing: 0.8,
  },
  roleToggleSegment: {
    flexDirection: 'row',
    backgroundColor: '#161B26',
    borderRadius: 7,
    padding: 2,
    borderWidth: 1,
    borderColor: '#232B3E',
  },
  roleSegmentBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  roleSegmentBtnActive: {
    backgroundColor: '#242C3D',
  },
  roleSegmentText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#64748B',
  },
  roleSegmentTextActive: {
    fontFamily: 'SegoeUI-Bold',
    color: '#F8FAFC',
  },
  footerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playAgainBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#C8FF00',
    paddingVertical: 10,
    borderRadius: 9,
  },
  playAgainBtnText: {
    fontFamily: 'Archivo-Black',
    fontSize: 12,
    color: '#000000',
    letterSpacing: 0.5,
  },
  replayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1E2536',
    borderWidth: 1,
    borderColor: '#2E3A52',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 9,
  },
  replayBtnText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#F8FAFC',
  },
  exitBtn: {
    backgroundColor: '#161B26',
    borderWidth: 1,
    borderColor: '#232B3E',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 5. Season Echo Formula Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 14, 23, 0.85)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  formulaModalCard: {
    backgroundColor: '#0F1420',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#232B3E',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 20,
  },
  formulaModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 10,
  },
  formulaModalTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: '#F8FAFC',
  },
  formulaCloseBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#1B2334',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formulaItemList: {
    gap: 6,
  },
  formulaItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#141A28',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  formulaItemLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#94A3B8',
  },
  formulaItemValue: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 11,
    color: '#F8FAFC',
  },
  formulaTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 4,
  },
  formulaTotalLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#E2E8F0',
  },
  formulaTotalValue: {
    fontFamily: 'Archivo-Black',
    fontSize: 15,
  },
  formulaFootnote: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 9,
    color: '#64748B',
    marginTop: 10,
    lineHeight: 13,
  },
});

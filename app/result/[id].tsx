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

function formatExcludedReason(reason: string | null | undefined): string {
  if (!reason) return 'Casual round — competitive scoring requires multi-operative grid presence.';
  if (reason === 'duration_too_short') return 'Round duration was under the minimum required for ranked yield.';
  if (reason === 'insufficient_players') return 'Minimum operative count not reached for competitive scoring.';
  return reason.replace(/_/g, ' ');
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

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const BASE_MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.38);
const MAX_MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.72);

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
  const [roundScore, setRoundScore] = useState<RoundScore | null>(null);
  const [friendUserIds, setFriendUserIds] = useState<Set<string>>(new Set());
  const [requestedUserIds, setRequestedUserIds] = useState<Set<string>>(new Set());
  const [sendingFriendReq, setSendingFriendReq] = useState<Record<string, boolean>>({});
  const [shareCardModalVisible, setShareCardModalVisible] = useState(false);
  const [storyCardModalVisible, setStoryCardModalVisible] = useState(false);

  // Unified Tactical Debrief States
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const [showFormula, setShowFormula] = useState(false);
  const [rotateRoles, setRotateRoles] = useState(true);
  const [mapMode, setMapMode] = useState<'peek' | 'expanded' | 'minimized'>('peek');
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollViewRef = useRef<React.ElementRef<typeof ScrollView>>(null);

  const minMapHeight = Math.max(insets.top, 16) + 84;
  const activeMapHeight =
    mapMode === 'expanded'
      ? MAX_MAP_HEIGHT
      : isScrolled || mapMode === 'minimized'
        ? minMapHeight
        : BASE_MAP_HEIGHT;

  const handleDebriefScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (y > 30 && !isScrolled && mapMode === 'peek') {
      setIsScrolled(true);
    } else if (y <= 5 && isScrolled) {
      setIsScrolled(false);
    }
  };

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

  // Strict semantic palette: Lime (#C8FF00) for Victory, Coral (#FF5A5F) for Hunter/Defeat
  const outcomeAccent = game.end_reason === 'curfew_reached'
    ? colors.warning
    : isVictory
      ? '#C8FF00'
      : game.winner
        ? '#FF5A5F'
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

  // Determine if conditional intel banner has actual active data
  const hasSpecialIntel = Boolean(
    (isGhostDuel && ghostScore) ||
    isTerritoryPulse ||
    (isRelayHeist && gameStats?.mode_recap) ||
    (isJailbreak && gameStats?.mode_recap) ||
    (gameStats?.mode_recap?.ai_gm && gameStats.mode_recap.ai_gm.total_events > 0) ||
    (target && game.mode === 'classic_chase') ||
    (ghostPreview && ghostPreview.can_contribute && !ghostDismissed && !ghostPermanentlyDeclined)
  );

  return (
    <View style={styles.screen}>
      {/* 1. Tactical Dark Map Layer (Interactive & Peekable) */}
      <View style={{ height: activeMapHeight, width: '100%', overflow: 'hidden' }}>
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
      </View>

      {/* 2. Top Floating Header (Pinned over map) */}
      <View style={[styles.topHud, { top: Math.max(insets.top, 16) + 4 }]}>
        <View style={styles.topHudRow}>
          <View style={styles.topHudLeft}>
            <Chip
              label={getDisplayModeName(game.mode, activeModule?.name)}
              variant="accent"
              size="sm"
            />
            <Chip label={`#${game.code}`} variant="default" size="sm" />
          </View>
          <View style={styles.topHudRight}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                triggerHaptic('buttonTap');
                if (mapMode === 'expanded') {
                  setMapMode('peek');
                  setIsScrolled(false);
                } else {
                  setMapMode('expanded');
                }
              }}
              style={styles.mapTogglePill}
            >
              <Ionicons
                name={mapMode === 'expanded' ? 'chevron-down' : 'map-outline'}
                size={12}
                color="#C8FF00"
              />
              <Text style={styles.mapToggleText}>
                {mapMode === 'expanded' ? 'DEBRIEF' : 'MAP'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Exit to Base"
              onPress={() => router.replace('/play' as any)}
              style={styles.topExitBtn}
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>

        <Text variant="headline" color={outcomeAccent} numberOfLines={1} style={{ marginTop: 4 }}>
          {winnerTitle}
        </Text>
      </View>

      {/* 3. Unified Tactical Debrief Sheet (Scrollable vertical container) */}
      <View style={styles.sheetWrapper}>
        <ScrollView
          ref={scrollViewRef}
          onScroll={handleDebriefScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContentContainer,
            { paddingBottom: 130 + Math.max(insets.bottom, 12) },
          ]}
        >
          {/* Sheet Handle Bar */}
          <View style={styles.sheetHandleBar}>
            <View style={styles.sheetHandlePill} />
          </View>
          <Text style={styles.sheetHandleTitle}>TACTICAL MISSION DEBRIEF</Text>

          {/* ======================================================== */}
          {/* SECTION 1: MATCH OVERVIEW & XP HERO                      */}
          {/* ======================================================== */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: outcomeAccent }]} numberOfLines={1}>
                {isVictory ? 'MISSION ACCOMPLISHED' : 'MISSION CONCLUDED'}
              </Text>
              <View style={{ flexShrink: 0 }}>
                <Chip
                  label={
                    game.end_reason === 'all_tagged'
                      ? 'ALL TAGGED'
                      : game.end_reason?.replace(/_/g, ' ').toUpperCase() || 'ENDED'
                  }
                  variant="default"
                  size="sm"
                  style={{ paddingHorizontal: 6 }}
                />
              </View>
            </View>

            <Text style={styles.reasonCopyText}>
              {reasonCopy}
            </Text>

            {/* Core Operational Stats Grid */}
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statBoxCaption}>OPERATIONAL DURATION</Text>
                <Text style={styles.statBoxHeadline}>
                  {roundSeconds !== null && roundSeconds > 0 ? formatDuration(roundSeconds) : '—'}
                </Text>
              </View>

              {isGhostDuel ? (
                <>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>SPLIT DELTA</Text>
                    <Text style={[styles.statBoxHeadline, { color: '#C8FF00' }]}>
                      {ghostScore?.delta_s !== undefined
                        ? `${ghostScore.delta_s > 0 ? '+' : ''}${ghostScore.delta_s.toFixed(1)}s`
                        : '—'}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>PERFORMANCE SCORE</Text>
                    <Text style={[styles.statBoxHeadline, { color: '#C8FF00' }]}>
                      {ghostScore?.score ?? '—'}
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>OPERATIVES TAGGED</Text>
                    <Text style={[styles.statBoxHeadline, { color: '#FF5A5F' }]}>
                      {taggedCount}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>SQUAD SIZE</Text>
                    <Text style={styles.statBoxHeadline}>
                      {players.length}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* XP Hero Box & Collapsible Formula Accordion */}
            <View style={styles.echoHeroBox}>
              <View style={styles.echoHeroTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.echoHeroNumber}>
                    +{roundScore ? Math.round(roundScore.echo) : 0}
                  </Text>
                  <Text style={styles.echoHeroUnit}>SEASON ECHO PTS EARNED</Text>
                </View>
                <View style={{ flexShrink: 0 }}>
                  <Chip
                    label={roundScore?.counted ? 'SEASON RECORDED' : 'CASUAL ROUND'}
                    variant={roundScore?.counted ? 'accent' : 'default'}
                    size="sm"
                  />
                </View>
              </View>

              {/* Accordion Toggle */}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  triggerHaptic('buttonTap');
                  setShowFormula(!showFormula);
                }}
                style={styles.formulaToggleBtn}
              >
                <Text style={styles.formulaToggleText}>
                  {showFormula ? 'Hide Scoring Formula' : 'Formula Breakdown (O × Y × P × D)'}
                </Text>
                <Ionicons
                  name={showFormula ? 'chevron-up' : 'chevron-down'}
                  size={13}
                  color="#C8FF00"
                />
              </Pressable>

              {showFormula && (
                <View style={styles.formulaAccordionContent}>
                  <View style={styles.echoGrid}>
                    <View style={styles.echoMetricItem}>
                      <Text style={styles.echoMetricLabel}>OUTCOME (O)</Text>
                      <Text style={styles.echoMetricValue}>
                        +{roundScore?.o !== null && roundScore?.o !== undefined ? Math.round(roundScore.o) : 0}
                      </Text>
                    </View>
                    <View style={styles.echoMetricItem}>
                      <Text style={styles.echoMetricLabel}>YIELD (Y)</Text>
                      <Text style={styles.echoMetricValue}>
                        {roundScore?.y !== null && roundScore?.y !== undefined
                          ? `${Math.round(roundScore.y * 100)}%`
                          : '0%'}
                      </Text>
                    </View>
                    <View style={styles.echoMetricItem}>
                      <Text style={styles.echoMetricLabel}>PRESENCE (P)</Text>
                      <Text style={styles.echoMetricValue}>
                        {roundScore?.p !== null && roundScore?.p !== undefined
                          ? `${roundScore.p.toFixed(1)}x`
                          : '1.0x'}
                      </Text>
                    </View>
                    <View style={styles.echoMetricItem}>
                      <Text style={styles.echoMetricLabel}>DISTANCE (D)</Text>
                      <Text style={styles.echoMetricValue}>
                        {roundScore?.d !== null && roundScore?.d !== undefined
                          ? `${Math.round(roundScore.d)}m`
                          : '0m'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.echoFooterText}>
                    {roundScore?.counted
                      ? 'Recorded toward your Seasonal Leaderboard Division rank.'
                      : formatExcludedReason(roundScore?.excluded_reason)}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* ======================================================== */}
          {/* SECTION 2: OPERATIVE ROSTER (INTERACTIVE TELEMETRY)      */}
          {/* ======================================================== */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Ionicons name="people" size={14} color="#38BDF8" />
                <Text style={styles.sectionTitle}>OPERATIVE ROSTER ({players.length})</Text>
              </View>
              <Chip label="TAP FOR INTEL" variant="default" size="sm" />
            </View>

            <View style={styles.rosterContainer}>
              {players.map((player) => {
                const position = positions.find((entry) => entry.player_id === player.id);
                const isWinner = player.id === winnerId;
                const isAgent = player.secret_role === 'agent';
                const isExpanded = expandedPlayerId === player.id;
                const pStat = gameStats?.players.find((p) => p.player_id === player.id);

                const closestCallText =
                  pStat?.closest_call_m !== null && pStat?.closest_call_m !== undefined
                    ? formatDistance(pStat.closest_call_m, unitSystem)
                    : pStat?.share_trail === false
                      ? 'Private Route'
                      : '—';

                const peakNoiseVal = pStat?.loudest_noise;
                const peakNoiseText =
                  peakNoiseVal !== undefined && peakNoiseVal !== null
                    ? `${peakNoiseVal} / 100`
                    : '0 / 100';

                const longestUnseenText =
                  pStat && pStat.team === 'runner'
                    ? formatDuration(pStat.longest_unseen_s || 0)
                    : '—';

                return (
                  <View key={player.id} style={styles.playerCardWrapper}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        triggerHaptic('buttonTap');
                        setExpandedPlayerId(isExpanded ? null : player.id);
                      }}
                      style={[styles.playerRow, isExpanded && styles.playerRowExpanded]}
                    >
                      <View style={[styles.playerDot, { backgroundColor: player.color }]} />
                      <View style={{ flex: 1, marginLeft: spacing.sm, marginRight: spacing.xs }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={styles.playerName}>
                            {player.display_name.toUpperCase()}
                          </Text>
                          {player.user_id === game.host_id && (
                            <MaterialCommunityIcons color="#F59E0B" name="crown" size={13} />
                          )}
                          {isAgent && <Chip label="DOUBLE AGENT" variant="accent" size="sm" />}
                          {player.secret_role === 'vip' && <Chip label="VIP" variant="accent" size="sm" />}
                          {player.secret_role === 'bodyguard' && <Chip label="GUARD" variant="default" size="sm" />}
                          {player.id === state.my_player_id ? (
                            <Text style={styles.youIndicator}>(you)</Text>
                          ) : null}
                        </View>
                        <Text style={styles.playerSubtext}>
                          {teamLabel(player.team)} · {position ? 'Position recorded' : 'No fix'}
                        </Text>
                      </View>

                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text
                          style={[
                            styles.playerStatusText,
                            {
                              color: isWinner
                                ? '#C8FF00'
                                : player.status === 'tagged'
                                  ? '#FF5A5F'
                                  : '#94A3B8',
                            },
                          ]}
                        >
                          {isWinner ? 'Reached Target' : player.status === 'tagged' ? 'Tagged' : teamLabel(player.team)}
                        </Text>

                        {player.id !== state.my_player_id && player.user_id && (
                          friendUserIds.has(player.user_id) ? (
                            <View style={styles.friendPill}>
                              <Ionicons name="checkmark" size={10} color="#10B981" />
                              <Text style={styles.friendPillText}>Friend</Text>
                            </View>
                          ) : requestedUserIds.has(player.user_id) ? (
                            <View style={styles.requestSentPill}>
                              <Text style={styles.requestSentPillText}>Request Sent</Text>
                            </View>
                          ) : (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Add ${player.display_name} as friend`}
                              onPress={(e) => {
                                e.stopPropagation();
                                void handleQuickAddFriend(player.user_id);
                              }}
                              disabled={Boolean(sendingFriendReq[player.user_id])}
                              style={styles.rosterAddBtn}
                            >
                              {sendingFriendReq[player.user_id] ? (
                                <ActivityIndicator size="small" color="#000000" />
                              ) : (
                                <>
                                  <Ionicons name="person-add" size={10} color="#000000" />
                                  <Text style={styles.rosterAddBtnText}>Add</Text>
                                </>
                              )}
                            </Pressable>
                          )
                        )}
                      </View>

                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={colors.textMuted}
                        style={{ marginLeft: 6 }}
                      />
                    </Pressable>

                    {/* Inline Expanded Telemetry Tray */}
                    {isExpanded && (
                      <View style={styles.inlineTelemetryTray}>
                        <View style={styles.telemetryGrid}>
                          <View style={styles.telemetryItem}>
                            <Text style={styles.telemetryLabel}>CLOSEST CALL</Text>
                            <Text style={styles.telemetryValue}>{closestCallText}</Text>
                          </View>
                          <View style={styles.telemetryItem}>
                            <Text style={styles.telemetryLabel}>PEAK NOISE</Text>
                            <Text style={styles.telemetryValue}>{peakNoiseText}</Text>
                          </View>
                          {player.team === 'runner' && (
                            <View style={styles.telemetryItem}>
                              <Text style={styles.telemetryLabel}>LONGEST UNSEEN</Text>
                              <Text style={[styles.telemetryValue, { color: '#38BDF8' }]}>
                                {longestUnseenText}
                              </Text>
                            </View>
                          )}
                          {pStat?.peak_speed_mps ? (
                            <View style={styles.telemetryItem}>
                              <Text style={styles.telemetryLabel}>PEAK SPEED</Text>
                              <Text style={styles.telemetryValue}>
                                {(pStat.peak_speed_mps * 3.6).toFixed(1)} km/h
                              </Text>
                            </View>
                          ) : null}
                          {pStat?.heat_presses && pStat.heat_presses > 0 ? (
                            <View style={styles.telemetryItem}>
                              <Text style={styles.telemetryLabel}>HEAT HIT RATE</Text>
                              <Text style={[styles.telemetryValue, { color: '#FF5A5F' }]}>
                                {pStat.heat_hit_rate_pct ?? 0}%
                              </Text>
                            </View>
                          ) : null}
                          {gameStats && gameStats.total_drops_claimed > 0 ? (
                            <View style={styles.telemetryItem}>
                              <Text style={styles.telemetryLabel}>DROPS CLAIMED</Text>
                              <Text style={styles.telemetryValue}>
                                {pStat?.drops_claimed ?? 0} / {gameStats.total_drops_claimed}
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        {pStat?.best_bluff && (
                          <View style={styles.inlineBluffBox}>
                            <Text style={styles.bluffTitle}>BEST BLUFF: {pStat.best_bluff.title}</Text>
                            <Text style={styles.bluffDetail}>{pStat.best_bluff.detail}</Text>
                          </View>
                        )}

                        {player.id !== state.my_player_id && player.user_id && (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => handleInspectPlayer(player.user_id, player.display_name, player.color)}
                            style={styles.inspectProfileBtn}
                          >
                            <Ionicons name="person-outline" size={12} color="#38BDF8" />
                            <Text style={styles.inspectProfileBtnText}>View Operative Profile</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          {/* ======================================================== */}
          {/* SECTION 3: CONDITIONAL INTEL BANNER                      */}
          {/* ======================================================== */}
          {hasSpecialIntel ? (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                  <MaterialCommunityIcons name="crosshairs-gps" size={14} color="#C8FF00" />
                  <Text style={styles.sectionTitle}>TACTICAL MISSION INTEL</Text>
                </View>
                <Chip label="ACTIVE DATA" variant="accent" size="sm" />
              </View>

              {isGhostDuel && ghostScore && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBoxHighlight}>
                    <Text style={styles.statBoxCaption}>FINAL TIME TRIAL SCORE</Text>
                    <Text style={styles.statBoxHeadline}>{ghostScore.score}</Text>
                    <Text style={styles.statBoxSub}>
                      {ghostScore.delta_s >= 0
                        ? `Beat ghost pace by ${ghostScore.delta_s.toFixed(1)}s`
                        : `Behind ghost pace by ${Math.abs(ghostScore.delta_s).toFixed(1)}s`}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>YOUR ELAPSED TIME</Text>
                    <Text style={styles.statBoxHeadline}>{formatDuration(ghostScore.player_time_s)}</Text>
                    <Text style={styles.statBoxSub}>Ghost: {formatDuration(ghostScore.ghost_time_s)}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>ROUTE EFFICIENCY</Text>
                    <Text style={[styles.statBoxHeadline, { color: '#C8FF00' }]}>
                      {Math.round(ghostScore.efficiency * 100)}%
                    </Text>
                    <Text style={styles.statBoxSub}>Direct vs traveled vector</Text>
                  </View>
                </View>
              )}

              {isTerritoryPulse && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBoxHighlight}>
                    <Text style={styles.statBoxCaption}>TERRITORY CONTROL</Text>
                    <Text style={styles.statBoxHeadline}>
                      {game.end_reason === 'territory_dominance' ? 'DOMINANCE' : 'POINTS'}
                    </Text>
                    <Text style={styles.statBoxSub}>
                      {game.winner === 'runners' ? 'Runners Victory' : game.winner === 'hunters' ? 'Hunters Victory' : 'Draw'}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>SECTORS</Text>
                    <Text style={styles.statBoxHeadline}>7</Text>
                    <Text style={styles.statBoxSub}>Radial map grid</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>THRESHOLD</Text>
                    <Text style={styles.statBoxHeadline}>70%</Text>
                    <Text style={styles.statBoxSub}>Dominance pulse</Text>
                  </View>
                </View>
              )}

              {isRelayHeist && gameStats?.mode_recap && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBoxHighlight}>
                    <Text style={styles.statBoxCaption}>PACKAGE STATUS</Text>
                    <Text style={styles.statBoxHeadline}>
                      {gameStats.mode_recap.package_secured
                        ? 'SECURED BY HUNTERS'
                        : game.end_reason === 'extraction_complete'
                          ? 'EXTRACTED BY RUNNERS'
                          : 'INTERCEPTED'}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>SQUAD HANDOFFS</Text>
                    <Text style={styles.statBoxHeadline}>{gameStats.mode_recap.total_handoffs ?? 0}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>PACKAGE DROPS</Text>
                    <Text style={styles.statBoxHeadline}>{gameStats.mode_recap.package_drops ?? 0}</Text>
                  </View>
                </View>
              )}

              {isJailbreak && gameStats?.mode_recap && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBoxHighlight}>
                    <Text style={styles.statBoxCaption}>JAILBREAK OUTCOME</Text>
                    <Text style={styles.statBoxHeadline}>
                      {game.end_reason === 'all_jailed' ? 'ALL JAILED' : 'PRISONERS ESCAPED'}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>RESCUES</Text>
                    <Text style={styles.statBoxHeadline}>{gameStats.mode_recap.total_rescues ?? 0}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>TOTAL JAILED</Text>
                    <Text style={styles.statBoxHeadline}>{gameStats.mode_recap.total_jailed ?? 0}</Text>
                  </View>
                </View>
              )}

              {gameStats?.mode_recap?.ai_gm && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBoxHighlight}>
                    <Text style={styles.statBoxCaption}>AI GM DISPATCHES</Text>
                    <Text style={styles.statBoxHeadline}>
                      {gameStats.mode_recap.ai_gm.total_events} / {gameStats.mode_recap.ai_gm.max_events}
                    </Text>
                    <Text style={styles.statBoxSub}>
                      Last: {gameStats.mode_recap.ai_gm.last_event_type?.replace(/_/g, ' ') || 'None'}
                    </Text>
                  </View>
                </View>
              )}

              {target && game.mode === 'classic_chase' && (
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxCaption}>EXTRACTION TARGET</Text>
                    <Text style={styles.statBoxHeadline}>Infiltrated</Text>
                    <Text style={styles.statBoxSub}>Target perimeter reached</Text>
                  </View>
                </View>
              )}

              {ghostPreview && ghostPreview.can_contribute && !ghostDismissed && !ghostPermanentlyDeclined && (
                <View style={{ marginTop: spacing.sm }}>
                  {ghostSuccess || ghostPreview.already_contributed ? (
                    <View style={styles.ghostStatusBox}>
                      <Ionicons color="#C8FF00" name="checkmark-circle" size={18} />
                      <Text style={styles.ghostStatusText}>
                        {ghostSuccess
                          ? 'Route trimmed by 150m and archived in solo ghost library.'
                          : 'Route is archived in ghost training library.'}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.ghostContributeBox}>
                      <Text style={styles.ghostPromptText}>
                        Contribute your anonymized runner path (trimmed 150m at endpoints) to solo training.
                      </Text>
                      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
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
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          ) : (
            <View style={styles.mutedIntelPill}>
              <Ionicons name="information-circle-outline" size={14} color="#94A3B8" />
              <Text style={styles.mutedIntelText}>Standard 10s Pings · No extraction target configured</Text>
            </View>
          )}

          {/* ======================================================== */}
          {/* SECTION 4: SHAREABLE STORY CARD & SOCIAL EXPORT          */}
          {/* ======================================================== */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 }}>
                <Ionicons name="share-social-outline" size={14} color="#C8FF00" />
                <Text style={styles.sectionTitle} numberOfLines={1}>SHAREABLE STORY CARD</Text>
              </View>
              <View style={{ flexShrink: 0 }}>
                <Chip label="9:16 PREVIEW" variant="accent" size="sm" />
              </View>
            </View>

            {/* Clean 9:16 Preview Frame (Fixed overlapping & unclipped layout) */}
            <View style={styles.recapCardPreview}>
              <View style={styles.recapPreviewHeader}>
                <Text style={styles.recapBrand}>GHOSTRUN</Text>
                <View style={[styles.recapWinnerBadge, { borderColor: outcomeAccent }]}>
                  <Text style={[styles.recapWinnerText, { color: outcomeAccent }]} numberOfLines={1}>
                    {winnerTitle.toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={styles.recapMetaBox}>
                <Text style={styles.recapOperativeName} numberOfLines={1}>
                  OPERATIVE: {playerById.get(state.my_player_id)?.display_name || 'CLASSIFIED'}
                </Text>
                <Text style={styles.recapModeText}>
                  MODE: {getDisplayModeName(game.mode, activeModule?.name)} · CODE: #{game.code}
                </Text>
              </View>

              <View style={styles.recapStatsRow}>
                <View style={styles.recapStatCol}>
                  <Text style={styles.recapStatLabel}>TIME</Text>
                  <Text style={styles.recapStatValue} numberOfLines={1}>
                    {roundSeconds ? formatDuration(roundSeconds) : '—'}
                  </Text>
                </View>
                <View style={[styles.recapStatCol, styles.recapStatColCenter]}>
                  <Text style={styles.recapStatLabel}>SQUAD</Text>
                  <Text style={styles.recapStatValue} numberOfLines={1}>
                    {players.length} {players.length === 1 ? 'PLAYER' : 'PLAYERS'}
                  </Text>
                </View>
                <View style={[styles.recapStatCol, styles.recapStatColRight]}>
                  <Text style={styles.recapStatLabel}>STATUS</Text>
                  <Text
                    style={[
                      styles.recapStatValue,
                      { color: isVictory ? '#C8FF00' : '#FF5A5F' },
                    ]}
                    numberOfLines={1}
                  >
                    {isVictory ? 'VICTORY' : 'DEFEAT'}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.storyCardButtonsRow}>
              <Button
                title="Export Story Card (9:16)"
                variant="primary"
                size="md"
                style={{ flex: 1 }}
                onPress={() => setStoryCardModalVisible(true)}
              />
              <Button
                title="Share Mission Recap"
                variant="secondary"
                size="md"
                style={{ flex: 1 }}
                onPress={() => setShareCardModalVisible(true)}
              />
            </View>
            <Text style={styles.storyCardCaption}>
              Generates 9:16 vertical story card with 150m boundary trim for social dispatches.
            </Text>
          </View>
        </ScrollView>
      </View>

      {/* 4. Sticky Command Action Footer (Pinned CTA at Thumb Zone) */}
      <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {rematchError !== '' && (
          <View style={styles.rematchErrorBanner}>
            <Ionicons name="alert-circle-outline" size={14} color="#FF5A5F" />
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
                <Ionicons name="refresh" size={16} color="#000000" />
                <Text style={styles.playAgainBtnText}>PLAY AGAIN</Text>
              </>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/replay/[id]', params: { id: gameId } })}
            style={styles.replayBtn}
          >
            <Ionicons name="play-circle-outline" size={16} color="#F8FAFC" />
            <Text style={styles.replayBtnText}>REPLAY</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to Base"
            onPress={() => router.replace('/play' as any)}
            style={styles.exitBtn}
          >
            <Ionicons name="exit-outline" size={18} color="#94A3B8" />
          </Pressable>
        </View>
      </View>

      {/* Share Modals */}
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
    backgroundColor: '#0B0E14',
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: '#0B0E14',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  topHud: {
    backgroundColor: '#0F131C',
    borderColor: '#232B3E',
    borderRadius: radii.card,
    borderWidth: 1,
    left: spacing.base,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    right: spacing.base,
    zIndex: 50,
    elevation: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
  },
  topHudRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topHudLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topHudRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topExitBtn: {
    width: 28,
    height: 28,
    borderRadius: radii.full,
    backgroundColor: '#1E2536',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(200, 255, 0, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(200, 255, 0, 0.3)',
  },
  mapToggleText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#C8FF00',
    letterSpacing: 0.5,
  },
  sheetWrapper: {
    flex: 1,
    backgroundColor: '#0B0E14',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderTopColor: '#232B3E',
    marginTop: -16,
    overflow: 'hidden',
  },
  scrollContentContainer: {
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 12,
  },
  sheetHandleBar: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  sheetHandlePill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
  },
  sheetHandleTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#94A3B8',
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 4,
  },
  sectionCard: {
    backgroundColor: '#12161F',
    borderColor: '#232B3E',
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.md,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    rowGap: 4,
    gap: 8,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#C8FF00',
    letterSpacing: 0.5,
  },
  reasonCopyText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  statBox: {
    backgroundColor: '#161B26',
    borderColor: '#232B3E',
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    minWidth: '45%',
    padding: spacing.sm,
  },
  statBoxHighlight: {
    backgroundColor: 'rgba(200, 255, 0, 0.05)',
    borderColor: 'rgba(200, 255, 0, 0.25)',
    borderRadius: radii.md,
    borderWidth: 1,
    width: '100%',
    padding: spacing.sm,
  },
  statBoxCaption: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  statBoxHeadline: {
    fontFamily: 'Archivo-Bold',
    fontSize: 18,
    color: '#F8FAFC',
    marginTop: 2,
  },
  statBoxSub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  echoHeroBox: {
    marginTop: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: 'rgba(200, 255, 0, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(200, 255, 0, 0.2)',
  },
  echoHeroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  echoHeroNumber: {
    fontFamily: 'Archivo-Black',
    fontSize: 28,
    color: '#C8FF00',
    letterSpacing: -0.5,
  },
  echoHeroUnit: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#C8FF00',
    letterSpacing: 1.2,
    marginTop: 1,
  },
  formulaToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  formulaToggleText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 11,
    color: '#C8FF00',
  },
  formulaAccordionContent: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(200, 255, 0, 0.15)',
  },
  echoGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: spacing.xs,
  },
  echoMetricItem: {
    flex: 1,
    padding: 6,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
  },
  echoMetricLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 9,
    color: '#94A3B8',
    fontWeight: '600',
    marginBottom: 2,
  },
  echoMetricValue: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    color: '#F8FAFC',
  },
  echoFooterText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#94A3B8',
    lineHeight: 14,
    marginTop: 4,
    textAlign: 'center',
  },
  rosterContainer: {
    marginTop: spacing.xs,
    gap: 6,
  },
  playerCardWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: '#1F293D',
    paddingBottom: 6,
  },
  playerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingVertical: 6,
  },
  playerRowExpanded: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  playerDot: {
    borderRadius: radii.full,
    height: 10,
    width: 10,
  },
  playerName: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    color: '#F8FAFC',
  },
  youIndicator: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#C8FF00',
  },
  playerSubtext: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  playerStatusText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
  },
  inlineTelemetryTray: {
    backgroundColor: '#0D1117',
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#1F293D',
    padding: 8,
    marginTop: 4,
    gap: 6,
  },
  telemetryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  telemetryItem: {
    backgroundColor: '#161B26',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flex: 1,
    minWidth: '45%',
  },
  telemetryLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 9,
    color: '#64748B',
    fontWeight: '600',
  },
  telemetryValue: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    color: '#F8FAFC',
    marginTop: 1,
  },
  inlineBluffBox: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderRadius: 6,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  bluffTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#F59E0B',
  },
  bluffDetail: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#CBD5E1',
    marginTop: 1,
  },
  inspectProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  inspectProfileBtnText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 10,
    color: '#38BDF8',
  },
  mutedIntelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#12161F',
    borderColor: '#232B3E',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mutedIntelText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#94A3B8',
    flex: 1,
  },
  ghostStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(200, 255, 0, 0.06)',
    borderColor: 'rgba(200, 255, 0, 0.2)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
  },
  ghostStatusText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#CBD5E1',
    flex: 1,
  },
  ghostContributeBox: {
    backgroundColor: '#161B26',
    borderColor: '#232B3E',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
  },
  ghostPromptText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#CBD5E1',
    lineHeight: 16,
  },
  recapCardPreview: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  recapPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recapBrand: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    color: '#C8FF00',
    letterSpacing: 1,
  },
  recapWinnerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.full,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    maxWidth: '60%',
    flexShrink: 0,
  },
  recapWinnerText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  recapMetaBox: {
    marginVertical: spacing.sm,
  },
  recapOperativeName: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    color: '#F8FAFC',
  },
  recapModeText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  recapStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  recapStatCol: {
    flex: 0.9,
  },
  recapStatColCenter: {
    flex: 1.0,
    alignItems: 'center',
  },
  recapStatColRight: {
    flex: 1.2,
    alignItems: 'flex-end',
  },
  recapStatLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 9,
    color: '#64748B',
    fontWeight: '600',
  },
  recapStatValue: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#F8FAFC',
    marginTop: 2,
  },
  storyCardButtonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  storyCardCaption: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#64748B',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  stickyFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0D1117',
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
    fontSize: 11,
    color: '#FF5A5F',
    flex: 1,
  },
  roleToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  roleToggleLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#94A3B8',
    letterSpacing: 1,
  },
  roleToggleSegment: {
    flexDirection: 'row',
    backgroundColor: '#161B26',
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: '#232B3E',
  },
  roleSegmentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  roleSegmentBtnActive: {
    backgroundColor: '#242C3D',
  },
  roleSegmentText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
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
    paddingVertical: 12,
    borderRadius: 10,
  },
  playAgainBtnText: {
    fontFamily: 'Archivo-Black',
    fontSize: 13,
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
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  replayBtnText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    color: '#F8FAFC',
  },
  exitBtn: {
    backgroundColor: '#161B26',
    borderWidth: 1,
    borderColor: '#232B3E',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  friendPillText: {
    color: '#10B981',
    fontSize: 10,
    fontFamily: 'Archivo-Bold',
    fontWeight: '700',
  },
  requestSentPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  requestSentPillText: {
    color: '#94A3B8',
    fontSize: 10,
    fontFamily: 'SegoeUI-Regular',
  },
  rosterAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#C8FF00',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  rosterAddBtnText: {
    color: '#000000',
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    fontWeight: '800',
  },
});

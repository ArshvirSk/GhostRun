import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '../../src/lib/map';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  LayoutAnimation,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import {
  circleRing,
  distanceM,
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { supabase } from '../../src/lib/supabase';
import {
  HeatButton,
  HeatMark,
  HeatOverlay,
  HeatResult,
  ModifierMapLayers,
  ModifierPanel,
  SensedRippleOverlay,
  useModifierState,
} from '../../src/components/GameModifiers';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  // Ignored in non-native or unsupported environments
}

const MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

let gameSheetDragStartY = 0;

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
  reason: 'scheduled' | 'boundary' | 'noise' | 'camping' | 'item';
  released_at: string;
};

type GameEvent = {
  id: number;
  game_id: string;
  type: string;
  audience: string;
  payload: Record<string, any>;
  created_at: string;
};

type RoundState = {
  server_time: string;
  game: {
    id: string;
    code: string;
    host_id: string;
    mode: 'classic_chase' | 'tag_hunt';
    mode_id?: 'classic_chase' | 'tag_hunt';
    modifiers?: string[];
    roles?: string[];
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
    area: LngLat & {
      radius_m: number;
      base_radius_m?: number;
      zone_stage?: number;
      zone_stage_count?: number;
      shrinking?: boolean;
    };
    target_set: boolean;
    boundary_grace_s?: number;
    boundary_penalty?: 'warn' | 'extra_ping';
  };
  players: GamePlayer[];
  my_player_id: string;
  my_team: Team;
  my_position: OwnPosition | null;
  positions: RoundPosition[];
  pings: RoundPing[];
  target: LngLat | null;
  heat_marks?: HeatMark[];
  heat_charges?: number | null;
  events?: GameEvent[];
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

type EventIconInfo = {
  name: any;
  family: 'ionicons' | 'mci';
  color: string;
};

const ITEM_NAMES: Record<string, string> = {
  veil: 'Veil',
  decoy: 'Decoy',
  burn: 'Burn',
  free_ping: 'Free Ping',
  jam: 'Jam',
  sweep: 'Sweep',
};

function prettyItem(id: unknown) {
  return ITEM_NAMES[String(id)] ?? 'item';
}

function getEventIcon(type: string): EventIconInfo {
  switch (type) {
    case 'tag':
      return { name: 'target', family: 'mci', color: '#EF4444' };
    case 'boundary_penalty':
      return { name: 'warning', family: 'ionicons', color: '#F59E0B' };
    case 'game_started':
      return { name: 'timer-outline', family: 'ionicons', color: '#3B82F6' };
    case 'head_start_began':
      return { name: 'run-fast', family: 'mci', color: '#10B981' };
    case 'live_began':
      return { name: 'flash', family: 'ionicons', color: '#EAB308' };
    case 'target_set':
      return { name: 'location', family: 'ionicons', color: '#EC4899' };
    case 'player_joined':
      return { name: 'person-add', family: 'ionicons', color: '#3B82F6' };
    case 'player_left':
      return { name: 'log-out-outline', family: 'ionicons', color: '#64748B' };
    case 'game_ended':
      return { name: 'flag-checkered', family: 'mci', color: '#10B981' };
    case 'game_cancelled':
      return { name: 'stop-circle-outline', family: 'ionicons', color: '#EF4444' };
    case 'sos':
      return { name: 'alarm-light', family: 'mci', color: '#DC2626' };
    case 'noise_spark':
      return { name: 'volume-high', family: 'ionicons', color: '#EA580C' };
    case 'noise_ping':
      return { name: 'volume-high', family: 'ionicons', color: '#DC2626' };
    case 'camping_ping':
      return { name: 'timer-outline', family: 'ionicons', color: '#EA580C' };
    case 'vehicle_warning':
      return { name: 'car', family: 'ionicons', color: '#B45309' };
    case 'zone_shrink_soon':
      return { name: 'resize', family: 'ionicons', color: '#0EA5E9' };
    case 'zone_shrunk':
      return { name: 'contract', family: 'ionicons', color: '#0EA5E9' };
    case 'drop_claimed':
      return { name: 'package-variant', family: 'mci', color: '#D97706' };
    case 'drop_item':
      return { name: 'gift-outline', family: 'ionicons', color: '#D97706' };
    case 'item_used':
      return { name: 'flash', family: 'ionicons', color: '#4338CA' };
    case 'veil_used':
      return { name: 'eye-off-outline', family: 'ionicons', color: '#4338CA' };
    case 'heat_used':
      return { name: 'flame', family: 'ionicons', color: '#EF4444' };
    case 'heat_mark':
      return { name: 'radio-button-on', family: 'ionicons', color: '#DC2626' };
    case 'sensed':
      return { name: 'pulse', family: 'ionicons', color: '#8B5CF6' };
    case 'decoy_used':
      return { name: 'git-branch-outline', family: 'ionicons', color: '#4338CA' };
    case 'jam':
      return { name: 'access-point-off', family: 'mci', color: '#B91C1C' };
    case 'burn_reveal':
      return { name: 'fire', family: 'mci', color: '#EA580C' };
    case 'sweep':
      return { name: 'radar', family: 'mci', color: '#0EA5E9' };
    case 'free_ping':
      return { name: 'radar', family: 'mci', color: '#7C3AED' };
    case 'drop_reported':
      return { name: 'map-marker-off', family: 'mci', color: '#64748B' };
    default:
      return { name: 'megaphone-outline', family: 'ionicons', color: '#64748B' };
  }
}

function formatEvent(
  event: GameEvent,
  serverNow: number,
): { icon: EventIconInfo; text: string; time: string } {
  const payload = event.payload ?? {};
  let text = event.type.replace(/_/g, ' ');

  if (event.type === 'tag') {
    const hunter = payload.hunter_name || 'Hunter';
    const runner = payload.runner_name || 'Runner';
    text = `${hunter} tagged ${runner}`;
  } else if (event.type === 'boundary_penalty') {
    const runner = payload.display_name || 'A runner';
    text = `${runner} out of bounds (+ping)`;
  } else if (event.type === 'game_started') {
    text = 'Countdown started';
  } else if (event.type === 'head_start_began') {
    text = 'Head start began';
  } else if (event.type === 'live_began') {
    text = 'Round is live!';
  } else if (event.type === 'target_set') {
    text = 'Secret target confirmed';
  } else if (event.type === 'player_joined') {
    text = `${payload.display_name || 'Player'} joined`;
  } else if (event.type === 'player_left') {
    text = payload.kicked ? 'A player was kicked' : `${payload.display_name || 'Player'} left`;
  } else if (event.type === 'game_ended') {
    text = `Round ended · ${payload.winner === 'runners' ? 'Runners' : 'Hunters'} won`;
  } else if (event.type === 'game_cancelled') {
    text = 'Round cancelled by host';
  } else if (event.type === 'sos') {
    const loc =
      payload.latitude && payload.longitude
        ? ` (${Number(payload.latitude).toFixed(3)}, ${Number(payload.longitude).toFixed(3)})`
        : '';
    text = `EMERGENCY: ${payload.display_name || 'Player'} sent SOS${loc}`;
  } else if (event.type === 'noise_spark') {
    text = 'A runner is loud (no exact spot)';
  } else if (event.type === 'noise_ping') {
    text = 'A runner made too much noise (+ping)';
  } else if (event.type === 'camping_ping') {
    text = 'A runner stayed in one spot (+ping)';
  } else if (event.type === 'vehicle_warning') {
    text = 'Vehicle speed detected. Slow down or stop.';
  } else if (event.type === 'zone_shrink_soon') {
    text = `Zone shrinks to ${payload.radius_m ?? '?'} m in under a minute`;
  } else if (event.type === 'zone_shrunk') {
    text = `Zone shrank to ${payload.radius_m ?? '?'} m`;
  } else if (event.type === 'drop_claimed') {
    text = `${payload.team === 'runner' ? 'A runner' : 'A hunter'} claimed a drop`;
  } else if (event.type === 'drop_item') {
    text = `You found: ${prettyItem(payload.item)}`;
  } else if (event.type === 'item_used') {
    text = `You used ${prettyItem(payload.item)}`;
  } else if (event.type === 'veil_used') {
    text = 'A runner’s Veil skipped a ping';
  } else if (event.type === 'decoy_used') {
    text = 'A runner’s ping was a Decoy';
  } else if (event.type === 'jam') {
    text = 'A runner’s item was jammed';
  } else if (event.type === 'burn_reveal') {
    text = 'Burn: nearest hunter revealed';
  } else if (event.type === 'sweep') {
    const contacts = Array.isArray(payload.contacts) ? payload.contacts.length : 0;
    text = `Sweep: ${contacts} runner(s) within 150 m`;
  } else if (event.type === 'free_ping') {
    text = 'A Free Ping was released';
  } else if (event.type === 'heat_used') {
    text = 'A hunter used HEAT';
  } else if (event.type === 'heat_mark') {
    const res =
      payload.result === 'hot'
        ? 'HOT (runner near)'
        : payload.result === 'cold'
          ? 'COLD (clear)'
          : 'NO CHANGE';
    text = `Heat probe: ${res}`;
  } else if (event.type === 'sensed') {
    text = 'Sensed pulse: a hunter probed your area!';
  } else if (event.type === 'drop_reported') {
    text = 'A drop was reported and moved';
  }

  const ageS = Math.max(0, (serverNow - Date.parse(event.created_at)) / 1000);
  return { icon: getEventIcon(event.type), text, time: formatAge(ageS) };
}

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const gameId = Array.isArray(id) ? id[0] : id;

  const [state, setState] = useState<RoundState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const serverNow = now + serverOffset;
  const offsetRef = useRef(0);
  const advancingRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [tagMessage, setTagMessage] = useState('');

  const [sharing, setSharing] = useState<SharingState>('idle');
  const [sharingMessage, setSharingMessage] = useState('');
  const [backgroundSharing, setBackgroundSharing] = useState(false);
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [outOfBoundsSince, setOutOfBoundsSince] = useState<number | null>(null);
  const wasOutOfBoundsRef = useRef(false);
  const autoStartedRef = useRef(false);
  const startingRef = useRef(false);
  const sharingRef = useRef<SharingState>('idle');
  const mountedRef = useRef(true);

  const [muted, setMuted] = useState(false);
  const [heatResult, setHeatResult] = useState<HeatResult>(null);
  const [heatVisible, setHeatVisible] = useState(false);
  const [sensedActive, setSensedActive] = useState(false);
  const mutedRef = useRef(false);
  const prevStatusRef = useRef<string | null>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const prevPingIdRef = useRef<number | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    AsyncStorage.getItem('ghostrun:muted')
      .then((val) => {
        if (val !== null) setMuted(val === 'true');
      })
      .catch(() => {});
    void Notifications.requestPermissionsAsync().catch(() => {});
  }, []);

  const [sosHolding, setSosHolding] = useState(false);
  const [sosSent, setSosSent] = useState(false);

  const [hudCompact, setHudCompact] = useState(false);
  const { height: screenHeight } = useWindowDimensions();
  const SHEET_HEIGHT = Math.max(400, Math.round(screenHeight * 0.58));
  const COLLAPSED_HEIGHT = 74;
  const SNAP_BOTTOM = SHEET_HEIGHT - COLLAPSED_HEIGHT;
  const SNAP_TOP = 0;

  const [sheetTranslateY] = useState(() => new Animated.Value(SNAP_BOTTOM));
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const sheetContentOpacity = sheetTranslateY.interpolate({
    inputRange: [SNAP_TOP, SNAP_BOTTOM * 0.65, SNAP_BOTTOM],
    outputRange: [1, 0.2, 0],
    extrapolate: 'clamp',
  });

  const sheetHintOpacity = sheetTranslateY.interpolate({
    inputRange: [SNAP_TOP, SNAP_BOTTOM * 0.4, SNAP_BOTTOM],
    outputRange: [0.6, 0.8, 1],
    extrapolate: 'clamp',
  });

  const snapSheet = useCallback(
    (toValue: number, velocity = 0) => {
      Animated.spring(sheetTranslateY, {
        toValue,
        velocity,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start(() => {
        setSheetExpanded(toValue === SNAP_TOP);
      });
    },
    [SNAP_TOP, sheetTranslateY],
  );

  // Show full round details on initial load or whenever the game status/phase changes,
  // then smoothly shorten the top bar after ~6 seconds so focus remains on the map.
  useEffect(() => {
    const expandTimer = setTimeout(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setHudCompact(false);
    }, 0);
    const compactTimer = setTimeout(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setHudCompact(true);
    }, 6000);
    return () => {
      clearTimeout(expandTimer);
      clearTimeout(compactTimer);
    };
  }, [state?.game?.status]);

  const toggleHud = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setHudCompact((prev) => !prev);
  }, []);

  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 5,
      onPanResponderGrant: () => {
        sheetTranslateY.stopAnimation((val) => {
          gameSheetDragStartY = val;
        });
      },
      onPanResponderMove: (_, gesture) => {
        const newY = Math.max(SNAP_TOP, Math.min(SNAP_BOTTOM, gameSheetDragStartY + gesture.dy));
        sheetTranslateY.setValue(newY);
      },
      onPanResponderRelease: (_, gesture) => {
        let toValue = SNAP_BOTTOM;
        if (gesture.vy < -0.35) {
          toValue = SNAP_TOP;
        } else if (gesture.vy > 0.35) {
          toValue = SNAP_BOTTOM;
        } else {
          const currentY = Math.max(
            SNAP_TOP,
            Math.min(SNAP_BOTTOM, gameSheetDragStartY + gesture.dy),
          );
          toValue = currentY < SNAP_BOTTOM * 0.5 ? SNAP_TOP : SNAP_BOTTOM;
        }
        Animated.spring(sheetTranslateY, {
          toValue,
          velocity: gesture.vy,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }).start(() => {
          setSheetExpanded(toValue === SNAP_TOP);
        });
      },
    }),
  );

  async function triggerSos() {
    if (!supabase || !gameId) return;
    setSosHolding(false);
    setSosSent(true);
    try {
      Vibration.vibrate([0, 500, 200, 500]);
    } catch {
      // Ignored if vibration not supported
    }
    await supabase.rpc('send_sos', { game_id: gameId });
    await loadState();
    try {
      await Linking.openURL('tel:112');
    } catch {
      try {
        await Linking.openURL('tel:');
      } catch {
        // Ignored if dialer cannot open
      }
    }
  }

  async function toggleMuted() {
    const next = !muted;
    setMuted(next);
    await AsyncStorage.setItem('ghostrun:muted', String(next)).catch(() => {});
  }

  const notify = useCallback((title: string, body: string, vibratePattern?: number | number[]) => {
    if (vibratePattern) {
      try {
        Vibration.vibrate(vibratePattern);
      } catch {
        // Ignored if vibration not supported
      }
    }
    if (mutedRef.current) return;
    try {
      void Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: null,
      });
    } catch {
      // Ignored if permissions not granted or platform issue
    }
  }, []);

  useEffect(() => {
    if (!state) return;
    const ownPlayer = state.players.find((p) => p.id === state.my_player_id);
    if (!ownPlayer) return;

    if (prevStatusRef.current === 'active' && ownPlayer.status === 'tagged') {
      notify(
        "You've been tagged!",
        'You are now spectating the remainder of the round.',
        [0, 250, 100, 250],
      );
    }
    prevStatusRef.current = ownPlayer.status;
  }, [state, notify]);

  useEffect(() => {
    if (!state?.game) return;
    const currentPhase = state.game.status;
    if (prevPhaseRef.current && prevPhaseRef.current !== 'live' && currentPhase === 'live') {
      notify('Round started!', 'The hunt is now live. Good luck!', [0, 200, 100, 200]);
    }
    prevPhaseRef.current = currentPhase;
  }, [state?.game, notify]);

  useEffect(() => {
    if (!state?.pings || state?.game?.status !== 'live') return;
    const latestPing = state.pings[0];
    if (!latestPing) return;
    const isFresh = Math.max(0, (serverNow - Date.parse(latestPing.released_at)) / 1000) <= 6;
    if (prevPingIdRef.current !== null && latestPing.id !== prevPingIdRef.current) {
      try {
        Vibration.vibrate([0, 500, 200, 500]);
      } catch {
        // ignore
      }
      notify(
        'Radar Ping Released',
        latestPing.reason === 'boundary'
          ? 'Boundary violation ping released.'
          : 'Runner position ping released.',
        [0, 500, 200, 500],
      );
    } else if (prevPingIdRef.current === null && isFresh) {
      try {
        Vibration.vibrate([0, 500, 200, 500]);
      } catch {
        // ignore
      }
    }
    prevPingIdRef.current = latestPing.id;
  }, [state?.pings, state?.game, notify, serverNow]);

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
        (payload: { new?: { id?: number; reason?: string } }) => {
          try {
            Vibration.vibrate([0, 500, 200, 500]);
          } catch {
            // ignore
          }
          const pingReason = payload.new?.reason;
          notify(
            'Radar Ping Released',
            pingReason === 'boundary'
              ? 'Runner out of bounds ping!'
              : pingReason === 'noise'
                ? 'A runner was too loud and pinged!'
                : pingReason === 'camping'
                  ? 'A runner camped too long and pinged!'
                  : pingReason === 'item'
                    ? 'An item ping was released!'
                    : 'Runner location ping detected!',
            [0, 500, 200, 500],
          );
          void loadState();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tags', filter: `game_id=eq.${gameId}` },
        () => void loadState(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events', filter: `game_id=eq.${gameId}` },
        (payload: { new?: { type?: string; payload?: { display_name?: string } } }) => {
          if (payload.new?.type === 'sos') {
            notify(
              'SOS EMERGENCY ALERT',
              `${payload.new.payload?.display_name || 'A player'} needs immediate help!`,
              [0, 500, 200, 500],
            );
          }
          if (payload.new?.type === 'sensed') {
            setSensedActive(true);
            setTimeout(() => setSensedActive(false), 2000);
          }
          void loadState();
        },
      )
      .subscribe();
    return () => {
      clearTimeout(initialLoad);
      void supabase?.removeChannel(channel);
    };
  }, [gameId, loadState, notify]);

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
  const modifiers = useModifierState(gameId, game);
  const players = state?.players ?? [];
  const myPlayerId = state?.my_player_id ?? '';
  const myTeam = state?.my_team ?? 'unassigned';
  const isRunner = myTeam === 'runner';
  const activePlayers = players.filter((player) => player.status === 'active');
  const runnersRemaining = activePlayers.filter((player) => player.team === 'runner').length;
  const events = useMemo(() => {
    return (state?.events ?? []).slice().sort((a, b) => b.id - a.id);
  }, [state?.events]);

  const ownFix: LngLat | null =
    fix !== null
      ? { longitude: fix.longitude, latitude: fix.latitude }
      : state?.my_position
        ? { longitude: state.my_position.longitude, latitude: state.my_position.latitude }
        : null;

  const currentDistanceM = ownFix && game?.area ? distanceM(ownFix, game.area) : null;
  const isOutOfBounds =
    currentDistanceM !== null &&
    game !== null &&
    currentDistanceM > game.area.radius_m &&
    ['head_start', 'live'].includes(game.status);

  useEffect(() => {
    if (isOutOfBounds) {
      if (!wasOutOfBoundsRef.current) {
        wasOutOfBoundsRef.current = true;
        setOutOfBoundsSince(Date.now());
        try {
          Vibration.vibrate(500);
        } catch {
          // ignore if vibration is unavailable
        }
      }
    } else {
      if (wasOutOfBoundsRef.current) {
        wasOutOfBoundsRef.current = false;
        setOutOfBoundsSince(null);
      }
    }
  }, [isOutOfBounds]);

  const boundaryGraceS = game?.boundary_grace_s ?? 30;
  const elapsedGraceS = outOfBoundsSince !== null ? Math.floor((now - outOfBoundsSince) / 1000) : 0;
  const remainingGraceS = Math.max(0, boundaryGraceS - elapsedGraceS);

  const PING_VISIBILITY_DURATION_S = 10;

  const pingFeatures: PointFeature[] = (state?.pings ?? [])
    .filter(
      (ping): ping is RoundPing & { longitude: number; latitude: number } =>
        ping.longitude !== null &&
        ping.latitude !== null &&
        Math.max(0, (serverNow - Date.parse(ping.released_at)) / 1000) <=
          PING_VISIBILITY_DURATION_S,
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
      <MapLibreMap
        attribution
        mapStyle={MAP_STYLE}
        onPress={() => {
          if (sheetExpanded) {
            snapSheet(SNAP_BOTTOM);
          }
          if (!hudCompact) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setHudCompact(true);
          }
        }}
        style={StyleSheet.absoluteFill}
      >
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
              id="ping-halo"
              type="circle"
              paint={{
                'circle-radius': 22,
                'circle-color': [
                  'case',
                  ['==', ['get', 'reason'], 'boundary'],
                  '#F59E0B',
                  ['==', ['get', 'reason'], 'noise'],
                  '#DC2626',
                  ['==', ['get', 'reason'], 'camping'],
                  '#EA580C',
                  ['==', ['get', 'reason'], 'item'],
                  '#7C3AED',
                  '#DB2777',
                ],
                'circle-opacity': 0.25,
                'circle-stroke-width': 2,
                'circle-stroke-color': [
                  'case',
                  ['==', ['get', 'reason'], 'boundary'],
                  '#F59E0B',
                  ['==', ['get', 'reason'], 'noise'],
                  '#DC2626',
                  ['==', ['get', 'reason'], 'camping'],
                  '#EA580C',
                  ['==', ['get', 'reason'], 'item'],
                  '#7C3AED',
                  '#DB2777',
                ],
                'circle-stroke-opacity': 0.65,
              }}
            />
            <Layer
              id="ping-points"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': [
                  'case',
                  ['==', ['get', 'reason'], 'boundary'],
                  '#F59E0B',
                  ['==', ['get', 'reason'], 'noise'],
                  '#DC2626',
                  ['==', ['get', 'reason'], 'camping'],
                  '#EA580C',
                  ['==', ['get', 'reason'], 'item'],
                  '#7C3AED',
                  '#DB2777',
                ],
                'circle-stroke-width': 2.5,
                'circle-stroke-color': '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}

        <ModifierMapLayers drops={modifiers.drops} marks={state?.heat_marks ?? []} />

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

      <HeatOverlay
        result={heatResult}
        visible={heatVisible}
        onDismiss={() => setHeatVisible(false)}
      />
      <SensedRippleOverlay active={sensedActive} />

      <Pressable
        accessibilityLabel={hudCompact ? 'Expand round details' : 'Minimize round details'}
        accessibilityRole="button"
        onPress={toggleHud}
        style={[styles.hud, hudCompact && styles.hudCompact]}
      >
        {hudCompact ? (
          <View style={styles.compactHudRow}>
            <View style={styles.compactLeft}>
              <View style={[styles.compactStatusDot, { backgroundColor: accent }]} />
              <Text style={styles.compactEyebrow}>{eyebrow}</Text>
              {timerValue !== null && game!.status !== 'ended' && game!.status !== 'cancelled' && (
                <Text style={styles.compactTimer}>{formatClock(timerValue)}</Text>
              )}
            </View>

            <View style={styles.compactRight}>
              {isLive && nextPingIn !== null && (
                <View style={styles.compactChip}>
                  <Text style={styles.compactChipLabel}>PING</Text>
                  <Text style={styles.compactChipValue}>{formatClock(nextPingIn)}</Text>
                </View>
              )}
              {isLive && (
                <View style={styles.compactChip}>
                  <Text style={styles.compactChipLabel}>RUNNERS</Text>
                  <Text style={styles.compactChipValue}>{runnersRemaining}</Text>
                </View>
              )}
              <Pressable
                accessibilityLabel={muted ? 'Unmute alerts' : 'Mute alerts'}
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => void toggleMuted()}
                style={styles.compactMuteButton}
              >
                <Ionicons
                  color={muted ? '#94A3B8' : '#3B82F6'}
                  name={muted ? 'notifications-off' : 'notifications'}
                  size={14}
                />
              </Pressable>
              <Text style={styles.compactChevron}>▾</Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.hudHeaderRow}>
              <Text style={[styles.eyebrow, { color: accent }]}>
                {eyebrow} · {game!.code}
              </Text>
              <View style={styles.hudHeaderActions}>
                <Pressable
                  accessibilityLabel={muted ? 'Unmute alerts' : 'Mute alerts'}
                  accessibilityRole="button"
                  onPress={() => void toggleMuted()}
                  style={styles.muteButton}
                >
                  <View style={styles.muteButtonContent}>
                    <Ionicons
                      color={muted ? '#94A3B8' : '#3B82F6'}
                      name={muted ? 'notifications-off' : 'notifications'}
                      size={14}
                    />
                    <Text style={styles.muteButtonText}>{muted ? 'Muted' : 'Alerts'}</Text>
                  </View>
                </Pressable>
                <Text style={styles.hudChevron}>▴</Text>
              </View>
            </View>
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
          </>
        )}

        {isOutOfBounds && (
          <View style={[styles.boundaryWarning, hudCompact && styles.boundaryWarningCompact]}>
            <View style={styles.boundaryWarningHeader}>
              <Ionicons color="#EF4444" name="warning" size={16} />
              <Text style={styles.boundaryWarningTitle}>
                {remainingGraceS > 0
                  ? `Out of bounds! (${remainingGraceS}s grace)`
                  : 'Boundary grace expired!'}
              </Text>
            </View>
            {!hudCompact && (
              <Text style={styles.boundaryWarningSub}>
                {remainingGraceS > 0
                  ? `${remainingGraceS}s grace remaining before boundary penalty`
                  : 'Grace period expired — your position may be revealed!'}
              </Text>
            )}
          </View>
        )}

        {errorMessage !== '' && (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorMessage}
          </Text>
        )}
      </Pressable>

      {tagMessage !== '' && !sheetExpanded && (
        <View style={styles.tagToast}>
          <Text style={styles.tagToastText}>{tagMessage}</Text>
        </View>
      )}

      <Animated.View
        style={[
          styles.sheet,
          {
            height: SHEET_HEIGHT,
            transform: [{ translateY: sheetTranslateY }],
          },
        ]}
      >
        <View {...panResponder.panHandlers} style={styles.sheetHandleRow}>
          <View style={styles.sheetHandle} />
          <View style={styles.dockBar}>
            <View style={styles.dockInfo}>
              <Text style={styles.dockTitle}>
                {sheetExpanded
                  ? 'Activity, Players & Controls'
                  : `Activity & Players (${activePlayers.length})`}
              </Text>
              <Animated.Text style={[styles.dockHint, { opacity: sheetHintOpacity }]}>
                {sheetExpanded ? '▼ Slide down to minimize' : '▲ Slide up to view'}
              </Animated.Text>
            </View>
            {isLive && !isRunner && !taggedSelf && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {(game?.modifiers ?? []).includes('hot_cold') && (
                  <HeatButton
                    gameId={gameId}
                    charges={state?.heat_charges ?? 6}
                    cooldownEndsAt={modifiers.status?.cooldowns?.heat_press}
                    onPressResult={(res) => {
                      setHeatResult(res);
                      setHeatVisible(true);
                      void loadState();
                    }}
                  />
                )}
                <Pressable
                  accessibilityRole="button"
                  disabled={busy !== ''}
                  onPress={() => void attemptTag()}
                  style={[styles.quickTagButton, busy !== '' && styles.disabled]}
                >
                  {busy === 'tag' ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.quickTagText}>TAG ({game?.tag_radius_m ?? 20}m)</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        </View>

        <Animated.View
          pointerEvents={sheetExpanded ? 'auto' : 'none'}
          style={[styles.sheetInner, { opacity: sheetContentOpacity }]}
        >
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
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
                  Get within {game!.tag_radius_m} m of a runner and tap. Both positions must be
                  fresh.
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

            {isLive && gameId && game && (
              <ModifierPanel
                gameId={gameId}
                game={game}
                status={modifiers.status}
                drops={modifiers.drops}
                refresh={modifiers.refresh}
                serverNow={serverNow}
              />
            )}

            {taggedSelf && game!.status === 'live' && (
              <Text style={styles.sectionHint}>
                You are spectating. Location sharing stopped when you were tagged.
              </Text>
            )}

            {(game!.status === 'ended' || game!.status === 'cancelled') && (
              <Text style={styles.sectionHint}>Location sharing stopped when the round ended.</Text>
            )}

            {events.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>ACTIVITY FEED</Text>
                <View style={styles.eventFeed}>
                  {events.slice(0, 8).map((evt) => {
                    const formatted = formatEvent(evt, serverNow);
                    return (
                      <View key={evt.id} style={styles.eventRow}>
                        <View style={styles.eventIconWrap}>
                          {formatted.icon.family === 'mci' ? (
                            <MaterialCommunityIcons
                              color={formatted.icon.color}
                              name={formatted.icon.name}
                              size={15}
                            />
                          ) : (
                            <Ionicons
                              color={formatted.icon.color}
                              name={formatted.icon.name}
                              size={15}
                            />
                          )}
                        </View>
                        <Text style={styles.eventText}>{formatted.text}</Text>
                        <Text style={styles.eventTime}>{formatted.time}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={styles.sectionLabel}>PLAYERS · {activePlayers.length}</Text>
            {players.map((player) => (
              <View key={player.id} style={styles.playerRow}>
                <View style={[styles.playerDot, { backgroundColor: player.color }]} />
                <View style={styles.playerNameRow}>
                  <Text style={styles.playerName}>{player.display_name}</Text>
                  {player.user_id === game!.host_id && (
                    <MaterialCommunityIcons color="#EAB308" name="crown" size={14} />
                  )}
                  {player.id === myPlayerId && <Text style={styles.playerYou}>(you)</Text>}
                </View>
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

            {(inPlay || game!.status === 'countdown') && (
              <View style={styles.sosContainer}>
                <Pressable
                  accessibilityLabel="Hold for 2 seconds to activate emergency SOS"
                  accessibilityRole="button"
                  delayLongPress={2000}
                  onLongPress={() => void triggerSos()}
                  onPressIn={() => setSosHolding(true)}
                  onPressOut={() => setSosHolding(false)}
                  style={[
                    styles.sosButton,
                    sosHolding && styles.sosButtonHolding,
                    sosSent && styles.sosButtonSent,
                  ]}
                >
                  <View style={styles.sosButtonContent}>
                    <MaterialCommunityIcons color="#FFFFFF" name="alarm-light" size={18} />
                    <Text style={styles.sosButtonText}>
                      {sosSent
                        ? 'SOS SENT · DIALER OPENED'
                        : sosHolding
                          ? 'HOLDING... RELEASE TO CANCEL'
                          : 'HOLD FOR SOS (2s)'}
                    </Text>
                  </View>
                </Pressable>
                <Text style={styles.sosHint}>
                  Broadcasts your position to everyone and launches emergency services dialer.
                </Text>
              </View>
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
              All timers use the server clock. Pings are released on a server schedule; older rings
              are less reliable.
            </Text>
          </ScrollView>
        </Animated.View>
      </Animated.View>
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
    elevation: 4,
    left: 14,
    padding: 14,
    position: 'absolute',
    right: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    top: 48,
  },
  hudCompact: {
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  compactHudRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  compactLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  compactStatusDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  compactEyebrow: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  compactTimer: {
    color: '#1D4ED8',
    fontSize: 16,
    fontWeight: '900',
  },
  compactRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  compactChip: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  compactChipLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '800',
  },
  compactChipValue: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '800',
  },
  compactMuteButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  compactMuteText: {
    fontSize: 14,
  },
  compactChevron: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 2,
  },
  hudHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hudHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  hudChevron: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '800',
  },
  muteButton: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  muteButtonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  muteButtonText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '800',
  },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: '#0F172A', fontSize: 24, fontWeight: '900', marginTop: 6 },
  subtitle: { color: '#475569', fontSize: 13, lineHeight: 19, marginTop: 6 },
  boundaryWarning: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
    borderRadius: 10,
    borderWidth: 1.5,
    marginTop: 10,
    padding: 10,
  },
  boundaryWarningCompact: {
    marginTop: 6,
    paddingVertical: 4,
  },
  boundaryWarningHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  boundaryWarningTitle: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '800',
  },
  boundaryWarningSub: {
    color: '#7F1D1D',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  statsRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 18, marginTop: 14 },
  stat: { flexShrink: 1 },
  statLabel: { color: '#64748B', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  statValue: { color: '#0F172A', fontSize: 34, fontWeight: '900', letterSpacing: 0.5 },
  statSmall: { color: '#0F172A', fontSize: 20, fontWeight: '900' },
  error: { color: '#B91C1C', fontSize: 13, lineHeight: 19, marginTop: 12 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    bottom: 0,
    elevation: 12,
    left: 0,
    position: 'absolute',
    right: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  sheetInner: {
    flex: 1,
  },
  sheetHandleRow: {
    alignItems: 'center',
    paddingBottom: 6,
    paddingTop: 8,
  },
  sheetHandle: {
    backgroundColor: '#CBD5E1',
    borderRadius: 3,
    height: 5,
    marginBottom: 6,
    width: 42,
  },
  dockBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    width: '100%',
  },
  dockInfo: {
    flex: 1,
  },
  dockTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800',
  },
  dockHint: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  quickTagButton: {
    alignItems: 'center',
    backgroundColor: '#DC2626',
    borderRadius: 9,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 14,
  },
  quickTagText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  sheetScroll: {
    flex: 1,
  },
  sheetContent: { padding: 18, paddingBottom: 30 },
  tagToast: {
    alignSelf: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 20,
    bottom: 84,
    elevation: 9,
    paddingHorizontal: 16,
    paddingVertical: 8,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  tagToastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
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
  eventFeed: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  eventRow: {
    alignItems: 'center',
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingVertical: 8,
  },
  eventIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    width: 20,
  },
  eventText: { color: '#334155', flex: 1, fontSize: 13, fontWeight: '700' },
  eventTime: { color: '#94A3B8', fontSize: 11, fontWeight: '700', marginLeft: 6 },
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
  playerNameRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    marginLeft: 8,
  },
  playerName: { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  playerYou: { color: '#64748B', fontSize: 11, fontWeight: '600' },
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
  sosContainer: {
    marginBottom: 6,
    marginTop: 14,
  },
  sosButton: {
    alignItems: 'center',
    backgroundColor: '#991B1B',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16,
  },
  sosButtonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  sosButtonHolding: {
    backgroundColor: '#DC2626',
    borderColor: '#FFFFFF',
    borderWidth: 2,
  },
  sosButtonSent: {
    backgroundColor: '#450A0A',
  },
  sosButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  sosHint: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
    textAlign: 'center',
  },
});

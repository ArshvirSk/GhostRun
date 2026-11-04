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
  AgentControls,
  HeatButton,
  HeatMark,
  HeatOverlay,
  HeatResult,
  ModifierMapLayers,
  ModifierPanel,
  SensedRippleOverlay,
  TribunalDock,
  useModifierState,
} from '../../src/components/GameModifiers';
import { HunterQrScanner } from '../../src/components/HunterQrScanner';
import { RunnerQrCard } from '../../src/components/RunnerQrCard';
import { initAudio, playSound, toggleAudioMuted } from '../../src/lib/audio';

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

type Team = 'runner' | 'hunter' | 'solo' | 'unassigned';
type Phase =
  'lobby' | 'target_selection' | 'countdown' | 'head_start' | 'live' | 'ended' | 'cancelled';

type GamePlayer = {
  id: string;
  user_id: string;
  display_name: string;
  color: string;
  team: Team;
  status: 'active' | 'tagged' | 'left' | 'jailed';
  is_ready: boolean;
  jailed_at?: string | null;
  frozen_until?: string | null;
  secret_role?: string | null;
  pending_role_swap?: {
    from_player_id: string;
    from_role: string;
    requested_at: string;
  } | null;
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
  reason: 'scheduled' | 'boundary' | 'noise' | 'camping' | 'item' | 'ghost_sighting';
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
    mode: string;
    mode_id?: string;
    mode_params?: Record<string, unknown>;
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
    winner: 'runners' | 'hunters' | 'solo' | null;
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
    jail?: {
      id: string;
      latitude: number;
      longitude: number;
      radius_m: number;
    } | null;
    vip_escort?: {
      is_active: boolean;
      vip_player_id?: string | null;
    } | null;
  };
  players: GamePlayer[];
  my_player_id: string;
  my_team: Team;
  rescue_in_progress?: boolean;
  my_position: OwnPosition | null;
  positions: RoundPosition[];
  pings: RoundPing[];
  target: LngLat | null;
  heat_marks?: HeatMark[];
  heat_charges?: number | null;
  events?: GameEvent[];
  assassin_ring?: {
    my_prey: {
      player_id: string;
      display_name: string;
      color: string;
      status: string;
    } | null;
    hunter_proximity: 'none' | 'near' | 'close';
    safe_zones: {
      id: string;
      zone_index: number;
      longitude: number;
      latitude: number;
      radius_m: number;
    }[];
    in_safe_zone: boolean;
    active_survivors: number;
  } | null;
  relay_heist?: {
    extraction?: {
      id: string;
      longitude: number;
      latitude: number;
      radius_m: number;
    } | null;
    package?: {
      status: 'carried' | 'dropped';
      carrier_player_id?: string | null;
      is_carrier?: boolean;
      longitude?: number;
      latitude?: number;
      dropped_at?: string | null;
      securing_hunter_id?: string | null;
      securing_started_at?: string | null;
      handoff_pending_to?: string | null;
      handoff_expires_at?: string | null;
    } | null;
    is_carrier: boolean;
    handoff_pending_from?: string | null;
  } | null;
};

type SharingState = 'idle' | 'starting' | 'on' | 'denied' | 'error';

type TagResult = {
  success: boolean;
  reason?: 'cooldown' | 'stale_position' | 'no_target' | 'in_safe_zone' | 'no_prey_assigned' | 'already_frozen';
  runner_id?: string;
  phase?: Phase;
  winner?: 'runners' | 'hunters' | 'solo' | null;
  end_reason?: string | null;
  frozen?: boolean;
  frozen_seconds?: number;
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
  const [sfxMuted, setSfxMuted] = useState(false);
  const [pingRippleActive, setPingRippleActive] = useState(false);
  const [runnerQrVisible, setRunnerQrVisible] = useState(false);
  const [hunterScannerVisible, setHunterScannerVisible] = useState(false);
  const [heatResult, setHeatResult] = useState<HeatResult>(null);
  const [heatVisible, setHeatVisible] = useState(false);
  const [sensedActive, setSensedActive] = useState(false);
  const mutedRef = useRef(false);
  const prevStatusRef = useRef<string | null>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const prevPingIdRef = useRef<number | null>(null);
  const prevCountdownSecRef = useRef<number | null>(null);

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
    void initAudio().then((isMuted) => setSfxMuted(isMuted));
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
      playSound('tag');
      notify(
        "You've been tagged!",
        'You are now spectating the remainder of the round.',
        [0, 250, 100, 250],
      );
    } else if (prevStatusRef.current === 'active' && ownPlayer.status === 'jailed') {
      playSound('tag');
      notify(
        "You've been jailed!",
        'Head to the jail zone. Teammates can rescue you or wait for auto-release.',
        [0, 300, 150, 300],
      );
    } else if (prevStatusRef.current === 'jailed' && ownPlayer.status === 'active') {
      playSound('victory');
      notify(
        'You were rescued!',
        'You are free! Run to safe ground.',
        [0, 150, 80, 150],
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
    if (prevPhaseRef.current && prevPhaseRef.current !== 'ended' && currentPhase === 'ended') {
      const ownPlayer = state.players.find((p) => p.id === state.my_player_id);
      const isWinner =
        (state.game.winner === 'runners' && ownPlayer?.team === 'runner') ||
        (state.game.winner === 'hunters' && ownPlayer?.team === 'hunter');
      if (isWinner) {
        playSound('victory');
      } else {
        playSound('defeat');
      }
    }
    prevPhaseRef.current = currentPhase;
  }, [state, notify]);

  // Audio countdown ticks during 10-second countdown
  useEffect(() => {
    if (state?.game?.status === 'countdown' && state.game.head_start_at) {
      const remainingSec = Math.ceil((Date.parse(state.game.head_start_at) - serverNow) / 1000);
      if (remainingSec > 0 && remainingSec <= 10 && remainingSec !== prevCountdownSecRef.current) {
        prevCountdownSecRef.current = remainingSec;
        playSound('countdown');
      }
    }
  }, [state?.game?.status, state?.game?.head_start_at, serverNow]);

  useEffect(() => {
    if (!state?.pings || state?.game?.status !== 'live') return;
    const latestPing = state.pings[0];
    if (!latestPing) return;
    const isFresh = Math.max(0, (serverNow - Date.parse(latestPing.released_at)) / 1000) <= 6;
    if (prevPingIdRef.current !== null && latestPing.id !== prevPingIdRef.current) {
      playSound('ping');
      setPingRippleActive(true);
      setTimeout(() => setPingRippleActive(false), 1200);
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
      playSound('ping');
      setPingRippleActive(true);
      setTimeout(() => setPingRippleActive(false), 1200);
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
          playSound('ping');
          setPingRippleActive(true);
          setTimeout(() => setPingRippleActive(false), 1200);
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
      playSound('tag');
      const isJb = state?.game.mode_id === 'jailbreak';
      const isAr = state?.game.mode_id === 'assassin_ring';
      const isRh = state?.game.mode_id === 'relay_heist';
      if (result.frozen) {
        setTagMessage(`Bodyguard tagged! Frozen for ${result.frozen_seconds ?? 60}s.`);
      } else {
        setTagMessage(
          result.phase === 'ended'
            ? (result.end_reason === 'vip_eliminated'
                ? 'VIP eliminated! Hunters win!'
                : isJb ? 'All runners jailed! Round over.' : isAr ? 'Last survivor standing! Victory!' : isRh ? 'All runners tagged! Hunters win!' : 'Tag confirmed. The round is over.')
            : (isJb ? 'Runner jailed!' : isAr ? 'Target eliminated! New prey assigned.' : isRh ? 'Runner tagged! Package dropped!' : 'Tag confirmed.'),
        );
      }
      await loadState();
      return;
    }
    setTagMessage(
      result.reason === 'already_frozen'
        ? 'Bodyguard is already frozen.'
        : result.reason === 'in_safe_zone'
          ? 'Inside Safe Zone. Tagging is disabled.'
          : result.reason === 'cooldown'
            ? 'Tag cooldown. Try again in a few seconds.'
            : result.reason === 'stale_position'
              ? 'Waiting for a fresh GPS fix before tagging.'
              : state?.game.mode_id === 'assassin_ring'
                ? 'Target not in range.'
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

  const myPosition = state?.my_position;
  const ownFix: LngLat | null = useMemo(() => {
    if (fix !== null) {
      return { longitude: fix.longitude, latitude: fix.latitude };
    }
    if (myPosition) {
      return { longitude: myPosition.longitude, latitude: myPosition.latitude };
    }
    return null;
  }, [fix, myPosition]);

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

  const jailLongitude = state?.game?.jail?.longitude;
  const jailLatitude = state?.game?.jail?.latitude;
  const jailRadiusM = state?.game?.jail?.radius_m ?? 15;

  const jailRingData = useMemo(() => {
    if (jailLongitude === undefined || jailLatitude === undefined) return null;
    return circleRing(
      { longitude: jailLongitude, latitude: jailLatitude },
      jailRadiusM,
    );
  }, [jailLongitude, jailLatitude, jailRadiusM]);

  const jailPointData: PointCollection | null = useMemo(() => {
    if (jailLongitude === undefined || jailLatitude === undefined) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [jailLongitude, jailLatitude],
          },
        },
      ],
    };
  }, [jailLongitude, jailLatitude]);

  const isJailbreak = state?.game?.mode_id === 'jailbreak';
  const isAssassinRing = state?.game?.mode_id === 'assassin_ring';
  const isLive = state?.game?.status === 'live';
  const jailedSelf = selfPlayer?.status === 'jailed';
  const autoReleaseS =
    (state?.game?.mode_params?.jailbreak as { auto_release_s?: number } | undefined)?.auto_release_s ?? 300;
  const releaseRadiusM =
    (state?.game?.mode_params?.jailbreak as { release_radius_m?: number } | undefined)?.release_radius_m ?? 10;
  const releaseHoldS =
    (state?.game?.mode_params?.jailbreak as { release_hold_s?: number } | undefined)?.release_hold_s ?? 10;

  const safeZones = state?.assassin_ring?.safe_zones;
  const safeZonesData = useMemo(() => {
    if (!safeZones || safeZones.length === 0) return null;
    return {
      type: 'FeatureCollection' as const,
      features: safeZones.map((sz) =>
        circleRing({ longitude: sz.longitude, latitude: sz.latitude }, sz.radius_m),
      ),
    };
  }, [safeZones]);

  const hunterProximity = state?.assassin_ring?.hunter_proximity;
  useEffect(() => {
    if (hunterProximity === 'close') {
      try {
        Vibration.vibrate([0, 300, 150, 300]);
      } catch {
        // ignore
      }
    } else if (hunterProximity === 'near') {
      try {
        Vibration.vibrate([0, 200]);
      } catch {
        // ignore
      }
    }
  }, [hunterProximity]);

  const jailedRemainingS = useMemo(() => {
    if (!jailedSelf || !selfPlayer?.jailed_at) return null;
    const elapsed = (serverNow - Date.parse(selfPlayer.jailed_at)) / 1000;
    return Math.max(0, Math.ceil(autoReleaseS - elapsed));
  }, [jailedSelf, selfPlayer?.jailed_at, autoReleaseS, serverNow]);

  const jailedRunners = useMemo(() => {
    return (state?.players ?? []).filter((p) => p.team === 'runner' && p.status === 'jailed');
  }, [state?.players]);

  const distanceToJail =
    ownFix && jailLongitude !== undefined && jailLatitude !== undefined
      ? distanceM(ownFix, { longitude: jailLongitude, latitude: jailLatitude })
      : null;

  const isRelayHeist = state?.game?.mode_id === 'relay_heist';
  const extraction = state?.relay_heist?.extraction;
  const packageState = state?.relay_heist?.package;
  const isCarrier = Boolean(state?.relay_heist?.is_carrier);
  const handoffPendingFrom = state?.relay_heist?.handoff_pending_from;

  const extractionRingData = useMemo(() => {
    if (!extraction) return null;
    return circleRing(
      { longitude: extraction.longitude, latitude: extraction.latitude },
      extraction.radius_m ?? 25,
    );
  }, [extraction]);

  const extractionPointData: PointCollection | null = useMemo(() => {
    if (!extraction) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [extraction.longitude, extraction.latitude],
          },
        },
      ],
    };
  }, [extraction]);

  const droppedPackagePointData: PointCollection | null = useMemo(() => {
    if (
      !packageState ||
      packageState.status !== 'dropped' ||
      packageState.longitude === undefined ||
      packageState.latitude === undefined
    ) {
      return null;
    }
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [packageState.longitude, packageState.latitude],
          },
        },
      ],
    };
  }, [packageState]);

  const distanceToDroppedPackage =
    ownFix && packageState?.status === 'dropped' && packageState.longitude !== undefined && packageState.latitude !== undefined
      ? distanceM(ownFix, { longitude: packageState.longitude, latitude: packageState.latitude })
      : null;

  const distanceToExtraction =
    ownFix && extraction
      ? distanceM(ownFix, { longitude: extraction.longitude, latitude: extraction.latitude })
      : null;

  let nearestTeammateRunner: { player: GamePlayer; distance: number } | null = null;
  if (isRunner && ownFix && isCarrier) {
    for (const p of state?.players ?? []) {
      if (p.id !== selfPlayer?.id && p.team === 'runner' && p.status === 'active') {
        const pos = state?.positions.find((pos) => pos.player_id === p.id);
        if (pos) {
          const dist = distanceM(ownFix, { longitude: pos.longitude, latitude: pos.latitude });
          if (!nearestTeammateRunner || dist < nearestTeammateRunner.distance) {
            nearestTeammateRunner = { player: p, distance: dist };
          }
        }
      }
    }
  }

  const [securingHolding, setSecuringHolding] = useState(false);
  const [securingProgress, setSecuringProgress] = useState(0);
  const securingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const securingStartRef = useRef<number>(0);

  const completeSecuringAction = useCallback(async () => {
    setSecuringHolding(false);
    setSecuringProgress(0);
    if (!supabase || !gameId) return;
    const { error } = await supabase.rpc('complete_secure_package', { p_game_id: gameId });
    if (error) {
      setTagMessage(error.message);
    } else {
      playSound('victory');
      try {
        Vibration.vibrate([0, 200, 100, 200]);
      } catch {
        // ignore
      }
      setTagMessage('Package secured! Hunters win!');
      await loadState();
    }
  }, [gameId, loadState]);

  const startSecuringHold = useCallback(async () => {
    if (!supabase || !gameId || securingHolding) return;
    setSecuringHolding(true);
    setSecuringProgress(0);
    securingStartRef.current = Date.now();

    const { error } = await supabase.rpc('start_securing_package', { p_game_id: gameId });
    if (error) {
      setSecuringHolding(false);
      setTagMessage(error.message);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = (Date.now() - securingStartRef.current) / 1000;
      const progress = Math.min(1, elapsed / 20.0);
      setSecuringProgress(progress);

      if (progress >= 1) {
        clearInterval(interval);
        securingTimerRef.current = null;
        void completeSecuringAction();
      }
    }, 100);
    securingTimerRef.current = interval;
  }, [gameId, securingHolding, completeSecuringAction]);

  const cancelSecuringHold = useCallback(async () => {
    if (securingTimerRef.current) {
      clearInterval(securingTimerRef.current);
      securingTimerRef.current = null;
    }
    if (securingHolding) {
      setSecuringHolding(false);
      setSecuringProgress(0);
      if (supabase && gameId) {
        await supabase.rpc('cancel_securing_package', { p_game_id: gameId });
      }
    }
  }, [gameId, securingHolding]);

  const handleRequestHandoff = useCallback(async (targetPlayerId: string) => {
    if (!supabase || !gameId) return;
    setBusy('handoff');
    const { error } = await supabase.rpc('request_handoff', {
      p_game_id: gameId,
      p_target_player_id: targetPlayerId,
    });
    setBusy('');
    if (error) {
      setTagMessage(error.message);
    } else {
      setTagMessage('Handoff requested! Waiting for teammate to confirm...');
      await loadState();
    }
  }, [gameId, loadState]);

  const handleConfirmHandoff = useCallback(async () => {
    if (!supabase || !gameId) return;
    setBusy('confirm_handoff');
    const { error } = await supabase.rpc('confirm_handoff', { p_game_id: gameId });
    setBusy('');
    if (error) {
      setTagMessage(error.message);
    } else {
      playSound('tag');
      setTagMessage('Package received! You are now the carrier.');
      await loadState();
    }
  }, [gameId, loadState]);

  const handlePickupPackage = useCallback(async () => {
    if (!supabase || !gameId) return;
    setBusy('pickup');
    const { error } = await supabase.rpc('pickup_package', { p_game_id: gameId });
    setBusy('');
    if (error) {
      setTagMessage(error.message);
    } else {
      playSound('tag');
      setTagMessage('Package recovered! You are now the carrier.');
      await loadState();
    }
  }, [gameId, loadState]);

  // VIP Escort state
  const isVipMode = (game?.roles ?? []).includes('vip');
  const mySecretRole = selfPlayer?.secret_role;
  const isVip = mySecretRole === 'vip';
  const frozenUntil = selfPlayer?.frozen_until;
  const isFrozen = Boolean(frozenUntil && Date.parse(frozenUntil) > serverNow);
  const frozenRemainingS = useMemo(() => {
    if (!frozenUntil) return null;
    const diff = (Date.parse(frozenUntil) - serverNow) / 1000;
    return diff > 0 ? Math.ceil(diff) : null;
  }, [frozenUntil, serverNow]);

  const vipTeammate = useMemo(() => {
    if (!isRunner) return null;
    return (state?.players ?? []).find(
      (p) => p.team === 'runner' && p.secret_role === 'vip' && p.status === 'active',
    );
  }, [isRunner, state?.players]);

  const vipPosition = useMemo(() => {
    if (!vipTeammate) return null;
    return (state?.positions ?? []).find((pos) => pos.player_id === vipTeammate.id);
  }, [vipTeammate, state?.positions]);

  const distanceToVip = useMemo(() => {
    if (!ownFix || !vipPosition) return null;
    return distanceM(ownFix, { longitude: vipPosition.longitude, latitude: vipPosition.latitude });
  }, [ownFix, vipPosition]);

  const pendingRoleSwap = selfPlayer?.pending_role_swap;

  const eligibleSwapPartner = useMemo(() => {
    if (!isRunner || !isLive || isFrozen || !ownFix || !isVipMode) return null;
    const oppositeRole = isVip ? 'bodyguard' : 'vip';
    const candidates = (state?.players ?? [])
      .filter((p) => p.team === 'runner' && p.id !== myPlayerId && p.status === 'active' && p.secret_role === oppositeRole)
      .map((p) => {
        const pos = (state?.positions ?? []).find((entry) => entry.player_id === p.id);
        const dist = pos ? distanceM(ownFix, { longitude: pos.longitude, latitude: pos.latitude }) : Infinity;
        return { player: p, distance: dist };
      })
      .filter((c) => c.distance <= 5.0)
      .sort((a, b) => a.distance - b.distance);
    return candidates[0] ?? null;
  }, [isRunner, isLive, isFrozen, ownFix, isVipMode, isVip, myPlayerId, state?.players, state?.positions]);

  const handleRequestRoleSwap = useCallback(async (targetPlayerId: string) => {
    if (!supabase || !gameId) return;
    setBusy('request_swap');
    const { error } = await supabase.rpc('request_role_swap', {
      p_game_id: gameId,
      p_target_player_id: targetPlayerId,
    });
    setBusy('');
    if (error) {
      setTagMessage(error.message);
    } else {
      setTagMessage('Role swap requested! Waiting for teammate to confirm...');
      await loadState();
    }
  }, [gameId, loadState]);

  const handleConfirmRoleSwap = useCallback(async () => {
    if (!supabase || !gameId) return;
    setBusy('confirm_swap');
    const { error } = await supabase.rpc('confirm_role_swap', { p_game_id: gameId });
    setBusy('');
    if (error) {
      setTagMessage(error.message);
    } else {
      playSound('tag');
      setTagMessage('Roles swapped successfully!');
      await loadState();
    }
  }, [gameId, loadState]);

  const handleCancelRoleSwap = useCallback(async () => {
    if (!supabase || !gameId) return;
    await supabase.rpc('cancel_role_swap', { p_game_id: gameId });
    await loadState();
  }, [gameId, loadState]);

  const canRescue =
    isRunner &&
    !jailedSelf &&
    !taggedSelf &&
    isLive &&
    jailedRunners.length > 0 &&
    distanceToJail !== null &&
    distanceToJail <= releaseRadiusM;

  const [rescueHolding, setRescueHolding] = useState(false);
  const [rescueProgress, setRescueProgress] = useState(0);
  const rescueTimerRef = useRef<NodeJS.Timeout | null>(null);
  const rescueStartRef = useRef<number>(0);

  const completeRescueAction = useCallback(async () => {
    setRescueHolding(false);
    setRescueProgress(0);
    if (!supabase || !gameId) return;
    const { data, error } = await supabase.rpc('complete_rescue', { game_id: gameId });
    if (error) {
      setTagMessage(error.message);
    } else {
      playSound('victory');
      try {
        Vibration.vibrate([0, 200, 100, 200]);
      } catch {
        // ignore
      }
      setTagMessage(`Rescue complete! ${(data as { freed_count?: number })?.freed_count ?? 1} runner(s) freed.`);
      await loadState();
    }
  }, [gameId, loadState]);

  const startRescueHold = useCallback(async () => {
    if (!supabase || !gameId || rescueHolding) return;
    setRescueHolding(true);
    setRescueProgress(0);
    rescueStartRef.current = Date.now();

    const { error } = await supabase.rpc('start_rescue', { game_id: gameId });
    if (error) {
      setRescueHolding(false);
      setTagMessage(error.message);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = (Date.now() - rescueStartRef.current) / 1000;
      const progress = Math.min(1, elapsed / releaseHoldS);
      setRescueProgress(progress);

      if (progress >= 1) {
        clearInterval(interval);
        rescueTimerRef.current = null;
        void completeRescueAction();
      }
    }, 100);
    rescueTimerRef.current = interval;
  }, [gameId, rescueHolding, releaseHoldS, completeRescueAction]);

  const cancelRescueHold = useCallback(async () => {
    if (rescueTimerRef.current) {
      clearInterval(rescueTimerRef.current);
      rescueTimerRef.current = null;
    }
    if (rescueHolding) {
      setRescueHolding(false);
      setRescueProgress(0);
      if (supabase && gameId) {
        await supabase.rpc('cancel_rescue', { game_id: gameId });
      }
    }
  }, [gameId, rescueHolding]);

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
  const inPlay = ['head_start', 'live'].includes(game!.status);
  const tagRingData = isLive && !isRunner && ownFix ? circleRing(ownFix, game!.tag_radius_m) : null;

  let eyebrow =
    isAssassinRing
      ? 'ASSASSIN RING'
      : isRelayHeist
        ? 'RELAY HEIST'
        : game!.mode_id === 'jailbreak'
          ? 'JAILBREAK'
          : game!.mode === 'classic_chase'
            ? 'CLASSIC CHASE'
            : 'TAG HUNT';
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
    accent = isAssassinRing ? '#D97706' : isRelayHeist ? '#059669' : isRunner ? '#059669' : '#B45309';
    title = isAssassinRing ? 'Disperse' : isRunner ? 'Head start' : 'Hunters locked';
    subtitle = isAssassinRing
      ? 'Move away from other players. The ring activates when the timer reaches zero.'
      : isRelayHeist
        ? isRunner
          ? (isCarrier ? 'You have the package! Move toward extraction or plan handoffs.' : 'Escort your carrier or prepare for a relay handoff.')
          : 'Hunters locked. The package and runners will activate when the countdown ends.'
        : isRunner
          ? 'Move away from the target and stay inside the play area. Hunters cannot see you yet.'
          : 'The runners are moving. The map unlocks when the timer reaches zero.';
    timerLabel = isRunner ? 'HUNTERS UNLOCK IN' : 'UNLOCKING IN';
    timerValue = game!.live_at ? (Date.parse(game!.live_at) - serverNow) / 1000 : null;
  } else if (game!.status === 'live') {
    accent = isAssassinRing ? '#D97706' : isRelayHeist ? (isRunner ? '#059669' : '#DC2626') : '#DB2777';
    title = isAssassinRing
      ? state?.assassin_ring?.my_prey
        ? `Hunt: ${state.assassin_ring.my_prey.display_name}`
        : 'Hunt your assigned prey'
      : isRelayHeist
        ? isRunner
          ? isCarrier
            ? 'Deliver package to extraction'
            : packageState?.status === 'dropped'
              ? 'Recover dropped package!'
              : 'Escort carrier & be ready for handoff'
          : packageState?.status === 'dropped'
            ? 'Secure the dropped package!'
            : 'Intercept the carrier'
        : isRunner
          ? (isVipMode
              ? (isFrozen ? 'Frozen (Bodyguard Decoy)' : isVip ? 'VIP: Evade & Extract' : 'Bodyguard: Protect VIP')
              : (isJailbreak ? 'Evade hunters & rescue' : 'Reach the target'))
          : (isJailbreak ? 'Jail all runners' : isVipMode ? 'Hunt & eliminate the VIP' : 'Hunt the runners');
    subtitle = isAssassinRing
      ? state?.assassin_ring?.in_safe_zone
        ? 'You are inside a Safe Zone. Tagging is disabled.'
        : state?.assassin_ring?.hunter_proximity === 'close'
          ? 'WARNING: YOUR HUNTER IS WITHIN 40m!'
          : state?.assassin_ring?.hunter_proximity === 'near'
            ? 'CAUTION: Your hunter is within 100m.'
            : 'Track your assigned prey. Stay alert for your unknown hunter.'
      : isRelayHeist
        ? isRunner
          ? isCarrier
            ? `Reach the green extraction point (${distanceToExtraction !== null ? Math.round(distanceToExtraction) + 'm away' : 'on map'}). Pass to a teammate if hunters close in.`
            : packageState?.status === 'dropped'
              ? 'The package was dropped! Rush to recover it before hunters secure it.'
              : 'Stay close to your carrier for handoffs or draw hunters away.'
          : packageState?.status === 'dropped'
            ? 'Hold package location for 20 seconds to secure and win!'
            : 'Track radar pings to find and tag the package carrier.'
        : isRunner
          ? (isVipMode
              ? (isFrozen
                  ? `You were tagged! Frozen as a decoy for ${frozenRemainingS ?? 60}s.`
                  : isVip
                    ? 'Hunters win if they tag you! Stay protected and reach extraction.'
                    : `Shield your VIP from hunters! ${distanceToVip !== null ? `VIP is ${Math.round(distanceToVip)}m away.` : ''}`)
              : (isJailbreak ? 'Stay out of jail. Free captured teammates at the Jail marker.' : 'Your team is on the map. Hunters only get delayed pings of your position.'))
          : (isJailbreak ? 'Tag runners to send them to Jail. Win by jailing all runners at once.' : isVipMode ? 'Identify and tag the secret VIP runner to win the round!' : 'Runners are only visible as delayed pings. Use the age, not the dot, to decide.');
    timerLabel = 'TIME LEFT';
    timerValue = game!.ends_at ? (Date.parse(game!.ends_at) - serverNow) / 1000 : null;
  } else if (game!.status === 'ended') {
    eyebrow = 'ROUND OVER';
    accent = isAssassinRing ? '#D97706' : game!.winner === 'runners' ? '#059669' : '#B91C1C';
    title =
      isAssassinRing
        ? 'Ring Survivor Victory'
        : game!.winner === 'runners'
          ? 'Runners win'
          : game!.winner === 'hunters'
            ? 'Hunters win'
            : 'Round over';
    subtitle =
      game!.end_reason === 'extraction_complete'
        ? 'The runners delivered the package to extraction!'
        : game!.end_reason === 'package_secured'
          ? 'The hunters secured the dropped package!'
          : game!.end_reason === 'last_survivor'
            ? 'The final survivor won the elimination ring.'
            : game!.end_reason === 'all_jailed'
              ? 'All runners were jailed.'
          : game!.end_reason === 'time_expired'
            ? isAssassinRing
              ? 'Time ran out. The assassin with the most eliminations wins.'
              : 'Time ran out.'
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

  if (jailedSelf && game!.status === 'live') {
    eyebrow = 'JAILED';
    accent = '#DC2626';
    title = 'You are in Jail';
    subtitle =
      jailedRemainingS !== null
        ? `Auto-release in ${formatClock(jailedRemainingS)}. Free teammates can rescue you at the Jail.`
        : 'Wait for a teammate to rescue you at the Jail.';
    timerLabel = 'JAIL TIME';
    timerValue = jailedRemainingS;
  } else if (taggedSelf && game!.status === 'live') {
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

        {jailRingData && (
          <GeoJSONSource id="jail-radius" data={jailRingData}>
            <Layer
              id="jail-radius-fill"
              type="fill"
              paint={{ 'fill-color': '#EF4444', 'fill-opacity': 0.12 }}
            />
            <Layer
              id="jail-radius-line"
              type="line"
              paint={{ 'line-color': '#EF4444', 'line-width': 2, 'line-dasharray': [3, 2] }}
            />
          </GeoJSONSource>
        )}

        {jailPointData && (
          <GeoJSONSource id="jail-point" data={jailPointData}>
            <Layer
              id="jail-point-circle"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': '#DC2626',
                'circle-stroke-width': 3,
                'circle-stroke-color': '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}

        {safeZonesData && (
          <GeoJSONSource id="safe-zones" data={safeZonesData}>
            <Layer
              id="safe-zones-fill"
              type="fill"
              paint={{ 'fill-color': '#10B981', 'fill-opacity': 0.15 }}
            />
            <Layer
              id="safe-zones-outline"
              type="line"
              paint={{
                'line-color': '#059669',
                'line-width': 2,
                'line-dasharray': [3, 2],
              }}
            />
          </GeoJSONSource>
        )}

        {extractionRingData && (
          <GeoJSONSource id="extraction-radius" data={extractionRingData}>
            <Layer
              id="extraction-radius-fill"
              type="fill"
              paint={{ 'fill-color': '#10B981', 'fill-opacity': 0.15 }}
            />
            <Layer
              id="extraction-radius-line"
              type="line"
              paint={{ 'line-color': '#059669', 'line-width': 2.5, 'line-dasharray': [3, 2] }}
            />
          </GeoJSONSource>
        )}

        {extractionPointData && (
          <GeoJSONSource id="extraction-point" data={extractionPointData}>
            <Layer
              id="extraction-point-halo"
              type="circle"
              paint={{
                'circle-radius': 18,
                'circle-color': '#10B981',
                'circle-opacity': 0.3,
              }}
            />
            <Layer
              id="extraction-point-circle"
              type="circle"
              paint={{
                'circle-radius': 10,
                'circle-color': '#059669',
                'circle-stroke-width': 3,
                'circle-stroke-color': '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}

        {droppedPackagePointData && (
          <GeoJSONSource id="dropped-package-point" data={droppedPackagePointData}>
            <Layer
              id="dropped-package-halo"
              type="circle"
              paint={{
                'circle-radius': 24,
                'circle-color': '#F59E0B',
                'circle-opacity': 0.35,
              }}
            />
            <Layer
              id="dropped-package-circle"
              type="circle"
              paint={{
                'circle-radius': 11,
                'circle-color': '#D97706',
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
                  accessibilityLabel={sfxMuted ? 'Unmute SFX' : 'Mute SFX'}
                  accessibilityRole="button"
                  onPress={async () => {
                    const next = await toggleAudioMuted();
                    setSfxMuted(next);
                  }}
                  style={styles.muteButton}
                >
                  <View style={styles.muteButtonContent}>
                    <Ionicons
                      color={sfxMuted ? '#94A3B8' : '#1D4ED8'}
                      name={sfxMuted ? 'volume-mute' : 'volume-high'}
                      size={14}
                    />
                    <Text style={styles.muteButtonText}>{sfxMuted ? 'SFX Off' : 'SFX On'}</Text>
                  </View>
                </Pressable>
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
            {isLive && (!isRunner || isAssassinRing) && !taggedSelf && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {!isAssassinRing && (game?.modifiers ?? []).includes('hot_cold') && (
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
                {(game?.modifiers ?? []).includes('qr_tagging') && (
                  <Pressable
                    accessibilityLabel="Scan runner QR tag"
                    accessibilityRole="button"
                    onPress={() => setHunterScannerVisible(true)}
                    style={styles.qrScanButton}
                  >
                    <MaterialCommunityIcons color="#FFFFFF" name="qrcode-scan" size={16} />
                    <Text style={styles.qrScanButtonText}>SCAN QR</Text>
                  </Pressable>
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
            {isLive &&
              isRunner &&
              !taggedSelf &&
              (game?.modifiers ?? []).includes('qr_tagging') && (
                <Pressable
                  accessibilityLabel="Show My QR Code"
                  accessibilityRole="button"
                  onPress={() => setRunnerQrVisible(true)}
                  style={styles.runnerQrButton}
                >
                  <MaterialCommunityIcons color="#0F172A" name="qrcode" size={16} />
                  <Text style={styles.runnerQrButtonText}>MY QR</Text>
                </Pressable>
              )}
          </View>
        </View>

        <Animated.View
          pointerEvents={sheetExpanded ? 'auto' : 'none'}
          style={[styles.sheetInner, { opacity: sheetContentOpacity }]}
        >
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
            {isLive && (!isRunner || isAssassinRing) && !taggedSelf && (
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
                    <Text style={styles.tagText}>{isAssassinRing ? 'TAG YOUR TARGET' : 'TAG A RUNNER'}</Text>
                  )}
                </Pressable>
                <Text style={styles.tagHint}>
                  {isAssassinRing
                    ? `Get within ${game!.tag_radius_m} m of your assigned prey and tap. Safe zones disable tagging.`
                    : `Get within ${game!.tag_radius_m} m of a runner and tap. Both positions must be fresh.`}
                </Text>
                {tagMessage !== '' && <Text style={styles.tagMessage}>{tagMessage}</Text>}
              </>
            )}

            {isLive &&
              !isRunner &&
              !taggedSelf &&
              (game?.modifiers ?? []).includes('qr_tagging') && (
                <Pressable
                  accessibilityLabel="Scan runner QR tag"
                  accessibilityRole="button"
                  onPress={() => setHunterScannerVisible(true)}
                  style={styles.sheetQrScanButton}
                >
                  <MaterialCommunityIcons color="#FFFFFF" name="qrcode-scan" size={18} />
                  <Text style={styles.sheetQrScanText}>SCAN RUNNER QR TAG</Text>
                </Pressable>
              )}

            {isLive &&
              isRunner &&
              !taggedSelf &&
              (game?.modifiers ?? []).includes('qr_tagging') && (
                <Pressable
                  accessibilityLabel="Show my QR tag"
                  accessibilityRole="button"
                  onPress={() => setRunnerQrVisible(true)}
                  style={styles.sheetRunnerQrButton}
                >
                  <MaterialCommunityIcons color="#0F172A" name="qrcode" size={18} />
                  <Text style={styles.sheetRunnerQrText}>SHOW MY QR TAG</Text>
                </Pressable>
              )}

            {isLive && jailedSelf && (
              <View style={styles.jailedBanner}>
                <Ionicons color="#DC2626" name="lock-closed" size={20} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.jailedBannerTitle}>YOU ARE IN JAIL</Text>
                  <Text style={styles.jailedBannerText}>
                    {jailedRemainingS !== null
                      ? `Auto-release in ${formatClock(jailedRemainingS)}. Or wait for a free teammate to reach the Jail zone.`
                      : 'Wait for a free teammate to reach the Jail zone to rescue you.'}
                  </Text>
                </View>
              </View>
            )}

            {isLive && isRunner && !taggedSelf && !jailedSelf && jailedRunners.length > 0 && (
              <View style={styles.rescueCard}>
                <View style={styles.rescueHeaderRow}>
                  <Ionicons color="#059669" name="lock-open" size={18} />
                  <Text style={styles.rescueTitle}>
                    {jailedRunners.length} TEAMMATE{jailedRunners.length > 1 ? 'S' : ''} JAILED
                  </Text>
                </View>
                <Text style={styles.rescueSubtitle}>
                  {distanceToJail !== null
                    ? distanceToJail <= releaseRadiusM
                      ? `You are inside the rescue zone (${Math.round(distanceToJail)}m from jail). Hold the button for ${releaseHoldS}s to free them.`
                      : `Get within ${releaseRadiusM}m of the Jail to rescue (${Math.round(distanceToJail)}m away).`
                    : 'Move toward the Jail location on the map.'}
                </Text>
                {canRescue && (
                  <View style={styles.rescueButtonContainer}>
                    <Pressable
                      accessibilityLabel="Hold to rescue teammates"
                      accessibilityRole="button"
                      onPressIn={() => void startRescueHold()}
                      onPressOut={() => void cancelRescueHold()}
                      style={[styles.rescueButton, rescueHolding && styles.rescueButtonHolding]}
                    >
                      <View style={[styles.rescueProgressBar, { width: `${Math.round(rescueProgress * 100)}%` }]} />
                      <Text style={styles.rescueButtonText}>
                        {rescueHolding
                          ? `HOLDING... ${Math.round(rescueProgress * 100)}%`
                          : `HOLD TO RESCUE (${releaseHoldS}s)`}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            {isLive && isRelayHeist && !taggedSelf && (
              <>
                {isRunner && isCarrier && (
                  <View style={styles.heistCarrierCard}>
                    <View style={styles.rescueHeaderRow}>
                      <MaterialCommunityIcons color="#059669" name="package-variant-closed" size={20} />
                      <Text style={styles.heistCarrierTitle}>YOU HAVE THE PACKAGE</Text>
                    </View>
                    <Text style={styles.heistCarrierSubtitle}>
                      {distanceToExtraction !== null
                        ? `Extraction zone is ${Math.round(distanceToExtraction)}m away. Move inside the zone to secure victory.`
                        : 'Move to the green extraction zone on the map.'}
                    </Text>
                    {nearestTeammateRunner && (
                      <View style={{ marginTop: 8 }}>
                        {nearestTeammateRunner.distance <= 5.0 ? (
                          <Pressable
                            accessibilityLabel="Hand off package to teammate"
                            accessibilityRole="button"
                            disabled={busy !== ''}
                            onPress={() => void handleRequestHandoff(nearestTeammateRunner.player.id)}
                            style={[styles.heistActionBtn, busy !== '' && styles.disabled]}
                          >
                            {busy === 'handoff' ? (
                              <ActivityIndicator color="#FFFFFF" />
                            ) : (
                              <Text style={styles.heistActionBtnText}>
                                HAND OFF TO {nearestTeammateRunner.player.display_name.toUpperCase()}
                              </Text>
                            )}
                          </Pressable>
                        ) : (
                          <Text style={styles.rescueSubtitle}>
                            Teammate {nearestTeammateRunner.player.display_name} is {Math.round(nearestTeammateRunner.distance)}m away (get within 5m to hand off).
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                )}

                {isRunner && !isCarrier && handoffPendingFrom && (
                  <View style={styles.heistCarrierCard}>
                    <View style={styles.rescueHeaderRow}>
                      <MaterialCommunityIcons color="#059669" name="handshake" size={20} />
                      <Text style={styles.heistCarrierTitle}>INCOMING PACKAGE HANDOFF</Text>
                    </View>
                    <Text style={styles.heistCarrierSubtitle}>
                      A teammate is offering you the package! Confirm to take the carrier burden.
                    </Text>
                    <Pressable
                      accessibilityLabel="Accept package handoff"
                      accessibilityRole="button"
                      disabled={busy !== ''}
                      onPress={() => void handleConfirmHandoff()}
                      style={[styles.heistActionBtn, busy !== '' && styles.disabled]}
                    >
                      {busy === 'confirm_handoff' ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.heistActionBtnText}>ACCEPT PACKAGE</Text>
                      )}
                    </Pressable>
                  </View>
                )}

                {packageState?.status === 'dropped' && (
                  <View style={styles.heistDroppedCard}>
                    <View style={styles.rescueHeaderRow}>
                      <MaterialCommunityIcons color="#D97706" name="alert-decagram" size={20} />
                      <Text style={styles.heistDroppedTitle}>PACKAGE DROPPED</Text>
                    </View>
                    <Text style={styles.heistDroppedSubtitle}>
                      {distanceToDroppedPackage !== null
                        ? `The package is on the ground ${Math.round(distanceToDroppedPackage)}m away.`
                        : 'The package was dropped on the map.'}
                    </Text>

                    {isRunner && (
                      <View style={{ marginTop: 8 }}>
                        {distanceToDroppedPackage !== null && distanceToDroppedPackage <= 10.0 ? (
                          <Pressable
                            accessibilityLabel="Pick up package"
                            accessibilityRole="button"
                            disabled={busy !== ''}
                            onPress={() => void handlePickupPackage()}
                            style={[styles.heistActionBtn, busy !== '' && styles.disabled]}
                          >
                            {busy === 'pickup' ? (
                              <ActivityIndicator color="#FFFFFF" />
                            ) : (
                              <Text style={styles.heistActionBtnText}>RECOVER PACKAGE</Text>
                            )}
                          </Pressable>
                        ) : (
                          <Text style={styles.heistDroppedSubtitle}>
                            Move within 10m of the amber marker to recover the package!
                          </Text>
                        )}
                      </View>
                    )}

                    {!isRunner && (
                      <View style={{ marginTop: 8 }}>
                        {distanceToDroppedPackage !== null && distanceToDroppedPackage <= 10.0 ? (
                          <Pressable
                            accessibilityLabel="Hold to secure package"
                            accessibilityRole="button"
                            onPressIn={() => void startSecuringHold()}
                            onPressOut={() => void cancelSecuringHold()}
                            style={[
                              styles.rescueButton,
                              styles.heistActionBtnHunter,
                              securingHolding && styles.rescueButtonHolding,
                            ]}
                          >
                            <View
                              style={[
                                styles.rescueProgressBar,
                                {
                                  backgroundColor: '#F59E0B',
                                  width: `${Math.round(securingProgress * 100)}%`,
                                },
                              ]}
                            />
                            <Text style={styles.rescueButtonText}>
                              {securingHolding
                                ? `SECURING... ${Math.round(securingProgress * 100)}%`
                                : 'HOLD TO SECURE PACKAGE (20s)'}
                            </Text>
                          </Pressable>
                        ) : (
                          <Text style={styles.heistDroppedSubtitle}>
                            Move within 10m of the amber package marker to secure it.
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                )}
              </>
            )}

            {isVipMode && isRunner && isLive && (
              <>
                {isFrozen && (
                  <View style={styles.vipFrozenCard}>
                    <View style={styles.rescueHeaderRow}>
                      <MaterialCommunityIcons color="#3B82F6" name="snowflake" size={20} />
                      <Text style={styles.vipFrozenTitle}>YOU ARE FROZEN (BODYGUARD)</Text>
                    </View>
                    <Text style={styles.vipFrozenSubtitle}>
                      You were tagged as a bodyguard! You are frozen as a distraction for{' '}
                      {frozenRemainingS ?? 60} more seconds.
                    </Text>
                  </View>
                )}

                {pendingRoleSwap && !isFrozen && (
                  <View style={styles.vipSwapCard}>
                    <View style={styles.rescueHeaderRow}>
                      <MaterialCommunityIcons color="#D97706" name="swap-horizontal" size={20} />
                      <Text style={styles.vipSwapTitle}>INCOMING ROLE SWAP REQUEST</Text>
                    </View>
                    <Text style={styles.vipSwapSubtitle}>
                      A teammate has requested a physical role swap! Confirm to swap roles.
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                      <Pressable
                        accessibilityLabel="Confirm role swap"
                        accessibilityRole="button"
                        disabled={busy !== ''}
                        onPress={() => void handleConfirmRoleSwap()}
                        style={[styles.vipSwapActionBtn, { flex: 1 }, busy !== '' && styles.disabled]}
                      >
                        {busy === 'confirm_swap' ? (
                          <ActivityIndicator color="#FFFFFF" />
                        ) : (
                          <Text style={styles.vipSwapActionBtnText}>ACCEPT SWAP</Text>
                        )}
                      </Pressable>
                      <Pressable
                        accessibilityLabel="Decline role swap"
                        accessibilityRole="button"
                        onPress={() => void handleCancelRoleSwap()}
                        style={[styles.vipSwapCancelBtn, { flex: 1 }]}
                      >
                        <Text style={styles.vipSwapCancelBtnText}>DECLINE</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {!pendingRoleSwap && !isFrozen && eligibleSwapPartner && (
                  <View style={styles.vipSwapCard}>
                    <View style={styles.rescueHeaderRow}>
                      <MaterialCommunityIcons color="#2563EB" name="shield-sync" size={20} />
                      <Text style={styles.vipSwapTitle}>ROLE SWAP AVAILABLE</Text>
                    </View>
                    <Text style={styles.vipSwapSubtitle}>
                      {isVip
                        ? `Bodyguard ${eligibleSwapPartner.player.display_name} is within 5m. Swap roles to throw off hunters!`
                        : `VIP ${eligibleSwapPartner.player.display_name} is within 5m. Offer to take the VIP mantle!`}
                    </Text>
                    <Pressable
                      accessibilityLabel="Request role swap with nearby teammate"
                      accessibilityRole="button"
                      disabled={busy !== ''}
                      onPress={() => void handleRequestRoleSwap(eligibleSwapPartner.player.id)}
                      style={[styles.vipSwapActionBtn, busy !== '' && styles.disabled, { marginTop: 8 }]}
                    >
                      {busy === 'request_swap' ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.vipSwapActionBtnText}>
                          SWAP ROLES WITH {eligibleSwapPartner.player.display_name.toUpperCase()}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                )}
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
              <>
                <AgentControls
                  gameId={gameId}
                  mode={game.mode}
                  status={modifiers.status}
                  runners={players.filter((p) => p.team === 'runner' && p.status === 'active')}
                  onActionComplete={() => void loadState()}
                />
                <TribunalDock
                  gameId={gameId}
                  myPlayerId={myPlayerId}
                  status={modifiers.status}
                  hunters={players.filter((p) => p.team === 'hunter' && p.status === 'active')}
                  onActionComplete={() => void loadState()}
                />
                <ModifierPanel
                  gameId={gameId}
                  game={game}
                  status={modifiers.status}
                  drops={modifiers.drops}
                  refresh={modifiers.refresh}
                  serverNow={serverNow}
                />
              </>
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
                    player.status === 'jailed' && styles.playerJailed,
                    player.status === 'tagged' && styles.playerTagged,
                    player.team === 'runner' && player.status !== 'tagged' && player.status !== 'jailed' && styles.playerRunner,
                  ]}
                >
                  {player.status === 'jailed'
                    ? 'Jailed'
                    : player.status === 'tagged'
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

      <RadarPingRipple active={pingRippleActive} />

      {gameId && (
        <>
          <RunnerQrCard
            visible={runnerQrVisible}
            gameId={gameId}
            onClose={() => setRunnerQrVisible(false)}
          />

          <HunterQrScanner
            visible={hunterScannerVisible}
            gameId={gameId}
            onTagSuccess={() => void loadState()}
            onClose={() => setHunterScannerVisible(false)}
          />
        </>
      )}
    </View>
  );
}

function RadarPingRipple({ active }: { active: boolean }) {
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (active) {
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }).start();
    }
  }, [active, anim]);

  if (!active) return null;

  const scale1 = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 2.4],
  });
  const opacity1 = anim.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0.8, 0.5, 0],
  });

  const scale2 = anim.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0.1, 0.3, 1.8],
  });
  const opacity2 = anim.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0.7, 0.4, 0],
  });

  return (
    <View pointerEvents="none" style={styles.radarRippleContainer}>
      <Animated.View
        style={[
          styles.radarRippleRing,
          {
            transform: [{ scale: scale1 }],
            opacity: opacity1,
          },
        ]}
      />
      <Animated.View
        style={[
          styles.radarRippleRingSecondary,
          {
            transform: [{ scale: scale2 }],
            opacity: opacity2,
          },
        ]}
      />
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
  qrScanButton: {
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 9,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
  },
  qrScanButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  runnerQrButton: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
    borderRadius: 9,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
  },
  runnerQrButtonText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  sheetQrScanButton: {
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 13,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 12,
    minHeight: 52,
  },
  sheetQrScanText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  sheetRunnerQrButton: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderRadius: 13,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 12,
    minHeight: 52,
  },
  sheetRunnerQrText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  radarRippleContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 90,
  },
  radarRippleRing: {
    borderColor: '#0284C7',
    borderRadius: 100,
    borderWidth: 3,
    height: 200,
    position: 'absolute',
    width: 200,
  },
  radarRippleRingSecondary: {
    borderColor: '#38BDF8',
    borderRadius: 100,
    borderWidth: 1.5,
    height: 200,
    position: 'absolute',
    width: 200,
  },
  playerJailed: { color: '#DC2626', fontWeight: '800' },
  jailedBanner: {
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderRadius: 14,
    borderWidth: 1.5,
    flexDirection: 'row',
    marginBottom: 12,
    padding: 14,
  },
  jailedBannerTitle: {
    color: '#991B1B',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  jailedBannerText: {
    color: '#7F1D1D',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  rescueCard: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 12,
    padding: 14,
  },
  rescueHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  rescueTitle: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  rescueSubtitle: {
    color: '#14532D',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  rescueButtonContainer: {
    marginTop: 10,
  },
  rescueButton: {
    alignItems: 'center',
    backgroundColor: '#059669',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  rescueButtonHolding: {
    backgroundColor: '#047857',
  },
  rescueProgressBar: {
    backgroundColor: '#10B981',
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
  rescueButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.8,
    zIndex: 1,
  },
  heistCarrierCard: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 12,
    padding: 14,
  },
  heistCarrierTitle: {
    color: '#065F46',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  heistCarrierSubtitle: {
    color: '#047857',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  heistDroppedCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 12,
    padding: 14,
  },
  heistDroppedTitle: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  heistDroppedSubtitle: {
    color: '#B45309',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  heistActionBtn: {
    alignItems: 'center',
    backgroundColor: '#059669',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    marginTop: 10,
  },
  heistActionBtnHunter: {
    backgroundColor: '#D97706',
  },
  heistActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  vipFrozenCard: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 12,
    padding: 14,
  },
  vipFrozenTitle: {
    color: '#1E40AF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  vipFrozenSubtitle: {
    color: '#2563EB',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  vipSwapCard: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 12,
    padding: 14,
  },
  vipSwapTitle: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  vipSwapSubtitle: {
    color: '#B45309',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  vipSwapActionBtn: {
    alignItems: 'center',
    backgroundColor: '#D97706',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
  },
  vipSwapActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  vipSwapCancelBtn: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#FCD34D',
    borderRadius: 12,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
  },
  vipSwapCancelBtnText: {
    color: '#92400E',
    fontSize: 14,
    fontWeight: '700',
  },
});

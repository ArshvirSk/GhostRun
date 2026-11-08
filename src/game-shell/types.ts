import type { LngLat } from '../lib/geo';
import type { HeatMark } from '../components/GameModifiers';

export type Team = 'runner' | 'hunter' | 'solo' | 'unassigned';

export type Phase =
  | 'lobby'
  | 'target_selection'
  | 'countdown'
  | 'head_start'
  | 'live'
  | 'ended'
  | 'cancelled'
  | 'paused';

export type Role = 'runner' | 'hunter' | 'operator' | 'spectator' | 'solo';

export type Slot = 'top' | 'banner' | 'overlay' | 'actions' | 'sheet' | 'mapLayer';

export interface GamePlayer {
  id: string;
  user_id: string;
  display_name: string;
  color: string;
  team: Team;
  status: 'active' | 'tagged' | 'left' | 'jailed';
  is_ready: boolean;
  is_remote?: boolean;
  jailed_at?: string | null;
  frozen_until?: string | null;
  secret_role?: string | null;
  pending_role_swap?: {
    from_player_id: string;
    from_role: string;
    requested_at: string;
  } | null;
}

export interface RoundPosition {
  player_id: string;
  display_name: string;
  color: string;
  team: Team;
  longitude: number;
  latitude: number;
  accuracy_m: number | null;
  recorded_at: string;
  is_mock: boolean;
}

export interface OwnPosition {
  player_id: string;
  longitude: number;
  latitude: number;
  accuracy_m: number | null;
  recorded_at: string;
  is_mock: boolean;
}

export interface RoundPing {
  id: number;
  seq: number;
  player_id: string;
  longitude: number | null;
  latitude: number | null;
  accuracy_m: number | null;
  position_age_s: number | null;
  reason: 'scheduled' | 'boundary' | 'noise' | 'camping' | 'item' | 'ghost_sighting';
  released_at: string;
}

export interface GameEvent {
  id: number;
  game_id: string;
  type: string;
  audience: string;
  payload: Record<string, any>;
  created_at: string;
}

export interface GameArea extends LngLat {
  radius_m: number;
  base_radius_m?: number;
  zone_stage?: number;
  zone_stage_count?: number;
  shrinking?: boolean;
}

export interface JailState {
  id: string;
  latitude: number;
  longitude: number;
  radius_m: number;
}

export interface VipEscortState {
  is_active: boolean;
  vip_player_id?: string | null;
}

export interface TerritoryPulseState {
  is_active: boolean;
  pulse_seq?: number;
  next_pulse_at?: string | null;
  zone_count?: number;
  dominance_pct?: number;
  scores?: { runner: number; hunter: number };
  sectors?: {
    id: string;
    name: string;
    zone_index: number;
    longitude: number;
    latitude: number;
    radius_m: number;
    controller: 'neutral' | 'runner' | 'hunter';
    contender: 'neutral' | 'runner' | 'hunter' | null;
    runner_count?: number;
    hunter_count?: number;
  }[];
}

export interface GhostDuelState {
  variant: 'time_trial' | 'evade' | 'mirror_chase';
  target?: {
    id: string;
    longitude: number;
    latitude: number;
    radius_m: number;
  } | null;
  ghost?: {
    id: string;
    longitude: number;
    latitude: number;
    duration_s: number;
    elapsed_s: number;
    total_length_m: number;
    path_wkt?: string | null;
  } | null;
}

export interface RelayHeistState {
  extraction?: {
    id: string;
    longitude: number;
    latitude: number;
    radius_m: number;
  } | null;
  package?: {
    status: 'carried' | 'dropped' | 'secured';
    carrier_id?: string | null;
    dropped_at?: string | null;
    longitude?: number | null;
    latitude?: number | null;
  } | null;
  is_carrier?: boolean;
  handoff_pending_from?: string | null;
  securing_in_progress?: boolean;
}

export interface AssassinRingState {
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
}

export interface OperatorState {
  is_operator?: boolean;
  squad?: 'runner' | 'hunter';
  cooldown_until?: string | null;
  markers?: {
    id: string;
    label: string;
    latitude: number;
    longitude: number;
    created_at: string;
  }[];
  last_scan?: {
    type: 'runner_sweep' | 'hunter_census';
    envelope?: { latitude: number; longitude: number; radius_m: number };
    count?: number;
    timestamp: string;
  } | null;
}

export interface AiGmState {
  is_active: boolean;
  event_count: number;
  max_events: number;
  next_event_at?: string | null;
  last_event_type?: string | null;
  last_title?: string | null;
  last_narration?: string | null;
  fog_active: boolean;
  fog_ends_at?: string | null;
}

export interface SafetyState {
  is_paused: boolean;
  pause_reason?: string | null;
  paused_by_name?: string | null;
  curfew_at?: string | null;
  vehicle_warning?: boolean;
}

export interface RoundState {
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
    area: GameArea;
    target_set: boolean;
    boundary_grace_s?: number;
    boundary_penalty?: 'warn' | 'extra_ping';
    jail?: JailState | null;
    vip_escort?: VipEscortState | null;
    territory_pulse?: TerritoryPulseState | null;
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
  assassin_ring?: AssassinRingState | null;
  ghost_duel?: GhostDuelState | null;
  relay_heist?: RelayHeistState | null;
  operator?: OperatorState | null;
  ai_gm?: AiGmState | null;
  safety?: SafetyState | null;
}

export interface ShellActions {
  refreshState: () => Promise<void>;
  attemptTag: () => Promise<{ ok: boolean; message?: string }>;
  leaveGame: () => Promise<{ ok: boolean; error?: string }>;
  sendSos: () => Promise<{ ok: boolean; error?: string }>;
  pauseGame: (reason?: string) => Promise<{ ok: boolean; error?: string }>;
  resumeGame: () => Promise<{ ok: boolean; error?: string }>;
  votePauseGame: (vote: boolean) => Promise<{ ok: boolean; error?: string }>;
  // Base mode actions
  startRescue: () => Promise<{ ok: boolean; error?: string }>;
  completeRescue: () => Promise<{ ok: boolean; error?: string }>;
  cancelRescue: () => Promise<{ ok: boolean; error?: string }>;
  tagGhost: () => Promise<{ ok: boolean; error?: string }>;
  requestRoleSwap: (targetPlayerId: string) => Promise<{ ok: boolean; error?: string }>;
  confirmRoleSwap: () => Promise<{ ok: boolean; error?: string }>;
  cancelRoleSwap: () => Promise<{ ok: boolean; error?: string }>;
  requestHandoff: (targetPlayerId: string) => Promise<{ ok: boolean; error?: string }>;
  confirmHandoff: () => Promise<{ ok: boolean; error?: string }>;
  pickupPackage: () => Promise<{ ok: boolean; error?: string }>;
  startSecuringPackage: () => Promise<{ ok: boolean; error?: string }>;
  completeSecurePackage: () => Promise<{ ok: boolean; error?: string }>;
  cancelSecuringPackage: () => Promise<{ ok: boolean; error?: string }>;
  // Operator actions
  placeMarker: (lat: number, lng: number, label?: string) => Promise<{ ok: boolean; error?: string }>;
  clearMarker: (markerId: string) => Promise<{ ok: boolean; error?: string }>;
  operatorScan: (target?: { lat: number; lng: number }) => Promise<{ ok: boolean; data?: any; error?: string }>;
  sendOperatorMessage: (message: string) => Promise<{ ok: boolean; error?: string }>;
  // Modifier actions
  heatPress: () => Promise<{ ok: boolean; result?: 'hot' | 'cold' | 'no_change'; error?: string }>;
  agentWhisper: () => Promise<{ ok: boolean; quadrant?: string; error?: string }>;
  agentScramble: (targetPlayerId: string) => Promise<{ ok: boolean; error?: string }>;
  conveneTribunal: (accusedPlayerId: string) => Promise<{ ok: boolean; error?: string }>;
  castTribunalVote: (tribunalId: string, vote: boolean) => Promise<{ ok: boolean; error?: string }>;
  claimDrop: (dropId: string) => Promise<{ ok: boolean; error?: string }>;
  useItem: (itemId: string) => Promise<{ ok: boolean; error?: string }>;
}

export interface HudWidgetProps {
  gameId: string;
  state: RoundState;
  actions: ShellActions;
  ownFix: LngLat | null;
  serverNow: number;
  myRole: Role;
  phase: Phase;
  isCompact?: boolean;
}

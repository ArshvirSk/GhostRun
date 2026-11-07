/**
 * Client mirror of the server mode registry. The server (`get_mode_registry`)
 * is authoritative: it owns the compatibility matrix and the feature flags.
 * This file only supplies types, labels and plain-language rules so the lobby
 * can render the same configuration without duplicating validation.
 */

export type TeamId = 'runner' | 'hunter' | 'solo';

export type ModeDefinition = {
  id: string;
  layer: 'base';
  name: string;
  teams: TeamId[];
  min_players: number;
  compatible_roles: string[];
  compatible_modifiers: string[];
  parameters: Record<string, unknown>;
  enabled: boolean;
};

export type ModifierDefinition = {
  id: string;
  layer: 'modifier';
  name: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
};

export type RoleDefinition = {
  id: string;
  layer: 'role';
  name: string;
  enabled: boolean;
};

export type ModeRegistry = {
  modes: ModeDefinition[];
  modifiers: ModifierDefinition[];
  roles: RoleDefinition[];
};

export const FALLBACK_REGISTRY: ModeRegistry = {
  modes: [
    {
      id: 'classic_chase',
      layer: 'base',
      name: 'Classic Chase',
      teams: ['runner', 'hunter'],
      min_players: 2,
      compatible_roles: ['double_agent', 'vip', 'operator'],
      compatible_modifiers: [
        'noise_meter',
        'dead_drops',
        'hot_cold',
        'qr_tagging',
        'shrinking_zone',
      ],
      parameters: {},
      enabled: true,
    },
    {
      id: 'tag_hunt',
      layer: 'base',
      name: 'Tag Hunt',
      teams: ['runner', 'hunter'],
      min_players: 2,
      compatible_roles: ['double_agent', 'vip', 'operator'],
      compatible_modifiers: [
        'noise_meter',
        'dead_drops',
        'hot_cold',
        'qr_tagging',
        'shrinking_zone',
      ],
      parameters: {},
      enabled: true,
    },
    {
      id: 'haunted_map',
      layer: 'base',
      name: 'Haunted Map',
      teams: ['runner', 'hunter'],
      min_players: 1,
      compatible_roles: [],
      compatible_modifiers: [
        'noise_meter',
        'dead_drops',
        'hot_cold',
        'qr_tagging',
        'shrinking_zone',
      ],
      parameters: { ghost_count: 2, ghost_speed_mps: 1.3 },
      enabled: true,
    },
    {
      id: 'ghost_duel',
      layer: 'base',
      name: 'Ghost Duel',
      teams: ['runner', 'hunter'],
      min_players: 1,
      compatible_roles: [],
      compatible_modifiers: ['noise_meter', 'shrinking_zone'],
      parameters: { variant: 'time_trial', variants: ['time_trial', 'evade', 'mirror_chase'] },
      enabled: true,
    },
    {
      id: 'jailbreak',
      layer: 'base',
      name: 'Jailbreak',
      teams: ['runner', 'hunter'],
      min_players: 5,
      compatible_roles: ['double_agent', 'operator'],
      compatible_modifiers: [
        'noise_meter',
        'dead_drops',
        'hot_cold',
        'qr_tagging',
        'shrinking_zone',
      ],
      parameters: {
        jail_radius_m: 15,
        auto_release_s: 300,
        release_hold_s: 10,
        release_radius_m: 10,
      },
      enabled: true,
    },
    {
      id: 'assassin_ring',
      layer: 'base',
      name: 'Assassin Ring',
      teams: ['solo'],
      min_players: 3,
      compatible_roles: [],
      compatible_modifiers: ['noise_meter', 'dead_drops', 'qr_tagging', 'shrinking_zone'],
      parameters: {
        tag_radius_m: 15,
        safe_zone_count: 2,
        safe_zone_radius_m: 20,
        safe_zone_max_s: 60,
        safe_zone_cooldown_s: 120,
        hunter_pulse_far_m: 100,
        hunter_pulse_near_m: 40,
        offline_relink_s: 180,
      },
      enabled: true,
    },
    {
      id: 'relay_heist',
      layer: 'base',
      name: 'Relay Heist',
      teams: ['runner', 'hunter'],
      min_players: 3,
      compatible_roles: ['double_agent', 'operator'],
      compatible_modifiers: [
        'noise_meter',
        'dead_drops',
        'hot_cold',
        'qr_tagging',
        'shrinking_zone',
      ],
      parameters: {
        extraction_radius_m: 25,
        carrier_ping_multiplier: 1.5,
        handoff_distance_m: 5,
        handoff_timeout_s: 10,
        handoff_cooldown_s: 20,
        pickup_distance_m: 10,
        securing_distance_m: 10,
        securing_hold_s: 20,
      },
      enabled: true,
    },
    {
      id: 'territory_pulse',
      layer: 'base',
      name: 'Territory Pulse',
      teams: ['runner', 'hunter'],
      min_players: 2,
      compatible_roles: ['operator'],
      compatible_modifiers: ['dead_drops', 'shrinking_zone', 'qr_tagging'],
      parameters: {
        pulse_interval_s: 90,
        zone_count: 7,
        dominance_pct: 70,
        zone_radius_m: 60,
      },
      enabled: true,
    },
  ],
  modifiers: [
    { id: 'noise_meter', layer: 'modifier', name: 'Noise Meter', parameters: {}, enabled: true },
    { id: 'dead_drops', layer: 'modifier', name: 'Dead Drops', parameters: {}, enabled: true },
    { id: 'hot_cold', layer: 'modifier', name: 'Hot & Cold Hunt', parameters: {}, enabled: true },
    { id: 'qr_tagging', layer: 'modifier', name: 'QR Tagging', parameters: {}, enabled: true },
    {
      id: 'shrinking_zone',
      layer: 'modifier',
      name: 'Shrinking Zone',
      parameters: {},
      enabled: true,
    },
  ],
  roles: [
    { id: 'double_agent', layer: 'role', name: 'Double Agent', enabled: true },
    { id: 'vip', layer: 'role', name: 'VIP Escort', enabled: true },
    { id: 'operator', layer: 'role', name: 'Operator', enabled: true },
  ],
};

const MODIFIER_RULES: Record<string, string[]> = {
  noise_meter: [
    'Running and sprinting make noise. Noise reaches 100 and pings you.',
    'Walk or stand still to stay quiet.',
  ],
  dead_drops: [
    'Hidden drops appear when you are close. Hold to claim one.',
    'Each drop is single use and gives your team an item.',
  ],
  hot_cold: [
    'Hunters have a HEAT button. Red tint means a runner is close, blue means not.',
    'The button has limited charges shared by the hunter team.',
  ],
  qr_tagging: [
    'Runners show a rotating QR code. Hunters scan it to tag.',
    'The code changes every 20 seconds.',
  ],
  shrinking_zone: [
    'The play area shrinks in stages near the end of the round.',
    'A warning announces each shrink before it happens.',
  ],
};

const ROLE_RULES: Record<string, string[]> = {
  double_agent: [
    'One hunter secretly works for the runners.',
    'The agent gets one scramble and one whisper. The role is revealed at the end.',
  ],
  vip: [
    'One runner is the VIP. Hunters only win by tagging the VIP.',
    'Tagging a bodyguard freezes them briefly instead.',
  ],
  operator: [
    'One player per team supports remotely without a location.',
    'They see the team map and can scan on a cooldown.',
  ],
};

export const BASE_MODE_RULES: Record<string, string[]> = {
  classic_chase: ['Runners reach the secret target to win. Hunters tag runners to eliminate them.'],
  tag_hunt: ['No secret target. Hunters must tag all runners before time expires.'],
  haunted_map: ['Spectral NPCs patrol the area. Evade ghosts and opponents.'],
  ghost_duel: ['Solo time trial against ghost recordings.'],
  jailbreak: [
    'Tagged runners are sent to Jail instead of elimination.',
    'Free runners can rescue all jailed teammates by holding within 10 m of the jail for 10 s.',
    'Hunters win if all runners are jailed simultaneously.',
  ],
  assassin_ring: [
    'Free-for-all circular elimination ring. Each player hunts their assigned prey.',
    'You only see radar pings of your assigned prey.',
    'A sensory warning alerts you when your unknown hunter enters within 100 m or 40 m.',
    'Tagging your prey eliminates them and passes their target to you. Last survivor wins.',
  ],
  relay_heist: [
    'Runners must escort a heavy package to extraction. Carrier pings at 1.5x frequency and cannot use items.',
    'Teammates within 5 m execute physical handoffs to keep the package moving safely.',
    'If the carrier is tagged, the package drops for any runner to recover or hunters to secure (20 s hold).',
    'Runners win on reaching extraction; hunters win on securing the package, all tagged, or timeout.',
  ],
  territory_pulse: [
    'The map is divided into 7 territory sectors (Core + 6 radial sectors).',
    'Every 90 seconds, a synchronized Territory Pulse fires.',
    'At each pulse, the team with strict player majority inside a sector captures or holds it (+1 point).',
    'Flipping an opponent sector requires presence across 2 consecutive pulses.',
    'Win by achieving territory dominance (>=70% sectors for 2 consecutive pulses) or highest score at timeout.',
  ],
};

export function parameterSummary(definition: ModifierDefinition): string {
  const entries = Object.entries(definition.parameters ?? {});
  if (entries.length === 0) return '';
  return entries.map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`).join(' · ');
}

export function rulesFor(modifiers: string[], roles: string[], modeId?: string): string[] {
  const lines: string[] = [];
  if (modeId && BASE_MODE_RULES[modeId]) lines.push(...BASE_MODE_RULES[modeId]);
  for (const id of modifiers) lines.push(...(MODIFIER_RULES[id] ?? []));
  for (const id of roles) lines.push(...(ROLE_RULES[id] ?? []));
  return lines;
}

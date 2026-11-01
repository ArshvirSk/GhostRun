/**
 * Client mirror of the server mode registry. The server (`get_mode_registry`)
 * is authoritative: it owns the compatibility matrix and the feature flags.
 * This file only supplies types, labels and plain-language rules so the lobby
 * can render the same configuration without duplicating validation.
 */

export type TeamId = 'runner' | 'hunter';

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
      compatible_modifiers: ['noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'],
      parameters: {},
      enabled: true,
    },
    {
      id: 'tag_hunt',
      layer: 'base',
      name: 'Tag Hunt',
      teams: ['runner', 'hunter'],
      min_players: 2,
      compatible_roles: ['double_agent', 'operator'],
      compatible_modifiers: ['noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'],
      parameters: {},
      enabled: true,
    },
  ],
  modifiers: [
    { id: 'noise_meter', layer: 'modifier', name: 'Noise Meter', parameters: {}, enabled: false },
    { id: 'dead_drops', layer: 'modifier', name: 'Dead Drops', parameters: {}, enabled: false },
    { id: 'hot_cold', layer: 'modifier', name: 'Hot & Cold Hunt', parameters: {}, enabled: false },
    { id: 'qr_tagging', layer: 'modifier', name: 'QR Tagging', parameters: {}, enabled: false },
    { id: 'shrinking_zone', layer: 'modifier', name: 'Shrinking Zone', parameters: {}, enabled: false },
  ],
  roles: [
    { id: 'double_agent', layer: 'role', name: 'Double Agent', enabled: false },
    { id: 'vip', layer: 'role', name: 'VIP Escort', enabled: false },
    { id: 'operator', layer: 'role', name: 'Operator', enabled: false },
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

export function parameterSummary(definition: ModifierDefinition): string {
  const entries = Object.entries(definition.parameters ?? {});
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`)
    .join(' · ');
}

export function rulesFor(modifiers: string[], roles: string[]): string[] {
  const lines: string[] = [];
  for (const id of modifiers) lines.push(...(MODIFIER_RULES[id] ?? []));
  for (const id of roles) lines.push(...(ROLE_RULES[id] ?? []));
  return lines;
}

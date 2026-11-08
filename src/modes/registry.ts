import { ModeModule } from './types';
import { classicChaseMode } from './classic_chase';
import { tagHuntMode } from './tag_hunt';
import { jailbreakMode } from './jailbreak';
import { assassinRingMode } from './assassin_ring';
import { relayHeistMode } from './relay_heist';
import { territoryPulseMode } from './territory_pulse';
import { ghostDuelMode } from './ghost_duel';
import { noiseMeterModifier } from './noise_meter';
import { deadDropsModifier } from './dead_drops';
import { hotColdModifier } from './hot_cold';
import { shrinkingZoneModifier } from './shrinking_zone';
import { aiGmModifier } from './ai_gm';
import { doubleAgentRole } from './double_agent';
import { vipRole } from './vip';
import { operatorRole } from './operator';

/**
 * Standing Client Deny List (Addendum B & UI-D2)
 *
 * Even if server feature flags or catalogue entries exist, the client registry
 * and UI will NEVER expose or register these unapproved / unverified modes:
 * - haunted_map: server NPC patrol engine (requires physical outdoor collision audit)
 * - horde: server swarm simulation (deferred to future scope)
 * - manhunt: concept marketing pitch only (no programmatic engine)
 * - qr_tagging: disabled until physical camera daylight tests pass
 */
export const CLIENT_DENY_LIST: ReadonlySet<string> = new Set([
  'haunted_map',
  'horde',
  'manhunt',
  'qr_tagging',
]);

const ALL_BASE_MODES: ModeModule[] = [
  classicChaseMode,
  tagHuntMode,
  jailbreakMode,
  assassinRingMode,
  relayHeistMode,
  territoryPulseMode,
  ghostDuelMode,
];

const ALL_MODIFIERS: ModeModule[] = [
  noiseMeterModifier,
  deadDropsModifier,
  hotColdModifier,
  shrinkingZoneModifier,
  aiGmModifier,
];

const ALL_ROLES: ModeModule[] = [
  doubleAgentRole,
  vipRole,
  operatorRole,
];

const MODULE_MAP: Map<string, ModeModule> = new Map(
  [...ALL_BASE_MODES, ...ALL_MODIFIERS, ...ALL_ROLES].map((mod) => [mod.id, mod]),
);

export function isModeDenied(id: string): boolean {
  return CLIENT_DENY_LIST.has(id);
}

export function getModeModule(id: string): ModeModule | undefined {
  if (isModeDenied(id)) return undefined;
  return MODULE_MAP.get(id);
}

export function getAllBaseModes(): ModeModule[] {
  return ALL_BASE_MODES.filter((m) => !isModeDenied(m.id));
}

export function getAllModifiers(): ModeModule[] {
  return ALL_MODIFIERS.filter((m) => !isModeDenied(m.id));
}

export function getAllRoles(): ModeModule[] {
  return ALL_ROLES.filter((m) => !isModeDenied(m.id));
}

export function getShippingRegistry(): {
  modes: ModeModule[];
  modifiers: ModeModule[];
  roles: ModeModule[];
} {
  return {
    modes: getAllBaseModes(),
    modifiers: getAllModifiers(),
    roles: getAllRoles(),
  };
}

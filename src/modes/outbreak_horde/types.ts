/**
 * GhostRun v3.0 Flagship Mode — Outbreak Horde Mode ("Zombies / Infection Swarm")
 *
 * Strictly real-world PvP (human vs. human) multiplayer infection tag:
 * 1 real human Patient Zero vs. N real human Survivors.
 * Zero AI bots, zero simulated NPC zombies.
 *
 * Core mechanics:
 * - Ticking biological infection health pool (HP as lifespan, default 300-360s at -1 HP/s)
 * - Health as tactical currency (burn life seconds to purchase Cloak, Cloak+, Haste, Decoy)
 * - Dynamic procedural zones (drifting & shrinking Antidote stations that restore +50-75 HP)
 * - Instant swarm conversion on proximity tag or biological death at 0 HP
 */

export type ZoneType = 'antidote' | 'drop_pod' | 'safe_zone';
export type ZoneLifecycle = 'static' | 'shrinking' | 'drifting' | 'shrinking_drifting';

export interface DynamicZone {
  id: string;
  type: ZoneType;
  lifecycle: ZoneLifecycle;
  latitude: number;
  longitude: number;
  radius_m: number;
  initial_radius_m: number;
  created_at: string;
  expires_at: string;
  remaining_charges: number;
  velocity_mps?: { vx: number; vy: number };
  shrink_rate_mps?: number;
}

export type AbilityType = 'cloak' | 'cloak_plus' | 'haste' | 'decoy';

export interface AbilityDef {
  type: AbilityType;
  name: string;
  costHp: number;
  durationS: number;
  description: string;
}

export const OUTBREAK_ABILITIES: Record<AbilityType, AbilityDef> = {
  cloak: {
    type: 'cloak',
    name: 'Cloak',
    costHp: 35,
    durationS: 20,
    description: 'Completely erases the Survivor from Zombie radar and proximity heatmaps for 20s.',
  },
  cloak_plus: {
    type: 'cloak_plus',
    name: 'Cloak+',
    costHp: 65,
    durationS: 30,
    description: 'Full radar invisibility for 30s + suppresses zombie proximity audio warnings and infection alerts.',
  },
  haste: {
    type: 'haste',
    name: 'Haste',
    costHp: 25,
    durationS: 15,
    description: 'Grants tactical sprint indicator and reduces tag capture distance by 50% for 15s.',
  },
  decoy: {
    type: 'decoy',
    name: 'Decoy Ping',
    costHp: 20,
    durationS: 0,
    description: 'Emits a false radar ping 80m away in a chosen quadrant to divert nearby Zombie pursuit.',
  },
};

export interface OutbreakPlayerState {
  playerId: string;
  team: 'runner' | 'zombie';
  bioHealthSeconds: number;
  maxHealthSeconds: number;
  isCloaked: boolean;
  cloakExpiresAt: number | null;
  isHasted: boolean;
  hasteExpiresAt: number | null;
  isPatientZero: boolean;
  infectionsCaused: number;
  antidotesCollected: number;
  isDistressed: boolean;
}

export interface OutbreakPresetConfig {
  initialHealthS: number;
  decayRateHpPerS: number;
  antidoteBoostHp: number;
  zoneLifecycle: ZoneLifecycle;
  driftVelocityMps: number;
  distressThresholdS: number;
  antidoteCapacity: number;
  tagRadiusM: number;
}

export const OUTBREAK_PRESETS: Record<'casual' | 'standard' | 'extreme', OutbreakPresetConfig> = {
  casual: {
    initialHealthS: 420,
    decayRateHpPerS: 1.0,
    antidoteBoostHp: 80,
    zoneLifecycle: 'static',
    driftVelocityMps: 0.0,
    distressThresholdS: 30,
    antidoteCapacity: 5,
    tagRadiusM: 15,
  },
  standard: {
    initialHealthS: 360,
    decayRateHpPerS: 1.0,
    antidoteBoostHp: 65,
    zoneLifecycle: 'shrinking',
    driftVelocityMps: 0.6,
    distressThresholdS: 60,
    antidoteCapacity: 3,
    tagRadiusM: 12,
  },
  extreme: {
    initialHealthS: 240,
    decayRateHpPerS: 1.2,
    antidoteBoostHp: 45,
    zoneLifecycle: 'shrinking_drifting',
    driftVelocityMps: 1.2,
    distressThresholdS: 90,
    antidoteCapacity: 2,
    tagRadiusM: 10,
  },
};

export interface OutbreakGameState {
  gameId: string;
  mode: 'outbreak_horde';
  phase: 'head_start' | 'active_hunt' | 'complete';
  timeRemainingSeconds: number;
  activeZones: DynamicZone[];
  players: Record<string, OutbreakPlayerState>;
  preset: OutbreakPresetConfig;
}

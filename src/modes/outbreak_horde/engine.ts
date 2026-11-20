/**
 * GhostRun v3.0 Outbreak Horde — Core Gameplay State Machine & Ability Economy
 *
 * Implements:
 * 1. Health-as-time decay loop (-1 HP/s).
 * 2. Terminal infection conversion upon reaching 0 HP.
 * 3. Health-as-currency ability purchasing (Cloak, Cloak+, Haste, Decoy).
 * 4. Human-to-human infection tag resolution with Haste evasion grace buffer.
 * 5. Distress telemetry evaluation under 60 HP.
 */

import {
  AbilityType,
  OUTBREAK_ABILITIES,
  OUTBREAK_PRESETS,
  OutbreakGameState,
  OutbreakPlayerState,
  OutbreakPresetConfig,
} from './types';
import { haversineDistanceM, LatLng } from './zoneEngine';

/**
 * Initializes a new Outbreak match state with 1 Patient Zero and N-1 Survivors.
 */
export function createInitialOutbreakState(
  gameId: string,
  playerIds: string[],
  designatedPatientZeroId?: string,
  presetConfig: OutbreakPresetConfig = OUTBREAK_PRESETS.standard
): OutbreakGameState {
  if (playerIds.length === 0) {
    throw new Error('Outbreak Horde requires at least 1 operative.');
  }

  // Select Patient Zero: designated or random
  const patientZeroId =
    designatedPatientZeroId && playerIds.includes(designatedPatientZeroId)
      ? designatedPatientZeroId
      : playerIds[Math.floor(Math.random() * playerIds.length)];

  const players: Record<string, OutbreakPlayerState> = {};

  for (const pid of playerIds) {
    const isP0 = pid === patientZeroId;
    players[pid] = {
      playerId: pid,
      team: isP0 ? 'zombie' : 'runner',
      bioHealthSeconds: isP0 ? Infinity : presetConfig.initialHealthS,
      maxHealthSeconds: presetConfig.initialHealthS,
      isCloaked: false,
      cloakExpiresAt: null,
      isHasted: false,
      hasteExpiresAt: null,
      isPatientZero: isP0,
      infectionsCaused: 0,
      antidotesCollected: 0,
      isDistressed: false,
    };
  }

  return {
    gameId,
    mode: 'outbreak_horde',
    phase: 'head_start',
    timeRemainingSeconds: presetConfig.initialHealthS,
    activeZones: [],
    players,
    preset: presetConfig,
  };
}

/**
 * Ticks biological health decay for all surviving runners.
 * Automatically converts any player to Zombie if HP reaches 0.
 */
export function tickBioHealth(
  player: OutbreakPlayerState,
  deltaS: number,
  nowMs: number = Date.now(),
  preset: OutbreakPresetConfig = OUTBREAK_PRESETS.standard
): {
  updatedPlayer: OutbreakPlayerState;
  didConvert: boolean;
  conversionReason?: 'biological_decay';
} {
  // Zombies do not decay
  if (player.team === 'zombie') {
    return { updatedPlayer: player, didConvert: false };
  }

  // Check and clear expired temporary abilities
  let isCloaked = player.isCloaked;
  let cloakExpiresAt = player.cloakExpiresAt;
  if (isCloaked && cloakExpiresAt !== null && nowMs >= cloakExpiresAt) {
    isCloaked = false;
    cloakExpiresAt = null;
  }

  let isHasted = player.isHasted;
  let hasteExpiresAt = player.hasteExpiresAt;
  if (isHasted && hasteExpiresAt !== null && nowMs >= hasteExpiresAt) {
    isHasted = false;
    hasteExpiresAt = null;
  }

  // Biological health decay
  const newHealth = Math.max(0, player.bioHealthSeconds - preset.decayRateHpPerS * deltaS);

  // Terminal infection trigger at 0 HP
  if (newHealth <= 0) {
    return {
      updatedPlayer: {
        ...player,
        team: 'zombie',
        bioHealthSeconds: 0,
        isCloaked: false,
        cloakExpiresAt: null,
        isHasted: false,
        hasteExpiresAt: null,
        isDistressed: false,
      },
      didConvert: true,
      conversionReason: 'biological_decay',
    };
  }

  const isDistressed = newHealth < preset.distressThresholdS;

  return {
    updatedPlayer: {
      ...player,
      bioHealthSeconds: newHealth,
      isCloaked,
      cloakExpiresAt,
      isHasted,
      hasteExpiresAt,
      isDistressed,
    },
    didConvert: false,
  };
}

/**
 * Purchases a tactical survival ability using biological health as currency.
 */
export function activateAbility(
  player: OutbreakPlayerState,
  abilityType: AbilityType,
  nowMs: number = Date.now()
): {
  success: boolean;
  updatedPlayer: OutbreakPlayerState;
  reason?: string;
} {
  if (player.team !== 'runner') {
    return {
      success: false,
      updatedPlayer: player,
      reason: 'Only living survivors can activate tactical bio-abilities.',
    };
  }

  const ability = OUTBREAK_ABILITIES[abilityType];
  if (!ability) {
    return {
      success: false,
      updatedPlayer: player,
      reason: `Unknown ability "${abilityType}".`,
    };
  }

  if (player.bioHealthSeconds <= ability.costHp) {
    return {
      success: false,
      updatedPlayer: player,
      reason: `Insufficient bio-health (${Math.round(player.bioHealthSeconds)}s < ${ability.costHp}s cost).`,
    };
  }

  const newHealth = player.bioHealthSeconds - ability.costHp;
  const expiresAt = nowMs + ability.durationS * 1000;

  let isCloaked = player.isCloaked;
  let cloakExpiresAt = player.cloakExpiresAt;
  let isHasted = player.isHasted;
  let hasteExpiresAt = player.hasteExpiresAt;

  if (abilityType === 'cloak' || abilityType === 'cloak_plus') {
    isCloaked = true;
    cloakExpiresAt = expiresAt;
  } else if (abilityType === 'haste') {
    isHasted = true;
    hasteExpiresAt = expiresAt;
  }

  return {
    success: true,
    updatedPlayer: {
      ...player,
      bioHealthSeconds: newHealth,
      isCloaked,
      cloakExpiresAt,
      isHasted,
      hasteExpiresAt,
    },
  };
}

/**
 * Resolves an infection tag attempt by a Zombie against a Survivor.
 * Applies Haste evasion buffer (+50% tag evasion = 50% reduced capture radius).
 */
export function attemptInfectionTag(
  zombie: OutbreakPlayerState,
  runner: OutbreakPlayerState,
  zombieCoord: LatLng,
  runnerCoord: LatLng,
  baseTagRadiusM: number = 12
): {
  success: boolean;
  updatedZombie: OutbreakPlayerState;
  updatedRunner: OutbreakPlayerState;
  distanceM: number;
  reason?: string;
} {
  if (zombie.team !== 'zombie') {
    return {
      success: false,
      updatedZombie: zombie,
      updatedRunner: runner,
      distanceM: 0,
      reason: 'Attacking player is not on the Zombie team.',
    };
  }

  if (runner.team !== 'runner') {
    return {
      success: false,
      updatedZombie: zombie,
      updatedRunner: runner,
      distanceM: 0,
      reason: 'Target is already infected.',
    };
  }

  const distanceM = haversineDistanceM(zombieCoord, runnerCoord);

  // Evasion Buffer: Hasted runners are 50% harder to tag (cut tag distance threshold in half)
  const effectiveTagRadiusM = runner.isHasted ? baseTagRadiusM * 0.5 : baseTagRadiusM;

  if (distanceM > effectiveTagRadiusM) {
    return {
      success: false,
      updatedZombie: zombie,
      updatedRunner: runner,
      distanceM,
      reason: runner.isHasted
        ? `Target is HASTED: evasion grace buffer active (${Math.round(distanceM)}m > ${effectiveTagRadiusM}m).`
        : `Target out of range (${Math.round(distanceM)}m > ${effectiveTagRadiusM}m).`,
    };
  }

  // Tag successful: Runner converts to Zombie
  return {
    success: true,
    updatedZombie: {
      ...zombie,
      infectionsCaused: zombie.infectionsCaused + 1,
    },
    updatedRunner: {
      ...runner,
      team: 'zombie',
      bioHealthSeconds: 0,
      isCloaked: false,
      cloakExpiresAt: null,
      isHasted: false,
      hasteExpiresAt: null,
      isDistressed: false,
    },
    distanceM,
  };
}

/**
 * Checks match completion status.
 */
export function evaluateMatchStatus(
  gameState: OutbreakGameState
): {
  isGameOver: boolean;
  winner?: 'zombies' | 'survivors';
  survivorsRemaining: number;
} {
  const allPlayers = Object.values(gameState.players);
  const survivors = allPlayers.filter((p) => p.team === 'runner');

  if (survivors.length === 0) {
    return {
      isGameOver: true,
      winner: 'zombies',
      survivorsRemaining: 0,
    };
  }

  if (gameState.timeRemainingSeconds <= 0) {
    return {
      isGameOver: true,
      winner: 'survivors',
      survivorsRemaining: survivors.length,
    };
  }

  return {
    isGameOver: false,
    survivorsRemaining: survivors.length,
  };
}

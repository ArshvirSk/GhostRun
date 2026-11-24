/**
 * GhostRun Arena & Duration Compatibility Engine
 *
 * Evaluates whether an arena radius and match duration provide
 * realistic pedestrian stealth gameplay pacing.
 */

export const MIN_PLAYABLE_RADIUS_M = 100;
export const MAX_PLAYABLE_RADIUS_M = 2000;
export const MIN_PLAYABLE_DURATION_MIN = 3;
export const MAX_PLAYABLE_DURATION_MIN = 60;

export interface AreaCompatibilityResult {
  isCompatible: boolean;
  status: 'optimal' | 'too_large' | 'too_cramped';
  badgeLabel: string;
  detail: string;
  requiredSpeedMps: number;
}

export type TacticalPacing = 'fast' | 'balanced' | 'endurance';

export interface PacingProfile {
  paceCategory: 'leisure_walk' | 'brisk_walk' | 'tactical_jog' | 'unsustainable_sprint';
  speedKmh: number;
  speedMps: number;
}

/**
 * Calculates pedestrian traversal feasibility.
 *
 * @param radiusM Arena radius in meters (diameter is 2 * radiusM)
 * @param durationMinutes Total match duration in minutes
 * @returns AreaCompatibilityResult
 */
export function evaluateAreaCompatibility(
  radiusM: number,
  durationMinutes: number
): AreaCompatibilityResult {
  const safeRadius = Math.max(50, radiusM || 500);
  const safeDurationMin = Math.max(1, durationMinutes || 15);
  const durationSec = safeDurationMin * 60;

  // Traversal across diameter
  const diameterM = safeRadius * 2;
  const requiredSpeedMps = diameterM / durationSec;

  // Walking: ~1.2 m/s (4.3 km/h)
  // Sustained jogging/stealth: ~2.0 - 3.2 m/s (7 - 11.5 km/h)
  // Sprint sprint cutoff: > 3.8 m/s (> 13.7 km/h is unrealistic for pedestrian stealth)
  if (requiredSpeedMps > 3.8) {
    return {
      isCompatible: false,
      status: 'too_large',
      badgeLabel: 'ARENA TOO LARGE FOR DURATION',
      detail: `Traversing ${Math.round(diameterM)}m in ${safeDurationMin}m requires >${(requiredSpeedMps * 3.6).toFixed(1)} km/h. Increase duration or shrink arena radius.`,
      requiredSpeedMps,
    };
  }

  // Too cramped: diameter < 100m for games over 20 mins
  if (requiredSpeedMps < 0.25 && safeRadius < 150 && safeDurationMin >= 20) {
    return {
      isCompatible: false,
      status: 'too_cramped',
      badgeLabel: 'ARENA CRAMPED FOR LONG MATCH',
      detail: `A ${Math.round(safeRadius)}m radius for ${safeDurationMin}m provides minimal territory to evade hunters. Expand radius for better stealth.`,
      requiredSpeedMps,
    };
  }

  return {
    isCompatible: true,
    status: 'optimal',
    badgeLabel: 'TACTICAL SCALE COMPATIBLE',
    detail: `Realistic operational territory: ${(requiredSpeedMps * 3.6).toFixed(1)} km/h average traversal pace.`,
    requiredSpeedMps,
  };
}

/**
 * Estimates the pacing classification for a given radius and duration.
 */
export function estimatePacingProfile(
  radiusM: number,
  durationMinutes: number
): PacingProfile {
  const safeRadius = Math.max(50, radiusM || 500);
  const safeDurationMin = Math.max(1, durationMinutes || 15);
  const durationSec = safeDurationMin * 60;
  const diameterM = safeRadius * 2;
  const speedMps = diameterM / durationSec;
  const speedKmh = Math.round(speedMps * 3.6 * 10) / 10;

  let paceCategory: PacingProfile['paceCategory'] = 'brisk_walk';
  if (speedMps > 3.8) {
    paceCategory = 'unsustainable_sprint';
  } else if (speedMps >= 2.0) {
    paceCategory = 'tactical_jog';
  } else if (speedMps >= 1.0) {
    paceCategory = 'brisk_walk';
  } else {
    paceCategory = 'leisure_walk';
  }

  return { paceCategory, speedKmh, speedMps };
}

/**
 * Computes recommended match duration given arena radius.
 */
export function computeRecommendedDurationMinutes(
  radiusM: number,
  pacing: TacticalPacing = 'balanced'
): number {
  const safeRadius = Math.max(MIN_PLAYABLE_RADIUS_M, Math.min(MAX_PLAYABLE_RADIUS_M, radiusM));
  const diameterM = safeRadius * 2;

  // Target speeds: fast = 2.5 m/s, balanced = 1.5 m/s, endurance = 0.8 m/s
  const targetSpeedMps = pacing === 'fast' ? 2.5 : pacing === 'endurance' ? 0.8 : 1.5;
  const recommendedSec = diameterM / targetSpeedMps;
  const minutes = Math.round(recommendedSec / 60);

  return Math.max(MIN_PLAYABLE_DURATION_MIN, Math.min(MAX_PLAYABLE_DURATION_MIN, minutes));
}

/**
 * Computes recommended arena radius given match duration.
 */
export function computeRecommendedRadiusM(
  durationMinutes: number,
  pacing: TacticalPacing = 'balanced'
): number {
  const safeDurationMin = Math.max(MIN_PLAYABLE_DURATION_MIN, Math.min(MAX_PLAYABLE_DURATION_MIN, durationMinutes));
  const durationSec = safeDurationMin * 60;

  const targetSpeedMps = pacing === 'fast' ? 2.5 : pacing === 'endurance' ? 0.8 : 1.5;
  const recommendedDiameterM = durationSec * targetSpeedMps;
  const radiusM = Math.round(recommendedDiameterM / 2 / 25) * 25; // snap to 25m increments

  return Math.max(MIN_PLAYABLE_RADIUS_M, Math.min(MAX_PLAYABLE_RADIUS_M, radiusM));
}

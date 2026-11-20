/**
 * GhostRun Arena & Duration Compatibility Engine
 *
 * Evaluates whether an arena radius and match duration provide
 * realistic pedestrian stealth gameplay pacing.
 */

export interface AreaCompatibilityResult {
  isCompatible: boolean;
  status: 'optimal' | 'too_large' | 'too_cramped';
  badgeLabel: string;
  detail: string;
  requiredSpeedMps: number;
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
    badgeLabel: 'ARENA & DURATION COMPATIBLE',
    detail: `Optimal ${Math.round(safeRadius)}m perimeter allows balanced evasion and intercept pacing over ${safeDurationMin} minutes.`,
    requiredSpeedMps,
  };
}

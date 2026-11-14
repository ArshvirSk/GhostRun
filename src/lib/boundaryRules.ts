import { distanceM, type LngLat } from './geo';

/**
 * NF-09: Boundary Rule Options Evaluator
 *
 * Evaluates operational boundary status, drift buffers, GPS accuracy gating,
 * periodic live reveal pings, and auto-tag elimination thresholds.
 */

export type BoundaryPenalty = 'warn' | 'extra_ping' | 'reveal_live' | 'auto_tag';

export const DRIFT_BUFFER_METERS = 5;
export const MAX_ACCURACY_THRESHOLD_M = 35;
export const LIVE_REVEAL_PING_INTERVAL_MS = 5000;
export const AUTO_TAG_THRESHOLD_SECONDS = 120;

export interface BoundaryEvaluation {
  isOutOfBounds: boolean;
  distanceFromCenterM: number;
  areaRadiusM: number;
  secondsOutside: number;
  graceRemainingS: number;
  penaltyState: 'none' | 'warning' | 'live_reveal_active' | 'auto_tagged' | 'penalty_pending';
  shouldEmitLivePing: boolean;
  shouldAutoTag: boolean;
  isAccuracyGated: boolean;
}

export interface EvaluateBoundaryParams {
  playerPos: { latitude: number; longitude: number; accuracy?: number | null };
  areaCenter: LngLat;
  areaRadiusM: number;
  boundaryPenalty: BoundaryPenalty;
  boundaryGraceS?: number;
  outOfBoundsSince: number | null;
  lastLivePingAt?: number | null;
  now?: number;
}

export function evaluateBoundaryState({
  playerPos,
  areaCenter,
  areaRadiusM,
  boundaryPenalty,
  boundaryGraceS = 30,
  outOfBoundsSince,
  lastLivePingAt,
  now = Date.now(),
}: EvaluateBoundaryParams): BoundaryEvaluation {
  const playerLngLat: LngLat = {
    latitude: playerPos.latitude,
    longitude: playerPos.longitude,
  };

  const dist = distanceM(playerLngLat, areaCenter);
  const accuracy = typeof playerPos.accuracy === 'number' ? playerPos.accuracy : 0;
  const isAccuracyGated = accuracy > MAX_ACCURACY_THRESHOLD_M;

  // If GPS accuracy is poor, require distance to exceed radius + drift buffer + accuracy
  const effectiveBuffer = isAccuracyGated
    ? DRIFT_BUFFER_METERS + accuracy * 0.5
    : DRIFT_BUFFER_METERS;

  const isOutOfBounds = dist > areaRadiusM + effectiveBuffer;

  if (!isOutOfBounds) {
    return {
      isOutOfBounds: false,
      distanceFromCenterM: Math.round(dist),
      areaRadiusM,
      secondsOutside: 0,
      graceRemainingS: boundaryGraceS,
      penaltyState: 'none',
      shouldEmitLivePing: false,
      shouldAutoTag: false,
      isAccuracyGated,
    };
  }

  const effectiveSince = outOfBoundsSince ?? now;
  const elapsedMs = Math.max(0, now - effectiveSince);
  const secondsOutside = Math.floor(elapsedMs / 1000);
  const graceRemainingS = Math.max(0, boundaryGraceS - secondsOutside);

  let penaltyState: BoundaryEvaluation['penaltyState'] = 'warning';
  let shouldEmitLivePing = false;
  let shouldAutoTag = false;

  if (boundaryPenalty === 'auto_tag') {
    if (secondsOutside >= AUTO_TAG_THRESHOLD_SECONDS) {
      penaltyState = 'auto_tagged';
      shouldAutoTag = true;
    } else if (graceRemainingS === 0) {
      penaltyState = 'penalty_pending';
    }
  } else if (boundaryPenalty === 'reveal_live') {
    if (graceRemainingS === 0) {
      penaltyState = 'live_reveal_active';
      const timeSinceLastPing = lastLivePingAt ? now - lastLivePingAt : Infinity;
      if (timeSinceLastPing >= LIVE_REVEAL_PING_INTERVAL_MS) {
        shouldEmitLivePing = true;
      }
    }
  } else if (boundaryPenalty === 'extra_ping') {
    if (graceRemainingS === 0) {
      penaltyState = 'penalty_pending';
    }
  }

  return {
    isOutOfBounds: true,
    distanceFromCenterM: Math.round(dist),
    areaRadiusM,
    secondsOutside,
    graceRemainingS,
    penaltyState,
    shouldEmitLivePing,
    shouldAutoTag,
    isAccuracyGated,
  };
}

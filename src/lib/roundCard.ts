import { distanceM, type LngLat } from './geo';

/**
 * NF-10: Shareable Round Card & Route Privacy Engine
 *
 * Enforces strict privacy rules before route data can be exported or shared:
 * 1. Trims the initial 150m (start/home origin) and final 150m (finish destination).
 * 2. Downsamples or strips route if total length is insufficient.
 * 3. Enforces consent C3: route is excluded if share_trail is false.
 * 4. Formats tactical scorecard text and metrics.
 */

export const PRIVACY_TRIM_METERS = 150;
export const MIN_SHAREABLE_DISTANCE_METERS = 350;

export interface RoundCardMetrics {
  modeName: string;
  outcome: 'victorious' | 'completed' | 'tagged' | 'evaded';
  durationSeconds: number;
  distanceMeters: number;
  topSpeedKmh?: number;
  role: string;
  date: string;
  shareTrailConsent: boolean;
}

export interface TrailEligibility {
  eligible: boolean;
  reason: 'consent_denied' | 'insufficient_points' | 'insufficient_distance' | 'ok';
}

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface PrivacyAuditSummary {
  totalDistanceM: number;
  trimmedDistanceM: number;
  privacyBufferM: number;
  isRedacted: boolean;
  reason: string;
}

/**
 * Checks whether a route path qualifies for sharing given user consent and total distance.
 */
export function isTrailEligibleForSharing(
  path: LngLat[] | undefined | null,
  shareTrailConsent: boolean
): TrailEligibility {
  if (!shareTrailConsent) {
    return { eligible: false, reason: 'consent_denied' };
  }
  if (!path || path.length < 2) {
    return { eligible: false, reason: 'insufficient_points' };
  }

  let totalDist = 0;
  for (let i = 1; i < path.length; i++) {
    totalDist += distanceM(path[i - 1], path[i]);
  }

  if (totalDist < MIN_SHAREABLE_DISTANCE_METERS) {
    return { eligible: false, reason: 'insufficient_distance' };
  }

  return { eligible: true, reason: 'ok' };
}

/**
 * Computes tight latitude/longitude bounding box for a path.
 */
export function calculateTrailGeoBounds(path: LngLat[]): GeoBounds | null {
  if (!path || path.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const pt of path) {
    if (pt.latitude < minLat) minLat = pt.latitude;
    if (pt.latitude > maxLat) maxLat = pt.latitude;
    if (pt.longitude < minLng) minLng = pt.longitude;
    if (pt.longitude > maxLng) maxLng = pt.longitude;
  }

  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Trims the first and last `trimMeters` from a route path based on cumulative distance.
 */
export function trimTrailPrivacy(
  path: LngLat[],
  trimMeters = PRIVACY_TRIM_METERS
): { trimmedPath: LngLat[]; originalDistanceM: number; trimmedDistanceM: number } {
  if (!path || path.length < 2) {
    return { trimmedPath: [], originalDistanceM: 0, trimmedDistanceM: 0 };
  }

  // Calculate cumulative distances
  const cumDistances: number[] = [0];
  let totalDist = 0;

  for (let i = 1; i < path.length; i++) {
    const d = distanceM(path[i - 1], path[i]);
    totalDist += d;
    cumDistances.push(totalDist);
  }

  // If total distance is too short, return empty path to prevent pinpointing origin/destination
  if (totalDist < MIN_SHAREABLE_DISTANCE_METERS) {
    return {
      trimmedPath: [],
      originalDistanceM: Math.round(totalDist),
      trimmedDistanceM: 0,
    };
  }

  const startCutoff = trimMeters;
  const endCutoff = totalDist - trimMeters;

  const trimmed: LngLat[] = [];

  for (let i = 0; i < path.length; i++) {
    const d = cumDistances[i];
    if (d >= startCutoff && d <= endCutoff) {
      trimmed.push(path[i]);
    }
  }

  return {
    trimmedPath: trimmed,
    originalDistanceM: Math.round(totalDist),
    trimmedDistanceM: Math.round(Math.max(0, endCutoff - startCutoff)),
  };
}

/**
 * Generates an executive privacy report for UI inspection.
 */
export function generatePrivacyAuditSummary(
  path: LngLat[],
  shareTrailConsent: boolean,
  trimMeters: number = PRIVACY_TRIM_METERS
): PrivacyAuditSummary {
  const eligibility = isTrailEligibleForSharing(path, shareTrailConsent);
  if (!eligibility.eligible) {
    const trimmed = trimTrailPrivacy(path, trimMeters);
    return {
      totalDistanceM: trimmed.originalDistanceM,
      trimmedDistanceM: 0,
      privacyBufferM: trimMeters,
      isRedacted: true,
      reason:
        eligibility.reason === 'consent_denied'
          ? 'Player withheld trail sharing consent (Confidential)'
          : 'Total route length under 350m threshold (Redacted to prevent address inference)',
    };
  }

  const result = trimTrailPrivacy(path, trimMeters);
  return {
    totalDistanceM: result.originalDistanceM,
    trimmedDistanceM: result.trimmedDistanceM,
    privacyBufferM: trimMeters,
    isRedacted: false,
    reason: `Initial and terminal ${trimMeters}m buffers trimmed for home/destination privacy`,
  };
}

/**
 * Generates the shareable summary copy for system share sheet or clipboard.
 */
export function formatRoundCardShareText(metrics: RoundCardMetrics): string {
  const durationMin = Math.floor(metrics.durationSeconds / 60);
  const durationSec = metrics.durationSeconds % 60;
  const timeStr = `${durationMin}:${durationSec.toString().padStart(2, '0')}`;
  const distKm = (metrics.distanceMeters / 1000).toFixed(1);

  const lines = [
    `GhostRun Mission Recap — ${metrics.modeName}`,
    `Outcome: ${metrics.outcome.toUpperCase()}`,
    `Role: ${metrics.role.toUpperCase()}`,
    `Distance: ${distKm} km | Time: ${timeStr}`,
  ];

  if (typeof metrics.topSpeedKmh === 'number' && metrics.topSpeedKmh > 0) {
    lines.push(`Top Speed: ${metrics.topSpeedKmh.toFixed(1)} km/h`);
  }

  if (metrics.shareTrailConsent) {
    lines.push('Route: Privacy-trimmed (150m buffer)');
  } else {
    lines.push('Route: Confidential');
  }

  lines.push('');
  lines.push('Play real-world tactical GPS tag: https://ghostrun.app');

  return lines.join('\n');
}

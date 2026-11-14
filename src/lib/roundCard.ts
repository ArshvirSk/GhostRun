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
 * Generates the shareable summary copy for system share sheet or clipboard.
 */
export function formatRoundCardShareText(metrics: RoundCardMetrics): string {
  const durationMin = Math.floor(metrics.durationSeconds / 60);
  const durationSec = metrics.durationSeconds % 60;
  const timeStr = `${durationMin}:${durationSec.toString().padStart(2, '0')}`;
  const distKm = (metrics.distanceMeters / 1000).toFixed(1);

  const lines = [
    `👻 GhostRun Mission Recap — ${metrics.modeName}`,
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

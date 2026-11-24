/**
 * GhostRun Tactical Replay Kinematics Core
 *
 * Provides headless, mathematically pure trajectory interpolation,
 * instantaneous operative velocity vector projection, 16-point compass
 * heading evaluation, and tactical match climax event collation.
 */

import { distanceM, bearingDeg, projectPoint, type LngLat } from './geo';

export interface RawTrailPoint {
  player_id: string;
  longitude: number;
  latitude: number;
  recorded_at: string;
}

export interface InterpolatedOperative {
  playerId: string;
  displayName: string;
  team: 'runner' | 'hunter' | 'unassigned';
  color: string;
  longitude: number;
  latitude: number;
  headingDeg: number;
  speedMps: number;
  isTagged: boolean;
  isInterpolated: boolean;
}

export interface VelocityVector {
  playerId: string;
  color: string;
  origin: LngLat;
  tip: LngLat;
  lengthM: number;
  speedMps: number;
  headingDeg: number;
}

export interface ReplayClimax {
  id: string;
  kind: 'tag' | 'extraction' | 'package_drop' | 'jail_breakout' | 'ping';
  atSecond: number;
  title: string;
  subtitle: string;
  longitude: number;
  latitude: number;
  color: string;
  severity: 'critical' | 'alert' | 'info';
}

const COMPASS_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

/**
 * Returns a 16-point cardinal compass string for any azimuth heading (0-360 deg).
 * e.g. 42 deg -> "NE (042°)"
 */
export function formatCompassHeading(headingDeg: number): string {
  const normalized = ((headingDeg % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  const cardinal = COMPASS_POINTS[index];
  const paddedDeg = String(Math.round(normalized)).padStart(3, '0');
  return `${cardinal} (${paddedDeg}°)`;
}

/**
 * Formats speed in m/s and km/h with tactical threshold labeling.
 */
export function formatTacticalSpeed(speedMps: number): string {
  if (speedMps < 0.4) {
    return 'STATIONARY';
  }
  const kmh = (speedMps * 3.6).toFixed(1);
  return `${speedMps.toFixed(1)} m/s (${kmh} km/h)`;
}

/**
 * Smoothly interpolates an operative's position along their recorded GPS trail
 * at an exact millisecond timestamp. Computes instantaneous speed and heading.
 */
export function interpolatePlayerPosition(
  points: RawTrailPoint[],
  cursorMs: number,
  fallbackPosition?: LngLat | null
): {
  longitude: number;
  latitude: number;
  headingDeg: number;
  speedMps: number;
  isInterpolated: boolean;
} | null {
  if (!points || points.length === 0) {
    if (!fallbackPosition) return null;
    return {
      longitude: fallbackPosition.longitude,
      latitude: fallbackPosition.latitude,
      headingDeg: 0,
      speedMps: 0,
      isInterpolated: false,
    };
  }

  // Parse timestamps
  const timestamps = points.map((p) => Date.parse(p.recorded_at));

  // Case 1: Cursor before or at first point
  if (cursorMs <= timestamps[0]) {
    const p0 = points[0];
    let heading = 0;
    if (points.length > 1) {
      heading = bearingDeg(
        { longitude: p0.longitude, latitude: p0.latitude },
        { longitude: points[1].longitude, latitude: points[1].latitude }
      );
    }
    return {
      longitude: p0.longitude,
      latitude: p0.latitude,
      headingDeg: heading,
      speedMps: 0,
      isInterpolated: false,
    };
  }

  // Case 2: Cursor after or at last point
  const lastIdx = points.length - 1;
  if (cursorMs >= timestamps[lastIdx]) {
    const pLast = points[lastIdx];
    let heading = 0;
    if (points.length > 1) {
      heading = bearingDeg(
        { longitude: points[lastIdx - 1].longitude, latitude: points[lastIdx - 1].latitude },
        { longitude: pLast.longitude, latitude: pLast.latitude }
      );
    }
    return {
      longitude: pLast.longitude,
      latitude: pLast.latitude,
      headingDeg: heading,
      speedMps: 0,
      isInterpolated: false,
    };
  }

  // Case 3: Cursor strictly between two recorded GPS fixes -> Linear Interpolation
  for (let i = 0; i < lastIdx; i++) {
    const t0 = timestamps[i];
    const t1 = timestamps[i + 1];

    if (cursorMs >= t0 && cursorMs <= t1) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const dtMs = t1 - t0;

      if (dtMs <= 0) {
        return {
          longitude: p0.longitude,
          latitude: p0.latitude,
          headingDeg: 0,
          speedMps: 0,
          isInterpolated: false,
        };
      }

      const fraction = (cursorMs - t0) / dtMs;
      const interpLng = p0.longitude + (p1.longitude - p0.longitude) * fraction;
      const interpLat = p0.latitude + (p1.latitude - p0.latitude) * fraction;

      const p0LngLat: LngLat = { longitude: p0.longitude, latitude: p0.latitude };
      const p1LngLat: LngLat = { longitude: p1.longitude, latitude: p1.latitude };

      const heading = bearingDeg(p0LngLat, p1LngLat);
      const distM = distanceM(p0LngLat, p1LngLat);
      const speedMps = distM / (dtMs / 1000);

      return {
        longitude: interpLng,
        latitude: interpLat,
        headingDeg: heading,
        speedMps: Math.round(speedMps * 100) / 100,
        isInterpolated: true,
      };
    }
  }

  // Fallback to last point
  const last = points[lastIdx];
  return {
    longitude: last.longitude,
    latitude: last.latitude,
    headingDeg: 0,
    speedMps: 0,
    isInterpolated: false,
  };
}

/**
 * Builds a dynamic tactical velocity vector extending forward from an operative's
 * coordinates along their instantaneous heading. Length scales linearly with speed.
 */
export function buildVelocityVector(
  operative: {
    playerId: string;
    color: string;
    longitude: number;
    latitude: number;
    headingDeg: number;
    speedMps: number;
    isTagged: boolean;
  },
  minSpeedMps: number = 0.7,
  maxVectorLenM: number = 22.0
): VelocityVector | null {
  if (operative.isTagged || operative.speedMps < minSpeedMps) {
    return null; // Stationary or eliminated operatives display no velocity vector
  }

  // Vector length: 6m base + 2.2m per m/s of speed, capped at maxVectorLenM
  const vectorLengthM = Math.min(maxVectorLenM, Math.max(6.0, operative.speedMps * 2.2));
  const origin: LngLat = { longitude: operative.longitude, latitude: operative.latitude };
  const tip = projectPoint(origin, vectorLengthM, operative.headingDeg);

  return {
    playerId: operative.playerId,
    color: operative.color,
    origin,
    tip,
    lengthM: Math.round(vectorLengthM * 10) / 10,
    speedMps: operative.speedMps,
    headingDeg: operative.headingDeg,
  };
}

/**
 * Generates GeoJSON LineString and Point feature collections for tactical velocity vectors.
 */
export function buildVelocityVectorFeatures(vectors: VelocityVector[]): {
  lines: {
    type: 'Feature';
    properties: { color: string; playerId: string; speedMps: number; headingDeg: number };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }[];
  tips: {
    type: 'Feature';
    properties: { color: string; playerId: string; speedMps: number };
    geometry: { type: 'Point'; coordinates: [number, number] };
  }[];
} {
  const lines: {
    type: 'Feature';
    properties: { color: string; playerId: string; speedMps: number; headingDeg: number };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }[] = [];

  const tips: {
    type: 'Feature';
    properties: { color: string; playerId: string; speedMps: number };
    geometry: { type: 'Point'; coordinates: [number, number] };
  }[] = [];

  for (const v of vectors) {
    lines.push({
      type: 'Feature',
      properties: {
        color: v.color,
        playerId: v.playerId,
        speedMps: v.speedMps,
        headingDeg: v.headingDeg,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [v.origin.longitude, v.origin.latitude],
          [v.tip.longitude, v.tip.latitude],
        ],
      },
    });

    tips.push({
      type: 'Feature',
      properties: {
        color: v.color,
        playerId: v.playerId,
        speedMps: v.speedMps,
      },
      geometry: {
        type: 'Point',
        coordinates: [v.tip.longitude, v.tip.latitude],
      },
    });
  }

  return { lines, tips };
}

/**
 * Extracts and sorts all match climax events (tags, extractions, pickups)
 * with coordinates and relative timeline seconds.
 */
export function extractReplayClimaxes(params: {
  liveAtMs: number;
  durationS: number;
  tags?: {
    id: number;
    hunter_name: string;
    runner_name: string;
    distance_m: number;
    tagged_at: string;
  }[];
  tagCoords?: Map<number, LngLat>;
  target?: LngLat | null;
  winner?: string | null;
  endReason?: string | null;
}): ReplayClimax[] {
  const { liveAtMs, durationS, tags = [], tagCoords = new Map(), target, winner, endReason } = params;
  const climaxes: ReplayClimax[] = [];

  if (Number.isNaN(liveAtMs) || durationS <= 0) return climaxes;

  // 1. Tag Climax Events
  for (const tag of tags) {
    const tagMs = Date.parse(tag.tagged_at);
    if (Number.isNaN(tagMs)) continue;
    const atSec = Math.max(0, Math.min(durationS, (tagMs - liveAtMs) / 1000));
    const coord = tagCoords.get(tag.id) || { longitude: 0, latitude: 0 };

    climaxes.push({
      id: `tag-${tag.id}`,
      kind: 'tag',
      atSecond: Math.round(atSec * 10) / 10,
      title: `${tag.hunter_name} tagged ${tag.runner_name}`,
      subtitle: `${Math.round(tag.distance_m)}m tag interception`,
      longitude: coord.longitude,
      latitude: coord.latitude,
      color: '#EF4444',
      severity: 'critical',
    });
  }

  // 2. Extraction Climax Event (if runners won via extraction)
  if (winner === 'runners' && (endReason === 'target_reached' || endReason === 'extraction_complete') && target) {
    climaxes.push({
      id: 'extraction-victory',
      kind: 'extraction',
      atSecond: durationS,
      title: 'Runners Extraction Secured',
      subtitle: 'Target reached before hunter interception',
      longitude: target.longitude,
      latitude: target.latitude,
      color: '#00F0FF',
      severity: 'critical',
    });
  }

  return climaxes.sort((a, b) => a.atSecond - b.atSecond);
}

/**
 * Finds the nearest climax event within a tolerance window (default 4 seconds).
 */
export function findNearestClimaxEvent(
  climaxes: ReplayClimax[],
  cursorS: number,
  maxToleranceS: number = 4.0
): ReplayClimax | null {
  let nearest: ReplayClimax | null = null;
  let minDelta = Infinity;

  for (const climax of climaxes) {
    const delta = Math.abs(climax.atSecond - cursorS);
    if (delta <= maxToleranceS && delta < minDelta) {
      minDelta = delta;
      nearest = climax;
    }
  }

  return nearest;
}

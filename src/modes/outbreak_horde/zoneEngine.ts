/**
 * GhostRun v3.0 Outbreak Horde — Procedural Dynamic Zone & Drift Physics Engine
 *
 * Handles:
 * 1. Procedural generation of Antidote stations and Drop Pods within the geofenced arena.
 * 2. Real-time 2D drifting physics with circular boundary collision and specular reflection.
 * 3. Dynamic shrinking radius decay over zone lifecycles.
 * 4. Antidote capture detection and charge consumption.
 */

import { DynamicZone, OutbreakPresetConfig, ZoneLifecycle, ZoneType } from './types';

const EARTH_RADIUS_METERS = 6371000;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Calculates great-circle distance between two coordinates in meters.
 */
export function haversineDistanceM(from: LatLng, to: LatLng): number {
  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Converts a meter displacement (dx, dy) to coordinate delta (dLat, dLng).
 */
export function metersToCoordDelta(
  metersX: number,
  metersY: number,
  latitude: number
): { dLat: number; dLng: number } {
  const dLat = (metersY / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const dLng =
    (metersX / (EARTH_RADIUS_METERS * Math.cos((latitude * Math.PI) / 180))) * (180 / Math.PI);
  return { dLat, dLng };
}

/**
 * Converts coordinate delta (dLat, dLng) to meters (dx, dy).
 */
export function coordDeltaToMeters(
  from: LatLng,
  to: LatLng
): { dx: number; dy: number } {
  const dLatRad = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLngRad = ((to.longitude - from.longitude) * Math.PI) / 180;
  const dy = dLatRad * EARTH_RADIUS_METERS;
  const dx = dLngRad * EARTH_RADIUS_METERS * Math.cos((from.latitude * Math.PI) / 180);
  return { dx, dy };
}

/**
 * Generates procedural Antidote and Drop Pod zones inside the arena boundary.
 */
export function generateProceduralZones(
  center: LatLng,
  arenaRadiusM: number,
  count: number = 3,
  preset: OutbreakPresetConfig,
  nowMs: number = Date.now()
): DynamicZone[] {
  const zones: DynamicZone[] = [];

  for (let i = 0; i < count; i++) {
    // Generate random point within 20% to 80% of arena radius to avoid immediate wall sticking
    const r = (0.2 + 0.6 * Math.random()) * arenaRadiusM;
    const angle = (2 * Math.PI * i) / count + (Math.random() - 0.5) * 0.5;

    const offsetX = r * Math.cos(angle);
    const offsetY = r * Math.sin(angle);
    const { dLat, dLng } = metersToCoordDelta(offsetX, offsetY, center.latitude);

    const type: ZoneType = i === 0 ? 'antidote' : i % 2 === 0 ? 'drop_pod' : 'antidote';
    const initialRadius = type === 'antidote' ? 25 : 18;
    const durationS = preset.zoneLifecycle === 'static' ? 120 : 90;

    // Initial drift velocity vector in meters per second
    let velocity_mps: { vx: number; vy: number } | undefined;
    if (preset.driftVelocityMps > 0) {
      const vAngle = Math.random() * 2 * Math.PI;
      velocity_mps = {
        vx: preset.driftVelocityMps * Math.cos(vAngle),
        vy: preset.driftVelocityMps * Math.sin(vAngle),
      };
    }

    // Shrink rate: reaches 0 at expiration
    const shrinkRate =
      preset.zoneLifecycle === 'shrinking' || preset.zoneLifecycle === 'shrinking_drifting'
        ? initialRadius / durationS
        : 0;

    zones.push({
      id: `zone_${nowMs}_${i + 1}`,
      type,
      lifecycle: preset.zoneLifecycle,
      latitude: center.latitude + dLat,
      longitude: center.longitude + dLng,
      radius_m: initialRadius,
      initial_radius_m: initialRadius,
      created_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + durationS * 1000).toISOString(),
      remaining_charges: preset.antidoteCapacity,
      velocity_mps,
      shrink_rate_mps: shrinkRate,
    });
  }

  return zones;
}

/**
 * Updates dynamic zone position, boundary reflection, and shrinking radius.
 */
export function updateZonePhysics(
  zone: DynamicZone,
  arenaCenter: LatLng,
  arenaRadiusM: number,
  deltaS: number,
  nowMs: number = Date.now()
): { updatedZone: DynamicZone; isDepleted: boolean } {
  let { latitude, longitude, radius_m, velocity_mps } = zone;

  // 1. Shrinking Radius
  if (zone.shrink_rate_mps && zone.shrink_rate_mps > 0) {
    radius_m = Math.max(0, radius_m - zone.shrink_rate_mps * deltaS);
  }

  // If zone has shrunk to 0 or elapsed beyond expiry, mark depleted
  const isExpired = new Date(zone.expires_at).getTime() <= nowMs;
  if (radius_m <= 0 || isExpired || zone.remaining_charges <= 0) {
    return {
      updatedZone: { ...zone, radius_m: 0 },
      isDepleted: true,
    };
  }

  // 2. Drifting Movement & Circular Reflection
  if (velocity_mps && (velocity_mps.vx !== 0 || velocity_mps.vy !== 0)) {
    // Current displacement from arena center in meters
    const { dx: cx, dy: cy } = coordDeltaToMeters(arenaCenter, { latitude, longitude });

    // Proposed new displacement
    let nextDx = cx + velocity_mps.vx * deltaS;
    let nextDy = cy + velocity_mps.vy * deltaS;
    let nextVx = velocity_mps.vx;
    let nextVy = velocity_mps.vy;

    const currentDistFromCenter = Math.hypot(nextDx, nextDy);
    // Keep zone centroid safely inside arena perimeter (buffer with zone radius)
    const maxAllowedDist = Math.max(10, arenaRadiusM - radius_m);

    if (currentDistFromCenter >= maxAllowedDist && currentDistFromCenter > 0) {
      // Normal vector pointing inward from the circular boundary
      const nx = -nextDx / currentDistFromCenter;
      const ny = -nextDy / currentDistFromCenter;

      // Specular reflection: v_new = v - 2(v . n)n
      const dot = nextVx * nx + nextVy * ny;
      if (dot < 0) {
        nextVx = nextVx - 2 * dot * nx;
        nextVy = nextVy - 2 * dot * ny;
      }

      // Clamp position strictly onto the perimeter boundary
      nextDx = (-nx) * maxAllowedDist;
      nextDy = (-ny) * maxAllowedDist;
    }

    const { dLat, dLng } = metersToCoordDelta(nextDx, nextDy, arenaCenter.latitude);
    latitude = arenaCenter.latitude + dLat;
    longitude = arenaCenter.longitude + dLng;
    velocity_mps = { vx: nextVx, vy: nextVy };
  }

  return {
    updatedZone: {
      ...zone,
      latitude,
      longitude,
      radius_m,
      velocity_mps,
    },
    isDepleted: false,
  };
}

/**
 * Evaluates whether a player is within range of an active Antidote zone and claims a charge.
 */
export function attemptClaimAntidote(
  playerCoord: LatLng,
  zone: DynamicZone,
  boostHp: number
): {
  success: boolean;
  healthAwarded: number;
  updatedZone: DynamicZone;
  reason?: string;
} {
  if (zone.type !== 'antidote') {
    return {
      success: false,
      healthAwarded: 0,
      updatedZone: zone,
      reason: 'Zone is not an antidote station.',
    };
  }

  if (zone.remaining_charges <= 0) {
    return {
      success: false,
      healthAwarded: 0,
      updatedZone: zone,
      reason: 'Antidote station is completely depleted.',
    };
  }

  const distanceM = haversineDistanceM(playerCoord, {
    latitude: zone.latitude,
    longitude: zone.longitude,
  });

  if (distanceM > zone.radius_m) {
    return {
      success: false,
      healthAwarded: 0,
      updatedZone: zone,
      reason: `Outside antidote geofence (${Math.round(distanceM)}m > ${Math.round(zone.radius_m)}m).`,
    };
  }

  const updatedCharges = zone.remaining_charges - 1;
  const updatedZone: DynamicZone = {
    ...zone,
    remaining_charges: updatedCharges,
  };

  return {
    success: true,
    healthAwarded: boostHp,
    updatedZone,
  };
}

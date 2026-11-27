/**
 * GhostRun v4.0 City World Core Helpers
 *
 * Pure functions for Persistent City World:
 * - Sector & Turf Zone grid key calculation
 * - GeoJSON Hex Turf polygon generation
 * - Client-side preview scoring for Daily Pinpoint Bounties
 */

export interface CityBountyClaim {
  score: number;
  distance_error_meters: number;
  heading_error_degrees: number;
  echo_pts_awarded: number;
  submission_photo_url: string;
}

export interface CityBounty {
  id: string;
  slot_index: number;
  title: string;
  photo_url: string;
  latitude: number;
  longitude: number;
  heading: number;
  source: string;
  claim_count: number;
  top_score: number;
  my_claim: CityBountyClaim | null;
}

export interface CityTurfZone {
  zone_key: string;
  latitude: number;
  longitude: number;
  owner_name: string;
  owner_color: string;
  owner_crew_id: string | null;
  control_score: number;
  captured_at: string;
}

export interface CityWorldState {
  sector_key: string;
  bounty_date: string;
  my_crew: { id: string; name: string; code: string } | null;
  bounties: CityBounty[];
  turf_zones: CityTurfZone[];
}

/**
 * Computes the ~1.1km sector key matching Postgres `get_city_world_state`.
 */
export function computeSectorKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)}_${lng.toFixed(2)}`;
}

/**
 * Computes the ~110m turf zone key matching Postgres `claim_city_bounty`.
 */
export function computeTurfZoneKey(lat: number, lng: number): string {
  return `turf_${lat.toFixed(3)}_${lng.toFixed(3)}`;
}

/**
 * Generates a 6-vertex GeoJSON Polygon feature for a Turf Zone hex on MapLibre.
 */
export function buildTurfHexFeature(zone: CityTurfZone, radiusM = 120) {
  const latRad = (zone.latitude * Math.PI) / 180;
  const degLat = radiusM / 111320;
  const degLng = radiusM / (111320 * Math.max(0.2, Math.cos(latRad)));

  const ring: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i + Math.PI / 6;
    ring.push([
      zone.longitude + degLng * Math.cos(angle),
      zone.latitude + degLat * Math.sin(angle),
    ]);
  }
  ring.push(ring[0]);

  return {
    type: 'Feature' as const,
    properties: {
      zone_key: zone.zone_key,
      owner_name: zone.owner_name,
      owner_color: zone.owner_color || '#C8FF00',
      control_score: zone.control_score,
    },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [ring],
    },
  };
}

/**
 * Computes normalized angular delta (0..180 deg) and preview score (0..5000 pts).
 */
export function evaluateBountyScore(params: {
  distanceM: number;
  targetHeading: number;
  submissionHeading: number;
}): {
  distanceErrorM: number;
  headingErrorDeg: number;
  score: number;
  echoPts: number;
} {
  const dist = Math.max(0, params.distanceM);
  let hDiff = Math.abs(params.submissionHeading - params.targetHeading) % 360;
  if (hDiff > 180) hDiff = 360 - hDiff;

  let prox = Math.round(4000 * Math.exp(-dist / 100));
  if (dist <= 5) prox = 4000;
  if (dist > 500) prox = 0;

  const head = hDiff < 90 ? Math.round(1000 * Math.cos((hDiff * Math.PI) / 180)) : 0;
  const score = Math.min(5000, Math.max(0, prox + head));
  const echoPts = Math.max(25, Math.round(score / 50));

  return {
    distanceErrorM: Math.round(dist * 10) / 10,
    headingErrorDeg: Math.round(hDiff * 10) / 10,
    score,
    echoPts,
  };
}

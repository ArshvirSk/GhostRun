/**
 * GhostRun v3.0 Pinpoint Live Match Helpers
 *
 * Pure functions for building live round manifests, progressive clue GeoJSON
 * overlays (Sector Quadrant at T+1:30, Azimuth Vector at T+2:15), and round state.
 */

import type { PinpointHostDrop } from './types';

export interface LivePinpointRound {
  id: string;
  roundNumber: number;
  title: string;
  targetPhotoUrl: string;
  latitude: number;
  longitude: number;
  heading: number;
  durationSec: number;
}

const DEFAULT_FALLBACK_PHOTOS = [
  'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1508873696983-2df5703bc20d?auto=format&fit=crop&w=600&q=80',
];

/**
 * Resolves live Pinpoint rounds from host drops or generates deterministic
 * fallback landmarks inside the arena boundary when running offline/simulated.
 */
export function buildPinpointRoundsFromParams(params: {
  centerLat: number;
  centerLng: number;
  radiusM: number;
  modeParams?: Record<string, any> | null;
}): LivePinpointRound[] {
  const ppParams = params.modeParams?.pinpoint || params.modeParams || {};
  const totalRounds = Math.min(5, Math.max(1, Number(ppParams.total_rounds) || 3));
  const durationSec = Math.min(600, Math.max(60, Number(ppParams.round_duration_s) || 180));
  const hostDrops: PinpointHostDrop[] | undefined = Array.isArray(ppParams.drops)
    ? ppParams.drops
    : undefined;

  if (hostDrops && hostDrops.length > 0) {
    return hostDrops.slice(0, totalRounds).map((d, idx) => ({
      id: d.id || `round-${idx + 1}`,
      roundNumber: d.roundNumber || idx + 1,
      title: d.title || `Landmark Drop ${idx + 1}`,
      targetPhotoUrl: d.photoUrl || DEFAULT_FALLBACK_PHOTOS[idx % DEFAULT_FALLBACK_PHOTOS.length],
      latitude: d.latitude,
      longitude: d.longitude,
      heading: d.heading ?? 0,
      durationSec,
    }));
  }

  // Fallback radial distribution inside 55% of arena radius
  const safeOffsetM = Math.min(params.radiusM * 0.55, 220);
  const cosLat = Math.max(0.2, Math.cos((params.centerLat * Math.PI) / 180));
  const defaultTitles = [
    'Main Plaza Fountain',
    'North Trail Pavilion',
    'Stone Arch Bridge',
    'Historic Clock Tower',
    'Overlook Terrace',
  ];

  const rounds: LivePinpointRound[] = [];
  for (let i = 0; i < totalRounds; i++) {
    const angleRad = ((i * 110 + 35) * Math.PI) / 180;
    const dLat = (safeOffsetM * Math.cos(angleRad)) / 111111;
    const dLng = (safeOffsetM * Math.sin(angleRad)) / (111111 * cosLat);
    rounds.push({
      id: `sim-round-${i + 1}`,
      roundNumber: i + 1,
      title: defaultTitles[i % defaultTitles.length],
      targetPhotoUrl: DEFAULT_FALLBACK_PHOTOS[i % DEFAULT_FALLBACK_PHOTOS.length],
      latitude: params.centerLat + dLat,
      longitude: params.centerLng + dLng,
      heading: (i * 90 + 45) % 360,
      durationSec,
    });
  }
  return rounds;
}

/**
 * Generates a GeoJSON Polygon covering the specified quadrant (NW, NE, SW, SE)
 * of the arena geofence for Hint 2 (Sector Triangulation).
 */
export function buildSectorQuadrantPolygon(
  centerLat: number,
  centerLng: number,
  radiusM: number,
  quadrant: 'NW' | 'NE' | 'SW' | 'SE'
) {
  const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));
  const dLat = radiusM / 111111;
  const dLng = radiusM / (111111 * cosLat);

  const minLat = quadrant.startsWith('N') ? centerLat : centerLat - dLat;
  const maxLat = quadrant.startsWith('N') ? centerLat + dLat : centerLat;
  const minLng = quadrant.endsWith('E') ? centerLng : centerLng - dLng;
  const maxLng = quadrant.endsWith('E') ? centerLng + dLng : centerLng;

  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: { quadrant },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat],
            ],
          ],
        },
      },
    ],
  };
}

/**
 * Generates a GeoJSON LineString from the operative's current GPS position
 * toward the target landmark for Hint 3 (Compass Azimuth Vector).
 */
export function buildAzimuthVectorLine(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
) {
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [fromLng, fromLat],
            [toLng, toLat],
          ],
        },
      },
    ],
  };
}

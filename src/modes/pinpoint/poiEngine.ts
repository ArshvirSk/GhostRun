/**
 * GhostRun v3.0 Pinpoint Method C: Map POI Auto-Drop Engine
 *
 * Queries OpenStreetMap Overpass API for verified outdoor landmarks
 * (monuments, gazebos, sculptures, fountains, footbridges) within the
 * arena geofence, with deterministic fallback when offline.
 */

import { distanceM } from '../../lib/geo';
import { buildPinpointRoundsFromParams, type LivePinpointRound } from './liveHelpers';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface ParsedPoiCandidate {
  id: string;
  title: string;
  category: 'historic' | 'leisure' | 'tourism' | 'amenity' | 'bridge';
  latitude: number;
  longitude: number;
  distanceFromCenterM: number;
}

const POI_CATEGORY_PHOTOS: Record<ParsedPoiCandidate['category'], string> = {
  historic:
    'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=600&q=80',
  leisure:
    'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=600&q=80',
  tourism:
    'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=600&q=80',
  amenity:
    'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=600&q=80',
  bridge:
    'https://images.unsplash.com/photo-1508873696983-2df5703bc20d?auto=format&fit=crop&w=600&q=80',
};

/**
 * Builds an Overpass QL query for outdoor Pinpoint-suitable POIs around (lat, lng).
 */
export function buildOverpassPoiQuery(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): string {
  const safeRadius = Math.min(750, Math.max(100, Math.round(radiusMeters)));
  return `[out:json][timeout:4];
(
  nwr["historic"](around:${safeRadius},${centerLat},${centerLng});
  nwr["tourism"~"artwork|attraction|viewpoint"](around:${safeRadius},${centerLat},${centerLng});
  nwr["leisure"~"pavilion|bandstand|picnic_table|gazebo"](around:${safeRadius},${centerLat},${centerLng});
  nwr["amenity"~"fountain|clock"](around:${safeRadius},${centerLat},${centerLng});
  nwr["bridge"="yes"]["highway"~"footway|path|pedestrian"](around:${safeRadius},${centerLat},${centerLng});
);
out center 40;`;
}

/**
 * Parses raw Overpass elements into verified, geofenced Pinpoint POI candidates.
 */
export function parseOverpassPoiElements(
  elements: OverpassElement[],
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): ParsedPoiCandidate[] {
  const results: ParsedPoiCandidate[] = [];
  const seenCoords = new Set<string>();

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) continue;

    const dist = distanceM(
      { latitude: centerLat, longitude: centerLng },
      { latitude: lat, longitude: lng }
    );
    if (dist > radiusMeters) continue;

    // Deduplicate near-identical coordinates (~10m grid)
    const gridKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (seenCoords.has(gridKey)) continue;
    seenCoords.add(gridKey);

    const tags = el.tags || {};
    let category: ParsedPoiCandidate['category'] = 'tourism';
    let fallbackLabel = 'Landmark Point';

    if (tags.historic) {
      category = 'historic';
      fallbackLabel = `Historic ${tags.historic.replace(/_/g, ' ')}`;
    } else if (tags.bridge) {
      category = 'bridge';
      fallbackLabel = 'Pedestrian Footbridge';
    } else if (tags.amenity) {
      category = 'amenity';
      fallbackLabel = tags.amenity === 'fountain' ? 'Plaza Fountain' : 'Clock Landmark';
    } else if (tags.leisure) {
      category = 'leisure';
      fallbackLabel = `Park ${tags.leisure.replace(/_/g, ' ')}`;
    } else if (tags.tourism) {
      category = 'tourism';
      fallbackLabel = tags.tourism.replace(/_/g, ' ');
    }

    const rawTitle = tags.name || fallbackLabel;
    const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

    results.push({
      id: `osm-${el.type}-${el.id}`,
      title,
      category,
      latitude: lat,
      longitude: lng,
      distanceFromCenterM: Math.round(dist),
    });
  }

  return results;
}

/**
 * Selects up to `count` well-spaced POIs (preferring >= 40m separation).
 */
export function selectSpacedPois(
  candidates: ParsedPoiCandidate[],
  count: number,
  minSpacingM = 40
): ParsedPoiCandidate[] {
  if (candidates.length <= count) return candidates.slice(0, count);

  const selected: ParsedPoiCandidate[] = [];
  for (const cand of candidates) {
    if (selected.length >= count) break;
    const tooClose = selected.some(
      (s) =>
        distanceM(
          { latitude: s.latitude, longitude: s.longitude },
          { latitude: cand.latitude, longitude: cand.longitude }
        ) < minSpacingM
    );
    if (!tooClose) {
      selected.push(cand);
    }
  }

  // Fill remaining slots if spacing filter was too strict
  if (selected.length < count) {
    for (const cand of candidates) {
      if (selected.length >= count) break;
      if (!selected.some((s) => s.id === cand.id)) {
        selected.push(cand);
      }
    }
  }

  return selected;
}

/**
 * Fetches OSM POIs via Overpass API with a 3.5s timeout and falls back
 * gracefully to deterministic in-bounds rounds when offline or empty.
 */
export async function fetchMapPoiRounds(params: {
  centerLat: number;
  centerLng: number;
  radiusM: number;
  totalRounds: number;
  roundDurationSec: number;
}): Promise<LivePinpointRound[]> {
  const query = buildOverpassPoiQuery(params.centerLat, params.centerLng, params.radiusM);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const json = (await res.json()) as { elements?: OverpassElement[] };
      const parsed = parseOverpassPoiElements(
        json.elements || [],
        params.centerLat,
        params.centerLng,
        params.radiusM
      );
      const picked = selectSpacedPois(parsed, params.totalRounds);

      if (picked.length > 0) {
        return picked.map((poi, idx) => ({
          id: poi.id,
          roundNumber: idx + 1,
          title: poi.title,
          targetPhotoUrl: POI_CATEGORY_PHOTOS[poi.category],
          latitude: poi.latitude,
          longitude: poi.longitude,
          heading: (idx * 90 + 30) % 360,
          durationSec: params.roundDurationSec,
        }));
      }
    }
  } catch {
    // Network offline or Overpass timeout: fall through to deterministic fallback
  }

  return buildPinpointRoundsFromParams({
    centerLat: params.centerLat,
    centerLng: params.centerLng,
    radiusM: params.radiusM,
    modeParams: {
      pinpoint: {
        total_rounds: params.totalRounds,
        round_duration_s: params.roundDurationSec,
      },
    },
  });
}

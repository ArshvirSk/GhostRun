import { supabase } from './supabase';
import { uploadPinpointPhoto } from './pinpointUpload';
import { fetchMapPoiRounds } from '../modes/pinpoint/poiEngine';
import type { CityWorldState } from './cityWorldCore';

export * from './cityWorldCore';

export interface ClaimBountyResponse {
  ok: boolean;
  score?: number;
  distance_error_meters?: number;
  heading_error_degrees?: number;
  echo_pts_awarded?: number;
  turf_flipped?: boolean;
  turf_zone_key?: string;
  error?: string;
}

/**
 * Loads today's City World state (Daily Pinpoint Bounties + nearby Turf Zones)
 * for `(lat, lng)`. Automatically seeds 3 real-world OSM/Wikimedia bounties
 * if none exist yet for today's sector.
 */
export async function fetchCityWorldState(
  lat: number,
  lng: number
): Promise<{ ok: boolean; state?: CityWorldState; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Database not initialized' };
  }

  try {
    const { data, error } = await (supabase.rpc as any)('get_city_world_state', {
      p_lat: lat,
      p_lng: lng,
      p_radius_m: 1500,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    const state = data as CityWorldState;
    if (state && Array.isArray(state.bounties) && state.bounties.length === 0) {
      const seeds = await fetchMapPoiRounds({
        centerLat: lat,
        centerLng: lng,
        radiusM: 700,
        totalRounds: 3,
        roundDurationSec: 180,
      });

      const { data: seededData, error: seedErr } = await (supabase.rpc as any)(
        'seed_daily_city_bounties',
        {
          p_lat: lat,
          p_lng: lng,
          p_bounties: seeds,
        }
      );

      if (!seedErr && seededData) {
        return { ok: true, state: seededData as CityWorldState };
      }
    }

    return { ok: true, state };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to load City World' };
  }
}

/**
 * Uploads the player's captured JPEG to UploadThing and submits a Daily Bounty claim.
 */
export async function submitCityBountyClaim(params: {
  bountyId: string;
  photoUri?: string;
  fallbackPhotoUrl: string;
  lat: number;
  lng: number;
  heading: number;
}): Promise<ClaimBountyResponse> {
  if (!supabase) {
    return { ok: false, error: 'Database not initialized' };
  }

  try {
    let finalPhotoUrl = params.fallbackPhotoUrl;
    if (params.photoUri) {
      const uploadRes = await uploadPinpointPhoto(params.photoUri, {
        gameId: 'cityworld',
        roundId: params.bountyId,
        kind: 'submission',
      });
      if (uploadRes.ok && uploadRes.publicUrl) {
        finalPhotoUrl = uploadRes.publicUrl;
      }
    }

    const { data, error } = await (supabase.rpc as any)('claim_city_bounty', {
      p_bounty_id: params.bountyId,
      p_photo_url: finalPhotoUrl,
      p_lat: params.lat,
      p_lng: params.lng,
      p_heading: params.heading,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return data as ClaimBountyResponse;
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Bounty claim failed' };
  }
}

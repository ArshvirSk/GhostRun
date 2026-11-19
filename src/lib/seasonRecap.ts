/**
 * NF-15: Season Recap ("Wrapped") Client Module
 */

import { Share } from 'react-native';
import { supabase } from './supabase';
import { distanceM } from './geo';
import {
  RoundHistoryEntry,
  SeasonRecapData,
  calculateSeasonRecap,
  buildSeasonRecapShareText,
} from './seasonRecapCore';

export * from './seasonRecapCore';

/**
 * Fetches user's round history and badges to generate a season recap
 */
export async function fetchSeasonRecap(
  periodName = 'Current Season'
): Promise<{ success: boolean; recap?: SeasonRecapData; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Database unconfigured' };
  }

  try {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) {
      return { success: false, error: 'User unauthenticated' };
    }

    const userId = authData.user.id;

    // 1. Fetch player rounds
    const { data: playersData, error: pError } = await supabase
      .from('players')
      .select('id, game_id, team, status, created_at, games(id, mode_id, winner, status, duration_s, live_at, ended_at)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (pError) {
      return { success: false, error: pError.message };
    }

    // 2. Fetch badges
    const { data: badgeData } = await supabase
      .from('player_badges')
      .select('badge_id')
      .eq('user_id', userId);

    const badges = (badgeData || []).map((b: any) => b.badge_id);

    // 3. Compute real distance and speed telemetry from trail_points
    const gameIds = (playersData || []).map((p: any) => p.game_id);
    const trailMap = new Map<string, { distanceMeters: number; topSpeedKmh: number }>();

    if (gameIds.length > 0) {
      try {
        const { data: tpRows } = await supabase
          .from('trail_points')
          .select('game_id, player_id, geog, recorded_at')
          .in('game_id', gameIds)
          .order('recorded_at', { ascending: true });

        if (tpRows && tpRows.length > 0) {
          const ptsByPlayer = new Map<string, Array<{ latitude: number; longitude: number; time: number }>>();
          for (const tp of tpRows) {
            let lat: number | undefined;
            let lng: number | undefined;
            if (typeof tp.geog === 'object' && tp.geog?.coordinates) {
              lng = tp.geog.coordinates[0];
              lat = tp.geog.coordinates[1];
            }
            if (lat !== undefined && lng !== undefined) {
              const list = ptsByPlayer.get(tp.player_id) || [];
              list.push({ latitude: lat, longitude: lng, time: new Date(tp.recorded_at).getTime() });
              ptsByPlayer.set(tp.player_id, list);
            }
          }

          for (const [pid, pts] of ptsByPlayer) {
            let dist = 0;
            let peakSpeedMps = 0;
            for (let i = 1; i < pts.length; i++) {
              const d = distanceM(pts[i - 1], pts[i]);
              dist += d;
              const dt = (pts[i].time - pts[i - 1].time) / 1000;
              if (dt > 0.5 && dt < 30) {
                const speed = d / dt;
                if (speed > peakSpeedMps && speed < 30) {
                  peakSpeedMps = speed;
                }
              }
            }
            trailMap.set(pid, {
              distanceMeters: Math.round(dist),
              topSpeedKmh: Math.round(peakSpeedMps * 3.6 * 10) / 10,
            });
          }
        }
      } catch {
        // non-blocking fallback
      }
    }

    const roundEntries: RoundHistoryEntry[] = (playersData || []).map((p: any) => {
      const modeId = p.games?.mode_id || 'classic_chase';
      const winner = p.games?.winner;
      const isWinner =
        p.team === winner ||
        (p.team === 'runner' && winner === 'runners') ||
        (p.team === 'hunter' && winner === 'hunters');

      let durationSeconds = 0;
      if (p.games?.live_at && p.games?.ended_at) {
        durationSeconds = Math.max(0, Math.round((new Date(p.games.ended_at).getTime() - new Date(p.games.live_at).getTime()) / 1000));
      } else if (p.games?.duration_s) {
        durationSeconds = p.games.duration_s;
      }

      const telemetry = trailMap.get(p.id);

      return {
        id: p.id,
        mode_id: modeId,
        team: p.team,
        won: Boolean(isWinner),
        duration_seconds: durationSeconds,
        distance_meters: telemetry?.distanceMeters ?? 0,
        top_speed_kmh: telemetry?.topSpeedKmh ?? 0,
        created_at: p.created_at,
      };
    });

    const recap = calculateSeasonRecap(roundEntries, badges, periodName);
    return { success: true, recap };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to generate recap' };
  }
}

/**
 * Share the Season Recap card via OS share sheet
 */
export async function shareSeasonRecap(recap: SeasonRecapData): Promise<{ success: boolean }> {
  try {
    const text = buildSeasonRecapShareText(recap);
    await Share.share({
      title: `GhostRun Tactical Dossier: ${recap.periodName}`,
      message: text,
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}

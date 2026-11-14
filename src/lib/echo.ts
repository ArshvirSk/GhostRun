/**
 * GhostRun — Echo Client Integration (FL-P2)
 */

import { supabase } from './supabase';
import { EchoTier } from './echoCore';

export interface PlayerEchoProfile {
  season: string;
  echoTotal: number;
  roundsCounted: number;
  avgBest: number;
  avgGhost: number;
  avgCash: number;
  tier: EchoTier;
  bestRound: number;
}

export async function computeRoundScoresOnServer(
  gameId: string,
): Promise<{ success: boolean; counted?: boolean; error?: string }> {
  if (!supabase) return { success: true, counted: true };
  try {
    const { data, error } = await supabase.rpc('compute_round_scores', {
      p_game_id: gameId,
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return {
      success: Boolean(data?.success),
      counted: Boolean(data?.counted),
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to compute scores',
    };
  }
}

export async function refreshSeasonScoresOnServer(
  season?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: true };
  try {
    const { data, error } = await supabase.rpc('refresh_season_scores', {
      p_season: season ?? null,
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: Boolean(data?.success) };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to refresh season scores',
    };
  }
}

export async function getPlayerEchoProfile(
  userId?: string,
): Promise<PlayerEchoProfile | null> {
  if (!supabase) {
    return {
      season: '2026-11',
      echoTotal: 0,
      roundsCounted: 0,
      avgBest: 0,
      avgGhost: 0,
      avgCash: 0,
      tier: 'Whisper',
      bestRound: 0,
    };
  }
  try {
    const { data, error } = await supabase.rpc('get_player_echo_profile', {
      p_user_id: userId ?? null,
    });
    if (error || !data) return null;
    const raw = data as Record<string, unknown>;
    return {
      season: String(raw.season ?? '2026-11'),
      echoTotal: Number(raw.echo_total ?? 0),
      roundsCounted: Number(raw.rounds_counted ?? 0),
      avgBest: Number(raw.avg_best ?? 0),
      avgGhost: Number(raw.avg_ghost ?? 0),
      avgCash: Number(raw.avg_cash ?? 0),
      tier: (raw.tier as EchoTier) ?? 'Whisper',
      bestRound: Number(raw.best_round ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * GhostRun — Friends Board Client Integration (FL-P3)
 */

import { supabase } from './supabase';
import {
  FriendsBoardResponse,
  HeadToHeadStats,
} from './friendsBoardCore';
import { EchoTier } from './echoCore';

export async function fetchFriendsBoard(
  season?: string,
): Promise<FriendsBoardResponse> {
  if (!supabase) {
    return {
      canView: true,
      season: season || '2026-11',
      board: [],
    };
  }

  try {
    const { data, error } = await supabase.rpc('get_friends_board', {
      p_season: season ?? null,
    });

    if (error || !data) {
      return {
        canView: false,
        reason: error?.message || 'Failed to load friends board',
        season: season || '2026-11',
        board: [],
      };
    }

    const raw = data as Record<string, unknown>;
    const rawBoard = (raw.board as Array<Record<string, unknown>>) ?? [];

    return {
      canView: Boolean(raw.can_view),
      reason: raw.reason ? String(raw.reason) : undefined,
      season: String(raw.season ?? '2026-11'),
      board: rawBoard.map((item) => ({
        rank: Number(item.rank ?? 1),
        userId: String(item.user_id),
        displayName: String(item.display_name),
        handle: item.handle ? String(item.handle) : null,
        seasonEcho: Number(item.season_echo ?? 0),
        tier: (item.tier as EchoTier) ?? 'Whisper',
        roundsCounted: Number(item.rounds_counted ?? 0),
        avgGhost: Number(item.avg_ghost ?? 0),
        avgCash: Number(item.avg_cash ?? 0),
        isSelf: Boolean(item.is_self),
      })),
    };
  } catch (err: unknown) {
    return {
      canView: false,
      reason: err instanceof Error ? err.message : 'Network error',
      season: season || '2026-11',
      board: [],
    };
  }
}

export async function fetchHeadToHead(
  friendId: string,
): Promise<HeadToHeadStats> {
  if (!supabase) {
    return {
      available: false,
      reason: 'No backend connection',
      oppositeRounds: 0,
      myWins: 0,
      friendWins: 0,
      timesGhostedThem: 0,
      timesTheyCashedMe: 0,
    };
  }

  try {
    const { data, error } = await supabase.rpc('get_head_to_head_stats', {
      p_friend_id: friendId,
    });

    if (error || !data) {
      return {
        available: false,
        reason: error?.message || 'Failed to fetch head-to-head records',
        oppositeRounds: 0,
        myWins: 0,
        friendWins: 0,
        timesGhostedThem: 0,
        timesTheyCashedMe: 0,
      };
    }

    const raw = data as Record<string, unknown>;
    return {
      available: Boolean(raw.available),
      reason: raw.reason ? String(raw.reason) : undefined,
      friendId: raw.friend_id ? String(raw.friend_id) : undefined,
      friendName: raw.friend_name ? String(raw.friend_name) : undefined,
      friendHandle: raw.friend_handle ? String(raw.friend_handle) : undefined,
      oppositeRounds: Number(raw.opposite_rounds ?? 0),
      myWins: Number(raw.my_wins ?? 0),
      friendWins: Number(raw.friend_wins ?? 0),
      timesGhostedThem: Number(raw.times_ghosted_them ?? 0),
      timesTheyCashedMe: Number(raw.times_they_cashed_me ?? 0),
    };
  } catch (err: unknown) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : 'Network error',
      oppositeRounds: 0,
      myWins: 0,
      friendWins: 0,
      timesGhostedThem: 0,
      timesTheyCashedMe: 0,
    };
  }
}

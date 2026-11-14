/**
 * NF-13: Scheduled Games Supabase Client & Calendar Sharing
 */

import { Share, Platform } from 'react-native';
import { supabase } from './supabase';
import {
  ScheduledGame,
  ScheduledGameRsvp,
  RsvpStatus,
  CreateScheduledGameInput,
  validateScheduledGameInput,
  buildGameIcsContent,
} from './scheduledGamesCore';

export * from './scheduledGamesCore';
export * from './icalendarCore';

/**
 * Creates a scheduled game session in Supabase
 */
export async function createScheduledGameOnServer(
  input: CreateScheduledGameInput
): Promise<{ success: boolean; gameId?: string; error?: string }> {
  const validation = validateScheduledGameInput(input);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (!supabase) {
    return { success: false, error: 'Database service unconfigured' };
  }

  try {
    const { data, error } = await supabase.rpc('create_scheduled_game', {
      p_title: input.title.trim(),
      p_mode_id: input.modeId,
      p_scheduled_at: input.scheduledAt.toISOString(),
      p_area_name: input.areaName ? input.areaName.trim() : null,
      p_notes: input.notes ? input.notes.trim() : null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, gameId: data as string };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to schedule game' };
  }
}

/**
 * Submit or update an RSVP response for a scheduled game
 */
export async function submitRsvpOnServer(
  gameId: string,
  response: RsvpStatus
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Database service unconfigured' };
  }

  try {
    const { error } = await supabase.rpc('rsvp_scheduled_game', {
      p_scheduled_game_id: gameId,
      p_response: response,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to submit RSVP' };
  }
}

/**
 * Fetch upcoming scheduled games from Supabase
 */
export async function fetchUpcomingScheduledGames(): Promise<{
  success: boolean;
  games: ScheduledGame[];
  error?: string;
}> {
  if (!supabase) {
    return { success: false, games: [], error: 'Database service unconfigured' };
  }

  try {
    const { data, error } = await supabase
      .from('scheduled_games')
      .select('*')
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(20);

    if (error) {
      return { success: false, games: [], error: error.message };
    }

    return { success: true, games: (data as ScheduledGame[]) || [] };
  } catch (err: any) {
    return { success: false, games: [], error: err.message || 'Failed to fetch games' };
  }
}

/**
 * Share or export calendar reminder for a scheduled game
 */
export async function shareScheduledGameCalendar(
  game: ScheduledGame
): Promise<{ success: boolean; error?: string }> {
  try {
    const icsContent = buildGameIcsContent(game);
    const dateFormatted = new Date(game.scheduled_at).toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const shareMessage =
      Platform.OS === 'web'
        ? `GhostRun Tactical Operation: ${game.title}\nTime: ${dateFormatted}\nRendezvous: ${game.area_name || 'TBD'}\n\nICS Payload:\n${icsContent}`
        : `GhostRun Tactical Operation: ${game.title}\nTime: ${dateFormatted}\nRendezvous: ${game.area_name || 'TBD'}\n\nJoin the operation in GhostRun!`;

    await Share.share({
      title: `GhostRun: ${game.title}`,
      message: shareMessage,
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to share calendar invite' };
  }
}

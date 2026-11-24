/**
 * NF-13: Scheduled Games & RSVPs Core Logic
 */

import { generateIcsCalendar, IcsEvent } from './icalendarCore';

export type RsvpStatus = 'attending' | 'declined' | 'tentative';

export interface ScheduledGame {
  id: string;
  host_id: string;
  title: string;
  mode_id: string;
  scheduled_at: string; // ISO string
  area_name?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface ScheduledGameRsvp {
  scheduled_game_id: string;
  user_id: string;
  response: RsvpStatus;
  updated_at: string;
}

export interface CreateScheduledGameInput {
  title: string;
  modeId: string;
  scheduledAt: Date;
  areaName?: string;
  notes?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate input for creating a scheduled game
 */
export function validateScheduledGameInput(
  input: CreateScheduledGameInput,
  now: Date = new Date()
): ValidationResult {
  const trimmedTitle = (input.title || '').trim();
  if (trimmedTitle.length < 3) {
    return { valid: false, error: 'Title must be at least 3 characters long.' };
  }
  if (trimmedTitle.length > 60) {
    return { valid: false, error: 'Title cannot exceed 60 characters.' };
  }

  if (!input.modeId || input.modeId.trim().length === 0) {
    return { valid: false, error: 'A game mode must be selected.' };
  }

  const minFutureMs = 5 * 60 * 1000; // 5 minutes
  if (input.scheduledAt.getTime() <= now.getTime() + minFutureMs) {
    return { valid: false, error: 'Scheduled time must be at least 5 minutes in the future.' };
  }

  if (input.areaName && input.areaName.length > 100) {
    return { valid: false, error: 'Area name cannot exceed 100 characters.' };
  }

  // Check if area name looks like raw latitude/longitude coordinates to protect privacy
  if (input.areaName && /^-?\d+(\.\d+)?[,\s]+-?\d+(\.\d+)?$/.test(input.areaName.trim())) {
    return {
      valid: false,
      error: 'Do not use exact coordinates. Enter a general park or area name.',
    };
  }

  if (input.notes && input.notes.length > 500) {
    return { valid: false, error: 'Notes cannot exceed 500 characters.' };
  }

  return { valid: true };
}

/**
 * Build an iCalendar .ics string for a scheduled game
 */
export function buildGameIcsContent(
  game: ScheduledGame,
  durationMinutes: number = 60
): string {
  const startTime = new Date(game.scheduled_at);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

  const descParts: string[] = [
    `GhostRun Tactical Operation`,
    `Mode: ${game.mode_id}`,
  ];

  if (game.area_name) {
    descParts.push(`Rendezvous: ${game.area_name}`);
  }

  if (game.notes) {
    descParts.push(`Intel: ${game.notes}`);
  }

  descParts.push(`Open GhostRun to participate.`);

  const event: IcsEvent = {
    uid: `ghostrun-${game.id}@ghostrun.app`,
    title: `GhostRun: ${game.title}`,
    description: descParts.join('\\n'),
    location: game.area_name || 'GhostRun Tactical Area',
    startTime,
    endTime,
    created: new Date(game.created_at || Date.now()),
  };

  return generateIcsCalendar(event);
}

/**
 * Summarize RSVPs for a scheduled game
 */
export function summarizeRsvps(rsvps: ScheduledGameRsvp[]): {
  attending: number;
  declined: number;
  tentative: number;
  total: number;
} {
  let attending = 0;
  let declined = 0;
  let tentative = 0;

  for (const rsvp of rsvps) {
    if (rsvp.response === 'attending') attending++;
    else if (rsvp.response === 'declined') declined++;
    else if (rsvp.response === 'tentative') tentative++;
  }

  return {
    attending,
    declined,
    tentative,
    total: rsvps.length,
  };
}

/**
 * Calculates the exact timestamp for a 15-minute lobby warmup reminder alarm.
 */
export function calculateWarmupAlarmTime(
  scheduledAt: Date,
  warmupMinutes: number = 15
): Date {
  return new Date(scheduledAt.getTime() - warmupMinutes * 60 * 1000);
}

export type ScheduledGamePhase = 'upcoming' | 'warmup' | 'active' | 'concluded';

/**
 * Determines the live lifecycle phase of a scheduled game.
 */
export function getScheduledGamePhase(
  scheduledAt: Date,
  now: Date = new Date(),
  durationMinutes: number = 60,
  warmupMinutes: number = 15
): ScheduledGamePhase {
  const schedMs = scheduledAt.getTime();
  const nowMs = now.getTime();
  const warmupMs = schedMs - warmupMinutes * 60 * 1000;
  const concludeMs = schedMs + durationMinutes * 60 * 1000;

  if (nowMs < warmupMs) return 'upcoming';
  if (nowMs < schedMs) return 'warmup';
  if (nowMs < concludeMs) return 'active';
  return 'concluded';
}

/**
 * Calculates the next recurring occurrence timestamp for repeating squad matches.
 */
export function calculateNextRecurringOccurrence(
  frequency: 'daily' | 'weekly' | 'biweekly',
  baseDate: Date,
  afterDate: Date = new Date()
): Date {
  const stepMs =
    frequency === 'daily'
      ? 24 * 60 * 60 * 1000
      : frequency === 'weekly'
        ? 7 * 24 * 60 * 60 * 1000
        : 14 * 24 * 60 * 60 * 1000;

  let current = new Date(baseDate.getTime());
  while (current.getTime() <= afterDate.getTime()) {
    current = new Date(current.getTime() + stepMs);
  }
  return current;
}

/**
 * Builds push notification reminder payload for upcoming scheduled games.
 */
export function buildScheduledGameNotification(
  game: ScheduledGame,
  type: 'warmup' | 'starting'
): { title: string; body: string; data: { gameId: string; type: string } } {
  const locationText = game.area_name ? ` at ${game.area_name}` : '';
  if (type === 'warmup') {
    return {
      title: `Match Warmup: ${game.title}`,
      body: `Operation starts in 15 minutes${locationText}. Open GhostRun to ready up with your squad.`,
      data: { gameId: game.id, type: 'warmup' },
    };
  }
  return {
    title: `Deployment Commencing: ${game.title}`,
    body: `Match lobby is open${locationText}. Deploy now!`,
    data: { gameId: game.id, type: 'starting' },
  };
}

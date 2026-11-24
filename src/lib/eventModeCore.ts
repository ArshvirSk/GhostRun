/**
 * NF-23: Event Mode for Large Scale Operations (50–150 Players)
 *
 * Realtime Architecture:
 * - Replaces per-row Postgres RLS subscriptions with lightweight Realtime Broadcast channels.
 * - Team isolation: 'runners', 'hunters', 'referees'.
 * - Spectator delay: 60-second delayed buffer prevents live screen-peeking/ghosting.
 * - Broadcast Consent C6 gating per match.
 */

export interface EventMatchConfig {
  gameId: string;
  title: string;
  maxPlayers: number; // 50 - 150
  spectatorDelaySeconds: number; // default 60s
  requiresConsentC6: boolean;
  refereeUserIds: string[];
}

export type EventChannelType = 'runners' | 'hunters' | 'referees' | 'spectators_delayed';

export interface DelayedSpectatorFrame<T = any> {
  timestamp: number;
  data: T;
}

export interface EventLeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  team: string;
  score: number;
  status: string;
}

/**
 * Generates isolated Realtime Broadcast topic names
 */
export function getEventChannelTopic(gameId: string, channelType: EventChannelType): string {
  return `event:${gameId}:${channelType}`;
}

/**
 * Validate event configuration constraints
 */
export function validateEventConfig(config: Partial<EventMatchConfig>): {
  valid: boolean;
  error?: string;
} {
  if (!config.gameId || config.gameId.trim().length === 0) {
    return { valid: false, error: 'Game ID is required.' };
  }
  const max = config.maxPlayers ?? 50;
  if (max < 10 || max > 150) {
    return { valid: false, error: 'Event capacity must be between 10 and 150 players.' };
  }
  const delay = config.spectatorDelaySeconds ?? 60;
  if (delay < 30) {
    return { valid: false, error: 'Spectator feed delay must be at least 30 seconds to prevent ghosting.' };
  }
  return { valid: true };
}

/**
 * Checks if a given user is designated as an event referee.
 */
export function isReferee(userId: string, refereeUserIds: string[] = []): boolean {
  if (!userId || !refereeUserIds || refereeUserIds.length === 0) return false;
  return refereeUserIds.includes(userId);
}

/**
 * Authorizes referee operational commands (pause, resume, confirm_tag, emergency_stop).
 */
export function canRefereePerformAction(
  action: 'pause' | 'resume' | 'confirm_tag' | 'emergency_stop',
  isUserReferee: boolean
): boolean {
  return Boolean(isUserReferee);
}

/**
 * Builds a sorted tactical leaderboard for large-scale operations.
 */
export function buildEventLeaderboard(
  players: Array<{ id: string; name: string; team: string; score: number; status: string }>
): EventLeaderboardEntry[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return sorted.map((p, index) => ({
    rank: index + 1,
    id: p.id,
    name: p.name,
    team: p.team,
    score: p.score,
    status: p.status,
  }));
}

/**
 * Computes event capacity and utilization metrics.
 */
export function calculateEventCapacityMetrics(
  registeredCount: number,
  maxPlayers: number
): { availableSlots: number; isFull: boolean; utilizationPercent: number } {
  const safeMax = Math.max(1, maxPlayers);
  const count = Math.max(0, registeredCount);
  const availableSlots = Math.max(0, safeMax - count);
  const isFull = count >= safeMax;
  const utilizationPercent = Math.min(100, Math.round((count / safeMax) * 100));

  return { availableSlots, isFull, utilizationPercent };
}

/**
 * Sliding buffer for delayed spectator broadcast
 */
export class SpectatorStreamBuffer<T = any> {
  private buffer: DelayedSpectatorFrame<T>[] = [];
  private delayMs: number;

  constructor(delaySeconds: number = 60) {
    this.delayMs = delaySeconds * 1000;
  }

  public push(data: T, now: number = Date.now()): void {
    this.buffer.push({ timestamp: now, data });
  }

  /**
   * Drain and return frames that are older than delayMs
   */
  public drainReady(now: number = Date.now()): T[] {
    const cutoff = now - this.delayMs;
    const readyItems: T[] = [];

    while (this.buffer.length > 0 && this.buffer[0].timestamp <= cutoff) {
      const frame = this.buffer.shift();
      if (frame) {
        readyItems.push(frame.data);
      }
    }

    return readyItems;
  }

  public getPendingCount(): number {
    return this.buffer.length;
  }

  public clear(): void {
    this.buffer = [];
  }
}

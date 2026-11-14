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

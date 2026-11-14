/**
 * NF-33: Spoken TTS Narration Core Engine
 *
 * Provides structured tactical voice prompts for AI Game Master events
 * and screen-off auditory gameplay.
 */

export type CuePriority = 'high' | 'normal';

export interface NarrationCue {
  id: string;
  text: string;
  priority: CuePriority;
  rate?: number; // 0.8 to 1.2
  pitch?: number; // 0.8 to 1.2
  locale?: string;
  createdAt: number;
}

export const TACTICAL_CUE_TEMPLATES: Record<string, (detail?: string) => string> = {
  head_start_begin: (detail) => `Head start active. Runners, disperse into the zone. ${detail || ''}`,
  hunters_released: () => 'Hunters released. Radar sweep online. Stay alert.',
  radar_ping: (detail) => `Radar ping: ${detail || 'Opponent detected nearby.'}`,
  hunter_proximity: (detail) => `Warning: Hunter closing in. Distance ${detail || 'under twenty meters'}.`,
  zone_shrinking: (detail) => `Attention operatives: Tactical zone is contracting. ${detail || ''}`,
  extraction_ready: () => 'Extraction portal is now online. Runners, proceed to extract.',
  player_tagged: (detail) => `Target neutralized. ${detail || 'Runner tagged.'}`,
  game_over: (detail) => `Mission concluded. ${detail || ''}`,
};

export class TacticalVoiceQueue {
  private queue: NarrationCue[] = [];
  private isSpeaking = false;
  private maxQueueLength = 3;

  public enqueue(cue: NarrationCue): NarrationCue[] {
    // If high priority (e.g. hunter proximity or tag), place at the front
    if (cue.priority === 'high') {
      this.queue.unshift(cue);
    } else {
      this.queue.push(cue);
    }

    // Prune stale or excess low-priority items
    if (this.queue.length > this.maxQueueLength) {
      // Find and remove lowest priority item from the tail
      const lowIndex = this.queue.findLastIndex((c) => c.priority === 'normal');
      if (lowIndex !== -1) {
        this.queue.splice(lowIndex, 1);
      } else {
        this.queue.pop();
      }
    }

    return [...this.queue];
  }

  public next(): NarrationCue | undefined {
    return this.queue.shift();
  }

  public clear(): void {
    this.queue = [];
  }

  public getQueue(): readonly NarrationCue[] {
    return this.queue;
  }
}

/**
 * Format a canonical tactical narration text
 */
export function formatTacticalVoiceCue(
  event: keyof typeof TACTICAL_CUE_TEMPLATES,
  detail?: string
): string {
  const template = TACTICAL_CUE_TEMPLATES[event];
  if (template) {
    return template(detail);
  }
  return detail || 'Tactical update received.';
}

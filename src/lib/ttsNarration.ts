/**
 * NF-33: Spoken TTS Narration Client Module
 */

import { Platform } from 'react-native';
import {
  NarrationCue,
  TacticalVoiceQueue,
  formatTacticalVoiceCue,
  TACTICAL_CUE_TEMPLATES,
} from './ttsNarrationCore';

export * from './ttsNarrationCore';

const voiceQueue = new TacticalVoiceQueue();
let speaking = false;

/**
 * Speaks a tactical voice cue using available device speech synthesis
 */
export async function speakVoiceCue(
  text: string,
  priority: 'high' | 'normal' = 'normal',
  options?: { rate?: number; pitch?: number; locale?: string }
): Promise<void> {
  const cue: NarrationCue = {
    id: `cue-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    text,
    priority,
    rate: options?.rate ?? 1.05, // Slightly rapid tactical cadence
    pitch: options?.pitch ?? 0.95, // Tactical low pitch
    locale: options?.locale ?? 'en-US',
    createdAt: Date.now(),
  };

  voiceQueue.enqueue(cue);
  void processQueue();
}

async function processQueue(): Promise<void> {
  if (speaking) return;

  const nextCue = voiceQueue.next();
  if (!nextCue) return;

  speaking = true;

  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(nextCue.text);
        utterance.rate = nextCue.rate ?? 1.0;
        utterance.pitch = nextCue.pitch ?? 1.0;
        utterance.lang = nextCue.locale ?? 'en-US';
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
    } else {
      // In mobile environment or non-web, we simulate speech duration (~60ms per char)
      const durationMs = Math.min(Math.max(nextCue.text.length * 60, 500), 4000);
      await new Promise((r) => setTimeout(r, durationMs));
    }
  } catch {
    // Non-blocking fallback
  } finally {
    speaking = false;
    if (voiceQueue.getQueue().length > 0) {
      void processQueue();
    }
  }
}

/**
 * Stop any ongoing speech and flush tactical queue
 */
export function stopVoiceCues(): void {
  voiceQueue.clear();
  speaking = false;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

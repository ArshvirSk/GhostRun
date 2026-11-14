/**
 * NF-23: Event Mode Realtime Channel Dispatcher
 */

import { supabase } from './supabase';
import {
  EventMatchConfig,
  EventChannelType,
  getEventChannelTopic,
  validateEventConfig,
  SpectatorStreamBuffer,
} from './eventModeCore';

export * from './eventModeCore';

/**
 * Subscribes to an isolated team or spectator broadcast channel
 */
export function subscribeToEventChannel(
  gameId: string,
  channelType: EventChannelType,
  onPayload: (payload: any) => void
): { unsubscribe: () => void } {
  if (!supabase) {
    return { unsubscribe: () => {} };
  }

  const topic = getEventChannelTopic(gameId, channelType);
  const channel = supabase.channel(topic, {
    config: {
      broadcast: { self: false },
    },
  });

  channel
    .on('broadcast', { event: 'telemetry' }, (message) => {
      onPayload(message.payload);
    })
    .subscribe();

  return {
    unsubscribe: () => {
      if (supabase) {
        void supabase.removeChannel(channel);
      }
    },
  };
}

/**
 * Broadcasts a position or tactical update to an isolated team channel
 */
export async function broadcastEventUpdate(
  gameId: string,
  channelType: EventChannelType,
  payload: any
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Database unconfigured' };
  }

  try {
    const topic = getEventChannelTopic(gameId, channelType);
    const channel = supabase.channel(topic);
    await channel.send({
      type: 'broadcast',
      event: 'telemetry',
      payload,
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to broadcast update' };
  }
}

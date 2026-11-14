/**
 * NF-24: Wear OS / Smartwatch Companion Protocol
 *
 * Defines binary/JSON messaging contract between the GhostRun mobile client
 * and paired smartwatch devices (Wear OS / watchOS).
 */

export type WatchMessageType =
  | 'HUD_UPDATE'
  | 'HAPTIC_PULSE'
  | 'CHECKIN_REQUEST'
  | 'CHECKIN_CONFIRM'
  | 'TRIGGER_SOS'
  | 'QUICK_RADIO';

export interface WatchHudUpdatePayload {
  role: 'runner' | 'hunter' | 'spectator';
  status: 'active' | 'tagged' | 'safe';
  timeRemainingSec: number;
  nearestDistanceM?: number;
  radarClockHour?: number; // 1 to 12
  isLowPowerMode?: boolean;
}

export interface WatchHapticPulsePayload {
  pattern: 'ping' | 'hunter_close' | 'tag_confirm' | 'sos';
  intensity: 'low' | 'medium' | 'high';
}

export interface WatchMessage<T = any> {
  version: 1;
  type: WatchMessageType;
  timestamp: number;
  payload: T;
}

/**
 * Packs a message for transmission over Bluetooth Wearable Data Layer
 */
export function packWatchMessage<T>(type: WatchMessageType, payload: T): string {
  const msg: WatchMessage<T> = {
    version: 1,
    type,
    timestamp: Date.now(),
    payload,
  };
  return JSON.stringify(msg);
}

/**
 * Unpacks and validates a received smartwatch message
 */
export function unpackWatchMessage(rawJson: string): {
  valid: boolean;
  message?: WatchMessage;
  error?: string;
} {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || parsed.version !== 1 || !parsed.type || !parsed.timestamp) {
      return { valid: false, error: 'Malformed watch message packet' };
    }
    return { valid: true, message: parsed as WatchMessage };
  } catch {
    return { valid: false, error: 'Invalid JSON payload' };
  }
}

/**
 * Validates incoming watch commands (check-ins, SOS, radio)
 */
export function validateWatchCommand(msg: WatchMessage): boolean {
  if (msg.type === 'CHECKIN_CONFIRM') return true;
  if (msg.type === 'TRIGGER_SOS') return true;
  if (msg.type === 'QUICK_RADIO') {
    return typeof msg.payload?.chipId === 'string' && msg.payload.chipId.length > 0;
  }
  return false;
}

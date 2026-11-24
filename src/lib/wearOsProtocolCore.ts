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
 * Maps a compass bearing azimuth (0-360 degrees) to a 12-hour clock face hour (1 to 12).
 * e.g., 0 deg -> 12, 90 deg -> 3, 180 deg -> 6, 270 deg -> 9.
 */
export function calculateRadarClockHour(bearingDegrees: number): number {
  const normalized = ((bearingDegrees % 360) + 360) % 360;
  // Each hour occupies 30 degrees: 11:30 to 12:30 is 12 (345 deg to 15 deg)
  const hour = Math.round(normalized / 30);
  return hour === 0 ? 12 : hour;
}

/**
 * Returns the wrist vibration pattern in milliseconds for wearable haptics.
 */
export function getHapticPulseVibrationPattern(
  pattern: WatchHapticPulsePayload['pattern']
): number[] {
  switch (pattern) {
    case 'ping':
      return [0, 150];
    case 'hunter_close':
      return [0, 300, 100, 300];
    case 'tag_confirm':
      return [0, 500];
    case 'sos':
      return [0, 500, 200, 500, 200, 500];
    default:
      return [0, 150];
  }
}

/**
 * Formats time remaining in M:SS format for compact watch displays.
 */
export function formatWatchHudTimeRemaining(seconds: number): string {
  const safeSec = Math.max(0, Math.floor(seconds));
  const min = Math.floor(safeSec / 60);
  const sec = safeSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Assembles a structured HUD update payload.
 */
export function buildWatchHudPayload(params: {
  role: 'runner' | 'hunter' | 'spectator';
  status: 'active' | 'tagged' | 'safe';
  timeRemainingSec: number;
  nearestDistanceM?: number;
  bearingDegrees?: number;
  isLowPowerMode?: boolean;
}): WatchHudUpdatePayload {
  const radarClockHour =
    typeof params.bearingDegrees === 'number'
      ? calculateRadarClockHour(params.bearingDegrees)
      : undefined;

  return {
    role: params.role,
    status: params.status,
    timeRemainingSec: Math.max(0, Math.floor(params.timeRemainingSec)),
    nearestDistanceM:
      typeof params.nearestDistanceM === 'number'
        ? Math.round(params.nearestDistanceM)
        : undefined,
    radarClockHour,
    isLowPowerMode: Boolean(params.isLowPowerMode),
  };
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

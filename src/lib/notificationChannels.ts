export const STORAGE_KEY_SILENT_ALERTS = '@ghostrun:tactical_silent_alerts';

export interface ChannelSpec {
  id: string;
  name: string;
  description: string;
  sound: string | null;
  vibrationPattern: number[];
  importance: number; // 4 = HIGH, 3 = DEFAULT in Android
}

export const TACTICAL_CHANNELS: ChannelSpec[] = [
  {
    id: 'tactical-alerts',
    name: 'Tactical Radar & Ping Alerts',
    description: 'Silent vibration pulses for radar pings, heat sweeps, and boundary alerts.',
    sound: null,
    vibrationPattern: [0, 150, 100, 150],
    importance: 4, // AndroidImportance.HIGH
  },
  {
    id: 'match-events',
    name: 'Match Lifecycle & Phase Shifts',
    description: 'Tactile notification pulses for match start, countdowns, and end of round.',
    sound: null,
    vibrationPattern: [0, 300, 150, 300],
    importance: 4, // AndroidImportance.HIGH
  },
  {
    id: 'lobby-comms',
    name: 'Lobby & Tactical Comms',
    description: 'Notifications for friend lobby invites and sensor checks.',
    sound: null,
    vibrationPattern: [0, 100, 100, 100],
    importance: 3, // AndroidImportance.DEFAULT
  },
];

/**
 * Finds a tactical channel specification by ID.
 */
export function getTacticalChannel(channelId: string): ChannelSpec | undefined {
  return TACTICAL_CHANNELS.find((c) => c.id === channelId);
}

/**
 * Returns true if the channel ID is a recognized tactical notification channel.
 */
export function isTacticalChannel(channelId: string): boolean {
  return TACTICAL_CHANNELS.some((c) => c.id === channelId);
}

/**
 * Resolves the user's preference for silent tactical alerts.
 * Defaults to true (stealth/silent mode) when unset or uninitialized.
 */
export function resolveSilentAlertsState(storedValue: string | null | undefined): boolean {
  if (storedValue === null || storedValue === undefined) {
    return true; // Default ON
  }
  return storedValue !== 'false';
}

/**
 * Validates a tactical vibration pattern (must be an array of non-negative integers).
 */
export function validateTacticalVibrationPattern(pattern: number[]): boolean {
  if (!Array.isArray(pattern) || pattern.length === 0) return false;
  return pattern.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
}

export interface TacticalNotificationContent {
  title: string;
  body: string;
  sound: string | null;
  channelId: string;
  vibrate?: number[];
  data?: Record<string, unknown>;
}

/**
 * Builds an in-game notification content payload honoring stealth silent rules.
 */
export function buildNotificationPayload(
  channelId: string,
  title: string,
  body: string,
  isSilent: boolean = true,
  data?: Record<string, unknown>
): TacticalNotificationContent {
  const channel = getTacticalChannel(channelId);
  return {
    title,
    body,
    channelId,
    sound: isSilent ? null : 'default',
    vibrate: channel?.vibrationPattern ?? [0, 150, 100, 150],
    data: {
      ...data,
      isTactical: true,
      channelId,
      silent: isSilent,
    },
  };
}

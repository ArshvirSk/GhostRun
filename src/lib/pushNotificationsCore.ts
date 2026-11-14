/**
 * NF-12: Remote Push Notifications Core Logic & Builders
 *
 * Defines remote push categories, payload structures, and token validators.
 */

export type PushNotificationCategory =
  | 'lobby_invites'
  | 'game_starting'
  | 'scheduled_reminders';

export interface PushNotificationPreferences {
  lobby_invites: boolean;
  game_starting: boolean;
  scheduled_reminders: boolean;
}

export const DEFAULT_PUSH_PREFERENCES: Readonly<PushNotificationPreferences> = {
  lobby_invites: true,
  game_starting: true,
  scheduled_reminders: true,
};

export interface PushPayload {
  to: string;
  title: string;
  body: string;
  data: Record<string, string | number>;
  channelId: string;
  priority: 'default' | 'high';
}

/**
 * Validates Expo or FCM push tokens.
 */
export function validatePushToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const trimmed = token.trim();
  // Standard Expo token format: ExponentPushToken[...] or ExpoPushToken[...] or long FCM string
  if (trimmed.startsWith('ExponentPushToken[') || trimmed.startsWith('ExpoPushToken[')) {
    return trimmed.endsWith(']') && trimmed.length > 25;
  }
  return trimmed.length >= 20;
}

/**
 * Formats structured notification payloads for backend dispatcher.
 */
export function buildPushPayload(
  recipientToken: string,
  category: PushNotificationCategory,
  params: {
    hostName?: string;
    modeName?: string;
    lobbyCode?: string;
    startsInMinutes?: number;
  }
): PushPayload {
  let title = 'GhostRun Notification';
  let body = 'Operational message received.';
  let channelId = 'tactical-alerts';
  let priority: PushPayload['priority'] = 'default';

  if (category === 'lobby_invites') {
    title = `Lobby Invite: ${params.modeName || 'Classic Chase'}`;
    body = `${params.hostName || 'An operative'} invited you to join lobby ${params.lobbyCode || '----'}.`;
    channelId = 'lobby-comms';
    priority = 'high';
  } else if (category === 'game_starting') {
    title = `Mission Deploying: ${params.modeName || 'GhostRun'}`;
    body = `Round is beginning now in lobby ${params.lobbyCode || '----'}! Return to the grid.`;
    channelId = 'tactical-alerts';
    priority = 'high';
  } else if (category === 'scheduled_reminders') {
    title = `Upcoming Mission Reminder`;
    body = `Operation ${params.modeName || 'GhostRun'} begins in ${params.startsInMinutes || 15} minutes.`;
    channelId = 'match-events';
    priority = 'default';
  }

  return {
    to: recipientToken.trim(),
    title,
    body,
    data: {
      category,
      lobbyCode: params.lobbyCode || '',
    },
    channelId,
    priority,
  };
}

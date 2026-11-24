/**
 * NF-12: Remote Push Notifications Core Logic & Builders
 *
 * Defines remote push categories, payload structures, token validators,
 * and dispatch preference gating.
 */

export type PushNotificationCategory =
  | 'lobby_invites'
  | 'game_starting'
  | 'scheduled_reminders'
  | 'crew_invite';

export interface PushNotificationPreferences {
  lobby_invites: boolean;
  game_starting: boolean;
  scheduled_reminders: boolean;
  crew_invite: boolean;
}

export const DEFAULT_PUSH_PREFERENCES: Readonly<PushNotificationPreferences> = {
  lobby_invites: true,
  game_starting: true,
  scheduled_reminders: true,
  crew_invite: true,
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
 * Classifies token type or returns 'invalid'.
 */
export function getPushTokenType(token: string): 'expo' | 'fcm' | 'invalid' {
  if (!token || typeof token !== 'string') return 'invalid';
  const trimmed = token.trim();
  if (trimmed.startsWith('ExponentPushToken[') || trimmed.startsWith('ExpoPushToken[')) {
    return trimmed.endsWith(']') && trimmed.length > 25 ? 'expo' : 'invalid';
  }
  if (/^[a-zA-Z0-9_\-.:]{20,256}$/.test(trimmed)) {
    return 'fcm';
  }
  return 'invalid';
}

/**
 * Validates Expo or FCM push tokens.
 */
export function validatePushToken(token: string): boolean {
  return getPushTokenType(token) !== 'invalid';
}

/**
 * Checks whether user preferences allow dispatching a push in a given category.
 */
export function shouldDispatchPush(
  category: PushNotificationCategory,
  preferences?: Partial<PushNotificationPreferences>
): boolean {
  if (!preferences) return true;
  return preferences[category] ?? DEFAULT_PUSH_PREFERENCES[category] ?? true;
}

export interface BuildPushParams {
  hostName?: string;
  modeName?: string;
  lobbyCode?: string;
  crewName?: string;
  crewCode?: string;
  startsInMinutes?: number;
}

/**
 * Formats structured notification payloads for backend dispatcher.
 */
export function buildPushPayload(
  recipientToken: string,
  category: PushNotificationCategory,
  params: BuildPushParams
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
  } else if (category === 'crew_invite') {
    title = `Squad Invite: ${params.crewName || 'Ghost Squad'}`;
    body = `You were invited to join ${params.crewName || 'a squad'} (Code: ${params.crewCode || '----'}).`;
    channelId = 'lobby-comms';
    priority = 'default';
  }

  return {
    to: recipientToken.trim(),
    title,
    body,
    data: {
      category,
      lobbyCode: params.lobbyCode || '',
      crewCode: params.crewCode || '',
    },
    channelId,
    priority,
  };
}

/**
 * Batches payloads across multiple recipient tokens, pruning invalid tokens.
 */
export function buildBatchPushPayloads(
  tokens: string[],
  category: PushNotificationCategory,
  params: BuildPushParams,
  preferences?: Partial<PushNotificationPreferences>
): PushPayload[] {
  if (!shouldDispatchPush(category, preferences)) {
    return [];
  }

  const validTokens = tokens.filter(validatePushToken);
  return validTokens.map((token) => buildPushPayload(token, category, params));
}

/**
 * NF-07 Team Radio & NF-08 Moderation Engine
 *
 * Provides team-isolated radio comms, tactical quick chips,
 * rate limiting guards, message sanitization, and blocklist filtering.
 */

export const MAX_RADIO_MESSAGE_LENGTH = 200;
export const RADIO_MIN_INTERVAL_MS = 1000; // 1 msg/sec
export const RADIO_MAX_PER_MINUTE = 20;

export interface RadioQuickChip {
  id: string;
  label: string;
  intent: 'danger' | 'warning' | 'safe' | 'neutral';
}

export const RADIO_QUICK_CHIPS: readonly RadioQuickChip[] = [
  { id: 'hunter_nearby', label: 'Hunter nearby!', intent: 'danger' },
  { id: 'safe', label: "I'm safe", intent: 'safe' },
  { id: 'on_the_move', label: 'On the move', intent: 'neutral' },
  { id: 'need_help', label: 'Need help', intent: 'warning' },
  { id: 'regroup', label: 'Regroup', intent: 'neutral' },
  { id: 'clear_area', label: 'Clear area', intent: 'safe' },
] as const;

export interface TeamMessage {
  id: string;
  game_id: string;
  team: 'runner' | 'hunter' | string;
  sender_player_id: string;
  sender_user_id: string;
  sender_name: string;
  kind: 'text' | 'chip' | 'system';
  body: string;
  created_at: string;
}

// Basic profane words filter list for field comms
const BLOCKED_WORDS = [
  'fuck', 'shit', 'asshole', 'bitch', 'cunt', 'dick', 'nigger', 'faggot',
  'whore', 'bastard', 'slut'
];

/**
 * Finds a quick chip by ID.
 */
export function getRadioQuickChip(id: string): RadioQuickChip | undefined {
  return RADIO_QUICK_CHIPS.find((c) => c.id === id);
}

/**
 * Returns true if an ID matches an approved canonical tactical chip.
 */
export function isRadioQuickChip(id: string): boolean {
  return RADIO_QUICK_CHIPS.some((c) => c.id === id);
}

/**
 * Checks if a message body passes sanity and basic moderation rules.
 */
export function sanitizeRadioMessage(raw: string): {
  cleanText: string;
  isValid: boolean;
  isCensored: boolean;
  error?: string;
} {
  if (!raw || typeof raw !== 'string') {
    return { cleanText: '', isValid: false, isCensored: false, error: 'Empty message' };
  }

  const trimmed = raw.trim();
  if (trimmed.length < 1) {
    return { cleanText: '', isValid: false, isCensored: false, error: 'Message cannot be empty' };
  }
  if (trimmed.length > MAX_RADIO_MESSAGE_LENGTH) {
    return {
      cleanText: trimmed.slice(0, MAX_RADIO_MESSAGE_LENGTH),
      isValid: false,
      isCensored: false,
      error: `Message exceeds ${MAX_RADIO_MESSAGE_LENGTH} characters`,
    };
  }

  let clean = trimmed;
  let isCensored = false;

  for (const word of BLOCKED_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(clean)) {
      clean = clean.replace(regex, '*'.repeat(word.length));
      isCensored = true;
    }
  }

  return {
    cleanText: clean,
    isValid: true,
    isCensored,
  };
}

/**
 * Evaluates rate limit against recent timestamps.
 * Rule: max 1 per second, max 20 per 60 seconds.
 */
export function checkRadioRateLimit(
  recentTimestamps: number[],
  now = Date.now()
): { allowed: boolean; reason?: 'second' | 'minute'; waitMs: number } {
  // Sort descending
  const sorted = [...recentTimestamps].sort((a, b) => b - a);

  // Check 1-second burst
  if (sorted.length > 0) {
    const elapsedSinceLast = now - sorted[0];
    if (elapsedSinceLast < RADIO_MIN_INTERVAL_MS) {
      return {
        allowed: false,
        reason: 'second',
        waitMs: RADIO_MIN_INTERVAL_MS - elapsedSinceLast,
      };
    }
  }

  // Check 60-second window
  const inWindow = sorted.filter((t) => now - t < 60000);
  if (inWindow.length >= RADIO_MAX_PER_MINUTE) {
    const oldestInWindow = inWindow[inWindow.length - 1];
    const waitMs = 60000 - (now - oldestInWindow);
    return {
      allowed: false,
      reason: 'minute',
      waitMs: Math.max(waitMs, 1000),
    };
  }

  return { allowed: true, waitMs: 0 };
}

/**
 * Filters out messages sent by blocked users.
 */
export function filterBlockedMessages(
  messages: TeamMessage[],
  blockedUserIds: Set<string>
): TeamMessage[] {
  if (!blockedUserIds || blockedUserIds.size === 0) return messages;
  return messages.filter((m) => !blockedUserIds.has(m.sender_user_id));
}

/**
 * Filters out messages that have been reported by the local user.
 */
export function filterReportedMessages(
  messages: TeamMessage[],
  reportedMessageIds: Set<string>
): TeamMessage[] {
  if (!reportedMessageIds || reportedMessageIds.size === 0) return messages;
  return messages.filter((m) => !reportedMessageIds.has(m.id));
}

/**
 * Builds a structured TeamMessage for a tactical quick chip.
 */
export function buildRadioChipMessage(params: {
  gameId: string;
  team: string;
  playerId: string;
  userId: string;
  userName: string;
  chipId: string;
  id?: string;
  createdAt?: string;
}): TeamMessage | null {
  const chip = getRadioQuickChip(params.chipId);
  if (!chip) return null;

  return {
    id: params.id ?? `chip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    game_id: params.gameId,
    team: params.team,
    sender_player_id: params.playerId,
    sender_user_id: params.userId,
    sender_name: params.userName,
    kind: 'chip',
    body: chip.label,
    created_at: params.createdAt ?? new Date().toISOString(),
  };
}

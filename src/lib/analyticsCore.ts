/**
 * NF-17: Pure Analytics Types & Sanitization Core
 *
 * Strict privacy rule: rejects coordinates, personal names, and message bodies.
 */

export const STORAGE_KEY_ANALYTICS_OPT_IN = '@ghostrun:analytics_opt_in';

export type AnalyticsEventType =
  | 'install'
  | 'signup_completed'
  | 'lobby_joined'
  | 'game_started'
  | 'game_completed'
  | 'rematch_started'
  | 'crash_reported';

const FORBIDDEN_KEYS = new Set([
  'lat',
  'lng',
  'latitude',
  'longitude',
  'coordinates',
  'display_name',
  'name',
  'email',
  'message',
  'body',
]);

/**
 * Pure sanitizer filtering out any sensitive or location keys.
 */
export function sanitizeAnalyticsPayload(
  rawPayload: Record<string, any>
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(rawPayload)) {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_KEYS.has(lowerKey)) {
      continue;
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

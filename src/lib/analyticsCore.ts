/**
 * NF-17: Pure Analytics Types & Sanitization Core
 *
 * Strict privacy rule: rejects coordinates, personal names, phone numbers,
 * exact telemetry fixes, and raw message bodies.
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

export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'lat',
  'lng',
  'latitude',
  'longitude',
  'coordinates',
  'location',
  'position',
  'trail',
  'heading',
  'altitude',
  'speed',
  'accuracy',
  'display_name',
  'name',
  'username',
  'user_name',
  'email',
  'phone',
  'phone_number',
  'ip',
  'ip_address',
  'address',
  'message',
  'body',
]);

/**
 * Pure sanitizer filtering out any sensitive, identifying, or location keys.
 */
export function sanitizeAnalyticsPayload(
  rawPayload: Record<string, any>
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(rawPayload || {})) {
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

/**
 * Resolves analytics consent status.
 * Per Consent C7, analytics is strictly opt-in and defaults to FALSE when unset.
 */
export function isAnalyticsOptedIn(storedValue: string | null | undefined): boolean {
  return storedValue === 'true';
}

export interface AnalyticsEnvelope {
  event: AnalyticsEventType;
  payload: Record<string, string | number | boolean>;
  timestamp: string;
}

/**
 * Builds an anonymized analytics envelope if consent is active.
 * Returns null if user has not opted into diagnostics.
 */
export function buildAnalyticsEnvelope(
  eventType: AnalyticsEventType,
  rawPayload: Record<string, any>,
  isOptedIn: boolean,
  timestamp: string = new Date().toISOString()
): AnalyticsEnvelope | null {
  if (!isOptedIn) return null;

  return {
    event: eventType,
    payload: sanitizeAnalyticsPayload(rawPayload),
    timestamp,
  };
}

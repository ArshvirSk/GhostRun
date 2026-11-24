/**
 * NF-26: Admin Console & Remote Config Core Logic
 */

export interface RemoteConfigFlag<T = any> {
  key: string;
  value: T;
  description?: string;
  updated_at?: string;
}

export interface SystemHealthMetrics {
  total_users: number;
  active_games: number;
  total_reports: number;
  active_push_tokens: number;
  generated_at: string;
}

export const DEFAULT_REMOTE_CONFIG = {
  disabled_modes: [] as string[],
  min_app_version: '2.7.0',
  push_notifications_enabled: true,
  scheduled_games_enabled: true,
  monetisation_enabled: false,
  feature_event_mode: true,
};

/**
 * Validates a proposed update to a remote configuration flag
 */
export function validateRemoteConfigUpdate(
  key: string,
  value: any
): { valid: boolean; error?: string } {
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    return { valid: false, error: 'Remote config key must be a non-empty string' };
  }

  const normalizedKey = key.trim();

  switch (normalizedKey) {
    case 'disabled_modes':
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        return { valid: false, error: 'disabled_modes must be an array of mode string identifiers' };
      }
      return { valid: true };

    case 'min_app_version':
      if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.trim())) {
        return { valid: false, error: 'min_app_version must follow semantic versioning (e.g. 2.7.0)' };
      }
      return { valid: true };

    case 'push_notifications_enabled':
    case 'scheduled_games_enabled':
    case 'monetisation_enabled':
    case 'feature_event_mode':
      if (typeof value !== 'boolean') {
        return { valid: false, error: `${normalizedKey} must be a boolean value` };
      }
      return { valid: true };

    default:
      // Arbitrary custom flags are permitted if key is valid
      return { valid: true };
  }
}

/**
 * Formats system health metrics into an operational summary string
 */
export function formatSystemHealthSummary(metrics: SystemHealthMetrics): string {
  const users = metrics.total_users ?? 0;
  const games = metrics.active_games ?? 0;
  const reports = metrics.total_reports ?? 0;
  const pushTokens = metrics.active_push_tokens ?? 0;
  const timestamp = metrics.generated_at || 'unknown';

  return `System Health Report: ${users} total users | ${games} active games | ${reports} pending reports | ${pushTokens} active push tokens (Recorded: ${timestamp})`;
}

/**
 * Compares two semantic version strings (e.g. "2.7.4" vs "2.7.0")
 * Returns true if clientVersion >= minVersion
 */
export function isVersionSupported(clientVersion: string, minVersion: string): boolean {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const clientParts = parse(clientVersion);
  const minParts = parse(minVersion);

  for (let i = 0; i < Math.max(clientParts.length, minParts.length); i++) {
    const c = clientParts[i] || 0;
    const m = minParts[i] || 0;
    if (c > m) return true;
    if (c < m) return false;
  }
  return true;
}

/**
 * Checks if a specific mode is disabled by remote configuration
 */
export function isModeDisabled(modeId: string, disabledModes: string[]): boolean {
  if (!Array.isArray(disabledModes)) return false;
  return disabledModes.includes(modeId);
}

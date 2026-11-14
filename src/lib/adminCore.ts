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
};

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

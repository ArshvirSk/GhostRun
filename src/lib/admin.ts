/**
 * NF-26: Admin Console & Remote Config Supabase Client
 */

import { supabase } from './supabase';
import {
  RemoteConfigFlag,
  SystemHealthMetrics,
  DEFAULT_REMOTE_CONFIG,
  isVersionSupported,
  isModeDisabled,
} from './adminCore';

export * from './adminCore';

/**
 * Fetches all remote config flags from Supabase with safe defaults fallback
 */
export async function fetchRemoteConfigFlags(): Promise<{
  success: boolean;
  flags: Record<string, any>;
  error?: string;
}> {
  if (!supabase) {
    return { success: true, flags: DEFAULT_REMOTE_CONFIG };
  }

  try {
    const { data, error } = await supabase.from('remote_config_flags').select('key, value');
    if (error || !data) {
      return { success: true, flags: DEFAULT_REMOTE_CONFIG };
    }

    const flags: Record<string, any> = { ...DEFAULT_REMOTE_CONFIG };
    for (const row of data) {
      flags[row.key] = row.value;
    }

    return { success: true, flags };
  } catch (err: any) {
    return { success: true, flags: DEFAULT_REMOTE_CONFIG };
  }
}

/**
 * Checks if current authenticated user has admin privileges
 */
export async function checkIsAdmin(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.rpc('is_admin_user');
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

/**
 * Updates a remote configuration flag (Admin only)
 */
export async function updateRemoteConfigFlag(
  key: string,
  value: any,
  description?: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Database unconfigured' };

  try {
    const { error } = await supabase.rpc('set_remote_config_flag', {
      p_key: key,
      p_value: value,
      p_description: description || null,
    });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to update remote config' };
  }
}

/**
 * Fetches anonymous system health metrics (Admin only)
 */
export async function fetchSystemHealthMetrics(): Promise<{
  success: boolean;
  metrics?: SystemHealthMetrics;
  error?: string;
}> {
  if (!supabase) return { success: false, error: 'Database unconfigured' };

  try {
    const { data, error } = await supabase.rpc('get_system_health_metrics');
    if (error) return { success: false, error: error.message };
    return { success: true, metrics: data as SystemHealthMetrics };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to fetch metrics' };
  }
}

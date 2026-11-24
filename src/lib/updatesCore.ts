/**
 * GhostRun Tactical Over-The-Air (OTA) Updates Core Logic
 *
 * Provides safe abstraction over expo-updates, ensuring zero runtime crashes
 * in local development, web, or headless test runners.
 */

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'upToDate'
  | 'disabled'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  lastCheckedAt: string | null;
  manifestVersion?: string;
  error?: string;
}

/**
 * Formats tactical notification text for the update HUD banner
 */
export function formatUpdateBannerText(version?: string): string {
  if (version && version.trim().length > 0) {
    return `TACTICAL UPDATE READY // TAP TO RESTART (v${version.trim()})`;
  }
  return 'TACTICAL UPDATE READY // TAP TO RESTART';
}

/**
 * Safe update checker that probes the remote update manifest
 */
export async function checkForTacticalUpdate(options?: {
  updatesModule?: any;
  isDevelopment?: boolean;
}): Promise<{
  available: boolean;
  manifestVersion?: string;
  error?: string;
}> {
  // If explicitly in development or module disabled, gracefully pass
  if (options?.isDevelopment) {
    return { available: false };
  }

  const module = options?.updatesModule ?? getSafeUpdatesModule();
  if (!module || !module.isEnabled) {
    return { available: false };
  }

  try {
    const result = await module.checkForUpdateAsync();
    if (result && result.isAvailable) {
      const manifest = result.manifest;
      const manifestVersion = manifest?.extra?.expoClient?.version || manifest?.runtimeVersion || 'latest';
      return {
        available: true,
        manifestVersion: typeof manifestVersion === 'string' ? manifestVersion : 'latest',
      };
    }
    return { available: false };
  } catch (err: any) {
    return {
      available: false,
      error: err?.message || 'Failed to check for tactical update',
    };
  }
}

/**
 * Downloads and applies the pending update bundle
 */
export async function fetchAndApplyUpdate(updatesModule?: any): Promise<{
  success: boolean;
  error?: string;
}> {
  const module = updatesModule ?? getSafeUpdatesModule();
  if (!module || !module.isEnabled) {
    return { success: false, error: 'Updates engine is not active in this environment' };
  }

  try {
    const fetchResult = await module.fetchUpdateAsync();
    if (fetchResult && fetchResult.isNew) {
      await module.reloadAsync();
      return { success: true };
    }
    // If not new, reload anyway to apply cached bundle
    await module.reloadAsync();
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to download and apply tactical update',
    };
  }
}

/**
 * Safely resolves expo-updates native module without throwing
 */
function getSafeUpdatesModule(): any {
  try {
    // Dynamic require prevents bundling failures in environments without native updates
    return require('expo-updates');
  } catch {
    return null;
  }
}

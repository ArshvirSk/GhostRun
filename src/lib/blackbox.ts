/**
 * GhostRun Tactical Field Blackbox Telemetry Storage & Sharing
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BlackboxSession,
  serializeBlackboxToJsonl,
  parseBlackboxFromJsonl,
  validateBlackboxSession,
} from './blackboxCore';

export * from './blackboxCore';

export const STORAGE_KEY_BLACKBOX_ENABLED = '@ghostrun:blackbox_logging_enabled';

/**
 * Checks if blackbox recording is opted-in
 */
export async function isBlackboxLoggingEnabled(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEY_BLACKBOX_ENABLED);
    return val === 'true';
  } catch {
    return false;
  }
}

/**
 * Toggles blackbox recording opt-in
 */
export async function setBlackboxLoggingEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_BLACKBOX_ENABLED, enabled ? 'true' : 'false');
  } catch {
    // Non-blocking fallback
  }
}

/**
 * Gets the local directory path for blackbox session logs
 */
function getBlackboxDirectory(): string {
  return `${FileSystem.documentDirectory || ''}blackbox/`;
}

/**
 * Saves a recorded session into local device storage
 */
export async function saveBlackboxSessionToFile(session: BlackboxSession): Promise<{
  success: boolean;
  filePath?: string;
  error?: string;
}> {
  try {
    const dir = getBlackboxDirectory();
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }

    const fileName = `blackbox_${session.gameId}_${Date.now()}.ghostbox`;
    const filePath = `${dir}${fileName}`;
    const jsonlContent = serializeBlackboxToJsonl(session);

    await FileSystem.writeAsStringAsync(filePath, jsonlContent, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    return { success: true, filePath };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to save blackbox session' };
  }
}

/**
 * Shares or exports a blackbox file for offline analysis or PC simulation
 */
export async function exportBlackboxSessionFile(filePath: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      return { success: false, error: 'System sharing is unavailable on this device' };
    }

    await Sharing.shareAsync(filePath, {
      mimeType: 'text/plain',
      dialogTitle: 'Export GhostRun Mission Blackbox (.ghostbox)',
      UTI: 'public.plain-text',
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to export blackbox session' };
  }
}

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  STORAGE_KEY_SILENT_ALERTS,
  TACTICAL_CHANNELS,
  type ChannelSpec,
} from './notificationChannels';

export * from './notificationChannels';

/**
 * Configures the global in-app notification presentation handler.
 */
export function setupNotificationPresentationHandler(allowSound: boolean = false): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: allowSound,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {
    // Non-blocking in headless environments
  }
}

/**
 * Initializes and registers silent-by-default Android notification channels.
 */
export async function initTacticalNotificationChannels(soundEnabled?: boolean): Promise<void> {
  if (Platform.OS !== 'android') {
    setupNotificationPresentationHandler(Boolean(soundEnabled));
    return;
  }

  let isSilent = true;
  if (soundEnabled === undefined) {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY_SILENT_ALERTS);
      // Default to true (silent) if unset
      isSilent = stored !== 'false';
    } catch {
      isSilent = true;
    }
  } else {
    isSilent = !soundEnabled;
  }

  setupNotificationPresentationHandler(!isSilent);

  try {
    for (const channel of TACTICAL_CHANNELS) {
      await Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        description: channel.description,
        importance: channel.importance as Notifications.AndroidImportance,
        vibrationPattern: channel.vibrationPattern,
        enableVibrate: true,
        sound: isSilent ? null : 'default',
        bypassDnd: false,
        showBadge: false,
      });
    }
  } catch {
    // Non-blocking fallback
  }
}

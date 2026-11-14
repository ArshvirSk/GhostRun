import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';
import {
  PushNotificationPreferences,
  DEFAULT_PUSH_PREFERENCES,
  validatePushToken,
} from './pushNotificationsCore';

export * from './pushNotificationsCore';

/**
 * Registers device push token with Supabase backend.
 */
export async function syncPushTokenWithServer(
  preferences?: PushNotificationPreferences
): Promise<{ success: boolean; token?: string; error?: string }> {
  if (!supabase) return { success: false, error: 'Supabase unconfigured' };

  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      return { success: false, error: 'Permission not granted' };
    }

    const tokenRes = await Notifications.getExpoPushTokenAsync().catch(() => null);
    if (!tokenRes || !validatePushToken(tokenRes.data)) {
      return { success: false, error: 'Failed to retrieve valid push token' };
    }

    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android';

    const { error: rpcErr } = await supabase.rpc('register_push_token', {
      p_token: tokenRes.data,
      p_platform: platform,
      p_categories: preferences || DEFAULT_PUSH_PREFERENCES,
    });

    if (rpcErr) {
      return { success: false, error: rpcErr.message };
    }

    return { success: true, token: tokenRes.data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown push sync error' };
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  STORAGE_KEY_ANALYTICS_OPT_IN,
  AnalyticsEventType,
  sanitizeAnalyticsPayload,
} from './analyticsCore';

export * from './analyticsCore';

/**
 * Gets local opt-in state for anonymous analytics. Default: false (strictly opt-in).
 */
export async function getAnalyticsOptIn(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEY_ANALYTICS_OPT_IN);
    return val === 'true';
  } catch {
    return false;
  }
}

/**
 * Persists local opt-in preference.
 */
export async function setAnalyticsOptIn(optIn: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_ANALYTICS_OPT_IN, optIn ? 'true' : 'false');
  } catch {
    // Non-blocking
  }
}

/**
 * Records an anonymous event if opt-in is granted.
 */
export async function logAnalyticsEvent(
  event: AnalyticsEventType,
  payload: Record<string, any> = {}
): Promise<boolean> {
  const isOptedIn = await getAnalyticsOptIn();
  if (!isOptedIn) {
    return false;
  }

  const cleanPayload = sanitizeAnalyticsPayload(payload);
  if (__DEV__) {
    console.log(`[ANALYTICS] ${event}`, cleanPayload);
  }
  return true;
}

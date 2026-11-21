import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DeadZoneTelemetryItem,
  STORAGE_KEY_BATTERY_GUARD,
  STORAGE_KEY_OFFLINE_QUEUE_ENABLED,
  STORAGE_KEY_DEADZONE_QUEUE,
  STORAGE_KEY_OFFLINE_REPLAY_PREFIX,
  MAX_DEADZONE_QUEUE_CAPACITY,
  enqueueTelemetryItem,
  drainTelemetryQueue,
} from './batteryResilienceCore';
import type { GeoFix } from './location';

let inMemoryQueue: DeadZoneTelemetryItem[] = [];
let memoryLoaded = false;
let isDraining = false;

async function loadQueueFromStorage(): Promise<DeadZoneTelemetryItem[]> {
  if (memoryLoaded) return inMemoryQueue;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DEADZONE_QUEUE);
    if (raw) {
      inMemoryQueue = JSON.parse(raw);
    }
  } catch {
    inMemoryQueue = [];
  }
  memoryLoaded = true;
  return inMemoryQueue;
}

async function persistQueueToStorage(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_DEADZONE_QUEUE, JSON.stringify(inMemoryQueue));
  } catch {
    // Non-fatal storage write failure
  }
}

/**
 * Checks whether offline queueing is enabled by user preference (default: true).
 */
export async function isOfflineQueueEnabled(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEY_OFFLINE_QUEUE_ENABLED);
    return val !== 'false';
  } catch {
    return true;
  }
}

/**
 * Updates offline queueing user preference.
 */
export async function setOfflineQueueEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_OFFLINE_QUEUE_ENABLED, enabled ? 'true' : 'false');
  } catch {
    // Ignore
  }
}

/**
 * Checks whether adaptive battery guard is enabled (default: true).
 */
export async function isBatteryGuardEnabled(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEY_BATTERY_GUARD);
    return val !== 'false';
  } catch {
    return true;
  }
}

/**
 * Updates adaptive battery guard preference.
 */
export async function setBatteryGuardEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_BATTERY_GUARD, enabled ? 'true' : 'false');
  } catch {
    // Ignore
  }
}

/**
 * Enqueues a failed or offline location fix into durable storage.
 */
export async function enqueueDeadZoneFix(gameId: string, fix: GeoFix): Promise<boolean> {
  const enabled = await isOfflineQueueEnabled();
  if (!enabled || !gameId) return false;

  await loadQueueFromStorage();

  const item: DeadZoneTelemetryItem = {
    id: `${gameId}-${fix.timestamp}-${Math.random().toString(36).substring(2, 6)}`,
    gameId,
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracy: fix.accuracy,
    speed: fix.speed,
    heading: fix.heading,
    timestamp: fix.timestamp,
    recordedAt: new Date(fix.timestamp).toISOString(),
    attempts: 0,
  };

  const { queue } = enqueueTelemetryItem(inMemoryQueue, item, MAX_DEADZONE_QUEUE_CAPACITY);
  inMemoryQueue = queue;
  await persistQueueToStorage();
  return true;
}

/**
 * Retrieves the count of queued fixes.
 */
export async function getDeadZoneQueueCount(): Promise<number> {
  await loadQueueFromStorage();
  return inMemoryQueue.length;
}

/**
 * Retrieves current dead-zone queue snapshot.
 */
export async function getDeadZoneQueue(): Promise<DeadZoneTelemetryItem[]> {
  await loadQueueFromStorage();
  return [...inMemoryQueue];
}

/**
 * Drains and transmits queued dead-zone fixes using the provided transmitter callback.
 */
export async function drainDeadZoneQueue(
  transmitter: (item: DeadZoneTelemetryItem) => Promise<boolean>,
  batchLimit: number = 20
): Promise<{ transmitted: number; failed: number }> {
  if (isDraining) return { transmitted: 0, failed: 0 };
  isDraining = true;

  try {
    await loadQueueFromStorage();
    if (inMemoryQueue.length === 0) {
      return { transmitted: 0, failed: 0 };
    }

    const { batch, remaining } = drainTelemetryQueue(inMemoryQueue, batchLimit);
    let transmitted = 0;
    let failed = 0;
    const retryItems: DeadZoneTelemetryItem[] = [];

    for (const item of batch) {
      try {
        const ok = await transmitter(item);
        if (ok) {
          transmitted++;
        } else {
          failed++;
          item.attempts += 1;
          if (item.attempts < 5) {
            retryItems.push(item);
          }
        }
      } catch {
        failed++;
        item.attempts += 1;
        if (item.attempts < 5) {
          retryItems.push(item);
        }
      }
    }

    inMemoryQueue = [...retryItems, ...remaining];
    await persistQueueToStorage();

    return { transmitted, failed };
  } finally {
    isDraining = false;
  }
}

/**
 * Clears all queued items in dead-zone storage.
 */
export async function clearDeadZoneQueue(): Promise<void> {
  inMemoryQueue = [];
  memoryLoaded = true;
  await AsyncStorage.removeItem(STORAGE_KEY_DEADZONE_QUEUE);
}

/**
 * Caches match replay data locally so replay works offline.
 */
export async function saveMatchReplayOffline(gameId: string, replayData: any): Promise<void> {
  if (!gameId || !replayData) return;
  try {
    const key = `${STORAGE_KEY_OFFLINE_REPLAY_PREFIX}${gameId}`;
    await AsyncStorage.setItem(key, JSON.stringify(replayData));
  } catch {
    // Ignore storage write error
  }
}

/**
 * Retrieves locally cached match replay data for dead-zone viewing.
 */
export async function getMatchReplayOffline(gameId: string): Promise<any | null> {
  if (!gameId) return null;
  try {
    const key = `${STORAGE_KEY_OFFLINE_REPLAY_PREFIX}${gameId}`;
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Safe polyfill for Node / test environments
if (typeof (globalThis as any).__DEV__ === 'undefined') {
  (globalThis as any).__DEV__ = false;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

export const LAST_LOCATION_KEY = '@ghostrun:last_location_coords';

// Global in-memory cache for 0ms instantaneous reads
let memoryLocation: [number, number] | null = null;
let watcherSubscription: Location.LocationSubscription | null = null;
let isPrewarming = false;

// Eagerly hydrate memory cache from persistent storage on module import
AsyncStorage.getItem(LAST_LOCATION_KEY)
  .then((raw) => {
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.length === 2 &&
          typeof parsed[0] === 'number' &&
          typeof parsed[1] === 'number' &&
          !isNaN(parsed[0]) &&
          !isNaN(parsed[1])
        ) {
          memoryLocation = parsed as [number, number];
        }
      } catch {}
    }
  })
  .catch(() => {});

/**
 * Returns the currently cached coordinates with 0.00ms latency.
 */
export function getInstantLocation(): [number, number] | null {
  return memoryLocation;
}

/**
 * Updates the in-memory location and persists to AsyncStorage.
 */
export function updateCachedLocation(coords: [number, number]): void {
  if (!coords || !Array.isArray(coords) || coords.length !== 2) return;
  memoryLocation = coords;
  void AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(coords));
}

/**
 * Priority-cascade coordinate resolver:
 * 1. In-memory cache (0ms)
 * 2. OS Fused Location Provider cache (<5ms)
 * 3. AsyncStorage (<10ms)
 * 4. Fast network/cell/wifi position (<=1500ms)
 */
export async function getFastestGpsCoords(): Promise<[number, number] | null> {
  // 1. In-memory cache (0ms)
  if (memoryLocation) {
    return memoryLocation;
  }

  // 2. Android fused location cache (<5ms)
  try {
    const lastPos = await Location.getLastKnownPositionAsync({ maxAge: 86400000 });
    if (lastPos?.coords?.longitude && lastPos?.coords?.latitude) {
      const coords: [number, number] = [lastPos.coords.longitude, lastPos.coords.latitude];
      updateCachedLocation(coords);
      return coords;
    }
  } catch {}

  // 3. Persistent storage
  try {
    const stored = await AsyncStorage.getItem(LAST_LOCATION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'number') {
        const coords = parsed as [number, number];
        memoryLocation = coords;
        return coords;
      }
    }
  } catch {}

  // 4. Fast network/cell/wifi position (low accuracy, <= 1500ms)
  try {
    const quickPos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (quickPos?.coords?.longitude && quickPos?.coords?.latitude) {
      const coords: [number, number] = [quickPos.coords.longitude, quickPos.coords.latitude];
      updateCachedLocation(coords);
      return coords;
    }
  } catch {}

  return null;
}

/**
 * Starts non-blocking background location pre-warming.
 * Called as soon as permissions exist (e.g. Play tab or Step 1 Mode).
 */
export async function startLocationPrewarm(): Promise<void> {
  if (isPrewarming || watcherSubscription) return;
  isPrewarming = true;

  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) {
      isPrewarming = false;
      return;
    }

    // Step 1: Immediately grab last known location
    const lastPos = await Location.getLastKnownPositionAsync({ maxAge: 86400000 });
    if (lastPos?.coords?.longitude && lastPos?.coords?.latitude) {
      updateCachedLocation([lastPos.coords.longitude, lastPos.coords.latitude]);
    }

    // Step 2: Subscribe to low-power position updates so cache is ALWAYS fresh
    watcherSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 10,
        timeInterval: 10000,
      },
      (loc) => {
        if (loc?.coords?.longitude && loc?.coords?.latitude) {
          updateCachedLocation([loc.coords.longitude, loc.coords.latitude]);
        }
      }
    );
  } catch {
    // Non-fatal, pre-warming is best-effort
  } finally {
    isPrewarming = false;
  }
}

/**
 * Stops the prewarm watcher if necessary.
 */
export function stopLocationPrewarm(): void {
  if (watcherSubscription) {
    watcherSubscription.remove();
    watcherSubscription = null;
  }
}

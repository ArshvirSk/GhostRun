import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Linking } from 'react-native';

import { supabase } from './supabase';

/**
 * Location sharing for a live round.
 *
 * The background task is the single uploader when Android/iOS grants background
 * location. If the player only allows "while using the app", the round screen
 * falls back to the foreground watcher and uploads from there. Only the newest
 * fix matters, so a failed upload is simply retried with the next fix instead of
 * replaying a queue of stale points.
 */
export const LOCATION_TASK = 'ghostrun-location';

const ACTIVE_GAME_KEY = 'ghostrun.active-game';
const UPLOAD_THROTTLE_MS = 5_000;
const UPLOAD_INTERVAL_MS = 5_000;
const UPLOAD_DISTANCE_M = 5;

export type GeoFix = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
  isMock?: boolean;
};

export type StartLocationResult =
  | { ok: true; background: boolean; message: string }
  | { ok: false; reason: 'not-configured' | 'denied' | 'error'; message: string };

let lastUploadAt = 0;

function toFix(location: Location.LocationObject): GeoFix {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy ?? null,
    speed:
      location.coords.speed !== null && location.coords.speed >= 0 ? location.coords.speed : null,
    heading:
      location.coords.heading !== null && location.coords.heading >= 0
        ? location.coords.heading
        : null,
    timestamp: location.timestamp,
  };
}

async function activeGameId() {
  return AsyncStorage.getItem(ACTIVE_GAME_KEY);
}

async function stopTracking() {
  try {
    await AsyncStorage.removeItem(ACTIVE_GAME_KEY);
    lastUploadAt = 0;
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // The task can already be gone when the OS killed the app; nothing to stop.
  }
}

/**
 * Upload the newest fix for the active round. Throttled so the task and the
 * foreground watcher cannot double-post, and a no-op when no round is active.
 */
export async function uploadLocation(fix: GeoFix): Promise<void> {
  const gameId = await activeGameId();
  if (!gameId || !supabase) return;

  const now = Date.now();
  if (now - lastUploadAt < UPLOAD_THROTTLE_MS) return;
  lastUploadAt = now;

  const { data, error } = await supabase.rpc('submit_position', {
    game_id: gameId,
    lat: fix.latitude,
    lng: fix.longitude,
    accuracy: fix.accuracy,
    speed: fix.speed,
    heading: fix.heading,
    is_mock: fix.isMock ?? false,
    recorded_at: new Date(fix.timestamp).toISOString(),
  });

  if (error) {
    if (/not a member|not a player|game not found/i.test(error.message)) {
      await stopTracking();
    }
    return;
  }

  const state = data as { phase?: string; my_status?: string } | null;
  if (
    state?.phase === 'ended' ||
    state?.phase === 'cancelled' ||
    (state?.my_status && state.my_status !== 'active')
  ) {
    await stopTracking();
  }
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  const newest = locations?.[locations.length - 1];
  if (newest) await uploadLocation(toFix(newest));
});

/**
 * Ask for foreground and background permission, then start the background task
 * when the OS allows it. Foreground-only permission is still a usable result:
 * the round screen keeps uploading while it is open.
 */
export async function startLocationSharing(gameId: string): Promise<StartLocationResult> {
  if (!supabase) {
    return {
      ok: false,
      reason: 'not-configured',
      message: 'Supabase is not configured in this build.',
    };
  }

  let foreground: Location.LocationPermissionResponse;
  try {
    foreground = await Location.requestForegroundPermissionsAsync();
  } catch {
    return {
      ok: false,
      reason: 'error',
      message: 'Your phone could not open the location permission prompt.',
    };
  }
  if (foreground.status !== 'granted') {
    return {
      ok: false,
      reason: 'denied',
      message: 'GhostRun needs location access to show your position to your team.',
    };
  }

  // On Android 11+ this can take the player to system settings. A refusal is not
  // fatal: the foreground watcher still shares while the round screen is open.
  let backgroundGranted = false;
  try {
    const background = await Location.requestBackgroundPermissionsAsync();
    backgroundGranted = background.status === 'granted';
  } catch {
    backgroundGranted = false;
  }

  await AsyncStorage.setItem(ACTIVE_GAME_KEY, gameId);
  lastUploadAt = 0;

  if (!backgroundGranted) {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      }
    } catch {
      // Ignore: the task may not have been registered in this build yet.
    }
    return {
      ok: true,
      background: false,
      message:
        'Sharing while GhostRun is open. Allow “all the time” location to keep sharing with the screen off.',
    };
  }

  try {
    if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: UPLOAD_INTERVAL_MS,
        distanceInterval: UPLOAD_DISTANCE_M,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'GhostRun is sharing your position',
          notificationBody: 'Your team can see you while the round is live.',
          notificationColor: '#1D4ED8',
        },
      });
    }
  } catch {
    return {
      ok: true,
      background: false,
      message: 'Background location could not start, so sharing works only while GhostRun is open.',
    };
  }

  return {
    ok: true,
    background: true,
    message: 'Sharing with your team, including when the screen is off.',
  };
}

export async function stopLocationSharing(): Promise<void> {
  await stopTracking();
}

/** Smooth own-position marker for the map; the task remains the uploader. */
export function watchLocation(onFix: (fix: GeoFix) => void): () => void {
  let subscription: Location.LocationSubscription | null = null;
  let cancelled = false;

  void Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 2_500,
      distanceInterval: 2,
    },
    (location) => {
      if (!cancelled) onFix(toFix(location));
    },
  )
    .then((next) => {
      if (cancelled) next.remove();
      else subscription = next;
    })
    .catch(() => {
      // The round screen shows the permission state; a watcher failure is not fatal.
    });

  return () => {
    cancelled = true;
    subscription?.remove();
  };
}

export function openLocationSettings(): Promise<void> {
  return Linking.openSettings();
}

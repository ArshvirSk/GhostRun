import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
  evaluateTrackingHealth,
  type TrackingHealthReport,
} from './trackingHealthEvaluator';

export * from './trackingHealthEvaluator';

/**
 * Runs a live sensor diagnostic probe.
 */
export async function runTrackingHealthDiagnostic(): Promise<TrackingHealthReport> {
  let foregroundGranted = false;
  let backgroundGranted = false;
  let servicesEnabled = false;
  let notificationsGranted = true;
  let accuracyMeters: number | null = null;
  let probeTimeout = false;

  try {
    const [fg, bg, srv, notif] = await Promise.all([
      Location.getForegroundPermissionsAsync().catch(() => ({ granted: false })),
      Location.getBackgroundPermissionsAsync().catch(() => ({ granted: false })),
      Location.hasServicesEnabledAsync().catch(() => false),
      Notifications.getPermissionsAsync().catch(() => ({ granted: true })),
    ]);

    foregroundGranted = Boolean(fg.granted);
    backgroundGranted = Boolean(bg.granted);
    servicesEnabled = Boolean(srv);
    notificationsGranted = Boolean(notif.granted);

    if (foregroundGranted && servicesEnabled) {
      // 4.5s probe with high accuracy
      const probePromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 4500);
      });

      const fix = await Promise.race([probePromise, timeoutPromise]);
      if (fix && fix.coords) {
        accuracyMeters = fix.coords.accuracy ?? 20;
      } else {
        probeTimeout = true;
      }
    }
  } catch {
    probeTimeout = true;
  }

  return evaluateTrackingHealth({
    foregroundGranted,
    backgroundGranted,
    servicesEnabled,
    accuracyMeters,
    probeTimeout,
    notificationsGranted,
  });
}

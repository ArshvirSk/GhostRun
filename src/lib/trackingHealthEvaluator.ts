export type TrackingHealthState = 'healthy' | 'warning' | 'degraded' | 'unknown';

export interface DiagnosticCheckItem {
  id: 'foreground_location' | 'background_location' | 'location_services' | 'gps_accuracy' | 'notifications';
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  canFixWithSettings?: boolean;
}

export interface TrackingHealthReport {
  overall: TrackingHealthState;
  timestamp: number;
  checks: DiagnosticCheckItem[];
  accuracyMeters?: number | null;
  summary: string;
}

export const READY_CHECK_STRINGS = {
  sheetTitle: 'TRACKING HEALTH CHECK',
  sheetSubtitle: 'Verify phone sensors & GPS accuracy before deploying.',
  statusHealthy: 'OPTIMAL TRACKING',
  statusWarning: 'MARGINAL SENSORS',
  statusDegraded: 'TRACKING BLOCKED',
  locForeground: 'Location Permission',
  locForegroundPass: 'Precise GPS granted',
  locForegroundFail: 'Location permission denied',
  locBackground: 'Background Tracking',
  locBackgroundPass: 'Always allow granted (screen-off active)',
  locBackgroundWarn: 'Foreground only (screen must stay on)',
  locGpsHardware: 'Device GPS Hardware',
  locGpsHardwarePass: 'Location service enabled',
  locGpsHardwareFail: 'Device location service is OFF',
  locAccuracy: 'GPS Signal Accuracy',
  locAccuracyPass: (m: number) => `High accuracy (±${Math.round(m)}m)`,
  locAccuracyWarn: (m: number) => `Fair accuracy (±${Math.round(m)}m)`,
  locAccuracyFail: (m: number) => `Poor accuracy (±${Math.round(m)}m > 35m)`,
  locAccuracyTimeout: 'Satellite lock slow (check open sky)',
  notifications: 'Match Comms & Alerts',
  notificationsPass: 'Match notifications allowed',
  notificationsWarn: 'Notifications disabled (haptics only)',
  actionFixSettings: 'OPEN SETTINGS',
  actionRetest: 'RE-TEST SENSORS',
  actionProceedAnyway: 'PROCEED WITH WARNING',
  actionReady: 'CONFIRM & READY UP',
  batteryWarningTitle: 'BATTERY & APP KILLERS',
  batteryWarningBody:
    'Do not swipe GhostRun from recent apps. On Android, exclude GhostRun from aggressive battery optimization in Settings to prevent radar sleep.',
} as const;

/**
 * Pure evaluation function for deterministic unit testing.
 */
export function evaluateTrackingHealth(inputs: {
  foregroundGranted: boolean;
  backgroundGranted: boolean;
  servicesEnabled: boolean;
  accuracyMeters?: number | null;
  probeTimeout?: boolean;
  notificationsGranted?: boolean;
}): TrackingHealthReport {
  const checks: DiagnosticCheckItem[] = [];
  let isDegraded = false;
  let hasWarning = false;

  // 1. Foreground Location
  if (inputs.foregroundGranted) {
    checks.push({
      id: 'foreground_location',
      label: READY_CHECK_STRINGS.locForeground,
      status: 'pass',
      detail: READY_CHECK_STRINGS.locForegroundPass,
    });
  } else {
    isDegraded = true;
    checks.push({
      id: 'foreground_location',
      label: READY_CHECK_STRINGS.locForeground,
      status: 'fail',
      detail: READY_CHECK_STRINGS.locForegroundFail,
      canFixWithSettings: true,
    });
  }

  // 2. Hardware GPS Services
  if (inputs.servicesEnabled) {
    checks.push({
      id: 'location_services',
      label: READY_CHECK_STRINGS.locGpsHardware,
      status: 'pass',
      detail: READY_CHECK_STRINGS.locGpsHardwarePass,
    });
  } else {
    isDegraded = true;
    checks.push({
      id: 'location_services',
      label: READY_CHECK_STRINGS.locGpsHardware,
      status: 'fail',
      detail: READY_CHECK_STRINGS.locGpsHardwareFail,
      canFixWithSettings: true,
    });
  }

  // 3. Background Location
  if (inputs.backgroundGranted) {
    checks.push({
      id: 'background_location',
      label: READY_CHECK_STRINGS.locBackground,
      status: 'pass',
      detail: READY_CHECK_STRINGS.locBackgroundPass,
    });
  } else {
    hasWarning = true;
    checks.push({
      id: 'background_location',
      label: READY_CHECK_STRINGS.locBackground,
      status: 'warn',
      detail: READY_CHECK_STRINGS.locBackgroundWarn,
      canFixWithSettings: true,
    });
  }

  // 4. GPS Accuracy
  if (inputs.probeTimeout) {
    hasWarning = true;
    checks.push({
      id: 'gps_accuracy',
      label: READY_CHECK_STRINGS.locAccuracy,
      status: 'warn',
      detail: READY_CHECK_STRINGS.locAccuracyTimeout,
    });
  } else if (inputs.accuracyMeters != null) {
    const acc = inputs.accuracyMeters;
    if (acc <= 15) {
      checks.push({
        id: 'gps_accuracy',
        label: READY_CHECK_STRINGS.locAccuracy,
        status: 'pass',
        detail: READY_CHECK_STRINGS.locAccuracyPass(acc),
      });
    } else if (acc <= 35) {
      hasWarning = true;
      checks.push({
        id: 'gps_accuracy',
        label: READY_CHECK_STRINGS.locAccuracy,
        status: 'warn',
        detail: READY_CHECK_STRINGS.locAccuracyWarn(acc),
      });
    } else {
      isDegraded = true;
      checks.push({
        id: 'gps_accuracy',
        label: READY_CHECK_STRINGS.locAccuracy,
        status: 'fail',
        detail: READY_CHECK_STRINGS.locAccuracyFail(acc),
      });
    }
  }

  // 5. Notifications
  if (inputs.notificationsGranted !== false) {
    checks.push({
      id: 'notifications',
      label: READY_CHECK_STRINGS.notifications,
      status: 'pass',
      detail: READY_CHECK_STRINGS.notificationsPass,
    });
  } else {
    hasWarning = true;
    checks.push({
      id: 'notifications',
      label: READY_CHECK_STRINGS.notifications,
      status: 'warn',
      detail: READY_CHECK_STRINGS.notificationsWarn,
      canFixWithSettings: true,
    });
  }

  let overall: TrackingHealthState = 'healthy';
  let summary: string = READY_CHECK_STRINGS.statusHealthy;

  if (isDegraded) {
    overall = 'degraded';
    summary = READY_CHECK_STRINGS.statusDegraded;
  } else if (hasWarning) {
    overall = 'warning';
    summary = READY_CHECK_STRINGS.statusWarning;
  }

  return {
    overall,
    timestamp: Date.now(),
    checks,
    accuracyMeters: inputs.accuracyMeters,
    summary,
  };
}

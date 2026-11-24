/**
 * GhostRun Pre-Flight Hardware & Operational Readiness Engine
 *
 * Validates GPS accuracy, foreground & background location permissions,
 * battery saver exemption, audio/haptic engine, and offline tile caching
 * before entering live tactical operations.
 */

export type GpsAccuracyTier = 'optimal' | 'acceptable' | 'degraded' | 'unavailable';

export interface PreflightCheckData {
  gpsAccuracyMeters: number | null;
  foregroundLocationGranted: boolean;
  backgroundLocationGranted: boolean;
  batteryOptimizationIgnored: boolean;
  audioTested: boolean;
  hapticsTested: boolean;
  offlineMapCached: boolean;
}

export interface PreflightItemResult {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface PreflightResult {
  canProceed: boolean;
  overallStatus: 'ready' | 'caution' | 'blocked';
  tier: GpsAccuracyTier;
  items: PreflightItemResult[];
  passCount: number;
  warnCount: number;
  failCount: number;
}

/**
 * Classifies raw GPS horizontal accuracy radius into tactical readiness tiers
 */
export function classifyGpsAccuracy(accuracyM: number | null): {
  tier: GpsAccuracyTier;
  label: string;
  color: string;
} {
  if (accuracyM === null || accuracyM === undefined || accuracyM > 30) {
    return {
      tier: 'unavailable',
      label: accuracyM === null ? 'NO SATELLITE FIX' : `CRITICAL DRIFT (>30m: ±${Math.round(accuracyM)}m)`,
      color: '#FF8A75',
    };
  }

  if (accuracyM <= 5) {
    return {
      tier: 'optimal',
      label: `TACTICAL LOCK (±${accuracyM.toFixed(1)}m)`,
      color: '#C7F36B',
    };
  }

  if (accuracyM <= 15) {
    return {
      tier: 'acceptable',
      label: `ACCEPTABLE FIX (±${accuracyM.toFixed(1)}m)`,
      color: '#FBBF24',
    };
  }

  return {
    tier: 'degraded',
    label: `DEGRADED ACCURACY (±${accuracyM.toFixed(1)}m)`,
    color: '#FF8A75',
  };
}

/**
 * Evaluates all 6 physical and operational readiness checks
 */
export function evaluatePreflightReadiness(data: PreflightCheckData): PreflightResult {
  const items: PreflightItemResult[] = [];
  const gpsInfo = classifyGpsAccuracy(data.gpsAccuracyMeters);

  // 1. GPS Lock & Accuracy
  if (gpsInfo.tier === 'optimal') {
    items.push({
      id: 'gps_accuracy',
      title: 'GPS Satellite Fix',
      status: 'pass',
      detail: gpsInfo.label,
    });
  } else if (gpsInfo.tier === 'acceptable') {
    items.push({
      id: 'gps_accuracy',
      title: 'GPS Satellite Fix',
      status: 'warn',
      detail: `${gpsInfo.label} - Recommend open outdoor sky`,
    });
  } else {
    items.push({
      id: 'gps_accuracy',
      title: 'GPS Satellite Fix',
      status: 'fail',
      detail: `${gpsInfo.label} - Move to clear area away from high buildings`,
    });
  }

  // 2. Foreground Location Permission
  if (data.foregroundLocationGranted) {
    items.push({
      id: 'perm_foreground',
      title: 'Foreground Location Access',
      status: 'pass',
      detail: 'Granted for live match tracking',
    });
  } else {
    items.push({
      id: 'perm_foreground',
      title: 'Foreground Location Access',
      status: 'fail',
      detail: 'Mandatory for live radar and boundaries',
    });
  }

  // 3. Background Location Permission
  if (data.backgroundLocationGranted) {
    items.push({
      id: 'perm_background',
      title: 'Background Location Access',
      status: 'pass',
      detail: 'Active for screen-off proximity alerts',
    });
  } else {
    items.push({
      id: 'perm_background',
      title: 'Background Location Access',
      status: 'warn',
      detail: 'Set to Always Allow in OS settings for screen-off haptic pulses',
    });
  }

  // 4. Battery Optimization Status
  if (data.batteryOptimizationIgnored) {
    items.push({
      id: 'battery_saver',
      title: 'OS Battery Optimization',
      status: 'pass',
      detail: 'Exempted from aggressive background termination',
    });
  } else {
    items.push({
      id: 'battery_saver',
      title: 'OS Battery Optimization',
      status: 'warn',
      detail: 'Battery optimization may suspend GPS when phone screen sleeps',
    });
  }

  // 5. Audio & Wearable Haptic Engine
  if (data.audioTested && data.hapticsTested) {
    items.push({
      id: 'hardware_feedback',
      title: 'Audio & Haptics Engine',
      status: 'pass',
      detail: 'Binaural pings & wearable vibration verified',
    });
  } else {
    items.push({
      id: 'hardware_feedback',
      title: 'Audio & Haptics Engine',
      status: 'warn',
      detail: 'Unverified - Tap test button to calibrate volume and motor',
    });
  }

  // 6. Offline Vector Map Cache
  if (data.offlineMapCached) {
    items.push({
      id: 'offline_map',
      title: 'Offline Map Vector Pack',
      status: 'pass',
      detail: 'Local sector pre-cached for zero-data gameplay',
    });
  } else {
    items.push({
      id: 'offline_map',
      title: 'Offline Map Vector Pack',
      status: 'warn',
      detail: 'Not cached - Live cellular data will be used for terrain tiles',
    });
  }

  const passCount = items.filter((i) => i.status === 'pass').length;
  const warnCount = items.filter((i) => i.status === 'warn').length;
  const failCount = items.filter((i) => i.status === 'fail').length;

  const canProceed = data.foregroundLocationGranted && gpsInfo.tier !== 'unavailable';

  let overallStatus: 'ready' | 'caution' | 'blocked' = 'ready';
  if (!canProceed) {
    overallStatus = 'blocked';
  } else if (warnCount > 0) {
    overallStatus = 'caution';
  }

  return {
    canProceed,
    overallStatus,
    tier: gpsInfo.tier,
    items,
    passCount,
    warnCount,
    failCount,
  };
}

/**
 * Formats a clean operational summary of preflight readiness without emojis
 */
export function formatPreflightSummary(result: PreflightResult): string {
  if (result.overallStatus === 'ready') {
    return `Preflight Assessment: ALL SYSTEMS OPERATIONAL (${result.passCount}/6 checks optimal)`;
  }
  if (result.overallStatus === 'caution') {
    return `Preflight Assessment: SYSTEMS OPERATIONAL WITH ADVISORIES (${result.passCount} passed, ${result.warnCount} advisories)`;
  }
  return `Preflight Assessment: CRITICAL READINESS BLOCK (${result.failCount} failed requirements)`;
}

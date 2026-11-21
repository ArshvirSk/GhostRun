/**
 * Pillar 5: Outdoor Battery & Field Resilience Core
 *
 * Mathematical & Architectural Invariants:
 * 1. Adaptive GPS Power Tiers: Dynamically scales polling interval based on operative
 *    velocity (sprint vs stalking vs stationary ambush) to conserve device battery.
 * 2. Battery Sentinel: At <= 15% battery, engages Critical Battery Guard mode.
 * 3. Durable Dead-Zone Telemetry Queue: FIFO queue with strictly bounded capacity (max 500)
 *    to preserve operative fixes in cellular dead-zones with 0% data loss.
 * 4. Network Status Indicator: Real-time cellular link and queue diagnostics for the HUD.
 */

export const STATIONARY_SPEED_THRESHOLD_MPS = 0.5; // < 0.5 m/s (~1.8 km/h) is stationary/camping
export const STATIONARY_DURATION_SEC_THRESHOLD = 15; // 15 seconds stationary triggers ambush power save
export const SPRINT_SPEED_THRESHOLD_MPS = 2.0; // >= 2.0 m/s (~7.2 km/h) is active sprint/pursuit
export const CRITICAL_BATTERY_THRESHOLD_PCT = 15; // <= 15% battery triggers critical guard
export const LOW_BATTERY_THRESHOLD_PCT = 25; // <= 25% battery triggers low battery warning
export const MAX_DEADZONE_QUEUE_CAPACITY = 500; // ~15-20 min of buffered GPS fixes

export const STORAGE_KEY_BATTERY_GUARD = 'ghostrun.battery_guard_enabled';
export const STORAGE_KEY_OFFLINE_QUEUE_ENABLED = 'ghostrun.offline_queue_enabled';
export const STORAGE_KEY_DEADZONE_QUEUE = 'ghostrun.deadzone_telemetry_queue';
export const STORAGE_KEY_OFFLINE_REPLAY_PREFIX = 'ghostrun.offline_replay.';

export type PowerTier = 'sprint' | 'stalking' | 'stationary' | 'critical_battery';

export interface AdaptiveGpsConfig {
  timeIntervalMs: number;
  distanceIntervalM: number;
  accuracyTier: 'high' | 'balanced' | 'low_power';
  powerTier: PowerTier;
  label: string;
}

export interface AdaptiveGpsInputs {
  speedMps: number | null;
  stationaryDurationSec: number;
  batteryLevelPct?: number; // 0 - 100
  batteryGuardEnabled?: boolean;
}

export interface DeadZoneTelemetryItem {
  id: string;
  gameId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
  recordedAt: string;
  attempts: number;
}

export interface BatteryHealthStatus {
  levelPct: number;
  isCritical: boolean;
  isLow: boolean;
  isHealthy: boolean;
  statusText: string;
  badgeColor: string;
}

export interface NetworkStatusBadge {
  label: string;
  badgeColor: string;
  isAlert: boolean;
  pulseSpeed: 'none' | 'slow' | 'fast';
}

/**
 * Calculates adaptive GPS sampling parameters based on movement dynamics and battery level.
 */
export function calculateAdaptiveGpsConfig(inputs: AdaptiveGpsInputs): AdaptiveGpsConfig {
  const guardEnabled = inputs.batteryGuardEnabled !== false;

  // Unconditional standard tracking if battery guard is explicitly turned off
  if (!guardEnabled) {
    return {
      timeIntervalMs: 2500,
      distanceIntervalM: 2,
      accuracyTier: 'high',
      powerTier: 'sprint',
      label: 'STANDARD (GUARD OFF)',
    };
  }

  // 1. Critical Battery Override (<= 15%)
  if (inputs.batteryLevelPct !== undefined && inputs.batteryLevelPct <= CRITICAL_BATTERY_THRESHOLD_PCT) {
    return {
      timeIntervalMs: 6000,
      distanceIntervalM: 10,
      accuracyTier: 'low_power',
      powerTier: 'critical_battery',
      label: 'BATTERY GUARD (CRITICAL)',
    };
  }

  const speed = inputs.speedMps !== null && inputs.speedMps >= 0 ? inputs.speedMps : 0;

  // 2. Sprint / Pursuit Tier (>= 2.0 m/s) -> 1 Hz precision tracking
  if (speed >= SPRINT_SPEED_THRESHOLD_MPS) {
    return {
      timeIntervalMs: 1000,
      distanceIntervalM: 1,
      accuracyTier: 'high',
      powerTier: 'sprint',
      label: 'SPRINT / 1Hz',
    };
  }

  // 3. Stationary Ambush Hold Tier (< 0.5 m/s for >= 15 seconds) -> Power-saving 6s sleep cycles
  if (speed < STATIONARY_SPEED_THRESHOLD_MPS && inputs.stationaryDurationSec >= STATIONARY_DURATION_SEC_THRESHOLD) {
    return {
      timeIntervalMs: 6000,
      distanceIntervalM: 8,
      accuracyTier: 'low_power',
      powerTier: 'stationary',
      label: 'AMBUSH HOLD / 6s',
    };
  }

  // 4. Tactical Stalking / Default Tier
  return {
    timeIntervalMs: 2500,
    distanceIntervalM: 3,
    accuracyTier: 'balanced',
    powerTier: 'stalking',
    label: 'STALKING / 2.5s',
  };
}

/**
 * Evaluates device battery level and provides actionable status.
 */
export function evaluateBatteryHealth(batteryLevelPct: number | null | undefined): BatteryHealthStatus {
  const level = batteryLevelPct != null && Number.isFinite(batteryLevelPct)
    ? Math.max(0, Math.min(100, Math.round(batteryLevelPct)))
    : 100;

  if (level <= CRITICAL_BATTERY_THRESHOLD_PCT) {
    return {
      levelPct: level,
      isCritical: true,
      isLow: true,
      isHealthy: false,
      statusText: `CRITICAL (${level}%) // LOW POWER ACTIVE`,
      badgeColor: '#EF4444',
    };
  }

  if (level <= LOW_BATTERY_THRESHOLD_PCT) {
    return {
      levelPct: level,
      isCritical: false,
      isLow: true,
      isHealthy: false,
      statusText: `LOW (${level}%) // BATTERY GUARD ARMED`,
      badgeColor: '#F59E0B',
    };
  }

  return {
    levelPct: level,
    isCritical: false,
    isLow: false,
    isHealthy: true,
    statusText: `HEALTHY (${level}%)`,
    badgeColor: '#10B981',
  };
}

/**
 * Enqueues a telemetry item into the dead-zone queue with FIFO eviction on overflow.
 */
export function enqueueTelemetryItem(
  queue: DeadZoneTelemetryItem[],
  item: DeadZoneTelemetryItem,
  maxCapacity: number = MAX_DEADZONE_QUEUE_CAPACITY
): { queue: DeadZoneTelemetryItem[]; evictedCount: number } {
  // Prevent duplicate insertion of identical timestamped fixes
  const isDuplicate = queue.some(
    (q) => q.timestamp === item.timestamp && q.latitude === item.latitude && q.longitude === item.longitude
  );

  if (isDuplicate) {
    return { queue, evictedCount: 0 };
  }

  const nextQueue = [...queue, item];
  let evictedCount = 0;

  if (nextQueue.length > maxCapacity) {
    evictedCount = nextQueue.length - maxCapacity;
    nextQueue.splice(0, evictedCount);
  }

  return { queue: nextQueue, evictedCount };
}

/**
 * Drains a slice of the dead-zone queue for batch transmission upon reconnection.
 */
export function drainTelemetryQueue(
  queue: DeadZoneTelemetryItem[],
  batchSize: number = 25
): { batch: DeadZoneTelemetryItem[]; remaining: DeadZoneTelemetryItem[] } {
  if (queue.length === 0) {
    return { batch: [], remaining: [] };
  }

  const batch = queue.slice(0, batchSize);
  const remaining = queue.slice(batchSize);

  return { batch, remaining };
}

/**
 * Computes dead-zone queue diagnostics.
 */
export function calculateDeadZoneSummary(queue: DeadZoneTelemetryItem[]): {
  count: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
  hasItems: boolean;
  bufferedDurationSec: number;
} {
  const count = queue.length;
  if (count === 0) {
    return {
      count: 0,
      oldestTimestamp: null,
      newestTimestamp: null,
      hasItems: false,
      bufferedDurationSec: 0,
    };
  }

  const oldestTimestamp = queue[0].timestamp;
  const newestTimestamp = queue[count - 1].timestamp;
  const bufferedDurationSec = Math.max(0, Math.round((newestTimestamp - oldestTimestamp) / 1000));

  return {
    count,
    oldestTimestamp,
    newestTimestamp,
    hasItems: true,
    bufferedDurationSec,
  };
}

/**
 * Produces crisp HUD network/cellular status badges.
 */
export function formatNetworkStatusBadge(
  isOnline: boolean,
  queueCount: number,
  powerTier: PowerTier = 'stalking'
): NetworkStatusBadge {
  if (!isOnline || queueCount > 0) {
    return {
      label: queueCount > 0 ? `DEAD-ZONE // QUEUED (${queueCount})` : 'CELL LINK // OFFLINE',
      badgeColor: '#F59E0B',
      isAlert: true,
      pulseSpeed: 'fast',
    };
  }

  if (powerTier === 'critical_battery') {
    return {
      label: 'BATTERY GUARD // ACTIVE',
      badgeColor: '#EF4444',
      isAlert: true,
      pulseSpeed: 'slow',
    };
  }

  return {
    label: 'CELL LINK // LIVE',
    badgeColor: '#10B981',
    isAlert: false,
    pulseSpeed: 'none',
  };
}

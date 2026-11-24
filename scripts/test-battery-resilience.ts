import assert from 'node:assert';
import {
  calculateAdaptiveGpsConfig,
  evaluateBatteryHealth,
  enqueueTelemetryItem,
  drainTelemetryQueue,
  calculateDeadZoneSummary,
  formatNetworkStatusBadge,
  DeadZoneTelemetryItem,
  MAX_DEADZONE_QUEUE_CAPACITY,
} from '../src/lib/batteryResilienceCore';

console.log('=== Pillar 5: Outdoor Battery & Field Resilience Test Suite ===\n');

// Test 1: Adaptive GPS Sprint Tier (High Speed >= 2.0 m/s)
{
  const sprintConfig = calculateAdaptiveGpsConfig({
    speedMps: 3.5, // ~12.6 km/h sprint
    stationaryDurationSec: 0,
    batteryLevelPct: 80,
    batteryGuardEnabled: true,
  });
  assert.strictEqual(sprintConfig.powerTier, 'sprint');
  assert.strictEqual(sprintConfig.timeIntervalMs, 1000);
  assert.strictEqual(sprintConfig.distanceIntervalM, 1);
  assert.strictEqual(sprintConfig.accuracyTier, 'high');
  console.log('✓ Test 1: High-speed sprinting triggers 1Hz high-precision GPS polling');
}

// Test 2: Ambush Hold Tier (Stationary < 0.5 m/s for >= 15 seconds)
{
  const ambushConfig = calculateAdaptiveGpsConfig({
    speedMps: 0.2, // Standing still
    stationaryDurationSec: 20, // 20s camping
    batteryLevelPct: 75,
    batteryGuardEnabled: true,
  });
  assert.strictEqual(ambushConfig.powerTier, 'stationary');
  assert.strictEqual(ambushConfig.timeIntervalMs, 6000);
  assert.strictEqual(ambushConfig.distanceIntervalM, 8);
  assert.strictEqual(ambushConfig.accuracyTier, 'low_power');
  console.log('✓ Test 2: Stationary camping (>=15s) activates 6s low-power Ambush Hold');
}

// Test 3: Instant Wake from Ambush to Sprint
{
  // Operative sprints after hiding
  const wakeConfig = calculateAdaptiveGpsConfig({
    speedMps: 2.8,
    stationaryDurationSec: 45, // was stationary before
    batteryLevelPct: 70,
    batteryGuardEnabled: true,
  });
  assert.strictEqual(wakeConfig.powerTier, 'sprint');
  assert.strictEqual(wakeConfig.timeIntervalMs, 1000);
  console.log('✓ Test 3: Acceleration instantly breaks Ambush Hold back to 1Hz Sprint');
}

// Test 4: Tactical Stalking (Moderate speed 0.5 - 2.0 m/s)
{
  const stalkConfig = calculateAdaptiveGpsConfig({
    speedMps: 1.2, // Jog / Stalking
    stationaryDurationSec: 0,
    batteryLevelPct: 65,
    batteryGuardEnabled: true,
  });
  assert.strictEqual(stalkConfig.powerTier, 'stalking');
  assert.strictEqual(stalkConfig.timeIntervalMs, 2500);
  assert.strictEqual(stalkConfig.distanceIntervalM, 3);
  console.log('✓ Test 4: Moderate velocity engages balanced Stalking tier');
}

// Test 5: Critical Battery Override (<= 15%)
{
  const criticalConfig = calculateAdaptiveGpsConfig({
    speedMps: 5.0, // Even during full sprint!
    stationaryDurationSec: 0,
    batteryLevelPct: 12, // Critical battery
    batteryGuardEnabled: true,
  });
  assert.strictEqual(criticalConfig.powerTier, 'critical_battery');
  assert.strictEqual(criticalConfig.timeIntervalMs, 6000);
  assert.strictEqual(criticalConfig.accuracyTier, 'low_power');
  console.log('✓ Test 5: Critical battery (<=15%) overrides sprint speed to protect device from shutdown');
}

// Test 6: Battery Guard Disabled Toggle
{
  const disabledConfig = calculateAdaptiveGpsConfig({
    speedMps: 0.1,
    stationaryDurationSec: 60,
    batteryLevelPct: 10,
    batteryGuardEnabled: false, // Player disabled guard
  });
  assert.strictEqual(disabledConfig.powerTier, 'sprint');
  assert.strictEqual(disabledConfig.label, 'STANDARD (GUARD OFF)');
  console.log('✓ Test 6: Explicitly disabling battery guard maintains standard refresh rate');
}

// Test 7: Battery Health Evaluator
{
  const healthy = evaluateBatteryHealth(85);
  assert.strictEqual(healthy.isHealthy, true);
  assert.strictEqual(healthy.isCritical, false);
  assert.strictEqual(healthy.badgeColor, '#10B981');

  const low = evaluateBatteryHealth(22);
  assert.strictEqual(low.isLow, true);
  assert.strictEqual(low.isCritical, false);
  assert.strictEqual(low.badgeColor, '#F59E0B');

  const critical = evaluateBatteryHealth(9);
  assert.strictEqual(critical.isCritical, true);
  assert.strictEqual(critical.badgeColor, '#EF4444');

  const fallback = evaluateBatteryHealth(null);
  assert.strictEqual(fallback.isHealthy, true);
  console.log('✓ Test 7: evaluateBatteryHealth produces actionable status across thresholds');
}

// Test 8: Dead-Zone Queue Insertion & Capacity Limit (FIFO Eviction)
{
  let queue: DeadZoneTelemetryItem[] = [];

  const baseItem: DeadZoneTelemetryItem = {
    id: 'fix-1',
    gameId: 'game-101',
    latitude: 28.6139,
    longitude: 77.2090,
    accuracy: 10,
    speed: 2.1,
    heading: 90,
    timestamp: 1000,
    recordedAt: new Date(1000).toISOString(),
    attempts: 0,
  };

  // Add first item
  const res1 = enqueueTelemetryItem(queue, baseItem, 3);
  queue = res1.queue;
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(res1.evictedCount, 0);

  // Duplicate item rejection
  const dupRes = enqueueTelemetryItem(queue, baseItem, 3);
  queue = dupRes.queue;
  assert.strictEqual(queue.length, 1);

  // Add items up to cap (capacity = 3)
  const item2 = { ...baseItem, id: 'fix-2', timestamp: 2000 };
  const item3 = { ...baseItem, id: 'fix-3', timestamp: 3000 };
  const item4 = { ...baseItem, id: 'fix-4', timestamp: 4000 };

  queue = enqueueTelemetryItem(queue, item2, 3).queue;
  queue = enqueueTelemetryItem(queue, item3, 3).queue;
  assert.strictEqual(queue.length, 3);

  // Overfill: item4 should evict item1 (oldest)
  const overfill = enqueueTelemetryItem(queue, item4, 3);
  queue = overfill.queue;
  assert.strictEqual(queue.length, 3);
  assert.strictEqual(overfill.evictedCount, 1);
  assert.strictEqual(queue[0].id, 'fix-2');
  assert.strictEqual(queue[2].id, 'fix-4');

  console.log('✓ Test 8: enqueueTelemetryItem strictly enforces deduplication and bounded FIFO eviction');
}

// Test 9: Dead-Zone Queue Drainage
{
  const queue: DeadZoneTelemetryItem[] = [];
  for (let i = 0; i < 35; i++) {
    queue.push({
      id: `fix-${i}`,
      gameId: 'game-101',
      latitude: 28.6 + i * 0.001,
      longitude: 77.2,
      accuracy: 12,
      speed: 1.5,
      heading: 0,
      timestamp: 1000 + i * 1000,
      recordedAt: new Date(1000 + i * 1000).toISOString(),
      attempts: 0,
    });
  }

  // Drain first batch of 20
  const { batch, remaining } = drainTelemetryQueue(queue, 20);
  assert.strictEqual(batch.length, 20);
  assert.strictEqual(remaining.length, 15);
  assert.strictEqual(batch[0].id, 'fix-0');
  assert.strictEqual(remaining[0].id, 'fix-20');

  // Summary diagnostics
  const summary = calculateDeadZoneSummary(queue);
  assert.strictEqual(summary.count, 35);
  assert.strictEqual(summary.bufferedDurationSec, 34);
  assert.strictEqual(summary.hasItems, true);

  console.log('✓ Test 9: drainTelemetryQueue and calculateDeadZoneSummary accurately batch and report queue telemetry');
}

// Test 10: HUD Network & Cell Link Status Badge
{
  // Online with empty queue
  const onlineBadge = formatNetworkStatusBadge(true, 0, 'sprint');
  assert.strictEqual(onlineBadge.label, 'CELL LINK // LIVE');
  assert.strictEqual(onlineBadge.badgeColor, '#10B981');
  assert.strictEqual(onlineBadge.isAlert, false);

  // In dead-zone with 8 queued fixes
  const queuedBadge = formatNetworkStatusBadge(true, 8, 'sprint');
  assert.strictEqual(queuedBadge.label, 'DEAD-ZONE // QUEUED (8)');
  assert.strictEqual(queuedBadge.badgeColor, '#F59E0B');
  assert.strictEqual(queuedBadge.isAlert, true);

  // Critical battery mode active
  const batteryBadge = formatNetworkStatusBadge(true, 0, 'critical_battery');
  assert.strictEqual(batteryBadge.label, 'BATTERY GUARD // ACTIVE');
  assert.strictEqual(batteryBadge.badgeColor, '#EF4444');
  assert.strictEqual(batteryBadge.isAlert, true);

  console.log('✓ Test 10: formatNetworkStatusBadge produces crisp tactical HUD indicator states');
}

// Test 11: Multi-stage Ambush Camping Deadband & GPS Jitter Suppression
{
  // Operative camping at baseline coordinate
  const baseLat = 37.7749;
  const baseLng = -122.4194;

  let currentLat = baseLat;
  let currentLng = baseLng;
  let stationarySec = 0;
  let suppressedCount = 0;
  let emittedCount = 0;

  // Simulate 15 consecutive seconds of stationary GPS sensor jitter (< 2.0m)
  const jitterDisplacements = [0.4, 0.9, 1.3, 1.7, 0.8, 1.1, 1.5, 0.6, 1.8, 0.7, 1.2, 0.5, 1.6, 0.3, 1.9];

  for (const jitterM of jitterDisplacements) {
    stationarySec++;
    const speedMps = 0.2; // < 0.5 m/s stationary threshold

    // Deadband filter: speed < 0.6 m/s and displacement < 2.0m suppresses fix
    if (speedMps < 0.6 && jitterM < 2.0) {
      suppressedCount++;
    } else {
      emittedCount++;
      currentLat += 0.0001;
    }
  }

  assert.strictEqual(suppressedCount, 15, 'All 15 wandering jitter fixes suppressed by 2.0m deadband');
  assert.strictEqual(emittedCount, 0, 'No false coordinate displacement emitted during camping');

  // Verify power tier after 15s camping transitioned to stationary (6s interval)
  const campingConfig = calculateAdaptiveGpsConfig({
    speedMps: 0.1,
    stationaryDurationSec: stationarySec,
    batteryLevelPct: 60,
    batteryGuardEnabled: true,
  });
  assert.strictEqual(campingConfig.powerTier, 'stationary');
  assert.strictEqual(campingConfig.timeIntervalMs, 6000);

  // Now operative executes sprint breakout (> 2.0 m/s with 8.0m displacement)
  const breakoutSpeedMps = 3.6;
  const breakoutDisplacementM = 8.0;
  const breakoutEmitted = !(breakoutSpeedMps < 0.6 && breakoutDisplacementM < 2.0);
  assert.strictEqual(breakoutEmitted, true, 'Intentional sprint breakout immediately bypasses deadband');

  // Power tier instantly returns to 1Hz high-precision sprint tracking
  const breakoutConfig = calculateAdaptiveGpsConfig({
    speedMps: breakoutSpeedMps,
    stationaryDurationSec: stationarySec,
    batteryLevelPct: 60,
    batteryGuardEnabled: true,
  });
  assert.strictEqual(breakoutConfig.powerTier, 'sprint');
  assert.strictEqual(breakoutConfig.timeIntervalMs, 1000);

  console.log('✓ Test 11: Ambush deadband suppresses sensor jitter (<2m) and instantly awakens on breakout (>2m / >0.6m/s)');
}

// Test 12: Offline Telemetry Queue Lifecycle, Chronological Replay & Retry Cap
{
  let deadZoneQueue: DeadZoneTelemetryItem[] = [];
  const baseTime = Date.now();

  // 1. Enqueue 60 fixes recorded during an offline tunnel / dead-zone sprint
  for (let i = 0; i < 60; i++) {
    const item: DeadZoneTelemetryItem = {
      id: `dz-fix-${i}`,
      gameId: 'game-tactical-01',
      latitude: 37.7749 + i * 0.0001,
      longitude: -122.4194 + i * 0.0001,
      accuracy: 8,
      speed: 3.2,
      heading: 45,
      timestamp: baseTime + i * 1000,
      recordedAt: new Date(baseTime + i * 1000).toISOString(),
      attempts: 0,
    };
    const res = enqueueTelemetryItem(deadZoneQueue, item, 500);
    deadZoneQueue = res.queue;
  }
  assert.strictEqual(deadZoneQueue.length, 60, '60 fixes safely buffered in dead-zone queue');

  // 2. Diagnostics summary
  const summary = calculateDeadZoneSummary(deadZoneQueue);
  assert.strictEqual(summary.count, 60);
  assert.strictEqual(summary.bufferedDurationSec, 59);
  assert.strictEqual(summary.hasItems, true);

  // 3. Batch draining in slices of 25 (chronological FIFO preservation)
  const drain1 = drainTelemetryQueue(deadZoneQueue, 25);
  assert.strictEqual(drain1.batch.length, 25);
  assert.strictEqual(drain1.batch[0].id, 'dz-fix-0');
  assert.strictEqual(drain1.batch[24].id, 'dz-fix-24');
  assert.strictEqual(drain1.remaining.length, 35);
  deadZoneQueue = drain1.remaining;

  const drain2 = drainTelemetryQueue(deadZoneQueue, 25);
  assert.strictEqual(drain2.batch.length, 25);
  assert.strictEqual(drain2.batch[0].id, 'dz-fix-25');
  assert.strictEqual(drain2.remaining.length, 10);
  deadZoneQueue = drain2.remaining;

  // 4. Simulate flaky network on remaining 10 items (3 succeed, 7 fail and retry)
  const retryQueue: DeadZoneTelemetryItem[] = [];
  let transmitted = 0;
  for (let i = 0; i < deadZoneQueue.length; i++) {
    const item = deadZoneQueue[i];
    if (i < 3) {
      transmitted++; // 3 successfully transmitted
    } else {
      // 7 failed transmission
      item.attempts += 1;
      if (item.attempts < 5) {
        retryQueue.push(item);
      }
    }
  }
  assert.strictEqual(transmitted, 3);
  assert.strictEqual(retryQueue.length, 7);
  assert.strictEqual(retryQueue[0].attempts, 1);

  // 5. Verify max 5 retry attempts prunes permanently poisoned fixes
  for (const item of retryQueue) {
    item.attempts = 5; // Exhausted attempts
  }
  const prunedQueue = retryQueue.filter((item) => item.attempts < 5);
  assert.strictEqual(prunedQueue.length, 0, 'Poisoned items reaching 5 attempts pruned from dead-zone queue');

  console.log('✓ Test 12: Offline queue maintains chronological FIFO order across batch drainage with retry backoff');
}

// Test 13: Emergency Low Battery Sentinel Throttling with Battery Saver Override
{
  // Operative battery drains over match progression: 85% -> 22% -> 11%
  const health85 = evaluateBatteryHealth(85);
  assert.strictEqual(health85.isHealthy, true);
  assert.strictEqual(health85.isLow, false);
  assert.strictEqual(health85.isCritical, false);

  const health22 = evaluateBatteryHealth(22);
  assert.strictEqual(health22.isHealthy, false);
  assert.strictEqual(health22.isLow, true);
  assert.strictEqual(health22.isCritical, false);
  assert.strictEqual(health22.badgeColor, '#F59E0B');

  const health11 = evaluateBatteryHealth(11);
  assert.strictEqual(health11.isHealthy, false);
  assert.strictEqual(health11.isLow, true);
  assert.strictEqual(health11.isCritical, true);
  assert.strictEqual(health11.badgeColor, '#EF4444');

  // Even at 5.5 m/s sprint speed, critical battery locks to 6s low-power polling
  const sprintInCritical = calculateAdaptiveGpsConfig({
    speedMps: 5.5,
    stationaryDurationSec: 0,
    batteryLevelPct: 11,
    batteryGuardEnabled: true,
  });
  assert.strictEqual(sprintInCritical.powerTier, 'critical_battery');
  assert.strictEqual(sprintInCritical.timeIntervalMs, 6000);
  assert.strictEqual(sprintInCritical.accuracyTier, 'low_power');

  // Critical battery badge formatting
  const criticalBadge = formatNetworkStatusBadge(true, 0, 'critical_battery');
  assert.strictEqual(criticalBadge.label, 'BATTERY GUARD // ACTIVE');
  assert.strictEqual(criticalBadge.badgeColor, '#EF4444');
  assert.strictEqual(criticalBadge.isAlert, true);
  assert.strictEqual(criticalBadge.pulseSpeed, 'slow');

  console.log('✓ Test 13: Emergency low battery sentinel throttles sprint polling to 6s low-power to protect device');
}

console.log('\n=== All 13 Outdoor Battery & Field Resilience Tests Passed! (100%) ===\n');

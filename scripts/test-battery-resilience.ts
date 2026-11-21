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

console.log('\n=== All 10 Outdoor Battery & Field Resilience Tests Passed! (100%) ===\n');

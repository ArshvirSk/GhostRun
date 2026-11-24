import assert from 'node:assert';
import {
  classifyGpsAccuracy,
  evaluatePreflightReadiness,
  formatPreflightSummary,
} from '../src/lib/preflightCore';

console.log('--- Testing Pre-Flight Hardware Diagnostic Engine ---');

// Test 1: classifyGpsAccuracy tiers
{
  assert.strictEqual(classifyGpsAccuracy(3.2).tier, 'optimal');
  assert.strictEqual(classifyGpsAccuracy(5.0).tier, 'optimal');
  assert.strictEqual(classifyGpsAccuracy(11.5).tier, 'acceptable');
  assert.strictEqual(classifyGpsAccuracy(15.0).tier, 'acceptable');
  assert.strictEqual(classifyGpsAccuracy(22.0).tier, 'degraded');
  assert.strictEqual(classifyGpsAccuracy(35.0).tier, 'unavailable');
  assert.strictEqual(classifyGpsAccuracy(null).tier, 'unavailable');
  console.log('✓ Test 1: classifyGpsAccuracy accurately maps accuracy radii to readiness tiers');
}

// Test 2: Full Readiness (All 6 checks pass)
{
  const result = evaluatePreflightReadiness({
    gpsAccuracyMeters: 4.1,
    foregroundLocationGranted: true,
    backgroundLocationGranted: true,
    batteryOptimizationIgnored: true,
    audioTested: true,
    hapticsTested: true,
    offlineMapCached: true,
  });

  assert.strictEqual(result.canProceed, true);
  assert.strictEqual(result.overallStatus, 'ready');
  assert.strictEqual(result.passCount, 6);
  assert.strictEqual(result.failCount, 0);
  assert.ok(formatPreflightSummary(result).includes('ALL SYSTEMS OPERATIONAL'));
  console.log('✓ Test 2: evaluatePreflightReadiness grants ready status when all checks pass');
}

// Test 3: Advisory status (Permitted with warnings)
{
  const result = evaluatePreflightReadiness({
    gpsAccuracyMeters: 8.5,
    foregroundLocationGranted: true,
    backgroundLocationGranted: false, // Advisory
    batteryOptimizationIgnored: false, // Advisory
    audioTested: true,
    hapticsTested: true,
    offlineMapCached: false, // Advisory
  });

  assert.strictEqual(result.canProceed, true, 'User must be permitted to proceed with advisories');
  assert.strictEqual(result.overallStatus, 'caution');
  assert.strictEqual(result.failCount, 0);
  assert.strictEqual(result.warnCount, 4); // GPS acceptable + 3 warnings
  assert.ok(formatPreflightSummary(result).includes('SYSTEMS OPERATIONAL WITH ADVISORIES'));
  console.log('✓ Test 3: evaluatePreflightReadiness handles non-blocking advisories with caution status');
}

// Test 4: Critical Block (Missing foreground permission or satellite lock)
{
  const noPerms = evaluatePreflightReadiness({
    gpsAccuracyMeters: 3.0,
    foregroundLocationGranted: false, // Blocked
    backgroundLocationGranted: false,
    batteryOptimizationIgnored: true,
    audioTested: true,
    hapticsTested: true,
    offlineMapCached: true,
  });
  assert.strictEqual(noPerms.canProceed, false);
  assert.strictEqual(noPerms.overallStatus, 'blocked');

  const noFix = evaluatePreflightReadiness({
    gpsAccuracyMeters: null, // Blocked
    foregroundLocationGranted: true,
    backgroundLocationGranted: true,
    batteryOptimizationIgnored: true,
    audioTested: true,
    hapticsTested: true,
    offlineMapCached: true,
  });
  assert.strictEqual(noFix.canProceed, false);
  assert.strictEqual(noFix.overallStatus, 'blocked');
  assert.ok(formatPreflightSummary(noFix).includes('CRITICAL READINESS BLOCK'));
  console.log('✓ Test 4: evaluatePreflightReadiness strictly blocks entry when critical requirements fail');
}

console.log('\nAll 4 Pre-Flight Diagnostic tests passed successfully!\n');

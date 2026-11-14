import { evaluateTrackingHealth, READY_CHECK_STRINGS } from '../src/lib/trackingHealthEvaluator';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`PASS: ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

console.log('--- NF-04 Ready Check Evaluator Unit Tests ---');

// Test 1: Optimal setup
const optimal = evaluateTrackingHealth({
  foregroundGranted: true,
  backgroundGranted: true,
  servicesEnabled: true,
  accuracyMeters: 8,
  notificationsGranted: true,
});
assert(optimal.overall === 'healthy', 'Optimal inputs yield healthy status');
assert(optimal.checks.every((c) => c.status === 'pass'), 'Optimal inputs have all checks passing');

// Test 2: Foreground permission denied
const noForeground = evaluateTrackingHealth({
  foregroundGranted: false,
  backgroundGranted: false,
  servicesEnabled: true,
  accuracyMeters: null,
});
assert(noForeground.overall === 'degraded', 'Missing foreground yields degraded status');
const fgCheck = noForeground.checks.find((c) => c.id === 'foreground_location');
assert(fgCheck?.status === 'fail', 'Foreground check reports fail');
assert(fgCheck?.canFixWithSettings === true, 'Foreground failure provides settings fix link');

// Test 3: GPS Hardware disabled
const noGps = evaluateTrackingHealth({
  foregroundGranted: true,
  backgroundGranted: true,
  servicesEnabled: false,
});
assert(noGps.overall === 'degraded', 'Disabled GPS hardware yields degraded status');

// Test 4: Background permission missing (foreground only)
const foregroundOnly = evaluateTrackingHealth({
  foregroundGranted: true,
  backgroundGranted: false,
  servicesEnabled: true,
  accuracyMeters: 10,
});
assert(foregroundOnly.overall === 'warning', 'Missing background yields warning status');
const bgCheck = foregroundOnly.checks.find((c) => c.id === 'background_location');
assert(bgCheck?.status === 'warn', 'Background check reports warn');

// Test 5: Moderate GPS accuracy (22m)
const fairGps = evaluateTrackingHealth({
  foregroundGranted: true,
  backgroundGranted: true,
  servicesEnabled: true,
  accuracyMeters: 22,
});
assert(fairGps.overall === 'warning', '22m GPS accuracy yields warning status');
const accCheck = fairGps.checks.find((c) => c.id === 'gps_accuracy');
assert(accCheck?.status === 'warn', 'Fair GPS check reports warn');

// Test 6: Very poor GPS accuracy (45m > 35m)
const poorGps = evaluateTrackingHealth({
  foregroundGranted: true,
  backgroundGranted: true,
  servicesEnabled: true,
  accuracyMeters: 45,
});
assert(poorGps.overall === 'degraded', '>35m GPS accuracy yields degraded status');
const poorCheck = poorGps.checks.find((c) => c.id === 'gps_accuracy');
assert(poorCheck?.status === 'fail', 'Poor GPS check reports fail');

// Test 7: GPS Probe Timeout
const timeout = evaluateTrackingHealth({
  foregroundGranted: true,
  backgroundGranted: true,
  servicesEnabled: true,
  probeTimeout: true,
});
assert(timeout.overall === 'warning', 'Probe timeout yields warning status');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}

import assert from 'node:assert';
import { PRESET_VALUES } from '../src/stores/hostStore';
import { bearingDeg, distanceM } from '../src/lib/geo';
import { formatDistance } from '../src/utils/units';

console.log('--- Testing Blackout Radar & Difficulty Settings ---');

// 1. Verify Blackout Preset Definition
assert(PRESET_VALUES.blackout, 'Blackout preset must be registered in hostStore');
assert.strictEqual(PRESET_VALUES.blackout.tagRadiusM, 15);
assert.strictEqual(PRESET_VALUES.blackout.pingIntervalS, 90);
assert.strictEqual(PRESET_VALUES.blackout.boundaryPenalty, 'reveal_live');
assert.strictEqual(PRESET_VALUES.blackout.headStartS, 60);
console.log('✓ Test 1: Blackout preset configuration verified');

// 2. Verify Geo Bearing Calculation (Degrees 0-360)
const origin = { latitude: 0, longitude: 0 };
const northPoint = { latitude: 1, longitude: 0 };
const eastPoint = { latitude: 0, longitude: 1 };
const southPoint = { latitude: -1, longitude: 0 };
const westPoint = { latitude: 0, longitude: -1 };

const bNorth = bearingDeg(origin, northPoint);
const bEast = bearingDeg(origin, eastPoint);
const bSouth = bearingDeg(origin, southPoint);
const bWest = bearingDeg(origin, westPoint);

assert(Math.abs(bNorth - 0) < 0.1 || Math.abs(bNorth - 360) < 0.1, `North bearing should be 0°, got ${bNorth}`);
assert(Math.abs(bEast - 90) < 0.5, `East bearing should be 90°, got ${bEast}`);
assert(Math.abs(bSouth - 180) < 0.5, `South bearing should be 180°, got ${bSouth}`);
assert(Math.abs(bWest - 270) < 0.5, `West bearing should be 270°, got ${bWest}`);
console.log('✓ Test 2: Geo bearing calculations accurate to cardinal directions');

// 3. Verify Relative Heading & Forward Projection
// If operative is facing East (90 deg), and target is East (90 deg), target should be straight ahead (0 deg relative)
const headingEast = 90;
const relAhead = (bEast - headingEast + 360) % 360;
assert.strictEqual(Math.round(relAhead), 0, 'Target East when facing East must be 0° ahead');

// If operative is facing North (0 deg), and target is West (270 deg), target should be 270° (left / 9 oclock)
const headingNorth = 0;
const relLeft = (bWest - headingNorth + 360) % 360;
assert.strictEqual(Math.round(relLeft), 270, 'Target West when facing North must be 270° (left)');
console.log('✓ Test 3: Relative azimuth and operative rotation mapping verified');

// 4. Verify Imperial / Metric Empirical Unit Choice Formatting
const testMeters = 250;
const metricText = formatDistance(testMeters, 'metric');
const imperialText = formatDistance(testMeters, 'imperial');

assert.strictEqual(metricText, '250 m');
assert(imperialText.includes('ft') || imperialText.includes('yd'), `Imperial formatting should format feet/yards, got ${imperialText}`);

const longDistM = 2500;
const metricLong = formatDistance(longDistM, 'metric');
const imperialLong = formatDistance(longDistM, 'imperial');
assert.strictEqual(metricLong, '2.5 km');
assert(imperialLong.includes('mi'), `Imperial long distance should format miles, got ${imperialLong}`);
console.log('✓ Test 4: Distance formatting respects user empirical setting (metric & imperial)');

console.log('All Blackout radar tests passed successfully!');

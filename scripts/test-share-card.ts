import {
  trimTrailPrivacy,
  formatRoundCardShareText,
  PRIVACY_TRIM_METERS,
  MIN_SHAREABLE_DISTANCE_METERS,
} from '../src/lib/roundCard';
import type { LngLat } from '../src/lib/geo';

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

console.log('--- NF-10 Shareable Round Card & Privacy Trimming Unit Tests ---');

// Test 1: Empty or trivial path
const empty = trimTrailPrivacy([]);
assert(empty.trimmedPath.length === 0 && empty.originalDistanceM === 0, 'Empty path returns empty trimmed path');

// Test 2: Short route (< 350m total distance)
// ~0.002 deg lat ~ 220m
const shortPath: LngLat[] = [
  { latitude: 37.7749, longitude: -122.4194 },
  { latitude: 37.7759, longitude: -122.4194 },
  { latitude: 37.7769, longitude: -122.4194 },
];
const shortRes = trimTrailPrivacy(shortPath);
assert(shortRes.originalDistanceM < MIN_SHAREABLE_DISTANCE_METERS, 'Short path distance is under 350m');
assert(shortRes.trimmedPath.length === 0, 'Short path (< 350m) completely suppresses coordinates to protect home/finish');

// Test 3: Standard route (10 points across ~1200m)
// 0.001 deg lat ~ 111m
const longPath: LngLat[] = Array.from({ length: 11 }, (_, i) => ({
  latitude: 37.7749 + i * 0.001,
  longitude: -122.4194,
}));
const longRes = trimTrailPrivacy(longPath);
assert(longRes.originalDistanceM > 1000, 'Calculates > 1000m total path');
assert(longRes.trimmedPath.length > 0, 'Preserves middle segments');
assert(longRes.trimmedPath[0].latitude > longPath[0].latitude, 'First point is past start trim buffer');
assert(
  longRes.trimmedPath[longRes.trimmedPath.length - 1].latitude < longPath[longPath.length - 1].latitude,
  'Last point is before end trim buffer'
);
assert(
  longRes.trimmedDistanceM < longRes.originalDistanceM,
  'Trimmed distance is strictly smaller than original distance'
);

// Test 4: Share text formatting (with trail consent)
const textWithTrail = formatRoundCardShareText({
  modeName: 'Classic Chase',
  outcome: 'victorious',
  durationSeconds: 754, // 12m 34s
  distanceMeters: 2450,
  topSpeedKmh: 18.2,
  role: 'runner',
  date: '2026-11-15',
  shareTrailConsent: true,
});
assert(textWithTrail.includes('Classic Chase'), 'Includes mode name');
assert(textWithTrail.includes('VICTORIOUS'), 'Includes outcome');
assert(textWithTrail.includes('12:34'), 'Formats duration into mm:ss');
assert(textWithTrail.includes('2.5 km'), 'Formats distance to 1 decimal km');
assert(textWithTrail.includes('Privacy-trimmed (150m buffer)'), 'Includes privacy-trimmed notice');

// Test 5: Share text formatting (without trail consent C3)
const textConfidential = formatRoundCardShareText({
  modeName: 'Tag Hunt',
  outcome: 'completed',
  durationSeconds: 600,
  distanceMeters: 1800,
  role: 'hunter',
  date: '2026-11-15',
  shareTrailConsent: false,
});
assert(textConfidential.includes('Route: Confidential'), 'Hides route when consent C3 is false');
assert(!textConfidential.includes('Privacy-trimmed'), 'Does not state trimmed when confidential');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

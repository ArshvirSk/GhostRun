import {
  sanitizeAnalyticsPayload,
} from '../src/lib/analyticsCore';
import {
  APP_VERSION,
  SUPPORT_EMAIL,
  PLAY_STORE_URL,
  getPlayStoreReviewUrl,
} from '../src/lib/diagnosticsCore';

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

console.log('--- NF-17, NF-18 & NF-32 Diagnostics & Analytics Unit Tests ---');

// Test 1: App Version & URLs
assert(APP_VERSION === '2.9.3', 'Diagnostic app version matches project release version');
assert(SUPPORT_EMAIL.includes('@ghostrun.app'), 'Support email uses official domain');
assert(getPlayStoreReviewUrl().includes('com.ghostrun.app'), 'Review URL points to Google Play store package');

// Test 2: Analytics Payload Sanitization - Clean input
const clean = sanitizeAnalyticsPayload({
  duration_s: 120,
  mode_id: 'classic_chase',
  is_winner: true,
});
assert(clean.duration_s === 120, 'Preserves numeric duration');
assert(clean.mode_id === 'classic_chase', 'Preserves mode identifier');
assert(clean.is_winner === true, 'Preserves boolean flag');

// Test 3: Analytics Payload Sanitization - Stripping forbidden coordinates
const dirtyWithGps = sanitizeAnalyticsPayload({
  mode_id: 'tag_hunt',
  lat: 37.7749,
  lng: -122.4194,
  latitude: 37.7749,
  longitude: -122.4194,
  coordinates: [37.7749, -122.4194],
  safe_count: 5,
});
assert(dirtyWithGps.lat === undefined, 'Strips forbidden "lat"');
assert(dirtyWithGps.lng === undefined, 'Strips forbidden "lng"');
assert(dirtyWithGps.latitude === undefined, 'Strips forbidden "latitude"');
assert(dirtyWithGps.longitude === undefined, 'Strips forbidden "longitude"');
assert(dirtyWithGps.coordinates === undefined, 'Strips forbidden "coordinates"');
assert(dirtyWithGps.safe_count === 5, 'Keeps safe non-GPS telemetry');

// Test 4: Analytics Payload Sanitization - Stripping names and messages
const dirtyWithNames = sanitizeAnalyticsPayload({
  event: 'lobby_joined',
  display_name: 'GhostAgent',
  name: 'AgentX',
  email: 'agent@ghostrun.app',
  message: 'Meet me at the corner',
  lobby_size: 4,
});
assert(dirtyWithNames.display_name === undefined, 'Strips forbidden "display_name"');
assert(dirtyWithNames.name === undefined, 'Strips forbidden "name"');
assert(dirtyWithNames.email === undefined, 'Strips forbidden "email"');
assert(dirtyWithNames.message === undefined, 'Strips forbidden "message"');
assert(dirtyWithNames.lobby_size === 4, 'Keeps safe aggregate count');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

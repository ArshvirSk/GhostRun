import {
  sanitizeAnalyticsPayload,
  isAnalyticsOptedIn,
  buildAnalyticsEnvelope,
  FORBIDDEN_KEYS,
} from '../src/lib/analyticsCore';
import {
  APP_VERSION,
  SUPPORT_EMAIL,
  PLAY_STORE_URL,
  FEEDBACK_CATEGORIES,
  getPlayStoreReviewUrl,
  validateFeedbackCategory,
  validateFeedbackMessage,
  sanitizeDiagnosticBundle,
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
assert(APP_VERSION === '2.9.9', 'Diagnostic app version matches project release version');
assert(SUPPORT_EMAIL.includes('@ghostrun.app'), 'Support email uses official domain');
assert(
  getPlayStoreReviewUrl().includes('com.ghostrun.app'),
  'Review URL points to Google Play store package',
);

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
  altitude: 15.2,
  speed: 4.2,
  heading: 180,
  safe_count: 5,
});
assert(dirtyWithGps.lat === undefined, 'Strips forbidden "lat"');
assert(dirtyWithGps.lng === undefined, 'Strips forbidden "lng"');
assert(dirtyWithGps.latitude === undefined, 'Strips forbidden "latitude"');
assert(dirtyWithGps.longitude === undefined, 'Strips forbidden "longitude"');
assert(dirtyWithGps.coordinates === undefined, 'Strips forbidden "coordinates"');
assert(dirtyWithGps.altitude === undefined, 'Strips forbidden "altitude"');
assert(dirtyWithGps.speed === undefined, 'Strips forbidden "speed"');
assert(dirtyWithGps.heading === undefined, 'Strips forbidden "heading"');
assert(dirtyWithGps.safe_count === 5, 'Keeps safe non-GPS telemetry');

// Test 4: Analytics Payload Sanitization - Stripping names, emails, phones, and messages
const dirtyWithPII = sanitizeAnalyticsPayload({
  event: 'lobby_joined',
  display_name: 'GhostAgent',
  name: 'AgentX',
  email: 'agent@ghostrun.app',
  phone: '+15551234567',
  ip: '192.168.1.1',
  message: 'Meet me at the corner',
  lobby_size: 4,
});
assert(dirtyWithPII.display_name === undefined, 'Strips forbidden "display_name"');
assert(dirtyWithPII.name === undefined, 'Strips forbidden "name"');
assert(dirtyWithPII.email === undefined, 'Strips forbidden "email"');
assert(dirtyWithPII.phone === undefined, 'Strips forbidden "phone"');
assert(dirtyWithPII.ip === undefined, 'Strips forbidden "ip"');
assert(dirtyWithPII.message === undefined, 'Strips forbidden "message"');
assert(dirtyWithPII.lobby_size === 4, 'Keeps safe aggregate count');

// Test 5: Consent C7 opt-in gating
assert(!isAnalyticsOptedIn(null), 'Null stored preference defaults to opt-out (false)');
assert(!isAnalyticsOptedIn(undefined), 'Undefined stored preference defaults to opt-out (false)');
assert(!isAnalyticsOptedIn('false'), '"false" stored preference resolves to opt-out');
assert(isAnalyticsOptedIn('true'), '"true" stored preference resolves to opt-in');

// Test 6: Analytics Envelope Builder
const envelopeWithoutConsent = buildAnalyticsEnvelope('game_started', { mode_id: 'jailbreak' }, false);
assert(envelopeWithoutConsent === null, 'Returns null envelope when user has not opted into diagnostics');

const envelopeWithConsent = buildAnalyticsEnvelope('game_started', { mode_id: 'jailbreak', lat: 37.7 }, true);
assert(envelopeWithConsent !== null, 'Builds envelope when user opted in');
assert(envelopeWithConsent?.event === 'game_started', 'Envelope has correct event type');
assert(envelopeWithConsent?.payload.mode_id === 'jailbreak', 'Envelope contains safe payload');
assert(envelopeWithConsent?.payload.lat === undefined, 'Envelope payload is sanitized of coordinates');

// Test 7: Feedback category validation
assert(validateFeedbackCategory('bug'), 'bug is a valid feedback category');
assert(validateFeedbackCategory('suggestion'), 'suggestion is a valid feedback category');
assert(validateFeedbackCategory('safety'), 'safety is a valid feedback category');
assert(validateFeedbackCategory('other'), 'other is a valid feedback category');
assert(!validateFeedbackCategory('spam'), 'spam is an invalid feedback category');

// Test 8: Feedback message validation
assert(!validateFeedbackMessage('').valid, 'Empty feedback message is invalid');
assert(!validateFeedbackMessage('hi').valid, 'Message under 5 chars is invalid');
assert(!validateFeedbackMessage('x'.repeat(2001)).valid, 'Message over 2000 chars is invalid');
assert(validateFeedbackMessage('Radar pings were delayed by 3 seconds during the final extraction.').valid, 'Normal length feedback message is valid');

// Test 9: Diagnostic bundle sanitization
const rawBundle = {
  app_version: '2.9.9',
  platform_os: 'android',
  platform_version: 14,
  lat: 37.7749, // accidental location injection
  user_email: 'secret@gmail.com', // accidental email injection
  permissions: {
    notifications: true,
    foreground_location: true,
    background_location: false,
  },
};
const sanitizedBundle = sanitizeDiagnosticBundle(rawBundle);
assert(sanitizedBundle.app_version === '2.9.9', 'Preserves app version');
assert(sanitizedBundle.platform_os === 'android', 'Preserves platform OS');
assert((sanitizedBundle as any).lat === undefined, 'Strips injected lat coordinate from bundle');
assert((sanitizedBundle as any).user_email === undefined, 'Strips injected email from bundle');
assert(sanitizedBundle.permissions?.background_location === false, 'Preserves permission diagnostic flags');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

import {
  isCurfewExpired,
  getCurfewRemainingSeconds,
  resolveCheckinIntervalMinutes,
  getMissedCheckinAudience,
  buildMissedCheckinPayload,
  buildEmergencySosPayload,
  calculateCheckinCountdownRemaining,
} from '../src/lib/safetyCheckinCore';

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

console.log('--- NF-06 Safety Check-in & Curfew Unit Tests ---');

// Test 1: Curfew evaluation
const now = Date.now();
const futureCurfew = new Date(now + 3600000).toISOString();
const pastCurfew = new Date(now - 60000).toISOString();

assert(!isCurfewExpired(futureCurfew, now), 'Future curfew is not expired');
assert(isCurfewExpired(pastCurfew, now), 'Past curfew evaluates as expired');
assert(!isCurfewExpired(null, now), 'Null curfew is never expired');
assert(!isCurfewExpired(undefined, now), 'Undefined curfew is never expired');
assert(!isCurfewExpired('not-a-date', now), 'Malformed curfew string is not expired');

// Test 2: Curfew remaining seconds
const remainingFuture = getCurfewRemainingSeconds(new Date(now + 120000).toISOString(), now);
assert(remainingFuture === 120, 'Curfew in 120s returns 120 seconds remaining');

const remainingPast = getCurfewRemainingSeconds(pastCurfew, now);
assert(remainingPast === 0, 'Past curfew remaining seconds clamped to 0');
assert(getCurfewRemainingSeconds(null, now) === null, 'Null curfew returns null remaining seconds');

// Test 3: Target audience for missed checkin (privacy & anti-leak guard)
assert(getMissedCheckinAudience('classic_chase', 'runner') === 'runner', 'Classic Chase runner missed checkin reaches runner teammates only');
assert(getMissedCheckinAudience('tag_hunt', 'hunter') === 'hunter', 'Tag Hunt hunter missed checkin reaches hunter teammates only');
assert(getMissedCheckinAudience('vip_escort', 'runner') === 'runner', 'VIP Escort runner reaches runner teammates only');
assert(getMissedCheckinAudience('jailbreak', 'hunter') === 'hunter', 'Jailbreak hunter reaches hunter teammates only');
assert(getMissedCheckinAudience('ghost_duel', 'runner') === 'all', 'Solo Ghost Duel missed checkin reaches all participants');
assert(getMissedCheckinAudience('assassin_ring', 'runner') === 'all', 'Solo Assassin Ring missed checkin reaches all participants');

// Test 4: Checkin interval selection
assert(resolveCheckinIntervalMinutes({ checkin_interval_m: 20 }, false) === 20, 'Host override interval respected (20m)');
assert(resolveCheckinIntervalMinutes({ checkin_interval_m: 5 }, true) === 5, 'Host override interval respected in night match (5m)');
assert(resolveCheckinIntervalMinutes(undefined, true) === 10, 'Night matches default to 10m checkin');
assert(resolveCheckinIntervalMinutes(undefined, false) === 15, 'Day matches default to 15m checkin');
assert(resolveCheckinIntervalMinutes({ checkin_interval_m: 0 }, false) === 15, 'Zero interval falls back to 15m day default');

// Test 5: Missed checkin payload construction
const missed = buildMissedCheckinPayload('p-123', 'Cipher', 'runner', 12.9716, 77.5946, '2026-11-24T12:00:00Z');
assert(missed.player_id === 'p-123', 'Payload has correct player_id');
assert(missed.display_name === 'Cipher', 'Payload has correct display_name');
assert(missed.team === 'runner', 'Payload has correct team');
assert(missed.latitude === 12.9716 && missed.longitude === 77.5946, 'Payload has precise coordinates');
assert(missed.message === 'Cipher missed safety check-in!', 'Payload has formatted warning message');

// Test 6: Emergency SOS payload construction
const sos = buildEmergencySosPayload('p-456', 'Spectre', 'hunter', 12.972, 77.595, '2026-11-24T12:01:00Z');
assert(sos.player_id === 'p-456', 'SOS has correct player_id');
assert(sos.emergency === true, 'SOS has emergency flag set to true');
assert(sos.message.includes('EMERGENCY SOS'), 'SOS message starts with EMERGENCY SOS alert');

// Test 7: Checkin countdown timer remaining math
const startMs = now - 15000; // 15 seconds ago
assert(calculateCheckinCountdownRemaining(startMs, 60, now) === 45, '15s elapsed leaves 45s remaining');
assert(calculateCheckinCountdownRemaining(now - 70000, 60, now) === 0, '70s elapsed clamps to 0s remaining');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}

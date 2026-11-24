import {
  TACTICAL_CHANNELS,
  getTacticalChannel,
  isTacticalChannel,
  resolveSilentAlertsState,
  validateTacticalVibrationPattern,
  buildNotificationPayload,
  type ChannelSpec,
} from '../src/lib/notificationChannels';

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

console.log('--- NF-05 Silent Alerts & Channels Unit Tests ---');

// Test 1: Exactly 3 tactical channels registered
assert(TACTICAL_CHANNELS.length === 3, 'Registered 3 tactical notification channels');

// Test 2: Channel IDs match spec
const ids = TACTICAL_CHANNELS.map((c) => c.id);
assert(ids.includes('tactical-alerts'), 'Includes tactical-alerts channel');
assert(ids.includes('match-events'), 'Includes match-events channel');
assert(ids.includes('lobby-comms'), 'Includes lobby-comms channel');

// Test 3: In-game channels are silent by default (sound is null)
const tacticalAlerts = getTacticalChannel('tactical-alerts');
const matchEvents = getTacticalChannel('match-events');
const lobbyComms = getTacticalChannel('lobby-comms');

assert(tacticalAlerts?.sound === null, 'tactical-alerts channel has sound set to null (silent)');
assert(matchEvents?.sound === null, 'match-events channel has sound set to null (silent)');
assert(lobbyComms?.sound === null, 'lobby-comms channel has sound set to null (silent)');

// Test 4: Importance levels match spec
assert(tacticalAlerts?.importance === 4, 'tactical-alerts is HIGH importance (4)');
assert(matchEvents?.importance === 4, 'match-events is HIGH importance (4)');
assert(lobbyComms?.importance === 3, 'lobby-comms is DEFAULT importance (3)');

// Test 5: Vibration patterns are non-empty arrays of valid durations
assert(validateTacticalVibrationPattern(tacticalAlerts!.vibrationPattern), 'tactical-alerts has valid vibration pattern');
assert(validateTacticalVibrationPattern(matchEvents!.vibrationPattern), 'match-events has valid vibration pattern');
assert(validateTacticalVibrationPattern(lobbyComms!.vibrationPattern), 'lobby-comms has valid vibration pattern');

assert(!validateTacticalVibrationPattern([]), 'Empty vibration pattern rejected');
assert(!validateTacticalVibrationPattern([-10, 50]), 'Negative duration vibration pattern rejected');

// Test 6: Channel lookup and recognition
assert(isTacticalChannel('tactical-alerts'), 'isTacticalChannel returns true for tactical-alerts');
assert(isTacticalChannel('match-events'), 'isTacticalChannel returns true for match-events');
assert(isTacticalChannel('lobby-comms'), 'isTacticalChannel returns true for lobby-comms');
assert(!isTacticalChannel('marketing-promos'), 'isTacticalChannel returns false for unapproved channel');
assert(getTacticalChannel('unknown') === undefined, 'getTacticalChannel returns undefined for unknown id');

// Test 7: Preference resolution defaults to silent (stealth mode)
assert(resolveSilentAlertsState(null) === true, 'Null stored state defaults to silent (true)');
assert(resolveSilentAlertsState(undefined) === true, 'Undefined stored state defaults to silent (true)');
assert(resolveSilentAlertsState('true') === true, '"true" stored state resolves to silent (true)');
assert(resolveSilentAlertsState('false') === false, '"false" stored state resolves to audible (false)');
assert(resolveSilentAlertsState('invalid') === true, 'Corrupt stored state safely falls back to silent (true)');

// Test 8: Tactical notification payload generator
const silentPayload = buildNotificationPayload(
  'tactical-alerts',
  'HUNTER PROXIMITY',
  'Hunter pinged within 50m!',
  true
);
assert(silentPayload.sound === null, 'Silent payload sound is null');
assert(silentPayload.channelId === 'tactical-alerts', 'Payload channelId is tactical-alerts');
assert(silentPayload.data?.silent === true, 'Payload data flag reflects silent');

const audiblePayload = buildNotificationPayload(
  'match-events',
  'EXTRACTION OPEN',
  'Gate is active for 60s',
  false
);
assert(audiblePayload.sound === 'default', 'Audible payload sound is default');
assert(audiblePayload.channelId === 'match-events', 'Payload channelId is match-events');
assert(audiblePayload.data?.silent === false, 'Payload data flag reflects non-silent');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}

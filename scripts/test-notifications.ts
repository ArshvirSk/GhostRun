import { TACTICAL_CHANNELS, type ChannelSpec } from '../src/lib/notificationChannels';

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
const tacticalAlerts = TACTICAL_CHANNELS.find((c) => c.id === 'tactical-alerts');
const matchEvents = TACTICAL_CHANNELS.find((c) => c.id === 'match-events');
const lobbyComms = TACTICAL_CHANNELS.find((c) => c.id === 'lobby-comms');

assert(tacticalAlerts?.sound === null, 'tactical-alerts channel has sound set to null (silent)');
assert(matchEvents?.sound === null, 'match-events channel has sound set to null (silent)');
assert(lobbyComms?.sound === null, 'lobby-comms channel has sound set to null (silent)');

// Test 4: Vibration patterns are non-empty arrays
assert(Array.isArray(tacticalAlerts?.vibrationPattern) && tacticalAlerts!.vibrationPattern.length > 0, 'tactical-alerts has custom vibration pattern');
assert(Array.isArray(matchEvents?.vibrationPattern) && matchEvents!.vibrationPattern.length > 0, 'match-events has custom vibration pattern');
assert(Array.isArray(lobbyComms?.vibrationPattern) && lobbyComms!.vibrationPattern.length > 0, 'lobby-comms has custom vibration pattern');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}

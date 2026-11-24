import {
  validatePushToken,
  getPushTokenType,
  shouldDispatchPush,
  buildPushPayload,
  buildBatchPushPayloads,
  DEFAULT_PUSH_PREFERENCES,
} from '../src/lib/pushNotificationsCore';

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

console.log('--- NF-12 Remote Push Notifications Unit Tests ---');

// Test 1: Token validation & classification
const validExpoToken = 'ExponentPushToken[AbCdEfGhIjKlMnOpQrStUv]';
assert(validatePushToken(validExpoToken), 'Validates Expo push token format');
assert(getPushTokenType(validExpoToken) === 'expo', 'Classifies as expo token');

const validFcmToken = 'fcm_token_abcdefghijklmnopqrstuvwxyz123456';
assert(validatePushToken(validFcmToken), 'Validates raw FCM token format');
assert(getPushTokenType(validFcmToken) === 'fcm', 'Classifies as fcm token');

assert(!validatePushToken(''), 'Rejects empty token');
assert(getPushTokenType('') === 'invalid', 'Empty token is invalid');
assert(!validatePushToken('short'), 'Rejects truncated token');
assert(getPushTokenType('ExponentPushToken[short]') === 'invalid', 'Rejects short bracketed expo token');

// Test 2: Default preferences
assert(DEFAULT_PUSH_PREFERENCES.lobby_invites === true, 'Lobby invites enabled by default');
assert(DEFAULT_PUSH_PREFERENCES.game_starting === true, 'Game starting alerts enabled by default');
assert(DEFAULT_PUSH_PREFERENCES.scheduled_reminders === true, 'Scheduled reminders enabled by default');
assert(DEFAULT_PUSH_PREFERENCES.crew_invite === true, 'Crew invites enabled by default');

// Test 3: Preference gating
assert(shouldDispatchPush('lobby_invites', { lobby_invites: true }), 'Allows dispatch when preference is true');
assert(!shouldDispatchPush('lobby_invites', { lobby_invites: false }), 'Suppresses dispatch when preference is false');
assert(shouldDispatchPush('game_starting', undefined), 'Undefined preferences default to allowed');

// Test 4: Lobby Invite payload
const invitePayload = buildPushPayload(validExpoToken, 'lobby_invites', {
  hostName: 'GhostZero',
  modeName: 'Classic Chase',
  lobbyCode: 'W8K4',
});
assert(invitePayload.title.includes('Classic Chase'), 'Lobby invite title mentions mode');
assert(invitePayload.body.includes('GhostZero'), 'Lobby invite body names host');
assert(invitePayload.body.includes('W8K4'), 'Lobby invite body includes room code');
assert(invitePayload.channelId === 'lobby-comms', 'Routes to lobby-comms channel');
assert(invitePayload.priority === 'high', 'Lobby invite is high priority');

// Test 5: Game Starting payload
const startingPayload = buildPushPayload(validExpoToken, 'game_starting', {
  modeName: 'Tag Hunt',
  lobbyCode: 'Z9R1',
});
assert(startingPayload.channelId === 'tactical-alerts', 'Routes starting alert to tactical-alerts');
assert(startingPayload.priority === 'high', 'Game starting alert is high priority');

// Test 6: Scheduled Reminders payload
const reminderPayload = buildPushPayload(validExpoToken, 'scheduled_reminders', {
  modeName: 'Jailbreak',
  startsInMinutes: 10,
});
assert(reminderPayload.channelId === 'match-events', 'Routes reminder to match-events channel');
assert(reminderPayload.body.includes('10 minutes'), 'Reminder body specifies countdown minutes');

// Test 7: Crew Invite payload
const crewPayload = buildPushPayload(validFcmToken, 'crew_invite', {
  crewName: 'Viper Strike',
  crewCode: 'VIPR8',
});
assert(crewPayload.title.includes('Viper Strike'), 'Crew payload title names crew');
assert(crewPayload.body.includes('VIPR8'), 'Crew payload body specifies crew code');
assert(crewPayload.channelId === 'lobby-comms', 'Crew invite routes to lobby-comms');

// Test 8: Batch payload generator with pruning
const mixedTokens = [validExpoToken, 'bad_token', validFcmToken, ''];
const batch = buildBatchPushPayloads(mixedTokens, 'game_starting', {
  modeName: 'Territory Pulse',
  lobbyCode: 'PULS',
});
assert(batch.length === 2, 'Batches exactly 2 valid tokens, filtering out 2 invalid tokens');
assert(batch[0].to === validExpoToken, 'First batch item is valid expo token');
assert(batch[1].to === validFcmToken, 'Second batch item is valid fcm token');

// Test 9: Batch suppressed by preferences
const suppressedBatch = buildBatchPushPayloads(
  mixedTokens,
  'game_starting',
  { modeName: 'Territory Pulse' },
  { game_starting: false }
);
assert(suppressedBatch.length === 0, 'Suppresses batch when user preference is disabled');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

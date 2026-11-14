import {
  validatePushToken,
  buildPushPayload,
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

// Test 1: Token validation
const validExpoToken = 'ExponentPushToken[AbCdEfGhIjKlMnOpQrStUv]';
assert(validatePushToken(validExpoToken), 'Validates Expo push token format');
const validFcmToken = 'fcm_token_abcdefghijklmnopqrstuvwxyz123456';
assert(validatePushToken(validFcmToken), 'Validates raw FCM token format');
assert(!validatePushToken(''), 'Rejects empty token');
assert(!validatePushToken('short'), 'Rejects truncated token');

// Test 2: Default preferences
assert(DEFAULT_PUSH_PREFERENCES.lobby_invites === true, 'Lobby invites enabled by default');
assert(DEFAULT_PUSH_PREFERENCES.game_starting === true, 'Game starting alerts enabled by default');
assert(DEFAULT_PUSH_PREFERENCES.scheduled_reminders === true, 'Scheduled reminders enabled by default');

// Test 3: Lobby Invite payload
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

// Test 4: Game Starting payload
const startingPayload = buildPushPayload(validExpoToken, 'game_starting', {
  modeName: 'Tag Hunt',
  lobbyCode: 'Z9R1',
});
assert(startingPayload.channelId === 'tactical-alerts', 'Routes starting alert to tactical-alerts');
assert(startingPayload.priority === 'high', 'Game starting alert is high priority');

// Test 5: Scheduled Reminders payload
const reminderPayload = buildPushPayload(validExpoToken, 'scheduled_reminders', {
  modeName: 'Jailbreak',
  startsInMinutes: 10,
});
assert(reminderPayload.channelId === 'match-events', 'Routes reminder to match-events channel');
assert(reminderPayload.body.includes('10 minutes'), 'Reminder body specifies countdown minutes');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

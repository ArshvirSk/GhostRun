import {
  RADIO_QUICK_CHIPS,
  getRadioQuickChip,
  isRadioQuickChip,
  sanitizeRadioMessage,
  checkRadioRateLimit,
  filterBlockedMessages,
  filterReportedMessages,
  buildRadioChipMessage,
  TeamMessage,
} from '../src/lib/teamRadio';

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

console.log('--- NF-07 Team Radio & NF-08 Moderation Unit Tests ---');

// Test 1: Quick chips catalog
assert(RADIO_QUICK_CHIPS.length === 6, 'Defines exactly 6 canonical quick chips');
const ids = new Set(RADIO_QUICK_CHIPS.map((c) => c.id));
assert(ids.size === 6, 'All quick chips have unique IDs');
assert(RADIO_QUICK_CHIPS.some((c) => c.label === 'Hunter nearby!'), 'Includes Hunter nearby! chip');
assert(RADIO_QUICK_CHIPS.some((c) => c.label === "I'm safe"), "Includes I'm safe chip");

// Test 2: Quick chip lookup & validation
assert(isRadioQuickChip('hunter_nearby'), 'isRadioQuickChip returns true for valid chip');
assert(!isRadioQuickChip('invalid_chip'), 'isRadioQuickChip returns false for invalid chip');
const chip = getRadioQuickChip('regroup');
assert(chip?.label === 'Regroup' && chip?.intent === 'neutral', 'getRadioQuickChip returns correct definition');
assert(getRadioQuickChip('non_existent') === undefined, 'getRadioQuickChip returns undefined for unknown ID');

// Test 3: Structured chip message builder
const chipMsg = buildRadioChipMessage({
  gameId: 'g-100',
  team: 'runner',
  playerId: 'p-1',
  userId: 'u-1',
  userName: 'Spectre',
  chipId: 'hunter_nearby',
});
assert(chipMsg !== null, 'buildRadioChipMessage builds valid message');
assert(chipMsg?.kind === 'chip', 'Message kind is chip');
assert(chipMsg?.body === 'Hunter nearby!', 'Message body matches chip label');
assert(chipMsg?.sender_name === 'Spectre', 'Message has correct sender name');
assert(buildRadioChipMessage({
  gameId: 'g-100',
  team: 'runner',
  playerId: 'p-1',
  userId: 'u-1',
  userName: 'Spectre',
  chipId: 'non_existent_chip',
}) === null, 'Rejects unknown chip ID with null');

// Test 4: Sanitization - valid message
const valid = sanitizeRadioMessage('Moving east towards extraction point');
assert(valid.isValid && !valid.isCensored && valid.cleanText === 'Moving east towards extraction point', 'Valid clean text passes');

// Test 5: Sanitization - empty or whitespace
const empty = sanitizeRadioMessage('    ');
assert(!empty.isValid, 'Rejects whitespace-only message');

// Test 6: Sanitization - length guard
const longText = 'A'.repeat(201);
const longRes = sanitizeRadioMessage(longText);
assert(!longRes.isValid && Boolean(longRes.error?.includes('exceeds')), 'Rejects message over 200 chars');

// Test 7: Sanitization - profanity filter
const profane = sanitizeRadioMessage('Watch out shit he is right there');
assert(profane.isValid && profane.isCensored && Boolean(profane.cleanText.includes('****')), 'Censors profanity with asterisks');

// Test 8: Rate limit - empty history
const firstMsg = checkRadioRateLimit([]);
assert(firstMsg.allowed, 'First message is immediately allowed');

// Test 9: Rate limit - burst within 1 second
const now = 1000000;
const burst = checkRadioRateLimit([now - 400], now);
assert(!burst.allowed && burst.reason === 'second', 'Rejects message sent under 1000ms from previous');

// Test 10: Rate limit - message after 1200ms
const normalGap = checkRadioRateLimit([now - 1200], now);
assert(normalGap.allowed, 'Allows message sent after 1000ms');

// Test 11: Rate limit - 60 second burst threshold (20 msgs)
const timestamps20 = Array.from({ length: 20 }, (_, i) => now - 50000 + i * 2000);
const overCap = checkRadioRateLimit(timestamps20, now);
assert(!overCap.allowed && overCap.reason === 'minute', 'Rejects 21st message within 60 second window');

// Test 12: Block filter
const messages: TeamMessage[] = [
  {
    id: 'm1',
    game_id: 'g1',
    team: 'runner',
    sender_player_id: 'p1',
    sender_user_id: 'user-clean',
    sender_name: 'GhostA',
    kind: 'text',
    body: 'Hello team',
    created_at: new Date().toISOString(),
  },
  {
    id: 'm2',
    game_id: 'g1',
    team: 'runner',
    sender_player_id: 'p2',
    sender_user_id: 'user-bad',
    sender_name: 'TrollB',
    kind: 'text',
    body: 'Spam text',
    created_at: new Date().toISOString(),
  },
];

const blocked = new Set(['user-bad']);
const filtered = filterBlockedMessages(messages, blocked);
assert(filtered.length === 1 && filtered[0].id === 'm1', 'Filters out messages sent by blocked users');

// Test 13: Reported message filter
const reported = new Set(['m2']);
const filteredReported = filterReportedMessages(messages, reported);
assert(filteredReported.length === 1 && filteredReported[0].id === 'm1', 'Filters out locally reported messages');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

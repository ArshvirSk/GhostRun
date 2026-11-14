import {
  RADIO_QUICK_CHIPS,
  sanitizeRadioMessage,
  checkRadioRateLimit,
  filterBlockedMessages,
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

// Test 2: Sanitization - valid message
const valid = sanitizeRadioMessage('Moving east towards extraction point');
assert(valid.isValid && !valid.isCensored && valid.cleanText === 'Moving east towards extraction point', 'Valid clean text passes');

// Test 3: Sanitization - empty or whitespace
const empty = sanitizeRadioMessage('    ');
assert(!empty.isValid, 'Rejects whitespace-only message');

// Test 4: Sanitization - length guard
const longText = 'A'.repeat(201);
const longRes = sanitizeRadioMessage(longText);
assert(!longRes.isValid && Boolean(longRes.error?.includes('exceeds')), 'Rejects message over 200 chars');

// Test 5: Sanitization - profanity filter
const profane = sanitizeRadioMessage('Watch out shit he is right there');
assert(profane.isValid && profane.isCensored && Boolean(profane.cleanText.includes('****')), 'Censors profanity with asterisks');

// Test 6: Rate limit - empty history
const firstMsg = checkRadioRateLimit([]);
assert(firstMsg.allowed, 'First message is immediately allowed');

// Test 7: Rate limit - burst within 1 second
const now = 1000000;
const burst = checkRadioRateLimit([now - 400], now);
assert(!burst.allowed && burst.reason === 'second', 'Rejects message sent under 1000ms from previous');

// Test 8: Rate limit - message after 1200ms
const normalGap = checkRadioRateLimit([now - 1200], now);
assert(normalGap.allowed, 'Allows message sent after 1000ms');

// Test 9: Rate limit - 60 second burst threshold (20 msgs)
const timestamps20 = Array.from({ length: 20 }, (_, i) => now - 50000 + i * 2000);
const overCap = checkRadioRateLimit(timestamps20, now);
assert(!overCap.allowed && overCap.reason === 'minute', 'Rejects 21st message within 60 second window');

// Test 10: Block filter
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

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

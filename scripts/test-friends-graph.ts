/**
 * GhostRun — Friends Graph & Presence Test Suite (FL-P1)
 */

import assert from 'node:assert';
import {
  canonicalFriendPair,
  isDeclineCooldownActive,
  isPresenceExpired,
  formatFriendInviteUrl,
  MAX_FRIEND_REQUESTS_PER_DAY,
  MAX_PENDING_REQUESTS,
  MAX_FRIENDS,
  DECLINE_COOLDOWN_DAYS,
  PRESENCE_TTL_MINUTES,
} from '../src/lib/friendsCore';

console.log('--- GhostRun FL-P1: Friends Graph & Presence Test Suite ---');

// 1. Canonical Pair Ordering
console.log('\n[1] Testing Canonical Friend Pair Sorting...');

const u1 = '11111111-1111-4111-8111-111111111111';
const u2 = '22222222-2222-4222-8222-222222222222';

const pair1 = canonicalFriendPair(u1, u2);
const pair2 = canonicalFriendPair(u2, u1);

assert.strictEqual(pair1[0], u1);
assert.strictEqual(pair1[1], u2);
assert.deepStrictEqual(pair1, pair2, 'Pair ordering must be strictly canonical (u1 < u2)');
console.log('  PASS: Canonical pair sorting verified');

// 2. Decline Cooldown Calculation
console.log('\n[2] Testing 7-Day Decline Cooldown...');

const now = Date.now();
const recentDecline = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
const oldDecline = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago

assert.strictEqual(isDeclineCooldownActive(recentDecline, now), true, '2 days ago should still be in cooldown');
assert.strictEqual(isDeclineCooldownActive(oldDecline, now), false, '8 days ago should be expired cooldown');
assert.strictEqual(isDeclineCooldownActive(null, now), false, 'Null respondedAt has no active cooldown');
console.log('  PASS: 7-day decline cooldown correctly verified');

// 3. Ephemeral Host Presence Expiry
console.log('\n[3] Testing Host Presence 30-Minute Expiry...');

const futureExpiry = new Date(now + 15 * 60 * 1000).toISOString(); // +15 mins
const pastExpiry = new Date(now - 1 * 60 * 1000).toISOString(); // -1 min

assert.strictEqual(isPresenceExpired(futureExpiry, now), false, 'Future expiry is not expired');
assert.strictEqual(isPresenceExpired(pastExpiry, now), true, 'Past expiry is expired');
console.log('  PASS: Host presence expiration verified');

// 4. Invite URL Formatting
console.log('\n[4] Testing Friend Invite Token Formatting...');

const sampleToken = 'token_abc123xyz456';
const inviteUrl = formatFriendInviteUrl(sampleToken);
assert.strictEqual(inviteUrl, 'https://ghostrun.app/join?friend_invite=token_abc123xyz456');
console.log('  PASS: Invite token URL properly formatted');

// 5. System Invariant Constants
console.log('\n[5] Verifying System Invariant Limits...');

assert.strictEqual(MAX_FRIEND_REQUESTS_PER_DAY, 10, 'Daily friend request limit must be 10');
assert.strictEqual(MAX_PENDING_REQUESTS, 20, 'Max pending outgoing must be 20');
assert.strictEqual(MAX_FRIENDS, 200, 'Max friends ceiling must be 200');
assert.strictEqual(DECLINE_COOLDOWN_DAYS, 7, 'Decline cooldown must be 7 days');
assert.strictEqual(PRESENCE_TTL_MINUTES, 30, 'Presence TTL must be 30 minutes');
console.log('  PASS: All 5 friend graph limits match specification');

console.log('\nAll FL-P1 Friends Graph tests passed successfully!');

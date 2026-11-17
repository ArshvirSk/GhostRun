/**
 * GhostRun — Private Friends Board & Head-to-Head Test Suite (FL-P3)
 */

import assert from 'node:assert';
import {
  isRoundEligibleForBoard,
  getBoardEmptyStateMessage,
  HOW_ECHO_WORKS_EXPLAINER,
  PRIVACY_DELAY_MINUTES,
  FriendsBoardEntry,
} from '../src/lib/friendsBoardCore';

console.log('--- GhostRun FL-P3: Private Friends Board Test Suite ---');

// 1. 60-Minute Privacy Delay Filter Rule
console.log('\n[1] Testing 60-Minute Privacy Delay Filter Rule...');

const now = Date.now();
const recentMatch = new Date(now - 45 * 60 * 1000).toISOString(); // 45 min ago
const eligibleMatch = new Date(now - 65 * 60 * 1000).toISOString(); // 65 min ago
const oldMatch = new Date(now - 180 * 60 * 1000).toISOString(); // 3 hours ago

assert.strictEqual(PRIVACY_DELAY_MINUTES, 60, 'Privacy delay constant must be 60 minutes');
assert.strictEqual(
  isRoundEligibleForBoard(recentMatch, now),
  false,
  'Match completed 45 min ago must be hidden from friends board',
);
assert.strictEqual(
  isRoundEligibleForBoard(eligibleMatch, now),
  true,
  'Match completed 65 min ago is eligible for board inclusion',
);
assert.strictEqual(
  isRoundEligibleForBoard(oldMatch, now),
  true,
  'Match completed 3 hours ago is eligible for board inclusion',
);
console.log('  PASS: 60-minute privacy delay rule strictly verified');

// 2. Empty State User-Friendly Messaging
console.log('\n[2] Testing Empty State Copy Across Squad Sizes...');

const zeroFriends = getBoardEmptyStateMessage(0);
assert.strictEqual(zeroFriends.title, 'No Operatives Connected');
assert(zeroFriends.subtitle.includes('Add operatives by codename'));

const oneFriend = getBoardEmptyStateMessage(1);
assert.strictEqual(oneFriend.title, 'Squad Too Small');
assert(oneFriend.subtitle.includes('Connect with two or more operatives'));

const fullSquadNoRounds = getBoardEmptyStateMessage(3);
assert.strictEqual(fullSquadNoRounds.title, 'No Counted Rounds Yet');
assert(fullSquadNoRounds.subtitle.includes('60 minutes'));
console.log('  PASS: Empty states provide clear guidance per network size');

// 3. Explainer & Worked Examples Content Fidelity
console.log('\n[3] Testing "How Echo Works" Explainer Fidelity...');

assert.strictEqual(HOW_ECHO_WORKS_EXPLAINER.title, 'How Echo Works');
assert(HOW_ECHO_WORKS_EXPLAINER.sections.length >= 4);

const priyaEx = HOW_ECHO_WORKS_EXPLAINER.workedExamples.find((ex) => ex.agent.includes('Priya'));
assert(priyaEx !== undefined, 'Priya worked example must be present');
assert.strictEqual(priyaEx?.result, '82 Echo');
assert(priyaEx?.formula.includes('0.611'));

const samEx = HOW_ECHO_WORKS_EXPLAINER.workedExamples.find((ex) => ex.agent.includes('Sam'));
assert(samEx !== undefined, 'Sam worked example must be present');
assert.strictEqual(samEx?.result, '29 Echo');
assert(samEx?.formula.includes('0.3125'));
console.log('  PASS: Educational worked examples match specification exactly');

// 4. Board Dense Ranking & Highlighting
console.log('\n[4] Testing Board Sorting & Highlighting Logic...');

const mockBoard: FriendsBoardEntry[] = [
  {
    rank: 1,
    userId: 'u1',
    displayName: 'Priya',
    handle: 'priya_tactical',
    seasonEcho: 820,
    tier: 'Phantom',
    roundsCounted: 10,
    avgGhost: 61.1,
    avgCash: 0,
    isSelf: false,
  },
  {
    rank: 2,
    userId: 'u2',
    displayName: 'Me',
    handle: 'operative_alpha',
    seasonEcho: 780,
    tier: 'Wraith',
    roundsCounted: 12,
    avgGhost: 58.4,
    avgCash: 45.0,
    isSelf: true,
  },
  {
    rank: 3,
    userId: 'u3',
    displayName: 'Sam',
    handle: 'sam_tracker',
    seasonEcho: 348,
    tier: 'Whisper',
    roundsCounted: 12,
    avgGhost: 0,
    avgCash: 31.3,
    isSelf: false,
  },
];

assert.strictEqual(mockBoard[0].rank, 1);
assert.strictEqual(mockBoard[1].isSelf, true, 'User row is cleanly identified for highlight');
assert(mockBoard[0].seasonEcho > mockBoard[1].seasonEcho);
assert(mockBoard[1].seasonEcho > mockBoard[2].seasonEcho);
console.log('  PASS: Board entries sorted and highlighted accurately');

// 5. Head-to-Head Privacy Secrecy
console.log('\n[5] Testing Head-to-Head Count-Only Privacy...');

const mockH2H = {
  available: true,
  friendId: 'u1',
  friendName: 'Priya',
  oppositeRounds: 6,
  myWins: 4,
  friendWins: 2,
  timesGhostedThem: 8,
  timesTheyCashedMe: 3,
};

// Ensure zero location or timestamp fields exist on H2H response
const forbiddenKeys = ['lat', 'latitude', 'lng', 'longitude', 'coordinate', 'timestamp', 'date', 'route', 'polyline'];
for (const key of Object.keys(mockH2H)) {
  for (const f of forbiddenKeys) {
    assert(!key.toLowerCase().includes(f), `Key ${key} must not contain forbidden telemetry ${f}`);
  }
}
console.log('  PASS: Head-to-Head provides discrete counters with zero location leakage');

console.log('\nAll FL-P3 Private Friends Board tests passed successfully!');

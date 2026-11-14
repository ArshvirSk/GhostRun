/**
 * GhostRun — Handles and Moderation Test Suite (FL-P0)
 */

import assert from 'node:assert';
import { validateHandle, formatHandleDisplay, RESERVED_HANDLES } from '../src/lib/handlesCore';
import {
  validateReportPayload,
  isUserBlocked,
  generateModerationDigest,
  ReportItem,
  BlockItem,
} from '../src/lib/moderationCore';

console.log('--- GhostRun FL-P0: Handles & Moderation Test Suite ---');

// 1. Handle Validation Tests
console.log('\n[1] Testing Handle Validation Rules...');

const validHandles = ['agent007', 'shadow_runner', 'neon_ghost', 'x_1', 'ghost_operative_99'];
for (const h of validHandles) {
  const res = validateHandle(h);
  assert.strictEqual(res.valid, true, `Handle "${h}" should be valid`);
  assert.strictEqual(res.normalized, h);
}
console.log(`  PASS: Validated ${validHandles.length} valid handles`);

// Too short
assert.strictEqual(validateHandle('ab').valid, false);
assert.strictEqual(validateHandle('ab').error, 'too_short');
console.log('  PASS: Rejected handle < 3 chars');

// Too long
assert.strictEqual(validateHandle('a_very_long_handle_exceeding_20_chars').valid, false);
assert.strictEqual(validateHandle('a_very_long_handle_exceeding_20_chars').error, 'too_long');
console.log('  PASS: Rejected handle > 20 chars');

// Consecutive underscores
assert.strictEqual(validateHandle('ghost__runner').valid, false);
assert.strictEqual(validateHandle('ghost__runner').error, 'consecutive_underscores');
console.log('  PASS: Rejected consecutive underscores');

// Leading/Trailing underscores
assert.strictEqual(validateHandle('_shadow').valid, false);
assert.strictEqual(validateHandle('_shadow').error, 'invalid_chars');
assert.strictEqual(validateHandle('shadow_').valid, false);
assert.strictEqual(validateHandle('shadow_').error, 'invalid_chars');
console.log('  PASS: Rejected leading and trailing underscores');

// Invalid characters
assert.strictEqual(validateHandle('ghost runner').valid, false); // Space
assert.strictEqual(validateHandle('ghost@runner').valid, false); // Symbol
assert.strictEqual(validateHandle('ghost!').valid, false); // Exclamation
console.log('  PASS: Rejected spaces and invalid symbols');

// Reserved handles (case-insensitive)
const reservedSample = ['admin', 'ADMIN', 'GhostRun', 'support', 'system', 'hunter', 'ai_gm'];
for (const r of reservedSample) {
  const res = validateHandle(r);
  assert.strictEqual(res.valid, false, `Reserved word "${r}" must be rejected`);
  assert.strictEqual(res.error, 'reserved');
}
console.log(`  PASS: Rejected ${reservedSample.length} reserved words case-insensitively`);

// formatHandleDisplay
assert.strictEqual(formatHandleDisplay('phantom'), '@phantom');
assert.strictEqual(formatHandleDisplay('@phantom'), '@phantom');
assert.strictEqual(formatHandleDisplay(''), '');
console.log('  PASS: formatHandleDisplay works properly');

// 2. Report Payload Validation Tests
console.log('\n[2] Testing Report Payload Validation...');

const validReport = validateReportPayload({
  reportedUserId: 'target-uuid-1234',
  context: 'lobby',
  reason: 'inappropriate_name',
  details: 'Offensive name in match lobby',
});
assert.strictEqual(validReport.valid, true);
console.log('  PASS: Valid report payload accepted');

const missingTarget = validateReportPayload({
  reportedUserId: '',
  context: 'friends',
  reason: 'harassment',
});
assert.strictEqual(missingTarget.valid, false);
assert.strictEqual(missingTarget.error, 'Target user ID is required');
console.log('  PASS: Missing target user ID rejected');

const invalidContext = validateReportPayload({
  reportedUserId: 'target-uuid',
  context: 'marketplace',
  reason: 'harassment',
});
assert.strictEqual(invalidContext.valid, false);
assert.strictEqual(invalidContext.error, 'Invalid report context');
console.log('  PASS: Invalid context rejected');

const invalidReason = validateReportPayload({
  reportedUserId: 'target-uuid',
  context: 'board',
  reason: 'bad_vibe',
});
assert.strictEqual(invalidReason.valid, false);
assert.strictEqual(invalidReason.error, 'Invalid report reason');
console.log('  PASS: Invalid reason rejected');

const longDetails = validateReportPayload({
  reportedUserId: 'target-uuid',
  context: 'radio',
  reason: 'harassment',
  details: 'x'.repeat(201),
});
assert.strictEqual(longDetails.valid, false);
assert.strictEqual(longDetails.error, 'Report details exceed 200 characters limit');
console.log('  PASS: Details exceeding 200 chars rejected');

// 3. Blocklist Filtering Tests
console.log('\n[3] Testing Blocklist Filtering...');

const blocklist: BlockItem[] = [
  { blockedUserId: 'user-bad-1', displayName: 'Griefer', blockedAt: new Date().toISOString() },
  { blockedUserId: 'user-bad-2', displayName: 'Spammer', blockedAt: new Date().toISOString() },
];

assert.strictEqual(isUserBlocked('user-bad-1', blocklist), true);
assert.strictEqual(isUserBlocked('user-good-3', blocklist), false);
console.log('  PASS: isUserBlocked identifies blocked users accurately');

// 4. Daily Moderation Digest Tests
console.log('\n[4] Testing Daily Moderation Digest Generation...');

const emptyDigest = generateModerationDigest([], '2026-11-15');
assert(emptyDigest.includes('No pending reports. Community queue is clean.'));
console.log('  PASS: Clean queue digest formatted correctly');

const testReports: ReportItem[] = [
  {
    id: 'rep-001',
    reporterId: 'user-rep-1',
    reporterHandle: 'clean_player',
    reportedId: 'user-tgt-1',
    reportedHandle: 'bad_actor',
    context: 'board',
    reason: 'inappropriate_name',
    details: 'Impersonating staff handle',
    status: 'pending',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'rep-002',
    reporterId: 'user-rep-2',
    reportedId: 'user-tgt-2',
    reportedName: 'CheaterX',
    context: 'lobby',
    reason: 'cheating',
    status: 'actioned',
    actionTaken: 'suspend',
    createdAt: new Date().toISOString(),
  },
];

const digestWithReports = generateModerationDigest(testReports, '2026-11-15');
assert(digestWithReports.includes('Total Reports: 2'));
assert(digestWithReports.includes('Pending Action: 1'));
assert(digestWithReports.includes('@bad_actor'));
assert(digestWithReports.includes('@clean_player'));
assert(digestWithReports.includes('Impersonating staff handle'));
console.log('  PASS: Active queue digest formatted correctly with pending filter');

console.log('\nAll FL-P0 Handles & Moderation tests passed successfully!');

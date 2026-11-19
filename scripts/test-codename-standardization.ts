/**
 * GhostRun — Codename & Username Standardization Test Suite
 */

import assert from 'node:assert';
import {
  sanitizeCodename,
  validateCodename,
  normalizeForSearch,
  codenameToHandle,
  matchesSearchQuery,
} from '../src/lib/codename';

console.log('--- GhostRun: Codename & Username Standardization Test Suite ---\n');

// 1. All-Caps and Sanitization Tests
console.log('[1] Testing All-Caps & Sanitization...');
assert.strictEqual(sanitizeCodename('alphaop'), 'ALPHAOP');
assert.strictEqual(sanitizeCodename('Jash Damania'), 'JASH DAMANIA');
assert.strictEqual(sanitizeCodename('  shadow   runner  '), 'SHADOW RUNNER');
assert.strictEqual(sanitizeCodename('agent_007!'), 'AGENT_007');
assert.strictEqual(sanitizeCodename('ghost@run#123'), 'GHOSTRUN123');
assert.strictEqual(sanitizeCodename('a'.repeat(25)), 'A'.repeat(20));
console.log('  PASS: Standardized to ALL CAPS and sanitized invalid symbols.');

// 2. Codename Validation
console.log('\n[2] Testing Codename Validation...');
const valid = validateCodename('neon ghost');
assert.strictEqual(valid.valid, true);
assert.strictEqual(valid.clean, 'NEON GHOST');

const tooShort = validateCodename('a');
assert.strictEqual(tooShort.valid, false);
assert.strictEqual(tooShort.error, 'Codename must be at least 2 characters.');

const symbolsOnly = validateCodename('!@#$%');
assert.strictEqual(symbolsOnly.valid, false);

const longName = validateCodename('the_greatest_shadow_operative_ever');
assert.strictEqual(longName.valid, true);
assert.strictEqual(longName.clean.length, 20);
console.log('  PASS: Codename length and boundary checks validated.');

// 3. Normalization for Search (Space & Underscore Invariant)
console.log('\n[3] Testing Space-Insensitive Search Normalization...');
assert.strictEqual(normalizeForSearch('@AlphaOP'), 'alphaop');
assert.strictEqual(normalizeForSearch('ALPHA OP'), 'alphaop');
assert.strictEqual(normalizeForSearch('alpha_op'), 'alphaop');
assert.strictEqual(normalizeForSearch('  alpha - op  '), 'alphaop');
assert.strictEqual(normalizeForSearch('Jash Damania'), 'jashdamania');
assert.strictEqual(normalizeForSearch('@jash_damania'), 'jashdamania');
console.log('  PASS: Search normalization ignores @, spaces, underscores, and hyphens.');

// 4. Flexible Matching Engine
console.log('\n[4] Testing Space-Insensitive Operative Matching...');
// User searches without space against codename with space
assert.strictEqual(matchesSearchQuery('alphaop', 'ALPHA OP', 'alpha_op'), true);
// User searches with space against codename without space
assert.strictEqual(matchesSearchQuery('alpha op', 'ALPHAOP', 'alphaop'), true);
// User searches with underscore
assert.strictEqual(matchesSearchQuery('alpha_op', 'ALPHA OP', null), true);
// User searches with @ prefix
assert.strictEqual(matchesSearchQuery('@jash', 'JASH DAMANIA', 'jash_damania'), true);
assert.strictEqual(matchesSearchQuery('jashdamania', 'JASH DAMANIA', null), true);
assert.strictEqual(matchesSearchQuery('gay', 'GAY', 'gay'), true);
assert.strictEqual(matchesSearchQuery('unknown', 'ALPHA OP', 'alpha_op'), false);
console.log('  PASS: Operative matches succeed regardless of space or underscore styling.');

// 5. Handle Derivation
console.log('\n[5] Testing Database Handle Derivation...');
assert.strictEqual(codenameToHandle('ALPHA OP'), 'alpha_op');
assert.strictEqual(codenameToHandle('  JASH   DAMANIA  '), 'jash_damania');
assert.strictEqual(codenameToHandle('GAY'), 'gay');
assert.strictEqual(codenameToHandle('_GHOST_RUNNER_'), 'ghost_runner');
console.log('  PASS: Canonical handle derivation produces compliant database handles.');

console.log('\nAll Codename & Username Standardization tests passed successfully!\n');

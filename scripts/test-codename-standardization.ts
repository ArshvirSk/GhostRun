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

// 6. Tactical Discriminator Tag (Valorant style)
console.log('\n[6] Testing Tactical Discriminator Taglines...');
import {
  sanitizeTagline,
  validateTagline,
  parseCodenameAndTag,
  formatCodenameWithTag,
} from '../src/lib/codename';

assert.strictEqual(sanitizeTagline('#10D1'), '10D1');
assert.strictEqual(sanitizeTagline('na1'), 'NA1');
assert.strictEqual(sanitizeTagline('007'), '007');
assert.strictEqual(sanitizeTagline('too_long_tag'), 'TOOLO');

assert.strictEqual(validateTagline('10D1').valid, true);
assert.strictEqual(validateTagline('ab').valid, false); // < 3 chars
assert.strictEqual(validateTagline('10D1').clean, '10D1');

const parsed1 = parseCodenameAndTag('ALPHAOP#10D1');
assert.strictEqual(parsed1.codename, 'ALPHAOP');
assert.strictEqual(parsed1.tag, '10D1');

const parsed2 = parseCodenameAndTag('Jash Damania #B8B9');
assert.strictEqual(parsed2.codename, 'JASH DAMANIA');
assert.strictEqual(parsed2.tag, 'B8B9');

const formatted = formatCodenameWithTag('ALPHAOP', '10D1');
assert.strictEqual(formatted, 'ALPHAOP#10D1');

// Match with #TAG
assert.strictEqual(matchesSearchQuery('ALPHAOP#10D1', 'ALPHAOP', null, '10D1'), true);
assert.strictEqual(matchesSearchQuery('ALPHAOP#9999', 'ALPHAOP', null, '10D1'), false);
assert.strictEqual(matchesSearchQuery('#10D1', 'ALPHAOP', null, '10D1'), true);
console.log('  PASS: Valorant-style discriminator tags and parsing verified.');

console.log('\nAll Codename & Username Standardization tests passed successfully!\n');

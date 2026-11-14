import {
  BADGE_CATALOG,
  evaluateEarnedBadges,
  MatchBadgeEvaluationInput,
} from '../src/lib/badges';

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

console.log('--- NF-11 Badges & Personal Records Unit Tests ---');

// Test 1: Catalog completeness
assert(BADGE_CATALOG.length === 7, 'Defines exactly 7 canonical badges');
const badgeIds = new Set(BADGE_CATALOG.map((b) => b.id));
assert(badgeIds.size === 7, 'All badge IDs are unique');
assert(badgeIds.has('first_deployment'), 'Includes first_deployment');
assert(badgeIds.has('ghost_whisperer'), 'Includes ghost_whisperer');
assert(badgeIds.has('closest_call'), 'Includes closest_call');

// Test 2: First match deployment
const firstMatchInput: MatchBadgeEvaluationInput = {
  role: 'runner',
  isVictory: false,
  isTagged: true,
  totalMatchesCount: 1,
  cumulativeDistanceMeters: 800,
};
const earnedFirst = evaluateEarnedBadges(firstMatchInput);
assert(earnedFirst.includes('first_deployment'), 'Awards first_deployment on match 1');
assert(!earnedFirst.includes('veteran_operative'), 'Does not award veteran_operative on match 1');

// Test 3: Veteran operative (10 matches)
const veteranInput: MatchBadgeEvaluationInput = {
  ...firstMatchInput,
  totalMatchesCount: 10,
};
const earnedVet = evaluateEarnedBadges(veteranInput, new Set(['first_deployment']));
assert(earnedVet.includes('veteran_operative'), 'Awards veteran_operative on match 10');
assert(!earnedVet.includes('first_deployment'), 'Skips already earned first_deployment');

// Test 4: Closest call evasion
const closeCallInput: MatchBadgeEvaluationInput = {
  role: 'runner',
  isVictory: true,
  isTagged: false,
  totalMatchesCount: 3,
  cumulativeDistanceMeters: 2000,
  closestCallMeters: 12,
};
const earnedClose = evaluateEarnedBadges(closeCallInput);
assert(earnedClose.includes('closest_call'), 'Awards closest_call when hunter within 15m');
assert(earnedClose.includes('ghost_whisperer'), 'Awards ghost_whisperer to victorious un-tagged runner');

// Test 5: Noise meter / Silent step
const silentInput: MatchBadgeEvaluationInput = {
  role: 'runner',
  isVictory: true,
  isTagged: false,
  totalMatchesCount: 2,
  cumulativeDistanceMeters: 1500,
  loudestNoiseDb: 52,
};
const earnedSilent = evaluateEarnedBadges(silentInput);
assert(earnedSilent.includes('silent_step'), 'Awards silent_step when peak noise <= 60 dB');

// Test 6: Hunter Clean Sweep
const hunterInput: MatchBadgeEvaluationInput = {
  role: 'hunter',
  isVictory: true,
  isTagged: false,
  totalMatchesCount: 5,
  cumulativeDistanceMeters: 3000,
};
const earnedHunter = evaluateEarnedBadges(hunterInput);
assert(earnedHunter.includes('clean_sweep'), 'Awards clean_sweep on hunter victory');
assert(!earnedHunter.includes('ghost_whisperer'), 'Does not award runner badges to hunter');

// Test 7: Marathoner (5000m distance)
const marathonInput: MatchBadgeEvaluationInput = {
  role: 'runner',
  isVictory: false,
  isTagged: true,
  totalMatchesCount: 8,
  cumulativeDistanceMeters: 5400,
};
const earnedMarathon = evaluateEarnedBadges(marathonInput);
assert(earnedMarathon.includes('marathoner'), 'Awards marathoner when distance >= 5000m');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

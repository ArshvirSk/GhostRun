import {
  BADGE_CATALOG,
  getBadgeDefinition,
  getBadgesByCategory,
  evaluateEarnedBadges,
  updatePersonalRecords,
  DEFAULT_PERSONAL_RECORDS,
  MatchBadgeEvaluationInput,
  PersonalRecords,
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

// Test 2: Category lookup & badge definitions
const survivalBadges = getBadgesByCategory('survival');
assert(survivalBadges.length === 3, 'Finds 3 survival badges (closest_call, ghost_whisperer, silent_step)');
assert(survivalBadges.some((b) => b.id === 'silent_step'), 'survival includes silent_step');

const firstDef = getBadgeDefinition('first_deployment');
assert(firstDef?.title === 'First Deployment', 'Finds first_deployment definition');
assert(getBadgeDefinition('invalid_id') === undefined, 'Returns undefined for non-existent badge');

// Test 3: First match deployment
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

// Test 4: Veteran operative (10 matches)
const veteranInput: MatchBadgeEvaluationInput = {
  ...firstMatchInput,
  totalMatchesCount: 10,
};
const earnedVet = evaluateEarnedBadges(veteranInput, new Set(['first_deployment']));
assert(earnedVet.includes('veteran_operative'), 'Awards veteran_operative on match 10');
assert(!earnedVet.includes('first_deployment'), 'Skips already earned first_deployment');

// Test 5: Closest call evasion
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

// Test 6: Noise meter / Silent step
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

// Test 7: Hunter Clean Sweep
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

// Test 8: Marathoner (5000m distance)
const marathonInput: MatchBadgeEvaluationInput = {
  role: 'runner',
  isVictory: false,
  isTagged: true,
  totalMatchesCount: 8,
  cumulativeDistanceMeters: 5400,
};
const earnedMarathon = evaluateEarnedBadges(marathonInput);
assert(earnedMarathon.includes('marathoner'), 'Awards marathoner when distance >= 5000m');

// Test 9: Personal records update
const initial: PersonalRecords = { ...DEFAULT_PERSONAL_RECORDS };
const { updated, newRecords } = updatePersonalRecords(initial, {
  evadedSeconds: 420,
  closestCallMeters: 8.5,
  speedKmh: 19.4,
  distanceMeters: 1250,
  isVictory: true,
});
assert(updated.longestEvadedSeconds === 420, 'Updates longest evasion to 420s');
assert(updated.closestCallMeters === 8.5, 'Updates closest call to 8.5m');
assert(updated.maxSpeedKmh === 19.4, 'Updates max speed to 19.4 km/h');
assert(updated.totalDistanceMeters === 1250, 'Accumulates 1250m distance');
assert(updated.totalVictories === 1, 'Increments victory counter to 1');
assert(newRecords.includes('longest_evasion'), 'Flags longest_evasion record');
assert(newRecords.includes('closest_call'), 'Flags closest_call record');
assert(newRecords.includes('top_speed'), 'Flags top_speed record');

// Test 10: Personal records non-regressive update
const { updated: noChange, newRecords: emptyRecords } = updatePersonalRecords(updated, {
  evadedSeconds: 300, // less than 420
  closestCallMeters: 14.0, // further than 8.5m
  speedKmh: 12.0, // slower than 19.4
  distanceMeters: 500,
  isVictory: false,
});
assert(noChange.longestEvadedSeconds === 420, 'Retains superior 420s record');
assert(noChange.closestCallMeters === 8.5, 'Retains tighter 8.5m closest call record');
assert(noChange.maxSpeedKmh === 19.4, 'Retains top speed of 19.4 km/h');
assert(noChange.totalDistanceMeters === 1750, 'Accumulates distance to 1750m');
assert(emptyRecords.length === 0, 'No new records flagged on sub-par stats');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

import assert from 'node:assert';
import {
  evaluateAreaCompatibility,
  estimatePacingProfile,
  computeRecommendedDurationMinutes,
  computeRecommendedRadiusM,
} from '../src/lib/areaCompatibility';

console.log('--- Testing Area & Duration Compatibility Engine ---');

// Test 1: Standard balanced game (500m radius, 15 minutes)
const optimal = evaluateAreaCompatibility(500, 15);
assert(optimal.isCompatible === true, '500m / 15m should be compatible');
assert(optimal.status === 'optimal', 'Status should be optimal');
assert(optimal.badgeLabel.includes('COMPATIBLE'), 'Badge should indicate compatible');
console.log('✓ Test 1: Balanced arena & duration evaluates as optimal');

// Test 2: Huge arena for short time (3000m radius / 6km diameter in 5 minutes)
const tooLarge = evaluateAreaCompatibility(3000, 5);
assert(tooLarge.isCompatible === false, '3000m / 5m should be incompatible (requires sprint/driving)');
assert(tooLarge.status === 'too_large', 'Status should be too_large');
assert(tooLarge.badgeLabel.includes('TOO LARGE'), 'Badge should indicate too large');
console.log('✓ Test 2: Excessive radius for brief duration flagged as too large');

// Test 3: Cramped arena for long match (80m radius in 30 minutes)
const tooCramped = evaluateAreaCompatibility(80, 30);
assert(tooCramped.isCompatible === false, '80m / 30m should be flagged as cramped');
assert(tooCramped.status === 'too_cramped', 'Status should be too_cramped');
assert(tooCramped.badgeLabel.includes('CRAMPED'), 'Badge should indicate cramped');
console.log('✓ Test 3: Cramped area for long duration flagged as cramped');

// Test 4: Extreme Blackout compact zone (300m radius in 10 minutes)
const blackoutScale = evaluateAreaCompatibility(300, 10);
assert(blackoutScale.isCompatible === true, '300m / 10m should be compatible');
assert(blackoutScale.status === 'optimal', 'Blackout tactical scale should be optimal');
console.log('✓ Test 4: Compact tactical radius evaluates as optimal');

// Test 5: Pacing profile estimation
const sprintPace = estimatePacingProfile(2000, 5);
assert.strictEqual(sprintPace.paceCategory, 'unsustainable_sprint', '2km in 5m is sprint');

const jogPace = estimatePacingProfile(800, 10);
assert.strictEqual(jogPace.paceCategory, 'tactical_jog', '800m in 10m is tactical jog');

const walkPace = estimatePacingProfile(400, 10);
assert.strictEqual(walkPace.paceCategory, 'brisk_walk', '400m in 10m is brisk walk');
console.log('✓ Test 5: estimatePacingProfile correctly classifies speed tiers');

// Test 6: computeRecommendedDurationMinutes
const recDuration = computeRecommendedDurationMinutes(500, 'balanced');
assert(recDuration >= 10 && recDuration <= 15, '500m balanced duration is around 11-12m');

const recFastDuration = computeRecommendedDurationMinutes(500, 'fast');
assert(recFastDuration < recDuration, 'Fast pacing recommends shorter duration');
console.log('✓ Test 6: computeRecommendedDurationMinutes produces realistic match times');

// Test 7: computeRecommendedRadiusM
const recRadius = computeRecommendedRadiusM(15, 'balanced');
assert(recRadius >= 600 && recRadius <= 800, '15m balanced radius is between 600m and 800m');
console.log('✓ Test 7: computeRecommendedRadiusM produces realistic arena scale');

console.log('All Area & Duration Compatibility tests passed successfully!\n');

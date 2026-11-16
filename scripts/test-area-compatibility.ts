import assert from 'node:assert';
import { evaluateAreaCompatibility } from '../src/lib/areaCompatibility';

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

console.log('All Area & Duration Compatibility tests passed successfully!\n');

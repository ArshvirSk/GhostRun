import {
  evaluateBoundaryState,
  BoundaryPenalty,
} from '../src/lib/boundaryRules';

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

console.log('--- NF-09 Boundary Rule Options Unit Tests ---');

const center = { latitude: 37.7749, longitude: -122.4194 };
const radiusM = 500;

// Test 1: Well inside area (center)
const inside = evaluateBoundaryState({
  playerPos: { latitude: 37.7749, longitude: -122.4194, accuracy: 5 },
  areaCenter: center,
  areaRadiusM: radiusM,
  boundaryPenalty: 'warn',
  outOfBoundsSince: null,
});
assert(!inside.isOutOfBounds, 'Center position is within boundary');
assert(inside.penaltyState === 'none', 'Inside position has penaltyState none');

// Test 2: Drift buffer tolerance (just outside radius by 2m)
// 1 deg lat ~ 111,000m. 500m ~ 0.00450 deg. 502m ~ 0.00452 deg
const nearEdge = evaluateBoundaryState({
  playerPos: { latitude: 37.7749 + 0.00451, longitude: -122.4194, accuracy: 5 },
  areaCenter: center,
  areaRadiusM: radiusM,
  boundaryPenalty: 'warn',
  outOfBoundsSince: null,
});
assert(!nearEdge.isOutOfBounds, 'Position within 5m drift buffer is not flagged out of bounds');

// Test 3: Clear excursion (700m away)
// 700m ~ 0.0063 deg lat
const breach = evaluateBoundaryState({
  playerPos: { latitude: 37.7749 + 0.0063, longitude: -122.4194, accuracy: 8 },
  areaCenter: center,
  areaRadiusM: radiusM,
  boundaryPenalty: 'reveal_live',
  boundaryGraceS: 30,
  outOfBoundsSince: 1000000,
  now: 1010000, // 10s elapsed
});
assert(breach.isOutOfBounds, 'Position 700m away is out of bounds');
assert(breach.secondsOutside === 10, 'Calculates 10 seconds outside');
assert(breach.graceRemainingS === 20, 'Calculates 20 seconds grace remaining');
assert(breach.penaltyState === 'warning', 'State is warning during grace period');
assert(!breach.shouldEmitLivePing, 'Does not emit live ping during grace period');

// Test 4: reveal_live past grace period (35s elapsed, no prior ping)
const liveReveal = evaluateBoundaryState({
  playerPos: { latitude: 37.7749 + 0.0063, longitude: -122.4194, accuracy: 8 },
  areaCenter: center,
  areaRadiusM: radiusM,
  boundaryPenalty: 'reveal_live',
  boundaryGraceS: 30,
  outOfBoundsSince: 1000000,
  lastLivePingAt: null,
  now: 1035000, // 35s elapsed
});
assert(liveReveal.penaltyState === 'live_reveal_active', 'State transitions to live_reveal_active after grace');
assert(liveReveal.shouldEmitLivePing, 'Emits live ping immediately upon entering penalty');

// Test 5: reveal_live throttling (ping was sent 2s ago)
const liveThrottled = evaluateBoundaryState({
  playerPos: { latitude: 37.7749 + 0.0063, longitude: -122.4194, accuracy: 8 },
  areaCenter: center,
  areaRadiusM: radiusM,
  boundaryPenalty: 'reveal_live',
  boundaryGraceS: 30,
  outOfBoundsSince: 1000000,
  lastLivePingAt: 1033000,
  now: 1035000, // 2s since last ping
});
assert(!liveThrottled.shouldEmitLivePing, 'Throttles live ping if sent under 5000ms ago');

// Test 6: reveal_live fires again after 5s
const liveRepeat = evaluateBoundaryState({
  playerPos: { latitude: 37.7749 + 0.0063, longitude: -122.4194, accuracy: 8 },
  areaCenter: center,
  areaRadiusM: radiusM,
  boundaryPenalty: 'reveal_live',
  boundaryGraceS: 30,
  outOfBoundsSince: 1000000,
  lastLivePingAt: 1030000,
  now: 1036000, // 6s since last ping
});
assert(liveRepeat.shouldEmitLivePing, 'Fires live ping after 5000ms interval');

// Test 7: auto_tag before 120s
const autoTagEarly = evaluateBoundaryState({
  playerPos: { latitude: 37.7749 + 0.0063, longitude: -122.4194, accuracy: 8 },
  areaCenter: center,
  areaRadiusM: radiusM,
  boundaryPenalty: 'auto_tag',
  boundaryGraceS: 30,
  outOfBoundsSince: 1000000,
  now: 1080000, // 80s elapsed
});
assert(!autoTagEarly.shouldAutoTag, 'Does not auto-tag runner at 80s');

// Test 8: auto_tag at 120s
const autoTagDue = evaluateBoundaryState({
  playerPos: { latitude: 37.7749 + 0.0063, longitude: -122.4194, accuracy: 8 },
  areaCenter: center,
  areaRadiusM: radiusM,
  boundaryPenalty: 'auto_tag',
  boundaryGraceS: 30,
  outOfBoundsSince: 1000000,
  now: 1125000, // 125s elapsed
});
assert(autoTagDue.shouldAutoTag, 'Triggers auto-tag elimination at 125s outside');
assert(autoTagDue.penaltyState === 'auto_tagged', 'State updates to auto_tagged');

// Test 9: Accuracy gating suppresses false breach
const badGps = evaluateBoundaryState({
  playerPos: { latitude: 37.7749 + 0.0046, longitude: -122.4194, accuracy: 60 }, // slightly outside but accuracy +-60m
  areaCenter: center,
  areaRadiusM: radiusM,
  boundaryPenalty: 'warn',
  outOfBoundsSince: null,
});
assert(badGps.isAccuracyGated, 'Flags inaccurate GPS fix as gated');
assert(!badGps.isOutOfBounds, 'Suppresses false breach under inaccurate GPS');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

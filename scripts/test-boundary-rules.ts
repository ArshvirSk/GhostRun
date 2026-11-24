import {
  evaluateBoundaryState,
  getBoundaryPenaltySpec,
  calculateExcursionDistanceM,
  isApproachingPerimeter,
  BOUNDARY_PENALTY_SPECS,
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

// Test 1: Boundary penalty specs catalog
assert(BOUNDARY_PENALTY_SPECS.length === 4, 'Defines exactly 4 operational boundary penalties');
assert(BOUNDARY_PENALTY_SPECS.some((s) => s.id === 'warn'), 'Includes warn penalty');
assert(BOUNDARY_PENALTY_SPECS.some((s) => s.id === 'extra_ping'), 'Includes extra_ping penalty');
assert(BOUNDARY_PENALTY_SPECS.some((s) => s.id === 'reveal_live'), 'Includes reveal_live penalty');
assert(BOUNDARY_PENALTY_SPECS.some((s) => s.id === 'auto_tag'), 'Includes auto_tag penalty');

const warnSpec = getBoundaryPenaltySpec('warn');
assert(warnSpec.severity === 'info', 'warn severity is info');
const autoTagSpec = getBoundaryPenaltySpec('auto_tag');
assert(autoTagSpec.severity === 'critical', 'auto_tag severity is critical');

// Test 2: Excursion distance calculation
assert(calculateExcursionDistanceM(480, 500) === 0, 'Distance inside perimeter has 0m excursion');
assert(calculateExcursionDistanceM(503, 500, 5) === 0, 'Distance within 5m buffer has 0m excursion');
assert(calculateExcursionDistanceM(555, 500, 5) === 50, 'Distance 50m past buffer returns 50m excursion');

// Test 3: Approaching perimeter detection
assert(isApproachingPerimeter(490, 500, 15), 'Runner at 490m is within 15m of 500m perimeter');
assert(!isApproachingPerimeter(450, 500, 15), 'Runner at 450m is safely away from perimeter');
assert(isApproachingPerimeter(503, 500, 15), 'Runner in buffer at 503m is still flagged as approaching');
assert(!isApproachingPerimeter(520, 500, 15), 'Runner well outside buffer is past approaching state');

const center = { latitude: 37.7749, longitude: -122.4194 };
const radiusM = 500;

// Test 4: Well inside area (center)
const inside = evaluateBoundaryState({
  playerPos: { latitude: 37.7749, longitude: -122.4194, accuracy: 5 },
  areaCenter: center,
  areaRadiusM: radiusM,
  boundaryPenalty: 'warn',
  outOfBoundsSince: null,
});
assert(!inside.isOutOfBounds, 'Center position is within boundary');
assert(inside.penaltyState === 'none', 'Inside position has penaltyState none');
assert(inside.excursionDistanceM === 0, 'Inside position has 0m excursion');

// Test 5: Drift buffer tolerance (just outside radius by 2m)
// 1 deg lat ~ 111,000m. 500m ~ 0.00450 deg. 502m ~ 0.00452 deg
const nearEdge = evaluateBoundaryState({
  playerPos: { latitude: 37.7749 + 0.00451, longitude: -122.4194, accuracy: 5 },
  areaCenter: center,
  areaRadiusM: radiusM,
  boundaryPenalty: 'warn',
  outOfBoundsSince: null,
});
assert(!nearEdge.isOutOfBounds, 'Position within 5m drift buffer is not flagged out of bounds');

// Test 6: Clear excursion (700m away)
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
assert(breach.excursionDistanceM > 150, 'Records > 150m excursion distance');

// Test 7: reveal_live past grace period (35s elapsed, no prior ping)
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

// Test 8: reveal_live throttling (ping was sent 2s ago)
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

// Test 9: reveal_live fires again after 5s
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

// Test 10: auto_tag before 120s
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

// Test 11: auto_tag at 120s
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

// Test 12: Accuracy gating suppresses false breach
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

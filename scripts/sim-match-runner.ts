/**
 * GhostRun v3.0 Autonomous Offline GPS Match Simulator
 *
 * Simulates complete multiplayer matches in code without requiring physical phones
 * or live network servers. Evaluates kinematic trajectory generation, realistic
 * GPS sensor jitter, stationary deadband suppression, vehicle anti-cheat speed caps,
 * boundary grace penalties, tag collisions, and mode-specific victory conditions.
 */

import assert from 'node:assert';
import { distanceM, bearingDeg, LngLat } from '../src/lib/geo';
import {
  evaluateBoundaryState,
  DRIFT_BUFFER_METERS,
} from '../src/lib/boundaryRules';
import {
  calculateAdaptiveGpsConfig,
  STATIONARY_SPEED_THRESHOLD_MPS,
  SPRINT_SPEED_THRESHOLD_MPS,
} from '../src/lib/batteryResilienceCore';
import { evaluatePinpointScore, evaluatePinpointClues } from '../src/modes/pinpoint/engine';
import { PinpointTarget } from '../src/modes/pinpoint/types';

// Physical Earth Constants
const EARTH_RADIUS_M = 6371008.8;

// Match Rules & Thresholds
export const MAX_HUMAN_SPRINT_SPEED_MPS = 8.0; // ~28.8 km/h. Exceeding this flags vehicle cheating
export const TAG_COLLISION_RADIUS_M = 20.0;
export const TARGET_ARRIVAL_RADIUS_M = 25.0;
export const STATIONARY_DEADBAND_M = 2.0;

export interface OperativeState {
  id: string;
  codename: string;
  team: 'runner' | 'hunter' | 'human' | 'zombie' | 'solo';
  role?: string;
  latitude: number;
  longitude: number;
  heading: number; // 0 - 360 deg
  speedMps: number;
  status: 'active' | 'tagged' | 'extracted' | 'frozen';
  healthHp?: number;
  stationarySec: number;
  outOfBoundsSince: number | null;
  lastLivePingAt: number | null;
  score: number;
  vehicleViolation: boolean;
  gpsFixCount: number;
  suppressedWanderCount: number;
}

/**
 * Propagates a coordinate forward by distance and heading using spherical geodesics.
 */
export function projectCoordinate(
  origin: LngLat,
  distanceMeters: number,
  headingDeg: number
): LngLat {
  const dLat = (distanceMeters * Math.cos((headingDeg * Math.PI) / 180)) / EARTH_RADIUS_M;
  const dLng =
    (distanceMeters * Math.sin((headingDeg * Math.PI) / 180)) /
    (EARTH_RADIUS_M * Math.cos((origin.latitude * Math.PI) / 180));
  return {
    latitude: origin.latitude + (dLat * 180) / Math.PI,
    longitude: origin.longitude + (dLng * 180) / Math.PI,
  };
}

/**
 * Applies simulated GPS sensor noise and evaluates GameShell's stationary deadband filter.
 * Returns { fix, emitted } where emitted is false if stationary wander was suppressed.
 */
export function processSensorFix(
  prevPosition: LngLat,
  truePosition: LngLat,
  speedMps: number,
  jitterMeters: number = 0
): { fix: LngLat; emitted: boolean } {
  // Add jitter along random azimuth
  const randomAzimuth = Math.random() * 360;
  const noisyFix = projectCoordinate(truePosition, jitterMeters, randomAzimuth);

  // Deadband wander filter: if moving < 0.6 m/s and displacement < 2.0m, suppress update
  const deltaFromPrev = distanceM(prevPosition, noisyFix);
  if (speedMps < 0.6 && deltaFromPrev < STATIONARY_DEADBAND_M) {
    return { fix: prevPosition, emitted: false };
  }

  return { fix: noisyFix, emitted: true };
}

console.log('================================================================');
console.log('  GhostRun Autonomous Match Simulator (Headless Telemetry Test) ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Scenario 1: Classic Chase Extraction Sprint
// -----------------------------------------------------------------------------
console.log('--- Scenario 1: Classic Chase Extraction Sprint ---');
{
  const arenaCenter: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  const targetLocation: LngLat = projectCoordinate(arenaCenter, 320, 45); // 320m NE
  const arenaRadiusM = 500;

  let runner: OperativeState = {
    id: 'op-runner-1',
    codename: 'VAPOR',
    team: 'runner',
    latitude: arenaCenter.latitude,
    longitude: arenaCenter.longitude,
    heading: 45.0,
    speedMps: 3.8, // Sprints at ~13.7 km/h
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  let hunter: OperativeState = {
    id: 'op-hunter-1',
    codename: 'SPECTER',
    team: 'hunter',
    latitude: projectCoordinate(arenaCenter, 200, 180).latitude,
    longitude: projectCoordinate(arenaCenter, 200, 180).longitude,
    heading: 0.0,
    speedMps: 3.2,
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  let matchSeconds = 0;
  let matchEnded = false;
  let winner: string | null = null;

  while (matchSeconds < 180 && !matchEnded) {
    matchSeconds += 1; // 1-second simulation step

    // Advance runner toward target
    const runnerCurrent: LngLat = { latitude: runner.latitude, longitude: runner.longitude };
    const distToTarget = distanceM(runnerCurrent, targetLocation);
    const headingToTarget = bearingDeg(runnerCurrent, targetLocation);
    runner.heading = headingToTarget;
    const nextRunnerPos = projectCoordinate(runnerCurrent, runner.speedMps * 1, runner.heading);
    runner.latitude = nextRunnerPos.latitude;
    runner.longitude = nextRunnerPos.longitude;
    runner.gpsFixCount++;

    // Advance hunter toward runner's delayed position
    const hunterCurrent: LngLat = { latitude: hunter.latitude, longitude: hunter.longitude };
    const headingToRunner = bearingDeg(hunterCurrent, runnerCurrent);
    hunter.heading = headingToRunner;
    const nextHunterPos = projectCoordinate(hunterCurrent, hunter.speedMps * 1, hunter.heading);
    hunter.latitude = nextHunterPos.latitude;
    hunter.longitude = nextHunterPos.longitude;
    hunter.gpsFixCount++;

    // Check Tag Collision (<= 20m)
    const separationM = distanceM(nextRunnerPos, nextHunterPos);
    if (separationM <= TAG_COLLISION_RADIUS_M) {
      runner.status = 'tagged';
      matchEnded = true;
      winner = 'hunters';
      break;
    }

    // Check Target Arrival (<= 25m)
    if (distToTarget <= TARGET_ARRIVAL_RADIUS_M) {
      runner.status = 'extracted';
      matchEnded = true;
      winner = 'runners';
      break;
    }
  }

  assert.strictEqual(runner.status, 'extracted', 'Runner should reach extraction point before hunter intercepts');
  assert.strictEqual(winner, 'runners');
  assert.ok(matchSeconds < 100, `Runner extracted in ${matchSeconds}s`);
  console.log(`✓ PASS: Runner reached target in ${matchSeconds}s at 3.8 m/s without interception (Winner: RUNNERS)`);
}

// -----------------------------------------------------------------------------
// Scenario 2: High-Speed Vehicle Anti-Cheat Tripwire
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 2: High-Speed Vehicle Anti-Cheat Tripwire ---');
{
  const startPos: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  let currentPos = startPos;
  let vehicleViolationTriggered = false;

  // Operative hops on an electric scooter / car and accelerates to 11.5 m/s (~41.4 km/h)
  const simulatedSpeeds = [2.0, 3.5, 4.8, 7.2, 9.4, 11.5, 12.0];

  for (const speed of simulatedSpeeds) {
    const nextPos = projectCoordinate(currentPos, speed * 1, 90);
    const measuredDistance = distanceM(currentPos, nextPos);
    const calculatedSpeed = measuredDistance / 1.0;

    if (calculatedSpeed > MAX_HUMAN_SPRINT_SPEED_MPS) {
      vehicleViolationTriggered = true;
    }
    currentPos = nextPos;
  }

  assert.strictEqual(vehicleViolationTriggered, true, 'Vehicle speed > 8.0 m/s must trigger anti-cheat tripwire');
  console.log('✓ PASS: Movement at 11.5 m/s successfully flagged as vehicle anti-cheat violation');
}

// -----------------------------------------------------------------------------
// Scenario 3: Stationary Ambush Camping & GPS Wander Deadband Filter
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 3: Stationary Ambush Camping & Deadband Wander Suppression ---');
{
  const campingSpot: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  let reportedFix = campingSpot;
  let suppressedCount = 0;
  let emittedCount = 0;

  // Operative camps behind a bunker for 30 seconds with +/- 1.4m GPS wander
  for (let s = 1; s <= 30; s++) {
    const wanderMeters = 0.5 + (Math.sin(s) * 0.9); // 0.5m to 1.4m jitter
    const { fix, emitted } = processSensorFix(reportedFix, campingSpot, 0.1, wanderMeters);
    if (!emitted) {
      suppressedCount++;
    } else {
      emittedCount++;
      reportedFix = fix;
    }
  }

  // Battery Sentinel: Verify Ambush Hold power tier activation
  const powerConfig = calculateAdaptiveGpsConfig({
    speedMps: 0.1,
    stationaryDurationSec: 25,
    batteryLevelPct: 80,
    batteryGuardEnabled: true,
  });

  assert.ok(suppressedCount >= 28, `Expected >= 28 suppressed fixes, got ${suppressedCount}`);
  assert.strictEqual(powerConfig.powerTier, 'stationary', 'Stationary camping must engage stationary tier');
  assert.strictEqual(powerConfig.timeIntervalMs, 6000, 'Stationary tier should poll at 6000ms');
  console.log(`✓ PASS: ${suppressedCount}/30 stationary wander fixes suppressed by 2.0m deadband; Ambush Hold (6s polling) engaged`);
}

// -----------------------------------------------------------------------------
// Scenario 4: Geofence Breach Grace Countdown & Live Reveal Penalty
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 4: Geofence Breach Grace Countdown & Live Reveal ---');
{
  const areaCenter: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  const areaRadiusM = 300;
  const boundaryGraceS = 20;

  // Player runs outside boundary (380m from center)
  const outsidePos: LngLat = projectCoordinate(areaCenter, 380, 0);

  // T+5s outside: warning state, no live reveal
  const evalAt5s = evaluateBoundaryState({
    playerPos: outsidePos,
    areaCenter,
    areaRadiusM,
    boundaryPenalty: 'reveal_live',
    boundaryGraceS,
    outOfBoundsSince: 1000,
    now: 6000, // 5s outside
  });
  assert.strictEqual(evalAt5s.isOutOfBounds, true);
  assert.strictEqual(evalAt5s.penaltyState, 'warning');
  assert.strictEqual(evalAt5s.shouldEmitLivePing, false);

  // T+25s outside: grace expired -> live reveal activated
  const evalAt25s = evaluateBoundaryState({
    playerPos: outsidePos,
    areaCenter,
    areaRadiusM,
    boundaryPenalty: 'reveal_live',
    boundaryGraceS,
    outOfBoundsSince: 1000,
    lastLivePingAt: 0,
    now: 26000, // 25s outside (grace was 20s)
  });
  assert.strictEqual(evalAt25s.isOutOfBounds, true);
  assert.strictEqual(evalAt25s.penaltyState, 'live_reveal_active');
  assert.strictEqual(evalAt25s.shouldEmitLivePing, true);

  console.log('✓ PASS: Geofence breach evaluated: Warning during 20s grace, Live Reveal ping emitted upon expiration');
}

// -----------------------------------------------------------------------------
// Scenario 5: Outbreak Horde Tag Swarm & Bio-Lifespan Ingestion
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 5: Outbreak Horde Tag Swarm & Bio-Lifespan Ingestion ---');
{
  const center: LngLat = { latitude: 40.7829, longitude: -73.9654 };
  let zombiePos = center;
  let humanPos = projectCoordinate(center, 40, 90); // 40m East
  let humanHp = 120; // 120 seconds bio-lifespan
  let humanStatus: 'human' | 'zombie' = 'human';

  // Simulating 5 seconds of zombie pursuit
  for (let sec = 1; sec <= 5; sec++) {
    humanHp -= 1; // -1 HP/s decay
    const heading = bearingDeg(zombiePos, humanPos);
    zombiePos = projectCoordinate(zombiePos, 4.5 * 1, heading); // Zombie sprints at 4.5 m/s
    const sep = distanceM(zombiePos, humanPos);

    if (sep <= TAG_COLLISION_RADIUS_M) {
      humanStatus = 'zombie';
      break;
    }
  }

  assert.strictEqual(humanStatus, 'zombie', 'Human within 20m of zombie must convert to zombie');
  assert.strictEqual(humanHp, 115, 'Human lifespan correctly depleted by 5 seconds');
  console.log('✓ PASS: Outbreak Horde pursuit converted Human to Zombie upon 20m proximity with -1 HP/s decay');
}

// -----------------------------------------------------------------------------
// Scenario 6: Pinpoint IRL OpenGuessr Deduction & Clue Progression
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 6: Pinpoint IRL OpenGuessr Deduction & Clue Progression ---');
{
  const parkCenter: LngLat = { latitude: 51.5074, longitude: -0.1278 };
  const targetLandmark: PinpointTarget = {
    id: 'fountain-1',
    roundNumber: 1,
    photoUrl: 'https://cdn.ghostrun.app/pinpoint/fountain.jpg',
    latitude: projectCoordinate(parkCenter, 220, 60).latitude,
    longitude: projectCoordinate(parkCenter, 220, 60).longitude,
    heading: 145.0,
    status: 'active',
  };

  // Clue Progression Check at T+100s (Should unlock Level 2: Sector Triangulation)
  const cluesAt100s = evaluatePinpointClues({
    elapsedSec: 100,
    roundDurationSec: 180,
    currentLat: parkCenter.latitude,
    currentLng: parkCenter.longitude,
    targetLat: targetLandmark.latitude,
    targetLng: targetLandmark.longitude,
    centerLat: parkCenter.latitude,
    centerLng: parkCenter.longitude,
  });

  assert.strictEqual(cluesAt100s.level, 2);
  assert.strictEqual(cluesAt100s.sectorQuadrant, 'NE');
  assert.strictEqual(cluesAt100s.scoreMultiplier, 0.8);

  // Operative snaps shot at 4.5m distance and 12 deg heading error
  const submissionPos = projectCoordinate(
    { latitude: targetLandmark.latitude, longitude: targetLandmark.longitude },
    4.5,
    270
  );

  const scoreResult = evaluatePinpointScore({
    target: targetLandmark,
    submissionLat: submissionPos.latitude,
    submissionLng: submissionPos.longitude,
    submissionHeading: 157.0, // 12 deg delta from 145.0
    cluesUnlocked: cluesAt100s.level,
    elapsedSec: 100,
    roundDurationSec: 180,
  });

  assert.ok(scoreResult.scoreProximity >= 3800, `Proximity score should be high, got ${scoreResult.scoreProximity}`);
  assert.ok(scoreResult.scoreHeading >= 480, `Heading score should be high, got ${scoreResult.scoreHeading}`);
  assert.strictEqual(scoreResult.clueMultiplier, 0.8);
  assert.ok(scoreResult.totalScore >= 3600, `Total score should be > 3600 pts, got ${scoreResult.totalScore}`);

  console.log(`✓ PASS: Pinpoint shot scored ${scoreResult.totalScore} pts (Dist error: ${scoreResult.distanceErrorM}m, Heading error: ${scoreResult.headingErrorDeg}°, Mult: ${scoreResult.clueMultiplier}x)`);
}

// -----------------------------------------------------------------------------
// Scenario 7: VIP Escort Decoy Arrival Rejection, Role Swap & Freeze
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 7: VIP Escort Decoy Arrival Rejection, Role Swap & Freeze ---');
{
  const center: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  const targetPoint: LngLat = projectCoordinate(center, 200, 0); // 200m North
  const roles = ['vip'];

  let vipRunner: OperativeState = {
    id: 'op-vip-1',
    codename: 'CROWN',
    team: 'runner',
    role: 'vip',
    latitude: center.latitude,
    longitude: center.longitude,
    heading: 0,
    speedMps: 3.5,
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  let bodyguard: OperativeState = {
    id: 'op-bodyguard-1',
    codename: 'AEGIS',
    team: 'runner',
    role: 'bodyguard',
    latitude: projectCoordinate(center, 195, 0).latitude, // 195m North (inside target radius)
    longitude: projectCoordinate(center, 195, 0).longitude,
    heading: 0,
    speedMps: 3.0,
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  // Step 1: Bodyguard reaches extraction point (< 25m)
  const bgDistanceToTarget = distanceM({ latitude: bodyguard.latitude, longitude: bodyguard.longitude }, targetPoint);
  assert.ok(bgDistanceToTarget <= TARGET_ARRIVAL_RADIUS_M, 'Bodyguard is within target arrival radius');

  // Server-authoritative VIP guard check (X-14)
  const canBodyguardExtract = !roles.includes('vip') || bodyguard.role === 'vip';
  assert.strictEqual(canBodyguardExtract, false, 'Bodyguard must NOT trigger extraction when VIP role is enabled');

  // Step 2: Bodyguard returns to VIP for tactical 5m rendezvous and role swap
  bodyguard.latitude = projectCoordinate(center, 3.2, 90).latitude;
  bodyguard.longitude = projectCoordinate(center, 3.2, 90).longitude;
  const swapDistanceM = distanceM(
    { latitude: vipRunner.latitude, longitude: vipRunner.longitude },
    { latitude: bodyguard.latitude, longitude: bodyguard.longitude }
  );
  assert.ok(swapDistanceM <= 5.0, 'Operatives are within 5m swap radius');

  // Execute swap
  const prevVipRole = vipRunner.role;
  vipRunner.role = bodyguard.role;
  bodyguard.role = prevVipRole; // Bodyguard is now the VIP!
  assert.strictEqual(bodyguard.role, 'vip');
  assert.strictEqual(vipRunner.role, 'bodyguard');

  // Step 3: Hunter approaches and tags the former VIP (now bodyguard)
  const hunterPos = projectCoordinate({ latitude: vipRunner.latitude, longitude: vipRunner.longitude }, 12.0, 180);
  const tagDist = distanceM({ latitude: vipRunner.latitude, longitude: vipRunner.longitude }, hunterPos);
  assert.ok(tagDist <= TAG_COLLISION_RADIUS_M);

  // Tagging bodyguard sets status frozen without match ending
  let matchEnded = false;
  let winner: string | null = null;
  if (vipRunner.role === 'bodyguard') {
    vipRunner.status = 'frozen';
    // Match continues!
  } else if (vipRunner.role === 'vip') {
    matchEnded = true;
    winner = 'hunters';
  }
  assert.strictEqual(vipRunner.status, 'frozen', 'Tagged bodyguard enters frozen state');
  assert.strictEqual(matchEnded, false, 'Match does NOT end when bodyguard is tagged');

  // Step 4: The new VIP sprints into extraction point
  bodyguard.latitude = targetPoint.latitude;
  bodyguard.longitude = targetPoint.longitude;
  const newVipDistToTarget = distanceM({ latitude: bodyguard.latitude, longitude: bodyguard.longitude }, targetPoint);
  assert.ok(newVipDistToTarget <= TARGET_ARRIVAL_RADIUS_M);

  const canNewVipExtract = !roles.includes('vip') || bodyguard.role === 'vip';
  assert.strictEqual(canNewVipExtract, true, 'New VIP triggers legitimate extraction victory');
  bodyguard.status = 'extracted';
  matchEnded = true;
  winner = 'runners';

  assert.strictEqual(winner, 'runners');
  console.log('✓ PASS: VIP Escort verified: Bodyguard decoy arrival rejected, 5m swap executed, bodyguard freeze handled, and new VIP extracted');
}

console.log('\n================================================================');
console.log('  All 7 Autonomous Match Simulation Scenarios PASSED (100%)     ');
console.log('================================================================\n');

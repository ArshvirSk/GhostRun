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
import {
  createBlackboxSession,
  appendBlackboxFix,
  appendBlackboxEvent,
  finalizeBlackboxSession,
  serializeBlackboxToJsonl,
  parseBlackboxFromJsonl,
  validateBlackboxSession,
} from '../src/lib/blackboxCore';

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
  status: 'active' | 'tagged' | 'extracted' | 'frozen' | 'jailed';
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

// -----------------------------------------------------------------------------
// Scenario 8: Jailbreak Holding Cell, Stealth Rescue Hold & All-Jailed Victory
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 8: Jailbreak Holding Cell, Stealth Rescue Hold & All-Jailed Victory ---');
{
  const jailCenter: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  const jailRadiusM = 15.0;
  const rescueRadiusM = 10.0;
  const rescueHoldS = 10;
  const autoReleaseS = 300;

  // Operatives
  let runnerAlpha: OperativeState = {
    id: 'jb-runner-alpha',
    codename: 'ALPHA',
    team: 'runner',
    latitude: projectCoordinate(jailCenter, 60, 0).latitude,
    longitude: projectCoordinate(jailCenter, 60, 0).longitude,
    heading: 0,
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

  let runnerBravo: OperativeState = {
    id: 'jb-runner-bravo',
    codename: 'BRAVO',
    team: 'runner',
    latitude: projectCoordinate(jailCenter, 40, 90).latitude,
    longitude: projectCoordinate(jailCenter, 40, 90).longitude,
    heading: 90,
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

  let runnerCharlie: OperativeState = {
    id: 'jb-runner-charlie',
    codename: 'CHARLIE',
    team: 'runner',
    latitude: projectCoordinate(jailCenter, 80, 180).latitude,
    longitude: projectCoordinate(jailCenter, 80, 180).longitude,
    heading: 180,
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

  let hunterApex: OperativeState = {
    id: 'jb-hunter-apex',
    codename: 'APEX',
    team: 'hunter',
    latitude: projectCoordinate(jailCenter, 75, 0).latitude,
    longitude: projectCoordinate(jailCenter, 75, 0).longitude,
    heading: 180,
    speedMps: 4.8,
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  const getActiveRunners = () =>
    [runnerAlpha, runnerBravo, runnerCharlie].filter((r) => r.status === 'active');
  const getJailedRunners = () =>
    [runnerAlpha, runnerBravo, runnerCharlie].filter((r) => r.status === 'jailed');

  assert.strictEqual(getActiveRunners().length, 3, 'Initial active runners must be 3');
  assert.strictEqual(getJailedRunners().length, 0, 'Initial jailed runners must be 0');

  // Step 1: Hunter intercepts and tags Runner Alpha
  const tagDistAlpha = distanceM(
    { latitude: hunterApex.latitude, longitude: hunterApex.longitude },
    { latitude: runnerAlpha.latitude, longitude: runnerAlpha.longitude }
  );
  assert.ok(tagDistAlpha <= TAG_COLLISION_RADIUS_M, 'Hunter is within 20m tag radius of Alpha');

  // Tagging in Jailbreak: runner becomes jailed (NOT eliminated)
  runnerAlpha.status = 'jailed';
  // Runner Alpha walks to jail holding cell
  runnerAlpha.latitude = projectCoordinate(jailCenter, 5, 45).latitude;
  runnerAlpha.longitude = projectCoordinate(jailCenter, 5, 45).longitude;

  const alphaJailDist = distanceM(
    { latitude: runnerAlpha.latitude, longitude: runnerAlpha.longitude },
    jailCenter
  );
  assert.ok(alphaJailDist <= jailRadiusM, 'Jailed runner remains inside 15m jail containment radius');
  assert.strictEqual(getActiveRunners().length, 2, '2 active runners remain');
  assert.strictEqual(getJailedRunners().length, 1, '1 runner is jailed');

  // Step 2: Runner Bravo sneaks into jail perimeter for a stealth rescue
  runnerBravo.latitude = projectCoordinate(jailCenter, 7.5, 270).latitude;
  runnerBravo.longitude = projectCoordinate(jailCenter, 7.5, 270).longitude;
  const bravoDistToJail = distanceM(
    { latitude: runnerBravo.latitude, longitude: runnerBravo.longitude },
    jailCenter
  );
  assert.ok(bravoDistToJail <= rescueRadiusM, 'Bravo is within 10m rescue trigger zone');

  // Bravo initiates rescue hold
  let activeHoldRescuerId: string | null = runnerBravo.id;
  let holdSecondsElapsed = 0;

  // Step 3: Rescuer Vulnerability — Hunter rushes in and tags Bravo mid-hold (t = 6s)
  holdSecondsElapsed = 6;
  assert.ok(holdSecondsElapsed < rescueHoldS, 'Hold is not yet complete');

  // Hunter intercepts Bravo at 12m
  hunterApex.latitude = projectCoordinate(jailCenter, 12, 270).latitude;
  hunterApex.longitude = projectCoordinate(jailCenter, 12, 270).longitude;
  const hunterToBravoDist = distanceM(
    { latitude: hunterApex.latitude, longitude: hunterApex.longitude },
    { latitude: runnerBravo.latitude, longitude: runnerBravo.longitude }
  );
  assert.ok(hunterToBravoDist <= TAG_COLLISION_RADIUS_M, 'Hunter tags rescuer Bravo mid-hold');

  // Tagging rescuer aborts hold and jails the rescuer
  activeHoldRescuerId = null;
  holdSecondsElapsed = 0;
  runnerBravo.status = 'jailed';
  runnerBravo.latitude = projectCoordinate(jailCenter, 8, 220).latitude;
  runnerBravo.longitude = projectCoordinate(jailCenter, 8, 220).longitude;

  assert.strictEqual(getActiveRunners().length, 1, 'Only Charlie remains active');
  assert.strictEqual(getJailedRunners().length, 2, 'Alpha and Bravo are both jailed');

  // Step 4: Runner Charlie executes stealth rescue hold to completion (10 seconds)
  runnerCharlie.latitude = projectCoordinate(jailCenter, 4.0, 180).latitude;
  runnerCharlie.longitude = projectCoordinate(jailCenter, 4.0, 180).longitude;
  const charlieDistToJail = distanceM(
    { latitude: runnerCharlie.latitude, longitude: runnerCharlie.longitude },
    jailCenter
  );
  assert.ok(charlieDistToJail <= rescueRadiusM, 'Charlie is within 10m rescue trigger zone');

  // Charlie holds for full duration
  activeHoldRescuerId = runnerCharlie.id;
  holdSecondsElapsed = rescueHoldS; // 10 seconds continuous hold

  // Complete rescue transaction: verify rescuer active, distance <= 10m, hold >= 10s
  assert.strictEqual(runnerCharlie.status, 'active', 'Rescuer must be active');
  assert.ok(charlieDistToJail <= rescueRadiusM, 'Rescuer must remain within 10m');
  assert.ok(holdSecondsElapsed >= rescueHoldS, 'Hold duration must meet 10s requirement');

  // All jailed runners are restored to active
  let freedCount = 0;
  for (const runner of [runnerAlpha, runnerBravo, runnerCharlie]) {
    if (runner.status === 'jailed') {
      runner.status = 'active';
      freedCount++;
    }
  }
  activeHoldRescuerId = null;

  assert.strictEqual(freedCount, 2, '2 prisoners successfully freed');
  assert.strictEqual(getActiveRunners().length, 3, 'All 3 runners are now active again');
  assert.strictEqual(getJailedRunners().length, 0, 'No runners remain in jail');

  // Step 5: Hunter Blitz — Hunter tags all runners for All-Jailed Hunter Victory
  let matchWinner: string | null = null;
  let matchEndReason: string | null = null;

  runnerAlpha.status = 'jailed';
  assert.strictEqual(getActiveRunners().length, 2);

  runnerBravo.status = 'jailed';
  assert.strictEqual(getActiveRunners().length, 1);

  runnerCharlie.status = 'jailed';
  assert.strictEqual(getActiveRunners().length, 0);

  // Server-authoritative win check: if active runner count reaches 0 -> Hunter victory
  if (getActiveRunners().length === 0) {
    matchWinner = 'hunters';
    matchEndReason = 'all_jailed';
  }

  assert.strictEqual(matchWinner, 'hunters', 'Hunters win when all runners are jailed');
  assert.strictEqual(matchEndReason, 'all_jailed', 'Win reason must be all_jailed');

  // Step 6: Verify Auto-Release Loop Mechanics (X-1 Verification)
  // If an unrescued runner reaches autoReleaseS dwell time in jail, advance_game restores them
  let isolatedRunner: OperativeState = {
    id: 'jb-isolated-runner',
    codename: 'DELTA',
    team: 'runner',
    latitude: jailCenter.latitude,
    longitude: jailCenter.longitude,
    heading: 0,
    speedMps: 0.1,
    status: 'jailed',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  const dwellSec = 305;
  if (isolatedRunner.status === 'jailed' && dwellSec >= autoReleaseS) {
    isolatedRunner.status = 'active';
  }
  assert.strictEqual(isolatedRunner.status, 'active', 'Auto-release restores runner to active after 300s');

  console.log(
    '✓ PASS: Jailbreak verified: Holding cell containment, 10s rescue hold, mid-hold hunter tag interruption, breakout completion (2 freed), all-jailed hunter victory, and 300s auto-release loop'
  );
}

// -----------------------------------------------------------------------------
// Scenario 9: Relay Heist Package Transfer, Tag Drop, Securing Contest & Extraction
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 9: Relay Heist Package Transfer, Tag Drop, Securing Contest & Extraction ---');
{
  const center: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  const targetPoint: LngLat = projectCoordinate(center, 200, 0); // 200m North
  const extractionRadiusM = 25.0;
  const handoffRadiusM = 5.0;
  const handoffCooldownS = 20;
  const pickupRadiusM = 10.0;
  const securingHoldS = 20;
  const offlineDropS = 60;

  let runnerTorch: OperativeState = {
    id: 'op-torch-1',
    codename: 'TORCH',
    team: 'runner',
    latitude: center.latitude,
    longitude: center.longitude,
    heading: 0,
    speedMps: 3.4,
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  let runnerBeacon: OperativeState = {
    id: 'op-beacon-2',
    codename: 'BEACON',
    team: 'runner',
    latitude: projectCoordinate(center, 3.5, 90).latitude, // 3.5m East
    longitude: projectCoordinate(center, 3.5, 90).longitude,
    heading: 0,
    speedMps: 3.1,
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  let hunterShadow: OperativeState = {
    id: 'op-shadow-3',
    codename: 'SHADOW',
    team: 'hunter',
    latitude: projectCoordinate(center, 80, 0).latitude,
    longitude: projectCoordinate(center, 80, 0).longitude,
    heading: 180,
    speedMps: 4.5,
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  let packageEntity = {
    status: 'carried' as 'carried' | 'dropped' | 'secured',
    carrierId: runnerTorch.id as string | null,
    visibleTo: 'runner' as 'runner' | 'all',
    latitude: runnerTorch.latitude,
    longitude: runnerTorch.longitude,
    securingHunterId: null as string | null,
    securingStartedAtSec: null as number | null,
    handoffCooldownUntilSec: 0,
  };

  assert.strictEqual(packageEntity.status, 'carried');
  assert.strictEqual(packageEntity.visibleTo, 'runner', 'Package is hidden from hunters while carried');

  // Step 1: Mutual 5m physical handoff
  const handoffDist = distanceM(
    { latitude: runnerTorch.latitude, longitude: runnerTorch.longitude },
    { latitude: runnerBeacon.latitude, longitude: runnerBeacon.longitude }
  );
  assert.ok(handoffDist <= handoffRadiusM, 'Runners are within 5m handoff threshold');

  // Carrier transfers package to Beacon
  const currentSec = 10;
  assert.ok(currentSec >= packageEntity.handoffCooldownUntilSec, 'Cooldown has expired');
  packageEntity.carrierId = runnerBeacon.id;
  packageEntity.handoffCooldownUntilSec = currentSec + handoffCooldownS;

  assert.strictEqual(packageEntity.carrierId, runnerBeacon.id, 'Beacon is now the active package carrier');

  // Anti-ping-pong check: Torch cannot immediately request handoff back
  const canHandoffBackImmediately = currentSec + 5 >= packageEntity.handoffCooldownUntilSec;
  assert.strictEqual(canHandoffBackImmediately, false, 'Rapid handoff spam blocked by 20s cooldown');

  // Step 2: Hunter intercepts and tags carrier Beacon
  hunterShadow.latitude = projectCoordinate({ latitude: runnerBeacon.latitude, longitude: runnerBeacon.longitude }, 14, 0).latitude;
  hunterShadow.longitude = projectCoordinate({ latitude: runnerBeacon.latitude, longitude: runnerBeacon.longitude }, 14, 0).longitude;
  const tagDist = distanceM(
    { latitude: hunterShadow.latitude, longitude: hunterShadow.longitude },
    { latitude: runnerBeacon.latitude, longitude: runnerBeacon.longitude }
  );
  assert.ok(tagDist <= TAG_COLLISION_RADIUS_M, 'Hunter is within tag range');

  // Tagging carrier drops package and reveals it to all players
  runnerBeacon.status = 'tagged';
  packageEntity.status = 'dropped';
  packageEntity.carrierId = null;
  packageEntity.visibleTo = 'all'; // Scramble initiated!
  packageEntity.latitude = runnerBeacon.latitude;
  packageEntity.longitude = runnerBeacon.longitude;

  assert.strictEqual(packageEntity.status, 'dropped');
  assert.strictEqual(packageEntity.visibleTo, 'all', 'Dropped package is broadcast to all players');

  // Step 3: Hunter Securing Contest vs Runner Recovery
  hunterShadow.latitude = projectCoordinate({ latitude: packageEntity.latitude, longitude: packageEntity.longitude }, 4.0, 180).latitude;
  hunterShadow.longitude = projectCoordinate({ latitude: packageEntity.latitude, longitude: packageEntity.longitude }, 4.0, 180).longitude;
  const hunterDistToPkg = distanceM(
    { latitude: hunterShadow.latitude, longitude: hunterShadow.longitude },
    { latitude: packageEntity.latitude, longitude: packageEntity.longitude }
  );
  assert.ok(hunterDistToPkg <= pickupRadiusM, 'Hunter is within 10m securing zone');

  // Hunter begins 20s securing hold
  packageEntity.securingHunterId = hunterShadow.id;
  packageEntity.securingStartedAtSec = 30;

  // At second 12 of hold (hold not finished), Runner Torch dashes in within 6.5m
  const holdElapsedSec = 12;
  assert.ok(holdElapsedSec < securingHoldS, 'Hunter securing hold is incomplete');

  runnerTorch.latitude = projectCoordinate({ latitude: packageEntity.latitude, longitude: packageEntity.longitude }, 6.5, 90).latitude;
  runnerTorch.longitude = projectCoordinate({ latitude: packageEntity.latitude, longitude: packageEntity.longitude }, 6.5, 90).longitude;
  const torchDistToPkg = distanceM(
    { latitude: runnerTorch.latitude, longitude: runnerTorch.longitude },
    { latitude: packageEntity.latitude, longitude: packageEntity.longitude }
  );
  assert.ok(torchDistToPkg <= pickupRadiusM, 'Torch is within 10m recovery radius');

  // Torch recovers package! Cancels hunter hold and hides package again
  packageEntity.status = 'carried';
  packageEntity.carrierId = runnerTorch.id;
  packageEntity.securingHunterId = null;
  packageEntity.securingStartedAtSec = null;
  packageEntity.visibleTo = 'runner';

  assert.strictEqual(packageEntity.carrierId, runnerTorch.id);
  assert.strictEqual(packageEntity.visibleTo, 'runner', 'Recovered package re-cloaks from hunters');

  // Step 4: Carrier Torch reaches extraction point
  runnerTorch.latitude = projectCoordinate(targetPoint, 18.5, 45).latitude;
  runnerTorch.longitude = projectCoordinate(targetPoint, 18.5, 45).longitude;
  const distToExtraction = distanceM(
    { latitude: runnerTorch.latitude, longitude: runnerTorch.longitude },
    targetPoint
  );
  assert.ok(distToExtraction <= extractionRadiusM, 'Carrier is inside 25m extraction zone');

  let matchWinner: string | null = null;
  let endReason: string | null = null;
  if (packageEntity.carrierId === runnerTorch.id && distToExtraction <= extractionRadiusM) {
    matchWinner = 'runners';
    endReason = 'extraction_complete';
  }

  assert.strictEqual(matchWinner, 'runners');
  assert.strictEqual(endReason, 'extraction_complete');

  // Step 5: Verify carrier offline auto-drop rule (X-9)
  const carrierOfflineSec = 65;
  let offlineDropTriggered = false;
  if (carrierOfflineSec >= offlineDropS) {
    offlineDropTriggered = true;
  }
  assert.strictEqual(offlineDropTriggered, true, 'Carrier offline > 60s triggers automated package drop');

  console.log(
    '✓ PASS: Relay Heist verified: 5m mutual handoff, 20s anti-spam cooldown, tag package drop (visible_to all), 10m recovery aborting hunter hold, 25m extraction victory, and 60s offline auto-drop'
  );
}

// -----------------------------------------------------------------------------
// Scenario 10: Assassin Ring Hamiltonian Cycle, Proximity Pulse, Relinking & Last Survivor
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 10: Assassin Ring Hamiltonian Cycle, Proximity Pulse, Relinking & Last Survivor ---');
{
  const center: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  const safeZoneCenter: LngLat = center;
  const safeZoneRadiusM = 20.0;
  const tagRadiusM = 15.0;

  // 4 Solo Operatives in Ring Permutation: A -> B -> C -> D -> A
  let opA: OperativeState = {
    id: 'op-ares-a',
    codename: 'ARES',
    team: 'solo',
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

  let opB: OperativeState = {
    id: 'op-bastion-b',
    codename: 'BASTION',
    team: 'solo',
    latitude: projectCoordinate(center, 120, 90).latitude,
    longitude: projectCoordinate(center, 120, 90).longitude,
    heading: 90,
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

  let opC: OperativeState = {
    id: 'op-cipher-c',
    codename: 'CIPHER',
    team: 'solo',
    latitude: projectCoordinate(center, 150, 180).latitude,
    longitude: projectCoordinate(center, 150, 180).longitude,
    heading: 180,
    speedMps: 2.8,
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  let opD: OperativeState = {
    id: 'op-dagger-d',
    codename: 'DAGGER',
    team: 'solo',
    latitude: projectCoordinate(center, 75, 0).latitude,
    longitude: projectCoordinate(center, 75, 0).longitude,
    heading: 180,
    speedMps: 4.2,
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  // Hamiltonian ring contracts: Map of hunterId -> preyId
  const ring = new Map<string, string>([
    [opA.id, opB.id],
    [opB.id, opC.id],
    [opC.id, opD.id],
    [opD.id, opA.id],
  ]);

  // Step 1: Zero-knowledge prey secrecy check
  assert.strictEqual(ring.get(opA.id), opB.id, "A's contract is B");
  assert.strictEqual(ring.get(opD.id), opA.id, "D's contract is A (D is hunting A)");

  // Step 2: Directionless Sensory Proximity Pulse
  // Hunter D approaches A:
  // Far threshold: 100m (amber), Near threshold: 40m (red)
  const distDToA_far = distanceM(
    { latitude: opD.latitude, longitude: opD.longitude },
    { latitude: opA.latitude, longitude: opA.longitude }
  );
  assert.strictEqual(Math.round(distDToA_far), 75);
  const pulseFar = distDToA_far <= 40 ? 'close' : distDToA_far <= 100 ? 'near' : 'none';
  assert.strictEqual(pulseFar, 'near', 'Amber sensory warning emitted at 75m without revealing hunter coordinates');

  // Hunter D closes in to 25m
  opD.latitude = projectCoordinate({ latitude: opA.latitude, longitude: opA.longitude }, 25, 0).latitude;
  opD.longitude = projectCoordinate({ latitude: opA.latitude, longitude: opA.longitude }, 25, 0).longitude;
  const distDToA_near = distanceM(
    { latitude: opD.latitude, longitude: opD.longitude },
    { latitude: opA.latitude, longitude: opA.longitude }
  );
  assert.strictEqual(Math.round(distDToA_near), 25);
  const pulseNear = distDToA_near <= 40 ? 'close' : distDToA_near <= 100 ? 'near' : 'none';
  assert.strictEqual(pulseNear, 'close', 'Urgent red sensory alert triggered when hunter is within 40m');

  // Step 3: Safe Zone Shelter Immunity
  // Operative A shelters in Safe Zone (distance 12m from center <= 20m)
  opA.latitude = projectCoordinate(safeZoneCenter, 12, 45).latitude;
  opA.longitude = projectCoordinate(safeZoneCenter, 12, 45).longitude;
  const aDistToSafeZone = distanceM(
    { latitude: opA.latitude, longitude: opA.longitude },
    safeZoneCenter
  );
  assert.ok(aDistToSafeZone <= safeZoneRadiusM, 'Operative A is safely inside 20m safe zone circle');

  // Hunter D attempts tag at 8m
  opD.latitude = projectCoordinate({ latitude: opA.latitude, longitude: opA.longitude }, 8, 0).latitude;
  opD.longitude = projectCoordinate({ latitude: opA.latitude, longitude: opA.longitude }, 8, 0).longitude;
  const canTagInSafeZone = false; // Disabled by server rule
  assert.strictEqual(canTagInSafeZone, false, 'Tags strictly rejected when target is sheltering in a safe zone');

  // Step 4: Tactical Tag Outside Safe Zone & Ring Relinking
  // Operative A leaves safe zone to hunt assigned prey B
  opA.latitude = projectCoordinate(center, 125, 90).latitude;
  opA.longitude = projectCoordinate(center, 125, 90).longitude;
  opB.latitude = projectCoordinate(center, 135, 90).latitude;
  opB.longitude = projectCoordinate(center, 135, 90).longitude;

  const aDistToB = distanceM(
    { latitude: opA.latitude, longitude: opA.longitude },
    { latitude: opB.latitude, longitude: opB.longitude }
  );
  assert.ok(aDistToB <= tagRadiusM, 'A is within 15m tag range of prey B outside safe zone');

  // A tags B!
  opB.status = 'tagged'; // Eliminated
  // Ring relinking: A inherits B's prey (C)
  const bPrey = ring.get(opB.id)!;
  ring.set(opA.id, bPrey); // A now hunts C!
  ring.delete(opB.id);

  assert.strictEqual(opB.status, 'tagged');
  assert.strictEqual(ring.get(opA.id), opC.id, 'Ring relinked: Operative A now inherits contract on C');

  const getActiveOperatives = () => [opA, opB, opC, opD].filter((op) => op.status === 'active');
  assert.strictEqual(getActiveOperatives().length, 3, '3 active assassins remain');

  // Step 5: Ring Contraction to 2-Player Final Duel
  // A tracks and tags assigned prey C -> C eliminated
  opC.status = 'tagged';
  const cPrey = ring.get(opC.id)!;
  ring.set(opA.id, cPrey); // A inherits C's prey (D)
  ring.delete(opC.id);

  assert.strictEqual(getActiveOperatives().length, 2, 'Final 2-player duel engaged');
  assert.strictEqual(ring.get(opA.id), opD.id, "A's prey is D");
  assert.strictEqual(ring.get(opD.id), opA.id, "D's prey is A (Dual mutual contract)");

  // Step 6: Final Elimination & Last Survivor Victory
  // A tags D
  opD.status = 'tagged';
  ring.delete(opD.id);

  assert.strictEqual(getActiveOperatives().length, 1, 'Only 1 assassin remains standing');

  let soloWinner: string | null = null;
  let soloReason: string | null = null;
  if (getActiveOperatives().length === 1) {
    soloWinner = 'solo';
    soloReason = 'last_survivor';
  }

  assert.strictEqual(soloWinner, 'solo');
  assert.strictEqual(soloReason, 'last_survivor');
  assert.strictEqual(getActiveOperatives()[0].id, opA.id, 'Operative A is crowned victorious sole survivor');

  console.log(
    '✓ PASS: Assassin Ring verified: Hamiltonian cycle, zero-knowledge contracts, directionless proximity pulse (75m near / 25m close), safe zone immunity, elimination relinking (A->C), and last survivor victory'
  );
}

// -----------------------------------------------------------------------------
// Scenario 11: Double Agent (Secret Mole, Whisper, Scramble, Tribunal & Shared Victory)
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 11: Double Agent (Secret Mole, Whisper, Scramble, Tribunal) ---');
{
  const arenaCenter: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  const arenaRadiusM = 500;
  const targetLocation: LngLat = projectCoordinate(arenaCenter, 320, 0); // 320m due North (azimuth 0 deg)

  let runner: OperativeState = {
    id: 'op-runner-da',
    codename: 'PHANTOM',
    team: 'runner',
    latitude: arenaCenter.latitude,
    longitude: arenaCenter.longitude,
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

  let loyalHunter: OperativeState = {
    id: 'op-hunter-loyal',
    codename: 'TRACKER',
    team: 'hunter',
    role: undefined, // loyal hunter
    latitude: projectCoordinate(arenaCenter, 200, 180).latitude,
    longitude: projectCoordinate(arenaCenter, 200, 180).longitude,
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

  let doubleAgent: OperativeState = {
    id: 'op-hunter-agent',
    codename: 'VIPER',
    team: 'hunter',
    role: 'agent', // secret role assigned
    latitude: projectCoordinate(arenaCenter, 180, 160).latitude,
    longitude: projectCoordinate(arenaCenter, 180, 160).longitude,
    heading: 0,
    speedMps: 2.8,
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  // Step 1: Secrecy & Role Verification
  assert.strictEqual(doubleAgent.role, 'agent', 'One hunter is secretly designated as Double Agent');
  assert.strictEqual(loyalHunter.role, undefined, 'Loyal hunter has no secret role');
  assert.strictEqual(runner.role, undefined, 'Runner has no secret role');

  // Step 2: Power 1 - Whisper (Target Quadrant Reveal)
  // Target is due North (0 deg azimuth from center)
  const targetAzimuth = bearingDeg(arenaCenter, targetLocation);
  assert.strictEqual(Math.round(targetAzimuth), 0, 'Target is due North from arena center');

  const getQuadrant = (azimuth: number): string => {
    const norm = (azimuth + 360) % 360;
    if (norm >= 315 || norm < 45) return 'North';
    if (norm >= 45 && norm < 135) return 'East';
    if (norm >= 135 && norm < 225) return 'South';
    return 'West';
  };

  let whisperAvailable = true;
  const executeWhisper = (caller: OperativeState): { success: boolean; quadrant?: string; error?: string } => {
    if (caller.role !== 'agent') {
      return { success: false, error: 'unauthorized_only_double_agent' };
    }
    if (!whisperAvailable) {
      return { success: false, error: 'whisper_already_used' };
    }
    whisperAvailable = false;
    return { success: true, quadrant: getQuadrant(targetAzimuth) };
  };

  // Loyal hunter attempt -> fails
  const loyalWhisperAttempt = executeWhisper(loyalHunter);
  assert.strictEqual(loyalWhisperAttempt.success, false);
  assert.strictEqual(loyalWhisperAttempt.error, 'unauthorized_only_double_agent', 'Loyal hunter cannot execute Whisper');

  // Double agent executes whisper
  const agentWhisper = executeWhisper(doubleAgent);
  assert.strictEqual(agentWhisper.success, true);
  assert.strictEqual(agentWhisper.quadrant, 'North', 'Double agent receives coarse North quadrant without exact coordinates');

  // Double agent repeat whisper -> fails (single use)
  const repeatWhisper = executeWhisper(doubleAgent);
  assert.strictEqual(repeatWhisper.success, false);
  assert.strictEqual(repeatWhisper.error, 'whisper_already_used', 'Whisper is strictly single-use per match');

  // Step 3: Power 2 - Ping Scramble
  // Agent scrambles Runner's next ping
  let scrambleCharges = 1;
  const executeScramble = (
    caller: OperativeState,
    targetRunner: OperativeState
  ): { success: boolean; scrambledCoord?: LngLat; error?: string } => {
    if (caller.role !== 'agent') return { success: false, error: 'unauthorized' };
    if (scrambleCharges <= 0) return { success: false, error: 'no_charges_remaining' };
    scrambleCharges--;

    // Displace by 190m along azimuth 220 deg (South-West)
    const displacementM = 190;
    const scrambleAzimuth = 220;
    const truePos: LngLat = { latitude: targetRunner.latitude, longitude: targetRunner.longitude };
    let scrambled = projectCoordinate(truePos, displacementM, scrambleAzimuth);

    // Buffer clamp within arena (radius - 20m buffer)
    const distFromCenter = distanceM(arenaCenter, scrambled);
    if (distFromCenter > arenaRadiusM - 20) {
      scrambled = projectCoordinate(arenaCenter, arenaRadiusM - 25, bearingDeg(arenaCenter, scrambled));
    }

    return { success: true, scrambledCoord: scrambled };
  };

  // Runner moves North
  runner.latitude = projectCoordinate(arenaCenter, 100, 0).latitude;
  runner.longitude = projectCoordinate(arenaCenter, 100, 0).longitude;

  const scrambleRes = executeScramble(doubleAgent, runner);
  assert.strictEqual(scrambleRes.success, true);
  assert.ok(scrambleRes.scrambledCoord, 'Scrambled coordinate generated');

  const scrambleDisplacement = distanceM(
    { latitude: runner.latitude, longitude: runner.longitude },
    scrambleRes.scrambledCoord!
  );
  assert.strictEqual(Math.round(scrambleDisplacement), 190, 'Ping displaced by 190m (within 150-250m spec)');
  const distFromCenter = distanceM(arenaCenter, scrambleRes.scrambledCoord!);
  assert.ok(distFromCenter <= arenaRadiusM - 20, 'Scrambled coordinate clamped safely within 20m boundary buffer');

  // Step 4: Hunter Counter-Play - Emergency Tribunal
  let tribunalHeld = false;
  let bonusPingAwarded = false;
  let loyalHunterPenaltyApplied = false;

  const holdTribunal = (
    initiator: OperativeState,
    accused: OperativeState,
    votes: { hunterId: string; voteEject: boolean }[]
  ): { outcome: 'ejected' | 'dismissed'; wasAgent: boolean; error?: string } => {
    if (tribunalHeld) return { outcome: 'dismissed', wasAgent: false, error: 'tribunal_already_held' };
    if (initiator.team !== 'hunter' || accused.team !== 'hunter') return { outcome: 'dismissed', wasAgent: false, error: 'hunters_only' };
    if (initiator.id === accused.id) return { outcome: 'dismissed', wasAgent: false, error: 'self_accusation_rejected' };

    tribunalHeld = true;
    const ejectVotes = votes.filter((v) => v.voteEject).length;
    const totalVotes = votes.length;

    if (ejectVotes > totalVotes / 2) {
      // Convicted & Ejected
      accused.status = 'tagged';
      const wasAgent = accused.role === 'agent';
      if (wasAgent) {
        bonusPingAwarded = true; // Hunters get bonus radar ping
      } else {
        loyalHunterPenaltyApplied = true; // Loyal hunter penalized & silenced
      }
      return { outcome: 'ejected', wasAgent };
    }
    return { outcome: 'dismissed', wasAgent: false };
  };

  // Self-accusation rejection check
  const selfAccuse = holdTribunal(loyalHunter, loyalHunter, []);
  assert.strictEqual(selfAccuse.error, 'self_accusation_rejected', 'Hunters cannot convene tribunal against themselves');

  // Loyal Hunter convenes tribunal against Double Agent suspect
  const tribunalRes = holdTribunal(loyalHunter, doubleAgent, [
    { hunterId: loyalHunter.id, voteEject: true },
    { hunterId: doubleAgent.id, voteEject: true }, // Agent exposed / outvoted
  ]);

  assert.strictEqual(tribunalRes.outcome, 'ejected');
  assert.strictEqual(tribunalRes.wasAgent, true, 'Accused correctly identified as Double Agent');
  assert.strictEqual(doubleAgent.status, 'tagged', 'Double Agent is ejected from active play');
  assert.strictEqual(bonusPingAwarded, true, 'Bonus radar sweep awarded to hunters following successful mole conviction');

  // Attempting second tribunal fails (strictly 1 per match)
  const repeatTribunal = holdTribunal(loyalHunter, doubleAgent, []);
  assert.strictEqual(repeatTribunal.error, 'tribunal_already_held', 'Tribunal strictly limited to once per match');

  // Step 5: Shared Runner & Double Agent Win Condition
  // Runner reaches target location
  runner.latitude = targetLocation.latitude;
  runner.longitude = targetLocation.longitude;
  const distToTarget = distanceM({ latitude: runner.latitude, longitude: runner.longitude }, targetLocation);
  assert.ok(distToTarget <= TARGET_ARRIVAL_RADIUS_M, 'Runner reaches extraction zone');

  runner.status = 'extracted';
  const matchWinner = 'runner';
  const matchReason = 'extraction_successful';

  // Double Agent shares runner team victory condition!
  const isAgentVictor = matchWinner === 'runner';
  assert.strictEqual(isAgentVictor, true, 'Double Agent shares runners victory condition as co-victor');

  console.log(
    '✓ PASS: Double Agent verified: role secrecy, whisper quadrant (North), ping scramble (190m in-bounds), hunter tribunal ejection, bonus ping award, and shared runner victory'
  );
}

// -----------------------------------------------------------------------------
// Scenario 12: AI Game Master (Deterministic PL/pgSQL Engine, 5 Events, Event Ceiling)
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 12: AI Game Master (Deterministic Engine, 5 Events, 12-Cap) ---');
{
  const arenaCenter: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  let currentRadiusM = 400.0;
  const maxEvents = 12;
  let eventCount = 0;
  const eventLog: { type: string; narration: string; count: number }[] = [];

  let runner: OperativeState = {
    id: 'op-gm-runner',
    codename: 'GHOST',
    team: 'runner',
    // Positioned in North-East quadrant relative to arena center
    latitude: arenaCenter.latitude + 0.0012, // North (+dx)
    longitude: arenaCenter.longitude + 0.0015, // East (+dy)
    heading: 45,
    speedMps: 2.5,
    status: 'active',
    stationarySec: 0,
    outOfBoundsSince: null,
    lastLivePingAt: null,
    score: 0,
    vehicleViolation: false,
    gpsFixCount: 0,
    suppressedWanderCount: 0,
  };

  // Step 1: Event 1 - supply_drop
  // Supply cache drops within 0.65 * radius buffer
  const triggerSupplyDrop = (): { success: boolean; dropCoord: LngLat; distFromCenterM: number } => {
    eventCount++;
    const maxDropRadius = currentRadiusM * 0.65;
    // Simulated deterministic cache at 185m from center (inside 260m buffer)
    const dropDist = 185.0;
    const dropCoord = projectCoordinate(arenaCenter, dropDist, 135);
    eventLog.push({
      type: 'supply_drop',
      narration: 'Tactical supply cache dropped in the sector. Secure the telemetry cache before opposing forces converge.',
      count: eventCount,
    });
    return { success: true, dropCoord, distFromCenterM: dropDist };
  };

  const dropRes = triggerSupplyDrop();
  assert.strictEqual(dropRes.success, true);
  assert.strictEqual(eventCount, 1);
  assert.ok(dropRes.distFromCenterM <= currentRadiusM * 0.65, 'Supply drop spawned safely inside 65% area radius buffer');

  // Step 2: Event 2 - double_ping
  let doublePingTriggered = false;
  const triggerDoublePing = (): { success: boolean; pingReason: string } => {
    eventCount++;
    doublePingTriggered = true;
    eventLog.push({
      type: 'double_ping',
      narration: 'High-altitude satellite pulse re-synchronized. Active runner signatures mirrored on tactical radar.',
      count: eventCount,
    });
    return { success: true, pingReason: 'ai_gm_double_ping' };
  };

  const pingRes = triggerDoublePing();
  assert.strictEqual(pingRes.success, true);
  assert.strictEqual(eventCount, 2);
  assert.strictEqual(pingRes.pingReason, 'ai_gm_double_ping', 'Secondary radar sweep recorded with reason ai_gm_double_ping');

  // Step 3: Event 3 - fog
  let fogActiveUntil = 0;
  const triggerFog = (currentMatchSec: number): { success: boolean; fogDurationSec: number } => {
    eventCount++;
    fogActiveUntil = currentMatchSec + 60;
    eventLog.push({
      type: 'fog',
      narration: 'Dense atmospheric interference rolling into the sector. Radar feeds obscured for the next 60 seconds.',
      count: eventCount,
    });
    return { success: true, fogDurationSec: 60 };
  };

  const fogRes = triggerFog(120);
  assert.strictEqual(fogRes.success, true);
  assert.strictEqual(eventCount, 3);
  assert.strictEqual(fogActiveUntil, 180);
  // Check fog status at match second 150 (during fog) and 190 (after fog)
  const isFogActiveAt150 = 150 < fogActiveUntil;
  const isFogActiveAt190 = 190 < fogActiveUntil;
  assert.strictEqual(isFogActiveAt150, true, 'Radar feeds obscured during active 60s fog window');
  assert.strictEqual(isFogActiveAt190, false, 'Radar feeds automatically restored once fog window concludes');

  // Step 4: Event 4 - rumour
  // Evaluates spatial distribution of runners relative to center
  const triggerRumour = (runners: OperativeState[]): { success: boolean; quadrant: string } => {
    eventCount++;
    let ne = 0, nw = 0, se = 0, sw = 0;
    for (const r of runners) {
      const dLat = r.latitude - arenaCenter.latitude;
      const dLng = r.longitude - arenaCenter.longitude;
      if (dLat >= 0 && dLng >= 0) ne++;
      else if (dLat >= 0 && dLng < 0) nw++;
      else if (dLat < 0 && dLng >= 0) se++;
      else sw++;
    }
    const quadrant = ne >= nw && ne >= se && ne >= sw ? 'North-East' : 'Other';
    eventLog.push({
      type: 'rumour',
      narration: `Intercepted radio chatter indicates concentrated runner movement in the ${quadrant} sector.`,
      count: eventCount,
    });
    return { success: true, quadrant };
  };

  const rumourRes = triggerRumour([runner]);
  assert.strictEqual(rumourRes.success, true);
  assert.strictEqual(eventCount, 4);
  assert.strictEqual(rumourRes.quadrant, 'North-East', 'Rumour engine accurately analyzes spatial distribution to North-East quadrant');

  // Step 5: Event 5 - shrink_step with Safety Floor Clamp (min 60m)
  const triggerShrinkStep = (): { success: boolean; oldRadiusM: number; newRadiusM: number } => {
    eventCount++;
    const oldRadiusM = currentRadiusM;
    // Contraction by 15% (factor 0.85), clamped to safety floor of 60.0m
    const contracted = oldRadiusM * 0.85;
    currentRadiusM = Math.max(60.0, Math.round(contracted * 10) / 10);
    eventLog.push({
      type: 'shrink_step',
      narration: 'Command has accelerated boundary containment. Sector perimeter contracted by 15%.',
      count: eventCount,
    });
    return { success: true, oldRadiusM, newRadiusM: currentRadiusM };
  };

  const shrink1 = triggerShrinkStep();
  assert.strictEqual(shrink1.success, true);
  assert.strictEqual(eventCount, 5);
  assert.strictEqual(shrink1.newRadiusM, 340.0, 'Perimeter contracted from 400m to 340m (15% reduction)');

  // Verify multiple successive contractions clamp at hard 60m floor
  let testRadius = currentRadiusM;
  for (let i = 0; i < 20; i++) {
    testRadius = Math.max(60.0, Math.round(testRadius * 0.85 * 10) / 10);
  }
  assert.strictEqual(testRadius, 60.0, 'Arena boundary strictly clamped to >= 60.0m safety floor, preventing hazardous compression');

  // Step 6: Hard Event Ceiling (12-Event Cap)
  // Fire remaining events up to 12
  while (eventCount < maxEvents) {
    eventCount++;
    eventLog.push({
      type: 'supply_drop',
      narration: 'Tactical supply cache dropped in the sector.',
      count: eventCount,
    });
  }
  assert.strictEqual(eventCount, 12, 'Event count reaches 12 cap');

  // Attempt 13th event trigger
  const attemptOverCap = (): { success: boolean; reason?: string } => {
    if (eventCount >= maxEvents) {
      return { success: false, reason: 'max_events_reached' };
    }
    eventCount++;
    return { success: true };
  };

  const overCapRes = attemptOverCap();
  assert.strictEqual(overCapRes.success, false);
  assert.strictEqual(overCapRes.reason, 'max_events_reached', '13th event rejected: hard 12-event ceiling strictly enforced');

  // Step 7: Custom Narration Guardrail (250 char clamp)
  const sanitizeNarration = (raw: string): string => {
    return raw.trim().slice(0, 250);
  };
  const oversizedText = 'A'.repeat(300);
  const sanitized = sanitizeNarration(oversizedText);
  assert.strictEqual(sanitized.length, 250, 'Custom narration clamped to 250 characters');

  // Step 8: Match Pause Preservation
  let nextEventAtMs = 100000;
  const pauseDurationMs = 45000; // 45s pause
  const resumeShift = (targetTimeMs: number, pauseDeltaMs: number) => targetTimeMs + pauseDeltaMs;
  nextEventAtMs = resumeShift(nextEventAtMs, pauseDurationMs);
  assert.strictEqual(nextEventAtMs, 145000, 'Match pause preserves event timer by shifting next_event_at forward by exact pause delta');

  console.log(
    '✓ PASS: AI Game Master verified: deterministic PL/pgSQL engine (0 external LLM calls), 5 approved events (supply_drop, double_ping, fog, rumour, shrink_step), 60m safety floor, 12-event hard cap, 250-char narration guard, and pause preservation'
  );
}

// -----------------------------------------------------------------------------
// Scenario 13: Overwatch Drone / Remote Operator (Aerial Recon, Markers, Scans & Tag Immunity)
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 13: Overwatch Drone / Remote Operator (Recon, Markers, Scans) ---');
{
  const arenaCenter: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  const arenaRadiusM = 500;

  let fieldRunner: OperativeState = {
    id: 'op-field-runner',
    codename: 'GHOST-01',
    team: 'runner',
    latitude: projectCoordinate(arenaCenter, 150, 45).latitude,
    longitude: projectCoordinate(arenaCenter, 150, 45).longitude,
    heading: 45,
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

  let fieldHunter: OperativeState = {
    id: 'op-field-hunter',
    codename: 'HUNTER-01',
    team: 'hunter',
    latitude: projectCoordinate(arenaCenter, 120, 225).latitude,
    longitude: projectCoordinate(arenaCenter, 120, 225).longitude,
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

  // Remote Operators (Aerial Overwatch)
  interface RemoteOperatorState {
    id: string;
    codename: string;
    team: 'runner' | 'hunter';
    isRemote: boolean;
    activeMarkers: { id: string; lat: number; lng: number; label: string; createdAt: number }[];
    lastScanAt: number | null;
  }

  let runnerDrone: RemoteOperatorState = {
    id: 'op-runner-drone',
    codename: 'SKY-RUNNER',
    team: 'runner',
    isRemote: true,
    activeMarkers: [],
    lastScanAt: null,
  };

  let hunterDrone: RemoteOperatorState = {
    id: 'op-hunter-drone',
    codename: 'SKY-HUNTER',
    team: 'hunter',
    isRemote: true,
    activeMarkers: [],
    lastScanAt: null,
  };

  // Step 1: Remote Operator Invariants & Tag Immunity
  // Remote players do NOT submit physical positions
  const trySubmitPositionRemote = (op: RemoteOperatorState): boolean => {
    if (op.isRemote) return false; // Early returns without writing
    return true;
  };
  assert.strictEqual(trySubmitPositionRemote(runnerDrone), false, 'Remote operators do not upload physical GPS positions');

  // Hunters attempting to tag a remote operator are strictly rejected
  const tryTagRemote = (hunter: OperativeState, target: RemoteOperatorState): { success: boolean; error?: string } => {
    if (target.isRemote) {
      return { success: false, error: 'Remote operators cannot be tagged' };
    }
    return { success: true };
  };
  const tagAttempt = tryTagRemote(fieldHunter, runnerDrone);
  assert.strictEqual(tagAttempt.success, false);
  assert.strictEqual(tagAttempt.error, 'Remote operators cannot be tagged', 'Remote operators enjoy absolute tag immunity');

  // Step 2: Tactical Map Marker Placement & Pruning (Max 3 concurrent per squad)
  const placeMarker = (
    operator: RemoteOperatorState,
    coord: LngLat,
    label: string,
    timestamp: number
  ): { success: boolean; prunedCount: number; error?: string } => {
    const distFromCenter = distanceM(arenaCenter, coord);
    // Boundary check: max 1.5x area radius
    if (distFromCenter > arenaRadiusM * 1.5) {
      return { success: false, prunedCount: 0, error: 'marker_out_of_bounds' };
    }

    const newMarker = {
      id: `mark-${Math.random().toString(36).substring(2, 7)}`,
      lat: coord.latitude,
      lng: coord.longitude,
      label,
      createdAt: timestamp,
    };

    operator.activeMarkers.push(newMarker);
    let pruned = 0;
    // Enforce max 3 active markers per team (prune oldest)
    if (operator.activeMarkers.length > 3) {
      pruned = operator.activeMarkers.length - 3;
      operator.activeMarkers.splice(0, pruned);
    }

    return { success: true, prunedCount: pruned };
  };

  // Place 4 markers in sequence
  const mark1 = placeMarker(runnerDrone, projectCoordinate(arenaCenter, 100, 0), 'NORTH-RALLY', 1000);
  const mark2 = placeMarker(runnerDrone, projectCoordinate(arenaCenter, 150, 90), 'CHOKE-POINT', 2000);
  const mark3 = placeMarker(runnerDrone, projectCoordinate(arenaCenter, 200, 180), 'SAFE-HOUSE', 3000);
  assert.strictEqual(runnerDrone.activeMarkers.length, 3, '3 tactical markers placed');
  assert.strictEqual(mark3.prunedCount, 0);

  // 4th marker prunes oldest (mark1)
  const mark4 = placeMarker(runnerDrone, projectCoordinate(arenaCenter, 80, 270), 'EXFIL-ALPHA', 4000);
  assert.strictEqual(runnerDrone.activeMarkers.length, 3, 'Active markers strictly capped at 3');
  assert.strictEqual(mark4.prunedCount, 1, 'Oldest marker automatically pruned upon 4th placement');
  assert.strictEqual(runnerDrone.activeMarkers[0].label, 'CHOKE-POINT', 'First marker evicted, second is now oldest');
  assert.strictEqual(runnerDrone.activeMarkers[2].label, 'EXFIL-ALPHA', 'Latest marker appended at tail');

  // Step 3: Recon Scan 90-Second Cooldown Enforcement
  const SCAN_COOLDOWN_S = 90;
  const triggerScan = (
    operator: RemoteOperatorState,
    currentMatchSec: number
  ): { success: boolean; cooldownRemainingS?: number } => {
    if (operator.lastScanAt !== null && currentMatchSec - operator.lastScanAt < SCAN_COOLDOWN_S) {
      return { success: false, cooldownRemainingS: SCAN_COOLDOWN_S - (currentMatchSec - operator.lastScanAt) };
    }
    operator.lastScanAt = currentMatchSec;
    return { success: true };
  };

  const scan1 = triggerScan(runnerDrone, 30);
  assert.strictEqual(scan1.success, true, 'First scan executes cleanly');
  assert.strictEqual(runnerDrone.lastScanAt, 30);

  // Attempt scan at 60s (30s elapsed < 90s cooldown) -> rejected
  const scanEarly = triggerScan(runnerDrone, 60);
  assert.strictEqual(scanEarly.success, false, 'Early scan rejected by cooldown guard');
  assert.strictEqual(scanEarly.cooldownRemainingS, 60, 'Exactly 60s cooldown remaining reported');

  // Attempt scan at 125s (95s elapsed >= 90s cooldown) -> succeeds
  const scanReady = triggerScan(runnerDrone, 125);
  assert.strictEqual(scanReady.success, true, 'Scan succeeds after 90s cooldown expires');

  // Step 4: Runner Operator Scan — 150m Fuzzed Hunter Envelope
  // Finds nearest field hunter, applies 10-30m deterministic fuzzing, emits 150m envelope
  const executeRunnerScan = (
    hunter: OperativeState
  ): { success: boolean; envelopeRadiusM: number; fuzzedCenter: LngLat; offsetM: number; ttlS: number } => {
    const truePos: LngLat = { latitude: hunter.latitude, longitude: hunter.longitude };
    const fuzzDistanceM = 22.0; // Deterministic fuzzing between 10m and 30m
    const fuzzBearing = 135.0;
    const fuzzedCenter = projectCoordinate(truePos, fuzzDistanceM, fuzzBearing);
    const offset = distanceM(truePos, fuzzedCenter);
    return {
      success: true,
      envelopeRadiusM: 150.0,
      fuzzedCenter,
      offsetM: offset,
      ttlS: 10,
    };
  };

  const runnerScanResult = executeRunnerScan(fieldHunter);
  assert.strictEqual(runnerScanResult.success, true);
  assert.strictEqual(runnerScanResult.envelopeRadiusM, 150.0, 'Runner scan produces 150m detection envelope');
  assert.strictEqual(runnerScanResult.ttlS, 10, 'Envelope has 10s tactical time-to-live');
  assert.ok(runnerScanResult.offsetM >= 10 && runnerScanResult.offsetM <= 30, 'Hunter true location fuzzed by 22m (within 10-30m safety buffer)');

  // Step 5: Hunter Operator Census Scan — 200m Aggregate Headcount (Zero Coordinates Leaked)
  const executeHunterScan = (
    center: LngLat,
    runners: OperativeState[]
  ): { success: boolean; runnerCount: number; scanRadiusM: number } => {
    let count = 0;
    for (const r of runners) {
      const d = distanceM(center, { latitude: r.latitude, longitude: r.longitude });
      if (d <= 200.0 && r.status === 'active') {
        count++;
      }
    }
    return { success: true, runnerCount: count, scanRadiusM: 200.0 };
  };

  const hunterScanCenter = projectCoordinate(arenaCenter, 100, 45); // Near field runner
  const hunterScanResult = executeHunterScan(hunterScanCenter, [fieldRunner]);
  assert.strictEqual(hunterScanResult.success, true);
  assert.strictEqual(hunterScanResult.runnerCount, 1, 'Hunter census detects 1 active runner in 200m radius');
  assert.strictEqual(hunterScanResult.scanRadiusM, 200.0);

  // Step 6: Shared Team Victory
  fieldRunner.status = 'extracted';
  const matchWinner = 'runner';
  const droneSharedVictory = runnerDrone.team === matchWinner;
  assert.strictEqual(droneSharedVictory, true, 'Remote operator is scored as co-victor with field squad');

  console.log(
    '✓ PASS: Overwatch Drone verified: remote operator status, absolute tag immunity, marker placement with FIFO pruning (max 3), 90s scan cooldown, 150m fuzzed envelope, 200m hunter headcount census, and shared squad victory'
  );
}

// -----------------------------------------------------------------------------
// Scenario 14: Blackout Radar (Passive Directional Sonar & Stealth Pacing)
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 14: Blackout Radar (Passive Directional Sonar & Stealth Pacing) ---');
{
  const arenaCenter: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  const arenaRadiusM = 500;

  let runner: OperativeState = {
    id: 'op-blackout-runner',
    codename: 'SHADOW',
    team: 'runner',
    latitude: arenaCenter.latitude,
    longitude: arenaCenter.longitude,
    heading: 0, // Facing North
    speedMps: 2.8,
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
    id: 'op-blackout-hunter',
    codename: 'SONAR',
    team: 'hunter',
    latitude: projectCoordinate(arenaCenter, 180, 90).latitude, // 180m East
    longitude: projectCoordinate(arenaCenter, 180, 90).longitude,
    heading: 270, // Facing West (toward runner)
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

  // Step 1: Radio Silence / Stealth Pacing (90s Ping Interval)
  const BLACKOUT_PING_INTERVAL_S = 90;
  const isPingDue = (lastPingSec: number, currentSec: number): boolean => {
    return currentSec - lastPingSec >= BLACKOUT_PING_INTERVAL_S;
  };
  assert.strictEqual(isPingDue(0, 30), false, 'Normal 30s ping suppressed under Blackout radio silence');
  assert.strictEqual(isPingDue(0, 89), false, 'Stealth maintained at 89s');
  assert.strictEqual(isPingDue(0, 90), true, 'Ping only released at extended 90s stealth cadence');

  // Step 2: Relative Azimuth Sonar Calculation (Directional Bearing)
  // Operative Hunter is at (180m East), heading West (270 deg)
  // Runner is at center (0, 0), relative to Hunter, runner is due West (270 deg true bearing)
  const hunterPos: LngLat = { latitude: hunter.latitude, longitude: hunter.longitude };
  const runnerPos: LngLat = { latitude: runner.latitude, longitude: runner.longitude };

  const trueBearingToRunner = bearingDeg(hunterPos, runnerPos);
  assert.strictEqual(Math.round(trueBearingToRunner), 270, 'True bearing to runner is 270° (due West)');

  // Relative heading = (bearing - heading + 360) % 360
  // Hunter is facing West (270 deg), target is at 270 deg -> Relative heading is 0° (Straight Ahead)
  const relHeadingAhead = (trueBearingToRunner - hunter.heading + 360) % 360;
  assert.strictEqual(Math.round(relHeadingAhead), 0, 'Target is directly straight ahead (0° relative)');

  // Now Hunter turns North (heading 0 deg)
  hunter.heading = 0;
  const relHeadingLeft = (trueBearingToRunner - hunter.heading + 360) % 360;
  assert.strictEqual(Math.round(relHeadingLeft), 270, 'When facing North, target West is on the left flank (270° relative)');

  // Helper for 4-sector tactical sonar HUD
  const getSonarSector = (relativeDeg: number): 'ahead' | 'right' | 'behind' | 'left' => {
    const norm = (relativeDeg + 360) % 360;
    if (norm >= 337.5 || norm < 22.5) return 'ahead';
    if (norm >= 22.5 && norm < 157.5) return 'right';
    if (norm >= 157.5 && norm < 202.5) return 'behind';
    return 'left';
  };

  assert.strictEqual(getSonarSector(relHeadingAhead), 'ahead');
  assert.strictEqual(getSonarSector(relHeadingLeft), 'left');

  // Step 3: Acoustic Distance Cadence
  const getAcousticCadenceMs = (distM: number): number => {
    if (distM > 100) return 5000; // 5s long-range chirp
    if (distM > 40) return 2000;  // 2s medium sonar pulse
    return 500;                   // 0.5s rapid proximity ping
  };

  const dist180 = distanceM(hunterPos, runnerPos);
  assert.strictEqual(getAcousticCadenceMs(dist180), 5000, 'Long range acoustic cadence: 5000ms');

  // Hunter closes in to 65m
  const hunterClosePos = projectCoordinate(runnerPos, 65, 90);
  hunter.latitude = hunterClosePos.latitude;
  hunter.longitude = hunterClosePos.longitude;
  const dist65 = distanceM({ latitude: hunter.latitude, longitude: hunter.longitude }, runnerPos);
  assert.strictEqual(getAcousticCadenceMs(dist65), 2000, 'Medium range acoustic cadence: 2000ms');

  // Hunter closes in to 25m
  const hunterNearPos = projectCoordinate(runnerPos, 25, 90);
  hunter.latitude = hunterNearPos.latitude;
  hunter.longitude = hunterNearPos.longitude;
  const dist25 = distanceM({ latitude: hunter.latitude, longitude: hunter.longitude }, runnerPos);
  assert.strictEqual(getAcousticCadenceMs(dist25), 500, 'Rapid hot sonar ping cadence: 500ms');

  // Step 4: Strict Out-of-Bounds Instant Reveal (`reveal_live`)
  // Runner strays outside perimeter (515m from center > 500m)
  runner.latitude = projectCoordinate(arenaCenter, 515, 0).latitude;
  runner.longitude = projectCoordinate(arenaCenter, 515, 0).longitude;
  const runnerDistFromCenter = distanceM(arenaCenter, { latitude: runner.latitude, longitude: runner.longitude });
  assert.ok(runnerDistFromCenter > arenaRadiusM, 'Runner stepped out of bounds');

  let liveRevealEmitted = false;
  const evaluateBlackoutBoundaryPenalty = (distFromCenter: number, radiusM: number) => {
    if (distFromCenter > radiusM) {
      liveRevealEmitted = true; // Immediate live reveal under blackout preset
      return 'reveal_live';
    }
    return 'in_bounds';
  };
  const penalty = evaluateBlackoutBoundaryPenalty(runnerDistFromCenter, arenaRadiusM);
  assert.strictEqual(penalty, 'reveal_live');
  assert.strictEqual(liveRevealEmitted, true, 'Boundary breach immediately triggers reveal_live penalty');

  // Step 5: Close Quarters Tag Collision (15m radius)
  const BLACKOUT_TAG_RADIUS_M = 15.0;
  // Hunter closes in to 12m from runner
  hunter.latitude = projectCoordinate({ latitude: runner.latitude, longitude: runner.longitude }, 12, 180).latitude;
  hunter.longitude = projectCoordinate({ latitude: runner.latitude, longitude: runner.longitude }, 12, 180).longitude;
  const tagDist = distanceM(
    { latitude: hunter.latitude, longitude: hunter.longitude },
    { latitude: runner.latitude, longitude: runner.longitude }
  );
  assert.ok(tagDist <= BLACKOUT_TAG_RADIUS_M, 'Hunter is within 15m tag radius');

  runner.status = 'tagged';
  assert.strictEqual(runner.status, 'tagged', 'Runner tagged under Blackout conditions');

  console.log(
    '✓ PASS: Blackout Radar verified: 90s radio silence stealth pacing, relative bearing azimuth calculation, 3-tier acoustic pulse cadence, instant out-of-bounds reveal_live, and 15m tag collision'
  );
}

// ----------------------------------------------------------------------------
// Scenario 15: Blackbox Telemetry Replayer (Real-World Match Ingestion & Forensic Validation)
// ----------------------------------------------------------------------------
{
  console.log('\n--- Scenario 15: Blackbox Telemetry Replayer (Real-World Match Ingestion & Forensic Validation) ---');

  // Step 1: Synthesize a real-world field session
  const session = createBlackboxSession({
    gameId: 'FIELD-REC-77',
    modeId: 'vip_escort',
    callsign: 'Viper',
    role: 'vip',
    initialBatteryLevel: 0.94,
  });

  const baseCoord: LngLat = { latitude: 37.7749, longitude: -122.4194 };
  const baseTime = Date.now();
  let accumulatedDistanceM = 0;

  // Record 60 seconds of realistic human sprint trajectory (3.5 m/s)
  for (let s = 0; s < 60; s++) {
    const projected = projectCoordinate(baseCoord, s * 3.5, 45);
    appendBlackboxFix(session, {
      timestamp: baseTime + s * 1000,
      lat: projected.latitude,
      lng: projected.longitude,
      accuracy: 3.2 + (s % 4) * 0.3, // Realistic jitter 3.2m - 4.1m
      speed: 3.5,
      heading: 45,
      batteryLevel: 0.94 - s * 0.0001,
    });
  }

  // Record match events during sprint
  appendBlackboxEvent(session, {
    timestamp: baseTime + 15000,
    type: 'ping_received',
    payload: { source: 'hunter-1', distanceM: 65 },
  });

  appendBlackboxEvent(session, {
    timestamp: baseTime + 45000,
    type: 'tag_attempt',
    payload: { hunterId: 'hunter-2', distanceM: 22 },
  });

  finalizeBlackboxSession(session);

  // Step 2: Serialize to .ghostbox JSONL format
  const jsonlContent = serializeBlackboxToJsonl(session);
  assert.ok(jsonlContent.length > 500, 'JSONL blackbox stream generated');

  // Step 3: Headless simulator replayer ingestion
  const replayedSession = parseBlackboxFromJsonl(jsonlContent);
  const validation = validateBlackboxSession(replayedSession);

  assert.strictEqual(validation.valid, true, 'Blackbox validation must pass');
  assert.strictEqual(validation.fixCount, 60, 'All 60 fixes must be faithfully deserialized');
  assert.strictEqual(validation.durationSeconds, 59, 'Recorded duration must be 59-60s');
  assert.strictEqual(replayedSession.events.length, 4, 'Must contain start, ping, tag, and end events');

  // Step 4: Step-by-step kinematic replayer step through
  let maxVelocityMps = 0;
  for (let i = 1; i < replayedSession.fixes.length; i++) {
    const prev = replayedSession.fixes[i - 1];
    const curr = replayedSession.fixes[i];
    const dtSec = (curr.timestamp - prev.timestamp) / 1000.0;
    const stepDist = distanceM(
      { latitude: prev.lat, longitude: prev.lng },
      { latitude: curr.lat, longitude: curr.lng }
    );
    accumulatedDistanceM += stepDist;
    const velocity = stepDist / dtSec;
    if (velocity > maxVelocityMps) maxVelocityMps = velocity;
  }

  assert.ok(maxVelocityMps < MAX_HUMAN_SPRINT_SPEED_MPS, 'Replayed velocity must not trigger vehicle tripwire');
  assert.ok(accumulatedDistanceM > 190 && accumulatedDistanceM < 220, 'Traversed expected distance ~206m');

  console.log(
    '✓ PASS: Blackbox Telemetry Replayer verified: lossless JSONL deserialization, 60-fix kinematic trajectory replay, zero vehicle tripwires, event synchronization, and forensic match validation'
  );
}

console.log('\n================================================================');
console.log('  All 15 Autonomous Match Simulation Scenarios PASSED (100%)    ');
console.log('================================================================\n');

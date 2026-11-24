import assert from 'node:assert';
import { getModeModule } from '../src/modes/registry';
import {
  evaluatePinpointScore,
  evaluatePinpointClues,
  calculateHeadingDelta,
  PINPOINT_BULLSEYE_THRESHOLD_M,
  PINPOINT_ZERO_SCORE_DISTANCE_M,
} from '../src/modes/pinpoint/engine';
import { PinpointTarget } from '../src/modes/pinpoint/types';

console.log('=== GhostRun v3.0 Flagship Mode: PINPOINT Unit Test Suite ===\n');

// 1. Mode Module Registration
{
  const mode = getModeModule('pinpoint');
  assert.ok(mode, 'Pinpoint mode must be registered in mode registry');
  assert.strictEqual(mode.id, 'pinpoint');
  assert.strictEqual(mode.name, 'Pinpoint');
  assert.strictEqual(mode.layer, 'base');
  assert.strictEqual(mode.featureFlag, 'feature.mode.pinpoint');
  assert.strictEqual(mode.params.length, 4);

  // Check radius parameter bounds
  const radiusParam = mode.params.find((p) => p.key === 'radius_meters');
  assert.ok(radiusParam);
  assert.strictEqual(radiusParam.min, 150);
  assert.strictEqual(radiusParam.max, 750);
  assert.strictEqual(radiusParam.defaultValue, 500);

  // Check presets
  assert.ok(mode.presets?.casual);
  assert.ok(mode.presets?.standard);
  assert.ok(mode.presets?.hardcore);
  assert.strictEqual(mode.presets.standard.radius_meters, 500);
  assert.strictEqual(mode.presets.hardcore.radius_meters, 750);

  console.log('✓ Test 1: Pinpoint mode registered with correct parameters, geofence bounds, and presets');
}

// 2. Heading Normalization Delta Math
{
  assert.strictEqual(calculateHeadingDelta(10, 350), 20);
  assert.strictEqual(calculateHeadingDelta(350, 10), 20);
  assert.strictEqual(calculateHeadingDelta(0, 180), 180);
  assert.strictEqual(calculateHeadingDelta(90, 270), 180);
  assert.strictEqual(calculateHeadingDelta(45, 60), 15);
  assert.strictEqual(calculateHeadingDelta(120, 120), 0);
  console.log('✓ Test 2: Normalized compass heading delta math verified across 360° wrapping');
}

// 3. OpenGuessr 5,000 Points Scoring Matrix
{
  const target: PinpointTarget = {
    id: 'target-1',
    roundNumber: 1,
    photoUrl: 'https://cdn.ghostrun.app/pinpoint/target1.jpg',
    latitude: 51.5074,
    longitude: -0.1278,
    heading: 180.0,
    status: 'active',
  };

  // Case A: Perfect Bullseye (< 3m, 0 deg error, instant speed, 0 clues) -> 5,000 pts
  const perfect = evaluatePinpointScore({
    target,
    submissionLat: 51.5074,
    submissionLng: -0.1278,
    submissionHeading: 180.0,
    cluesUnlocked: 0,
    elapsedSec: 0,
    roundDurationSec: 180,
  });
  assert.strictEqual(perfect.scoreProximity, 4000);
  assert.strictEqual(perfect.scoreHeading, 500);
  assert.strictEqual(perfect.scoreSpeed, 500);
  assert.strictEqual(perfect.clueMultiplier, 1.0);
  assert.strictEqual(perfect.totalScore, 5000);
  console.log('✓ Test 3A: Perfect bullseye (<3m, 0° angle, instant) awards exact 5,000 max points');

  // Case B: Bullseye threshold boundary (<= 3.0m)
  assert.strictEqual(PINPOINT_BULLSEYE_THRESHOLD_M, 3.0);
  assert.strictEqual(PINPOINT_ZERO_SCORE_DISTANCE_M, 400.0);

  // Case C: Heading Cosine Falloff (>= 90 deg yields 0 heading score)
  const facingWrongWay = evaluatePinpointScore({
    target,
    submissionLat: 51.5074,
    submissionLng: -0.1278,
    submissionHeading: 270.0, // 90 deg delta
    cluesUnlocked: 0,
    elapsedSec: 0,
    roundDurationSec: 180,
  });
  assert.strictEqual(facingWrongWay.scoreHeading, 0);

  const facingAngle60 = evaluatePinpointScore({
    target,
    submissionLat: 51.5074,
    submissionLng: -0.1278,
    submissionHeading: 240.0, // 60 deg delta -> cos(60) = 0.5 -> 250 pts
    cluesUnlocked: 0,
    elapsedSec: 0,
    roundDurationSec: 180,
  });
  assert.strictEqual(facingAngle60.scoreHeading, 250);
  console.log('✓ Test 3B: Heading orientation cosine curve verified (60° -> 250 pts, 90° -> 0 pts)');

  // Case D: Clue Penalty Multipliers (1.0x, 0.9x, 0.8x, 0.7x)
  const clue0 = evaluatePinpointScore({
    target,
    submissionLat: 51.5074,
    submissionLng: -0.1278,
    submissionHeading: 180.0,
    cluesUnlocked: 0,
    elapsedSec: 90,
  });
  const clue1 = evaluatePinpointScore({
    target,
    submissionLat: 51.5074,
    submissionLng: -0.1278,
    submissionHeading: 180.0,
    cluesUnlocked: 1,
    elapsedSec: 90,
  });
  const clue2 = evaluatePinpointScore({
    target,
    submissionLat: 51.5074,
    submissionLng: -0.1278,
    submissionHeading: 180.0,
    cluesUnlocked: 2,
    elapsedSec: 90,
  });
  const clue3 = evaluatePinpointScore({
    target,
    submissionLat: 51.5074,
    submissionLng: -0.1278,
    submissionHeading: 180.0,
    cluesUnlocked: 3,
    elapsedSec: 90,
  });
  assert.strictEqual(clue0.clueMultiplier, 1.0);
  assert.strictEqual(clue1.clueMultiplier, 0.9);
  assert.strictEqual(clue2.clueMultiplier, 0.8);
  assert.strictEqual(clue3.clueMultiplier, 0.7);
  assert.strictEqual(clue1.totalScore, Math.round((4000 + 500 + 250) * 0.9));
  assert.strictEqual(clue2.totalScore, Math.round((4000 + 500 + 250) * 0.8));
  assert.strictEqual(clue3.totalScore, Math.round((4000 + 500 + 250) * 0.7));
  console.log('✓ Test 3C: Progressive clue multipliers (1.0x -> 0.9x -> 0.8x -> 0.7x) accurately applied');
}

// 4. Progressive Clue Timeline State Machine
{
  const centerLat = 51.5000;
  const centerLng = -0.1200;
  const targetLat = 51.5050; // North of center
  const targetLng = -0.1150; // East of center -> Quadrant NE

  // At T+30s (< 45s): Level 0 (Pure Sight)
  const t30 = evaluatePinpointClues({
    elapsedSec: 30,
    roundDurationSec: 180,
    currentLat: 51.5000,
    currentLng: -0.1200,
    targetLat,
    targetLng,
    centerLat,
    centerLng,
  });
  assert.strictEqual(t30.level, 0);
  assert.strictEqual(t30.sonarPingIntervalMs, null);
  assert.strictEqual(t30.sectorQuadrant, null);
  assert.strictEqual(t30.bearingToTargetDeg, null);
  assert.strictEqual(t30.scoreMultiplier, 1.0);

  // At T+60s (>= 45s): Level 1 (Hot/Cold Sonar unlocked)
  const t60 = evaluatePinpointClues({
    elapsedSec: 60,
    roundDurationSec: 180,
    currentLat: 51.5000,
    currentLng: -0.1200,
    targetLat,
    targetLng,
    centerLat,
    centerLng,
  });
  assert.strictEqual(t60.level, 1);
  assert.ok(t60.sonarPingIntervalMs !== null);
  assert.ok(t60.sonarAuraColor !== null);
  assert.strictEqual(t60.sectorQuadrant, null);
  assert.strictEqual(t60.scoreMultiplier, 0.9);

  // At T+100s (>= 90s): Level 2 (Sector Triangulation unlocked)
  const t100 = evaluatePinpointClues({
    elapsedSec: 100,
    roundDurationSec: 180,
    currentLat: 51.5000,
    currentLng: -0.1200,
    targetLat,
    targetLng,
    centerLat,
    centerLng,
  });
  assert.strictEqual(t100.level, 2);
  assert.strictEqual(t100.sectorQuadrant, 'NE');
  assert.strictEqual(t100.bearingToTargetDeg, null);
  assert.strictEqual(t100.scoreMultiplier, 0.8);

  // At T+150s (>= 135s): Level 3 (Compass Azimuth Bearing Vector unlocked)
  const t150 = evaluatePinpointClues({
    elapsedSec: 150,
    roundDurationSec: 180,
    currentLat: 51.5000,
    currentLng: -0.1200,
    targetLat,
    targetLng,
    centerLat,
    centerLng,
  });
  assert.strictEqual(t150.level, 3);
  assert.strictEqual(t150.sectorQuadrant, 'NE');
  assert.ok(t150.bearingToTargetDeg !== null);
  assert.strictEqual(t150.scoreMultiplier, 0.7);

  console.log('✓ Test 4: Progressive clue timeline progression (T+0:00 -> T+0:45 -> T+1:30 -> T+2:15) verified');
}

// 5. Mode Tagline & Safety Profile Verification
{
  const mode = getModeModule('pinpoint')!;
  assert.ok(mode.safetyNotes.length >= 3, 'Pinpoint must document outdoor terrain safety');
  assert.ok(mode.rules.sections.length >= 4, 'Pinpoint must specify full rule sections');
  assert.ok(mode.briefing.intel.length >= 3, 'Pinpoint must provide operational briefing intel');
  console.log('✓ Test 5: Pinpoint safety guidelines, rule sections, and briefing intel validated');
}

console.log('\nAll 5 Pinpoint Mode test suites passed cleanly!');

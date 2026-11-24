import assert from 'node:assert';
import {
  evaluatePinpointScore,
  getPinpointGradeBadge,
  getHeadingCompassLabel,
  calculateHeadingDelta,
} from '../src/modes/pinpoint/engine';
import { PinpointTarget } from '../src/modes/pinpoint/types';

console.log('=== GhostRun v3.0 Pinpoint Result & Comparison Test Suite ===\n');

async function runTests() {
  // Test 1: Grade Badge Categorization across full score range (0 - 5,000 pts)
  {
    const b5000 = getPinpointGradeBadge(5000);
    assert.strictEqual(b5000.grade, 'bullseye_master');
    assert.strictEqual(b5000.title, 'BULLSEYE MASTER');
    assert.strictEqual(b5000.color, '#C8FF00');

    const b4500 = getPinpointGradeBadge(4500);
    assert.strictEqual(b4500.grade, 'bullseye_master');

    const b4499 = getPinpointGradeBadge(4499);
    assert.strictEqual(b4499.grade, 'excellent_scout');
    assert.strictEqual(b4499.title, 'EXCELLENT SCOUT');
    assert.strictEqual(b4499.color, '#00F0FF');

    const b3500 = getPinpointGradeBadge(3500);
    assert.strictEqual(b3500.grade, 'excellent_scout');

    const b3499 = getPinpointGradeBadge(3499);
    assert.strictEqual(b3499.grade, 'tactical_recon');
    assert.strictEqual(b3499.title, 'TACTICAL RECON');
    assert.strictEqual(b3499.color, '#F59E0B');

    const b2000 = getPinpointGradeBadge(2000);
    assert.strictEqual(b2000.grade, 'tactical_recon');

    const b1999 = getPinpointGradeBadge(1999);
    assert.strictEqual(b1999.grade, 'off_target');
    assert.strictEqual(b1999.title, 'OFF-TARGET');
    assert.strictEqual(b1999.color, '#94A3B8');

    const b0 = getPinpointGradeBadge(0);
    assert.strictEqual(b0.grade, 'off_target');

    console.log('PASS Test 1: Grade badge categorization matches 4-tier tactical hierarchy (5000 -> 0 pts)');
  }

  // Test 2: Compass Cardinal Formatter for Map & Photo Direction
  {
    assert.strictEqual(getHeadingCompassLabel(0), 'N (0 DEG)');
    assert.strictEqual(getHeadingCompassLabel(360), 'N (0 DEG)');
    assert.strictEqual(getHeadingCompassLabel(45), 'NE (45 DEG)');
    assert.strictEqual(getHeadingCompassLabel(90), 'E (90 DEG)');
    assert.strictEqual(getHeadingCompassLabel(135), 'SE (135 DEG)');
    assert.strictEqual(getHeadingCompassLabel(180), 'S (180 DEG)');
    assert.strictEqual(getHeadingCompassLabel(225), 'SW (225 DEG)');
    assert.strictEqual(getHeadingCompassLabel(270), 'W (270 DEG)');
    assert.strictEqual(getHeadingCompassLabel(315), 'NW (315 DEG)');
    assert.strictEqual(getHeadingCompassLabel(359.9), 'N (0 DEG)');

    console.log('PASS Test 2: Compass azimuth label generation correctly converts degrees to cardinal bearings');
  }

  // Test 3: Photo Comparison Delta and Score Computation
  {
    const target: PinpointTarget = {
      id: 'target-park-fountain',
      roundNumber: 2,
      photoUrl: 'https://example.com/fountain.jpg',
      latitude: 28.6139,
      longitude: 77.2090,
      heading: 45.0,
      status: 'active',
    };

    // Case: Operative is 15m away, 12 degrees azimuth delta, solved in 45s (out of 180s) with 0 clues
    const score = evaluatePinpointScore({
      target,
      submissionLat: 28.6139 + 0.0001,
      submissionLng: 77.2090 + 0.0001,
      submissionHeading: 57.0,
      cluesUnlocked: 0,
      elapsedSec: 45,
      roundDurationSec: 180,
    });

    assert.ok(score.distanceErrorM > 0);
    assert.strictEqual(Math.round(score.headingErrorDeg), 12);
    assert.ok(score.scoreProximity > 3000, 'Proximity score should be high for 15m distance');
    assert.ok(score.scoreHeading > 450, 'Heading alignment should be near max for 12 deg delta');
    assert.strictEqual(score.scoreSpeed, 375, 'Speed bonus should be 375 pts at 25% time elapsed');
    assert.strictEqual(score.clueMultiplier, 1.0);
    assert.ok(score.totalScore > 4000);

    const badge = getPinpointGradeBadge(score.totalScore);
    assert.ok(badge.grade === 'bullseye_master' || badge.grade === 'excellent_scout');

    console.log('PASS Test 3: Realistic round submission score and delta calculations verified');
  }

  // Test 4: Strict No-Emoji Guarantee
  {
    const allBadges = [
      getPinpointGradeBadge(5000),
      getPinpointGradeBadge(4200),
      getPinpointGradeBadge(2800),
      getPinpointGradeBadge(800),
    ];

    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

    for (const b of allBadges) {
      assert.strictEqual(emojiRegex.test(b.title), false, 'Badge title must not contain emojis');
      assert.strictEqual(emojiRegex.test(b.summary), false, 'Badge summary must not contain emojis');
    }

    for (let deg = 0; deg < 360; deg += 45) {
      const label = getHeadingCompassLabel(deg);
      assert.strictEqual(emojiRegex.test(label), false, 'Compass label must not contain emojis');
    }

    console.log('PASS Test 4: Zero-emoji compliance verified across all badges, summaries, and compass labels');
  }

  console.log('\nAll 4 Pinpoint Result & Comparison test suites passed cleanly!');
}

void runTests();

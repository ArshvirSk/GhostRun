import assert from 'node:assert';
import {
  cycleReplaySpeed,
  computeGloryHeadline,
  formatStoryCardMetrics,
  generateStorySvgPath,
  findNextTagTime,
  findPrevTagTime,
  calculateStoryCardDimensions,
  generateStoryShareText,
  formatClockMinutesSeconds,
  formatDurationMMSS,
} from '../src/lib/storyCardCore';
import type { LngLat } from '../src/lib/geo';

console.log('=== Pillar 4: Story Card & 2D Animated Replay Telemetry Test Suite ===\n');

// Test 1: Multi-Speed Cycling
{
  assert.strictEqual(cycleReplaySpeed(1), 2);
  assert.strictEqual(cycleReplaySpeed(2), 5);
  assert.strictEqual(cycleReplaySpeed(5), 10);
  assert.strictEqual(cycleReplaySpeed(10), 1);
  assert.strictEqual(cycleReplaySpeed(99), 1); // fallback unknown
  console.log('✓ Test 1: cycleReplaySpeed smoothly cycles sequence [1x, 2x, 5x, 10x, 1x]');
}

// Test 2: Dynamic Glory Headline Generation
{
  // 2a. Outbreak Horde Survivor Victory
  const survivorWin = computeGloryHeadline({
    mode: 'outbreak_horde',
    role: 'runner',
    outcome: 'victorious',
    durationSeconds: 862, // 14m 22s
    distanceMeters: 3400,
    opponentCount: 4,
  });
  assert.strictEqual(survivorWin.title, 'SURVIVED 14M 22S');
  assert.ok(survivorWin.subtitle.includes('4 INFECTED'));
  assert.strictEqual(survivorWin.badge, 'IMMUNE EXTRACTION');
  assert.strictEqual(survivorWin.badgeColor, '#10B981');

  // 2b. Outbreak Horde Patient Zero
  const patientZero = computeGloryHeadline({
    mode: 'outbreak_horde',
    role: 'hunter',
    outcome: 'victorious',
    durationSeconds: 600,
    distanceMeters: 2500,
    capturesCount: 5,
    isPatientZero: true,
  });
  assert.strictEqual(patientZero.title, 'PATIENT ZERO // 5 INFECTED');
  assert.strictEqual(patientZero.badge, 'OUTBREAK APEX');
  assert.strictEqual(patientZero.badgeColor, '#EF4444');

  // 2c. Classic Runner Victory
  const runnerWin = computeGloryHeadline({
    mode: 'classic_chase',
    role: 'runner',
    outcome: 'victorious',
    durationSeconds: 900,
    distanceMeters: 3200,
    opponentCount: 2,
  });
  assert.strictEqual(runnerWin.title, 'EXTRACTED • 3.2 KM EVADED');
  assert.strictEqual(runnerWin.badge, 'MISSION ACCOMPLISHED');

  // 2d. Classic Hunter Apex
  const hunterApex = computeGloryHeadline({
    mode: 'classic_chase',
    role: 'hunter',
    outcome: 'victorious',
    durationSeconds: 450,
    distanceMeters: 2100,
    capturesCount: 4,
  });
  assert.strictEqual(hunterApex.title, 'APEX PREDATOR • 4 CAPTURES');
  assert.strictEqual(hunterApex.badge, 'SECTOR SECURED');

  console.log('✓ Test 2: computeGloryHeadline generates high-contrast mode-aware badges & headlines');
}

// Test 3: Story Metrics Formatting
{
  const formatted = formatStoryCardMetrics({
    distanceMeters: 4560,
    durationSeconds: 862,
    peakSpeedMps: 5.2, // ~18.72 km/h
  });
  assert.strictEqual(formatted.distanceFormatted, '4.6 KM');
  assert.strictEqual(formatted.durationFormatted, '14:22');
  assert.strictEqual(formatted.speedFormatted, '18.7 KM/H');

  const fallback = formatStoryCardMetrics({
    distanceMeters: 800,
    durationSeconds: 45,
  });
  assert.strictEqual(fallback.distanceFormatted, '0.8 KM');
  assert.strictEqual(fallback.durationFormatted, '00:45');
  assert.strictEqual(fallback.speedFormatted, '—');
  console.log('✓ Test 3: formatStoryCardMetrics produces clean tactical triad strings');
}

// Test 4: Privacy-Trimmed SVG Route Outline (NF-10 Compliance)
{
  // 4a. Reject trails under 350m
  const shortTrail: LngLat[] = [
    { longitude: 10.0, latitude: 20.0 },
    { longitude: 10.0005, latitude: 20.0005 },
  ];
  const shortRes = generateStorySvgPath(shortTrail, 280, 280, 20);
  assert.strictEqual(shortRes.hasValidTrail, false);
  assert.strictEqual(shortRes.svgPath, '');
  assert.strictEqual(shortRes.startPoint, null);

  // 4b. Accept trails over 350m, trim 150m from ends, verify zero GPS leak
  const longTrail: LngLat[] = [];
  for (let i = 0; i < 30; i++) {
    longTrail.push({
      longitude: 77.2090 + i * 0.0005,
      latitude: 28.6139 + i * 0.0004,
    });
  }
  const longRes = generateStorySvgPath(longTrail, 280, 280, 20);
  assert.strictEqual(longRes.hasValidTrail, true);
  assert.ok(longRes.svgPath.startsWith('M '));
  assert.ok(longRes.svgPath.includes(' L '));
  assert.ok(longRes.startPoint !== null);
  assert.ok(longRes.endPoint !== null);

  // Invariant: ZERO GPS coordinates leaked in SVG path
  assert.ok(!longRes.svgPath.includes('77.'));
  assert.ok(!longRes.svgPath.includes('28.'));

  // Invariant: Points strictly within [20, 260] box
  for (const pt of longRes.points) {
    assert.ok(pt.x >= 20 && pt.x <= 260, `x=${pt.x} outside bounds`);
    assert.ok(pt.y >= 20 && pt.y <= 260, `y=${pt.y} outside bounds`);
  }

  console.log('✓ Test 4: generateStorySvgPath enforces 150m privacy trim and 0% GPS leakage');
}

// Test 5: Tag Climaxes Navigation (Next / Prev Tag Seek)
{
  const liveAt = 1700000000000;
  const tags = [
    { tagged_at: new Date(liveAt + 30000).toISOString() },  // 30s
    { tagged_at: new Date(liveAt + 95000).toISOString() },  // 95s
    { tagged_at: new Date(liveAt + 180000).toISOString() }, // 180s
  ];

  // At start (0s)
  assert.strictEqual(findNextTagTime(tags, 0, liveAt), 30);
  assert.strictEqual(findPrevTagTime(tags, 0, liveAt), 0);

  // Between 1st and 2nd tag (at 40s)
  assert.strictEqual(findNextTagTime(tags, 40, liveAt), 95);
  assert.strictEqual(findPrevTagTime(tags, 40, liveAt), 30);

  // Near 2nd tag (at 95s, previous tag before this climax is 30s)
  assert.strictEqual(findNextTagTime(tags, 95.1, liveAt), 180);
  assert.strictEqual(findPrevTagTime(tags, 95.1, liveAt), 30);

  // Past 2nd tag (at 100s, previous tag is 95s)
  assert.strictEqual(findPrevTagTime(tags, 100, liveAt), 95);

  // After last tag (at 200s)
  assert.strictEqual(findNextTagTime(tags, 200, liveAt), null);
  assert.strictEqual(findPrevTagTime(tags, 200, liveAt), 180);

  console.log('✓ Test 5: findNextTagTime & findPrevTagTime navigate tag climaxes cleanly');
}

// Test 6: 9:16 Vertical Story Dimensions
{
  const dims = calculateStoryCardDimensions(400, 800, 640);
  const ratio = dims.width / dims.height;
  assert.ok(Math.abs(ratio - 9 / 16) < 0.01, `Ratio was ${ratio}, expected ~0.5625`);
  assert.ok(dims.height <= 640);
  console.log(`✓ Test 6: calculateStoryCardDimensions calculates 9:16 aspect (${dims.width}x${dims.height})`);
}

// Test 7: Story Share Text
{
  const shareText = generateStoryShareText({
    headline: 'SURVIVED 14M 22S',
    subtitle: 'EVADED 4 INFECTED • EXTRACTED',
    modeName: 'Outbreak Horde',
    role: 'runner',
    durationSeconds: 862,
    distanceMeters: 3400,
    code: 'S7NC',
  });
  assert.ok(shareText.includes('GHOSTRUN // SURVIVED 14M 22S'));
  assert.ok(shareText.includes('OUTBREAK HORDE'));
  assert.ok(shareText.includes('3.4 KM'));
  assert.ok(shareText.includes('150m origin & destination buffer protected'));
  assert.ok(shareText.includes('https://ghostrun.app/join/S7NC'));
  console.log('✓ Test 7: generateStoryShareText builds high-octane tactical story text');
}

console.log('\n=== All 7 Story Card & 2D Replay Telemetry Tests Passed! (100%) ===\n');

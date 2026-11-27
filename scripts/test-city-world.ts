import assert from 'node:assert';
import {
  buildTurfHexFeature,
  computeSectorKey,
  computeTurfZoneKey,
  evaluateBountyScore,
} from '../src/lib/cityWorldCore';

console.log('=== GhostRun v4.0 City World Unit Tests ===\n');

// Test 1: Deterministic sector & turf zone keys
{
  assert.strictEqual(computeSectorKey(19.1604, 72.8422), '19.16_72.84');
  assert.strictEqual(computeTurfZoneKey(19.1604, 72.8422), 'turf_19.160_72.842');
  console.log('PASS Test 1: Sector and Turf Zone grid keys match Postgres format');
}

// Test 2: Turf Hex GeoJSON polygon geometry
{
  const feat = buildTurfHexFeature({
    zone_key: 'turf_19.160_72.842',
    latitude: 19.16,
    longitude: 72.842,
    owner_name: 'ALPHA SQUAD',
    owner_color: '#C8FF00',
    owner_crew_id: 'crew-1',
    control_score: 4800,
    captured_at: new Date().toISOString(),
  });
  assert.strictEqual(feat.type, 'Feature');
  assert.strictEqual(feat.geometry.type, 'Polygon');
  assert.strictEqual(feat.geometry.coordinates[0].length, 7);
  assert.deepStrictEqual(feat.geometry.coordinates[0][0], feat.geometry.coordinates[0][6]);
  console.log('PASS Test 2: Closed 6-vertex GeoJSON Hex polygon generated cleanly');
}

// Test 3: Bounty scoring & Echo PTS rewards
{
  const bullseye = evaluateBountyScore({
    distanceM: 3.2,
    targetHeading: 45,
    submissionHeading: 47,
  });
  assert.ok(bullseye.score >= 4990 && bullseye.score <= 5000);
  assert.strictEqual(bullseye.echoPts, 100);

  const far = evaluateBountyScore({
    distanceM: 600,
    targetHeading: 0,
    submissionHeading: 180,
  });
  assert.strictEqual(far.score, 0);
  assert.strictEqual(far.echoPts, 25);
  console.log('PASS Test 3: Bounty scoring and Echo PTS thresholds verified');
}

console.log('\nAll 3 City World test suites passed cleanly!');

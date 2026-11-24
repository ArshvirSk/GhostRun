import assert from 'node:assert';
import {
  interpolatePlayerPosition,
  buildVelocityVector,
  buildVelocityVectorFeatures,
  formatCompassHeading,
  formatTacticalSpeed,
  extractReplayClimaxes,
  findNearestClimaxEvent,
  RawTrailPoint,
} from '../src/lib/replayKinematicsCore';
import { distanceM } from '../src/lib/geo';

console.log('--- Testing Replay Kinematics & Tactical Velocity Vectors ---');

// Test 1: 16-Point Cardinal Heading Formatting
{
  assert.strictEqual(formatCompassHeading(0), 'N (000°)');
  assert.strictEqual(formatCompassHeading(45), 'NE (045°)');
  assert.strictEqual(formatCompassHeading(90), 'E (090°)');
  assert.strictEqual(formatCompassHeading(180), 'S (180°)');
  assert.strictEqual(formatCompassHeading(270), 'W (270°)');
  assert.strictEqual(formatCompassHeading(315), 'NW (315°)');
  console.log('✓ Test 1: formatCompassHeading accurately maps azimuths to 16-point cardinal format');
}

// Test 2: Tactical Speed Formatting
{
  assert.strictEqual(formatTacticalSpeed(0.1), 'STATIONARY');
  assert.strictEqual(formatTacticalSpeed(0.35), 'STATIONARY');
  assert.strictEqual(formatTacticalSpeed(4.0), '4.0 m/s (14.4 km/h)');
  assert.strictEqual(formatTacticalSpeed(7.5), '7.5 m/s (27.0 km/h)');
  console.log('✓ Test 2: formatTacticalSpeed classifies stationary deadband and formats km/h');
}

// Test 3: Trajectory Position & Kinematic Interpolation
{
  const points: RawTrailPoint[] = [
    {
      player_id: 'p1',
      latitude: 37.7749,
      longitude: -122.4194,
      recorded_at: '2026-11-24T12:00:00.000Z',
    },
    {
      player_id: 'p1',
      latitude: 37.7758, // North ~100m
      longitude: -122.4194,
      recorded_at: '2026-11-24T12:00:20.000Z', // 20 seconds later (~5.0 m/s)
    },
  ];

  const t0 = Date.parse('2026-11-24T12:00:00.000Z');
  const t1 = Date.parse('2026-11-24T12:00:20.000Z');

  // Exact start
  const start = interpolatePlayerPosition(points, t0);
  assert.ok(start);
  assert.strictEqual(start.latitude, 37.7749);
  assert.strictEqual(start.isInterpolated, false);

  // Exact midpoint (t = 10s)
  const mid = interpolatePlayerPosition(points, t0 + 10000);
  assert.ok(mid);
  assert.strictEqual(mid.isInterpolated, true);
  // Latitude should be halfway: (37.7749 + 37.7758) / 2 = 37.77535
  assert.ok(Math.abs(mid.latitude - 37.77535) < 0.00001);
  assert.strictEqual(mid.longitude, -122.4194);
  // Heading North = 0 deg
  assert.ok(mid.headingDeg < 1 || mid.headingDeg > 359);
  // Speed ~5 m/s
  assert.ok(mid.speedMps >= 4.9 && mid.speedMps <= 5.1, `Expected speed ~5 m/s, got ${mid.speedMps}`);

  // Exact end
  const end = interpolatePlayerPosition(points, t1);
  assert.ok(end);
  assert.strictEqual(end.latitude, 37.7758);
  assert.strictEqual(end.isInterpolated, false);

  console.log('✓ Test 3: interpolatePlayerPosition calculates precise intermediate coordinates, heading, and speed');
}

// Test 4: Velocity Vector Projection & Suppression
{
  // Stationary operative
  const stationaryOp = {
    playerId: 'op1',
    color: '#00F0FF',
    latitude: 37.7749,
    longitude: -122.4194,
    headingDeg: 45,
    speedMps: 0.3,
    isTagged: false,
  };
  const stationaryVec = buildVelocityVector(stationaryOp);
  assert.strictEqual(stationaryVec, null, 'Stationary operative must not project velocity vector');

  // Tagged operative
  const taggedOp = {
    playerId: 'op2',
    color: '#EF4444',
    latitude: 37.7749,
    longitude: -122.4194,
    headingDeg: 90,
    speedMps: 4.5,
    isTagged: true,
  };
  const taggedVec = buildVelocityVector(taggedOp);
  assert.strictEqual(taggedVec, null, 'Tagged operative must not project velocity vector');

  // Moving operative (4.0 m/s heading East 90°)
  const movingOp = {
    playerId: 'op3',
    color: '#10B981',
    latitude: 37.7749,
    longitude: -122.4194,
    headingDeg: 90,
    speedMps: 4.0,
    isTagged: false,
  };
  const vec = buildVelocityVector(movingOp);
  assert.ok(vec);
  assert.strictEqual(vec.playerId, 'op3');
  // Vector length should be min(22, max(6, 4.0 * 2.2)) = 8.8m
  assert.strictEqual(vec.lengthM, 8.8);
  // Tip should be east of origin
  assert.ok(vec.tip.longitude > vec.origin.longitude);
  assert.ok(Math.abs(vec.tip.latitude - vec.origin.latitude) < 0.0001);

  // GeoJSON features
  const features = buildVelocityVectorFeatures([vec]);
  assert.strictEqual(features.lines.length, 1);
  assert.strictEqual(features.tips.length, 1);
  assert.strictEqual(features.lines[0].geometry.type, 'LineString');
  assert.strictEqual(features.tips[0].geometry.type, 'Point');

  console.log('✓ Test 4: buildVelocityVector generates directional radar vectors and suppresses stationary/tagged states');
}

// Test 5: Replay Climax Extraction & Nearest Event Lookup
{
  const liveAtMs = Date.parse('2026-11-24T12:00:00.000Z');
  const durationS = 180;
  const tags = [
    {
      id: 101,
      hunter_name: 'Viper',
      runner_name: 'Ghost',
      distance_m: 14.5,
      tagged_at: '2026-11-24T12:01:30.000Z', // t = 90s
    },
  ];
  const tagCoords = new Map([[101, { longitude: -122.419, latitude: 37.775 }]]);
  const target = { longitude: -122.415, latitude: 37.779 };

  const climaxes = extractReplayClimaxes({
    liveAtMs,
    durationS,
    tags,
    tagCoords,
    target,
    winner: 'runners',
    endReason: 'extraction_complete',
  });

  assert.strictEqual(climaxes.length, 2);
  assert.strictEqual(climaxes[0].kind, 'tag');
  assert.strictEqual(climaxes[0].atSecond, 90);
  assert.strictEqual(climaxes[1].kind, 'extraction');
  assert.strictEqual(climaxes[1].atSecond, 180);

  // Climax nearest lookup
  const nearTag = findNearestClimaxEvent(climaxes, 91.5, 4.0);
  assert.ok(nearTag);
  assert.strictEqual(nearTag.id, 'tag-101');

  const noClimax = findNearestClimaxEvent(climaxes, 30.0, 4.0);
  assert.strictEqual(noClimax, null);

  console.log('✓ Test 5: extractReplayClimaxes indexes climax events and supports vicinity snaps');
}

console.log('\nAll 5 Replay Kinematics & Velocity Vector tests passed (100%)!\n');

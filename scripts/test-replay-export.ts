import assert from 'node:assert';
import {
  buildReplayFrames,
  normalizePathToViewport,
} from '../src/lib/replayExportCore';
import type { LngLat } from '../src/lib/geo';

console.log('--- Testing NF-27: Replay Trail Animation & Video Export ---');

// Test 1: Consent C3 rejection
{
  const path: LngLat[] = [
    { longitude: -122.4194, latitude: 37.7749 },
    { longitude: -122.419, latitude: 37.779 },
  ];
  const res = buildReplayFrames(path, 300, false); // C3 = false
  assert.strictEqual(res.allowed, false);
  assert.ok(res.reason?.includes('Consent C3'));
  assert.strictEqual(res.totalFrames, 0);
  console.log('✓ Test 1: buildReplayFrames strictly rejects export when Consent C3 is false');
}

// Test 2: Distance guard rejection (< 350m)
{
  // Path of ~100m
  const shortPath: LngLat[] = [
    { longitude: -122.4194, latitude: 37.7749 },
    { longitude: -122.4194, latitude: 37.7758 },
  ];
  const res = buildReplayFrames(shortPath, 60, true);
  assert.strictEqual(res.allowed, false);
  assert.ok(res.reason?.includes('too short'));
  console.log('✓ Test 2: buildReplayFrames rejects trails under 350m to prevent pinpointing origin/destination');
}

// Test 3: Valid route animation generation
{
  // 1 km long path
  const validPath: LngLat[] = [];
  for (let i = 0; i < 20; i++) {
    validPath.push({
      longitude: -122.4194 + i * 0.0005,
      latitude: 37.7749 + i * 0.0004,
    });
  }

  const res = buildReplayFrames(validPath, 450, true, 15, { width: 500, height: 500 });
  assert.strictEqual(res.allowed, true);
  assert.strictEqual(res.totalFrames, 15);
  assert.strictEqual(res.frames.length, 15);

  // Check first frame and last frame
  assert.strictEqual(res.frames[0].frameIndex, 0);
  assert.strictEqual(res.frames[0].timeSec, 0);
  assert.strictEqual(res.frames[14].frameIndex, 14);
  assert.strictEqual(res.frames[14].timeSec, 450);

  // Check SVG output
  assert.ok(res.svgAnimationMarkup);
  assert.ok(res.svgAnimationMarkup.includes('<svg'));
  assert.ok(res.svgAnimationMarkup.includes('<polyline'));

  // Ensure ZERO GPS coordinates leaked
  assert.ok(!res.svgAnimationMarkup.includes('-122.'));
  assert.ok(!res.svgAnimationMarkup.includes('37.77'));
  console.log('✓ Test 3: buildReplayFrames produces privacy-trimmed animated keyframes and SVG markup without GPS leak');
}

// Test 4: normalizePathToViewport bounds
{
  const pts: LngLat[] = [
    { longitude: 10, latitude: 20 },
    { longitude: 12, latitude: 25 },
  ];
  const norm = normalizePathToViewport(pts, 400, 400, 20);
  assert.strictEqual(norm.length, 2);
  assert.ok(norm[0].x >= 20 && norm[0].x <= 380);
  assert.ok(norm[0].y >= 20 && norm[0].y <= 380);
  assert.ok(norm[1].x >= 20 && norm[1].x <= 380);
  assert.ok(norm[1].y >= 20 && norm[1].y <= 380);
  console.log('✓ Test 4: normalizePathToViewport strictly contains relative points within viewport bounds');
}

console.log('\nAll 4 NF-27 replay video export tests passed successfully!\n');

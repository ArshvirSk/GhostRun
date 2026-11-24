import assert from 'node:assert';
import {
  createBlackboxSession,
  appendBlackboxFix,
  appendBlackboxEvent,
  finalizeBlackboxSession,
  serializeBlackboxToJsonl,
  parseBlackboxFromJsonl,
  validateBlackboxSession,
} from '../src/lib/blackboxCore';

console.log('--- Testing Field Blackbox Telemetry Engine ---');

// Test 1: Session lifecycle
{
  const session = createBlackboxSession({
    gameId: 'TEST-1234',
    modeId: 'classic_chase',
    callsign: 'Viper',
    role: 'runner',
    initialBatteryLevel: 0.95,
  });

  assert.strictEqual(session.gameId, 'TEST-1234');
  assert.strictEqual(session.callsign, 'Viper');
  assert.strictEqual(session.fixes.length, 0);
  assert.strictEqual(session.events.length, 1);
  assert.strictEqual(session.events[0].type, 'match_start');

  // Append fixes
  const now = Date.now();
  appendBlackboxFix(session, {
    timestamp: now,
    lat: 37.7749,
    lng: -122.4194,
    accuracy: 3.5,
    speed: 3.2,
    heading: 90,
  });
  appendBlackboxFix(session, {
    timestamp: now + 5000,
    lat: 37.7751,
    lng: -122.4191,
    accuracy: 4.0,
    speed: 3.8,
    heading: 85,
  });

  // Append event
  appendBlackboxEvent(session, {
    timestamp: now + 2500,
    type: 'ping_received',
    payload: { source: 'hunter', distanceM: 45 },
  });

  // Finalize
  finalizeBlackboxSession(session);
  assert.strictEqual(session.fixes.length, 2);
  assert.strictEqual(session.events.length, 3); // start, ping, end
  assert.ok(session.endedAt !== undefined);
  console.log('✓ Test 1: Session lifecycle records fixes, events, and timestamps accurately');
}

// Test 2: JSONL Serialization & Round-Trip Parsing
{
  const session = createBlackboxSession({
    gameId: 'DELTA-99',
    modeId: 'blackout_radar',
    callsign: 'Spectre',
    role: 'hunter',
  });

  const baseTime = 1700000000000;
  for (let i = 0; i < 5; i++) {
    appendBlackboxFix(session, {
      timestamp: baseTime + i * 2000,
      lat: 40.7128 + i * 0.0001,
      lng: -74.006 + i * 0.0001,
      accuracy: 3.0,
      speed: 4.2,
      heading: 45,
      batteryLevel: 0.88 - i * 0.01,
    });
  }

  appendBlackboxEvent(session, {
    timestamp: baseTime + 3000,
    type: 'deadband_hold',
    payload: { wanderDistanceM: 1.2 },
  });

  finalizeBlackboxSession(session);

  // Serialize to JSONL
  const jsonl = serializeBlackboxToJsonl(session);
  assert.ok(typeof jsonl === 'string');
  const lines = jsonl.split('\n');
  assert.strictEqual(lines.length, 9); // 1 header + 5 fixes + 3 events (start, deadband, end)

  // Round-trip parse
  const parsed = parseBlackboxFromJsonl(jsonl);
  assert.strictEqual(parsed.gameId, 'DELTA-99');
  assert.strictEqual(parsed.modeId, 'blackout_radar');
  assert.strictEqual(parsed.callsign, 'Spectre');
  assert.strictEqual(parsed.fixes.length, 5);
  assert.strictEqual(parsed.events.length, 3);
  assert.strictEqual(parsed.fixes[0].speed, 4.2);
  assert.strictEqual(parsed.events[0].type, 'match_start');
  console.log('✓ Test 2: JSONL serialization preserves lossless round-trip telemetry');
}

// Test 3: Session Validation
{
  const session = createBlackboxSession({
    gameId: 'VAL-01',
    modeId: 'pinpoint',
    callsign: 'HunterOne',
    role: 'hunter',
  });

  const t0 = Date.now();
  appendBlackboxFix(session, {
    timestamp: t0,
    lat: 10,
    lng: 10,
    accuracy: 3,
    speed: 0,
    heading: 0,
  });
  appendBlackboxFix(session, {
    timestamp: t0 + 60000,
    lat: 10.001,
    lng: 10.001,
    accuracy: 4,
    speed: 2.5,
    heading: 45,
  });

  const val = validateBlackboxSession(session);
  assert.strictEqual(val.valid, true);
  assert.strictEqual(val.fixCount, 2);
  assert.strictEqual(val.durationSeconds, 60);
  console.log('✓ Test 3: validateBlackboxSession computes duration and telemetry integrity');
}

console.log('\nAll 3 Blackbox Telemetry tests passed successfully!\n');

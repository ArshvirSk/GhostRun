import assert from 'node:assert';
import {
  getEventChannelTopic,
  validateEventConfig,
  SpectatorStreamBuffer,
} from '../src/lib/eventModeCore';

console.log('--- Testing NF-23: Event Mode for Large Scale Operations ---');

// Test 1: getEventChannelTopic
{
  assert.strictEqual(getEventChannelTopic('game-99', 'runners'), 'event:game-99:runners');
  assert.strictEqual(getEventChannelTopic('game-99', 'hunters'), 'event:game-99:hunters');
  assert.strictEqual(getEventChannelTopic('game-99', 'spectators_delayed'), 'event:game-99:spectators_delayed');
  console.log('✓ Test 1: getEventChannelTopic isolates team broadcast namespaces cleanly');
}

// Test 2: validateEventConfig
{
  const emptyRes = validateEventConfig({ gameId: '' });
  assert.strictEqual(emptyRes.valid, false, 'Empty gameId must fail');

  const overCapacityRes = validateEventConfig({ gameId: 'g1', maxPlayers: 200 });
  assert.strictEqual(overCapacityRes.valid, false, 'Capacity over 150 players must fail');

  const lowDelayRes = validateEventConfig({ gameId: 'g1', spectatorDelaySeconds: 15 });
  assert.strictEqual(lowDelayRes.valid, false, 'Spectator delay under 30s must fail');

  const validRes = validateEventConfig({
    gameId: 'tournament-2026',
    maxPlayers: 100,
    spectatorDelaySeconds: 60,
  });
  assert.strictEqual(validRes.valid, true, 'Valid 100-player event config must pass');
  console.log('✓ Test 2: validateEventConfig enforces capacity bounds and spectator delay thresholds');
}

// Test 3: SpectatorStreamBuffer - Delay Window
{
  const buffer = new SpectatorStreamBuffer<{ id: string }>(60); // 60s delay
  const t0 = 1000000;

  buffer.push({ id: 'frame-1' }, t0);
  buffer.push({ id: 'frame-2' }, t0 + 10000); // 10s later

  // At t0 + 30s: nothing should drain yet
  const ready30 = buffer.drainReady(t0 + 30000);
  assert.strictEqual(ready30.length, 0);
  assert.strictEqual(buffer.getPendingCount(), 2);

  // At t0 + 65s: frame-1 (age 65s) is ready; frame-2 (age 55s) is not
  const ready65 = buffer.drainReady(t0 + 65000);
  assert.strictEqual(ready65.length, 1);
  assert.strictEqual(ready65[0].id, 'frame-1');
  assert.strictEqual(buffer.getPendingCount(), 1);

  // At t0 + 75s: frame-2 (age 65s) is ready
  const ready75 = buffer.drainReady(t0 + 75000);
  assert.strictEqual(ready75.length, 1);
  assert.strictEqual(ready75[0].id, 'frame-2');
  assert.strictEqual(buffer.getPendingCount(), 0);

  console.log('✓ Test 3: SpectatorStreamBuffer holds and drains telemetry accurately according to delay window');
}

console.log('\nAll 3 NF-23 event mode tests passed successfully!\n');

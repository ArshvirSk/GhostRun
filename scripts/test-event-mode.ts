import assert from 'node:assert';
import {
  getEventChannelTopic,
  validateEventConfig,
  isReferee,
  canRefereePerformAction,
  buildEventLeaderboard,
  calculateEventCapacityMetrics,
  SpectatorStreamBuffer,
} from '../src/lib/eventModeCore';

console.log('--- Testing NF-23: Event Mode for Large Scale Operations ---');

// Test 1: getEventChannelTopic
{
  assert.strictEqual(getEventChannelTopic('game-99', 'runners'), 'event:game-99:runners');
  assert.strictEqual(getEventChannelTopic('game-99', 'hunters'), 'event:game-99:hunters');
  assert.strictEqual(getEventChannelTopic('game-99', 'referees'), 'event:game-99:referees');
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

// Test 3: Referee authorization
{
  const refList = ['user-ref-1', 'user-ref-2'];
  assert.strictEqual(isReferee('user-ref-1', refList), true, 'Identifies registered referee');
  assert.strictEqual(isReferee('user-player', refList), false, 'Normal player is not referee');

  assert.strictEqual(canRefereePerformAction('pause', true), true, 'Referee authorized to pause');
  assert.strictEqual(canRefereePerformAction('pause', false), false, 'Non-referee rejected');
  assert.strictEqual(canRefereePerformAction('emergency_stop', true), true, 'Referee authorized to emergency stop');
  console.log('✓ Test 3: Referee role validation and command authorization verified');
}

// Test 4: Leaderboard builder
{
  const rawPlayers = [
    { id: 'p1', name: 'GhostAlpha', team: 'runner', score: 3200, status: 'evaded' },
    { id: 'p2', name: 'ApexHunter', team: 'hunter', score: 4800, status: 'active' },
    { id: 'p3', name: 'ShadowBravo', team: 'runner', score: 1200, status: 'tagged' },
  ];
  const leaderboard = buildEventLeaderboard(rawPlayers);
  assert.strictEqual(leaderboard[0].name, 'ApexHunter', 'Top scorer ranked #1');
  assert.strictEqual(leaderboard[0].rank, 1);
  assert.strictEqual(leaderboard[1].name, 'GhostAlpha', 'Second scorer ranked #2');
  assert.strictEqual(leaderboard[1].rank, 2);
  assert.strictEqual(leaderboard[2].name, 'ShadowBravo', 'Lowest scorer ranked #3');
  assert.strictEqual(leaderboard[2].rank, 3);
  console.log('✓ Test 4: buildEventLeaderboard ranks players accurately by score descending');
}

// Test 5: Event capacity metrics
{
  const metrics = calculateEventCapacityMetrics(75, 100);
  assert.strictEqual(metrics.availableSlots, 25, '75/100 leaves 25 slots');
  assert.strictEqual(metrics.isFull, false, 'Not full');
  assert.strictEqual(metrics.utilizationPercent, 75, '75% utilization');

  const fullMetrics = calculateEventCapacityMetrics(100, 100);
  assert.strictEqual(fullMetrics.availableSlots, 0);
  assert.strictEqual(fullMetrics.isFull, true);
  console.log('✓ Test 5: calculateEventCapacityMetrics calculates slot occupancy and full state');
}

// Test 6: SpectatorStreamBuffer - Delay Window
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

  console.log('✓ Test 6: SpectatorStreamBuffer holds and drains telemetry accurately according to delay window');
}

console.log('\nAll 6 NF-23 event mode tests passed successfully!\n');

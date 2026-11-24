import assert from 'node:assert';
import {
  packWatchMessage,
  unpackWatchMessage,
  validateWatchCommand,
  calculateRadarClockHour,
  getHapticPulseVibrationPattern,
  formatWatchHudTimeRemaining,
  buildWatchHudPayload,
  WatchHudUpdatePayload,
} from '../src/lib/wearOsProtocolCore';

console.log('--- Testing NF-24: Wear OS Companion Protocol ---');

// Test 1: packWatchMessage
{
  const hudPayload: WatchHudUpdatePayload = {
    role: 'runner',
    status: 'active',
    timeRemainingSec: 420,
    nearestDistanceM: 28,
    radarClockHour: 3,
  };

  const packed = packWatchMessage('HUD_UPDATE', hudPayload);
  assert.ok(typeof packed === 'string');
  assert.ok(packed.includes('"version":1'));
  assert.ok(packed.includes('"type":"HUD_UPDATE"'));
  assert.ok(packed.includes('"timeRemainingSec":420'));
  console.log('✓ Test 1: packWatchMessage packs version 1 transmission payload correctly');
}

// Test 2: unpackWatchMessage - Valid and invalid
{
  const packed = packWatchMessage('TRIGGER_SOS', { confirmed: true });
  const unpacked = unpackWatchMessage(packed);

  assert.strictEqual(unpacked.valid, true);
  assert.strictEqual(unpacked.message?.type, 'TRIGGER_SOS');
  assert.strictEqual(unpacked.message?.payload.confirmed, true);

  const broken = unpackWatchMessage('{ invalid: json');
  assert.strictEqual(broken.valid, false);

  const badVersion = unpackWatchMessage(JSON.stringify({ version: 2, type: 'TEST', timestamp: 123 }));
  assert.strictEqual(badVersion.valid, false);
  console.log('✓ Test 2: unpackWatchMessage strictly parses valid packets and rejects corrupt frames');
}

// Test 3: validateWatchCommand
{
  const sosMsg = unpackWatchMessage(packWatchMessage('TRIGGER_SOS', {})).message!;
  assert.strictEqual(validateWatchCommand(sosMsg), true);

  const checkinMsg = unpackWatchMessage(packWatchMessage('CHECKIN_CONFIRM', {})).message!;
  assert.strictEqual(validateWatchCommand(checkinMsg), true);

  const radioMsg = unpackWatchMessage(packWatchMessage('QUICK_RADIO', { chipId: 'hunter_nearby' })).message!;
  assert.strictEqual(validateWatchCommand(radioMsg), true);

  const invalidRadio = unpackWatchMessage(packWatchMessage('QUICK_RADIO', {})).message!;
  assert.strictEqual(validateWatchCommand(invalidRadio), false);

  const hudMsg = unpackWatchMessage(packWatchMessage('HUD_UPDATE', {})).message!;
  assert.strictEqual(validateWatchCommand(hudMsg), false);
  console.log('✓ Test 3: validateWatchCommand authorizes safety check-ins, SOS, and radio chips');
}

// Test 4: calculateRadarClockHour
{
  assert.strictEqual(calculateRadarClockHour(0), 12, '0 deg is 12 o clock');
  assert.strictEqual(calculateRadarClockHour(360), 12, '360 deg is 12 o clock');
  assert.strictEqual(calculateRadarClockHour(355), 12, '355 deg rounds to 12 o clock');
  assert.strictEqual(calculateRadarClockHour(90), 3, '90 deg is 3 o clock (East)');
  assert.strictEqual(calculateRadarClockHour(180), 6, '180 deg is 6 o clock (South)');
  assert.strictEqual(calculateRadarClockHour(270), 9, '270 deg is 9 o clock (West)');
  assert.strictEqual(calculateRadarClockHour(-90), 9, 'Negative bearing normalizes correctly');
  console.log('✓ Test 4: calculateRadarClockHour maps bearings to 12-hour watch dial');
}

// Test 5: getHapticPulseVibrationPattern
{
  assert.deepStrictEqual(getHapticPulseVibrationPattern('ping'), [0, 150]);
  assert.deepStrictEqual(getHapticPulseVibrationPattern('hunter_close'), [0, 300, 100, 300]);
  assert.deepStrictEqual(getHapticPulseVibrationPattern('tag_confirm'), [0, 500]);
  assert.deepStrictEqual(getHapticPulseVibrationPattern('sos'), [0, 500, 200, 500, 200, 500]);
  console.log('✓ Test 5: getHapticPulseVibrationPattern returns dedicated wearable haptic cadences');
}

// Test 6: formatWatchHudTimeRemaining & buildWatchHudPayload
{
  assert.strictEqual(formatWatchHudTimeRemaining(754), '12:34');
  assert.strictEqual(formatWatchHudTimeRemaining(45), '0:45');
  assert.strictEqual(formatWatchHudTimeRemaining(0), '0:00');

  const hud = buildWatchHudPayload({
    role: 'runner',
    status: 'active',
    timeRemainingSec: 125,
    nearestDistanceM: 34.8,
    bearingDegrees: 92,
    isLowPowerMode: true,
  });
  assert.strictEqual(hud.radarClockHour, 3, 'Bearing 92 deg maps to 3 o clock');
  assert.strictEqual(hud.nearestDistanceM, 35, 'Rounds nearest distance to integer');
  assert.strictEqual(hud.isLowPowerMode, true, 'Preserves low-power OLED mode');
  console.log('✓ Test 6: formatWatchHudTimeRemaining & buildWatchHudPayload format wrist HUD data');
}

console.log('\nAll 6 NF-24 Wear OS protocol tests passed successfully!\n');

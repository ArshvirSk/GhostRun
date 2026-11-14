import assert from 'node:assert';
import {
  packWatchMessage,
  unpackWatchMessage,
  validateWatchCommand,
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

console.log('\nAll 3 NF-24 Wear OS protocol tests passed successfully!\n');

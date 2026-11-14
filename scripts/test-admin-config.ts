import assert from 'node:assert';
import {
  DEFAULT_REMOTE_CONFIG,
  isVersionSupported,
  isModeDisabled,
} from '../src/lib/adminCore';

console.log('--- Testing NF-26: Admin Console & Remote Config Engine ---');

// Test 1: DEFAULT_REMOTE_CONFIG Keys
{
  assert.ok('disabled_modes' in DEFAULT_REMOTE_CONFIG);
  assert.ok('min_app_version' in DEFAULT_REMOTE_CONFIG);
  assert.ok('push_notifications_enabled' in DEFAULT_REMOTE_CONFIG);
  assert.ok('scheduled_games_enabled' in DEFAULT_REMOTE_CONFIG);
  console.log('✓ Test 1: DEFAULT_REMOTE_CONFIG provides standard kill-switches and version gates');
}

// Test 2: isVersionSupported
{
  assert.strictEqual(isVersionSupported('2.7.4', '2.7.0'), true, 'Higher minor version must pass');
  assert.strictEqual(isVersionSupported('2.7.0', '2.7.0'), true, 'Exact version must pass');
  assert.strictEqual(isVersionSupported('2.6.9', '2.7.0'), false, 'Lower minor version must fail');
  assert.strictEqual(isVersionSupported('3.0.0', '2.8.5'), true, 'Higher major version must pass');
  assert.strictEqual(isVersionSupported('1.9.9', '2.0.0'), false, 'Lower major version must fail');
  console.log('✓ Test 2: isVersionSupported evaluates semantic version boundaries accurately');
}

// Test 3: isModeDisabled
{
  const disabled = ['horde', 'haunted_map'];
  assert.strictEqual(isModeDisabled('horde', disabled), true);
  assert.strictEqual(isModeDisabled('haunted_map', disabled), true);
  assert.strictEqual(isModeDisabled('classic_chase', disabled), false);
  assert.strictEqual(isModeDisabled('tag_hunt', []), false);
  assert.strictEqual(isModeDisabled('tag_hunt', null as any), false);
  console.log('✓ Test 3: isModeDisabled correctly evaluates active vs disabled modes');
}

console.log('\nAll 3 NF-26 admin config tests passed successfully!\n');

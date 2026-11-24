import assert from 'node:assert';
import {
  DEFAULT_REMOTE_CONFIG,
  isVersionSupported,
  isModeDisabled,
  validateRemoteConfigUpdate,
  formatSystemHealthSummary,
} from '../src/lib/adminCore';

console.log('--- Testing NF-26: Admin Console & Remote Config Engine ---');

// Test 1: DEFAULT_REMOTE_CONFIG Keys
{
  assert.ok('disabled_modes' in DEFAULT_REMOTE_CONFIG);
  assert.ok('min_app_version' in DEFAULT_REMOTE_CONFIG);
  assert.ok('push_notifications_enabled' in DEFAULT_REMOTE_CONFIG);
  assert.ok('scheduled_games_enabled' in DEFAULT_REMOTE_CONFIG);
  assert.strictEqual(DEFAULT_REMOTE_CONFIG.monetisation_enabled, false, 'Monetisation switch must be false by default');
  assert.strictEqual(DEFAULT_REMOTE_CONFIG.feature_event_mode, true);
  console.log('✓ Test 1: DEFAULT_REMOTE_CONFIG provides standard kill-switches, disabled monetisation switch, and version gates');
}

// Test 2: isVersionSupported
{
  assert.strictEqual(isVersionSupported('2.8.0', '2.7.0'), true, 'Higher minor version must pass');
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

// Test 4: validateRemoteConfigUpdate
{
  // Valid updates
  assert.strictEqual(validateRemoteConfigUpdate('monetisation_enabled', false).valid, true);
  assert.strictEqual(validateRemoteConfigUpdate('min_app_version', '2.8.1').valid, true);
  assert.strictEqual(validateRemoteConfigUpdate('disabled_modes', ['infection']).valid, true);
  assert.strictEqual(validateRemoteConfigUpdate('custom_flag', 123).valid, true);

  // Invalid updates
  assert.strictEqual(validateRemoteConfigUpdate('', true).valid, false, 'Empty key must fail');
  assert.strictEqual(validateRemoteConfigUpdate('min_app_version', 'invalid_ver').valid, false, 'Malformed version must fail');
  assert.strictEqual(validateRemoteConfigUpdate('monetisation_enabled', 'not_bool' as any).valid, false, 'Non-boolean value must fail');
  assert.strictEqual(validateRemoteConfigUpdate('disabled_modes', 'not_an_array' as any).valid, false, 'Non-array modes must fail');
  console.log('✓ Test 4: validateRemoteConfigUpdate enforces strict type and payload validation');
}

// Test 5: formatSystemHealthSummary
{
  const summary = formatSystemHealthSummary({
    total_users: 150,
    active_games: 5,
    total_reports: 0,
    active_push_tokens: 120,
    generated_at: '2026-11-24T23:00:00Z',
  });
  assert.ok(summary.includes('150 total users'));
  assert.ok(summary.includes('5 active games'));
  assert.ok(summary.includes('0 pending reports'));
  assert.ok(summary.includes('120 active push tokens'));
  assert.ok(!/[^\u0000-\u007F]/.test(summary), 'Summary must not contain unicode emojis');
  console.log('✓ Test 5: formatSystemHealthSummary formats operational telemetry cleanly without emojis');
}

console.log('\nAll 5 NF-26 admin config tests passed successfully!\n');

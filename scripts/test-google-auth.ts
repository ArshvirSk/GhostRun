import assert from 'node:assert';
import {
  isGoogleSignInConfigured,
  formatGoogleAuthError,
  parseOAuthRedirectUrl,
} from '../src/lib/googleAuthCore';

console.log('--- Testing Google Sign-In Architecture & Handlers ---');

// Test 1: Configuration check
{
  assert.strictEqual(isGoogleSignInConfigured(''), false, 'Empty client ID must report not configured');
  assert.strictEqual(isGoogleSignInConfigured('  '), false, 'Whitespace client ID must report not configured');
  assert.strictEqual(
    isGoogleSignInConfigured('123456789-abcdef.apps.googleusercontent.com'),
    true,
    'Valid web client ID must report configured'
  );
  console.log('✓ Test 1: isGoogleSignInConfigured handles empty and valid client IDs');
}

// Test 2: Error formatting
{
  assert.strictEqual(
    formatGoogleAuthError('SIGN_IN_CANCELLED'),
    'Sign in was cancelled.',
    'SIGN_IN_CANCELLED must format cleanly'
  );
  assert.strictEqual(
    formatGoogleAuthError('12501'),
    'Sign in was cancelled.',
    'Play services cancel code 12501 must format as cancelled'
  );
  assert.strictEqual(
    formatGoogleAuthError('PLAY_SERVICES_NOT_AVAILABLE'),
    'Google Play Services is not available or outdated on this device.',
    'PLAY_SERVICES_NOT_AVAILABLE must explain requirement'
  );
  assert.ok(
    formatGoogleAuthError(10, 'DEVELOPER_ERROR').includes('SHA-1'),
    'DEVELOPER_ERROR must mention SHA-1 certificate and Web Client ID'
  );
  assert.ok(
    formatGoogleAuthError(undefined, 'network error').includes('Network connection'),
    'Network error must explain connection issue'
  );
  console.log('✓ Test 2: formatGoogleAuthError maps codes to human actionable tactical copy');
}

// Test 3: OAuth redirect URL parsing (query code parameter)
{
  const testUrl = 'ghost-run://signin?code=auth-code-12345&state=xyz';
  const parsed = parseOAuthRedirectUrl(testUrl);
  assert.strictEqual(parsed.code, 'auth-code-12345', 'Extracts query code correctly');
  console.log('✓ Test 3: parseOAuthRedirectUrl extracts authorization code from query parameters');
}

// Test 4: OAuth redirect URL parsing (hash fragment token parameters)
{
  const testUrl = 'ghost-run://signin#access_token=token-abc&refresh_token=refresh-xyz&token_type=bearer';
  const parsed = parseOAuthRedirectUrl(testUrl);
  assert.strictEqual(parsed.accessToken, 'token-abc', 'Extracts hash access token');
  assert.strictEqual(parsed.refreshToken, 'refresh-xyz', 'Extracts hash refresh token');
  console.log('✓ Test 4: parseOAuthRedirectUrl extracts tokens from hash fragment parameters');
}

// Test 5: OAuth error parsing
{
  const testUrl = 'ghost-run://signin?error=access_denied&error_description=User+denied+access';
  const parsed = parseOAuthRedirectUrl(testUrl);
  assert.strictEqual(parsed.error, 'User denied access', 'Extracts decoded error description');
  console.log('✓ Test 5: parseOAuthRedirectUrl extracts and decodes OAuth errors');
}

console.log('\nAll 5 Google Sign-In unit tests passed successfully!');

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('--- Testing NF-19 (Website Gateway) & NF-21 (iOS Config) ---');

const ROOT = path.resolve(__dirname, '..');

// Test 1: public/index.html
{
  const filePath = path.join(ROOT, 'public', 'index.html');
  assert.ok(fs.existsSync(filePath), 'public/index.html must exist');
  const html = fs.readFileSync(filePath, 'utf-8');
  assert.ok(html.includes('GHOST'), 'Must contain GhostRun brand');
  assert.ok(html.includes('/safety'), 'Must link to safety');
  assert.ok(html.includes('/privacy'), 'Must link to privacy');
  assert.ok(html.includes('/support'), 'Must link to support');
  assert.ok(html.includes('/join'), 'Must link to join');
  console.log('✓ Test 1: public/index.html contains tactical landing and navigation links');
}

// Test 2: public/safety/index.html
{
  const filePath = path.join(ROOT, 'public', 'safety', 'index.html');
  assert.ok(fs.existsSync(filePath), 'public/safety/index.html must exist');
  const html = fs.readFileSync(filePath, 'utf-8');
  assert.ok(html.includes('18+'), 'Must state 18+ requirement');
  assert.ok(html.includes('Emergency SOS'), 'Must document SOS');
  assert.ok(html.includes('Road & Traffic Awareness'), 'Must document traffic safety');
  console.log('✓ Test 2: public/safety/index.html documents 18+ policy and road precautions');
}

// Test 3: public/privacy/index.html
{
  const filePath = path.join(ROOT, 'public', 'privacy', 'index.html');
  assert.ok(fs.existsSync(filePath), 'public/privacy/index.html must exist');
  const html = fs.readFileSync(filePath, 'utf-8');
  assert.ok(html.includes('150m'), 'Must document 150m privacy start/finish trimming');
  assert.ok(html.includes('Ephemeral Location'), 'Must explain ephemeral telemetry');
  assert.ok(html.includes('C1–C7'), 'Must reference consent choices');
  console.log('✓ Test 3: public/privacy/index.html documents privacy trimming and consent rights');
}

// Test 4: public/support/index.html
{
  const filePath = path.join(ROOT, 'public', 'support', 'index.html');
  assert.ok(fs.existsSync(filePath), 'public/support/index.html must exist');
  const html = fs.readFileSync(filePath, 'utf-8');
  assert.ok(html.includes('support@ghostrun.app'), 'Must provide official support email');
  console.log('✓ Test 4: public/support/index.html provides official operations contact');
}

// Test 5: Apple App Site Association
{
  const filePath = path.join(ROOT, 'public', '.well-known', 'apple-app-site-association');
  assert.ok(fs.existsSync(filePath), 'apple-app-site-association must exist');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  assert.ok(parsed.applinks, 'Must declare applinks section');
  assert.ok(parsed.applinks.details[0].appID.includes('com.ghostrun.app'), 'Must target com.ghostrun.app');
  assert.ok(parsed.applinks.details[0].paths.includes('/join/*'), 'Must match /join/* path');
  console.log('✓ Test 5: apple-app-site-association is valid JSON with /join Universal Links');
}

// Test 6: app.json iOS Configuration
{
  const appJsonPath = path.join(ROOT, 'app.json');
  const raw = fs.readFileSync(appJsonPath, 'utf-8');
  const appConfig = JSON.parse(raw);
  const ios = appConfig.expo.ios;

  assert.ok(ios, 'expo.ios must be configured');
  assert.strictEqual(ios.bundleIdentifier, 'com.ghostrun.app', 'bundleIdentifier must be com.ghostrun.app');
  assert.ok(ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription, 'Must provide background location usage string');
  assert.ok(ios.infoPlist.NSMotionUsageDescription, 'Must provide motion usage string');
  assert.ok(ios.infoPlist.UIBackgroundModes.includes('location'), 'Must declare background location mode');
  assert.ok(ios.associatedDomains.includes('applinks:ghostrun.app'), 'Must declare applinks domain');
  console.log('✓ Test 6: app.json declares production iOS entitlements, usage strings, and associated domains');
}

console.log('\nAll 6 NF-19 and NF-21 web & iOS tests passed successfully!\n');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatDistance, formatSpeed } from '../src/utils/units';

console.log('\n--- Route Resolution & Entry Points Verification ---');

const REQUIRED_ROUTES = [
  // Root & entry
  'app/index.tsx',
  'app/_layout.tsx',

  // Onboarding & Auth
  'app/(onboarding)/_layout.tsx',
  'app/(onboarding)/welcome.tsx',
  'app/(onboarding)/briefing.tsx',
  'app/(onboarding)/signin.tsx',
  'app/(onboarding)/reset-password.tsx',
  'app/(onboarding)/signup/name.tsx',
  'app/(onboarding)/signup/account.tsx',
  'app/(onboarding)/signup/code.tsx',
  'app/(onboarding)/signup/before-you-play.tsx',

  // Floating Tabs
  'app/(tabs)/_layout.tsx',
  'app/(tabs)/play.tsx',
  'app/(tabs)/modes.tsx',
  'app/(tabs)/you.tsx',

  // Host 5-Step Wizard
  'app/host/_layout.tsx',
  'app/host/mode.tsx',
  'app/host/rules.tsx',
  'app/host/extras.tsx',
  'app/host/area.tsx',
  'app/host/review.tsx',

  // Live Operations & Gameplay
  'app/join.tsx',
  'app/lobby/[id].tsx',
  'app/game/[id].tsx',
  'app/result/[id].tsx',
  'app/replay/[id].tsx',

  // Tactical Information & Settings
  'app/modes/[id].tsx',
  'app/how-to-play.tsx',
  'app/safety.tsx',
  'app/settings.tsx',
  'app/privacy.tsx',
  'app/debug/hud-gallery.tsx',

  // Back-compatibility redirect shims
  'app/home.tsx',
  'app/create.tsx',
  'app/target/[id].tsx',
  'app/auth.tsx',
  'app/onboarding.tsx',
];

const ROOT = path.resolve(__dirname, '..');

let passedChecks = 0;

// 1. Verify all routes exist on disk and have default exports
for (const relPath of REQUIRED_ROUTES) {
  const fullPath = path.join(ROOT, relPath);
  assert.ok(fs.existsSync(fullPath), `Route file missing: ${relPath}`);
  const content = fs.readFileSync(fullPath, 'utf8');
  assert.ok(
    content.includes('export default'),
    `Route ${relPath} missing export default React component`,
  );
  console.log(`PASS route exists with default export: ${relPath}`);
  passedChecks++;
}

// 2. Verify redirect shims point to valid canonical targets without cycles
const REDIRECT_SHIMS = [
  { file: 'app/home.tsx', target: '/play' },
  { file: 'app/create.tsx', target: '/host/mode' },
  { file: 'app/target/[id].tsx', target: '/lobby/[id]' },
  { file: 'app/onboarding.tsx', target: '/welcome' },
];

for (const shim of REDIRECT_SHIMS) {
  const fullPath = path.join(ROOT, shim.file);
  const content = fs.readFileSync(fullPath, 'utf8');
  assert.ok(
    content.includes(shim.target),
    `Redirect shim ${shim.file} does not target expected path ${shim.target}`,
  );
  // Ensure shim is not redirecting to itself
  assert.ok(
    !content.includes(`href={'${shim.file}'`),
    `Circular redirect detected in ${shim.file}`,
  );
  console.log(`PASS redirect shim clean and verified: ${shim.file} -> ${shim.target}`);
  passedChecks++;
}

// 3. Verify Units calibration helper across distances and unit modes
console.log('\n--- Unit Calibration & Distance Formatter Verification ---');

// Tag distance (<15m)
assert.equal(formatDistance(15, 'metric'), '15 m');
assert.equal(formatDistance(15, 'imperial'), '49 ft');
console.log('PASS tag radius 15m formats: 15 m / 49 ft');
passedChecks++;

// Perimeter radius (250m)
assert.equal(formatDistance(250, 'metric'), '250 m');
assert.equal(formatDistance(250, 'imperial'), '820 ft');
console.log('PASS perimeter radius 250m formats: 250 m / 820 ft');
passedChecks++;

// Macro radius (1500m)
assert.equal(formatDistance(1500, 'metric'), '1.5 km');
assert.equal(formatDistance(1500, 'imperial'), '0.9 mi');
console.log('PASS macro radius 1500m formats: 1.5 km / 0.9 mi');
passedChecks++;

// Speed guard (8 m/s vehicle threshold)
assert.equal(formatSpeed(8, 'metric'), '28.8 km/h');
assert.equal(formatSpeed(8, 'imperial'), '17.9 mph');
console.log('PASS vehicle speed limit 8 m/s formats: 28.8 km/h / 17.9 mph');
passedChecks++;

console.log(`\nAll ${passedChecks} route resolution and unit checks passed successfully.\n`);

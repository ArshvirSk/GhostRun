import assert from 'node:assert';
import {
  LOCAL_PATCH_NOTES,
  isVersionNewer,
  shouldDisplayPatchNotes,
} from '../src/lib/patchNotesCore';

console.log('--- Testing Patch Notes & Dynamic What\'s New Engine ---');

// Test 1: Version Comparison
{
  assert.strictEqual(isVersionNewer('2.9.23', '2.9.22'), true);
  assert.strictEqual(isVersionNewer('2.10.0', '2.9.23'), true);
  assert.strictEqual(isVersionNewer('2.9.23', '2.9.23'), false);
  assert.strictEqual(isVersionNewer('2.9.22', '2.9.23'), false);
  assert.strictEqual(isVersionNewer('2.9.23', ''), true);
  console.log('✓ Test 1: isVersionNewer accurately evaluates semver hierarchies');
}

// Test 2: shouldDisplayPatchNotes evaluation
{
  // First-time user (lastSeenVersion is null)
  assert.strictEqual(
    shouldDisplayPatchNotes({
      currentVersion: '2.9.23',
      lastSeenVersion: null,
    }),
    true,
    'First time user must see patch notes'
  );

  // User has already acknowledged this version
  assert.strictEqual(
    shouldDisplayPatchNotes({
      currentVersion: '2.9.23',
      lastSeenVersion: '2.9.23',
    }),
    false,
    'User who acknowledged current version must not be prompted again'
  );

  // User saw older version, new version deployed
  assert.strictEqual(
    shouldDisplayPatchNotes({
      currentVersion: '2.9.23',
      lastSeenVersion: '2.9.20',
    }),
    true,
    'User with older acknowledged version must see new patch notes'
  );

  // Malformed or empty highlights
  assert.strictEqual(
    shouldDisplayPatchNotes({
      currentVersion: '2.9.23',
      lastSeenVersion: null,
      patchNotes: {
        version: '2.9.23',
        release_date: '2026-11-24',
        title: 'Empty',
        subtitle: '',
        highlights: [],
      },
    }),
    false,
    'Empty patch notes must never trigger display'
  );
  console.log('✓ Test 2: shouldDisplayPatchNotes gates presentation accurately based on persistent state');
}

// Test 3: Local patch notes payload validation
{
  assert.strictEqual(LOCAL_PATCH_NOTES.version, '2.9.23');
  assert.ok(LOCAL_PATCH_NOTES.highlights.length >= 4);
  for (const h of LOCAL_PATCH_NOTES.highlights) {
    assert.ok(h.title.length > 0);
    assert.ok(h.description.length > 0);
  }
  console.log('✓ Test 3: LOCAL_PATCH_NOTES contains verified tactical highlights for v2.9.23');
}

console.log('\nAll 3 Patch Notes tests passed successfully!\n');

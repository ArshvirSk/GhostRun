import assert from 'node:assert';
import {
  isValidUploadThingUrl,
  buildPinpointPhotoFilename,
} from '../src/lib/pinpointUploadCore';

console.log('=== GhostRun v3.0 Pinpoint UploadThing Photo Uploader Tests ===\n');

async function runTests() {
  // Test 1: UploadThing CDN URL validation
  {
    assert.strictEqual(
      isValidUploadThingUrl('https://38jk5qgmbq.ufs.sh/f/SPC20MBTFwW18Hzplwx'),
      true
    );
    assert.strictEqual(
      isValidUploadThingUrl('https://utfs.io/f/SPC20MBTFwW18Hzplwx'),
      true
    );
    assert.strictEqual(isValidUploadThingUrl('http://insecure.ufs.sh/f/123'), false);
    assert.strictEqual(isValidUploadThingUrl('file:///data/user/0/cache/pic.jpg'), false);
    assert.strictEqual(isValidUploadThingUrl(''), false);
    console.log('PASS Test 1: UploadThing CDN URL validator accepts .ufs.sh and utfs.io HTTPS URLs');
  }

  // Test 2: Deterministic Filename Builder
  {
    const name1 = buildPinpointPhotoFilename({
      gameId: '12345678-abcd-efgh',
      roundId: '98765432-zyxw',
      kind: 'submission',
    });
    assert.ok(name1.startsWith('pinpoint-submission-12345678-98765432-'));
    assert.ok(name1.endsWith('.jpg'));

    const name2 = buildPinpointPhotoFilename({ kind: 'scout' });
    assert.ok(name2.startsWith('pinpoint-scout-match-rd-'));
    console.log('PASS Test 2: buildPinpointPhotoFilename generates clean JPEG filenames');
  }

  console.log('\nAll 2 Pinpoint UploadThing test suites passed cleanly!');
}

void runTests();

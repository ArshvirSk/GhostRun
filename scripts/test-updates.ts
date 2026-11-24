import assert from 'node:assert';
import {
  formatUpdateBannerText,
  checkForTacticalUpdate,
  fetchAndApplyUpdate,
} from '../src/lib/updatesCore';

console.log('--- Testing OTA Updates Engine & Core Logic ---');

async function runTests() {
  // Test 1: formatUpdateBannerText
  {
    assert.strictEqual(
      formatUpdateBannerText('2.9.24'),
      'TACTICAL UPDATE READY // TAP TO RESTART (v2.9.24)'
    );
    assert.strictEqual(
      formatUpdateBannerText(''),
      'TACTICAL UPDATE READY // TAP TO RESTART'
    );
    assert.strictEqual(
      formatUpdateBannerText(undefined),
      'TACTICAL UPDATE READY // TAP TO RESTART'
    );
    console.log('✓ Test 1: formatUpdateBannerText produces clean tactical HUD notifications');
  }

  // Test 2: Development / Disabled update bypass
  {
    const devCheck = await checkForTacticalUpdate({ isDevelopment: true });
    assert.strictEqual(devCheck.available, false);

    const disabledModule = { isEnabled: false };
    const disabledCheck = await checkForTacticalUpdate({ updatesModule: disabledModule });
    assert.strictEqual(disabledCheck.available, false);
    console.log('✓ Test 2: checkForTacticalUpdate safely bypasses in development and disabled modes');
  }

  // Test 3: Successful update detection with mock module
  {
    const mockUpdatesModule = {
      isEnabled: true,
      checkForUpdateAsync: async () => ({
        isAvailable: true,
        manifest: {
          extra: {
            expoClient: {
              version: '2.9.24',
            },
          },
        },
      }),
    };

    const check = await checkForTacticalUpdate({ updatesModule: mockUpdatesModule });
    assert.strictEqual(check.available, true);
    assert.strictEqual(check.manifestVersion, '2.9.24');
    console.log('✓ Test 3: checkForTacticalUpdate detects remote manifest version accurately');
  }

  // Test 4: Error resilience
  {
    const failingModule = {
      isEnabled: true,
      checkForUpdateAsync: async () => {
        throw new Error('Network timeout contacting update server');
      },
    };

    const check = await checkForTacticalUpdate({ updatesModule: failingModule });
    assert.strictEqual(check.available, false);
    assert.ok(check.error?.includes('Network timeout'));
    console.log('✓ Test 4: checkForTacticalUpdate handles network failures gracefully without crashing');
  }

  // Test 5: fetchAndApplyUpdate
  {
    let reloadCalled = false;
    const mockFetchModule = {
      isEnabled: true,
      fetchUpdateAsync: async () => ({ isNew: true }),
      reloadAsync: async () => {
        reloadCalled = true;
      },
    };

    const applyRes = await fetchAndApplyUpdate(mockFetchModule);
    assert.strictEqual(applyRes.success, true);
    assert.strictEqual(reloadCalled, true);
    console.log('✓ Test 5: fetchAndApplyUpdate triggers bundle download and application reload');
  }

  console.log('\nAll 5 OTA Updates tests passed successfully!\n');
}

void runTests();

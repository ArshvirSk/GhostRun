import assert from 'node:assert';
import {
  evaluateHostingEntitlement,
  HOSTING_PRODUCTS,
  FEATURE_MONETISATION_DEFAULT,
  getMonetisationStatus,
} from '../src/lib/monetisationCore';

console.log('--- Testing NF-28: Hosting Purchase & Monetisation Safeguards ---');

// Test 1: Monetisation disabled by default (F-D9 standing decision)
{
  assert.strictEqual(FEATURE_MONETISATION_DEFAULT, false, 'Default monetisation flag must strictly be false');
  const smallMatch = evaluateHostingEntitlement({
    monetisationEnabled: false,
    playerCount: 4,
  });
  assert.strictEqual(smallMatch.canHost, true);

  const largeMatch = evaluateHostingEntitlement({
    monetisationEnabled: false,
    playerCount: 150,
  });
  assert.strictEqual(largeMatch.canHost, true, 'When monetisation is off, large events up to 150 players must be 100% free');
  console.log('✓ Test 1: evaluateHostingEntitlement provides 100% free hosting when monetisation flag is off');
}

// Test 2: Active monetisation - Community free tier (<= 8 players)
{
  const res2 = evaluateHostingEntitlement({
    monetisationEnabled: true,
    playerCount: 2,
  });
  assert.strictEqual(res2.canHost, true);

  const res8 = evaluateHostingEntitlement({
    monetisationEnabled: true,
    playerCount: 8,
  });
  assert.strictEqual(res8.canHost, true);
  assert.strictEqual(res8.tier, 'community_free');
  console.log('✓ Test 2: Community matches (up to 8 players) remain permanently free under active monetisation');
}

// Test 3: Active monetisation - Large match gating & Pro entitlement
{
  const unpurchasedLarge = evaluateHostingEntitlement({
    monetisationEnabled: true,
    playerCount: 20,
    hasPurchasedPro: false,
  });
  assert.strictEqual(unpurchasedLarge.canHost, false);
  assert.ok(unpurchasedLarge.reason?.includes('Event Host Pass'));

  const purchasedLarge = evaluateHostingEntitlement({
    monetisationEnabled: true,
    playerCount: 50,
    hasPurchasedPro: true,
  });
  assert.strictEqual(purchasedLarge.canHost, true);
  assert.strictEqual(purchasedLarge.tier, 'event_host_pro');
  console.log('✓ Test 3: Large matches require pro entitlement only when monetisation is active');
}

// Test 4: Product catalogue
{
  assert.strictEqual(HOSTING_PRODUCTS.length, 1);
  const p = HOSTING_PRODUCTS[0];
  assert.strictEqual(p.id, 'host_pass_event');
  assert.strictEqual(p.priceFormatted, '$4.99');
  assert.strictEqual(p.maxPlayers, 150);
  console.log('✓ Test 4: Product catalogue defines standard event host pass');
}

// Test 5: getMonetisationStatus switch helper
{
  const statusDefault = getMonetisationStatus();
  assert.strictEqual(statusDefault.isMonetisationActive, false);
  assert.strictEqual(statusDefault.canHostFreely, true);
  assert.ok(statusDefault.policy.includes('100% free and unblocked'));

  const statusActive = getMonetisationStatus(true);
  assert.strictEqual(statusActive.isMonetisationActive, true);
  assert.strictEqual(statusActive.canHostFreely, false);
  assert.ok(statusActive.policy.includes('Event Host Pass'));
  console.log('✓ Test 5: getMonetisationStatus accurately reflects switch status and hosting policies');
}

console.log('\nAll 5 NF-28 monetisation tests passed successfully!\n');

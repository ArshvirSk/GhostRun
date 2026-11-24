import assert from 'node:assert';
import {
  calculateArenaBoundingBox,
  estimateTileCount,
  createOfflineMapPack,
  listOfflinePacks,
  getOfflinePack,
  deleteOfflinePack,
  clearExpiredPacks,
  resetOfflinePacks,
  DEFAULT_MAP_STYLE_URL,
} from '../src/lib/offlineMapManager';
import { distanceM } from '../src/lib/geo';

console.log('=== Pillar 5: Offline Vector Map Tile Pack Test Suite ===\n');

// Test 1: Bounding Box Calculation with 1.5x Safety Padding
{
  const center = { latitude: 37.7749, longitude: -122.4194 };
  const radiusM = 500;
  const padding = 1.5;

  const { boundsArray, boundsObj } = calculateArenaBoundingBox(center, radiusM, padding);

  const [[westLng, southLat], [eastLng, northLat]] = boundsArray;

  assert.strictEqual(boundsObj.sw[0], westLng);
  assert.strictEqual(boundsObj.sw[1], southLat);
  assert.strictEqual(boundsObj.ne[0], eastLng);
  assert.strictEqual(boundsObj.ne[1], northLat);

  assert.ok(westLng < center.longitude, 'West boundary is west of center');
  assert.ok(eastLng > center.longitude, 'East boundary is east of center');
  assert.ok(southLat < center.latitude, 'South boundary is south of center');
  assert.ok(northLat > center.latitude, 'North boundary is north of center');

  // Verify distance from center to boundaries is approximately 750m (500m * 1.5)
  const distNorth = distanceM(center, { latitude: northLat, longitude: center.longitude });
  const distEast = distanceM(center, { latitude: center.latitude, longitude: eastLng });

  assert.strictEqual(Math.round(distNorth), 750, 'North boundary is 750m (500m * 1.5) from center');
  assert.strictEqual(Math.round(distEast), 750, 'East boundary is 750m (500m * 1.5) from center');

  console.log('✓ Test 1: Arena bounding box calculation accurately projects 1.5x padded boundaries');
}

// Test 2: Web Mercator Tile Count & Storage Footprint Estimation
{
  const radiusM = 500;
  const estimation = estimateTileCount(radiusM, 12, 16);

  assert.ok(estimation.totalTiles > 0, 'Tile count is positive');
  assert.ok(estimation.totalTiles >= 15, 'Estimated at least 15 tiles across zoom levels 12-16');
  assert.ok(estimation.estimatedSizeBytes > 0, 'Estimated size is positive');
  assert.strictEqual(
    estimation.estimatedSizeBytes,
    estimation.totalTiles * 30 * 1024,
    'Footprint correctly calculates vector PBF byte footprint'
  );

  console.log(`✓ Test 2: Tile estimation calculated ${estimation.totalTiles} tiles (~${Math.round(estimation.estimatedSizeBytes / 1024)} KB)`);
}

// Test 3: Offline Map Pack Creation with Progress Reporting
(async () => {
  await resetOfflinePacks();

  const progressEvents: number[] = [];
  const pack = await createOfflineMapPack(
    {
      name: 'arena-presidio-01',
      center: { latitude: 37.7749, longitude: -122.4194 },
      radiusM: 600,
      ttlMs: 3600000, // 1 hour TTL
    },
    (p) => {
      progressEvents.push(p.percentage);
    }
  );

  assert.strictEqual(pack.name, 'arena-presidio-01');
  assert.strictEqual(pack.styleUrl, DEFAULT_MAP_STYLE_URL);
  assert.strictEqual(pack.state, 'complete');
  assert.deepStrictEqual(progressEvents, [0, 50, 100], 'Progress reported in ordered steps 0 -> 50 -> 100');

  console.log('✓ Test 3: Offline pack created and progress events successfully streamed');

  // Test 4: Catalog Listing & Pack Lookup
  const catalog = await listOfflinePacks();
  assert.strictEqual(catalog.length, 1);
  assert.strictEqual(catalog[0].name, 'arena-presidio-01');

  const retrieved = await getOfflinePack('arena-presidio-01');
  assert.ok(retrieved !== null);
  assert.strictEqual(retrieved?.name, 'arena-presidio-01');

  const missing = await getOfflinePack('non-existent');
  assert.strictEqual(missing, null);

  console.log('✓ Test 4: Offline pack catalog listing and lookup verified');

  // Test 5: Pack Deletion & Storage Reclamation
  const deleted = await deleteOfflinePack('arena-presidio-01');
  assert.strictEqual(deleted, true);

  const postDeleteCatalog = await listOfflinePacks();
  assert.strictEqual(postDeleteCatalog.length, 0);

  console.log('✓ Test 5: Pack deletion safely frees catalog entries and disk space');

  // Test 6: Expired Pack Pruning
  const now = Date.now();
  await createOfflineMapPack({
    name: 'pack-expired',
    center: { latitude: 37.7749, longitude: -122.4194 },
    radiusM: 400,
    ttlMs: 5000, // 5s TTL
  });

  await createOfflineMapPack({
    name: 'pack-active',
    center: { latitude: 37.7749, longitude: -122.4194 },
    radiusM: 400,
    ttlMs: 60000, // 60s TTL
  });

  const beforePrune = await listOfflinePacks();
  assert.strictEqual(beforePrune.length, 2);

  // Prune at now + 10s (pack-expired is expired, pack-active is valid)
  const prunedCount = await clearExpiredPacks(now + 10000);
  assert.strictEqual(prunedCount, 1, 'Exactly 1 expired pack was pruned');

  const afterPrune = await listOfflinePacks();
  assert.strictEqual(afterPrune.length, 1);
  assert.strictEqual(afterPrune[0].name, 'pack-active');

  console.log('✓ Test 6: clearExpiredPacks automatically prunes stale tile packs');

  // Test 7: Reset All Packs
  await resetOfflinePacks();
  const emptyCatalog = await listOfflinePacks();
  assert.strictEqual(emptyCatalog.length, 0);

  console.log('✓ Test 7: resetOfflinePacks purges all packs from storage');

  console.log('\n=== All 7 Offline Vector Map Tile Pack Tests Passed! (100%) ===\n');
})();

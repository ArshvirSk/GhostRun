import assert from 'node:assert';
import {
  buildOverpassPoiQuery,
  parseOverpassPoiElements,
  selectSpacedPois,
  type OverpassElement,
} from '../src/modes/pinpoint/poiEngine';
import {
  buildSimulatedOpponentScoutDrop,
  resolveSwappedTargetForTeam,
  type ScoutedDrop,
} from '../src/modes/pinpoint/scoutSwap';
import { distanceM } from '../src/lib/geo';

console.log('=== GhostRun v3.0 Pinpoint Method A (Scout & Swap) & Method C (Map POI) Tests ===\n');

async function runTests() {
  const centerLat = 28.6139;
  const centerLng = 77.2090;
  const radiusM = 500;

  // Test 1: Overpass QL Query Bounds Clamping
  {
    const q1 = buildOverpassPoiQuery(centerLat, centerLng, 1200);
    assert.ok(q1.includes('around:750,'), 'Radius must clamp to 750m max');
    const q2 = buildOverpassPoiQuery(centerLat, centerLng, 50);
    assert.ok(q2.includes('around:100,'), 'Radius must clamp to 100m min');
    assert.ok(q1.includes('historic') && q1.includes('fountain') && q1.includes('bridge'));
    console.log('PASS Test 1: Overpass QL query clamps radius [100m, 750m] and targets outdoor POIs');
  }

  // Test 2: Parse Overpass Elements, Geofence Filter & Deduplication
  {
    const mockElements: OverpassElement[] = [
      {
        type: 'node',
        id: 101,
        lat: 28.6145,
        lon: 77.2095,
        tags: { historic: 'monument', name: 'Victory Arch' },
      },
      {
        type: 'way',
        id: 202,
        center: { lat: 28.6130, lon: 77.2080 },
        tags: { leisure: 'pavilion', name: 'East Gazebo' },
      },
      {
        type: 'node',
        id: 303,
        lat: 28.6250, // > 1.2km away (out of 500m geofence!)
        lon: 77.2090,
        tags: { amenity: 'fountain', name: 'Far Fountain' },
      },
      {
        type: 'node',
        id: 404,
        lat: 28.61451, // Duplicate coordinate grid of id 101
        lon: 77.20951,
        tags: { tourism: 'artwork', name: 'Duplicate Statue' },
      },
    ];

    const parsed = parseOverpassPoiElements(mockElements, centerLat, centerLng, radiusM);
    assert.strictEqual(parsed.length, 2, 'Should filter out-of-bounds and duplicate POIs');
    assert.strictEqual(parsed[0].title, 'Victory Arch');
    assert.strictEqual(parsed[0].category, 'historic');
    assert.strictEqual(parsed[1].title, 'East Gazebo');
    assert.strictEqual(parsed[1].category, 'leisure');
    console.log('PASS Test 2: Overpass parser filters out-of-bounds POIs and deduplicates nodes/ways');
  }

  // Test 3: Spatial Spacing Selector (>= 40m separation)
  {
    const candidates = [
      { id: 'a', title: 'A', category: 'historic' as const, latitude: 28.6139, longitude: 77.2090, distanceFromCenterM: 0 },
      { id: 'b', title: 'B', category: 'leisure' as const, latitude: 28.61395, longitude: 77.20905, distanceFromCenterM: 7 }, // ~7m from A
      { id: 'c', title: 'C', category: 'bridge' as const, latitude: 28.6150, longitude: 77.2100, distanceFromCenterM: 155 }, // > 150m from A
    ];

    const picked = selectSpacedPois(candidates, 2, 40);
    assert.strictEqual(picked.length, 2);
    assert.strictEqual(picked[0].id, 'a');
    assert.strictEqual(picked[1].id, 'c', 'Should skip B (~7m) and select well-spaced C');
    console.log('PASS Test 3: selectSpacedPois enforces minimum 40m separation between landmarks');
  }

  // Test 4: Method A Scout & Swap Cross-Team Exchange
  {
    const drops: ScoutedDrop[] = [
      {
        team: 'runner',
        playerId: 'p1',
        latitude: 28.6142,
        longitude: 77.2092,
        heading: 45,
        photoUrl: 'https://example.com/runner-scout.jpg',
        title: 'Runner Hidden Bench',
        scoutedAtMs: 1000,
      },
      {
        team: 'hunter',
        playerId: 'p2',
        latitude: 28.6135,
        longitude: 77.2085,
        heading: 210,
        photoUrl: 'https://example.com/hunter-scout.jpg',
        title: 'Hunter Clock Alcove',
        scoutedAtMs: 1005,
      },
    ];

    const forRunner = resolveSwappedTargetForTeam({
      myTeam: 'runner',
      scoutDrops: drops,
      roundNumber: 1,
      durationSec: 180,
      centerLat,
      centerLng,
      radiusM,
    });
    assert.strictEqual(forRunner.title, 'Hunter Clock Alcove');
    assert.strictEqual(forRunner.heading, 210);

    const forHunter = resolveSwappedTargetForTeam({
      myTeam: 'hunter',
      scoutDrops: drops,
      roundNumber: 1,
      durationSec: 180,
      centerLat,
      centerLng,
      radiusM,
    });
    assert.strictEqual(forHunter.title, 'Runner Hidden Bench');
    assert.strictEqual(forHunter.heading, 45);
    console.log('PASS Test 4: Scout & Swap exchanges opposing team landmarks cleanly');
  }

  // Test 5: Solo / Simulated Opponent Scout Drop stays inside geofence
  {
    const simDrop = buildSimulatedOpponentScoutDrop({
      myTeam: 'runner',
      centerLat,
      centerLng,
      radiusM,
      roundNumber: 2,
    });
    assert.strictEqual(simDrop.team, 'hunter');
    const dist = distanceM(
      { latitude: centerLat, longitude: centerLng },
      { latitude: simDrop.latitude, longitude: simDrop.longitude }
    );
    assert.ok(dist <= radiusM, `Simulated rival drop (${Math.round(dist)}m) must stay within ${radiusM}m`);
    console.log('PASS Test 5: Simulated rival scout drop stays strictly inside arena geofence');
  }

  console.log('\nAll 5 Pinpoint Method A & Method C test suites passed cleanly!');
}

void runTests();

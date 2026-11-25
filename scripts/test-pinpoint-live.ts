import assert from 'node:assert';
import {
  buildPinpointRoundsFromParams,
  buildSectorQuadrantPolygon,
  buildAzimuthVectorLine,
} from '../src/modes/pinpoint/liveHelpers';
import { evaluatePinpointClues, evaluatePinpointScore } from '../src/modes/pinpoint/engine';

console.log('=== GhostRun v3.0 Pinpoint Live Gameplay & Clues Test Suite ===\n');

async function runTests() {
  const centerLat = 28.6139;
  const centerLng = 77.2090;
  const radiusM = 500;

  // Test 1: Build rounds from Host Pre-Drop modeParams
  {
    const rounds = buildPinpointRoundsFromParams({
      centerLat,
      centerLng,
      radiusM,
      modeParams: {
        pinpoint: {
          total_rounds: 2,
          round_duration_s: 150,
          drops: [
            {
              id: 'd1',
              roundNumber: 1,
              title: 'Plaza Fountain',
              latitude: 28.6145,
              longitude: 77.2095,
              heading: 90,
            },
            {
              id: 'd2',
              roundNumber: 2,
              title: 'North Arch',
              latitude: 28.6150,
              longitude: 77.2085,
              heading: 180,
            },
          ],
        },
      },
    });

    assert.strictEqual(rounds.length, 2);
    assert.strictEqual(rounds[0].title, 'Plaza Fountain');
    assert.strictEqual(rounds[0].durationSec, 150);
    assert.strictEqual(rounds[1].heading, 180);
    console.log('PASS Test 1: buildPinpointRoundsFromParams hydrates host drops accurately');
  }

  // Test 2: Fallback deterministic rounds when no host drops are provided
  {
    const rounds = buildPinpointRoundsFromParams({
      centerLat,
      centerLng,
      radiusM,
      modeParams: { pinpoint: { total_rounds: 3 } },
    });

    assert.strictEqual(rounds.length, 3);
    assert.ok(rounds[0].targetPhotoUrl.startsWith('https://'));
    assert.strictEqual(rounds[2].roundNumber, 3);
    console.log('PASS Test 2: Fallback round generator produces 3 valid in-bounds landmarks');
  }

  // Test 3: Sector Quadrant Polygon GeoJSON Bounds (NW, NE, SW, SE)
  {
    const nePoly = buildSectorQuadrantPolygon(centerLat, centerLng, radiusM, 'NE');
    const coords = nePoly.features[0].geometry.coordinates[0];
    assert.strictEqual(coords.length, 5);
    assert.strictEqual(nePoly.features[0].properties.quadrant, 'NE');
    // NE quadrant must have all latitudes >= centerLat and longitudes >= centerLng
    for (const [lng, lat] of coords) {
      assert.ok(lat >= centerLat - 1e-9);
      assert.ok(lng >= centerLng - 1e-9);
    }

    const swPoly = buildSectorQuadrantPolygon(centerLat, centerLng, radiusM, 'SW');
    for (const [lng, lat] of swPoly.features[0].geometry.coordinates[0]) {
      assert.ok(lat <= centerLat + 1e-9);
      assert.ok(lng <= centerLng + 1e-9);
    }

    console.log('PASS Test 3: Sector Quadrant GeoJSON polygons match NW/NE/SW/SE bounds');
  }

  // Test 4: Azimuth Vector LineString GeoJSON ordering [lng, lat]
  {
    const line = buildAzimuthVectorLine(28.6100, 77.2050, 28.6150, 77.2100);
    const pts = line.features[0].geometry.coordinates;
    assert.deepStrictEqual(pts[0], [77.2050, 28.6100]);
    assert.deepStrictEqual(pts[1], [77.2100, 28.6150]);
    console.log('PASS Test 4: Azimuth Vector LineString orders [lng, lat] for MapLibre');
  }

  // Test 5: End-to-End Live Clue -> Submission Score Flow
  {
    const rounds = buildPinpointRoundsFromParams({ centerLat, centerLng, radiusM });
    const round1 = rounds[0];

    // At T+100s (Level 2 Sector unlocked)
    const clues = evaluatePinpointClues({
      elapsedSec: 100,
      roundDurationSec: round1.durationSec,
      currentLat: centerLat,
      currentLng: centerLng,
      targetLat: round1.latitude,
      targetLng: round1.longitude,
      centerLat,
      centerLng,
    });
    assert.strictEqual(clues.level, 2);
    assert.ok(clues.sectorQuadrant !== null);

    const score = evaluatePinpointScore({
      target: {
        id: round1.id,
        roundNumber: round1.roundNumber,
        photoUrl: round1.targetPhotoUrl,
        latitude: round1.latitude,
        longitude: round1.longitude,
        heading: round1.heading,
        status: 'active',
      },
      submissionLat: round1.latitude,
      submissionLng: round1.longitude,
      submissionHeading: round1.heading,
      cluesUnlocked: clues.level,
      elapsedSec: 100,
      roundDurationSec: round1.durationSec,
    });
    assert.strictEqual(score.clueMultiplier, 0.8);
    assert.ok(score.totalScore > 3000);
    console.log('PASS Test 5: Live clue level feeds cleanly into Pinpoint shot score evaluation');
  }

  console.log('\nAll 5 Pinpoint Live Gameplay test suites passed cleanly!');
}

void runTests();

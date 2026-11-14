import assert from 'node:assert';
import {
  formatDuration,
  determineRankTier,
  calculateSeasonRecap,
  buildSeasonRecapShareText,
  RoundHistoryEntry,
} from '../src/lib/seasonRecapCore';

console.log('--- Testing NF-15: Season Recap ("Wrapped") ---');

// Test 1: formatDuration
{
  assert.strictEqual(formatDuration(0), '0s');
  assert.strictEqual(formatDuration(45), '0m 45s');
  assert.strictEqual(formatDuration(125), '2m 5s');
  assert.strictEqual(formatDuration(3665), '1h 1m');
  console.log('✓ Test 1: formatDuration handles 0s, seconds, minutes, and hours properly');
}

// Test 2: determineRankTier
{
  assert.strictEqual(determineRankTier(2, 50), 'Recruit');
  assert.strictEqual(determineRankTier(5, 40), 'Operative');
  assert.strictEqual(determineRankTier(15, 55), 'Specialist');
  assert.strictEqual(determineRankTier(30, 70), 'Apex Predator');
  console.log('✓ Test 2: determineRankTier assigns appropriate tactical tiers based on volume and win rate');
}

// Test 3: calculateSeasonRecap - Empty rounds
{
  const emptyRecap = calculateSeasonRecap([], ['first_deployment'], 'Season 0');
  assert.strictEqual(emptyRecap.totalRounds, 0);
  assert.strictEqual(emptyRecap.winRatePercent, 0);
  assert.strictEqual(emptyRecap.rankTier, 'Recruit');
  assert.strictEqual(emptyRecap.badgesUnlocked.length, 1);
  console.log('✓ Test 3: calculateSeasonRecap handles empty round histories safely');
}

// Test 4: calculateSeasonRecap - Aggregation
{
  const rounds: RoundHistoryEntry[] = [
    {
      id: 'r1',
      mode_id: 'classic_chase',
      team: 'runner',
      won: true,
      distance_meters: 1000,
      duration_seconds: 600,
      top_speed_kmh: 22.4,
    },
    {
      id: 'r2',
      mode_id: 'classic_chase',
      team: 'runner',
      won: false,
      distance_meters: 800,
      duration_seconds: 350,
      top_speed_kmh: 19.1,
    },
    {
      id: 'r3',
      mode_id: 'jailbreak',
      team: 'hunter',
      won: true,
      distance_meters: 1200,
      duration_seconds: 500,
      top_speed_kmh: 24.8,
    },
    {
      id: 'r4',
      mode_id: 'classic_chase',
      team: 'hunter',
      won: true,
      distance_meters: 900,
      duration_seconds: 400,
      top_speed_kmh: 21.0,
    },
  ];

  const badges = ['first_deployment', 'ghost_whisperer'];
  const recap = calculateSeasonRecap(rounds, badges, 'October 2026');

  assert.strictEqual(recap.totalRounds, 4);
  assert.strictEqual(recap.roundsWon, 3);
  assert.strictEqual(recap.winRatePercent, 75);
  assert.strictEqual(recap.runnerRounds, 2);
  assert.strictEqual(recap.runnerWins, 1);
  assert.strictEqual(recap.hunterRounds, 2);
  assert.strictEqual(recap.hunterWins, 2);
  assert.strictEqual(recap.totalDistanceMeters, 3900);
  assert.strictEqual(recap.topSpeedKmh, 24.8);
  assert.strictEqual(recap.favoriteModeId, 'classic_chase');
  assert.strictEqual(recap.favoriteModeName, 'Classic Chase');
  assert.strictEqual(recap.longestSurvivalSeconds, 600);
  assert.strictEqual(recap.rankTier, 'Operative');
  console.log('✓ Test 4: calculateSeasonRecap aggregates wins, distances, speeds, and favorite modes accurately');
}

// Test 5: buildSeasonRecapShareText - Privacy compliance
{
  const recap = calculateSeasonRecap(
    [
      { id: '1', mode_id: 'tag_hunt', team: 'runner', won: true, distance_meters: 5000, top_speed_kmh: 20 },
    ],
    ['veteran_operative'],
    'Season 1'
  );

  const text = buildSeasonRecapShareText(recap);
  assert.ok(text.includes('GHOSTRUN // RECAP: SEASON 1'), 'Must include header');
  assert.ok(text.includes('Total Patrol Distance: 5.0 km'), 'Must include formatted distance');
  assert.ok(text.includes('Tag Hunt'), 'Must include favorite mode');
  assert.ok(!text.includes('lat'), 'Must not contain latitude');
  assert.ok(!text.includes('lng'), 'Must not contain longitude');
  assert.ok(!text.includes('coords'), 'Must not contain coordinates');
  console.log('✓ Test 5: buildSeasonRecapShareText enforces strict privacy rules (zero GPS coordinates)');
}

console.log('\nAll 5 NF-15 season recap tests passed successfully!\n');

/**
 * GhostRun — Echo Scoring Engine Test Suite (FL-P2)
 */

import assert from 'node:assert';
import {
  calculateWindowW,
  calculateDMin,
  calculateCashWindowTc,
  calculateDifficultyD,
  calculateSmoothedYield,
  calculateRoundEcho,
  resolveEchoTier,
  rollupSeasonEcho,
} from '../src/lib/echoCore';

console.log('--- GhostRun FL-P2: Echo Scoring Engine Test Suite ---');

// 1. Window Parameter Calculations
console.log('\n[1] Testing Window Parameters...');

assert.strictEqual(calculateWindowW(150), 75, 'Default 150s interval yields W = 75s');
assert.strictEqual(calculateWindowW(60), 45, 'W clamped to min 45s');
assert.strictEqual(calculateWindowW(300), 120, 'W clamped to max 120s');

assert.strictEqual(calculateDMin(600), 60, 'Default 600m radius yields D_min = 60m');
assert.strictEqual(calculateDMin(100), 30, 'D_min clamped to min 30m');
assert.strictEqual(calculateDMin(1500), 80, 'D_min clamped to max 80m');

assert.strictEqual(calculateCashWindowTc(150), 210, 'Tc = ping_interval + 60s');
console.log('  PASS: Window parameters (W, D_min, Tc) calculated and clamped accurately');

// 2. Team Ratio Difficulty Calculation
console.log('\n[2] Testing Team Ratio Difficulty D...');

const balancedRunnerD = calculateDifficultyD('runner', 2, 4); // H/R = 0.5
const balancedHunterD = calculateDifficultyD('hunter', 2, 4);
assert.strictEqual(balancedRunnerD, 1.0, 'H/R = 0.5 yields D = 1.0 for runner');
assert.strictEqual(balancedHunterD, 1.0, 'H/R = 0.5 yields D = 1.0 for hunter');

const hardRunnerD = calculateDifficultyD('runner', 4, 4); // H/R = 1.0 (more hunters)
const easyHunterD = calculateDifficultyD('hunter', 4, 4);
assert.strictEqual(hardRunnerD, 1.15, 'High H/R increases runner difficulty to max 1.15');
assert.strictEqual(easyHunterD, 0.85, 'High H/R decreases hunter difficulty to min 0.85');
console.log('  PASS: Difficulty scaling across team ratios verified');

// 3. Bayesian Smoothed Yield
console.log('\n[3] Testing Bayesian Yield Smoothing...');

const smoothedZero = calculateSmoothedYield(0, 0, 3);
assert.strictEqual(smoothedZero, 0.5, 'Zero pings defaults to 0.5 neutral yield');

const smoothedPriya = calculateSmoothedYield(4, 6, 3);
assert.strictEqual(Number(smoothedPriya.toFixed(4)), 0.6111);

const smoothedSam = calculateSmoothedYield(1, 5, 3);
assert.strictEqual(Number(smoothedSam.toFixed(4)), 0.3125);
console.log('  PASS: Bayesian smoothing (k=3) verified');

// 4. Golden Test: Priya (Runner) from FL Spec Section 5.5
console.log('\n[4] Testing Golden Case: Priya (Runner)...');

const priyaScore = calculateRoundEcho({
  role: 'runner',
  teamWon: true,
  contestedPings: 6,
  hitPings: 4,
  activeShare: 0.90,
  hunterCount: 2,
  runnerCount: 4,
});

assert.strictEqual(priyaScore.echo, 82, `Priya's Echo must equal exactly 82 (got ${priyaScore.echo})`);
assert.strictEqual(priyaScore.o, 1.0);
assert.strictEqual(priyaScore.d, 1.0);
console.log(`  PASS: Priya (Runner) scored ${priyaScore.echo} (exact match with spec)`);

// 5. Golden Test: Sam (Hunter) from FL Spec Section 5.5
console.log('\n[5] Testing Golden Case: Sam (Hunter)...');

const samScore = calculateRoundEcho({
  role: 'hunter',
  teamWon: false,
  contestedPings: 5,
  hitPings: 1,
  activeShare: 0.80,
  hunterCount: 2,
  runnerCount: 4,
});

assert.strictEqual(samScore.echo, 29, `Sam's Echo must equal exactly 29 (got ${samScore.echo})`);
assert.strictEqual(samScore.o, 0.0);
assert.strictEqual(samScore.d, 1.0);
console.log(`  PASS: Sam (Hunter) scored ${samScore.echo} (exact match with spec)`);

// 6. Tier Resolutions
console.log('\n[6] Testing Tier Thresholds...');

assert.strictEqual(resolveEchoTier(35), 'Whisper');
assert.strictEqual(resolveEchoTier(45), 'Shade');
assert.strictEqual(resolveEchoTier(60), 'Wraith');
assert.strictEqual(resolveEchoTier(75), 'Phantom');
assert.strictEqual(resolveEchoTier(88), 'Revenant');
console.log('  PASS: Tier assignments match threshold boundaries');

// 7. Season Echo Rollup with Caps & Win-Trading Discount
console.log('\n[7] Testing Season Rollup & Anti-Cheat Penalties...');

const mockRounds = [
  // Day 1: 8 rounds with same group (Rounds 1-3 full, 4-6 at 50%, 7-8 capped)
  { dateStr: '2026-11-01', groupKey: 'groupA', echo: 80 },
  { dateStr: '2026-11-01', groupKey: 'groupA', echo: 80 },
  { dateStr: '2026-11-01', groupKey: 'groupA', echo: 80 },
  { dateStr: '2026-11-01', groupKey: 'groupA', echo: 80 }, // -> 40
  { dateStr: '2026-11-01', groupKey: 'groupA', echo: 80 }, // -> 40
  { dateStr: '2026-11-01', groupKey: 'groupA', echo: 80 }, // -> 40
  { dateStr: '2026-11-01', groupKey: 'groupA', echo: 80 }, // Excluded (daily cap 6)
  { dateStr: '2026-11-01', groupKey: 'groupA', echo: 80 }, // Excluded (daily cap 6)
  // Day 2: 6 normal rounds with different groups (no group exceeds 3 rounds)
  { dateStr: '2026-11-02', groupKey: 'groupB', echo: 70 },
  { dateStr: '2026-11-02', groupKey: 'groupB', echo: 70 },
  { dateStr: '2026-11-02', groupKey: 'groupB', echo: 70 },
  { dateStr: '2026-11-02', groupKey: 'groupC', echo: 70 },
  { dateStr: '2026-11-02', groupKey: 'groupC', echo: 70 },
  { dateStr: '2026-11-02', groupKey: 'groupC', echo: 70 },
];

const rollup = rollupSeasonEcho(mockRounds);
// Total eligible rounds = 6 (Day 1) + 6 (Day 2) = 12 rounds
assert.strictEqual(rollup.roundsCounted, 12, 'Must count 12 rounds total (2 capped)');
// Best 12 sum: 80*3 + 70*6 + 40*3 = 240 + 420 + 120 = 780
assert.strictEqual(rollup.seasonEcho, 780, 'Season Echo sum matches best 12 after discount');
assert.strictEqual(rollup.best12Average, 65.0);
assert.strictEqual(rollup.tier, 'Wraith');
console.log('  PASS: Season rollup correctly applied 6-round daily cap & 50% collusion discount');

// 8. Operator Role
console.log('\n[8] Testing Operator Role Neutrality...');

const operatorScore = calculateRoundEcho({
  role: 'operator',
  teamWon: true,
  contestedPings: 10,
  hitPings: 8,
  activeShare: 1.0,
  hunterCount: 2,
  runnerCount: 4,
});
assert.strictEqual(operatorScore.echo, 0, 'Operators receive exactly 0 Echo in v1');
console.log('  PASS: Operator role receives 0 Echo');

console.log('\nAll FL-P2 Echo Scoring Engine tests passed successfully!');

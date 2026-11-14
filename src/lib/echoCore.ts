/**
 * GhostRun — Echo Scoring Engine Core (FL-P2)
 *
 * Implements pure mathematical functions for the Echo score,
 * Bayesian smoothing, role difficulty scaling, and tier assignments.
 */

export type EchoTier = 'Whisper' | 'Shade' | 'Wraith' | 'Phantom' | 'Revenant';

export interface EchoParams {
  pingIntervalS: number;
  zoneRadiusM: number;
  tagRadiusM: number;
}

export interface EchoRoundInputs {
  role: 'runner' | 'hunter' | 'operator';
  teamWon: boolean;
  wasTaggedInWin?: boolean;
  contestedPings: number;
  hitPings: number; // ghosted pings for runner, cashed pings for hunter
  activeShare: number; // 0.0 to 1.0 (Presence P)
  hunterCount: number;
  runnerCount: number;
  hostEndedEarly?: boolean;
  params?: Partial<EchoParams>;
}

export interface EchoRoundResult {
  o: number;
  y: number;
  p: number;
  d: number;
  echo: number;
  ghostRate?: number;
  cashRate?: number;
}

/**
 * Calculates window W in seconds: clamp(ping_interval / 2, 45s, 120s)
 */
export function calculateWindowW(pingIntervalS: number = 150): number {
  return Math.min(120, Math.max(45, pingIntervalS / 2));
}

/**
 * Calculates D_min in meters: clamp(0.10 * zone_radius, 30m, 80m)
 */
export function calculateDMin(zoneRadiusM: number = 600): number {
  return Math.min(80, Math.max(30, 0.10 * zoneRadiusM));
}

/**
 * Calculates Cash window Tc: ping_interval + 60s
 */
export function calculateCashWindowTc(pingIntervalS: number = 150): number {
  return pingIntervalS + 60;
}

/**
 * Calculates Difficulty D based on team ratio H/R:
 * Runner: 1 + 0.15 * clamp((H/R - 0.5) / 0.5, -1, 1)
 * Hunter: 1 - 0.15 * clamp((H/R - 0.5) / 0.5, -1, 1)
 */
export function calculateDifficultyD(
  role: 'runner' | 'hunter',
  hunterCount: number,
  runnerCount: number,
): number {
  const rSafe = Math.max(1, runnerCount);
  const ratio = hunterCount / rSafe;
  const clampedRatioDelta = Math.min(1, Math.max(-1, (ratio - 0.5) / 0.5));

  if (role === 'runner') {
    return 1 + 0.15 * clampedRatioDelta;
  }
  return 1 - 0.15 * clampedRatioDelta;
}

/**
 * Calculates Bayesian smoothed yield Y: (count + k * 0.5) / (total + k) with k = 3
 */
export function calculateSmoothedYield(hitCount: number, totalCount: number, k: number = 3): number {
  const numerator = hitCount + k * 0.5;
  const denominator = totalCount + k;
  return denominator > 0 ? numerator / denominator : 0.5;
}

/**
 * Calculates the complete round Echo score.
 * Echo = 100 * (0.40 * O + 0.40 * Y + 0.20 * P) * D
 */
export function calculateRoundEcho(input: EchoRoundInputs): EchoRoundResult {
  if (input.role === 'operator') {
    return { o: 0, y: 0, p: 0, d: 1.0, echo: 0 };
  }

  // 1. Outcome O
  let o = 0.0;
  if (!input.hostEndedEarly) {
    if (input.teamWon) {
      o = input.wasTaggedInWin ? 0.8 : 1.0;
    } else {
      o = 0.0;
    }
  }

  // 2. Yield Y (Ghost rate for runners, Cash rate for hunters)
  const y = calculateSmoothedYield(input.hitPings, input.contestedPings, 3);

  // 3. Presence P (clamped 0 to 1)
  const p = Math.min(1.0, Math.max(0.0, input.activeShare));

  // 4. Difficulty D
  const d = calculateDifficultyD(input.role, input.hunterCount, input.runnerCount);

  // 5. Echo = 100 * (0.40 * O + 0.40 * Y + 0.20 * P) * D
  const rawEcho = 100.0 * (0.40 * o + 0.40 * y + 0.20 * p) * d;
  const echo = Math.round(rawEcho);

  return {
    o: Number(o.toFixed(4)),
    y: Number(y.toFixed(4)),
    p: Number(p.toFixed(4)),
    d: Number(d.toFixed(4)),
    echo,
    ghostRate: input.role === 'runner' ? y : undefined,
    cashRate: input.role === 'hunter' ? y : undefined,
  };
}

/**
 * Assigns tier based on average of best 12 rounds:
 * Whisper (<40), Shade (40-54), Wraith (55-69), Phantom (70-84), Revenant (85+)
 */
export function resolveEchoTier(averageBestEcho: number): EchoTier {
  if (averageBestEcho >= 85) return 'Revenant';
  if (averageBestEcho >= 70) return 'Phantom';
  if (averageBestEcho >= 55) return 'Wraith';
  if (averageBestEcho >= 40) return 'Shade';
  return 'Whisper';
}

/**
 * Rolls up Season Echo from an array of round scores, applying:
 * - Best 12 rounds
 * - Daily cap of 6 rounds per day
 * - 50% discount after round 3 with identical player group on same day
 */
export function rollupSeasonEcho(
  rounds: Array<{
    dateStr: string; // YYYY-MM-DD
    groupKey: string; // Hash of sorted player user IDs
    echo: number;
    ghostRate?: number;
    cashRate?: number;
  }>,
): {
  seasonEcho: number;
  roundsCounted: number;
  best12Average: number;
  tier: EchoTier;
} {
  // 1. Group by day & count rounds per day and per group
  const dayCounts: Record<string, number> = {};
  const groupDayCounts: Record<string, number> = {};

  const eligibleRounds: number[] = [];

  for (const r of rounds) {
    dayCounts[r.dateStr] = (dayCounts[r.dateStr] || 0) + 1;
    if (dayCounts[r.dateStr] > 6) {
      continue; // Exceeded 6 counted rounds daily cap
    }

    const groupKey = `${r.dateStr}:${r.groupKey}`;
    groupDayCounts[groupKey] = (groupDayCounts[groupKey] || 0) + 1;

    let roundEcho = r.echo;
    if (groupDayCounts[groupKey] > 3) {
      roundEcho = Math.round(roundEcho * 0.5); // 50% win-trading discount
    }

    eligibleRounds.push(roundEcho);
  }

  // Sort descending and take best 12
  eligibleRounds.sort((a, b) => b - a);
  const best12 = eligibleRounds.slice(0, 12);
  const seasonEcho = best12.reduce((sum, val) => sum + val, 0);
  const roundsCounted = eligibleRounds.length;
  const best12Average = best12.length > 0 ? seasonEcho / best12.length : 0;

  return {
    seasonEcho,
    roundsCounted,
    best12Average: Number(best12Average.toFixed(1)),
    tier: resolveEchoTier(best12Average),
  };
}

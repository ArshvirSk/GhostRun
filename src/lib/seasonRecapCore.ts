/**
 * NF-15: Season Recap ("Wrapped") Core Calculations & Formatter
 *
 * Privacy Guarantees:
 * - Aggregated performance metrics only.
 * - No GPS coordinates, route geometries, timestamps of matches, or location names.
 * - Complies with Consent C3 and sharing privacy rules.
 */

export interface RoundHistoryEntry {
  id: string;
  mode_id: string;
  team: string; // 'runner' | 'hunter'
  won: boolean;
  distance_meters?: number;
  duration_seconds?: number;
  top_speed_kmh?: number;
  created_at?: string;
}

export type RankTier = 'Recruit' | 'Operative' | 'Specialist' | 'Apex Predator';

export interface SeasonRecapData {
  periodName: string;
  totalRounds: number;
  roundsWon: number;
  winRatePercent: number;
  runnerRounds: number;
  runnerWins: number;
  hunterRounds: number;
  hunterWins: number;
  totalDistanceMeters: number;
  topSpeedKmh: number;
  favoriteModeId: string;
  favoriteModeName: string;
  longestSurvivalSeconds: number;
  badgesUnlocked: string[];
  rankTier: RankTier;
}

const MODE_NAMES: Record<string, string> = {
  classic_chase: 'Classic Chase',
  tag_hunt: 'Tag Hunt',
  jailbreak: 'Jailbreak',
  horde: 'Horde Mode',
  ghost_duel: 'Ghost Duel',
};

/**
 * Format seconds into mm:ss or hh:mm
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m < 60) {
    return `${m}m ${s}s`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

/**
 * Determine tactical rank tier based on rounds and win percentage
 */
export function determineRankTier(totalRounds: number, winRate: number): RankTier {
  if (totalRounds >= 25 && winRate >= 65) return 'Apex Predator';
  if (totalRounds >= 12 && winRate >= 50) return 'Specialist';
  if (totalRounds >= 4) return 'Operative';
  return 'Recruit';
}

/**
 * Aggregates a player's round history into a tactical season recap
 */
export function calculateSeasonRecap(
  rounds: RoundHistoryEntry[],
  badges: string[] = [],
  periodName: string = 'Current Season'
): SeasonRecapData {
  if (!rounds || rounds.length === 0) {
    return {
      periodName,
      totalRounds: 0,
      roundsWon: 0,
      winRatePercent: 0,
      runnerRounds: 0,
      runnerWins: 0,
      hunterRounds: 0,
      hunterWins: 0,
      totalDistanceMeters: 0,
      topSpeedKmh: 0,
      favoriteModeId: 'classic_chase',
      favoriteModeName: 'Classic Chase',
      longestSurvivalSeconds: 0,
      badgesUnlocked: badges,
      rankTier: 'Recruit',
    };
  }

  let wonCount = 0;
  let runnerCount = 0;
  let runnerWon = 0;
  let hunterCount = 0;
  let hunterWon = 0;
  let totalDistance = 0;
  let maxSpeed = 0;
  let maxSurvival = 0;
  const modeCounts: Record<string, number> = {};

  for (const r of rounds) {
    if (r.won) wonCount++;

    const isRunner = (r.team || '').toLowerCase() === 'runner';
    if (isRunner) {
      runnerCount++;
      if (r.won) runnerWon++;
      if (r.duration_seconds && r.duration_seconds > maxSurvival) {
        maxSurvival = r.duration_seconds;
      }
    } else {
      hunterCount++;
      if (r.won) hunterWon++;
    }

    if (r.distance_meters && r.distance_meters > 0) {
      totalDistance += r.distance_meters;
    }

    if (r.top_speed_kmh && r.top_speed_kmh > maxSpeed) {
      maxSpeed = r.top_speed_kmh;
    }

    const mode = r.mode_id || 'classic_chase';
    modeCounts[mode] = (modeCounts[mode] || 0) + 1;
  }

  let favMode = 'classic_chase';
  let maxFavCount = 0;
  for (const [mode, cnt] of Object.entries(modeCounts)) {
    if (cnt > maxFavCount) {
      maxFavCount = cnt;
      favMode = mode;
    }
  }

  const winRate = Math.round((wonCount / rounds.length) * 100);
  const tier = determineRankTier(rounds.length, winRate);

  return {
    periodName,
    totalRounds: rounds.length,
    roundsWon: wonCount,
    winRatePercent: winRate,
    runnerRounds: runnerCount,
    runnerWins: runnerWon,
    hunterRounds: hunterCount,
    hunterWins: hunterWon,
    totalDistanceMeters: Math.round(totalDistance),
    topSpeedKmh: Math.round(maxSpeed * 10) / 10,
    favoriteModeId: favMode,
    favoriteModeName: MODE_NAMES[favMode] || favMode,
    longestSurvivalSeconds: maxSurvival,
    badgesUnlocked: badges,
    rankTier: tier,
  };
}

/**
 * Builds a shareable summary card text for external platforms
 */
export function buildSeasonRecapShareText(recap: SeasonRecapData): string {
  const km = (recap.totalDistanceMeters / 1000).toFixed(1);
  const lines: string[] = [
    `⚡ GHOSTRUN // RECAP: ${recap.periodName.toUpperCase()}`,
    `Rank Tier: [${recap.rankTier.toUpperCase()}]`,
    `--------------------------------`,
    `• Field Operations: ${recap.totalRounds}`,
    `• Win Rate: ${recap.winRatePercent}% (${recap.roundsWon} victories)`,
    `• Total Patrol Distance: ${km} km`,
  ];

  if (recap.topSpeedKmh > 0) {
    lines.push(`• Top Sprint Speed: ${recap.topSpeedKmh} km/h`);
  }

  if (recap.longestSurvivalSeconds > 0) {
    lines.push(`• Longest Evasion: ${formatDuration(recap.longestSurvivalSeconds)}`);
  }

  lines.push(`• Primary Doctrine: ${recap.favoriteModeName}`);
  lines.push(`• Badges Commended: ${recap.badgesUnlocked.length}`);
  lines.push(`--------------------------------`);
  lines.push(`Join the tactical pursuit at ghostrun.app`);

  return lines.join('\n');
}

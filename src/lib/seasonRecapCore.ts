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
  relay_heist: 'Relay Heist',
  assassin_ring: 'Assassin Ring',
  outbreak_horde: 'Outbreak Horde',
  horde: 'Outbreak Horde',
  pinpoint: 'Pinpoint',
  territory_pulse: 'Territory Pulse',
  ghost_duel: 'Ghost Duel',
};

export interface AccoladeResult {
  code: string;
  title: string;
  description: string;
}

/**
 * Determines tactical match debrief accolade based on game mode, team, and operative performance.
 */
export function calculateHighlightAccolade(params: {
  modeId: string;
  isVictory: boolean;
  team: string;
  secretRole?: string | null;
  status?: string;
  durationSeconds?: number;
}): AccoladeResult {
  const { modeId, isVictory, team, secretRole, status, durationSeconds = 0 } = params;

  if (secretRole === 'agent') {
    return status !== 'tagged'
      ? {
          code: 'MOLE',
          title: 'UNDETECTED MOLE',
          description: 'Secretly coordinated intelligence with runner squad without being unmasked by tribunal.',
        }
      : {
          code: 'TRB',
          title: 'TRIBUNAL JUSTICE',
          description: 'Unmasked by emergency hunter tribunal and neutralized prior to runner extraction.',
        };
  }

  if (secretRole === 'vip') {
    return isVictory
      ? {
          code: 'VIP',
          title: 'HIGH-VALUE EXTRACTION',
          description: 'Protected VIP successfully reached extraction target zone under squad escort.',
        }
      : {
          code: 'VIP',
          title: 'ESCORT COMPROMISED',
          description: 'Hunters penetrated squad perimeter and neutralized high-value operative asset.',
        };
  }

  if (secretRole === 'bodyguard') {
    return {
      code: 'GRD',
      title: 'SECRET SERVICE',
      description: 'Absorbed hunter focus and tactical role-swaps to ensure team mission survivability.',
    };
  }

  switch (modeId) {
    case 'pinpoint':
      return isVictory
        ? {
            code: 'PNT',
            title: 'OPENGUESSR APEX',
            description: 'Aligned camera perspective and scored precision bullseye within geofence.',
          }
        : {
            code: 'PNT',
            title: 'FIELD DEDUCER',
            description: 'Scouted and located target landmark across real-world terrain.',
          };
    case 'outbreak_horde':
    case 'horde':
      return isVictory
        ? {
            code: 'BIO',
            title: 'IMMUNE EXTRACTION',
            description: 'Outran infection swarm and preserved biological lifespan to extraction buzzer.',
          }
        : {
            code: 'BIO',
            title: 'HORDE VECTOR',
            description: 'Spread infection across park corridors and claimed conversion victory.',
          };
    case 'territory_pulse':
      return isVictory
        ? {
            code: 'PLS',
            title: 'ZONE DOMINANCE',
            description: 'Captured critical mass of tactical pulse sectors for team victory.',
          }
        : {
            code: 'PLS',
            title: 'CONTESTED RIVAL',
            description: 'Contested pulse nodes under intense opposing team pressure.',
          };
    case 'jailbreak':
      return isVictory
        ? (team === 'hunter'
            ? {
                code: 'WRD',
                title: 'IRON WARDEN',
                description: 'Maintained holding cell containment and eliminated runner extraction potential.',
              }
            : {
                code: 'BRK',
                title: 'LOCKSMITH HERO',
                description: 'Completed stealth lockpick holds and freed captured cellmates from holding.',
              })
        : {
            code: 'BRK',
            title: 'HOLDING CELL HERO',
            description: 'Stood resolute against hunter sweeps and pressured cell security.',
          };
    case 'relay_heist':
      return isVictory
        ? (team === 'runner'
            ? {
                code: 'RLY',
                title: 'ENCRYPTED COURIER',
                description: 'Maintained package handoffs and reached extraction point with carrier payload.',
              }
            : {
                code: 'RLY',
                title: 'VAULT INTERCEPTOR',
                description: 'Intercepted runner package carrier and secured vault telemetry for squad victory.',
              })
        : {
            code: 'RLY',
            title: 'RELAY CONTESTER',
            description: 'Battled in carrier recovery zones under intense tactical pressure.',
          };
    case 'assassin_ring':
      return isVictory
        ? {
            code: 'ASN',
            title: 'LONE PREDATOR',
            description: 'Fulfilled contract chain to emerge as sole surviving operative in the ring.',
          }
        : {
            code: 'ASN',
            title: 'TACTICAL CONTRACTOR',
            description: 'Tracked assigned prey across proximity pulses before contract reassignment.',
          };
    default:
      if (team === 'hunter') {
        return {
          code: 'APX',
          title: 'APEX TRACKER',
          description: `Secured tag within ${formatDuration(durationSeconds)} of deployment. Zero acoustic alerts triggered.`,
        };
      }
      return isVictory
        ? {
            code: 'GST',
            title: 'GHOST STEP',
            description: 'Successfully evaded hunter proximity vectors and completed operational run.',
          }
        : {
            code: 'VAL',
            title: 'VALIANT FALL',
            description: 'Held evasion vectors across multiple radar pulses before intercept.',
          };
  }
}

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

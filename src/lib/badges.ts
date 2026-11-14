/**
 * NF-11: Badges & Personal Records
 *
 * Defines the canonical tactical achievements catalog and evaluates match
 * outcomes to award milestone badges.
 */

export interface BadgeDefinition {
  id: string;
  title: string;
  description: string;
  category: 'survival' | 'tracking' | 'endurance' | 'milestone';
  icon: string;
}

export const BADGE_CATALOG: readonly BadgeDefinition[] = [
  {
    id: 'first_deployment',
    title: 'First Deployment',
    description: 'Complete your first live field operation',
    category: 'milestone',
    icon: 'shield-outline',
  },
  {
    id: 'veteran_operative',
    title: 'Veteran Operative',
    description: 'Deploy in 10 or more completed missions',
    category: 'milestone',
    icon: 'ribbon-outline',
  },
  {
    id: 'closest_call',
    title: 'Closest Call',
    description: 'Evade a hunter within 15 meters without getting tagged',
    category: 'survival',
    icon: 'flash-outline',
  },
  {
    id: 'ghost_whisperer',
    title: 'Ghost Whisperer',
    description: 'Survive an entire match as an un-tagged runner to victory',
    category: 'survival',
    icon: 'eye-off-outline',
  },
  {
    id: 'silent_step',
    title: 'Silent Step',
    description: 'Complete a mission with noise never exceeding 60 dB',
    category: 'survival',
    icon: 'volume-mute-outline',
  },
  {
    id: 'clean_sweep',
    title: 'Clean Sweep',
    description: 'Win a match as hunter with all runners eliminated',
    category: 'tracking',
    icon: 'radio-outline',
  },
  {
    id: 'marathoner',
    title: 'Marathoner',
    description: 'Accumulate over 5,000 meters in tactical field movement',
    category: 'endurance',
    icon: 'walk-outline',
  },
] as const;

export interface MatchBadgeEvaluationInput {
  role: 'runner' | 'hunter' | string;
  isVictory: boolean;
  isTagged: boolean;
  totalMatchesCount: number;
  cumulativeDistanceMeters: number;
  closestCallMeters?: number | null;
  loudestNoiseDb?: number | null;
  longestUnseenSeconds?: number;
}

/**
 * Pure evaluator checking which badges a player qualifies for based on match stats.
 */
export function evaluateEarnedBadges(
  input: MatchBadgeEvaluationInput,
  alreadyEarnedBadgeIds: Set<string> = new Set()
): string[] {
  const newEarned: string[] = [];

  const check = (badgeId: string, condition: boolean) => {
    if (condition && !alreadyEarnedBadgeIds.has(badgeId)) {
      newEarned.push(badgeId);
    }
  };

  // 1. First Deployment
  check('first_deployment', input.totalMatchesCount >= 1);

  // 2. Veteran Operative
  check('veteran_operative', input.totalMatchesCount >= 10);

  // 3. Closest Call
  if (typeof input.closestCallMeters === 'number') {
    check('closest_call', input.role === 'runner' && input.closestCallMeters > 0 && input.closestCallMeters <= 15);
  }

  // 4. Ghost Whisperer (un-tagged victorious runner)
  check('ghost_whisperer', input.role === 'runner' && input.isVictory && !input.isTagged);

  // 5. Silent Step
  if (typeof input.loudestNoiseDb === 'number') {
    check('silent_step', input.loudestNoiseDb > 0 && input.loudestNoiseDb <= 60);
  }

  // 6. Clean Sweep
  check('clean_sweep', input.role === 'hunter' && input.isVictory);

  // 7. Marathoner
  check('marathoner', input.cumulativeDistanceMeters >= 5000);

  return newEarned;
}

/**
 * GhostRun — Friends Board Core Logic (FL-P3)
 *
 * Types, privacy filters, and educational copy for the private friends board.
 */

import { EchoTier } from './echoCore';

export interface FriendsBoardEntry {
  rank: number;
  userId: string;
  displayName: string;
  handle?: string | null;
  seasonEcho: number;
  tier: EchoTier;
  roundsCounted: number;
  avgGhost: number; // Percentage (e.g. 61.1)
  avgCash: number; // Percentage (e.g. 31.3)
  isSelf: boolean;
}

export interface FriendsBoardResponse {
  canView: boolean;
  reason?: 'share_echo_disabled' | 'unauthenticated' | string;
  season: string;
  board: FriendsBoardEntry[];
}

export interface HeadToHeadStats {
  available: boolean;
  reason?: string;
  friendId?: string;
  friendName?: string;
  friendHandle?: string | null;
  oppositeRounds: number;
  myWins: number;
  friendWins: number;
  timesGhostedThem: number;
  timesTheyCashedMe: number;
}

/**
 * 60-Minute Privacy Delay Rule:
 * Rounds must have concluded at least 60 minutes ago to appear on friends boards.
 */
export const PRIVACY_DELAY_MINUTES = 60;

export function isRoundEligibleForBoard(
  endedAt: string,
  nowMs: number = Date.now(),
): boolean {
  const delayMs = PRIVACY_DELAY_MINUTES * 60 * 1000;
  const matchEndTime = new Date(endedAt).getTime();
  return nowMs - matchEndTime >= delayMs;
}

/**
 * Returns user-friendly empty state text depending on network size.
 */
export function getBoardEmptyStateMessage(friendCount: number): {
  title: string;
  subtitle: string;
} {
  if (friendCount === 0) {
    return {
      title: 'No Operatives Connected',
      subtitle: 'Add operatives by codename or share your invite link to build your tactical network.',
    };
  }
  if (friendCount < 2) {
    return {
      title: 'Squad Too Small',
      subtitle: 'Connect with two or more operatives to view friends on the seasonal leaderboard.',
    };
  }
  return {
    title: 'No Counted Rounds Yet',
    subtitle: 'Rounds appear here 60 minutes after match conclusion once at least 3 rounds are played.',
  };
}

/**
 * Structured content for the "How Echo Works" educational explainer.
 */
export const HOW_ECHO_WORKS_EXPLAINER = {
  title: 'How Echo Works',
  subtitle: 'The Delayed Ping Competitive Metric',
  sections: [
    {
      title: 'The Delayed Ping Contest',
      body: "GhostRun's unique contest is the delayed ping. Hunters see where a runner was, and the runner decides whether that echo leads anywhere. Echo rewards skill at this exact contest.",
    },
    {
      title: 'Ghost Rate (Runners)',
      body: "As a runner, you earn Echo by making pings lead nowhere. If you displace at least D_min from where you pinged and evade capture for window W, you've ghosted the hunters.",
    },
    {
      title: 'Cash Rate (Hunters)',
      body: 'As a hunter, you earn Echo by converting stale delayed pings into physical contact. Position for a ping, sprint within window Tc, and close the distance to cash it.',
    },
    {
      title: 'Fairness & Outcome',
      body: 'Team victory matters, but individual skill shines through: an outstanding runner on a losing team and a disciplined hunter on a losing team still earn high Echo.',
    },
    {
      title: '60-Minute Privacy Delay',
      body: 'To protect real-world physical safety, the friends board updates on an hourly batch and includes only rounds that finished at least 60 minutes earlier. Locations, routes, and times are never displayed.',
    },
  ],
  workedExamples: [
    {
      agent: 'Priya (Runner)',
      context: 'Team won • 6 contested pings, 4 ghosted • Active 90% • Difficulty D = 1.0',
      formula: '100 × (0.40 × 1.0 + 0.40 × 0.611 + 0.20 × 0.90) × 1.0',
      result: '82 Echo',
    },
    {
      agent: 'Sam (Hunter)',
      context: 'Team lost • 5 contested pings, 1 cashed • Moving 80% • Difficulty D = 1.0',
      formula: '100 × (0.40 × 0.0 + 0.40 × 0.3125 + 0.20 × 0.80) × 1.0',
      result: '29 Echo',
    },
  ],
};

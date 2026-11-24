/**
 * NF-28: Hosting Purchase & Monetisation Safeguards Core
 *
 * Standing Policy (F-D9):
 * - Monetisation is disabled by default ("monetisation_enabled: false").
 * - When disabled, all hosting features (including Event Mode) are 100% free and unrestricted.
 * - Standard community matches (up to 8 players) remain permanently free.
 */

export const FEATURE_MONETISATION_DEFAULT = false;

export type HostingTier = 'community_free' | 'event_host_pro';

export interface HostingProduct {
  id: string;
  name: string;
  description: string;
  priceFormatted: string;
  maxPlayers: number;
}

export const HOSTING_PRODUCTS: HostingProduct[] = [
  {
    id: 'host_pass_event',
    name: 'Event Host Pass',
    description: 'Host large tactical operations with up to 150 players and custom rule packs.',
    priceFormatted: '$4.99',
    maxPlayers: 150,
  },
];

export interface EntitlementCheckParams {
  monetisationEnabled: boolean;
  playerCount: number;
  hasPurchasedPro?: boolean;
}

export interface EntitlementResult {
  canHost: boolean;
  tier: HostingTier;
  reason?: string;
}

/**
 * Returns current monetisation status and human-readable policy summary
 */
export function getMonetisationStatus(enabled: boolean = FEATURE_MONETISATION_DEFAULT): {
  isMonetisationActive: boolean;
  canHostFreely: boolean;
  policy: string;
} {
  if (!enabled) {
    return {
      isMonetisationActive: false,
      canHostFreely: true,
      policy: 'All hosting tiers including Event Mode (up to 150 players) are 100% free and unblocked.',
    };
  }

  return {
    isMonetisationActive: true,
    canHostFreely: false,
    policy: 'Community matches up to 8 players are free; large events (> 8 players) require an Event Host Pass.',
  };
}

/**
 * Evaluates whether a player is authorized to host a match with the requested player count
 */
export function evaluateHostingEntitlement(params: EntitlementCheckParams): EntitlementResult {
  // If monetisation flag is off, hosting is 100% unrestricted for everyone
  if (!params.monetisationEnabled) {
    return {
      canHost: true,
      tier: 'community_free',
    };
  }

  // Community tier: free up to 8 players
  if (params.playerCount <= 8) {
    return {
      canHost: true,
      tier: 'community_free',
    };
  }

  // Large match (> 8 players) with pro entitlement
  if (params.hasPurchasedPro) {
    return {
      canHost: true,
      tier: 'event_host_pro',
    };
  }

  return {
    canHost: false,
    tier: 'community_free',
    reason: 'Matches with more than 8 players require an Event Host Pass when monetisation is active.',
  };
}

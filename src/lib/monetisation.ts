/**
 * NF-28: Hosting Purchase & Monetisation Client Module
 */

import {
  HostingProduct,
  HOSTING_PRODUCTS,
  evaluateHostingEntitlement,
  EntitlementResult,
  FEATURE_MONETISATION_DEFAULT,
  getMonetisationStatus,
} from './monetisationCore';
import { fetchRemoteConfigFlags } from './admin';

export * from './monetisationCore';

/**
 * Checks if user is permitted to host a match of the specified size
 */
export async function checkCanHostMatch(playerCount: number): Promise<EntitlementResult> {
  const { flags } = await fetchRemoteConfigFlags();
  const monetisationEnabled = Boolean(flags.monetisation_enabled ?? FEATURE_MONETISATION_DEFAULT);

  return evaluateHostingEntitlement({
    monetisationEnabled,
    playerCount,
    hasPurchasedPro: false,
  });
}

/**
 * Lists available hosting products
 */
export function getHostingProducts(): HostingProduct[] {
  return [...HOSTING_PRODUCTS];
}

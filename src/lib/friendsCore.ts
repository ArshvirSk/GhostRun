/**
 * GhostRun — Friends Graph Core Logic (FL-P1)
 *
 * Types, constraints, and presence validation for peer connections.
 */

export const MAX_FRIEND_REQUESTS_PER_DAY = 10;
export const MAX_PENDING_REQUESTS = 20;
export const MAX_FRIENDS = 200;
export const DECLINE_COOLDOWN_DAYS = 7;
export const PRESENCE_TTL_MINUTES = 30;

export interface FriendProfile {
  userId: string;
  displayName: string;
  handle?: string | null;
  color: string;
  showPresence: boolean;
  shareEcho: boolean;
  friendsSince?: string | null;
}

export interface FriendRequest {
  requesterId?: string;
  targetId?: string;
  displayName: string;
  handle?: string | null;
  color: string;
  requestedAt: string;
}

export interface HostPresence {
  hostId: string;
  hostName: string;
  hostHandle?: string | null;
  gameId: string;
  modeId: string;
  playerCount: number;
  expiresAt: string;
}

export interface SearchedOperative {
  id: string;
  displayName: string;
  handle: string | null;
  color: string;
  relationship: 'friend' | 'pending_outgoing' | 'pending_incoming' | 'none';
}

export interface FriendSettings {
  allowFriendRequests: boolean;
  showPresence: boolean;
  shareEcho: boolean;
}

/**
 * Returns canonical sorted user UUIDs [user_a, user_b] where user_a < user_b.
 */
export function canonicalFriendPair(uid1: string, uid2: string): [string, string] {
  return uid1 < uid2 ? [uid1, uid2] : [uid2, uid1];
}

/**
 * Checks if a decline cooldown is still active given responded_at timestamp.
 */
export function isDeclineCooldownActive(
  respondedAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!respondedAt) return false;
  const cooldownMs = DECLINE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const declineTime = new Date(respondedAt).getTime();
  return nowMs - declineTime < cooldownMs;
}

/**
 * Verifies whether an ephemeral presence entry has expired.
 */
export function isPresenceExpired(
  expiresAt: string,
  nowMs: number = Date.now(),
): boolean {
  return new Date(expiresAt).getTime() <= nowMs;
}

/**
 * Formats a friend invite shareable URL.
 */
export function formatFriendInviteUrl(token: string, baseUrl: string = 'https://ghostrun.app'): string {
  return `${baseUrl}/join?friend_invite=${token}`;
}

/**
 * Formats a tactical deep link to open GhostRun directly to add an operative.
 */
export function formatFriendDeepLink(identifier: string): string {
  return `ghost-run://friends?add=${encodeURIComponent(identifier)}`;
}

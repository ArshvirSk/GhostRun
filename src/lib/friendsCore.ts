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

export type ProfileVisibility = 'public' | 'private';

export interface OperativeProfileDossier {
  found: boolean;
  userId: string;
  displayName: string;
  handle: string | null;
  color: string;
  visibility: ProfileVisibility;
  isFriend: boolean;
  isSelf: boolean;
  friendshipStatus: 'friend' | 'pending_incoming' | 'pending_outgoing' | 'none' | 'self';
  isRedacted: boolean;
  presence?: {
    online: boolean;
    gameId?: string;
    modeId?: string;
    playerCount?: number;
    expiresAt?: string;
  } | null;
  tier?: string;
  seasonEcho?: number;
  avgGhost?: number;
  avgCash?: number;
  rounds?: number;
  won?: number;
  winRate?: number;
  neverCaught?: number;
  bestEscape?: string;
  farthestMeters?: number;
  badges?: string[];
  headToHead?: {
    oppositeRounds: number;
    myWins: number;
    friendWins: number;
    timesGhostedThem: number;
    timesTheyCashedMe: number;
  } | null;
  recentMatches?: Array<{
    game_id: string;
    mode_id: string;
    team: string;
    won: boolean;
    created_at: string;
  }>;
}

export interface FriendSettings {
  allowFriendRequests: boolean;
  showPresence: boolean;
  shareEcho: boolean;
  profileVisibility?: ProfileVisibility;
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

export const GHOSTRUN_WEB_URL = 'https://arshvirsk.github.io/GhostRun';

/**
 * Formats a friend invite shareable URL.
 */
export function formatFriendInviteUrl(token: string, baseUrl: string = GHOSTRUN_WEB_URL): string {
  return `${baseUrl}/join?friend_invite=${token}`;
}

/**
 * Formats a tactical deep link to open GhostRun directly to add an operative.
 */
export function formatFriendDeepLink(identifier: string): string {
  return `ghost-run://friends?add=${encodeURIComponent(identifier)}`;
}

/**
 * Formats a clickable HTTPS web link that opens in browsers and redirects to GhostRun.
 */
export function formatFriendWebInviteUrl(identifier: string): string {
  return `${GHOSTRUN_WEB_URL}/invite?add=${encodeURIComponent(identifier)}`;
}

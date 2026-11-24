/**
 * NF-06: Safety Check-in, Emergency SOS & Curfew Guards Core
 * Pure TypeScript domain functions with zero native UI or React dependencies.
 */

export interface SafetyParams {
  checkin_interval_m?: number;
  curfew_time?: string;
  emergency_contacts_enabled?: boolean;
}

export interface CheckinMissedPayload {
  player_id: string;
  display_name: string;
  team: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
  message: string;
}

export interface EmergencySosPayload {
  player_id: string;
  display_name: string;
  team: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
  emergency: true;
  message: string;
}

/**
 * Returns true if a match curfew has expired.
 */
export function isCurfewExpired(
  curfewIso: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!curfewIso) return false;
  const curfewMs = Date.parse(curfewIso);
  return Number.isFinite(curfewMs) && nowMs >= curfewMs;
}

/**
 * Returns the remaining seconds until curfew expiration, or null if no curfew is set.
 * Clamps to 0 if curfew is in the past.
 */
export function getCurfewRemainingSeconds(
  curfewIso: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (!curfewIso) return null;
  const curfewMs = Date.parse(curfewIso);
  if (!Number.isFinite(curfewMs)) return null;
  return Math.max(0, Math.floor((curfewMs - nowMs) / 1000));
}

/**
 * Resolves the safety check-in interval in minutes.
 * Priority:
 * 1. Host override via safetyParams.checkin_interval_m
 * 2. Nocturnal default: 10 minutes
 * 3. Diurnal default: 15 minutes
 */
export function resolveCheckinIntervalMinutes(
  safetyParams: SafetyParams | undefined,
  isNight: boolean
): number {
  if (safetyParams?.checkin_interval_m && safetyParams.checkin_interval_m > 0) {
    return safetyParams.checkin_interval_m;
  }
  return isNight ? 10 : 15;
}

/**
 * Resolves the broadcast audience for a missed check-in alert.
 * In squad/team modes, the alert is sent strictly to teammates to prevent location leakage to opponents.
 * In solo modes (ghost_duel, assassin_ring), it is broadcast to all participants for safety.
 */
export function getMissedCheckinAudience(
  modeId: string,
  playerTeam: 'runner' | 'hunter' | string
): 'runner' | 'hunter' | 'all' {
  if (['ghost_duel', 'assassin_ring'].includes(modeId)) {
    return 'all';
  }
  return playerTeam === 'hunter' ? 'hunter' : 'runner';
}

/**
 * Constructs the payload for a missed check-in alert.
 */
export function buildMissedCheckinPayload(
  playerId: string,
  displayName: string,
  team: string,
  lat: number,
  lng: number,
  recordedAt: string = new Date().toISOString()
): CheckinMissedPayload {
  return {
    player_id: playerId,
    display_name: displayName,
    team,
    latitude: lat,
    longitude: lng,
    recorded_at: recordedAt,
    message: `${displayName} missed safety check-in!`,
  };
}

/**
 * Constructs the payload for an Emergency SOS broadcast.
 */
export function buildEmergencySosPayload(
  playerId: string,
  displayName: string,
  team: string,
  lat: number,
  lng: number,
  recordedAt: string = new Date().toISOString()
): EmergencySosPayload {
  return {
    player_id: playerId,
    display_name: displayName,
    team,
    latitude: lat,
    longitude: lng,
    recorded_at: recordedAt,
    emergency: true,
    message: `EMERGENCY SOS: ${displayName} has triggered distress beacon!`,
  };
}

/**
 * Calculates remaining seconds in a 60-second check-in countdown window.
 */
export function calculateCheckinCountdownRemaining(
  startedAtMs: number,
  timeoutSeconds: number = 60,
  nowMs: number = Date.now()
): number {
  const elapsed = Math.floor((nowMs - startedAtMs) / 1000);
  return Math.max(0, timeoutSeconds - elapsed);
}

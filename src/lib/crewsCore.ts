/**
 * NF-16: Persistent Crews & Squad Lists Core Engine
 *
 * Privacy Guarantees:
 * - Crew membership is minimal (crew_id, user_id, role).
 * - No location, GPS, or presence coordinates are ever stored or exposed.
 * - Deletion of an account cascades and removes user from all crews.
 */

export interface Crew {
  id: string;
  name: string;
  code: string;
  created_by: string;
  created_at: string;
  member_count?: number;
  my_role?: 'captain' | 'member';
}

export interface CrewMember {
  crew_id: string;
  user_id: string;
  role: 'captain' | 'member';
  joined_at: string;
  display_name?: string;
}

export interface CrewValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate crew name (3 to 30 characters, non-empty)
 */
export function validateCrewName(name: string): CrewValidationResult {
  const trimmed = (name || '').trim();
  if (trimmed.length < 3) {
    return { valid: false, error: 'Crew name must be at least 3 characters long.' };
  }
  if (trimmed.length > 30) {
    return { valid: false, error: 'Crew name cannot exceed 30 characters.' };
  }
  return { valid: true };
}

/**
 * Normalizes a crew code to uppercase without whitespace or symbols
 */
export function normalizeCrewCode(code: string): string {
  return (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Validate crew code format (4 to 8 alphanumeric characters)
 */
export function validateCrewCode(code: string): CrewValidationResult {
  const clean = normalizeCrewCode(code);
  if (clean.length < 4 || clean.length > 8) {
    return { valid: false, error: 'Crew code must be 4 to 8 alphanumeric characters.' };
  }
  return { valid: true };
}

/**
 * Generate formatted invite message for messaging or social channels
 */
export function formatCrewInviteText(crewName: string, crewCode: string): string {
  return [
    `Join my GhostRun Crew: [${crewName.toUpperCase()}]`,
    `Crew Code: ${crewCode.toUpperCase()}`,
    `--------------------------------`,
    `Enter this code in GhostRun to deploy together on upcoming patrols.`,
    `ghostrun.app`,
  ].join('\n');
}

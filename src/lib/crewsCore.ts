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
 * Formats a privacy-preserving tactical crew invitation message
 */
export function formatCrewInviteText(crewName: string, crewCode: string): string {
  const cleanName = (crewName || 'Ghost Squad').trim().toUpperCase();
  const cleanCode = normalizeCrewCode(crewCode);

  return [
    `GHOSTRUN TACTICAL SQUAD INVITE`,
    `Join Crew: ${cleanName}`,
    `Squad Code: ${cleanCode}`,
    `Assemble your operatives: https://ghostrun.app/crew?code=${cleanCode}`,
  ].join('\n');
}

/**
 * Evaluates whether an operative has permission to perform a crew action.
 */
export function canUserPerformCrewAction(
  role: 'captain' | 'member' | undefined,
  action: 'edit_name' | 'regenerate_code' | 'disband' | 'leave' | 'invite'
): boolean {
  if (!role) return false;
  if (action === 'invite') return true; // All members can invite
  if (action === 'leave') return true; // Any member can leave (captain reassigns or disbands)
  // Destructive / administrative actions require captain role
  return role === 'captain';
}

/**
 * Formats a concise roster summary for UI headers.
 */
export function formatCrewRosterSummary(crew: Crew, memberCount: number = 0): string {
  const count = crew.member_count ?? memberCount;
  const countLabel = count === 1 ? '1 Operative' : `${count} Operatives`;
  const roleLabel = crew.my_role === 'captain' ? 'CAPTAIN' : 'MEMBER';
  return `${crew.name.toUpperCase()} [${crew.code}] · ${countLabel} · ${roleLabel}`;
}

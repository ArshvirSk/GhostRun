/**
 * GhostRun — Handles Core Logic (FL-P0)
 *
 * Enforces character constraints, length boundaries, reserved identifiers,
 * and case-insensitive normalization for player @handles.
 */

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'moderator',
  'mod',
  'operator',
  'ghostrun',
  'ghostrunapp',
  'support',
  'system',
  'security',
  'official',
  'help',
  'emergency',
  'hunter',
  'runner',
  'ghost',
  'ai_gm',
  'referee',
  'guest',
  'null',
  'undefined',
  'anonymous',
  'everyone',
  'all',
  'root',
  'staff',
  'dev',
  'deepmind',
  'google',
]);

export interface HandleValidationResult {
  valid: boolean;
  normalized?: string;
  error?: 'empty' | 'too_short' | 'too_long' | 'invalid_chars' | 'consecutive_underscores' | 'reserved';
}

/**
 * Validates a prospective player handle.
 *
 * Rules:
 * - 3 to 20 characters
 * - Letters, numbers, and single underscores
 * - Cannot start or end with underscore
 * - Cannot contain consecutive underscores (__)
 * - Cannot match reserved system terms
 */
export function validateHandle(rawHandle: string): HandleValidationResult {
  if (!rawHandle) {
    return { valid: false, error: 'empty' };
  }

  const trimmed = rawHandle.trim();
  if (trimmed.length < 3) {
    return { valid: false, error: 'too_short' };
  }

  if (trimmed.length > 20) {
    return { valid: false, error: 'too_long' };
  }

  if (trimmed.includes('__')) {
    return { valid: false, error: 'consecutive_underscores' };
  }

  const formatRegex = /^[A-Za-z0-9][A-Za-z0-9_]{1,18}[A-Za-z0-9]$/;
  if (!formatRegex.test(trimmed)) {
    return { valid: false, error: 'invalid_chars' };
  }

  const lower = trimmed.toLowerCase();
  if (RESERVED_HANDLES.has(lower)) {
    return { valid: false, error: 'reserved' };
  }

  return {
    valid: true,
    normalized: trimmed,
  };
}

/**
 * Formats a handle with the standard leading '@'.
 */
export function formatHandleDisplay(handle?: string | null): string {
  if (!handle) return '';
  return handle.startsWith('@') ? handle : `@${handle}`;
}

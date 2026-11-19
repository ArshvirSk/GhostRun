/**
 * GhostRun — Codename & Username Standardization Utility
 *
 * Enforces tactical codename invariants:
 * - Standardized to ALL CAPS
 * - Single-space normalization (collapsing consecutive whitespace)
 * - Space-insensitive, underscore-insensitive matching for searches and friend discovery
 * - Safe character filtering (A-Z, 0-9, single spaces, underscores)
 */

export interface CodenameValidation {
  valid: boolean;
  clean: string;
  error?: string;
}

/**
 * Sanitizes a codename string:
 * - Trims leading/trailing whitespace
 * - Collapses internal whitespace to single spaces
 * - Strips characters outside [A-Z0-9 _]
 * - Converts to uppercase
 * - Caps at 20 characters
 */
export function sanitizeCodename(raw: string): string {
  if (!raw) return '';
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 _]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}

/**
 * Validates a codename according to GhostRun protocol:
 * - 2 to 20 characters after trimming
 * - Must contain at least one alphanumeric character
 */
export function validateCodename(raw: string): CodenameValidation {
  const clean = sanitizeCodename(raw).trim();

  if (clean.length < 2) {
    return {
      valid: false,
      clean,
      error: 'Codename must be at least 2 characters.',
    };
  }

  if (clean.length > 20) {
    return {
      valid: false,
      clean: clean.slice(0, 20),
      error: 'Codename cannot exceed 20 characters.',
    };
  }

  if (!/[A-Z0-9]/.test(clean)) {
    return {
      valid: false,
      clean,
      error: 'Codename must contain at least one letter or number.',
    };
  }

  return {
    valid: true,
    clean,
  };
}

/**
 * Normalizes a codename or handle query for space-insensitive,
 * case-insensitive, symbol-insensitive search matching.
 *
 * Examples:
 * - "@Alpha_OP" -> "alphaop"
 * - "Jash Damania" -> "jashdamania"
 * - "Ghost-Runner " -> "ghostrunner"
 */
export function normalizeForSearch(raw: string): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[\s_\-]+/g, '');
}

/**
 * Converts a codename into a canonical database handle if none exists:
 * - Lowercase
 * - Spaces replaced by single underscores
 * - Trimmed of leading/trailing underscores
 */
export function codenameToHandle(codename: string): string {
  const clean = sanitizeCodename(codename).trim();
  return clean
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
}

/**
 * Checks whether an operative's display name or handle matches a search query,
 * handling spaces, underscores, and case variations flexibly.
 */
export function matchesSearchQuery(
  query: string,
  displayName?: string | null,
  handle?: string | null
): boolean {
  const cleanQuery = query.trim();
  if (!cleanQuery) return true;

  const normQuery = normalizeForSearch(cleanQuery);
  if (!normQuery) return true;

  if (displayName) {
    const normDisplayName = normalizeForSearch(displayName);
    if (normDisplayName.includes(normQuery)) return true;
  }

  if (handle) {
    const normHandle = normalizeForSearch(handle);
    if (normHandle.includes(normQuery)) return true;
  }

  return false;
}

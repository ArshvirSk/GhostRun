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
 * Sanitizes a tactical discriminator tagline:
 * - Upper-case alphanumeric [A-Z0-9]
 * - Strips leading '#'
 * - 3 to 5 characters
 */
export function sanitizeTagline(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .toUpperCase()
    .replace(/^#/, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
}

/**
 * Validates a tagline: 3 to 5 uppercase alphanumeric chars
 */
export function validateTagline(raw?: string | null): { valid: boolean; clean: string; error?: string } {
  const clean = sanitizeTagline(raw);
  if (clean.length < 3) {
    return { valid: false, clean, error: 'Tagline must be at least 3 characters.' };
  }
  if (clean.length > 5) {
    return { valid: false, clean: clean.slice(0, 5), error: 'Tagline cannot exceed 5 characters.' };
  }
  return { valid: true, clean };
}

/**
 * Parses input string that may contain a discriminator tag (e.g. "ALPHAOP#10D1" or "ALPHA OP")
 */
export function parseCodenameAndTag(raw: string): { codename: string; tag?: string } {
  if (!raw) return { codename: '' };
  const trimmed = raw.trim();
  const hashIdx = trimmed.indexOf('#');
  if (hashIdx >= 0) {
    const codename = sanitizeCodename(trimmed.slice(0, hashIdx));
    const tag = sanitizeTagline(trimmed.slice(hashIdx + 1));
    return { codename, tag: tag || undefined };
  }
  return { codename: sanitizeCodename(trimmed) };
}

/**
 * Formats a codename with its discriminator tag (e.g. "ALPHAOP#10D1")
 */
export function formatCodenameWithTag(name: string, tag?: string | null): string {
  const cleanName = sanitizeCodename(name);
  if (!tag) return cleanName;
  const cleanTag = sanitizeTagline(tag);
  return cleanTag ? `${cleanName}#${cleanTag}` : cleanName;
}

/**
 * Checks whether an operative's display name, handle, or tagline matches a search query,
 * handling spaces, underscores, case, and Valorant-style #TAG queries.
 */
export function matchesSearchQuery(
  query: string,
  displayName?: string | null,
  handle?: string | null,
  tagline?: string | null
): boolean {
  const cleanQuery = query.trim();
  if (!cleanQuery) return true;

  // Check if query is searching for NAME#TAG or #TAG
  if (cleanQuery.includes('#')) {
    const { codename, tag } = parseCodenameAndTag(cleanQuery);
    if (tag && tagline && tagline.toUpperCase() !== tag.toUpperCase()) {
      return false;
    }
    if (codename && displayName) {
      return normalizeForSearch(displayName).includes(normalizeForSearch(codename));
    }
    return Boolean(tag && tagline && tagline.toUpperCase() === tag.toUpperCase());
  }

  const normQuery = normalizeForSearch(cleanQuery);
  if (!normQuery) return true;

  if (displayName && normalizeForSearch(displayName).includes(normQuery)) return true;
  if (handle && normalizeForSearch(handle).includes(normQuery)) return true;
  if (tagline && tagline.toLowerCase().includes(normQuery)) return true;

  return false;
}

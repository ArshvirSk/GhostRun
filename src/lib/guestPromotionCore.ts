/**
 * GhostRun - Guest Promotion Core Logic & Validation
 * Pure TypeScript functions with zero React Native native module dependencies.
 */

export interface PromotionValidationResult {
  valid: boolean;
  error?: string;
}

export interface MinimalUser {
  id: string;
  email?: string | null;
  is_anonymous?: boolean;
  app_metadata?: {
    provider?: string;
    [key: string]: unknown;
  };
  email_confirmed_at?: string | null;
}

export interface AccountStatus {
  isGuest: boolean;
  id: string | null;
  email: string | null;
  isConfirmed: boolean;
}

/**
 * Checks whether a user account is an ephemeral anonymous guest.
 */
export function isAnonymousUser(user: MinimalUser | null | undefined): boolean {
  if (!user) return false;
  return Boolean(user.is_anonymous || (!user.email && user.app_metadata?.provider === 'anonymous'));
}

/**
 * Validates email and password requirements before attempting account promotion.
 */
export function validatePromotionCredentials(email: string, password: string): PromotionValidationResult {
  const trimmedEmail = (email || '').trim().toLowerCase();
  const trimmedPassword = password || '';

  if (!trimmedEmail) {
    return { valid: false, error: 'Email address is required.' };
  }

  // Basic RFC 5322 email regex check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return { valid: false, error: 'Enter a valid email address.' };
  }

  if (!trimmedPassword || trimmedPassword.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters long.' };
  }

  return { valid: true };
}

/**
 * Formats account promotion errors into actionable feedback.
 */
export function formatPromotionError(error: unknown): string {
  if (!error) return 'An unknown error occurred during account promotion.';
  const msg = typeof error === 'string' ? error : (error as { message?: string })?.message || '';

  if (msg.includes('already registered') || msg.includes('email_exists') || msg.includes('User already registered')) {
    return 'An account with this email already exists. Sign in instead.';
  }

  if (msg.includes('Password should be')) {
    return 'Password must be at least 6 characters long.';
  }

  return msg || 'Failed to promote guest account.';
}

/**
 * Generates an operative profile payload for newly instantiated anonymous guests.
 */
export function createDefaultGuestProfile(userId: string): { id: string; display_name: string; color: string } {
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return {
    id: userId,
    display_name: `GUEST-${randomSuffix}`,
    color: '#10B981',
  };
}

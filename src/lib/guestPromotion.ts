import { supabase } from './supabase';
import type { User } from '@supabase/supabase-js';
import {
  isAnonymousUser,
  validatePromotionCredentials,
  formatPromotionError,
  createDefaultGuestProfile,
  type AccountStatus,
  type PromotionValidationResult,
  type MinimalUser,
} from './guestPromotionCore';

export * from './guestPromotionCore';

export interface PromotionResult {
  success: boolean;
  user?: User | null;
  error?: string;
}

/**
 * Inspects the current session and returns the user's account tier.
 */
export async function getAccountStatus(): Promise<AccountStatus> {
  if (!supabase) {
    return { isGuest: false, id: null, email: null, isConfirmed: false };
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return { isGuest: false, id: null, email: null, isConfirmed: false };
    }

    const user = session.user;
    const isGuest = isAnonymousUser(user);

    return {
      isGuest,
      id: user.id,
      email: user.email || null,
      isConfirmed: Boolean(user.email_confirmed_at),
    };
  } catch {
    return { isGuest: false, id: null, email: null, isConfirmed: false };
  }
}

/**
 * Promotes an anonymous guest session to a permanent email/password account.
 * Crucially, this retains the exact same user.id, preserving all existing
 * game statistics, profile information, squad allies, and season achievements.
 */
export async function promoteGuestWithEmail(
  email: string,
  password: string
): Promise<PromotionResult> {
  const validation = validatePromotionCredentials(email, password);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (!supabase) {
    return { success: false, error: 'Database service is not configured.' };
  }

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return { success: false, error: 'No active session found to promote.' };
    }

    if (!isAnonymousUser(user)) {
      return {
        success: false,
        error: 'This account is already permanently registered.',
      };
    }

    const { data, error } = await supabase.auth.updateUser({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      return { success: false, error: formatPromotionError(error) };
    }

    return {
      success: true,
      user: data.user,
    };
  } catch (err) {
    return {
      success: false,
      error: formatPromotionError(err),
    };
  }
}

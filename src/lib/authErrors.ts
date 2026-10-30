import type { AuthError } from '@supabase/supabase-js';

/** Turns a Supabase auth error into copy a player can act on. */
export function authErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'Email or password is incorrect.';
    case 'email_not_confirmed':
      return 'Confirm your email address first. Check your inbox for the link.';
    case 'email_exists':
    case 'user_already_exists':
      return 'An account already exists for this email. Sign in instead.';
    case 'weak_password':
      return 'Choose a password with at least 6 characters.';
    case 'same_password':
      return 'Choose a password you have not used before.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts right now. Wait a moment, then try again.';
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'Email sign-ups are disabled for this project.';
    case 'email_address_invalid':
      return 'That email address is not accepted. Try another one.';
    case 'otp_expired':
      return 'That link has expired. Request a new one.';
    default:
      return error.message;
  }
}

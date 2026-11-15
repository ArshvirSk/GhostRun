/**
 * GhostRun - Google Auth Core Logic & Sanitization
 * Pure TypeScript functions with zero React Native native module dependencies.
 */

export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';

export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';

export interface GoogleAuthResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
  user?: any;
  session?: any;
}

export interface GoogleProfileData {
  id: string;
  email: string;
  name?: string | null;
  photo?: string | null;
  familyName?: string | null;
  givenName?: string | null;
}

/**
 * Checks whether Google Sign-In is configured with client IDs.
 */
export function isGoogleSignInConfigured(webClientId: string = GOOGLE_WEB_CLIENT_ID): boolean {
  return Boolean(webClientId && webClientId.trim().length > 0);
}

/**
 * Evaluates Google Sign-In error codes and messages into actionable, tactical user feedback.
 */
export function formatGoogleAuthError(code?: string | number, message?: string): string {
  const codeStr = String(code || '');
  const msgStr = String(message || '');

  if (codeStr === 'SIGN_IN_CANCELLED' || codeStr === '12501') {
    return 'Sign in was cancelled.';
  }

  if (codeStr === 'IN_PROGRESS') {
    return 'Google Sign-In is already in progress.';
  }

  if (codeStr === 'PLAY_SERVICES_NOT_AVAILABLE' || codeStr === '12500') {
    return 'Google Play Services is not available or outdated on this device.';
  }

  if (msgStr.includes('DEVELOPER_ERROR') || codeStr === '10') {
    return 'Google Sign-In setup error (DEVELOPER_ERROR: check SHA-1 certificate fingerprint and Web Client ID in Google Cloud Console).';
  }

  if (msgStr.includes('network') || codeStr === '7') {
    return 'Network connection error. Check your internet connection and try again.';
  }

  if (msgStr.includes('oauth_provider_disabled')) {
    return 'Google provider is not enabled in your Supabase Auth settings.';
  }

  return msgStr || 'Google Sign-In encountered an unexpected error.';
}

/**
 * Validates Google OAuth deep-link redirect URLs.
 */
export function parseOAuthRedirectUrl(url: string): {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
} {
  if (!url) return {};

  // Check URL query parameters
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');

  let queryString = '';
  if (queryIndex !== -1) {
    queryString = hashIndex !== -1 && hashIndex > queryIndex
      ? url.substring(queryIndex + 1, hashIndex)
      : url.substring(queryIndex + 1);
  }

  // Check hash fragment parameters
  let hashString = '';
  if (hashIndex !== -1) {
    hashString = url.substring(hashIndex + 1);
  }

  const parseParams = (params: string): Record<string, string> => {
    const result: Record<string, string> = {};
    if (!params) return result;
    const pairs = params.split('&');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key) {
        const cleanValue = (value || '').replace(/\+/g, ' ');
        result[decodeURIComponent(key)] = decodeURIComponent(cleanValue);
      }
    }
    return result;
  };

  const queryMap = parseParams(queryString);
  const hashMap = parseParams(hashString);

  return {
    code: queryMap.code || hashMap.code,
    accessToken: hashMap.access_token || queryMap.access_token,
    refreshToken: hashMap.refresh_token || queryMap.refresh_token,
    error: queryMap.error_description || queryMap.error || hashMap.error_description || hashMap.error,
  };
}

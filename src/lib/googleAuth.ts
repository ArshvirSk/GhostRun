import { Platform } from 'react-native';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase, isSupabaseConfigured } from './supabase';
import {
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
  formatGoogleAuthError,
  parseOAuthRedirectUrl,
  GoogleAuthResult,
} from './googleAuthCore';

export * from './googleAuthCore';

let isInitialized = false;

/**
 * Safe initializer for Google Sign-In native module.
 */
export function initGoogleSignIn(): void {
  if (isInitialized) return;
  try {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
      iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
      offlineAccess: true,
    });
    isInitialized = true;
  } catch (err) {
    console.warn('[GoogleAuth] Native GoogleSignin.configure error:', err);
  }
}

/**
 * Signs in the user using Google credentials.
 *
 * 1. Primary Path (Native): Uses Google Play Services / native sheet to obtain
 *    an ID Token, then invokes supabase.auth.signInWithIdToken().
 * 2. Fallback Path (Web/Browser OAuth): If native module is not ready or on Web,
 *    invokes supabase.auth.signInWithOAuth() within an in-app browser session.
 */
export async function signInWithGoogle(): Promise<GoogleAuthResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'Tactical network unreachable. Supabase is not configured.',
    };
  }

  // Attempt native Google Play Services sign-in on Android/iOS
  if (Platform.OS !== 'web' && GOOGLE_WEB_CLIENT_ID) {
    try {
      initGoogleSignIn();
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      const response = await GoogleSignin.signIn();

      if (response.type === 'cancelled') {
        return { success: false, cancelled: true };
      }

      const idToken = response.data?.idToken;
      if (!idToken) {
        throw new Error('Google Sign-In succeeded but did not return a valid ID token.');
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });

      if (error) {
        return {
          success: false,
          error: formatGoogleAuthError(error.code, error.message),
        };
      }

      return {
        success: true,
        session: data.session,
        user: data.user,
      };
    } catch (err: any) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        return { success: false, cancelled: true };
      }

      const formattedError = formatGoogleAuthError(err.code, err.message);
      console.warn('[GoogleAuth] Native sign-in warning:', formattedError);
      return {
        success: false,
        error: formattedError,
      };
    }
  }

  // Fallback OAuth WebBrowser flow
  try {
    WebBrowser.maybeCompleteAuthSession();
    const redirectUrl = Linking.createURL('/signin');

    const { data: oauthData, error: oauthError } =
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

    if (oauthError) {
      return {
        success: false,
        error: formatGoogleAuthError(oauthError.code, oauthError.message),
      };
    }

    if (!oauthData?.url) {
      return {
        success: false,
        error:
          'Google Sign-In is not configured. Please set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and enable the Google provider in Supabase.',
      };
    }

    const authResult = await WebBrowser.openAuthSessionAsync(
      oauthData.url,
      redirectUrl
    );

    if (authResult.type === 'cancel' || authResult.type === 'dismiss') {
      return { success: false, cancelled: true };
    }

    if (authResult.type === 'success' && authResult.url) {
      const parsed = parseOAuthRedirectUrl(authResult.url);

      if (parsed.error) {
        return { success: false, error: parsed.error };
      }

      if (parsed.code) {
        const { data: sessionData, error: sessionError } =
          await supabase.auth.exchangeCodeForSession(parsed.code);

        if (sessionError) {
          return {
            success: false,
            error: formatGoogleAuthError(sessionError.code, sessionError.message),
          };
        }

        return {
          success: true,
          session: sessionData.session,
          user: sessionData.user,
        };
      }

      if (parsed.accessToken && parsed.refreshToken) {
        const { data: setSessionData, error: setSessionError } =
          await supabase.auth.setSession({
            access_token: parsed.accessToken,
            refresh_token: parsed.refreshToken,
          });

        if (setSessionError) {
          return {
            success: false,
            error: formatGoogleAuthError(setSessionError.code, setSessionError.message),
          };
        }

        return {
          success: true,
          session: setSessionData.session,
          user: setSessionData.user,
        };
      }

      // Check current session
      const { data: sessionCheck } = await supabase.auth.getSession();
      if (sessionCheck.session) {
        return {
          success: true,
          session: sessionCheck.session,
          user: sessionCheck.session.user,
        };
      }
    }

    return {
      success: false,
      error: 'Google authentication did not complete.',
    };
  } catch (webErr: any) {
    return {
      success: false,
      error: formatGoogleAuthError(webErr?.code, webErr?.message),
    };
  }
}

/**
 * Signs out from Google Sign-In session if active.
 */
export async function signOutGoogle(): Promise<void> {
  try {
    if (Platform.OS !== 'web') {
      initGoogleSignIn();
      const hasSignedIn = await GoogleSignin.hasPreviousSignIn();
      if (hasSignedIn) {
        await GoogleSignin.signOut();
      }
    }
  } catch (err) {
    console.warn('[GoogleAuth] Sign-out error:', err);
  }
}

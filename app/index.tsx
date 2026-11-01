import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PRIVACY_VERSION } from '../src/lib/privacy';
import { isSupabaseConfigured, supabase } from '../src/lib/supabase';

const GHOSTRUN_LOGO = require('../assets/logos/android-chrome-512x512.png');

export default function SplashScreen() {
  const router = useRouter();
  const [statusMessage, setStatusMessage] = useState('Initializing stealth radar…');
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [scaleAnim] = useState(() => new Animated.Value(0.85));
  const [pulseAnim] = useState(() => new Animated.Value(1));

  // Logo entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 40,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    return () => pulse.stop();
  }, [fadeAnim, scaleAnim, pulseAnim]);

  const bootstrapApp = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setHasError(true);
      setErrorMessage('Supabase is not configured. Add your project URL and anon key to continue.');
      return;
    }

    try {
      // Allow user to appreciate the sleek splash animation for at least 1.4 seconds
      const minDisplayPromise = new Promise((resolve) => setTimeout(resolve, 1400));
      const onboardedPromise = AsyncStorage.getItem('@ghostrun:onboarded');
      const sessionPromise = supabase.auth.getSession();

      const [, onboardedVal, sessionRes] = await Promise.all([
        minDisplayPromise,
        onboardedPromise,
        sessionPromise,
      ]);

      if (sessionRes.error) {
        setHasError(true);
        setErrorMessage(sessionRes.error.message);
        return;
      }

      // If user hasn't seen onboarding, send them to onboarding
      if (onboardedVal !== 'true') {
        router.replace('/onboarding' as any);
        return;
      }

      // If no active session, send to auth
      if (!sessionRes.data.session) {
        router.replace('/auth');
        return;
      }

      // Check profile completion
      setStatusMessage('Loading profile…');
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', sessionRes.data.session.user.id)
        .maybeSingle();

      if (profileError) {
        setHasError(true);
        setErrorMessage(`Could not load your profile: ${profileError.message}`);
        return;
      }

      if (!profile) {
        router.replace('/welcome');
        return;
      }

      // Existing v1 players upgrade into the privacy gate: the policy must be
      // acknowledged for the current version before Home is reachable.
      setStatusMessage('Checking privacy choices…');
      const { data: consents } = await supabase.rpc('get_my_consents');
      const ack = (consents as Record<string, { granted?: boolean; policy_version?: number } | undefined> | null)
        ?.policy_ack;
      const acknowledgedVersion = ack?.granted ? (ack.policy_version ?? 0) : 0;
      router.replace(acknowledgedVersion < PRIVACY_VERSION ? ('/privacy?mode=gate' as any) : '/home');
    } catch (err) {
      setHasError(true);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to launch GhostRun.');
    }
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void bootstrapApp();
    }, 0);
    return () => clearTimeout(timer);
  }, [bootstrapApp]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Decorative radar background rings */}
      <View pointerEvents="none" style={styles.radarRingOuter} />
      <View pointerEvents="none" style={styles.radarRingMiddle} />
      <View pointerEvents="none" style={styles.radarRingInner} />

      <Animated.View
        style={[
          styles.brandContainer,
          {
            opacity: fadeAnim,
            transform: [{ scale: Animated.multiply(scaleAnim, pulseAnim) }],
          },
        ]}
      >
        <View style={styles.logoGlowWrapper}>
          <Image accessibilityLabel="GhostRun Logo" source={GHOSTRUN_LOGO} style={styles.logo} />
        </View>

        <Text style={styles.brandTitle}>GHOSTRUN</Text>
        <Text style={styles.brandTagline}>REAL-WORLD STEALTH & PURSUIT</Text>
      </Animated.View>

      <View style={styles.bottomSection}>
        {hasError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Configuration Notice</Text>
            <Text style={styles.errorMessage}>{errorMessage}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setHasError(false);
                setStatusMessage('Retrying…');
                void bootstrapApp();
              }}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#38BDF8" size="small" />
            <Text style={styles.statusText}>{statusMessage}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#090D16',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  radarRingOuter: {
    borderColor: 'rgba(56, 189, 248, 0.05)',
    borderRadius: 300,
    borderWidth: 1,
    height: 600,
    position: 'absolute',
    width: 600,
  },
  radarRingMiddle: {
    borderColor: 'rgba(56, 189, 248, 0.08)',
    borderRadius: 200,
    borderWidth: 1.5,
    height: 400,
    position: 'absolute',
    width: 400,
  },
  radarRingInner: {
    borderColor: 'rgba(56, 189, 248, 0.12)',
    borderRadius: 120,
    borderWidth: 1.5,
    height: 240,
    position: 'absolute',
    width: 240,
  },
  brandContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlowWrapper: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 36,
    borderWidth: 2,
    elevation: 20,
    height: 120,
    justifyContent: 'center',
    marginBottom: 22,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    width: 120,
  },
  logo: {
    borderRadius: 24,
    height: 96,
    width: 96,
  },
  brandTitle: {
    color: '#F8FAFC',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 4.5,
    textAlign: 'center',
  },
  brandTagline: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.2,
    marginTop: 8,
    textAlign: 'center',
  },
  bottomSection: {
    bottom: 52,
    left: 24,
    position: 'absolute',
    right: 24,
  },
  loadingBox: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  statusText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  errorBox: {
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  errorTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  errorMessage: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 40,
    paddingHorizontal: 20,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});

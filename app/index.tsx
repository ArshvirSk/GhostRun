import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useUserStore } from '../src/stores/userStore';
import { startLocationPrewarm } from '../src/lib/locationCache';

const GHOSTRUN_LOGO = require('../assets/splash-mark.png');

export default function SplashScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [statusMessage, setStatusMessage] = useState('Starting…');
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [fadeAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const bootstrapApp = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setHasError(true);
      setErrorMessage('Supabase is not configured. Add your project URL and anon key to continue.');
      return;
    }

    try {
      // Parallelize session check and cached onboarding check for instantaneous boot
      const [sessionRes, onboardedVal] = await Promise.all([
        supabase.auth.getSession(),
        AsyncStorage.getItem('@ghostrun:onboarded'),
      ]);

      if (sessionRes.error) {
        setHasError(true);
        setErrorMessage(sessionRes.error.message);
        return;
      }

      // If user has no active session, route directly to the onboarding briefing tour
      if (!sessionRes.data.session) {
        router.replace('/briefing' as any);
        return;
      }

      const userId = sessionRes.data.session.user.id;

      // Start background GPS pre-warming immediately so coordinates are hot for matches
      void startLocationPrewarm();

      // Parallelize profile verification and consents check
      const [profileRes, consentsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, display_name, color')
          .eq('id', userId)
          .maybeSingle(),
        supabase.rpc('get_my_consents'),
      ]);

      if (profileRes.error) {
        setHasError(true);
        setErrorMessage(`Could not load your profile: ${profileRes.error.message}`);
        return;
      }

      if (!profileRes.data) {
        router.replace('/signup/name' as any);
        return;
      }

      // Sync userStore immediately
      useUserStore.getState().setProfile({
        id: profileRes.data.id,
        display_name: profileRes.data.display_name || 'Operative',
        color: profileRes.data.color,
        email: sessionRes.data.session.user.email,
      });

      // If user hasn't completed safety & permissions onboarding, guide them there
      if (onboardedVal !== 'true') {
        router.replace('/signup/before-you-play' as any);
        return;
      }

      // Existing players upgrade into the privacy gate: the policy must be
      // acknowledged for the current version before Home is reachable.
      const ack = (
        consentsRes.data as Record<
          string,
          { granted?: boolean; policy_version?: number } | undefined
        > | null
      )?.policy_ack;
      const acknowledgedVersion = ack?.granted ? (ack.policy_version ?? 0) : 0;
      router.replace(
        acknowledgedVersion < PRIVACY_VERSION
          ? ('/privacy?mode=gate' as any)
          : ('/play' as any),
      );
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
      <StatusBar style="dark" />

      <Animated.View style={[styles.brandContainer, { opacity: fadeAnim }]}>
        <Image accessibilityLabel="GhostRun Logo" source={GHOSTRUN_LOGO} style={styles.logo} />
        <Text style={styles.brandTitle}>GhostRun</Text>
        <Text style={styles.brandTagline}>Real-World GPS Chase</Text>
      </Animated.View>

      <View style={[styles.bottomSection, { bottom: Math.max(insets.bottom, 16) + 32 }]}>
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
            <ActivityIndicator color="#1D4ED8" size="small" />
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
    backgroundColor: '#FFFFFF',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  brandContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    height: 80,
    marginBottom: 16,
    width: 80,
  },
  brandTitle: {
    color: '#0F172A',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  brandTagline: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.3,
    marginTop: 4,
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
    gap: 8,
    justifyContent: 'center',
  },
  statusText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  errorBox: {
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  errorTitle: {
    color: '#991B1B',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  errorMessage: {
    color: '#B91C1C',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 40,
    paddingHorizontal: 20,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

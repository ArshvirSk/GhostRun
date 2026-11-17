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
import { useTheme, ACCENT_COLOR_STORAGE_KEY } from '../src/theme/ThemeProvider';

const GHOSTRUN_MARK_MINT = require('../assets/ghostrun-mark-mint.png');
const GHOSTRUN_MARK_OLIVE = require('../assets/ghostrun-mark-olive.png');

export default function SplashScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark, setAccentColor } = useTheme();
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

      const operativeColor = profileRes.data.color;

      // Sync userStore immediately
      useUserStore.getState().setProfile({
        id: profileRes.data.id,
        display_name: profileRes.data.display_name || 'Operative',
        color: operativeColor,
        email: sessionRes.data.session.user.email,
      });

      if (operativeColor) {
        void AsyncStorage.setItem(ACCENT_COLOR_STORAGE_KEY, operativeColor);
        void setAccentColor(operativeColor);
      }

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
  }, [router, setAccentColor]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void bootstrapApp();
    }, 0);
    return () => clearTimeout(timer);
  }, [bootstrapApp]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <Animated.View style={[styles.brandContainer, { opacity: fadeAnim }]}>
        <Image
          accessibilityLabel="GhostRun Logo"
          source={isDark ? GHOSTRUN_MARK_MINT : GHOSTRUN_MARK_OLIVE}
          style={[
            styles.logo,
            { tintColor: isDark ? '#FFFFFF' : '#000000' },
          ]}
          resizeMode="contain"
        />
        <Text style={[styles.brandTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          GHOST<Text style={{ color: colors.primary }}>RUN</Text>
        </Text>
        <Text style={[styles.brandTagline, { color: colors.textSecondary }]}>
          Real-World GPS Chase
        </Text>
      </Animated.View>

      <View style={[styles.bottomSection, { bottom: Math.max(insets.bottom, 16) + 32 }]}>
        {hasError ? (
          <View
            style={[
              styles.errorBox,
              {
                backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2',
                borderColor: isDark ? 'rgba(239, 68, 68, 0.3)' : '#FECACA',
              },
            ]}
          >
            <Text style={[styles.errorTitle, { color: isDark ? '#FCA5A5' : '#991B1B' }]}>
              Configuration Notice
            </Text>
            <Text style={[styles.errorMessage, { color: isDark ? '#F87171' : '#B91C1C' }]}>
              {errorMessage}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setHasError(false);
                setStatusMessage('Retrying…');
                void bootstrapApp();
              }}
              style={[styles.retryButton, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.retryText, { color: isDark ? '#000000' : '#FFFFFF' }]}>
                Try again
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>
              {statusMessage}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  brandContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    height: 72,
    marginBottom: 16,
    width: 72,
  },
  brandTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  brandTagline: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 6,
    textAlign: 'center',
    textTransform: 'uppercase',
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
    fontSize: 13,
    fontWeight: '500',
  },
  errorBox: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 40,
    paddingHorizontal: 20,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PRIVACY_SHORT_VERSION, PRIVACY_VERSION } from '../../../src/lib/privacy';
import { isSupabaseConfigured, supabase } from '../../../src/lib/supabase';
import { triggerHaptic } from '../../../src/motion/haptics';
import { useSignupStore } from '../../../src/stores/signupStore';
import { colors, radii, spacing } from '../../../src/theme/tokens';
import { Button } from '../../../src/ui/Button';
import { Card } from '../../../src/ui/Card';
import { Text } from '../../../src/ui/Text';

export default function SignupBeforeYouPlayScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();

  const name = useSignupStore((s) => s.name);
  const color = useSignupStore((s) => s.color);
  const ageConfirmed = useSignupStore((s) => s.ageConfirmed);
  const setAgeConfirmed = useSignupStore((s) => s.setAgeConfirmed);
  const foregroundGranted = useSignupStore((s) => s.foregroundGranted);
  const setForegroundGranted = useSignupStore((s) => s.setForegroundGranted);
  const backgroundGranted = useSignupStore((s) => s.backgroundGranted);
  const setBackgroundGranted = useSignupStore((s) => s.setBackgroundGranted);
  const notificationsGranted = useSignupStore((s) => s.notificationsGranted);
  const setNotificationsGranted = useSignupStore((s) => s.setNotificationsGranted);

  const [batteryExpanded, setBatteryExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Check current OS permissions on mount so UI reflects already-granted states
  useEffect(() => {
    let active = true;
    async function checkCurrentPermissions() {
      try {
        const fg = await Location.getForegroundPermissionsAsync();
        if (active && fg.granted) setForegroundGranted(true);

        const bg = await Location.getBackgroundPermissionsAsync();
        if (active && bg.granted) setBackgroundGranted(true);

        const notif = await Notifications.getPermissionsAsync();
        if (active && notif.granted) setNotificationsGranted(true);
      } catch {
        // Non-blocking
      }
    }
    void checkCurrentPermissions();
    return () => {
      active = false;
    };
  }, [setForegroundGranted, setBackgroundGranted, setNotificationsGranted]);

  const handleRequestForeground = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const granted = status === 'granted';
      setForegroundGranted(granted);
      triggerHaptic(granted ? 'buttonTap' : 'error');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not request GPS permission.');
    }
  };

  const handleRequestBackground = async () => {
    try {
      const { status } = await Location.requestBackgroundPermissionsAsync();
      const granted = status === 'granted';
      setBackgroundGranted(granted);
      triggerHaptic(granted ? 'buttonTap' : 'error');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not request background location.',
      );
    }
  };

  const handleRequestNotifications = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      const granted = status === 'granted';
      setNotificationsGranted(granted);
      triggerHaptic(granted ? 'buttonTap' : 'error');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not request notification permission.',
      );
    }
  };

  const handleCompleteSetup = async () => {
    if (!ageConfirmed) {
      setErrorMessage('You must confirm the age policy before playing.');
      triggerHaptic('error');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');

    try {
      if (isSupabaseConfigured && supabase) {
        const client = supabase;
        const { data: sessionData } = await client.auth.getSession();
        let currentSession = sessionData?.session;

        // If no active session, sign in anonymously so user can play immediately as a guest
        if (!currentSession) {
          try {
            const { data: anonData } = await client.auth.signInAnonymously();
            if (anonData?.session) {
              currentSession = anonData.session;
            }
          } catch {
            // Anonymous auth disabled or offline; proceed with local onboarding flag
          }
        }

        if (currentSession) {
          // Upsert user profile if name is provided, or ensure default Operative profile exists
          if (name.trim()) {
            const effectiveName = name.trim();
            const effectiveColor = color || colors.palette[0];
            await client.rpc('upsert_profile', {
              name: effectiveName,
              color: effectiveColor,
            });
          } else {
            const { data: existingProfile } = await client
              .from('profiles')
              .select('id')
              .eq('id', currentSession.user.id)
              .maybeSingle();

            if (!existingProfile) {
              await client.rpc('upsert_profile', {
                name: 'Operative',
                color: color || colors.palette[0],
              });
            }
          }

          // Record mandatory policy acknowledgement consent
          await client.rpc('set_consent', {
            consent_type: 'policy_ack',
            granted: true,
            policy_version: PRIVACY_VERSION,
          });
        }
      }

      // Mark onboarding completed in AsyncStorage
      await AsyncStorage.setItem('@ghostrun:onboarded', 'true');

      triggerHaptic('roleReveal');
      setSubmitting(false);

      // Navigate to destination (or /play)
      const targetRoute = next ? (next as any) : ('/play' as any);
      router.replace(targetRoute);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Setup completion failed.');
      triggerHaptic('error');
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Step Header */}
        <View style={styles.header}>
          <Text style={styles.stepIndicator} variant="label">
            {name.trim() ? 'STEP 4 OF 4 • SAFETY & PERMISSIONS' : 'ONBOARDING • SAFETY & PERMISSIONS'}
          </Text>
          <Text style={styles.title} variant="headline">
            Before you play
          </Text>
          <Text style={styles.subtitle} variant="body">
            GhostRun is an outdoor pursuit game. Review age requirements, privacy rules, and sensor
            access.
          </Text>
        </View>

        {/* Section 1: Age Confirmation Gate */}
        <Card style={styles.sectionCard} variant="elevated">
          <Text style={styles.sectionTitle} variant="title">
            1. Age Policy
          </Text>
          <Pressable
            accessibilityLabel="Age confirmation checkbox"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ageConfirmed }}
            onPress={() => {
              setAgeConfirmed(!ageConfirmed);
              triggerHaptic('buttonTap');
            }}
            style={styles.checkboxRow}
          >
            <View style={[styles.checkbox, ageConfirmed ? styles.checkboxChecked : null]}>
              {ageConfirmed ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.checkboxLabel} variant="body">
              I confirm I am{' '}
              <Text style={styles.boldText}>18 or older, or playing under a guardian&apos;s supervision</Text>.
            </Text>
          </Pressable>
        </Card>

        {/* Section 2: Transparent Privacy Summary */}
        <Card style={styles.sectionCard} variant="default">
          <Text style={styles.sectionTitle} variant="title">
            2. Privacy & Tactical Data
          </Text>
          <View style={styles.bulletList}>
            {PRIVACY_SHORT_VERSION.map((item) => (
              <View key={item} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText} variant="caption">
                  {item}
                </Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Section 3: Sensor Permissions */}
        <Card style={styles.sectionCard} variant="elevated">
          <Text style={styles.sectionTitle} variant="title">
            3. Device Permissions
          </Text>

          {/* Foreground GPS */}
          <View style={styles.permItem}>
            <View style={styles.permTextCol}>
              <Text style={styles.permName} variant="body">
                Location (While in Game)
              </Text>
              <Text style={styles.permDesc} variant="caption">
                Calculates boundary distance, scheduled pings, and tag ranges.
              </Text>
            </View>
            <Button
              accessibilityHint="Requests foreground GPS permission"
              disabled={foregroundGranted}
              onPress={handleRequestForeground}
              size="sm"
              title={foregroundGranted ? 'Granted ✓' : 'Allow'}
              variant={foregroundGranted ? 'ghost' : 'secondary'}
            />
          </View>

          {/* Background GPS */}
          <View style={styles.permItem}>
            <View style={styles.permTextCol}>
              <Text style={styles.permName} variant="body">
                Background Tracking
              </Text>
              <Text style={styles.permDesc} variant="caption">
                Keeps your position sharing active while your phone is locked or in your pocket.
              </Text>
            </View>
            <Button
              accessibilityHint="Requests background location permission"
              disabled={backgroundGranted}
              onPress={handleRequestBackground}
              size="sm"
              title={backgroundGranted ? 'Granted ✓' : 'Allow'}
              variant={backgroundGranted ? 'ghost' : 'secondary'}
            />
          </View>

          {/* Push Notifications */}
          <View style={styles.permItem}>
            <View style={styles.permTextCol}>
              <Text style={styles.permName} variant="body">
                Match Notifications
              </Text>
              <Text style={styles.permDesc} variant="caption">
                Alerts when the host starts countdown and radar pings dispatch.
              </Text>
            </View>
            <Button
              accessibilityHint="Requests push notification permission"
              disabled={notificationsGranted}
              onPress={handleRequestNotifications}
              size="sm"
              title={notificationsGranted ? 'Granted ✓' : 'Allow'}
              variant={notificationsGranted ? 'ghost' : 'secondary'}
            />
          </View>
        </Card>

        {/* Battery Advice Accordion */}
        <Pressable
          accessibilityRole="button"
          onPress={() => setBatteryExpanded(!batteryExpanded)}
          style={styles.batteryToggle}
        >
          <Text style={styles.batteryTitle} variant="caption">
            {batteryExpanded ? '▼ Hide Battery Optimization Advice' : '▶ Battery Optimization Advice'}
          </Text>
          {batteryExpanded ? (
            <Card style={styles.batteryCard} variant="default">
              <Text style={styles.batteryText} variant="caption">
                On Android, enable &quot;Allow all the time&quot; for location and disable aggressive OS battery
                saving for GhostRun so the GPS background worker does not sleep mid-match.
              </Text>
            </Card>
          ) : null}
        </Pressable>

        {/* Error Callout */}
        {errorMessage ? (
          <Card style={styles.errorCard} variant="danger">
            <Text style={styles.errorText} variant="caption">
              {errorMessage}
            </Text>
          </Card>
        ) : null}
      </ScrollView>

      {/* Footer Navigation */}
      <View style={styles.footer}>
        {submitting ? (
          <ActivityIndicator color={colors.primary} size="small" style={styles.loader} />
        ) : (
          <Button
            accessibilityHint="Completes profile creation and enters the tactical grid"
            disabled={!ageConfirmed}
            onPress={handleCompleteSetup}
            size="lg"
            title="Complete Setup & Enter Grid"
            variant="primary"
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  header: {
    marginBottom: spacing.xs,
  },
  stepIndicator: {
    color: colors.primary,
    letterSpacing: 2,
    marginBottom: spacing.xs,
  },
  title: {
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.textMuted,
  },
  sectionCard: {
    padding: spacing.md,
    borderRadius: radii.card,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textLight,
    marginBottom: spacing.xs,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.borderDark,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.backgroundDark,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 18,
  },
  checkboxLabel: {
    flex: 1,
    color: colors.text,
    lineHeight: 22,
  },
  boldText: {
    fontWeight: '700',
    color: colors.textLight,
  },
  bulletList: {
    gap: spacing.xs,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  bulletDot: {
    color: colors.primary,
    fontSize: 14,
    lineHeight: 18,
  },
  bulletText: {
    flex: 1,
    color: colors.textMuted,
    lineHeight: 18,
  },
  permItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.sm,
  },
  permTextCol: {
    flex: 1,
  },
  permName: {
    fontWeight: '600',
    color: colors.textLight,
  },
  permDesc: {
    color: colors.textSubtle,
    marginTop: 2,
  },
  batteryToggle: {
    paddingVertical: spacing.xs,
  },
  batteryTitle: {
    color: colors.primary,
    fontWeight: '600',
  },
  batteryCard: {
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  batteryText: {
    color: colors.textSubtle,
    lineHeight: 18,
  },
  errorCard: {
    padding: spacing.md,
  },
  errorText: {
    color: colors.dangerText,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceDark,
  },
  loader: {
    paddingVertical: spacing.lg,
  },
});

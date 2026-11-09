import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authErrorMessage } from '../../../src/lib/authErrors';
import { getResendCooldown, setResendCooldown } from '../../../src/lib/resendCooldown';
import { isSupabaseConfigured, supabase } from '../../../src/lib/supabase';
import { triggerHaptic } from '../../../src/motion/haptics';
import { useSignupStore } from '../../../src/stores/signupStore';
import { colors, radii, spacing } from '../../../src/theme/tokens';
import { Button } from '../../../src/ui/Button';
import { Card } from '../../../src/ui/Card';
import { Text } from '../../../src/ui/Text';

const RESEND_COOLDOWN_S = 60;

export default function SignupCodeScreen() {
  const router = useRouter();
  const email = useSignupStore((s) => s.email);
  const cooldownUntil = useSignupStore((s) => s.cooldownUntil);
  const setCooldownUntil = useSignupStore((s) => s.setCooldownUntil);

  const [now, setNow] = useState(() => Date.now());
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Clock tick for countdown
  useEffect(() => {
    if (cooldownUntil <= now) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil, now]);

  // Read initial stored cooldown on mount
  useEffect(() => {
    if (!email) return;
    void getResendCooldown(email).then((deadline) => {
      if (deadline > Date.now()) {
        setCooldownUntil(deadline);
      }
    });
  }, [email, setCooldownUntil]);

  const remainingSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const isCooldownActive = remainingSeconds > 0;

  const handleResend = async () => {
    if (isCooldownActive || resending || !isSupabaseConfigured || !supabase || !email) return;

    setResending(true);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const emailRedirectTo = Linking.createURL('/signin');
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo },
      });

      if (error) {
        setErrorMessage(authErrorMessage(error));
        triggerHaptic('error');
        setResending(false);
        return;
      }

      const newDeadline = Date.now() + RESEND_COOLDOWN_S * 1000;
      await setResendCooldown(email, newDeadline);
      setCooldownUntil(newDeadline);
      setStatusMessage('Confirmation link resent! Check your inbox.');
      triggerHaptic('buttonTap');
      setResending(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not resend email.');
      triggerHaptic('error');
      setResending(false);
    }
  };

  const handleCheckConfirmed = async () => {
    if (!isSupabaseConfigured || !supabase) return;

    setChecking(true);
    setErrorMessage('');

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        setErrorMessage(error.message);
        setChecking(false);
        return;
      }

      if (data.session) {
        triggerHaptic('buttonTap');
        setChecking(false);
        router.push('/signup/before-you-play' as any);
        return;
      }

      // If no session yet in local storage, prompt user
      setStatusMessage('No active session detected yet. Please tap the link in your email.');
      setChecking(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Session verification failed.');
      setChecking(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.content}>
        {/* Step Indicator */}
        <Text style={styles.stepIndicator} variant="label">
          STEP 3 OF 4 • VERIFICATION
        </Text>

        <Text style={styles.title} variant="headline">
          Check your inbox
        </Text>

        <Text style={styles.subtitle} variant="body">
          We dispatched a confirmation link to:
        </Text>

        {/* Email Badge */}
        <Card style={styles.emailCard} variant="elevated">
          <Text style={styles.emailText} variant="mono">
            {email || 'your-email@example.com'}
          </Text>
        </Card>

        <Text style={styles.instructions} variant="caption">
          Tap the link in the email to activate your account. Once verified, return to GhostRun to
          complete permissions.
        </Text>

        {/* Status Messages */}
        {statusMessage ? (
          <Card style={styles.statusCard} variant="accent">
            <Text style={styles.statusText} variant="caption">
              {statusMessage}
            </Text>
          </Card>
        ) : null}

        {errorMessage ? (
          <Card style={styles.errorCard} variant="danger">
            <Text style={styles.errorText} variant="caption">
              {errorMessage}
            </Text>
          </Card>
        ) : null}

        {/* Resend Action with Cooldown Timer */}
        <View style={styles.resendSection}>
          <Button
            accessibilityHint="Resends the confirmation email once cooldown expires"
            disabled={isCooldownActive || resending}
            onPress={handleResend}
            size="md"
            title={
              isCooldownActive
                ? `Resend in ${remainingSeconds}s`
                : resending
                  ? 'Sending…'
                  : 'Resend email'
            }
            variant="secondary"
          />
        </View>
      </View>

      {/* Footer Navigation */}
      <View style={styles.footer}>
        {checking ? (
          <ActivityIndicator color={colors.primary} size="small" style={styles.loader} />
        ) : (
          <>
            <Button
              accessibilityHint="Checks if your email has been confirmed and proceeds"
              onPress={handleCheckConfirmed}
              size="lg"
              title="I've confirmed my email"
              variant="primary"
            />

            <Button
              accessibilityHint="Returns to change your email address"
              onPress={() => router.back()}
              size="sm"
              title="Use a different email"
              variant="ghost"
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-between',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
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
    marginBottom: spacing.md,
  },
  emailCard: {
    padding: spacing.md,
    borderRadius: radii.card,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emailText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  instructions: {
    color: colors.textSubtle,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  statusCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  statusText: {
    color: colors.successText,
    fontWeight: '600',
  },
  errorCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.dangerText,
  },
  resendSection: {
    marginTop: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceDark,
    gap: spacing.sm,
  },
  loader: {
    paddingVertical: spacing.lg,
  },
});

import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authErrorMessage } from '../../../src/lib/authErrors';
import { setResendCooldown } from '../../../src/lib/resendCooldown';
import { isSupabaseConfigured, supabase } from '../../../src/lib/supabase';
import { triggerHaptic } from '../../../src/motion/haptics';
import { useSignupStore } from '../../../src/stores/signupStore';
import { colors, radii, spacing } from '../../../src/theme/tokens';
import { Button } from '../../../src/ui/Button';
import { Card } from '../../../src/ui/Card';
import { Text } from '../../../src/ui/Text';

const RESEND_COOLDOWN_S = 60;
const PRIVACY_URL = 'https://ghostrun.app/privacy';
const TERMS_URL = 'https://ghostrun.app/terms';

export default function SignupAccountScreen() {
  const router = useRouter();
  const storedEmail = useSignupStore((s) => s.email);
  const setEmail = useSignupStore((s) => s.setEmail);
  const setPassword = useSignupStore((s) => s.setPassword);
  const setIsGuest = useSignupStore((s) => s.setIsGuest);
  const marketingConsent = useSignupStore((s) => s.marketingConsent);
  const setMarketingConsent = useSignupStore((s) => s.setMarketingConsent);
  const setCooldownUntil = useSignupStore((s) => s.setCooldownUntil);

  const [emailInput, setEmailInput] = useState(storedEmail || '');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localMarketing, setLocalMarketing] = useState(marketingConsent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cleanEmail = emailInput.trim().toLowerCase();
  const isValidEmail = cleanEmail.includes('@') && cleanEmail.includes('.');
  const isValidPassword = passwordInput.length >= 6;
  const passwordsMatch = passwordInput === confirmPassword;

  const canSubmit = isValidEmail && isValidPassword && passwordsMatch && !busy;

  const handleSignUp = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase is not configured.');
      triggerHaptic('error');
      return;
    }

    if (!isValidEmail) {
      setError('Enter a valid email address.');
      triggerHaptic('error');
      return;
    }
    if (!isValidPassword) {
      setError('Password must be at least 6 characters.');
      triggerHaptic('error');
      return;
    }
    if (!passwordsMatch) {
      setError('Passwords do not match.');
      triggerHaptic('error');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const emailRedirectTo = Linking.createURL('/signin');
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password: passwordInput,
        options: {
          emailRedirectTo,
        },
      });

      if (signUpError) {
        setError(authErrorMessage(signUpError));
        triggerHaptic('error');
        setBusy(false);
        return;
      }

      setEmail(cleanEmail);
      setPassword(passwordInput);
      setIsGuest(false);
      setMarketingConsent(localMarketing);
      triggerHaptic('buttonTap');

      // If user session returned immediately (email confirmation disabled)
      if (data.session) {
        setBusy(false);
        router.push('/signup/before-you-play' as any);
        return;
      }

      // Email confirmation required: set cooldown and advance to code screen
      const deadline = Date.now() + RESEND_COOLDOWN_S * 1000;
      await setResendCooldown(cleanEmail, deadline);
      setCooldownUntil(deadline);
      setBusy(false);
      router.push('/signup/code' as any);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-up failed.');
      triggerHaptic('error');
      setBusy(false);
    }
  };

  const handleGuestSignIn = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase is not configured.');
      triggerHaptic('error');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const { data, error: guestError } = await supabase.auth.signInAnonymously();
      if (guestError) {
        setError(authErrorMessage(guestError));
        triggerHaptic('error');
        setBusy(false);
        return;
      }

      if (data.session) {
        setIsGuest(true);
        triggerHaptic('buttonTap');
        setBusy(false);
        router.push('/signup/before-you-play' as any);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guest sign-in failed.');
      triggerHaptic('error');
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoid}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header & Step Tracker */}
          <View style={styles.header}>
            <Text style={styles.stepIndicator} variant="label">
              STEP 2 OF 4 • ACCESS
            </Text>
            <Text style={styles.title} variant="headline">
              Create your access
            </Text>
            <Text style={styles.subtitle} variant="body">
              Secure your match history, carrier stats, and reconnect with your crew.
            </Text>
          </View>

          {/* Form Fields */}
          <View style={styles.formSection}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel} variant="label">
                EMAIL ADDRESS
              </Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                onChangeText={(text) => {
                  setEmailInput(text);
                  if (error) setError('');
                }}
                placeholder="operative@ghostrun.app"
                placeholderTextColor={colors.textSubtle}
                style={styles.textInput}
                value={emailInput}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel} variant="label">
                PASSWORD (MIN 6 CHARACTERS)
              </Text>
              <TextInput
                accessibilityLabel="Password"
                autoCapitalize="none"
                autoComplete="password-new"
                autoCorrect={false}
                onChangeText={(text) => {
                  setPasswordInput(text);
                  if (error) setError('');
                }}
                placeholder="••••••••"
                placeholderTextColor={colors.textSubtle}
                secureTextEntry
                style={styles.textInput}
                value={passwordInput}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel} variant="label">
                CONFIRM PASSWORD
              </Text>
              <TextInput
                accessibilityLabel="Confirm password"
                autoCapitalize="none"
                autoComplete="password-new"
                autoCorrect={false}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  if (error) setError('');
                }}
                placeholder="••••••••"
                placeholderTextColor={colors.textSubtle}
                secureTextEntry
                style={[
                  styles.textInput,
                  passwordInput && confirmPassword && !passwordsMatch
                    ? styles.textInputError
                    : null,
                ]}
                value={confirmPassword}
              />
              {passwordInput && confirmPassword && !passwordsMatch ? (
                <Text style={styles.errorText} variant="caption">
                  Passwords do not match.
                </Text>
              ) : null}
            </View>

            {/* Marketing Consent Checkbox (Unchecked by default) */}
            <Pressable
              accessibilityLabel="Receive tactical intel and updates"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: localMarketing }}
              onPress={() => {
                setLocalMarketing(!localMarketing);
                setMarketingConsent(!localMarketing);
              }}
              style={styles.checkboxRow}
            >
              <View style={[styles.checkbox, localMarketing ? styles.checkboxChecked : null]}>
                {localMarketing ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <Text style={styles.checkboxText} variant="caption">
                Send me tactical updates, field playtest invites, and seasonal intel. (Optional)
              </Text>
            </Pressable>

            {/* Error Message */}
            {error ? (
              <Card style={styles.errorCard} variant="danger">
                <Text style={styles.errorCardText} variant="caption">
                  {error}
                </Text>
              </Card>
            ) : null}

            {/* Community Safety & Harassment Statement */}
            <Card style={styles.safetyCard} variant="default">
              <Text style={styles.safetyText} variant="caption">
                GhostRun is a real-world game built on trust. There is no place for abuse or
                harassment, and players who violate community safety are permanently removed.
              </Text>
              <View style={styles.legalLinksRow}>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(TERMS_URL)}
                >
                  <Text style={styles.legalLink} variant="caption">
                    Terms of Service
                  </Text>
                </Pressable>
                <Text style={styles.legalDivider}>•</Text>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(PRIVACY_URL)}
                >
                  <Text style={styles.legalLink} variant="caption">
                    Privacy Policy
                  </Text>
                </Pressable>
              </View>
            </Card>
          </View>
        </ScrollView>

        {/* Footer Actions */}
        <View style={styles.footer}>
          {busy ? (
            <ActivityIndicator color={colors.primary} size="small" style={styles.loader} />
          ) : (
            <>
              <Button
                accessibilityHint="Creates your account"
                disabled={!canSubmit}
                onPress={handleSignUp}
                size="lg"
                title="Create Account"
                variant="primary"
              />

              <Button
                accessibilityHint="Signs in immediately as a guest player without credentials"
                onPress={handleGuestSignIn}
                size="md"
                title="Continue as Guest"
                variant="ghost"
              />

              <Pressable
                accessibilityLabel="Sign in with existing account"
                accessibilityRole="button"
                onPress={() => router.push('/signin' as any)}
                style={styles.signInLink}
              >
                <Text style={styles.signInLinkText} variant="body">
                  Already have an account? <Text style={styles.signInLinkHighlight}>Sign in</Text>
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    marginBottom: spacing.xl,
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
  formSection: {
    gap: spacing.lg,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  inputLabel: {
    color: colors.textMuted,
    letterSpacing: 1,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textLight,
    fontSize: 16,
    fontFamily: 'System',
  },
  textInputError: {
    borderColor: colors.danger,
  },
  errorText: {
    color: colors.danger,
    marginTop: spacing.xs,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
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
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 16,
  },
  checkboxText: {
    flex: 1,
    color: colors.textMuted,
    lineHeight: 18,
  },
  errorCard: {
    padding: spacing.md,
  },
  errorCardText: {
    color: colors.dangerText,
  },
  safetyCard: {
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceDark,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  safetyText: {
    color: colors.textSubtle,
    lineHeight: 18,
  },
  legalLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  legalLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  legalDivider: {
    color: colors.textSubtle,
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
  signInLink: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  signInLinkText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  signInLinkHighlight: {
    color: colors.primary,
    fontWeight: '700',
  },
});

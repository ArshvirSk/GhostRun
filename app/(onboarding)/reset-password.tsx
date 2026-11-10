import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authErrorMessage } from '../../src/lib/authErrors';
import { parseRecoveryUrl } from '../../src/lib/authLink';
import { getResendCooldown, setResendCooldown } from '../../src/lib/resendCooldown';
import { isSupabaseConfigured, supabase } from '../../src/lib/supabase';
import { triggerHaptic } from '../../src/motion/haptics';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Text } from '../../src/ui/Text';

const RESEND_COOLDOWN_S = 60;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const currentUrl = Linking.useURL();
  const [initialUrl, setInitialUrl] = useState<string | null>(null);
  const [initialChecked, setInitialChecked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const handledUrl = useRef<string | null>(null);

  // Read initial URL
  useEffect(() => {
    let mounted = true;
    void Linking.getInitialURL().then((value) => {
      if (!mounted) return;
      setInitialUrl(value);
      setInitialChecked(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Cooldown countdown tick
  useEffect(() => {
    if (cooldownUntil <= now) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil, now]);

  const url = currentUrl ?? initialUrl;

  useEffect(() => {
    if (!initialChecked && !currentUrl) return;
    if (url === handledUrl.current) return;
    handledUrl.current = url;

    let cancelled = false;

    async function establishSession() {
      const client = supabase;
      if (!client) {
        if (cancelled) return;
        setChecking(false);
        setLinkError('Supabase is not configured yet.');
        return;
      }

      const parsed = parseRecoveryUrl(url);

      if (parsed.kind === 'error') {
        if (cancelled) return;
        setChecking(false);
        setLinkError(parsed.message);
        return;
      }

      if (parsed.kind === 'session') {
        const { data, error } = await client.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        });
        if (cancelled) return;
        if (error) {
          setChecking(false);
          setLinkError(error.message);
          return;
        }
        setEmail(data.user?.email ?? '');
        setReady(true);
        setChecking(false);
        return;
      }

      if (parsed.kind === 'code') {
        const { data, error } = await client.auth.exchangeCodeForSession(parsed.code);
        if (cancelled) return;
        if (error) {
          setChecking(false);
          setLinkError(error.message);
          return;
        }
        setEmail(data.user?.email ?? '');
        setReady(true);
        setChecking(false);
        return;
      }

      // No tokens: check if an active recovery session already exists
      const { data } = await client.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setEmail(data.session.user.email ?? '');
        setReady(true);
        setChecking(false);
        return;
      }

      setChecking(false);
      setLinkError('Enter your email to request a reset link, or open the link from your email.');
    }

    void establishSession();
    return () => {
      cancelled = true;
    };
  }, [url, initialChecked, currentUrl]);

  const handleUpdatePassword = async () => {
    if (!supabase || busy) return;

    if (password.length < 6) {
      setErrorMessage('Choose a password with at least 6 characters.');
      triggerHaptic('error');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('The passwords do not match.');
      triggerHaptic('error');
      return;
    }

    setBusy(true);
    setErrorMessage('');

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMessage(authErrorMessage(error));
        triggerHaptic('error');
        setBusy(false);
        return;
      }

      triggerHaptic('roleReveal');
      const { data: userData } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userData.user?.id ?? '')
        .maybeSingle();

      setBusy(false);
      router.replace(profile ? '/play' : ('/briefing' as any));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Password update failed.');
      triggerHaptic('error');
      setBusy(false);
    }
  };

  const handleRequestReset = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes('@')) {
      setErrorMessage('Enter a valid email address.');
      triggerHaptic('error');
      return;
    }

    if (!isSupabaseConfigured || !supabase) return;

    setBusy(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const cooldownDeadline = await getResendCooldown(cleanEmail);
      if (cooldownDeadline > Date.now()) {
        setCooldownUntil(cooldownDeadline);
        setErrorMessage('A reset request was recently dispatched. Wait for the cooldown to elapse.');
        setBusy(false);
        return;
      }

      const redirectTo = Linking.createURL('/reset-password');
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo,
      });

      if (error) {
        setErrorMessage(authErrorMessage(error));
        triggerHaptic('error');
        setBusy(false);
        return;
      }

      const newDeadline = Date.now() + RESEND_COOLDOWN_S * 1000;
      await setResendCooldown(cleanEmail, newDeadline);
      setCooldownUntil(newDeadline);
      setStatusMessage('Password reset link dispatched! Check your inbox.');
      triggerHaptic('buttonTap');
      setBusy(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not request password reset.');
      triggerHaptic('error');
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (supabase) await supabase.auth.signOut();
    router.replace('/signin' as any);
  };

  const remainingSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const isCooldownActive = remainingSeconds > 0;

  if (checking) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.centerContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText} variant="body">
            Verifying recovery authorization…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

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
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.eyebrow} variant="label">
              AUTHENTICATION RECOVERY
            </Text>
            <Text style={styles.title} variant="headline">
              {ready ? 'Set new password' : 'Reset password'}
            </Text>
            <Text style={styles.subtitle} variant="body">
              {ready
                ? `Securing access for operative: ${email}`
                : 'Enter your operative email address to receive recovery instructions.'}
            </Text>
          </View>

          {/* Form */}
          <View style={styles.formSection}>
            {ready ? (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel} variant="label">
                    NEW PASSWORD (MIN 6 CHARACTERS)
                  </Text>
                  <TextInput
                    accessibilityLabel="New password"
                    autoCapitalize="none"
                    autoComplete="password-new"
                    autoCorrect={false}
                    onChangeText={(text) => {
                      setPassword(text);
                      if (errorMessage) setErrorMessage('');
                    }}
                    placeholder="••••••••"
                    placeholderTextColor={colors.textSubtle}
                    secureTextEntry
                    style={styles.textInput}
                    value={password}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel} variant="label">
                    CONFIRM NEW PASSWORD
                  </Text>
                  <TextInput
                    accessibilityLabel="Confirm new password"
                    autoCapitalize="none"
                    autoComplete="password-new"
                    autoCorrect={false}
                    onChangeText={(text) => {
                      setConfirmPassword(text);
                      if (errorMessage) setErrorMessage('');
                    }}
                    placeholder="••••••••"
                    placeholderTextColor={colors.textSubtle}
                    secureTextEntry
                    style={styles.textInput}
                    value={confirmPassword}
                  />
                </View>
              </>
            ) : (
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
                    setEmail(text);
                    if (errorMessage) setErrorMessage('');
                  }}
                  placeholder="operative@ghostrun.app"
                  placeholderTextColor={colors.textSubtle}
                  style={styles.textInput}
                  value={email}
                />
              </View>
            )}

            {/* Status & Error Messages */}
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

            {linkError && !ready && !statusMessage ? (
              <Card style={styles.noticeCard} variant="default">
                <Text style={styles.noticeText} variant="caption">
                  {linkError}
                </Text>
              </Card>
            ) : null}
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          {busy ? (
            <ActivityIndicator color={colors.primary} size="small" style={styles.loader} />
          ) : ready ? (
            <>
              <Button
                accessibilityHint="Saves your new password"
                disabled={!password || !confirmPassword || password !== confirmPassword}
                onPress={handleUpdatePassword}
                size="lg"
                title="Update Password"
                variant="primary"
              />
              <Button
                accessibilityHint="Cancel recovery and return to sign in"
                onPress={handleCancel}
                size="sm"
                title="Cancel"
                variant="ghost"
              />
            </>
          ) : (
            <>
              <Button
                accessibilityHint="Dispatches password recovery email"
                disabled={!email.includes('@') || isCooldownActive}
                onPress={handleRequestReset}
                size="lg"
                title={
                  isCooldownActive ? `Resend in ${remainingSeconds}s` : 'Send Recovery Link'
                }
                variant="primary"
              />
              <Button
                accessibilityHint="Return to sign in"
                onPress={handleCancel}
                size="sm"
                title="Back to Sign In"
                variant="ghost"
              />
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
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  loadingText: {
    color: colors.textMuted,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  header: {
    marginBottom: spacing.xl,
  },
  eyebrow: {
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
  statusCard: {
    padding: spacing.md,
  },
  statusText: {
    color: colors.successText,
    fontWeight: '600',
  },
  errorCard: {
    padding: spacing.md,
  },
  errorText: {
    color: colors.dangerText,
  },
  noticeCard: {
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
  },
  noticeText: {
    color: colors.textMuted,
    lineHeight: 18,
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

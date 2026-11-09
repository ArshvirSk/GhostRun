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

import { authErrorMessage } from '../../src/lib/authErrors';
import { PRIVACY_VERSION } from '../../src/lib/privacy';
import { isSupabaseConfigured, supabase } from '../../src/lib/supabase';
import { triggerHaptic } from '../../src/motion/haptics';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Text } from '../../src/ui/Text';

export default function SigninScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const routeAfterAuth = async () => {
    if (!supabase) return;

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setErrorMessage(userError?.message ?? 'Could not verify account.');
      setBusy(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (profileError) {
      setErrorMessage(`Profile error: ${profileError.message}`);
      setBusy(false);
      return;
    }

    if (!profile) {
      setBusy(false);
      router.replace('/signup/name' as any);
      return;
    }

    const { data: consents } = await supabase.rpc('get_my_consents');
    const ack = (
      consents as Record<
        string,
        { granted?: boolean; policy_version?: number } | undefined
      > | null
    )?.policy_ack;
    const acknowledgedVersion = ack?.granted ? (ack.policy_version ?? 0) : 0;

    setBusy(false);
    triggerHaptic('roleReveal');
    if (acknowledgedVersion < PRIVACY_VERSION) {
      router.replace('/signup/before-you-play' as any);
    } else {
      router.replace('/play' as any);
    }
  };

  const handleSignIn = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage('Supabase is not configured.');
      triggerHaptic('error');
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes('@')) {
      setErrorMessage('Enter a valid email address.');
      triggerHaptic('error');
      return;
    }

    if (!password) {
      setErrorMessage('Enter your password.');
      triggerHaptic('error');
      return;
    }

    setBusy(true);
    setErrorMessage('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        setErrorMessage(authErrorMessage(error));
        triggerHaptic('error');
        setBusy(false);
        return;
      }

      await routeAfterAuth();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Sign-in failed.');
      triggerHaptic('error');
      setBusy(false);
    }
  };

  const handleGuestSignIn = async () => {
    if (!isSupabaseConfigured || !supabase) return;

    setBusy(true);
    setErrorMessage('');

    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        setErrorMessage(authErrorMessage(error));
        triggerHaptic('error');
        setBusy(false);
        return;
      }

      if (data.session) {
        await routeAfterAuth();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Guest access failed.');
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
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.eyebrow} variant="label">
              GHOSTRUN ACCESS
            </Text>
            <Text style={styles.title} variant="headline">
              Sign in to your case file
            </Text>
            <Text style={styles.subtitle} variant="body">
              Resume your carrier record, stats, and tactical lobby access.
            </Text>
          </View>

          {/* Form */}
          <View style={styles.formSection}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel} variant="label">
                EMAIL
              </Text>
              <TextInput
                accessibilityLabel="Email input"
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

            <View style={styles.inputGroup}>
              <View style={styles.passwordLabelRow}>
                <Text style={styles.inputLabel} variant="label">
                  PASSWORD
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/reset-password' as any)}
                >
                  <Text style={styles.forgotLink} variant="caption">
                    Forgot password?
                  </Text>
                </Pressable>
              </View>
              <TextInput
                accessibilityLabel="Password input"
                autoCapitalize="none"
                autoComplete="password"
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

            {/* Error Card */}
            {errorMessage ? (
              <Card style={styles.errorCard} variant="danger">
                <Text style={styles.errorText} variant="caption">
                  {errorMessage}
                </Text>
              </Card>
            ) : null}
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          {busy ? (
            <ActivityIndicator color={colors.primary} size="small" style={styles.loader} />
          ) : (
            <>
              <Button
                accessibilityHint="Authenticates and signs you in"
                disabled={!email || !password}
                onPress={handleSignIn}
                size="lg"
                title="Sign In"
                variant="primary"
              />

              <Button
                accessibilityHint="Continue without an account as a guest"
                onPress={handleGuestSignIn}
                size="md"
                title="Continue as Guest"
                variant="ghost"
              />

              <Pressable
                accessibilityLabel="Create a new account"
                accessibilityRole="button"
                onPress={() => router.push('/signup/name' as any)}
                style={styles.signUpLink}
              >
                <Text style={styles.signUpLinkText} variant="body">
                  Don&apos;t have an account?{' '}
                  <Text style={styles.signUpLinkHighlight}>Register</Text>
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
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputLabel: {
    color: colors.textMuted,
    letterSpacing: 1,
  },
  forgotLink: {
    color: colors.primary,
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
    gap: spacing.sm,
  },
  loader: {
    paddingVertical: spacing.lg,
  },
  signUpLink: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  signUpLinkText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  signUpLinkHighlight: {
    color: colors.primary,
    fontWeight: '700',
  },
});

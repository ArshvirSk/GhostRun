import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { authErrorMessage } from '../src/lib/authErrors';
import { isSupabaseConfigured, supabase } from '../src/lib/supabase';

type Mode = 'sign_in' | 'sign_up' | 'reset';

type Pending =
  | { kind: 'confirm'; email: string; reason: 'signup' | 'unconfirmed' }
  | { kind: 'reset'; email: string };

const RESEND_COOLDOWN_S = 60;

export default function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (cooldownUntil <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [cooldownUntil, now]);

  async function routeAfterAuth() {
    const client = supabase;
    if (!client) return;

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      setErrorMessage(userError?.message ?? 'Could not load your account.');
      return;
    }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('id')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (profileError) {
      setErrorMessage(`Could not load your profile: ${profileError.message}`);
      return;
    }

    router.replace(profile ? '/home' : '/welcome');
  }

  async function handleSubmit() {
    if (!isSupabaseConfigured || !supabase) return;

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes('@')) {
      setErrorMessage('Enter a valid email address.');
      return;
    }

    setBusy(true);
    setErrorMessage('');
    setResendStatus(null);

    if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        // Must be present in the project's allowed redirect URLs.
        redirectTo: Linking.createURL('/reset-password'),
      });
      if (error) {
        setErrorMessage(authErrorMessage(error));
        setBusy(false);
        return;
      }
      setPending({ kind: 'reset', email: cleanEmail });
      setBusy(false);
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Choose a password with at least 6 characters.');
      setBusy(false);
      return;
    }
    if (mode === 'sign_up' && password !== confirmPassword) {
      setErrorMessage('The passwords do not match.');
      setBusy(false);
      return;
    }

    if (mode === 'sign_up') {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
      });
      if (error) {
        setErrorMessage(authErrorMessage(error));
        setBusy(false);
        return;
      }
      if (!data.session) {
        setPending({ kind: 'confirm', email: cleanEmail, reason: 'signup' });
        setCooldownUntil(Date.now() + RESEND_COOLDOWN_S * 1000);
        setNow(Date.now());
        setPassword('');
        setConfirmPassword('');
        setBusy(false);
        return;
      }
      await routeAfterAuth();
      setBusy(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    if (error) {
      if (error.code === 'email_not_confirmed') {
        setPending({ kind: 'confirm', email: cleanEmail, reason: 'unconfirmed' });
      } else {
        setErrorMessage(authErrorMessage(error));
      }
      setBusy(false);
      return;
    }

    await routeAfterAuth();
    setBusy(false);
  }

  async function resendConfirmation() {
    if (!supabase || pending?.kind !== 'confirm' || resending || Date.now() < cooldownUntil) return;

    setResending(true);
    setResendStatus(null);
    const { error } = await supabase.auth.resend({ type: 'signup', email: pending.email });
    setResending(false);
    setCooldownUntil(Date.now() + RESEND_COOLDOWN_S * 1000);
    setNow(Date.now());
    if (error) {
      setResendStatus({ ok: false, message: authErrorMessage(error) });
      return;
    }
    setResendStatus({ ok: true, message: 'Confirmation email sent again. Check your inbox.' });
  }

  function switchMode(next: Mode) {
    setMode(next);
    setErrorMessage('');
    setPending(null);
    setResendStatus(null);
    setCooldownUntil(0);
    setNow(Date.now());
    setPassword('');
    setConfirmPassword('');
  }

  const canSubmit =
    isSupabaseConfigured &&
    email.trim().length > 0 &&
    (mode === 'reset' ||
      (password.length >= 6 && (mode === 'sign_in' || confirmPassword.length > 0))) &&
    !busy;
  const resendCooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  if (pending) {
    const confirming = pending.kind === 'confirm';
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.eyebrow}>CHECK YOUR INBOX</Text>
          <Text style={styles.title}>
            {confirming ? 'Confirm your email' : 'Reset your password'}
          </Text>
          <Text style={styles.subtitle}>
            {confirming
              ? pending.reason === 'signup'
                ? `We sent a confirmation link to ${pending.email}. Open it, then sign in.`
                : `This account still needs confirmation. Check your inbox at ${pending.email}, or send the link again.`
              : `We sent a password reset link to ${pending.email}. Open it on this device to choose a new password.`}
          </Text>

          {resendStatus ? (
            <Text style={resendStatus.ok ? styles.okText : styles.error}>
              {resendStatus.message}
            </Text>
          ) : null}

          {confirming ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: resending || resendCooldown > 0 }}
              disabled={resending || resendCooldown > 0}
              onPress={() => void resendConfirmation()}
              style={[
                styles.secondaryButton,
                (resending || resendCooldown > 0) && styles.secondaryButtonDisabled,
              ]}
            >
              {resending ? (
                <ActivityIndicator color="#1D4ED8" />
              ) : (
                <Text style={styles.secondaryButtonText}>
                  {resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : 'Resend confirmation email'}
                </Text>
              )}
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => switchMode('sign_in')}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Back to sign in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>GHOSTRUN ID</Text>
        <Text style={styles.title}>
          {mode === 'sign_in'
            ? 'Welcome back'
            : mode === 'sign_up'
              ? 'Create your account'
              : 'Reset your password'}
        </Text>
        <Text style={styles.subtitle}>
          {mode === 'sign_in'
            ? 'Sign in with the email and password you used to join your crew.'
            : mode === 'sign_up'
              ? 'Use an email and password so your games survive a reinstall.'
              : "Enter your email and we'll send a link to choose a new password."}
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          inputMode="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor="#64748B"
          style={styles.input}
          value={email}
        />

        {mode !== 'reset' && (
          <>
            <Text style={styles.label}>Password</Text>
            <TextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor="#64748B"
              secureTextEntry
              style={styles.input}
              value={password}
            />

            {mode === 'sign_in' && (
              <Pressable
                accessibilityRole="button"
                onPress={() => switchMode('reset')}
                style={styles.forgotButton}
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </Pressable>
            )}
          </>
        )}

        {mode === 'sign_up' && (
          <>
            <Text style={styles.label}>Confirm password</Text>
            <TextInput
              accessibilityLabel="Confirm password"
              autoCapitalize="none"
              autoComplete="new-password"
              onChangeText={setConfirmPassword}
              onSubmitEditing={() => void handleSubmit()}
              placeholder="Type it again"
              placeholderTextColor="#64748B"
              returnKeyType="go"
              secureTextEntry
              style={styles.input}
              value={confirmPassword}
            />
          </>
        )}

        {!isSupabaseConfigured && (
          <Text style={styles.error}>
            Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your local environment
            first.
          </Text>
        )}
        {errorMessage !== '' && (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorMessage}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={() => void handleSubmit()}
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>
              {mode === 'sign_in'
                ? 'Sign in'
                : mode === 'sign_up'
                  ? 'Create account'
                  : 'Send reset link'}
            </Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => switchMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')}
          style={styles.switchButton}
        >
          <Text style={styles.switchText}>
            {mode === 'sign_in'
              ? 'New to GhostRun? Create an account'
              : mode === 'sign_up'
                ? 'Already have an account? Sign in'
                : 'Back to sign in'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#F8FAFC', flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 44 },
  eyebrow: { color: '#1D4ED8', fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
  title: { color: '#0F172A', fontSize: 32, fontWeight: '800', marginTop: 10 },
  subtitle: { color: '#475569', fontSize: 16, lineHeight: 24, marginTop: 10 },
  label: { color: '#0F172A', fontSize: 15, fontWeight: '700', marginBottom: 8, marginTop: 24 },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 17,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  forgotButton: { alignSelf: 'flex-end', marginTop: 10, paddingVertical: 4 },
  forgotText: { color: '#1D4ED8', fontSize: 14, fontWeight: '700' },
  error: { color: '#B91C1C', fontSize: 14, lineHeight: 20, marginTop: 14 },
  okText: { color: '#047857', fontSize: 14, lineHeight: 20, marginTop: 14 },
  button: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 14,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 56,
  },
  buttonDisabled: { backgroundColor: '#94A3B8' },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#DBEAFE',
    borderRadius: 14,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 52,
  },
  secondaryButtonDisabled: { opacity: 0.6 },
  secondaryButtonText: { color: '#1D4ED8', fontSize: 16, fontWeight: '800' },
  switchButton: { alignItems: 'center', justifyContent: 'center', marginTop: 20, minHeight: 44 },
  switchText: { color: '#1D4ED8', fontSize: 15, fontWeight: '700' },
});

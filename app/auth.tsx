import type { AuthError } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { useState } from 'react';
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

import { isSupabaseConfigured, supabase } from '../src/lib/supabase';

type Mode = 'sign_in' | 'sign_up';

function authErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'Email or password is incorrect.';
    case 'email_not_confirmed':
      return 'Confirm your email address first. Check your inbox for the link.';
    case 'email_exists':
    case 'user_already_exists':
      return 'An account already exists for this email. Sign in instead.';
    case 'weak_password':
      return 'Choose a password with at least 6 characters.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts right now. Wait a moment, then try again.';
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'Email sign-ups are disabled for this project.';
    case 'email_address_invalid':
      return 'That email address is not accepted. Try another one.';
    default:
      return error.message;
  }
}

export default function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [sentTo, setSentTo] = useState('');

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
    if (password.length < 6) {
      setErrorMessage('Choose a password with at least 6 characters.');
      return;
    }
    if (mode === 'sign_up' && password !== confirmPassword) {
      setErrorMessage('The passwords do not match.');
      return;
    }

    setBusy(true);
    setErrorMessage('');

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
        setSentTo(cleanEmail);
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
      setErrorMessage(authErrorMessage(error));
      setBusy(false);
      return;
    }

    await routeAfterAuth();
    setBusy(false);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setErrorMessage('');
    setSentTo('');
    setPassword('');
    setConfirmPassword('');
  }

  const canSubmit =
    isSupabaseConfigured &&
    email.trim().length > 0 &&
    password.length >= 6 &&
    (mode === 'sign_in' || confirmPassword.length > 0) &&
    !busy;

  if (sentTo !== '') {
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.eyebrow}>CHECK YOUR INBOX</Text>
          <Text style={styles.title}>Confirm your email</Text>
          <Text style={styles.subtitle}>
            We sent a confirmation link to {sentTo}. Open it, then come back and sign in.
          </Text>
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
          {mode === 'sign_in' ? 'Welcome back' : 'Create your account'}
        </Text>
        <Text style={styles.subtitle}>
          {mode === 'sign_in'
            ? 'Sign in with the email and password you used to join your crew.'
            : 'Use an email and password so your games survive a reinstall.'}
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
              {mode === 'sign_in' ? 'Sign in' : 'Create account'}
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
              : 'Already have an account? Sign in'}
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
  error: { color: '#B91C1C', fontSize: 14, lineHeight: 20, marginTop: 14 },
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
  switchButton: { alignItems: 'center', marginTop: 20, minHeight: 44, justifyContent: 'center' },
  switchText: { color: '#1D4ED8', fontSize: 15, fontWeight: '700' },
});

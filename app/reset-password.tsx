import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { parseRecoveryUrl } from '../src/lib/authLink';
import { isSupabaseConfigured, supabase } from '../src/lib/supabase';

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
  const handledUrl = useRef<string | null>(null);

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
        setLinkError('Supabase is not configured yet. Add the project URL and anon key first.');
        return;
      }
      const auth = client;
      const parsed = parseRecoveryUrl(url);

      if (parsed.kind === 'error') {
        if (cancelled) return;
        setChecking(false);
        setLinkError(parsed.message);
        return;
      }

      if (parsed.kind === 'session') {
        const { data, error } = await auth.auth.setSession({
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
        const { data, error } = await auth.auth.exchangeCodeForSession(parsed.code);
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

      // No tokens in the URL: accept a recovery session already restored from storage.
      const { data } = await auth.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setEmail(data.session.user.email ?? '');
        setReady(true);
        setChecking(false);
        return;
      }
      setChecking(false);
      setLinkError('Open the password reset link from your email on this device to continue.');
    }

    void establishSession();
    return () => {
      cancelled = true;
    };
  }, [url, initialChecked, currentUrl]);

  async function updatePassword() {
    if (!supabase || busy) return;

    if (password.length < 6) {
      setErrorMessage('Choose a password with at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('The passwords do not match.');
      return;
    }

    setBusy(true);
    setErrorMessage('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setErrorMessage(authErrorMessage(error));
      setBusy(false);
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userData.user?.id ?? '')
      .maybeSingle();
    router.replace(profile ? '/home' : '/welcome');
  }

  async function cancel() {
    if (supabase) await supabase.auth.signOut();
    router.replace('/auth');
  }

  if (checking) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1D4ED8" size="large" />
        <Text style={styles.message}>Checking your reset link…</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.centered}>
        <Text style={styles.eyebrow}>PASSWORD RESET</Text>
        <Text style={styles.title}>Reset link unavailable</Text>
        <Text style={styles.subtitle}>
          {linkError || 'Open the password reset link from your email on this device to continue.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/auth')}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Request a new link</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void cancel()} style={styles.cancel}>
          <Text style={styles.cancelText}>Back to sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>PASSWORD RESET</Text>
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.subtitle}>
          {email ? `Set a new password for ${email}.` : 'Set a new password for your account.'}
        </Text>

        <Text style={styles.label}>New password</Text>
        <TextInput
          accessibilityLabel="New password"
          autoCapitalize="none"
          autoComplete="new-password"
          onChangeText={setPassword}
          placeholder="At least 6 characters"
          placeholderTextColor="#64748B"
          secureTextEntry
          style={styles.input}
          value={password}
        />

        <Text style={styles.label}>Confirm new password</Text>
        <TextInput
          accessibilityLabel="Confirm new password"
          autoCapitalize="none"
          autoComplete="new-password"
          onChangeText={setConfirmPassword}
          onSubmitEditing={() => void updatePassword()}
          placeholder="Type it again"
          placeholderTextColor="#64748B"
          returnKeyType="go"
          secureTextEntry
          style={styles.input}
          value={confirmPassword}
        />

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
          disabled={busy || password.length < 6 || confirmPassword.length === 0}
          onPress={() => void updatePassword()}
          style={[
            styles.button,
            (busy || password.length < 6 || confirmPassword.length === 0) && styles.buttonDisabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Update password</Text>
          )}
        </Pressable>

        <Pressable accessibilityRole="button" onPress={() => void cancel()} style={styles.cancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#F8FAFC', flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 44 },
  centered: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
  },
  eyebrow: { color: '#1D4ED8', fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
  title: { color: '#0F172A', fontSize: 30, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  subtitle: {
    color: '#475569',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 10,
    textAlign: 'center',
  },
  message: { color: '#475569', fontSize: 16, marginTop: 18, textAlign: 'center' },
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
    paddingHorizontal: 24,
  },
  buttonDisabled: { backgroundColor: '#94A3B8' },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  cancel: { alignItems: 'center', justifyContent: 'center', marginTop: 18, minHeight: 44 },
  cancelText: { color: '#1D4ED8', fontSize: 15, fontWeight: '700' },
});

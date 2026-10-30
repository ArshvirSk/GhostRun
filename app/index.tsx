import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { isSupabaseConfigured, supabase } from '../src/lib/supabase';

export default function IndexScreen() {
  const router = useRouter();
  const [message, setMessage] = useState('Checking your session…');
  const [hasError, setHasError] = useState(false);

  const checkSession = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;

    const client = supabase;
    const { data, error } = await client.auth.getSession();
    if (error) {
      setHasError(true);
      setMessage(error.message);
      return;
    }

    if (!data.session) {
      router.replace('/auth');
      return;
    }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('id')
      .eq('id', data.session.user.id)
      .maybeSingle();

    if (profileError) {
      setHasError(true);
      setMessage(`Could not load your profile: ${profileError.message}`);
      return;
    }

    router.replace(profile ? '/home' : '/welcome');
  }, [router]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      void Promise.resolve().then(checkSession);
    }
  }, [checkSession]);

  return (
    <View style={styles.container}>
      {!isSupabaseConfigured ? (
        <>
          <Text style={styles.title}>GhostRun setup</Text>
          <Text style={styles.message}>
            Add your Supabase project URL and anon key to the local environment to continue.
          </Text>
        </>
      ) : hasError ? (
        <>
          <Text style={styles.title}>GhostRun setup</Text>
          <Text style={styles.message}>{message}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setHasError(false);
              setMessage('Checking your session…');
              void checkSession();
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color="#1D4ED8" size="large" />
          <Text style={styles.message}>{message}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
  },
  title: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 16,
  },
  message: {
    color: '#475569',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 18,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 12,
    marginTop: 20,
    minHeight: 50,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

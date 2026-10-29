import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { supabase } from '../src/lib/supabase';

export default function JoinGameScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function joinGame() {
    const normalized = code.trim().toUpperCase();
    if (normalized.length !== 4) {
      setErrorMessage('Enter the four-character lobby code.');
      return;
    }
    if (!supabase) {
      setErrorMessage('Supabase is not configured yet. Add the project URL and anon key first.');
      return;
    }

    setBusy(true);
    setErrorMessage('');
    const { data, error } = await supabase.rpc('join_game', { code: normalized });
    setBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    router.replace({ pathname: '/lobby/[id]', params: { id: data } });
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.eyebrow}>JOIN YOUR CREW</Text>
      <Text style={styles.title}>Enter a lobby code</Text>
      <Text style={styles.description}>Ask the host for the four-letter game code.</Text>
      <TextInput
        accessibilityLabel="Four-character lobby code"
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        maxLength={4}
        onChangeText={(value) => setCode(value.replace(/[^A-Za-z2-9]/g, '').toUpperCase())}
        onSubmitEditing={() => void joinGame()}
        placeholder="ABCD"
        placeholderTextColor="#94A3B8"
        returnKeyType="go"
        style={styles.codeInput}
        value={code}
      />
      {errorMessage !== '' && (
        <Text accessibilityRole="alert" style={styles.error}>
          {errorMessage}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void joinGame()}
        style={styles.primaryButton}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryText}>Join lobby</Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        style={styles.cancelButton}
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#F8FAFC', flex: 1, justifyContent: 'center', padding: 24 },
  eyebrow: { color: '#1D4ED8', fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: '#0F172A', fontSize: 30, fontWeight: '900', marginTop: 10 },
  description: { color: '#475569', fontSize: 16, lineHeight: 23, marginTop: 10 },
  codeInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderRadius: 14,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 30,
    fontWeight: '900',
    height: 72,
    letterSpacing: 12,
    marginTop: 30,
    textAlign: 'center',
  },
  error: { color: '#B91C1C', fontSize: 14, lineHeight: 20, marginTop: 12 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 14,
    justifyContent: 'center',
    marginTop: 22,
    minHeight: 56,
  },
  primaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  cancelButton: { alignItems: 'center', justifyContent: 'center', marginTop: 10, minHeight: 48 },
  cancelText: { color: '#475569', fontSize: 15, fontWeight: '700' },
});

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

const COLORS = ['#1D4ED8', '#059669', '#D97706', '#DB2777', '#7C3AED', '#0F766E'];

export default function WelcomeScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleContinue() {
    const cleanName = name.trim();
    if (
      cleanName.length < 1 ||
      cleanName.length > 20 ||
      !acknowledged ||
      !isSupabaseConfigured ||
      !supabase
    ) {
      return;
    }

    setSubmitting(true);
    setErrorMessage('');

    const client = supabase;
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      setErrorMessage(sessionError.message);
      setSubmitting(false);
      return;
    }

    if (!sessionData.session) {
      setSubmitting(false);
      router.replace('/auth');
      return;
    }

    const { error: profileError } = await client.rpc('upsert_profile', {
      name: cleanName,
      color,
    });
    if (profileError) {
      setErrorMessage(`Could not save your profile: ${profileError.message}`);
      setSubmitting(false);
      return;
    }

    router.replace('/home');
  }

  const canContinue =
    name.trim().length > 0 && name.trim().length <= 20 && acknowledged && isSupabaseConfigured;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>REAL-WORLD CHASE</Text>
        <Text style={styles.title}>Welcome to GhostRun</Text>
        <Text style={styles.subtitle}>Pick a name and colour for your player.</Text>

        <Text style={styles.label}>Display name</Text>
        <TextInput
          accessibilityLabel="Display name"
          autoCapitalize="words"
          maxLength={20}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor="#64748B"
          style={styles.input}
          value={name}
        />

        <Text style={styles.label}>Player colour</Text>
        <View style={styles.palette}>
          {COLORS.map((option) => (
            <Pressable
              accessibilityLabel={`Choose ${option} player colour`}
              accessibilityRole="radio"
              accessibilityState={{ checked: color === option }}
              key={option}
              onPress={() => setColor(option)}
              style={[
                styles.swatch,
                { backgroundColor: option },
                color === option && styles.selectedSwatch,
              ]}
            />
          ))}
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Play safe. Keep it private.</Text>
          <Text style={styles.noticeText}>
            Play in public, safe areas. Never trespass or cross roads unsafely. GhostRun uses your
            location to show your position; during a game it is shared only as allowed by your team
            and game rules. Your live location is not uploaded from this setup screen.
          </Text>
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acknowledged }}
          onPress={() => setAcknowledged((value) => !value)}
          style={styles.acknowledgement}
        >
          <View style={[styles.checkbox, acknowledged && styles.checkboxChecked]}>
            {acknowledged && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.acknowledgementText}>I understand and will play safely.</Text>
        </Pressable>

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
          disabled={!canContinue || submitting}
          onPress={() => void handleContinue()}
          style={[styles.button, (!canContinue || submitting) && styles.buttonDisabled]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
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
  palette: { flexDirection: 'row', gap: 14, marginTop: 4 },
  swatch: { borderColor: '#FFFFFF', borderRadius: 22, borderWidth: 3, height: 40, width: 40 },
  selectedSwatch: { borderColor: '#0F172A' },
  notice: { backgroundColor: '#E2E8F0', borderRadius: 14, marginTop: 26, padding: 16 },
  noticeTitle: { color: '#0F172A', fontSize: 16, fontWeight: '800', marginBottom: 6 },
  noticeText: { color: '#334155', fontSize: 14, lineHeight: 21 },
  acknowledgement: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
    minHeight: 48,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: '#64748B',
    borderRadius: 5,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkboxChecked: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  checkmark: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  acknowledgementText: { color: '#0F172A', flex: 1, fontSize: 15 },
  error: { color: '#B91C1C', fontSize: 14, lineHeight: 20, marginTop: 12 },
  button: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 14,
    justifyContent: 'center',
    marginTop: 22,
    minHeight: 56,
  },
  buttonDisabled: { backgroundColor: '#94A3B8' },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
});

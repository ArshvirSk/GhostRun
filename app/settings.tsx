import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { PRIVACY_CONTACT_EMAIL } from '../src/lib/privacy';
import { supabase } from '../src/lib/supabase';

const DELETE_WORD = 'DELETE';

export default function SettingsScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');

  async function exportData() {
    if (!supabase) return;
    setBusy('export');
    setError('');
    setNotice('');
    try {
      const { data, error: exportError } = await supabase.rpc('export_my_data');
      if (exportError) {
        setError(exportError.message);
        return;
      }
      const json = JSON.stringify(data ?? {}, null, 2);
      const filename = `ghostrun-export-${new Date().toISOString().slice(0, 10)}.json`;
      const path = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, json, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: 'application/json',
          dialogTitle: 'GhostRun data export',
        });
      } else {
        setNotice(`Export saved to ${path}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy('');
    }
  }

  async function deleteAccount() {
    if (!supabase || deleteWord.trim().toUpperCase() !== DELETE_WORD) return;
    setBusy('delete');
    setError('');
    try {
      const { data, error: deleteError } = await supabase.rpc('delete_my_data');
      if (deleteError) {
        setError(deleteError.message);
        return;
      }
      const accountRemoved = Boolean(
        data && typeof data === 'object' && (data as { account_removed?: boolean }).account_removed,
      );

      // Clear local data but keep the onboarding flag so a returning install
      // does not replay the tutorial.
      const keys = await AsyncStorage.getAllKeys();
      const removable = keys.filter((key) => key !== '@ghostrun:onboarded');
      if (removable.length > 0) await AsyncStorage.multiRemove(removable);

      await supabase.auth.signOut();
      router.replace('/auth');
      if (!accountRemoved) {
        setNotice('Your data is deleted. The sign-in record may need removing by support.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account deletion failed.');
    } finally {
      setBusy('');
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Pressable
        accessibilityLabel="Back"
        accessibilityRole="button"
        onPress={() => router.back()}
        style={styles.backRow}
      >
        <Ionicons color="#1D4ED8" name="chevron-back" size={20} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/privacy' as any)}
          style={styles.row}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Privacy</Text>
            <Text style={styles.rowSub}>Your choices, what we store, and why</Text>
          </View>
          <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardEyebrow}>YOUR DATA</Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy !== ''}
          onPress={() => void exportData()}
          style={styles.row}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Export my data</Text>
            <Text style={styles.rowSub}>Profile, choices, games and your own routes as JSON</Text>
          </View>
          {busy === 'export' ? (
            <ActivityIndicator color="#1D4ED8" size="small" />
          ) : (
            <Ionicons color="#94A3B8" name="download-outline" size={18} />
          )}
        </Pressable>
        <Text style={styles.contact}>Questions: {PRIVACY_CONTACT_EMAIL}</Text>
      </View>

      <View style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>Delete account and data</Text>
        <Text style={styles.dangerBody}>
          This removes your profile, your route history and your choices, and signs you out. Shared
          recaps other players already saved (for example screenshots) cannot be recalled.
        </Text>
        {!confirmingDelete ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setConfirmingDelete(true);
              setError('');
            }}
            style={styles.dangerButton}
          >
            <Text style={styles.dangerButtonText}>Delete account</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.confirmLabel}>Type {DELETE_WORD} to confirm</Text>
            <TextInput
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={setDeleteWord}
              placeholder={DELETE_WORD}
              placeholderTextColor="#94A3B8"
              style={styles.confirmInput}
              value={deleteWord}
            />
            <View style={styles.confirmRow}>
              <Pressable
                accessibilityRole="button"
                disabled={busy === 'delete'}
                onPress={() => {
                  setConfirmingDelete(false);
                  setDeleteWord('');
                }}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={deleteWord.trim().toUpperCase() !== DELETE_WORD || busy === 'delete'}
                onPress={() => void deleteAccount()}
                style={[
                  styles.dangerButton,
                  styles.confirmDelete,
                  deleteWord.trim().toUpperCase() !== DELETE_WORD && styles.dangerButtonDisabled,
                ]}
              >
                {busy === 'delete' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.dangerButtonText}>Delete forever</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </View>

      {notice !== '' && <Text style={styles.notice}>{notice}</Text>}
      {error !== '' && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#E2E8F0', padding: 18, paddingBottom: 48 },
  backRow: { alignItems: 'center', flexDirection: 'row', marginTop: 8 },
  backText: { color: '#1D4ED8', fontSize: 15, fontWeight: '700' },
  title: { color: '#0F172A', fontSize: 28, fontWeight: '900', marginBottom: 16, marginTop: 12 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    elevation: 2,
    marginBottom: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  cardEyebrow: {
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: 8,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
  },
  rowText: { flex: 1, paddingRight: 12 },
  rowTitle: { color: '#0F172A', fontSize: 16, fontWeight: '700' },
  rowSub: { color: '#64748B', fontSize: 13, lineHeight: 18, marginTop: 2 },
  contact: { color: '#64748B', fontSize: 12, paddingBottom: 10 },
  dangerCard: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  dangerTitle: { color: '#991B1B', fontSize: 16, fontWeight: '800' },
  dangerBody: { color: '#7F1D1D', fontSize: 13, lineHeight: 19, marginTop: 6 },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#DC2626',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  dangerButtonDisabled: { backgroundColor: '#FCA5A5' },
  dangerButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  confirmLabel: { color: '#991B1B', fontSize: 13, fontWeight: '700', marginTop: 14 },
  confirmInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FCA5A5',
    borderRadius: 10,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 16,
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  confirmRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelButton: {
    alignItems: 'center',
    borderColor: '#FCA5A5',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  cancelButtonText: { color: '#991B1B', fontSize: 15, fontWeight: '700' },
  confirmDelete: { flex: 2, marginTop: 0 },
  notice: { color: '#065F46', fontSize: 14, marginTop: 14, textAlign: 'center' },
  error: { color: '#991B1B', fontSize: 14, marginTop: 14, textAlign: 'center' },
});

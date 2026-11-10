import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  TextInput,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';
import { Chip } from '../src/ui/Chip';
import { Button } from '../src/ui/Button';
import { PRIVACY_CONTACT_EMAIL } from '../src/lib/privacy';
import { supabase } from '../src/lib/supabase';
import { useUnits } from '../src/utils/units';

const DELETE_WORD = 'DELETE';

export default function SettingsScreen() {
  const { colors, spacing, radii, themeMode, setThemeMode } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { unitSystem, setUnitSystem } = useUnits();

  // Settings State
  const [mapStyle, setMapStyle] = useState<'night' | 'standard'>('night');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Busy/Error states
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');

  useEffect(() => {
    async function loadPreferences() {
      try {
        const [storedMap, storedAudio, storedHaptics] = await Promise.all([
          AsyncStorage.getItem('@ghostrun:map_style'),
          AsyncStorage.getItem('@ghostrun:audio_enabled'),
          AsyncStorage.getItem('@ghostrun:haptics_enabled'),
        ]);

        if (storedMap === 'standard' || storedMap === 'night') {
          setMapStyle(storedMap);
        }
        if (storedAudio !== null) setAudioEnabled(storedAudio !== 'false');
        if (storedHaptics !== null) setHapticsEnabled(storedHaptics !== 'false');

        if (supabase) {
          const { data } = await supabase.auth.getUser();
          if (data.user?.email) setUserEmail(data.user.email);
        }
      } catch {
        // ignore
      }
    }
    void loadPreferences();
  }, []);

  const toggleMapStyle = async (val: boolean) => {
    const next = val ? 'night' : 'standard';
    setMapStyle(next);
    await AsyncStorage.setItem('@ghostrun:map_style', next);
  };

  const toggleAudio = async (val: boolean) => {
    setAudioEnabled(val);
    await AsyncStorage.setItem('@ghostrun:audio_enabled', String(val));
  };

  const toggleHaptics = async (val: boolean) => {
    setHapticsEnabled(val);
    await AsyncStorage.setItem('@ghostrun:haptics_enabled', String(val));
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setBusy('signout');
    try {
      await supabase.auth.signOut();
      router.replace('/auth');
    } catch {
      // ignore
    } finally {
      setBusy('');
    }
  };

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
          dialogTitle: 'GhostRun tactical data export',
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: spacing.lg,
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 32,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.backRow}
        >
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
          <Text variant="label" style={{ color: colors.primary, marginLeft: spacing.xs }}>
            BACK
          </Text>
        </Pressable>

        <Text variant="display" style={{ color: colors.text, marginTop: spacing.md }}>
          SETTINGS
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg }}>
          Tactical display, unit calibration, audio telemetry, and operative data management.
        </Text>

        {/* Display & Map Style */}
        <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
          TACTICAL DISPLAY
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginBottom: spacing.md }]}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Interface Theme
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                Calibrated for sunlight evasion (Light) and stealth night operations (Dark).
              </Text>
            </View>
            <View style={styles.chipToggle}>
              <Chip
                label="SYSTEM"
                variant={themeMode === 'system' ? 'accent' : 'muted'}
                size="sm"
                selected={themeMode === 'system'}
                onPress={() => void setThemeMode('system')}
              />
              <Chip
                label="LIGHT"
                variant={themeMode === 'light' ? 'accent' : 'muted'}
                size="sm"
                selected={themeMode === 'light'}
                onPress={() => void setThemeMode('light')}
              />
              <Chip
                label="DARK"
                variant={themeMode === 'dark' ? 'accent' : 'muted'}
                size="sm"
                selected={themeMode === 'dark'}
                onPress={() => void setThemeMode('dark')}
              />
            </View>
          </View>
        </Card>

        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Night Radar Map Style
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                Dark canvas is easier on the eyes and harder to spot in low-light operations.
              </Text>
            </View>
            <Switch
              value={mapStyle === 'night'}
              onValueChange={toggleMapStyle}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>
        </Card>

        {/* Units System */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          MEASUREMENT UNITS
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Distance Calibration
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                Applied to boundary radius, tag distance, and radar sweep telemetry.
              </Text>
            </View>
            <View style={styles.chipToggle}>
              <Chip
                label="METRIC (m/km)"
                variant={unitSystem === 'metric' ? 'accent' : 'muted'}
                size="sm"
                onPress={() => void setUnitSystem('metric')}
              />
              <Chip
                label="IMPERIAL (ft/mi)"
                variant={unitSystem === 'imperial' ? 'accent' : 'muted'}
                size="sm"
                onPress={() => void setUnitSystem('imperial')}
              />
            </View>
          </View>
        </Card>

        {/* Audio & Haptics */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          TACTICAL TELEMETRY
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, padding: 0 }]}>
          <View style={[styles.settingRow, { padding: spacing.md }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Audio Cues
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                Pings, countdown ticks, and warning alarms.
              </Text>
            </View>
            <Switch
              value={audioEnabled}
              onValueChange={toggleAudio}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          <View style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Haptic Feedback
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                Vibration pulses on proximity heat and radar arrivals.
              </Text>
            </View>
            <Switch
              value={hapticsEnabled}
              onValueChange={toggleHaptics}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>
        </Card>

        {/* Battery & Background Location Advice */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          HARDWARE & BATTERY
        </Text>
        <Card variant="elevated" style={[styles.card, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}>
          <View style={styles.alertHeader}>
            <MaterialCommunityIcons name="battery-charging-high" size={20} color={colors.radarScan} />
            <Text variant="label" style={{ color: colors.radarScan, marginLeft: spacing.xs }}>
              BATTERY OPTIMIZATION NOTICE
            </Text>
          </View>
          <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs, fontSize: 13, lineHeight: 18 }}>
            GhostRun uploads GPS updates while running in the background. If your phone enters deep sleep, fixes may stall. For best results, exclude GhostRun from aggressive OS battery savers.
          </Text>
        </Card>

        {/* Privacy & Account */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          PRIVACY & ACCOUNT
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, padding: 0 }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/privacy' as any)}
            style={[styles.settingRow, { padding: spacing.md }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Privacy & Data Management
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                Your choices, location retention, and ghost contributions.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={busy !== ''}
            onPress={() => void exportData()}
            style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Export My Data
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                Export profile, route logs, and consent history as JSON.
              </Text>
            </View>
            {busy === 'export' ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <MaterialCommunityIcons name="download-outline" size={20} color={colors.textMuted} />
            )}
          </Pressable>
        </Card>

        {/* Sign Out & Session */}
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 15 }}>
                Signed in as
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                {userEmail || 'Authenticated Operative'}
              </Text>
            </View>
            <Button
              title={busy === 'signout' ? 'Signing out...' : 'Sign Out'}
              variant="secondary"
              size="sm"
              onPress={() => void handleSignOut()}
            />
          </View>
        </Card>

        {/* Danger Zone */}
        <Card
          variant="elevated"
          style={[
            styles.card,
            { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder, marginTop: spacing.xl },
          ]}
        >
          <Text variant="title" style={{ color: colors.dangerText, fontSize: 16 }}>
            Delete Account and Data
          </Text>
          <Text variant="caption" style={{ color: colors.dangerText, marginTop: 4, lineHeight: 18 }}>
            Permanently purges your operative profile, personal trail points, and anonymous ghost paths. This action cannot be undone.
          </Text>

          {!confirmingDelete ? (
            <Button
              title="Delete Account"
              variant="danger"
              size="sm"
              style={{ marginTop: spacing.md }}
              onPress={() => setConfirmingDelete(true)}
            />
          ) : (
            <View style={{ marginTop: spacing.md }}>
              <Text variant="label" style={{ color: colors.dangerText }}>
                Type {DELETE_WORD} to confirm permanent deletion:
              </Text>
              <TextInput
                value={deleteWord}
                onChangeText={setDeleteWord}
                autoCapitalize="characters"
                placeholder={DELETE_WORD}
                placeholderTextColor={colors.dangerBorder}
                style={[
                  styles.confirmInput,
                  {
                    backgroundColor: colors.surface,
                    color: colors.text,
                    borderColor: colors.dangerBorder,
                    borderRadius: radii.sm,
                  },
                ]}
              />
              <View style={styles.confirmRow}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() => {
                    setConfirmingDelete(false);
                    setDeleteWord('');
                  }}
                />
                <Button
                  title={busy === 'delete' ? 'Deleting...' : 'Delete Forever'}
                  variant="danger"
                  size="sm"
                  style={{ flex: 1 }}
                  disabled={deleteWord.trim().toUpperCase() !== DELETE_WORD || busy === 'delete'}
                  onPress={() => void deleteAccount()}
                />
              </View>
            </View>
          )}
        </Card>

        {notice !== '' && (
          <Text variant="body" style={{ color: colors.primary, marginTop: spacing.md, textAlign: 'center' }}>
            {notice}
          </Text>
        )}
        {error !== '' && (
          <Text variant="body" style={{ color: colors.danger, marginTop: spacing.md, textAlign: 'center' }}>
            {error}
          </Text>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            onPress={() => void Linking.openURL(`mailto:${PRIVACY_CONTACT_EMAIL}`)}
            style={{ marginBottom: 4 }}
          >
            <Text variant="caption" style={{ color: colors.textMuted }}>
              Questions & Security: {PRIVACY_CONTACT_EMAIL}
            </Text>
          </Pressable>
          <Text variant="mono" style={{ color: colors.textSubtle, fontSize: 11 }}>
            GhostRun v2.7.2 · Operative Release
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 48,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  card: {
    padding: 16,
    borderWidth: 1,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipToggle: {
    flexDirection: 'row',
    gap: 6,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  confirmInput: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    fontSize: 15,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  footer: {
    alignItems: 'center',
    marginTop: 32,
    paddingVertical: 12,
  },
});

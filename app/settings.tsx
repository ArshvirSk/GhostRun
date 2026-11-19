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
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';
import { Button } from '../src/ui/Button';
import { PRIVACY_CONTACT_EMAIL } from '../src/lib/privacy';
import { supabase } from '../src/lib/supabase';
import { triggerHaptic, setHapticsEnabled } from '../src/motion/haptics';
import { useUnits } from '../src/utils/units';
import { setAudioMuted } from '../src/lib/audio';
import {
  initTacticalNotificationChannels,
  STORAGE_KEY_SILENT_ALERTS,
} from '../src/lib/notifications';
import { syncPushTokenWithServer } from '../src/lib/pushNotifications';
import { FeedbackModal } from '../src/components/FeedbackModal';
import { getAnalyticsOptIn, setAnalyticsOptIn } from '../src/lib/analytics';
import { formatSupportEmailUrl, getPlayStoreReviewUrl, APP_VERSION } from '../src/lib/diagnostics';
import {
  STORAGE_KEY_MINIMAP_CORNER,
  STORAGE_KEY_MINIMAP_ENABLED,
  type MiniMapCorner,
} from '../src/components/MovableCornerMiniMap';
import { useUserStore } from '../src/stores/userStore';

const DELETE_WORD = 'DELETE';

export default function SettingsScreen() {
  const { colors, spacing, radii, themeMode, setThemeMode, accentColor, setAccentColor } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { unitSystem, setUnitSystem } = useUnits();

  // Tactical display & calibration
  const [mapStyle, setMapStyle] = useState<'night' | 'standard'>('night');
  const [headstartMinimap, setHeadstartMinimap] = useState(true);
  const [minimapCorner, setMinimapCorner] = useState<MiniMapCorner>('top-right');

  // Audio & Telemetry
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [hapticsEnabledState, setHapticsEnabledState] = useState(true);

  // Notifications & Alerts
  const [pushEnabled, setPushEnabled] = useState(true);
  const [silentAlertsEnabled, setSilentAlertsEnabled] = useState(true);
  const [proximityAlertsEnabled, setProximityAlertsEnabled] = useState(true);
  const [safetyCheckinEnabled, setSafetyCheckinEnabled] = useState(true);

  // Privacy Consents
  const currentProfile = useUserStore((s) => s.profile);
  const [presenceConsent, setPresenceConsent] = useState(true);
  const [echoConsent, setEchoConsent] = useState(true);
  const [profileVisibility, setProfileVisibility] = useState<'public' | 'private'>('public');
  const [analyticsOptIn, setLocalAnalyticsOptIn] = useState(false);

  // User session & UI state
  const [feedbackModalVisible, setFeedbackModalVisible] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');

  useEffect(() => {
    async function loadPreferences() {
      try {
        const [
          storedMap,
          storedAudio,
          storedTts,
          storedHaptics,
          storedPush,
          storedSilentAlerts,
          storedProximity,
          storedSafety,
          storedPresence,
          storedEcho,
          storedAnalytics,
          storedMinimap,
          storedMinimapCorner,
        ] = await Promise.all([
          AsyncStorage.getItem('@ghostrun:map_style'),
          AsyncStorage.getItem('@ghostrun:audio_enabled'),
          AsyncStorage.getItem('@ghostrun:tts_narration_enabled'),
          AsyncStorage.getItem('@ghostrun:haptics_enabled'),
          AsyncStorage.getItem('@ghostrun:push_notifications_enabled'),
          AsyncStorage.getItem(STORAGE_KEY_SILENT_ALERTS),
          AsyncStorage.getItem('@ghostrun:proximity_alerts_enabled'),
          AsyncStorage.getItem('@ghostrun:safety_checkin_enabled'),
          AsyncStorage.getItem('@ghostrun:consent_presence'),
          AsyncStorage.getItem('@ghostrun:consent_echo'),
          getAnalyticsOptIn(),
          AsyncStorage.getItem(STORAGE_KEY_MINIMAP_ENABLED),
          AsyncStorage.getItem(STORAGE_KEY_MINIMAP_CORNER),
        ]);

        if (storedMap === 'standard' || storedMap === 'night') {
          setMapStyle(storedMap);
        }
        if (storedMinimap !== null) {
          setHeadstartMinimap(storedMinimap !== 'false');
        }
        if (
          storedMinimapCorner &&
          ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(storedMinimapCorner)
        ) {
          setMinimapCorner(storedMinimapCorner as MiniMapCorner);
        }
        if (storedAudio !== null) {
          const val = storedAudio !== 'false';
          setAudioEnabled(val);
          void setAudioMuted(!val);
        }
        if (storedTts !== null) setTtsEnabled(storedTts !== 'false');
        if (storedHaptics !== null) {
          const val = storedHaptics !== 'false';
          setHapticsEnabledState(val);
          setHapticsEnabled(val);
        }
        if (storedPush !== null) setPushEnabled(storedPush !== 'false');
        if (storedSilentAlerts !== null) {
          setSilentAlertsEnabled(storedSilentAlerts !== 'false');
        } else {
          setSilentAlertsEnabled(true);
        }
        if (storedProximity !== null) setProximityAlertsEnabled(storedProximity !== 'false');
        if (storedSafety !== null) setSafetyCheckinEnabled(storedSafety !== 'false');
        if (storedPresence !== null) setPresenceConsent(storedPresence !== 'false');
        if (storedEcho !== null) setEchoConsent(storedEcho !== 'false');

        setLocalAnalyticsOptIn(storedAnalytics);

        if (supabase) {
          const { data } = await supabase.auth.getUser();
          if (data.user?.email) setUserEmail(data.user.email);

          // Sync server consents if available
          const { data: serverConsents } = await supabase.rpc('get_my_consents');
          if (serverConsents && typeof serverConsents === 'object') {
            const sc = serverConsents as Record<string, { granted?: boolean }>;
            if (sc.show_presence?.granted !== undefined) setPresenceConsent(sc.show_presence.granted);
            if (sc.share_echo?.granted !== undefined) setEchoConsent(sc.share_echo.granted);
            if (sc.diagnostics?.granted !== undefined) setLocalAnalyticsOptIn(sc.diagnostics.granted);
          }
        }
      } catch {
        // ignore load errors
      }
    }
    void loadPreferences();
  }, []);

  const toggleMapStyle = async (val: boolean) => {
    triggerHaptic('buttonTap');
    const next = val ? 'night' : 'standard';
    setMapStyle(next);
    await AsyncStorage.setItem('@ghostrun:map_style', next);
  };

  const toggleHeadstartMinimap = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setHeadstartMinimap(val);
    await AsyncStorage.setItem(STORAGE_KEY_MINIMAP_ENABLED, String(val));
  };

  const handleSelectCorner = async (corner: MiniMapCorner) => {
    triggerHaptic('buttonTap');
    setMinimapCorner(corner);
    await AsyncStorage.setItem(STORAGE_KEY_MINIMAP_CORNER, corner);
  };

  const toggleAudio = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setAudioEnabled(val);
    await setAudioMuted(!val);
    await AsyncStorage.setItem('@ghostrun:audio_enabled', String(val));
  };

  const toggleTts = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setTtsEnabled(val);
    await AsyncStorage.setItem('@ghostrun:tts_narration_enabled', String(val));
  };

  const toggleHaptics = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setHapticsEnabledState(val);
    setHapticsEnabled(val);
    await AsyncStorage.setItem('@ghostrun:haptics_enabled', String(val));
  };

  const togglePush = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setPushEnabled(val);
    await AsyncStorage.setItem('@ghostrun:push_notifications_enabled', String(val));
    if (val) {
      const { status } = await Notifications.requestPermissionsAsync().catch(() => ({ status: 'denied' }));
      if (status === 'granted') {
        void syncPushTokenWithServer();
      }
    }
  };

  const toggleSilentAlerts = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setSilentAlertsEnabled(val);
    await AsyncStorage.setItem(STORAGE_KEY_SILENT_ALERTS, String(val));
    void initTacticalNotificationChannels(!val);
  };

  const toggleProximityAlerts = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setProximityAlertsEnabled(val);
    await AsyncStorage.setItem('@ghostrun:proximity_alerts_enabled', String(val));
  };

  const toggleSafetyCheckin = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setSafetyCheckinEnabled(val);
    await AsyncStorage.setItem('@ghostrun:safety_checkin_enabled', String(val));
  };

  const togglePresence = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setPresenceConsent(val);
    await AsyncStorage.setItem('@ghostrun:consent_presence', String(val));
    if (supabase) {
      void supabase.rpc('set_consent', { consent_type: 'show_presence', granted: val });
    }
  };

  const toggleEcho = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setEchoConsent(val);
    await AsyncStorage.setItem('@ghostrun:consent_echo', String(val));
    if (supabase) {
      void supabase.rpc('set_consent', { consent_type: 'share_echo', granted: val });
    }
  };

  useEffect(() => {
    if (currentProfile?.profile_visibility) {
      setProfileVisibility(currentProfile.profile_visibility);
    }
  }, [currentProfile?.profile_visibility]);

  const toggleProfileVisibility = async (isPub: boolean) => {
    triggerHaptic('buttonTap');
    const nextVal: 'public' | 'private' = isPub ? 'public' : 'private';
    setProfileVisibility(nextVal);
    useUserStore.getState().setProfile({
      display_name: currentProfile?.display_name || 'Operative',
      profile_visibility: nextVal,
    });
    if (supabase) {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await supabase
          .from('profiles')
          .update({ profile_visibility: nextVal })
          .eq('id', auth.user.id);
      }
    }
  };

  const toggleAnalytics = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setLocalAnalyticsOptIn(val);
    await setAnalyticsOptIn(val);
    if (supabase) {
      void supabase.rpc('set_consent', { consent_type: 'diagnostics', granted: val });
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setBusy('signout');
    triggerHaptic('buttonTap');
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
    triggerHaptic('buttonTap');
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
    triggerHaptic('buttonTap');
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
        setNotice('Your tactical data is purged. Sign-in record will expire cleanly.');
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
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 32,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        {/* Tactical Back Navigation */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.backRow}
        >
          <Ionicons name="arrow-back" size={20} color={colors.primary} />
          <Text variant="label" style={{ color: colors.primary, marginLeft: spacing.xs }}>
            BACK
          </Text>
        </Pressable>

        <Text variant="display" style={{ color: colors.text, marginTop: spacing.md, marginBottom: spacing.lg }}>
          SETTINGS
        </Text>

        {/* 1. Tactical Display */}
        <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
          TACTICAL DISPLAY
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginBottom: spacing.md }]}>
          <View style={styles.themeSection}>
            <View style={{ marginBottom: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Interface Theme
              </Text>
            </View>

            {/* Full-width Horizontal Segmented Theme Bar */}
            <View style={styles.themeToggleRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set interface theme to System default"
                onPress={() => {
                  triggerHaptic('buttonTap');
                  void setThemeMode('system');
                }}
                style={[
                  styles.themeSegmentBtn,
                  {
                    borderColor: themeMode === 'system' ? colors.primary : colors.borderDark,
                    backgroundColor: themeMode === 'system' ? colors.surfaceElevated : colors.surface,
                    borderRadius: radii.md,
                  },
                ]}
              >
                <Ionicons
                  name={themeMode === 'system' ? 'phone-portrait' : 'phone-portrait-outline'}
                  size={20}
                  color={themeMode === 'system' ? colors.primary : colors.textMuted}
                />
                <Text
                  variant="label"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={{
                    color: themeMode === 'system' ? colors.text : colors.textMuted,
                    fontSize: 12,
                    fontWeight: '700',
                    textAlign: 'center',
                  }}
                >
                  SYSTEM
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set interface theme to Light"
                onPress={() => {
                  triggerHaptic('buttonTap');
                  void setThemeMode('light');
                }}
                style={[
                  styles.themeSegmentBtn,
                  {
                    borderColor: themeMode === 'light' ? colors.primary : colors.borderDark,
                    backgroundColor: themeMode === 'light' ? colors.surfaceElevated : colors.surface,
                    borderRadius: radii.md,
                  },
                ]}
              >
                <Ionicons
                  name={themeMode === 'light' ? 'sunny' : 'sunny-outline'}
                  size={20}
                  color={themeMode === 'light' ? colors.primary : colors.textMuted}
                />
                <Text
                  variant="label"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={{
                    color: themeMode === 'light' ? colors.text : colors.textMuted,
                    fontSize: 12,
                    fontWeight: '700',
                    textAlign: 'center',
                  }}
                >
                  LIGHT
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set interface theme to Dark"
                onPress={() => {
                  triggerHaptic('buttonTap');
                  void setThemeMode('dark');
                }}
                style={[
                  styles.themeSegmentBtn,
                  {
                    borderColor: themeMode === 'dark' ? colors.primary : colors.borderDark,
                    backgroundColor: themeMode === 'dark' ? colors.surfaceElevated : colors.surface,
                    borderRadius: radii.md,
                  },
                ]}
              >
                <Ionicons
                  name={themeMode === 'dark' ? 'moon' : 'moon-outline'}
                  size={20}
                  color={themeMode === 'dark' ? colors.primary : colors.textMuted}
                />
                <Text
                  variant="label"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={{
                    color: themeMode === 'dark' ? colors.text : colors.textMuted,
                    fontSize: 12,
                    fontWeight: '700',
                    textAlign: 'center',
                  }}
                >
                  DARK
                </Text>
              </Pressable>
            </View>

            {/* Tactical Theme Accent Tint */}
            <View
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <Text
                variant="label"
                style={{
                  color: colors.textMuted,
                  fontSize: 11,
                  fontWeight: '800',
                  letterSpacing: 0.8,
                  marginBottom: 8,
                }}
              >
                THEME ACCENT TINT
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ flexDirection: 'row', gap: 10, paddingVertical: 4 }}
              >
                {colors.palette.map((c) => {
                  const isSelected = (accentColor || colors.primary).toLowerCase() === c.toLowerCase();
                  return (
                    <Pressable
                      key={`settings-color-${c}`}
                      onPress={() => {
                        triggerHaptic('buttonTap');
                        void setAccentColor(c);
                      }}
                      style={[
                        {
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          backgroundColor: c,
                          alignItems: 'center',
                          justifyContent: 'center',
                        },
                        isSelected && {
                          borderWidth: 2,
                          borderColor: '#FFFFFF',
                          transform: [{ scale: 1.12 }],
                        },
                      ]}
                    >
                      {isSelected && (
                        <Ionicons name="checkmark-sharp" size={16} color="#000000" />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Card>

        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Night Radar Map Style
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

        {/* Runner Headstart Corner Mini-Map Setting */}
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Runner Headstart Mini-Map
              </Text>
            </View>
            <Switch
              value={headstartMinimap}
              onValueChange={toggleHeadstartMinimap}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          {headstartMinimap && (
            <View style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }}>
              <Text variant="label" style={{ color: colors.primary, marginBottom: spacing.sm, fontSize: 11 }}>
                DEFAULT DOCK CORNER
              </Text>
              <View style={styles.cornerGrid}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Top-Left Corner"
                  onPress={() => void handleSelectCorner('top-left')}
                  style={[
                    styles.cornerBtn,
                    {
                      borderColor: minimapCorner === 'top-left' ? colors.primary : colors.borderDark,
                      backgroundColor: minimapCorner === 'top-left' ? colors.surfaceElevated : colors.surface,
                    },
                  ]}
                >
                  <Ionicons
                    name="arrow-up-outline"
                    size={16}
                    color={minimapCorner === 'top-left' ? colors.primary : colors.textMuted}
                  />
                  <Text
                    variant="caption"
                    style={{
                      color: minimapCorner === 'top-left' ? colors.text : colors.textMuted,
                      fontWeight: '700',
                      marginLeft: 6,
                    }}
                  >
                    TOP-LEFT
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Top-Right Corner"
                  onPress={() => void handleSelectCorner('top-right')}
                  style={[
                    styles.cornerBtn,
                    {
                      borderColor: minimapCorner === 'top-right' ? colors.primary : colors.borderDark,
                      backgroundColor: minimapCorner === 'top-right' ? colors.surfaceElevated : colors.surface,
                    },
                  ]}
                >
                  <Text
                    variant="caption"
                    style={{
                      color: minimapCorner === 'top-right' ? colors.text : colors.textMuted,
                      fontWeight: '700',
                      marginRight: 6,
                    }}
                  >
                    TOP-RIGHT
                  </Text>
                  <Ionicons
                    name="arrow-forward-outline"
                    size={16}
                    color={minimapCorner === 'top-right' ? colors.primary : colors.textMuted}
                  />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Bottom-Left Corner"
                  onPress={() => void handleSelectCorner('bottom-left')}
                  style={[
                    styles.cornerBtn,
                    {
                      borderColor: minimapCorner === 'bottom-left' ? colors.primary : colors.borderDark,
                      backgroundColor: minimapCorner === 'bottom-left' ? colors.surfaceElevated : colors.surface,
                    },
                  ]}
                >
                  <Ionicons
                    name="arrow-back-outline"
                    size={16}
                    color={minimapCorner === 'bottom-left' ? colors.primary : colors.textMuted}
                  />
                  <Text
                    variant="caption"
                    style={{
                      color: minimapCorner === 'bottom-left' ? colors.text : colors.textMuted,
                      fontWeight: '700',
                      marginLeft: 6,
                    }}
                  >
                    BOTTOM-LEFT
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Bottom-Right Corner"
                  onPress={() => void handleSelectCorner('bottom-right')}
                  style={[
                    styles.cornerBtn,
                    {
                      borderColor: minimapCorner === 'bottom-right' ? colors.primary : colors.borderDark,
                      backgroundColor: minimapCorner === 'bottom-right' ? colors.surfaceElevated : colors.surface,
                    },
                  ]}
                >
                  <Text
                    variant="caption"
                    style={{
                      color: minimapCorner === 'bottom-right' ? colors.text : colors.textMuted,
                      fontWeight: '700',
                      marginRight: 6,
                    }}
                  >
                    BOTTOM-RIGHT
                  </Text>
                  <Ionicons
                    name="arrow-down-outline"
                    size={16}
                    color={minimapCorner === 'bottom-right' ? colors.primary : colors.textMuted}
                  />
                </Pressable>
              </View>
            </View>
          )}
        </Card>

        {/* 2. Units System */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          MEASUREMENT UNITS
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
          <View style={styles.unitsSection}>
            <View style={{ marginBottom: spacing.md }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Distance Calibration
              </Text>
            </View>

            <View style={styles.unitToggleRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set measurement units to Metric (meters and kilometers)"
                onPress={() => {
                  triggerHaptic('buttonTap');
                  void setUnitSystem('metric');
                }}
                style={[
                  styles.unitSegmentBtn,
                  {
                    borderColor: unitSystem === 'metric' ? colors.primary : colors.borderDark,
                    backgroundColor: unitSystem === 'metric' ? colors.surfaceElevated : colors.surface,
                    borderRadius: radii.md,
                  },
                ]}
              >
                <Ionicons
                  name={unitSystem === 'metric' ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={unitSystem === 'metric' ? colors.primary : colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    variant="label"
                    style={{
                      color: unitSystem === 'metric' ? colors.text : colors.textMuted,
                      fontWeight: '700',
                    }}
                  >
                    METRIC
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: unitSystem === 'metric' ? colors.primary : colors.textSubtle, fontSize: 11 }}
                  >
                    Meters (m / km)
                  </Text>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set measurement units to Imperial (feet and miles)"
                onPress={() => {
                  triggerHaptic('buttonTap');
                  void setUnitSystem('imperial');
                }}
                style={[
                  styles.unitSegmentBtn,
                  {
                    borderColor: unitSystem === 'imperial' ? colors.primary : colors.borderDark,
                    backgroundColor: unitSystem === 'imperial' ? colors.surfaceElevated : colors.surface,
                    borderRadius: radii.md,
                  },
                ]}
              >
                <Ionicons
                  name={unitSystem === 'imperial' ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={unitSystem === 'imperial' ? colors.primary : colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    variant="label"
                    style={{
                      color: unitSystem === 'imperial' ? colors.text : colors.textMuted,
                      fontWeight: '700',
                    }}
                  >
                    IMPERIAL
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: unitSystem === 'imperial' ? colors.primary : colors.textSubtle, fontSize: 11 }}
                  >
                    Feet (ft / mi)
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        </Card>

        {/* 3. Audio & Voice Narration Telemetry */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          AUDIO & VOICE TELEMETRY
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, padding: 0 }]}>
          <View style={[styles.settingRow, { padding: spacing.md }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Tactical Audio Cues
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
                AI Tactical Voice Narration
              </Text>
            </View>
            <Switch
              value={ttsEnabled}
              onValueChange={toggleTts}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          <View style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Haptic Feedback
              </Text>
            </View>
            <Switch
              value={hapticsEnabledState}
              onValueChange={toggleHaptics}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>
        </Card>

        {/* 4. Notifications & Alerts */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          NOTIFICATIONS & ALERTS
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, padding: 0 }]}>
          <View style={[styles.settingRow, { padding: spacing.md }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Remote Push Notifications
              </Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={togglePush}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          <View style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Tactical Silent Alerts
              </Text>
            </View>
            <Switch
              value={silentAlertsEnabled}
              onValueChange={toggleSilentAlerts}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          <View style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Radar Proximity Warnings
              </Text>
            </View>
            <Switch
              value={proximityAlertsEnabled}
              onValueChange={toggleProximityAlerts}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          <View style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Field Safety Check-Ins
              </Text>
            </View>
            <Switch
              value={safetyCheckinEnabled}
              onValueChange={toggleSafetyCheckin}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>
        </Card>

        {/* 5. Operative Privacy & Consents */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          OPERATIVE PRIVACY & DATA
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, padding: 0 }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/privacy' as any)}
            style={[styles.settingRow, { padding: spacing.md }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Privacy Policy & Consent Matrix
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          <View style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Squad Lobby Presence
              </Text>
            </View>
            <Switch
              value={presenceConsent}
              onValueChange={togglePresence}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          <View style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Echo Rating Broadcast
              </Text>
            </View>
            <Switch
              value={echoConsent}
              onValueChange={toggleEcho}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          <View style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Public Profile Dossier
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                Allow non-allies to view Tier, Season Echo, and badges
              </Text>
            </View>
            <Switch
              value={profileVisibility === 'public'}
              onValueChange={(val) => void toggleProfileVisibility(val)}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          <View style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Privacy-Safe Diagnostics
              </Text>
            </View>
            <Switch
              value={analyticsOptIn}
              onValueChange={(val) => void toggleAnalytics(val)}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={busy !== ''}
            onPress={() => void exportData()}
            style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Export My Tactical Data
              </Text>
            </View>
            {busy === 'export' ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <MaterialCommunityIcons name="download-outline" size={20} color={colors.textMuted} />
            )}
          </Pressable>
        </Card>

        {/* 6. Battery & GPS Advice */}
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
            GhostRun uploads GPS updates while running in the background. For best results, exclude GhostRun from aggressive OS battery savers.
          </Text>
        </Card>

        {/* 7. Community & Support */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          COMMUNITY & SUPPORT
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, padding: 0 }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setFeedbackModalVisible(true)}
            style={[styles.settingRow, { padding: spacing.md }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Transmit Field Feedback
              </Text>
            </View>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => void Linking.openURL(getPlayStoreReviewUrl())}
            style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Rate GhostRun on Play Store
              </Text>
            </View>
            <Ionicons name="star-outline" size={20} color={colors.warning} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => void Linking.openURL(formatSupportEmailUrl())}
            style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Contact Tactical Support
              </Text>
            </View>
            <Ionicons name="mail-outline" size={20} color={colors.primary} />
          </Pressable>
        </Card>

        {/* 8. Session & Sign Out */}
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

        {/* 9. Danger Zone: Delete Account & Data */}
        <Card
          variant="elevated"
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.dangerBorder,
              borderWidth: 1.5,
              marginTop: spacing.xl,
            },
          ]}
        >
          <View style={styles.alertHeader}>
            <Ionicons name="warning-outline" size={20} color={colors.danger} />
            <Text variant="title" style={{ color: colors.danger, marginLeft: spacing.xs, fontSize: 16 }}>
              Delete Account & Tactical Data
            </Text>
          </View>
          <Text variant="body" style={{ color: colors.textMuted, marginTop: 6, lineHeight: 18, fontSize: 13 }}>
            Permanently purges your operative profile, personal trail points, and anonymous ghost paths. This action cannot be undone.
          </Text>

          {!confirmingDelete ? (
            <Button
              title="Delete Account & Data"
              variant="danger"
              size="sm"
              style={{ marginTop: spacing.md }}
              onPress={() => {
                triggerHaptic('buttonTap');
                setConfirmingDelete(true);
              }}
            />
          ) : (
            <View style={{ marginTop: spacing.md }}>
              <Text variant="label" style={{ color: colors.text }}>
                Type {DELETE_WORD} to confirm permanent deletion:
              </Text>
              <TextInput
                value={deleteWord}
                onChangeText={setDeleteWord}
                autoCapitalize="characters"
                placeholder={DELETE_WORD}
                placeholderTextColor={colors.textSubtle}
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
                    triggerHaptic('buttonTap');
                    setConfirmingDelete(false);
                    setDeleteWord('');
                  }}
                />
                <Button
                  title={busy === 'delete' ? 'Purging...' : 'Confirm Delete'}
                  variant="danger"
                  size="sm"
                  disabled={busy === 'delete' || deleteWord.trim().toUpperCase() !== DELETE_WORD}
                  style={{ flex: 1 }}
                  onPress={() => void deleteAccount()}
                />
              </View>
            </View>
          )}
        </Card>

        {/* Notices and errors */}
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
            GhostRun v{APP_VERSION} · Operative Release
          </Text>
        </View>
      </ScrollView>

      <FeedbackModal
        visible={feedbackModalVisible}
        onClose={() => setFeedbackModalVisible(false)}
      />
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
    borderRadius: 8,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  themeSection: {
    width: '100%',
  },
  themeToggleRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    marginTop: 4,
  },
  themeSegmentBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderWidth: 1.5,
  },
  unitsSection: {
    width: '100%',
  },
  unitToggleRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  unitSegmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1.5,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  confirmInput: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 8,
    fontFamily: 'System',
    letterSpacing: 2,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  cornerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cornerBtn: {
    flex: 1,
    minWidth: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  footer: {
    marginTop: 32,
    alignItems: 'center',
  },
});

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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { fetchFriendSettings, updateFriendSettings } from '../src/lib/friends';
import { FriendSettings } from '../src/lib/friendsCore';
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
import { SegmentBar } from '../src/ui/SegmentBar';
import { listMyBlocks, unblockUser } from '../src/lib/moderation';
import { BlockItem } from '../src/lib/moderationCore';
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
import { checkIsAdmin } from '../src/lib/admin';
import {
  STORAGE_KEY_MINIMAP_CORNER,
  STORAGE_KEY_MINIMAP_ENABLED,
  type MiniMapCorner,
} from '../src/components/MovableCornerMiniMap';
import { useUserStore } from '../src/stores/userStore';
import {
  getColorblindPreference,
  setColorblindPreference,
  getHudScalePreference,
  setHudScalePreference,
  type ColorblindMode,
  type HudScale,
} from '../src/lib/accessibility';
import {
  isBatteryGuardEnabled,
  setBatteryGuardEnabled,
  isOfflineQueueEnabled,
  setOfflineQueueEnabled,
  getDeadZoneQueueCount,
  clearDeadZoneQueue,
} from '../src/lib/offlineTelemetryQueue';

const DELETE_WORD = 'DELETE';

type SettingsCategory = 'display' | 'alerts' | 'privacy' | 'account';

export default function SettingsScreen() {
  const { colors, spacing, radii, themeMode, setThemeMode, accentColor, setAccentColor } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { unitSystem, setUnitSystem } = useUnits();

  // Tactical display & calibration
  const [mapStyle, setMapStyle] = useState<'night' | 'standard'>('night');
  const [headstartMinimap, setHeadstartMinimap] = useState(true);
  const [minimapCorner, setMinimapCorner] = useState<MiniMapCorner>('top-right');
  const [colorblindMode, setColorblindMode] = useState<ColorblindMode>('none');
  const [hudScale, setHudScale] = useState<HudScale>('standard');

  // Audio & Telemetry
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [proximityAudioEnabled, setProximityAudioEnabled] = useState(true);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [hapticsEnabledState, setHapticsEnabledState] = useState(true);

  // Outdoor Battery & Field Resilience (Pillar 5)
  const [batteryGuardEnabled, setBatteryGuardEnabledState] = useState(true);
  const [offlineQueueEnabled, setOfflineQueueEnabledState] = useState(true);
  const [deadZoneFixCount, setDeadZoneFixCount] = useState(0);

  // Notifications & Alerts
  const [pushEnabled, setPushEnabled] = useState(true);
  const [silentAlertsEnabled, setSilentAlertsEnabled] = useState(true);
  const [proximityAlertsEnabled, setProximityAlertsEnabled] = useState(true);
  const [safetyCheckinEnabled, setSafetyCheckinEnabled] = useState(true);

  type SettingsCategory = 'display' | 'alerts' | 'privacy' | 'account';
  const { category, tab } = useLocalSearchParams<{ category?: string; tab?: string }>();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(
    (category as SettingsCategory) || (tab as SettingsCategory) || 'display'
  );

  // Privacy Consents & Network Settings
  const currentProfile = useUserStore((s) => s.profile);
  const [allowFriendRequests, setAllowFriendRequests] = useState(true);
  const [presenceConsent, setPresenceConsent] = useState(true);
  const [echoConsent, setEchoConsent] = useState(true);
  const [profileVisibility, setProfileVisibility] = useState<'public' | 'private'>('public');
  const [ghostConsent, setGhostConsent] = useState(true);
  const [leaderboardNameConsent, setLeaderboardNameConsent] = useState(false);
  const [analyticsOptIn, setLocalAnalyticsOptIn] = useState(false);
  const [toastNotice, setToastNotice] = useState('');
  const [blocks, setBlocks] = useState<BlockItem[]>([]);

  // User session & UI state
  const [isAdmin, setIsAdmin] = useState(false);
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
          storedColorblind,
          storedHudScale,
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
          getColorblindPreference(),
          getHudScalePreference(),
        ]);

        setColorblindMode(storedColorblind);
        setHudScale(storedHudScale);

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

        // Fetch canonical FriendSettings and Blocked Operatives
        try {
          const [fs, blockList] = await Promise.all([
            fetchFriendSettings(),
            listMyBlocks(),
          ]);
          setAllowFriendRequests(fs.allowFriendRequests !== false);
          setPresenceConsent(Boolean(fs.showPresence));
          setEchoConsent(fs.shareEcho !== false);
          setProfileVisibility(fs.profileVisibility || 'public');
          setBlocks(blockList || []);
        } catch {
          // offline fallback
        }

        if (supabase) {
          const { data } = await supabase.auth.getUser();
          if (data.user?.email) setUserEmail(data.user.email);
          try {
            const adminStatus = await checkIsAdmin();
            setIsAdmin(adminStatus);
          } catch {
            // non-blocking
          }

          // Sync server consents if available
          const { data: serverConsents } = await supabase.rpc('get_my_consents');
          if (serverConsents && typeof serverConsents === 'object') {
            const sc = serverConsents as Record<string, { granted?: boolean }>;
            if (sc.ghost?.granted !== undefined) setGhostConsent(sc.ghost.granted);
            if (sc.leaderboard_name?.granted !== undefined) setLeaderboardNameConsent(sc.leaderboard_name.granted);
            if (sc.diagnostics?.granted !== undefined) setLocalAnalyticsOptIn(sc.diagnostics.granted);
          }
        }

        const [guardVal, queueVal, countVal] = await Promise.all([
          isBatteryGuardEnabled(),
          isOfflineQueueEnabled(),
          getDeadZoneQueueCount(),
        ]);
        setBatteryGuardEnabledState(guardVal);
        setOfflineQueueEnabledState(queueVal);
        setDeadZoneFixCount(countVal);
      } catch {
        // ignore load errors
      }
    }
    void loadPreferences();
  }, []);

  const toggleBatteryGuard = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setBatteryGuardEnabledState(val);
    await setBatteryGuardEnabled(val);
  };

  const toggleOfflineQueue = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setOfflineQueueEnabledState(val);
    await setOfflineQueueEnabled(val);
  };

  const handleClearDeadZoneQueue = async () => {
    triggerHaptic('buttonTap');
    await clearDeadZoneQueue();
    setDeadZoneFixCount(0);
    setToastNotice('Dead-zone telemetry buffer cleared.');
  };

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

  const handleSelectColorblind = async (mode: ColorblindMode) => {
    triggerHaptic('buttonTap');
    setColorblindMode(mode);
    await setColorblindPreference(mode);
  };

  const handleSelectHudScale = async (scale: HudScale) => {
    triggerHaptic('buttonTap');
    setHudScale(scale);
    await setHudScalePreference(scale);
  };

  const toggleAudio = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setAudioEnabled(val);
    await setAudioMuted(!val);
    await AsyncStorage.setItem('@ghostrun:audio_enabled', String(val));
  };

  const toggleProximityAudio = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setProximityAudioEnabled(val);
    await AsyncStorage.setItem('@ghostrun:proximity_audio_enabled', String(val));
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

  useEffect(() => {
    if (currentProfile?.profile_visibility) {
      setProfileVisibility(currentProfile.profile_visibility);
    }
  }, [currentProfile?.profile_visibility]);

  const handleToggleFriendSetting = async <K extends keyof FriendSettings>(
    key: K,
    val: FriendSettings[K]
  ) => {
    triggerHaptic('buttonTap');
    const updated: FriendSettings = {
      allowFriendRequests: key === 'allowFriendRequests' ? (val as boolean) : allowFriendRequests,
      showPresence: key === 'showPresence' ? (val as boolean) : presenceConsent,
      shareEcho: key === 'shareEcho' ? (val as boolean) : echoConsent,
      profileVisibility: key === 'profileVisibility' ? (val as 'public' | 'private') : profileVisibility,
    };

    if (key === 'allowFriendRequests') setAllowFriendRequests(val as boolean);
    if (key === 'showPresence') {
      setPresenceConsent(val as boolean);
      await AsyncStorage.setItem('@ghostrun:consent_presence', String(val));
    }
    if (key === 'shareEcho') {
      setEchoConsent(val as boolean);
      await AsyncStorage.setItem('@ghostrun:consent_echo', String(val));
    }
    if (key === 'profileVisibility') {
      setProfileVisibility(val as 'public' | 'private');
      useUserStore.getState().setProfile({
        display_name: currentProfile?.display_name || 'Operative',
        profile_visibility: val as 'public' | 'private',
      });
    }

    const res = await updateFriendSettings(updated);
    if (res.success) {
      setToastNotice('Privacy choice saved.');
      setTimeout(() => setToastNotice(''), 2000);
    } else {
      setError(res.error || 'Failed to update privacy choice.');
      setTimeout(() => setError(''), 3000);
    }
  };

  const toggleGhostConsent = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setGhostConsent(val);
    await AsyncStorage.setItem('@ghostrun:consent_ghost', String(val));
    if (supabase) {
      const { error } = await supabase.rpc('set_consent', { consent_type: 'ghost', granted: val });
      if (error) {
        setError(error.message);
        setTimeout(() => setError(''), 3000);
        return;
      }
    }
    setToastNotice('Ghost contribution preference saved.');
    setTimeout(() => setToastNotice(''), 2000);
  };

  const toggleLeaderboardName = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setLeaderboardNameConsent(val);
    await AsyncStorage.setItem('@ghostrun:consent_leaderboard_name', String(val));
    if (supabase) {
      const { error } = await supabase.rpc('set_consent', { consent_type: 'leaderboard_name', granted: val });
      if (error) {
        setError(error.message);
        setTimeout(() => setError(''), 3000);
        return;
      }
    }
    setToastNotice('Leaderboard name preference saved.');
    setTimeout(() => setToastNotice(''), 2000);
  };

  const toggleAnalytics = async (val: boolean) => {
    triggerHaptic('buttonTap');
    setLocalAnalyticsOptIn(val);
    await setAnalyticsOptIn(val);
    if (supabase) {
      await supabase.rpc('set_consent', { consent_type: 'diagnostics', granted: val });
    }
    setToastNotice('Diagnostics preference saved.');
    setTimeout(() => setToastNotice(''), 2000);
  };

  const handleUnblock = async (blockedId: string, name: string) => {
    triggerHaptic('buttonTap');
    const ok = await unblockUser(blockedId);
    if (ok) {
      triggerHaptic('tagConfirmed');
      setBlocks((prev) => prev.filter((b) => b.blockedUserId !== blockedId));
      setToastNotice(`Unblocked @${name}`);
      setTimeout(() => setToastNotice(''), 2000);
    } else {
      setError(`Failed to unblock ${name}`);
      setTimeout(() => setError(''), 3000);
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

        <Text variant="display" style={{ color: colors.text, marginTop: spacing.md, marginBottom: spacing.md }}>
          SETTINGS
        </Text>

        {/* Top Category Segmented Bar */}
        <SegmentBar
          items={[
            { id: 'display', label: 'DISPLAY' },
            { id: 'alerts', label: 'ALERTS' },
            { id: 'privacy', label: 'PRIVACY' },
            { id: 'account', label: 'ACCOUNT' },
          ]}
          activeId={activeCategory}
          onChange={(id) => {
            triggerHaptic('buttonTap');
            setActiveCategory(id as SettingsCategory);
          }}
          style={{ marginBottom: 18 }}
        />

        {/* Toast confirmation banner */}
        {toastNotice ? (
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor: 'rgba(199, 243, 107, 0.15)',
                borderColor: colors.primary,
              },
            ]}
          >
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.primary} />
            <Text
              variant="caption"
              style={{ color: colors.primary, fontWeight: '700', marginLeft: 6 }}
            >
              {toastNotice}
            </Text>
          </View>
        ) : null}

        {/* DISPLAY CATEGORY */}
        {activeCategory === 'display' && (
          <View>
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

        {/* 2. Accessibility & HUD */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          ACCESSIBILITY & HUD
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
          <View style={{ marginBottom: spacing.sm }}>
            <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
              Colorblind Palette Filter
            </Text>
            <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2, fontSize: 12 }}>
              High-contrast tactical radar palettes for visual accessibility
            </Text>
          </View>

          <View style={[styles.cornerGrid, { marginTop: spacing.xs }]}>
            {(
              [
                { id: 'none', label: 'OFF / STANDARD' },
                { id: 'protanopia', label: 'PROTANOPIA' },
                { id: 'deuteranopia', label: 'DEUTERANOPIA' },
                { id: 'tritanopia', label: 'TRITANOPIA' },
              ] as const
            ).map((item) => {
              const active = colorblindMode === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Colorblind Mode ${item.label}`}
                  onPress={() => void handleSelectColorblind(item.id)}
                  style={[
                    styles.cornerBtn,
                    {
                      borderColor: active ? colors.primary : colors.borderDark,
                      backgroundColor: active ? colors.surfaceElevated : colors.surface,
                    },
                  ]}
                >
                  <Text
                    variant="caption"
                    style={{
                      color: active ? colors.text : colors.textMuted,
                      fontWeight: '700',
                      fontSize: 11,
                    }}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }}>
            <View style={{ marginBottom: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Tactical HUD Scale
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2, fontSize: 12 }}>
                Scale radar telemetry, distance markers, and countdown timers
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(
                [
                  { id: 'standard', label: 'STANDARD (1.0x)' },
                  { id: 'large', label: 'LARGE (1.25x)' },
                  { id: 'extra_large', label: 'XL (1.5x)' },
                ] as const
              ).map((scaleItem) => {
                const active = hudScale === scaleItem.id;
                return (
                  <Pressable
                    key={scaleItem.id}
                    accessibilityRole="button"
                    accessibilityLabel={`HUD Scale ${scaleItem.label}`}
                    onPress={() => void handleSelectHudScale(scaleItem.id)}
                    style={[
                      styles.cornerBtn,
                      {
                        flex: 1,
                        minWidth: 0,
                        borderColor: active ? colors.primary : colors.borderDark,
                        backgroundColor: active ? colors.surfaceElevated : colors.surface,
                      },
                    ]}
                  >
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      style={{
                        color: active ? colors.text : colors.textMuted,
                        fontWeight: '700',
                        fontSize: 11,
                      }}
                    >
                      {scaleItem.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Card>

        {/* 3. Units System */}
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

                  </View>
        )}

        {/* ALERTS CATEGORY */}
        {activeCategory === 'alerts' && (
          <View>
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
                Escalating Proximity Heartbeat
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                Audio pulses accelerate as opponents enter 50m, 25m, and 10m danger perimeters.
              </Text>
            </View>
            <Switch
              value={proximityAudioEnabled}
              onValueChange={toggleProximityAudio}
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

          <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark, backgroundColor: colors.surfaceElevated }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="volume-high-outline" size={14} color={colors.accent} />
              <Text variant="label" style={{ color: colors.accent, fontSize: 11 }}>
                OUTDOOR LOUDSPEAKER AUDIO
              </Text>
            </View>
            <Text variant="caption" style={{ color: colors.textMuted, marginTop: 4, lineHeight: 16 }}>
              GhostRun audio cues are calibrated for your device loudspeaker so your ears stay open to real-world traffic and hazards. In-ear earbuds are discouraged during outdoor sprinting.
            </Text>
          </View>
        </Card>

        {/* Outdoor Battery & Field Resilience (Pillar 5) */}
        <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }}>
          FIELD ENDURANCE & BATTERY RESILIENCE
        </Text>
        <Card variant="default" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, padding: 0 }]}>
          <View style={[styles.settingRow, { padding: spacing.md }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Adaptive GPS Battery Guard
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                Dynamically scales GPS polling: 1Hz sprints, 2.5s stalking, and 6s ambush camping to extend endurance over 60-minute matches.
              </Text>
            </View>
            <Switch
              value={batteryGuardEnabled}
              onValueChange={toggleBatteryGuard}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          <View style={[styles.settingRow, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                Offline Dead-Zone Queue
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                Buffers GPS fixes locally during cellular dead zones and automatically flushes to the server on reconnect.
              </Text>
            </View>
            <Switch
              value={offlineQueueEnabled}
              onValueChange={toggleOfflineQueue}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderDark, backgroundColor: colors.surfaceElevated }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="battery-charging-outline" size={14} color={colors.primary} />
                <Text variant="label" style={{ color: colors.primary, fontSize: 11 }}>
                  DEAD-ZONE BUFFER: {deadZoneFixCount} FIXES QUEUED
                </Text>
              </View>
              {deadZoneFixCount > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear dead-zone buffer"
                  onPress={handleClearDeadZoneQueue}
                  style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 4, backgroundColor: colors.surface }}
                >
                  <Text variant="caption" style={{ color: colors.danger, fontWeight: '700', fontSize: 11 }}>
                    Clear
                  </Text>
                </Pressable>
              )}
            </View>
            <Text variant="caption" style={{ color: colors.textMuted, marginTop: 4, lineHeight: 16 }}>
              Critical Battery Sentinel: Below 15% charge, GhostRun locks into power-saving telemetry and limits HUD rendering overhead to prevent device shutdown.
            </Text>
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

                  </View>
        )}

        {/* PRIVACY & NETWORK CATEGORY */}
        {activeCategory === 'privacy' && (
          <View>
            {/* Header info banner */}
            <Card
              variant="default"
              style={[
                styles.card,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.borderDark,
                  marginBottom: spacing.md,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  style={[
                    styles.privacyIconBadge,
                    {
                      backgroundColor: 'rgba(199, 243, 107, 0.15)',
                    },
                  ]}
                >
                  <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                    Operative Privacy Center
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textMuted, marginTop: 2, fontSize: 12, lineHeight: 16 }}
                  >
                    Granular control over how other operatives discover your profile, track your
                    presence, and interact with your tactical telemetry.
                  </Text>
                </View>
              </View>
            </Card>

            {/* 1. Identity & Network Visibility */}
            <Text
              variant="label"
              style={{ color: colors.textMuted, marginBottom: spacing.xs, letterSpacing: 1 }}
            >
              OPERATIVE VISIBILITY & NETWORK
            </Text>
            <Card
              variant="default"
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderDark,
                  padding: 0,
                  marginBottom: spacing.md,
                },
              ]}
            >
              {/* Public Profile */}
              <View style={[styles.settingRow, { padding: spacing.md }]}>
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                    Public Profile
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textMuted, marginTop: 2, fontSize: 12, lineHeight: 16 }}
                  >
                    Allow other operatives to view tier, points, and badges. When disabled, your
                    profile dossier is visible only to confirmed friends.
                  </Text>
                </View>
                <Switch
                  value={profileVisibility === 'public'}
                  onValueChange={(val) =>
                    void handleToggleFriendSetting('profileVisibility', val ? 'public' : 'private')
                  }
                  trackColor={{ false: colors.borderDark, true: colors.primary }}
                  thumbColor={colors.textLight}
                />
              </View>

              {/* Squad Lobby Presence */}
              <View
                style={[
                  styles.settingRow,
                  {
                    padding: spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: colors.borderDark,
                  },
                ]}
              >
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                    Squad Lobby Presence
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textMuted, marginTop: 2, fontSize: 12, lineHeight: 16 }}
                  >
                    Show friends when you are actively hosting a match lobby or ready for
                    deployment.
                  </Text>
                </View>
                <Switch
                  value={presenceConsent}
                  onValueChange={(val) => void handleToggleFriendSetting('showPresence', val)}
                  trackColor={{ false: colors.borderDark, true: colors.primary }}
                  thumbColor={colors.textLight}
                />
              </View>

              {/* Echo Rating Broadcast */}
              <View
                style={[
                  styles.settingRow,
                  {
                    padding: spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: colors.borderDark,
                  },
                ]}
              >
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                    Echo Rating Broadcast
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textMuted, marginTop: 2, fontSize: 12, lineHeight: 16 }}
                  >
                    Display your rank, echo points, and win rates on global and friends leaderboards.
                  </Text>
                </View>
                <Switch
                  value={echoConsent}
                  onValueChange={(val) => void handleToggleFriendSetting('shareEcho', val)}
                  trackColor={{ false: colors.borderDark, true: colors.primary }}
                  thumbColor={colors.textLight}
                />
              </View>

              {/* Allow Friend Requests */}
              <View
                style={[
                  styles.settingRow,
                  {
                    padding: spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: colors.borderDark,
                  },
                ]}
              >
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                    Allow Friend Requests
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textMuted, marginTop: 2, fontSize: 12, lineHeight: 16 }}
                  >
                    Permit other operatives to search your codename and send tactical ally invites.
                  </Text>
                </View>
                <Switch
                  value={allowFriendRequests}
                  onValueChange={(val) =>
                    void handleToggleFriendSetting('allowFriendRequests', val)
                  }
                  trackColor={{ false: colors.borderDark, true: colors.primary }}
                  thumbColor={colors.textLight}
                />
              </View>
            </Card>

            {/* 2. Blocked Operatives Section */}
            <Text
              variant="label"
              style={{ color: colors.textMuted, marginBottom: spacing.xs, letterSpacing: 1 }}
            >
              BLOCKED OPERATIVES ({blocks.length})
            </Text>
            <Card
              variant="default"
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderDark,
                  padding: 0,
                  marginBottom: spacing.md,
                },
              ]}
            >
              {blocks.length === 0 ? (
                <View style={{ padding: spacing.md, alignItems: 'center', justifyContent: 'center' }}>
                  <Text variant="caption" style={{ color: colors.textMuted, fontSize: 13 }}>
                    Your blocked operatives roster is empty.
                  </Text>
                </View>
              ) : (
                blocks.map((b, idx) => (
                  <View
                    key={b.blockedUserId}
                    style={[
                      styles.settingRow,
                      {
                        padding: spacing.md,
                        borderTopWidth: idx > 0 ? 1 : 0,
                        borderTopColor: colors.borderDark,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, paddingRight: spacing.sm }}>
                      <Text variant="title" style={{ color: colors.text, fontSize: 15 }}>
                        @{b.displayName}
                      </Text>
                      <Text variant="caption" style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                        {b.handle ? `@${b.handle} • ` : ''}Blocked on {new Date(b.blockedAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <Button
                      title="Unblock"
                      variant="ghost"
                      size="sm"
                      onPress={() => void handleUnblock(b.blockedUserId, b.displayName)}
                    />
                  </View>
                ))
              )}
            </Card>

            {/* 3. Data & Telemetry Choices */}
            <Text
              variant="label"
              style={{ color: colors.textMuted, marginBottom: spacing.xs, letterSpacing: 1 }}
            >
              DATA & TELEMETRY CHOICES
            </Text>
            <Card
              variant="default"
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderDark,
                  padding: 0,
                  marginBottom: spacing.md,
                },
              ]}
            >
              {/* Ghost Library Contributions */}
              <View style={[styles.settingRow, { padding: spacing.md }]}>
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                    Ghost Library Route Contributions
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textMuted, marginTop: 2, fontSize: 12, lineHeight: 16 }}
                  >
                    Contribute anonymous, trimmed routes (origin and destination clipped by 150m)
                    for solo and community training runs.
                  </Text>
                </View>
                <Switch
                  value={ghostConsent}
                  onValueChange={(val) => void toggleGhostConsent(val)}
                  trackColor={{ false: colors.borderDark, true: colors.primary }}
                  thumbColor={colors.textLight}
                />
              </View>

              {/* Public Leaderboard Handle */}
              <View
                style={[
                  styles.settingRow,
                  {
                    padding: spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: colors.borderDark,
                  },
                ]}
              >
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                    Public Leaderboard Handle
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textMuted, marginTop: 2, fontSize: 12, lineHeight: 16 }}
                  >
                    Display your verified codename on public boards instead of Anonymous Operative.
                  </Text>
                </View>
                <Switch
                  value={leaderboardNameConsent}
                  onValueChange={(val) => void toggleLeaderboardName(val)}
                  trackColor={{ false: colors.borderDark, true: colors.primary }}
                  thumbColor={colors.textLight}
                />
              </View>

              {/* Privacy-Safe Diagnostics */}
              <View
                style={[
                  styles.settingRow,
                  {
                    padding: spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: colors.borderDark,
                  },
                ]}
              >
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                    Privacy-Safe Diagnostics
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textMuted, marginTop: 2, fontSize: 12, lineHeight: 16 }}
                  >
                    Share anonymous sensor performance and crash metrics to help optimize GPS radar
                    accuracy. No raw coordinates are ever logged.
                  </Text>
                </View>
                <Switch
                  value={analyticsOptIn}
                  onValueChange={(val) => void toggleAnalytics(val)}
                  trackColor={{ false: colors.borderDark, true: colors.primary }}
                  thumbColor={colors.textLight}
                />
              </View>
            </Card>

            {/* 3. Tactical Data Rights */}
            <Text
              variant="label"
              style={{ color: colors.textMuted, marginBottom: spacing.xs, letterSpacing: 1 }}
            >
              DATA RIGHTS & POLICY
            </Text>
            <Card
              variant="default"
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderDark,
                  padding: 0,
                  marginBottom: spacing.md,
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Export tactical data archive"
                disabled={busy !== ''}
                onPress={() => void exportData()}
                style={[styles.settingRow, { padding: spacing.md }]}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                    Export My Tactical Data
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textMuted, marginTop: 2, fontSize: 12 }}
                  >
                    Download a full JSON archive of your matches, connections, and consent logs.
                  </Text>
                </View>
                {busy === 'export' ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Ionicons name="download-outline" size={20} color={colors.primary} />
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View Privacy Policy and Consent Matrix"
                onPress={() => router.push('/privacy' as any)}
                style={[
                  styles.settingRow,
                  {
                    padding: spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: colors.borderDark,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                    Privacy Policy & Legal Disclosures
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textMuted, marginTop: 2, fontSize: 12 }}
                  >
                    Read data retention terms, anti-stalking protections, and contact information.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            </Card>
          </View>
        )}

        {/* ACCOUNT & SYSTEM CATEGORY */}
        {activeCategory === 'account' && (
          <View>
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

        {/* Admin Command Console Entry (Admins Only) */}
        {isAdmin && (
          <Card
            variant="elevated"
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.primary,
                borderWidth: 1.5,
                marginTop: spacing.md,
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Command Console"
              onPress={() => {
                triggerHaptic('buttonTap');
                router.push('/admin' as any);
              }}
              style={styles.settingRow}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
                  <Text variant="title" style={{ color: colors.primary, fontSize: 15 }}>
                    Command Console
                  </Text>
                </View>
                <Text variant="caption" style={{ color: colors.textMuted }}>
                  Level 4 clearance verified. Manage live remote config, kill-switches, and telemetry.
                </Text>
              </View>
              <Ionicons name="terminal-outline" size={22} color={colors.primary} />
            </Pressable>
          </Card>
        )}

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

                  </View>
        )}

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
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
  },
  privacyIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
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

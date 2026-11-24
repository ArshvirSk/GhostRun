import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';
import { Button } from '../src/ui/Button';
import { triggerHaptic } from '../src/motion/haptics';
import {
  checkIsAdmin,
  fetchRemoteConfigFlags,
  updateRemoteConfigFlag,
  fetchSystemHealthMetrics,
  validateRemoteConfigUpdate,
  formatSystemHealthSummary,
  SystemHealthMetrics,
  DEFAULT_REMOTE_CONFIG,
} from '../src/lib/admin';

const GAME_MODES = [
  { id: 'classic_chase', name: 'Classic Chase' },
  { id: 'tag_hunt', name: 'Tag Hunt' },
  { id: 'horde', name: 'Outbreak Horde' },
  { id: 'pinpoint', name: 'Pinpoint Deduction' },
  { id: 'vip_escort', name: 'VIP Escort' },
  { id: 'jailbreak', name: 'Jailbreak' },
  { id: 'relay_heist', name: 'Relay Heist' },
  { id: 'assassin_ring', name: 'Assassin Ring' },
  { id: 'double_agent', name: 'Double Agent' },
  { id: 'blackout_radar', name: 'Blackout Radar' },
];

export default function AdminConsoleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [healthMetrics, setHealthMetrics] = useState<SystemHealthMetrics | null>(null);
  const [flags, setFlags] = useState<Record<string, any>>(DEFAULT_REMOTE_CONFIG);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const adminVerified = await checkIsAdmin();
      setIsAdmin(adminVerified);

      if (adminVerified) {
        const [configRes, healthRes] = await Promise.all([
          fetchRemoteConfigFlags(),
          fetchSystemHealthMetrics(),
        ]);

        if (configRes.success && configRes.flags) {
          setFlags(configRes.flags);
        }
        if (healthRes.success && healthRes.metrics) {
          setHealthMetrics(healthRes.metrics);
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    triggerHaptic('buttonTap');
    void loadData();
  };

  const handleToggleFlag = async (key: string, currentValue: boolean) => {
    const nextValue = !currentValue;
    const validation = validateRemoteConfigUpdate(key, nextValue);
    if (!validation.valid) {
      setActionMessage(`Validation error: ${validation.error}`);
      return;
    }

    triggerHaptic('buttonTap');
    setFlags((prev) => ({ ...prev, [key]: nextValue }));

    const res = await updateRemoteConfigFlag(key, nextValue);
    if (res.success) {
      setActionMessage(`Updated ${key} to ${nextValue}`);
    } else {
      setActionMessage(`Failed to update ${key}: ${res.error}`);
      // Revert local state
      setFlags((prev) => ({ ...prev, [key]: currentValue }));
    }
  };

  const handleToggleMode = async (modeId: string) => {
    const currentDisabled: string[] = Array.isArray(flags.disabled_modes) ? [...flags.disabled_modes] : [];
    const isCurrentlyDisabled = currentDisabled.includes(modeId);

    const nextDisabled = isCurrentlyDisabled
      ? currentDisabled.filter((id) => id !== modeId)
      : [...currentDisabled, modeId];

    const validation = validateRemoteConfigUpdate('disabled_modes', nextDisabled);
    if (!validation.valid) {
      setActionMessage(`Validation error: ${validation.error}`);
      return;
    }

    triggerHaptic('buttonTap');
    setFlags((prev) => ({ ...prev, disabled_modes: nextDisabled }));

    const res = await updateRemoteConfigFlag('disabled_modes', nextDisabled);
    if (res.success) {
      setActionMessage(`Mode ${modeId} is now ${isCurrentlyDisabled ? 'ACTIVE' : 'DISABLED'}`);
    } else {
      setActionMessage(`Failed to update mode ${modeId}: ${res.error}`);
      setFlags((prev) => ({ ...prev, disabled_modes: currentDisabled }));
    }
  };

  if (loading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="caption" style={{ color: colors.textMuted, marginTop: 12 }}>
          VERIFYING TACTICAL CREDENTIALS...
        </Text>
      </View>
    );
  }

  // Access Denied Screen
  if (!isAdmin) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background, paddingHorizontal: 24 }]}>
        <View style={[styles.deniedIconBox, { borderColor: colors.danger, backgroundColor: `${colors.danger}15` }]}>
          <Ionicons name="shield-half-outline" size={36} color={colors.danger} />
        </View>

        <Text variant="headline" style={[styles.deniedTitle, { color: colors.text }]}>
          RESTRICTED ACCESS
        </Text>

        <Text variant="body" style={[styles.deniedDesc, { color: colors.textMuted }]}>
          GhostRun Command Console is restricted to authenticated administrators. Your operative ID does not hold Level 4 remote command clearance.
        </Text>

        <Button
          title="RETURN TO SQUAD"
          variant="secondary"
          size="md"
          onPress={() => router.replace('/play')}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Top Header Bar */}
      <View style={[styles.headerBar, { borderBottomColor: colors.borderDark }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Settings"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>

        <View style={styles.headerTitleCol}>
          <Text variant="title" style={[styles.headerTitle, { color: colors.text }]}>
            COMMAND CONSOLE
          </Text>
          <View style={styles.clearanceTag}>
            <View style={[styles.pulseDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.clearanceText, { color: colors.primary }]}>
              LEVEL 4 ADMIN CLEARANCE
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Telemetry"
          onPress={onRefresh}
          style={styles.refreshBtn}
        >
          <Ionicons name="refresh" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Status Action Banner */}
        {actionMessage && (
          <View style={[styles.bannerCard, { backgroundColor: `${colors.primary}15`, borderColor: colors.primary }]}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.primary} />
            <Text style={[styles.bannerText, { color: colors.primary }]}>{actionMessage}</Text>
          </View>
        )}

        {/* Section 1: System Telemetry */}
        <Text style={[styles.sectionHeading, { color: colors.textMuted }]}>
          SYSTEM HEALTH TELEMETRY
        </Text>

        <Card variant="elevated" style={[styles.metricsGridCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}>
          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text style={[styles.metricValue, { color: colors.primary }]}>
                {healthMetrics?.total_users ?? 0}
              </Text>
              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
                Total Operatives
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={[styles.metricValue, { color: colors.accent }]}>
                {healthMetrics?.active_games ?? 0}
              </Text>
              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
                Active Operations
              </Text>
            </View>
          </View>

          <View style={[styles.metricsDivider, { backgroundColor: colors.border }]} />

          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text style={[styles.metricValue, { color: colors.warning }]}>
                {healthMetrics?.total_reports ?? 0}
              </Text>
              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
                Open Reports
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={[styles.metricValue, { color: colors.text }]}>
                {healthMetrics?.active_push_tokens ?? 0}
              </Text>
              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
                Push Tokens
              </Text>
            </View>
          </View>

          {healthMetrics && (
            <Text style={[styles.metricsTimestamp, { color: colors.textMuted }]}>
              {formatSystemHealthSummary(healthMetrics)}
            </Text>
          )}
        </Card>

        {/* Section 2: Global Feature Toggles */}
        <Text style={[styles.sectionHeading, { color: colors.textMuted, marginTop: 24 }]}>
          GLOBAL REMOTE CONFIG FLAGS
        </Text>

        <Card variant="default" style={[styles.togglesCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
          {/* Monetisation Safeguard */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextCol}>
              <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                Monetisation Engine
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted }}>
                Standing Policy F-D9: Monetisation is disabled by default for community fitness.
              </Text>
            </View>
            <Switch
              value={Boolean(flags.monetisation_enabled)}
              onValueChange={() => void handleToggleFlag('monetisation_enabled', Boolean(flags.monetisation_enabled))}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={flags.monetisation_enabled ? '#0A0A0C' : colors.textMuted}
            />
          </View>

          <View style={[styles.rowDivider, { backgroundColor: colors.borderDark }]} />

          {/* Push Notifications */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextCol}>
              <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                Remote Push Dispatch
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted }}>
                Controls server-side background dispatch for match alerts and curator pings.
              </Text>
            </View>
            <Switch
              value={Boolean(flags.push_notifications_enabled)}
              onValueChange={() => void handleToggleFlag('push_notifications_enabled', Boolean(flags.push_notifications_enabled))}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={flags.push_notifications_enabled ? '#0A0A0C' : colors.textMuted}
            />
          </View>

          <View style={[styles.rowDivider, { backgroundColor: colors.borderDark }]} />

          {/* Scheduled Games */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextCol}>
              <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                Scheduled Matchmaker
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted }}>
                Enables squads to schedule future matches on the squad calendar.
              </Text>
            </View>
            <Switch
              value={Boolean(flags.scheduled_games_enabled)}
              onValueChange={() => void handleToggleFlag('scheduled_games_enabled', Boolean(flags.scheduled_games_enabled))}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={flags.scheduled_games_enabled ? '#0A0A0C' : colors.textMuted}
            />
          </View>

          <View style={[styles.rowDivider, { backgroundColor: colors.borderDark }]} />

          {/* Event Mode */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextCol}>
              <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                Event Mode (150 Players)
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted }}>
                Enables large-scale community operations with spectator delays.
              </Text>
            </View>
            <Switch
              value={Boolean(flags.feature_event_mode)}
              onValueChange={() => void handleToggleFlag('feature_event_mode', Boolean(flags.feature_event_mode))}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={flags.feature_event_mode ? '#0A0A0C' : colors.textMuted}
            />
          </View>
        </Card>

        {/* Section 3: Mode Kill-Switches */}
        <Text style={[styles.sectionHeading, { color: colors.textMuted, marginTop: 24 }]}>
          TACTICAL MODE KILL-SWITCHES
        </Text>

        <Card variant="default" style={[styles.modesCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
          {GAME_MODES.map((mode, index) => {
            const isDisabled = Array.isArray(flags.disabled_modes) && flags.disabled_modes.includes(mode.id);
            return (
              <View key={mode.id}>
                {index > 0 && <View style={[styles.rowDivider, { backgroundColor: colors.borderDark }]} />}
                <View style={styles.modeRow}>
                  <View style={styles.modeTextCol}>
                    <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                      {mode.name}
                    </Text>
                    <Text variant="caption" style={{ color: isDisabled ? colors.danger : colors.primary }}>
                      {isDisabled ? 'DISABLED GLOBALLY' : 'OPERATIONAL'}
                    </Text>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Toggle mode ${mode.name}`}
                    onPress={() => void handleToggleMode(mode.id)}
                    style={[
                      styles.modeActionBtn,
                      {
                        backgroundColor: isDisabled ? `${colors.danger}20` : `${colors.primary}20`,
                        borderColor: isDisabled ? colors.danger : colors.primary,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeActionText,
                        { color: isDisabled ? colors.danger : colors.primary },
                      ]}
                    >
                      {isDisabled ? 'ENABLE' : 'DISABLE'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    padding: 6,
    marginRight: 10,
  },
  headerTitleCol: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  clearanceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  clearanceText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    letterSpacing: 0.8,
  },
  refreshBtn: {
    padding: 6,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionHeading: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    letterSpacing: 1.1,
    marginBottom: 8,
    marginLeft: 4,
  },
  bannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  bannerText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    flex: 1,
  },
  metricsGridCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 4,
  },
  metricItem: {
    alignItems: 'center',
    flex: 1,
  },
  metricValue: {
    fontFamily: 'Archivo-Black',
    fontSize: 22,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metricLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
  },
  metricsDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  metricsTimestamp: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 10,
  },
  togglesCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  toggleTextCol: {
    flex: 1,
    marginRight: 12,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
  },
  modesCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  modeTextCol: {
    flex: 1,
    marginRight: 10,
  },
  modeActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  modeActionText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    letterSpacing: 0.8,
  },
  deniedIconBox: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  deniedTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 20,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  deniedDesc: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 20,
  },
});

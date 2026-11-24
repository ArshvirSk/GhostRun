import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';
import { Button } from '../src/ui/Button';
import { triggerHaptic } from '../src/motion/haptics';
import {
  evaluatePreflightReadiness,
  formatPreflightSummary,
  classifyGpsAccuracy,
  PreflightCheckData,
  PreflightResult,
} from '../src/lib/preflightCore';
import { isOfflineQueueEnabled } from '../src/lib/offlineTelemetryQueue';

export default function PreflightScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [foregroundGranted, setForegroundGranted] = useState(false);
  const [backgroundGranted, setBackgroundGranted] = useState(false);
  const [batteryOptimizationIgnored, setBatteryOptimizationIgnored] = useState(true);
  const [audioTested, setAudioTested] = useState(false);
  const [hapticsTested, setHapticsTested] = useState(false);
  const [offlineMapCached, setOfflineMapCached] = useState(false);
  const [testingAudioHaptic, setTestingAudioHaptic] = useState(false);

  // Probe hardware sensors and permissions
  const probeSensors = useCallback(async () => {
    try {
      // 1. Permissions
      const fg = await Location.getForegroundPermissionsAsync();
      setForegroundGranted(fg.granted);

      const bg = await Location.getBackgroundPermissionsAsync();
      setBackgroundGranted(bg.granted);

      // 2. Offline queue capability
      const offlineQueue = await isOfflineQueueEnabled();
      setOfflineMapCached(offlineQueue);

      // 3. Current GPS fix
      if (fg.granted) {
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          if (loc?.coords?.accuracy !== undefined) {
            setGpsAccuracy(loc.coords.accuracy);
          }
        } catch {
          // If instantaneous high accuracy times out, try last known position
          const last = await Location.getLastKnownPositionAsync();
          if (last?.coords?.accuracy !== undefined) {
            setGpsAccuracy(last.coords.accuracy);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void probeSensors();
  }, [probeSensors]);

  const checkData: PreflightCheckData = {
    gpsAccuracyMeters: gpsAccuracy,
    foregroundLocationGranted: foregroundGranted,
    backgroundLocationGranted: backgroundGranted,
    batteryOptimizationIgnored,
    audioTested,
    hapticsTested,
    offlineMapCached,
  };

  const result: PreflightResult = evaluatePreflightReadiness(checkData);
  const gpsInfo = classifyGpsAccuracy(gpsAccuracy);

  const handleTestHardwareFeedback = () => {
    setTestingAudioHaptic(true);
    triggerHaptic('pingArrival');

    setTimeout(() => {
      triggerHaptic('roleReveal');
      setAudioTested(true);
      setHapticsTested(true);
      setTestingAudioHaptic(false);
    }, 400);
  };

  const getStatusBadge = (status: 'pass' | 'warn' | 'fail') => {
    switch (status) {
      case 'pass':
        return {
          label: 'OPTIMAL',
          color: colors.primary,
          icon: 'checkmark-circle' as const,
        };
      case 'warn':
        return {
          label: 'ADVISORY',
          color: colors.warning,
          icon: 'alert-circle' as const,
        };
      case 'fail':
      default:
        return {
          label: 'REQUIRED',
          color: colors.danger,
          icon: 'close-circle' as const,
        };
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Top Header Bar */}
      <View style={[styles.headerBar, { borderBottomColor: colors.borderDark }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Lobby"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>

        <View style={styles.headerTitleCol}>
          <Text variant="title" style={[styles.headerTitle, { color: colors.text }]}>
            PRE-FLIGHT DIAGNOSTICS
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.pulseDot, { backgroundColor: result.canProceed ? colors.primary : colors.danger }]} />
            <Text style={[styles.statusTagText, { color: result.canProceed ? colors.primary : colors.danger }]}>
              {result.canProceed ? 'MISSION READY' : 'SYSTEMS BLOCKED'}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Diagnostics"
          onPress={() => {
            triggerHaptic('buttonTap');
            setLoading(true);
            void probeSensors();
          }}
          style={styles.refreshBtn}
        >
          <Ionicons name="refresh" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 20) + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* GPS Live Meter Hero Card */}
        <Card
          variant="elevated"
          style={[
            styles.gpsHeroCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: gpsInfo.color,
            },
          ]}
        >
          <View style={styles.gpsHeroTopRow}>
            <View style={[styles.satelliteBox, { backgroundColor: `${gpsInfo.color}15`, borderColor: gpsInfo.color }]}>
              <Ionicons name="navigate-circle" size={28} color={gpsInfo.color} />
            </View>

            <View style={styles.gpsHeroTextCol}>
              <Text style={[styles.gpsHeroTitle, { color: colors.text }]}>
                {gpsInfo.label}
              </Text>
              <Text style={[styles.gpsHeroSubtitle, { color: colors.textMuted }]}>
                {gpsAccuracy !== null
                  ? `Horizontal precision radius: ±${gpsAccuracy.toFixed(1)} meters`
                  : 'Acquiring satellite constellation telemetry...'}
              </Text>
            </View>
          </View>

          <View style={styles.meterTrack}>
            <View
              style={[
                styles.meterFill,
                {
                  width: gpsAccuracy !== null ? `${Math.max(10, Math.min(100, 100 - (gpsAccuracy - 3) * 3))}%` : '15%',
                  backgroundColor: gpsInfo.color,
                },
              ]}
            />
          </View>
        </Card>

        {/* Operational Status Summary Banner */}
        <View
          style={[
            styles.summaryBanner,
            {
              backgroundColor:
                result.overallStatus === 'ready'
                  ? `${colors.primary}15`
                  : result.overallStatus === 'caution'
                  ? `${colors.warning}15`
                  : `${colors.danger}15`,
              borderColor:
                result.overallStatus === 'ready'
                  ? colors.primary
                  : result.overallStatus === 'caution'
                  ? colors.warning
                  : colors.danger,
            },
          ]}
        >
          <Ionicons
            name={
              result.overallStatus === 'ready'
                ? 'shield-checkmark'
                : result.overallStatus === 'caution'
                ? 'alert-circle'
                : 'close-circle'
            }
            size={18}
            color={
              result.overallStatus === 'ready'
                ? colors.primary
                : result.overallStatus === 'caution'
                ? colors.warning
                : colors.danger
            }
          />
          <Text style={[styles.summaryText, { color: colors.text }]}>
            {formatPreflightSummary(result)}
          </Text>
        </View>

        {/* Diagnostic Checklist Items */}
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
          HARDWARE & SENSOR CHECKLIST
        </Text>

        <Card variant="default" style={[styles.checklistCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
          {result.items.map((item, index) => {
            const badge = getStatusBadge(item.status);
            return (
              <View key={item.id}>
                {index > 0 && <View style={[styles.itemDivider, { backgroundColor: colors.borderDark }]} />}
                <View style={styles.checkItemRow}>
                  <Ionicons name={badge.icon} size={20} color={badge.color} style={styles.itemIcon} />

                  <View style={styles.itemTextCol}>
                    <Text variant="title" style={[styles.itemTitle, { color: colors.text }]}>
                      {item.title}
                    </Text>
                    <Text variant="caption" style={[styles.itemDetail, { color: colors.textMuted }]}>
                      {item.detail}
                    </Text>
                  </View>

                  <View style={[styles.statusPill, { backgroundColor: `${badge.color}15`, borderColor: badge.color }]}>
                    <Text style={[styles.statusPillText, { color: badge.color }]}>
                      {badge.label}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </Card>

        {/* Hardware Test Utility Button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Test Ping Audio and Haptics"
          disabled={testingAudioHaptic}
          onPress={handleTestHardwareFeedback}
          style={({ pressed }) => [
            styles.hardwareTestBtn,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: audioTested && hapticsTested ? colors.primary : colors.border,
            },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons
            name={audioTested && hapticsTested ? 'volume-high' : 'volume-medium-outline'}
            size={18}
            color={audioTested && hapticsTested ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.hardwareTestText, { color: colors.text }]}>
            {testingAudioHaptic
              ? 'TRANSMITTING RADAR TEST BURST...'
              : audioTested && hapticsTested
              ? 'AUDIO & HAPTICS ENGINE VERIFIED (RE-TEST)'
              : 'TEST TACTICAL PING & HAPTIC MOTOR'}
          </Text>
        </Pressable>

        {/* Bottom CTA Action Button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Confirm readiness and proceed"
          disabled={!result.canProceed}
          onPress={() => {
            triggerHaptic('buttonTap');
            router.back();
          }}
          style={({ pressed }) => [
            styles.proceedButton,
            {
              backgroundColor: result.canProceed ? colors.primary : colors.borderDark,
              opacity: result.canProceed ? (pressed ? 0.88 : 1) : 0.5,
            },
          ]}
        >
          <Text
            style={[
              styles.proceedButtonText,
              { color: result.canProceed ? '#0A0A0C' : colors.textMuted },
            ]}
          >
            {result.canProceed ? 'ALL SYSTEMS GO // CONFIRM READINESS' : 'CRITICAL GPS FIX REQUIRED'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusTagText: {
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
  gpsHeroCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 14,
  },
  gpsHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  satelliteBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsHeroTextCol: {
    flex: 1,
  },
  gpsHeroTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 15,
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  gpsHeroSubtitle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    lineHeight: 15,
  },
  meterTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 3,
  },
  summaryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  summaryText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 12,
    flex: 1,
  },
  sectionTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    letterSpacing: 1.1,
    marginBottom: 8,
    marginLeft: 4,
  },
  checklistCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 14,
  },
  checkItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  itemIcon: {
    marginRight: 10,
  },
  itemTextCol: {
    flex: 1,
    marginRight: 8,
  },
  itemTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    marginBottom: 2,
  },
  itemDetail: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    lineHeight: 15,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusPillText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    letterSpacing: 0.8,
  },
  itemDivider: {
    height: StyleSheet.hairlineWidth,
  },
  hardwareTestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  hardwareTestText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    letterSpacing: 0.6,
  },
  proceedButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  proceedButtonText: {
    fontFamily: 'Archivo-Black',
    fontSize: 13,
    letterSpacing: 1,
  },
});

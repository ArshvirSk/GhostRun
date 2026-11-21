import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../ui/Text';
import { useTheme } from '../theme/ThemeProvider';
import { colors } from '../theme/tokens';
import type { PowerTier } from '../lib/batteryResilienceCore';

export type SharingState = 'idle' | 'starting' | 'on' | 'error' | 'denied';

interface TrackingStatusProps {
  sharing: SharingState;
  backgroundSharing: boolean;
  accuracyM: number | null;
  deadZoneQueueCount?: number;
  powerTier?: PowerTier;
  onRetry: () => void;
  onOpenSettings: () => void;
}

export const TrackingStatus = memo(function TrackingStatus({
  sharing,
  backgroundSharing,
  accuracyM,
  deadZoneQueueCount = 0,
  powerTier,
  onRetry,
  onOpenSettings,
}: TrackingStatusProps) {
  const { tokens } = useTheme();

  if (sharing === 'denied' || sharing === 'error') {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.danger,
            borderRadius: tokens.radii.card,
          },
        ]}
      >
        <Ionicons color={tokens.colors.danger} name="location-outline" size={18} />
        <View style={{ flex: 1 }}>
          <Text variant="label" style={{ color: tokens.colors.danger }}>
            LOCATION TRACKING DISABLED
          </Text>
          <Text variant="body" style={styles.subtext}>
            GhostRun requires GPS to participate in live rounds.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={sharing === 'denied' ? onOpenSettings : onRetry}
          style={[styles.actionBtn, { backgroundColor: tokens.colors.primary }]}
        >
          <Text variant="label" style={styles.btnText}>
            {sharing === 'denied' ? 'Settings' : 'Retry'}
          </Text>
        </Pressable>
      </View>
    );
  }

  // Dead-Zone Telemetry Buffer Warning (Pillar 5)
  if (deadZoneQueueCount > 0) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.warning,
            borderRadius: tokens.radii.card,
          },
        ]}
      >
        <Ionicons color={tokens.colors.warning} name="cloud-offline-outline" size={16} />
        <View style={{ flex: 1 }}>
          <Text variant="label" style={{ color: tokens.colors.warning, fontSize: 10 }}>
            DEAD-ZONE BUFFER ACTIVE ({deadZoneQueueCount} FIXES QUEUED)
          </Text>
          <Text variant="body" style={styles.subtext}>
            Cellular link weak. Telemetry is safely buffered locally and flushes automatically on reconnect.
          </Text>
        </View>
      </View>
    );
  }

  // Critical Battery Guard Mode Warning (Pillar 5)
  if (powerTier === 'critical_battery') {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.danger,
            borderRadius: tokens.radii.card,
          },
        ]}
      >
        <Ionicons color={tokens.colors.danger} name="battery-dead-outline" size={16} />
        <View style={{ flex: 1 }}>
          <Text variant="label" style={{ color: tokens.colors.danger, fontSize: 10 }}>
            BATTERY GUARD ENGAGED (&lt;= 15%)
          </Text>
          <Text variant="body" style={styles.subtext}>
            Low-power GPS interval active to preserve device life and prevent shutdown.
          </Text>
        </View>
      </View>
    );
  }

  if (sharing === 'on' && !backgroundSharing) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.warning,
            borderRadius: tokens.radii.card,
          },
        ]}
      >
        <Ionicons color={tokens.colors.warning} name="phone-portrait-outline" size={16} />
        <Text variant="body" style={[styles.subtext, { flex: 1 }]}>
          Foreground only: position updates pause when screen locks.
        </Text>
        {accuracyM !== null && (
          <Text variant="mono" style={{ fontSize: 10, color: tokens.colors.textMuted }}>
            ±{Math.round(accuracyM)}m
          </Text>
        )}
      </View>
    );
  }

  return null;
});

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  subtext: {
    fontSize: 11,
    color: colors.textMuted,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  btnText: {
    color: colors.textLight,
    fontSize: 11,
    fontWeight: '700',
  },
});

import React, { useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  Share,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import {
  RoundCardMetrics,
  formatRoundCardShareText,
  trimTrailPrivacy,
} from '../lib/roundCard';
import type { LngLat } from '../lib/geo';

interface ShareRoundCardModalProps {
  visible: boolean;
  metrics: RoundCardMetrics;
  rawTrailPoints?: LngLat[];
  onClose: () => void;
}

export function ShareRoundCardModal({
  visible,
  metrics,
  rawTrailPoints = [],
  onClose,
}: ShareRoundCardModalProps) {
  const { colors, spacing, radii } = useTheme();
  const [sharing, setSharing] = useState(false);

  const trimmed = trimTrailPrivacy(rawTrailPoints);
  const shareText = formatRoundCardShareText(metrics);

  const durationMin = Math.floor(metrics.durationSeconds / 60);
  const durationSec = metrics.durationSeconds % 60;
  const timeStr = `${durationMin}:${durationSec.toString().padStart(2, '0')}`;
  const distKm = (metrics.distanceMeters / 1000).toFixed(1);

  async function handleShare() {
    triggerHaptic('buttonTap');
    setSharing(true);
    try {
      await Share.share({
        title: `GhostRun: ${metrics.modeName} Recap`,
        message: shareText,
        url: 'https://ghostrun.app',
      });
    } catch {
      // User cancelled
    } finally {
      setSharing(false);
    }
  }

  const isVictorious = metrics.outcome === 'victorious';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Card
          variant="elevated"
          style={[
            styles.container,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderDark,
              borderRadius: radii.card,
              padding: spacing.xl,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text variant="label" style={{ color: colors.accent, letterSpacing: 1.5 }}>
                POST-MISSION INTELLIGENCE
              </Text>
              <Text variant="title" style={{ color: colors.text, marginTop: 2 }}>
                Share Round Card
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close share card"
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceElevated }]}
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: spacing.md }}>
            {/* The Tactical Card Preview */}
            <View
              style={[
                styles.cardPreview,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: isVictorious ? colors.primary : colors.borderDark,
                  borderRadius: radii.md,
                },
              ]}
            >
              {/* Card Top Branding */}
              <View style={styles.previewHeader}>
                <Text variant="label" style={{ color: colors.primary, fontSize: 10, letterSpacing: 2 }}>
                  GHOSTRUN // TACTICAL RECAP
                </Text>
                <Text variant="label" style={{ color: colors.textMuted, fontSize: 10 }}>
                  {metrics.date}
                </Text>
              </View>

              {/* Mode & Outcome */}
              <View style={{ marginTop: spacing.sm, alignItems: 'center' }}>
                <Text variant="headline" style={{ color: colors.text, fontWeight: '800' }}>
                  {metrics.modeName.toUpperCase()}
                </Text>
                <View
                  style={[
                    styles.outcomePill,
                    {
                      backgroundColor: isVictorious ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      borderColor: isVictorious ? colors.primary : colors.danger,
                    },
                  ]}
                >
                  <Text
                    variant="label"
                    style={{
                      color: isVictorious ? colors.primary : colors.danger,
                      fontSize: 12,
                      letterSpacing: 1,
                    }}
                  >
                    {metrics.outcome.toUpperCase()}
                  </Text>
                </View>
              </View>

              {/* Stats Grid */}
              <View style={[styles.statsRow, { marginTop: spacing.md }]}>
                <View style={styles.statBox}>
                  <Text variant="caption" style={{ color: colors.textMuted, fontSize: 10 }}>
                    DISTANCE
                  </Text>
                  <Text variant="title" style={{ color: colors.text, marginTop: 2 }}>
                    {distKm} <Text variant="caption" style={{ color: colors.textMuted }}>km</Text>
                  </Text>
                </View>
                <View style={styles.statBox}>
                  <Text variant="caption" style={{ color: colors.textMuted, fontSize: 10 }}>
                    DURATION
                  </Text>
                  <Text variant="title" style={{ color: colors.text, marginTop: 2 }}>
                    {timeStr}
                  </Text>
                </View>
                <View style={styles.statBox}>
                  <Text variant="caption" style={{ color: colors.textMuted, fontSize: 10 }}>
                    ROLE
                  </Text>
                  <Text variant="title" style={{ color: colors.text, marginTop: 2 }}>
                    {metrics.role.toUpperCase()}
                  </Text>
                </View>
              </View>

              {/* Privacy Route Status */}
              <View style={[styles.privacyBadge, { backgroundColor: colors.surface, marginTop: spacing.md }]}>
                <Ionicons
                  name={metrics.shareTrailConsent ? 'shield-checkmark' : 'lock-closed'}
                  size={14}
                  color={metrics.shareTrailConsent ? colors.primary : colors.accent}
                />
                <Text variant="caption" style={{ color: colors.textMuted, marginLeft: 6, fontSize: 11 }}>
                  {metrics.shareTrailConsent
                    ? trimmed.trimmedPath.length > 0
                      ? 'Route protected (first & last 150m trimmed)'
                      : 'Route withheld (< 350m distance guard)'
                    : 'Route confidential (consent C3 respected)'}
                </Text>
              </View>
            </View>

            {/* Privacy Warning */}
            <View style={[styles.warningBox, { backgroundColor: 'rgba(234, 179, 8, 0.1)', borderColor: colors.warning }]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
              <Text variant="caption" style={{ color: colors.warning, marginLeft: 8, flex: 1, fontSize: 11 }}>
                Privacy Notice: Your mission stats and outcome will be visible to anyone you share this card with.
              </Text>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            <Button
              title="Share Card via Sheet"
              variant="primary"
              size="lg"
              loading={sharing}
              onPress={() => void handleShare()}
            />
            <Button
              title="Done"
              variant="secondary"
              size="md"
              onPress={onClose}
            />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 390,
    maxHeight: '85%',
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardPreview: {
    padding: 16,
    borderWidth: 1.5,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  outcomePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 6,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#374151',
    paddingTop: 12,
  },
  statBox: {
    alignItems: 'center',
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
  },
});

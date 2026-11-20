import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import { useDialogModalAnimation } from '../motion';
import { SeasonRecapData, shareSeasonRecap } from '../lib/seasonRecap';
import { BADGE_CATALOG } from '../lib/badges';

interface SeasonRecapModalProps {
  visible: boolean;
  recap: SeasonRecapData | null;
  onClose: () => void;
}

export function SeasonRecapModal({ visible, recap, onClose }: SeasonRecapModalProps) {
  const { colors, spacing, radii } = useTheme();
  const { mounted, fadeAnim, scaleAnim, handleClose } = useDialogModalAnimation(visible, onClose);

  if (!recap) return null;

  async function handleShare() {
    if (!recap) return;
    triggerHaptic('buttonTap');
    await shareSeasonRecap(recap);
  }

  const distanceKm = (recap.totalDistanceMeters / 1000).toFixed(1);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0, 0, 0, 0.75)', opacity: fadeAnim },
          ]}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <Animated.View
          style={{
            width: '100%',
            maxWidth: 420,
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          }}
        >
          <View
            style={[
              styles.container,
              { backgroundColor: colors.surface, borderRadius: radii.card, borderColor: colors.borderLight },
            ]}
          >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.borderLight }]}>
              <View>
                <Text variant="caption" style={{ color: colors.primary, fontWeight: '700' }}>
                  TACTICAL DOSSIER // DEBRIEF
                </Text>
                <Text variant="title" style={styles.title}>
                  {recap.periodName}
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                hitSlop={8}
                style={[styles.closeBtn, { backgroundColor: colors.surfaceMuted }]}
              >
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </Pressable>
            </View>

          <ScrollView style={styles.scroll} contentContainerStyle={{ padding: spacing.md }}>
            {/* Rank Tier Banner */}
            <View
              style={[
                styles.tierBanner,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.primary },
              ]}
            >
              <Ionicons name="shield-checkmark" size={24} color={colors.primary} />
              <View style={{ marginLeft: spacing.sm }}>
                <Text variant="label" style={{ color: colors.textSecondary }}>
                  ASSIGNED OPERATIONAL TIER
                </Text>
                <Text variant="headline" style={{ color: colors.primary, fontWeight: '800' }}>
                  {recap.rankTier.toUpperCase()}
                </Text>
              </View>
            </View>

            {/* Grid of Key Metrics */}
            <View style={styles.grid}>
              <View
                style={[
                  styles.metricCard,
                  { backgroundColor: colors.surfaceMuted, borderRadius: radii.md },
                ]}
              >
                <Text variant="caption" style={{ color: colors.textSecondary }}>
                  OPERATIONS
                </Text>
                <Text variant="title" style={{ marginTop: 2 }}>
                  {recap.totalRounds}
                </Text>
              </View>

              <View
                style={[
                  styles.metricCard,
                  { backgroundColor: colors.surfaceMuted, borderRadius: radii.md },
                ]}
              >
                <Text variant="caption" style={{ color: colors.textSecondary }}>
                  WIN RATE
                </Text>
                <Text variant="title" style={{ color: colors.runner, marginTop: 2 }}>
                  {recap.winRatePercent}%
                </Text>
              </View>

              <View
                style={[
                  styles.metricCard,
                  { backgroundColor: colors.surfaceMuted, borderRadius: radii.md },
                ]}
              >
                <Text variant="caption" style={{ color: colors.textSecondary }}>
                  PATROL DISTANCE
                </Text>
                <Text variant="title" style={{ marginTop: 2 }}>
                  {distanceKm} km
                </Text>
              </View>

              <View
                style={[
                  styles.metricCard,
                  { backgroundColor: colors.surfaceMuted, borderRadius: radii.md },
                ]}
              >
                <Text variant="caption" style={{ color: colors.textSecondary }}>
                  TOP SPEED
                </Text>
                <Text variant="title" style={{ marginTop: 2 }}>
                  {recap.topSpeedKmh > 0 ? `${recap.topSpeedKmh} km/h` : '--'}
                </Text>
              </View>
            </View>

            {/* Tactical Breakdown */}
            <View
              style={[
                styles.detailsCard,
                { backgroundColor: colors.surfaceElevated, borderRadius: radii.md },
              ]}
            >
              <View style={styles.detailRow}>
                <Text variant="caption" style={{ color: colors.textSecondary }}>
                  Favorite Tactical Doctrine:
                </Text>
                <Text variant="sub" style={{ fontWeight: '700' }}>
                  {recap.favoriteModeName}
                </Text>
              </View>

              <View style={[styles.detailRow, { marginTop: spacing.xs }]}>
                <Text variant="caption" style={{ color: colors.textSecondary }}>
                  Victories:
                </Text>
                <Text variant="sub">
                  {recap.runnerWins} Runner / {recap.hunterWins} Hunter
                </Text>
              </View>
            </View>

            {/* Badges Commended */}
            {recap.badgesUnlocked.length > 0 && (
              <View style={{ marginTop: spacing.md }}>
                <Text variant="label" style={{ marginBottom: spacing.xs }}>
                  Badges Commended ({recap.badgesUnlocked.length})
                </Text>
                <View style={styles.badgesRow}>
                  {recap.badgesUnlocked.map((badgeId) => {
                    const meta = BADGE_CATALOG.find((b) => b.id === badgeId);
                    return (
                      <View
                        key={badgeId}
                        style={[
                          styles.badgePill,
                          {
                            backgroundColor: colors.surfaceMuted,
                            borderColor: colors.borderLight,
                          },
                        ]}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons name="star" size={12} color={colors.primary} />
                          <Text variant="caption" style={{ fontWeight: '700', color: colors.primary }}>
                            {meta ? meta.title : badgeId}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Action Buttons */}
            <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              <Button title="Share Tactical Dossier" onPress={handleShare} variant="primary" />
              <Button title="Dismiss" onPress={handleClose} variant="ghost" />
            </View>
          </ScrollView>
        </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  container: {
    width: '100%',
    maxHeight: '85%',
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontWeight: '800',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    maxHeight: 520,
  },
  tierBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  metricCard: {
    width: '48%',
    padding: 12,
  },
  detailsCard: {
    padding: 14,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badgePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
});

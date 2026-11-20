import React from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Text } from '../ui/Text';
import { useSheetModalAnimation } from '../motion';
import {
  READY_CHECK_STRINGS,
  type TrackingHealthReport,
} from '../lib/trackingHealth';

interface ReadyCheckModalProps {
  visible: boolean;
  report: TrackingHealthReport | null;
  isProbing: boolean;
  onRetest: () => void;
  onConfirmReady: () => void;
  onClose: () => void;
}

export function ReadyCheckModal({
  visible,
  report,
  isProbing,
  onRetest,
  onConfirmReady,
  onClose,
}: ReadyCheckModalProps) {
  const { colors, spacing, radii } = useTheme();
  const { mounted, fadeAnim, slideAnim, handleClose } = useSheetModalAnimation(visible, onClose);

  const overall = report?.overall ?? 'unknown';
  const isHealthy = overall === 'healthy';
  const isWarning = overall === 'warning';
  const isDegraded = overall === 'degraded';
  const canProceed = isHealthy || isWarning;

  const statusColor = isHealthy
    ? colors.primary
    : isWarning
      ? '#FFB800'
      : '#FF3B30';

  return (
    <Modal
      animationType="none"
      onRequestClose={handleClose}
      transparent
      visible={mounted}
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(5,7,9,0.85)', opacity: fadeAnim },
          ]}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <Animated.View style={[styles.sheetContainer, { transform: [{ translateY: slideAnim }] }]}>
          <Card
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.borderDark,
                borderRadius: radii.lg,
              },
            ]}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text
                  style={[styles.eyebrow, { color: colors.textSecondary }]}
                  variant="label"
                >
                  {READY_CHECK_STRINGS.sheetTitle}
                </Text>
                <View style={styles.titleRow}>
                  <Text style={{ color: colors.textPrimary }} variant="headline">
                    {report?.summary ?? 'DIAGNOSING SENSORS...'}
                  </Text>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: statusColor },
                    ]}
                  />
                </View>
                <Text
                  style={{ color: colors.textSubtle, marginTop: 2 }}
                  variant="caption"
                >
                  {READY_CHECK_STRINGS.sheetSubtitle}
                </Text>
              </View>

              <Pressable
                accessibilityLabel="Close check"
                onPress={handleClose}
                style={styles.closeButton}
              >
                <Ionicons color={colors.textSecondary} name="close" size={24} />
              </Pressable>
            </View>

            {/* Diagnostics List */}
            <ScrollView
              contentContainerStyle={{ paddingVertical: spacing.sm }}
              style={styles.scrollList}
            >
              {isProbing && (
                <View style={[styles.probingBanner, { borderColor: colors.primary }]}>
                  <ActivityIndicator color={colors.primary} size="small" />
                  <Text
                    style={{ color: colors.primary, marginLeft: spacing.sm }}
                    variant="label"
                  >
                    PROBING HIGH-PRECISION SATELLITE FIX...
                  </Text>
                </View>
              )}

              {report?.checks.map((check) => {
                const isPass = check.status === 'pass';
                const isWarn = check.status === 'warn';
                const iconColor = isPass
                  ? colors.primary
                  : isWarn
                    ? '#FFB800'
                    : '#FF3B30';
                const iconName = isPass
                  ? 'checkmark-circle'
                  : isWarn
                    ? 'alert-circle'
                    : 'close-circle';

                return (
                  <View
                    key={check.id}
                    style={[
                      styles.checkRow,
                      {
                        borderBottomColor: colors.borderDark,
                        paddingVertical: spacing.sm,
                      },
                    ]}
                  >
                    <Ionicons
                      color={iconColor}
                      name={iconName}
                      size={22}
                      style={styles.checkIcon}
                    />

                    <View style={styles.checkContent}>
                      <Text
                        style={{ color: colors.textPrimary, fontWeight: '700' }}
                        variant="body"
                      >
                        {check.label}
                      </Text>
                      <Text
                        style={{ color: colors.textSecondary }}
                        variant="caption"
                      >
                        {check.detail}
                      </Text>
                    </View>

                    {check.canFixWithSettings && (
                      <Pressable
                        accessibilityLabel={`Fix ${check.label} in settings`}
                        onPress={() => void Linking.openSettings()}
                        style={[
                          styles.fixButton,
                          {
                            borderColor: colors.borderDark,
                            borderRadius: radii.sm,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.fixText, { color: colors.primary }]}
                          variant="label"
                        >
                          SETTINGS
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}

              {/* Battery & Task Killer Reminder */}
              <View
                style={[
                  styles.batteryBox,
                  {
                    backgroundColor: colors.backgroundDark,
                    borderColor: colors.borderDark,
                    borderRadius: radii.md,
                    padding: spacing.md,
                    marginTop: spacing.md,
                  },
                ]}
              >
                <View style={styles.batteryHeader}>
                  <Ionicons color="#FFB800" name="shield-outline" size={18} />
                  <Text
                    style={[styles.batteryTitle, { color: '#FFB800' }]}
                    variant="label"
                  >
                    {READY_CHECK_STRINGS.batteryWarningTitle}
                  </Text>
                </View>
                <Text
                  style={{ color: colors.textSecondary, marginTop: 4 }}
                  variant="caption"
                >
                  {READY_CHECK_STRINGS.batteryWarningBody}
                </Text>
              </View>
            </ScrollView>

            {/* Actions */}
            <View
              style={[
                styles.actionRow,
                { borderTopColor: colors.borderDark, paddingTop: spacing.md },
              ]}
            >
              <Button
                disabled={isProbing}
                onPress={onRetest}
                style={{ flex: 1, marginRight: spacing.sm }}
                title={READY_CHECK_STRINGS.actionRetest}
                variant="secondary"
              />

              <Button
                disabled={!canProceed || isProbing}
                onPress={onConfirmReady}
                style={{ flex: 1.2 }}
                title={
                  isWarning
                    ? READY_CHECK_STRINGS.actionProceedAnyway
                    : isDegraded
                      ? READY_CHECK_STRINGS.statusDegraded
                      : READY_CHECK_STRINGS.actionReady
                }
                variant={isDegraded ? 'ghost' : isWarning ? 'secondary' : 'primary'}
              />
            </View>
          </Card>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    maxHeight: '85%',
    width: '100%',
  },
  card: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderWidth: 1,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 12,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 8,
  },
  closeButton: {
    padding: 4,
  },
  scrollList: {
    maxHeight: 380,
  },
  probingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    borderRadius: 6,
    marginBottom: 10,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkIcon: {
    marginRight: 12,
  },
  checkContent: {
    flex: 1,
  },
  fixButton: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  fixText: {
    fontSize: 10,
    letterSpacing: 0.5,
  },
  batteryBox: {
    borderWidth: 1,
  },
  batteryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  batteryTitle: {
    marginLeft: 6,
    letterSpacing: 1,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
  },
});

import React from 'react';
import {
  Modal,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Text } from '../ui/Text';

interface SafetyCheckinModalProps {
  visible: boolean;
  countdownSeconds: number;
  onConfirmOk: () => void;
  onTriggerSos: () => void;
}

export function SafetyCheckinModal({
  visible,
  countdownSeconds,
  onConfirmOk,
  onTriggerSos,
}: SafetyCheckinModalProps) {
  const { colors, spacing, radii } = useTheme();

  if (!visible) return null;

  const progressPercent = Math.max(0, Math.min(100, (countdownSeconds / 60) * 100));

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
    >
      <View style={[styles.backdrop, { backgroundColor: 'rgba(5,7,9,0.92)' }]}>
        <View style={styles.container}>
          <Card
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: '#FFB800',
                borderRadius: radii.lg,
                padding: spacing.xl,
              },
            ]}
          >
            <View style={styles.iconRow}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: 'rgba(255, 184, 0, 0.15)', borderColor: '#FFB800' },
                ]}
              >
                <Ionicons color="#FFB800" name="shield-checkmark" size={32} />
              </View>
            </View>

            <Text
              style={[styles.eyebrow, { color: '#FFB800', textAlign: 'center' }]}
              variant="label"
            >
              PERIODIC SAFETY CHECK-IN
            </Text>

            <Text
              style={[styles.title, { color: colors.textPrimary, textAlign: 'center' }]}
              variant="headline"
            >
              Are you OK?
            </Text>

            <Text
              style={[styles.subtitle, { color: colors.textSecondary, textAlign: 'center' }]}
              variant="body"
            >
              Acknowledge within {countdownSeconds}s to confirm you are safe. If unacknowledged, your teammates will be alerted with your last position.
            </Text>

            {/* Countdown Bar */}
            <View
              style={[
                styles.progressBarBg,
                { backgroundColor: colors.backgroundDark, borderRadius: radii.pill },
              ]}
            >
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${progressPercent}%`,
                    backgroundColor: countdownSeconds < 15 ? '#FF3B30' : '#FFB800',
                    borderRadius: radii.pill,
                  },
                ]}
              />
            </View>

            {/* Actions */}
            <View style={[styles.actionColumn, { gap: spacing.md, marginTop: spacing.xl }]}>
              <Button
                onPress={onConfirmOk}
                size="lg"
                title="I'M OK"
                variant="primary"
              />

              <Button
                onPress={onTriggerSos}
                size="md"
                title="EMERGENCY SOS"
                variant="danger"
              />
            </View>
          </Card>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    maxWidth: 400,
  },
  card: {
    borderWidth: 2,
  },
  iconRow: {
    alignItems: 'center',
    marginBottom: 12,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    letterSpacing: 2,
    marginBottom: 6,
  },
  title: {
    marginBottom: 8,
  },
  subtitle: {
    lineHeight: 20,
    marginBottom: 16,
  },
  progressBarBg: {
    height: 8,
    width: '100%',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
  },
  actionColumn: {
    width: '100%',
  },
});

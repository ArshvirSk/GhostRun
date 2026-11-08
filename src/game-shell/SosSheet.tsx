import React, { memo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../ui/Text';
import { useTheme } from '../theme/ThemeProvider';
import { colors } from '../theme/tokens';
import type { ShellActions } from './types';

interface SosSheetProps {
  visible: boolean;
  onClose: () => void;
  actions: ShellActions;
}

export const SosSheet = memo(function SosSheet({
  visible,
  onClose,
  actions,
}: SosSheetProps) {
  const { tokens } = useTheme();
  const [loading, setLoading] = useState(false);

  const handleSos = async () => {
    setLoading(true);
    await actions.sendSos();
    try {
      await Linking.openURL('tel:112');
    } catch {
      // Ignored if dialer is unavailable
    }
    setLoading(false);
    onClose();
  };

  const handlePauseOnly = async () => {
    setLoading(true);
    await actions.pauseGame('player_safety_pause');
    setLoading(false);
    onClose();
  };

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.danger,
              borderRadius: tokens.radii.card,
            },
          ]}
        >
          <View style={styles.header}>
            <MaterialCommunityIcons color={tokens.colors.danger} name="alert-octagon" size={32} />
            <Text variant="title" style={{ color: tokens.colors.danger }}>
              SAFETY & EMERGENCY OVERRIDE
            </Text>
          </View>

          <Text variant="body" style={styles.description}>
            GhostRun prioritizes real-world safety over gameplay. Activating emergency SOS will
            instantly pause the match, freeze all timers, broadcast your location to all players,
            and open your phone emergency dialer.
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={handleSos}
            style={[styles.sosButton, { backgroundColor: tokens.colors.danger }]}
          >
            {loading ? (
              <ActivityIndicator color={colors.textLight} />
            ) : (
              <>
                <Ionicons color={colors.textLight} name="call" size={20} />
                <Text variant="label" style={styles.buttonText}>
                  TRIGGER SOS & CALL 112 / 911
                </Text>
              </>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={handlePauseOnly}
            style={[styles.pauseButton, { borderColor: tokens.colors.warning }]}
          >
            <Ionicons color={tokens.colors.warning} name="pause" size={18} />
            <Text variant="label" style={{ color: tokens.colors.warning, fontWeight: '700' }}>
              Pause Game (Non-Emergency)
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={onClose}
            style={[styles.cancelButton, { backgroundColor: tokens.colors.surfaceAlt }]}
          >
            <Text variant="label" style={{ color: tokens.colors.textMuted }}>
              Dismiss
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    padding: 20,
    borderWidth: 2,
    gap: 16,
    shadowColor: colors.backgroundDark,
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  sosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 12,
  },
  pauseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  buttonText: {
    color: colors.textLight,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});

import React, { useEffect, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { motion } from '../theme/tokens';
import { Text } from './Text';
import { triggerHaptic } from '../motion/haptics';

export interface SheetProps {
  visible: boolean;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
}

export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  contentStyle,
}: SheetProps) {
  const { colors, radii, spacing } = useTheme();
  const [slideAnim] = useState(() => new Animated.Value(300));
  const [fadeAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: motion.transition,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 65,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: motion.feedback,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 300,
          duration: motion.transition,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, fadeAnim, slideAnim]);

  if (!visible) return null;

  const handleClose = () => {
    triggerHaptic('buttonTap');
    onClose();
  };

  return (
    <Modal
      animationType="none"
      onRequestClose={handleClose}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        {/* Backdrop */}
        <Animated.View
          style={[
            styles.backdrop,
            {
              backgroundColor: 'rgba(5, 7, 9, 0.75)',
              opacity: fadeAnim,
            },
          ]}
        >
          <Pressable
            accessibilityLabel="Close sheet"
            accessibilityRole="button"
            onPress={handleClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* Sheet Content */}
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: radii.card,
              borderTopRightRadius: radii.card,
              borderColor: colors.borderDark,
              transform: [{ translateY: slideAnim }],
            },
            contentStyle,
          ]}
        >
          {/* Grab Handle */}
          <View style={styles.handleWrapper}>
            <View
              style={[
                styles.handle,
                { backgroundColor: colors.borderDark, borderRadius: radii.full },
              ]}
            />
          </View>

          {/* Header */}
          {(title || subtitle) && (
            <View style={[styles.header, { borderBottomColor: colors.borderDark }]}>
              <View style={styles.headerTitles}>
                {title && (
                  <Text variant="title" style={{ color: colors.text }}>
                    {title}
                  </Text>
                )}
                {subtitle && (
                  <Text variant="caption" style={{ color: colors.textMuted }}>
                    {subtitle}
                  </Text>
                )}
              </View>
              <Pressable
                accessibilityLabel="Close"
                accessibilityRole="button"
                onPress={handleClose}
                style={[
                  styles.closeButton,
                  { backgroundColor: colors.surfaceElevated, borderRadius: radii.pill },
                ]}
              >
                <Ionicons color={colors.textMuted} name="close" size={18} />
              </Pressable>
            </View>
          )}

          {/* Body */}
          <View style={{ padding: spacing.base }}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheetContainer: {
    width: '100%',
    maxHeight: '85%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  handleWrapper: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  handle: {
    width: 36,
    height: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitles: {
    flex: 1,
    gap: 2,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import React, { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { colors as staticColors, motion } from '../theme/tokens';
import { Text } from './Text';

export type ToastType = 'info' | 'warning' | 'danger' | 'success';

export interface ToastProps {
  id?: string;
  type?: ToastType;
  title?: string;
  message?: string;
  durationMs?: number;
  onDismiss?: () => void;
}

export function Toast({
  type = 'info',
  title,
  message,
  durationMs = 4000,
  onDismiss,
}: ToastProps) {
  const { colors, radii } = useTheme();
  const [opacityAnim] = useState(() => new Animated.Value(0));
  const [slideAnim] = useState(() => new Animated.Value(-20));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: motion.transition,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: motion.transition,
        useNativeDriver: true,
      }),
    ]).start();

    if (durationMs > 0 && onDismiss) {
      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: motion.feedback,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: -20,
            duration: motion.feedback,
            useNativeDriver: true,
          }),
        ]).start(() => onDismiss());
      }, durationMs);

      return () => clearTimeout(timer);
    }
  }, [durationMs, onDismiss, opacityAnim, slideAnim]);

  const getThemeProps = () => {
    switch (type) {
      case 'success':
        return {
          bg: colors.surfaceElevated,
          border: colors.accent,
          icon: <Ionicons color={colors.accent} name="checkmark-circle" size={18} />,
          titleColor: colors.accent,
        };
      case 'warning':
        return {
          bg: colors.surfaceElevated,
          border: colors.warning,
          icon: <Ionicons color={colors.warning} name="warning" size={18} />,
          titleColor: colors.warning,
        };
      case 'danger':
        return {
          bg: colors.dangerSurface,
          border: colors.danger,
          icon: <MaterialCommunityIcons color={colors.danger} name="alert-octagon" size={18} />,
          titleColor: colors.danger,
        };
      case 'info':
      default:
        return {
          bg: colors.surfaceElevated,
          border: colors.radarScan,
          icon: <Ionicons color={colors.radarScan} name="information-circle" size={18} />,
          titleColor: colors.radarScan,
        };
    }
  };

  const themeProps = getThemeProps();

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: themeProps.bg,
          borderColor: themeProps.border,
          borderRadius: radii.md,
          opacity: opacityAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>{themeProps.icon}</View>
        <View style={styles.textContainer}>
          {title ? (
            <Text variant="label" style={{ color: themeProps.titleColor, fontWeight: '800' }}>
              {title}
            </Text>
          ) : null}
          {message ? (
            <Text variant="caption" style={{ color: colors.text, marginTop: title ? 2 : 0 }}>
              {message}
            </Text>
          ) : null}
        </View>
        {onDismiss && (
          <Pressable
            accessibilityLabel="Dismiss notification"
            accessibilityRole="button"
            onPress={onDismiss}
            style={styles.closeBtn}
          >
            <Ionicons color={colors.textMuted} name="close" size={16} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginVertical: 4,
    shadowColor: staticColors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  closeBtn: {
    padding: 4,
  },
});

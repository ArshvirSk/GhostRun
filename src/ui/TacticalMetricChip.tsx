import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { triggerHaptic } from '../motion/haptics';

export type MetricChipVariant =
  | 'default'
  | 'accent'
  | 'runner'
  | 'hunter'
  | 'warning'
  | 'muted'
  | 'success';

export type MetricChipSize = 'sm' | 'md' | 'lg';

export interface TacticalMetricChipProps {
  value: string | number;
  label?: string;
  icon?: keyof typeof Ionicons.glyphMap | React.ReactNode;
  variant?: MetricChipVariant;
  size?: MetricChipSize;
  selected?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

export function TacticalMetricChip({
  value,
  label,
  icon,
  variant = 'default',
  size = 'md',
  selected = false,
  onPress,
  style,
}: TacticalMetricChipProps) {
  const { colors, isDark } = useTheme();

  const handlePress = () => {
    if (!onPress) return;
    triggerHaptic('buttonTap');
    onPress();
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'runner':
        return {
          bg: isDark ? 'rgba(199, 243, 107, 0.12)' : 'rgba(85, 122, 34, 0.10)',
          border: colors.runner,
          text: colors.runner,
          iconCol: colors.runner,
        };
      case 'hunter':
        return {
          bg: isDark ? 'rgba(255, 138, 117, 0.12)' : 'rgba(185, 75, 58, 0.10)',
          border: colors.hunter,
          text: colors.hunter,
          iconCol: colors.hunter,
        };
      case 'warning':
        return {
          bg: isDark ? 'rgba(251, 191, 36, 0.12)' : 'rgba(217, 119, 6, 0.10)',
          border: colors.warning,
          text: colors.warning,
          iconCol: colors.warning,
        };
      case 'success':
        return {
          bg: isDark ? 'rgba(16, 185, 129, 0.12)' : 'rgba(5, 150, 105, 0.10)',
          border: colors.success,
          text: colors.success,
          iconCol: colors.success,
        };
      case 'accent':
        return {
          bg: isDark ? 'rgba(184, 163, 255, 0.14)' : 'rgba(102, 80, 164, 0.10)',
          border: colors.accent,
          text: colors.accent,
          iconCol: colors.accent,
        };
      case 'muted':
      default:
        if (selected) {
          return {
            bg: colors.primaryLight,
            border: colors.primary,
            text: colors.primary,
            iconCol: colors.primary,
          };
        }
        return {
          bg: isDark ? colors.surfaceElevated : colors.surface,
          border: isDark ? colors.border : 'rgba(0, 0, 0, 0.10)',
          text: colors.text,
          iconCol: colors.textMuted,
        };
    }
  };

  const { bg, border, text: textColor, iconCol } = getVariantStyles();

  const isSmall = size === 'sm';
  const isLarge = size === 'lg';

  const containerPadding = isSmall
    ? { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10 }
    : isLarge
    ? { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16 }
    : { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 };

  const content = (
    <View
      style={[
        styles.container,
        containerPadding,
        {
          backgroundColor: bg,
          borderColor: border,
        },
        selected && styles.selectedGlow,
        style,
      ]}
    >
      {icon && (
        <View style={styles.iconWrap}>
          {typeof icon === 'string' ? (
            <Ionicons
              name={icon as keyof typeof Ionicons.glyphMap}
              size={isSmall ? 12 : isLarge ? 16 : 14}
              color={iconCol}
            />
          ) : (
            icon
          )}
        </View>
      )}

      <View style={styles.textColumn}>
        <Text
          style={[
            styles.valueText,
            {
              color: textColor,
              fontSize: isSmall ? 11 : isLarge ? 15 : 13,
            },
          ]}
        >
          {value}
        </Text>
        {label && (
          <Text
            style={[
              styles.labelText,
              {
                color: colors.textMuted,
                fontSize: isSmall ? 8 : isLarge ? 10 : 9,
              },
            ]}
          >
            {label.toUpperCase()}
          </Text>
        )}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`${value} ${label || ''}`}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
  },
  iconWrap: {
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    justifyContent: 'center',
  },
  valueText: {
    fontFamily: 'Archivo-Bold',
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  labelText: {
    fontFamily: 'Archivo-SemiBold',
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 1,
  },
  selectedGlow: {
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.97 }],
  },
});

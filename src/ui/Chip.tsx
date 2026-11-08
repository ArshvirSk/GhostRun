import React from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { triggerHaptic } from '../motion/haptics';

export type ChipVariant = 'default' | 'accent' | 'hunter' | 'danger' | 'muted' | 'warning';
export type ChipSize = 'sm' | 'md';

export interface ChipProps {
  label: string;
  variant?: ChipVariant;
  size?: ChipSize;
  selected?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
}

export function Chip({
  label,
  variant = 'default',
  size = 'md',
  selected = false,
  disabled = false,
  icon,
  onPress,
  style,
}: ChipProps) {
  const { colors, radii, spacing } = useTheme();

  const handlePress = () => {
    if (disabled || !onPress) return;
    triggerHaptic('buttonTap');
    onPress();
  };

  const getColors = () => {
    if (disabled) {
      return {
        bg: colors.surfaceMuted,
        border: colors.borderDark,
        text: colors.textSubtle,
      };
    }

    if (selected) {
      switch (variant) {
        case 'hunter':
          return {
            bg: 'rgba(255, 92, 0, 0.18)',
            border: colors.hunter,
            text: colors.hunter,
          };
        case 'danger':
          return {
            bg: colors.dangerSurface,
            border: colors.danger,
            text: colors.danger,
          };
        case 'muted':
          return {
            bg: colors.surfaceElevated,
            border: colors.textMuted,
            text: colors.text,
          };
        case 'accent':
        case 'warning':
        return {
          bg: colors.surfaceElevated,
          border: colors.borderDark,
          text: colors.warning,
        };
      case 'default':
        default:
          return {
            bg: 'rgba(61, 255, 162, 0.15)',
            border: colors.accent,
            text: colors.accent,
          };
      }
    }

    switch (variant) {
      case 'hunter':
        return {
          bg: colors.surfaceElevated,
          border: colors.borderDark,
          text: colors.hunter,
        };
      case 'danger':
        return {
          bg: colors.surfaceElevated,
          border: colors.borderDark,
          text: colors.danger,
        };
      case 'muted':
        return {
          bg: colors.surface,
          border: colors.border,
          text: colors.textMuted,
        };
      case 'accent':
        return {
          bg: colors.surfaceElevated,
          border: colors.borderDark,
          text: colors.accent,
        };
      case 'warning':
        return {
          bg: colors.surfaceElevated,
          border: colors.borderDark,
          text: colors.warning,
        };
      case 'default':
      default:
        return {
          bg: colors.surfaceElevated,
          border: colors.borderDark,
          text: colors.text,
        };
    }
  };

  const chipColors = getColors();

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ selected, disabled }}
      disabled={disabled || !onPress}
      onPress={handlePress}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: size === 'sm' ? spacing.sm : spacing.md,
          paddingVertical: size === 'sm' ? 3 : 6,
          borderRadius: radii.pill,
          backgroundColor: chipColors.bg,
          borderWidth: 1,
          borderColor: chipColors.border,
          opacity: disabled ? 0.5 : 1,
          minHeight: size === 'sm' ? 24 : 32,
        },
        style,
      ]}
    >
      {icon && <View>{icon}</View>}
      <Text
        variant="label"
        style={{
          color: chipColors.text,
          fontWeight: selected ? '800' : '600',
          letterSpacing: 0.6,
          fontSize: 10,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

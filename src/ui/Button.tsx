import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { triggerHaptic } from '../motion/haptics';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'hunter';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  title?: string;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  style?: ViewStyle;
  children?: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  title,
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  disabled,
  onPress,
  style,
  children,
  ...rest
}: ButtonProps) {
  const { colors, radii, spacing } = useTheme();

  const handlePress = (e: any) => {
    if (disabled || loading) return;
    triggerHaptic('buttonTap');
    onPress?.(e);
  };

  const getContainerStyle = (pressed: boolean): ViewStyle => {
    let bg: string = colors.primary;
    let border: string | undefined;

    switch (variant) {
      case 'primary':
        bg = pressed ? colors.primaryHover : colors.primary;
        break;
      case 'hunter':
        bg = pressed ? '#E05200' : colors.hunter;
        break;
      case 'secondary':
        bg = pressed ? colors.surfaceMuted : colors.surfaceElevated;
        border = colors.borderDark;
        break;
      case 'danger':
        bg = pressed ? '#E03D2E' : colors.danger;
        break;
      case 'ghost':
        bg = pressed ? colors.primaryLight : 'transparent';
        border = pressed ? colors.borderAccent : colors.border;
        break;
    }

    let minHeight = 48; // Accessible touch target minimum
    let paddingHorizontal: number = spacing.base;
    let paddingVertical: number = spacing.sm;

    if (size === 'sm') {
      minHeight = 40;
      paddingHorizontal = spacing.md;
      paddingVertical = spacing.xs;
    } else if (size === 'lg') {
      minHeight = 56;
      paddingHorizontal = spacing.lg;
      paddingVertical = spacing.md;
    }

    return {
      minHeight,
      backgroundColor: bg,
      borderRadius: radii.button,
      paddingHorizontal,
      paddingVertical,
      borderWidth: border ? 1 : 0,
      borderColor: border,
      opacity: disabled ? 0.45 : 1,
      alignSelf: fullWidth ? 'stretch' : 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    };
  };

  const getTextColor = (): string => {
    switch (variant) {
      case 'primary':
        return colors.successText; // Dark tactical text on neon mint
      case 'hunter':
        return '#1F0B00'; // Dark text on amber
      case 'danger':
        return colors.dangerText;
      case 'ghost':
        return colors.text;
      case 'secondary':
      default:
        return colors.text;
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={handlePress}
      style={({ pressed }) => [getContainerStyle(pressed), style]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={getTextColor()} size="small" />
      ) : (
        <>
          {icon && iconPosition === 'left' && <View>{icon}</View>}
          {title ? (
            <Text
              variant="label"
              style={{
                color: getTextColor(),
                fontWeight: '800',
                letterSpacing: 0.8,
              }}
            >
              {title}
            </Text>
          ) : (
            children
          )}
          {icon && iconPosition === 'right' && <View>{icon}</View>}
        </>
      )}
    </Pressable>
  );
}

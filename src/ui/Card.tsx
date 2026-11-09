import React from 'react';
import { Pressable, StyleProp, View, ViewProps, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { triggerHaptic } from '../motion/haptics';

export type CardVariant = 'default' | 'elevated' | 'interactive' | 'accent' | 'danger';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends ViewProps {
  variant?: CardVariant;
  padding?: CardPadding;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function Card({
  variant = 'default',
  padding = 'md',
  onPress,
  style,
  children,
  ...rest
}: CardProps) {
  const { colors, radii, spacing } = useTheme();

  const getPadding = (): number => {
    switch (padding) {
      case 'none':
        return spacing.none;
      case 'sm':
        return spacing.sm;
      case 'lg':
        return spacing.lg;
      case 'md':
      default:
        return spacing.base;
    }
  };

  const getStyle = (pressed?: boolean): ViewStyle => {
    let bg: string = colors.surface;
    let borderColor: string = colors.border;

    switch (variant) {
      case 'elevated':
        bg = colors.surfaceElevated;
        borderColor = colors.borderDark;
        break;
      case 'accent':
        bg = colors.surface;
        borderColor = colors.borderAccent;
        break;
      case 'danger':
        bg = colors.dangerSurface;
        borderColor = colors.dangerBorder;
        break;
      case 'interactive':
        bg = pressed ? colors.surfaceElevated : colors.surface;
        borderColor = pressed ? colors.accent : colors.border;
        break;
      case 'default':
      default:
        bg = colors.surface;
        borderColor = colors.border;
        break;
    }

    return {
      backgroundColor: bg,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor,
      padding: getPadding(),
    };
  };

  if (onPress || variant === 'interactive') {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          triggerHaptic('buttonTap');
          onPress?.();
        }}
        style={({ pressed }) => [getStyle(pressed), style]}
        {...rest}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={[getStyle(), style]} {...rest}>
      {children}
    </View>
  );
}

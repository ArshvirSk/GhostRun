import React from 'react';
import {
  Platform,
  Text as RNText,
  TextProps as RNTextProps,
  TextStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type TextVariant = 'display' | 'title' | 'body' | 'label' | 'mono' | 'numeric';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold' | 'heavy' | 'black';
  align?: 'left' | 'center' | 'right';
  children: React.ReactNode;
}

export function Text({
  variant = 'body',
  color,
  weight,
  align,
  style,
  children,
  ...rest
}: TextProps) {
  const { colors, typography } = useTheme();

  const variantStyle: TextStyle = React.useMemo(() => {
    switch (variant) {
      case 'display':
        return {
          fontSize: typography.fontSizes.display,
          fontWeight: typography.fontWeights.black as TextStyle['fontWeight'],
          lineHeight: typography.lineHeights.display,
          color: colors.text,
        };
      case 'title':
        return {
          fontSize: typography.fontSizes.title,
          fontWeight: typography.fontWeights.bold as TextStyle['fontWeight'],
          lineHeight: typography.lineHeights.heading,
          color: colors.text,
        };
      case 'label':
        return {
          fontSize: typography.fontSizes.caption,
          fontWeight: typography.fontWeights.heavy as TextStyle['fontWeight'],
          letterSpacing: 1.1,
          textTransform: 'uppercase',
          color: colors.textMuted,
        };
      case 'mono':
        return {
          fontSize: typography.fontSizes.sub,
          fontWeight: typography.fontWeights.medium as TextStyle['fontWeight'],
          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
          color: colors.text,
        };
      case 'numeric':
        return {
          fontSize: typography.fontSizes.headline,
          fontWeight: typography.fontWeights.black as TextStyle['fontWeight'],
          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
          letterSpacing: 1.2,
          color: colors.text,
        };
      case 'body':
      default:
        return {
          fontSize: typography.fontSizes.body,
          fontWeight: typography.fontWeights.normal as TextStyle['fontWeight'],
          lineHeight: typography.lineHeights.body,
          color: colors.text,
        };
    }
  }, [variant, colors, typography]);

  const customStyle: TextStyle = {
    ...(color ? { color } : {}),
    ...(weight ? { fontWeight: typography.fontWeights[weight] as TextStyle['fontWeight'] } : {}),
    ...(align ? { textAlign: align } : {}),
  };

  return (
    <RNText style={[variantStyle, customStyle, style]} {...rest}>
      {children}
    </RNText>
  );
}

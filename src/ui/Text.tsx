import React from 'react';
import {
  Platform,
  Text as RNText,
  TextProps as RNTextProps,
  TextStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type TextVariant =
  | 'hero'
  | 'display'
  | 'headline'
  | 'title'
  | 'subtitle'
  | 'body'
  | 'sub'
  | 'caption'
  | 'label'
  | 'mono'
  | 'numeric';

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

  const getFontFamily = React.useCallback((): string => {
    if (variant === 'mono') {
      return Platform.OS === 'ios' ? 'Menlo' : 'monospace';
    }

    const isDisplay = [
      'hero',
      'display',
      'headline',
      'title',
      'label',
      'numeric',
    ].includes(variant);

    if (weight) {
      if (isDisplay) {
        if (weight === 'black' || weight === 'heavy') return 'Archivo-Black';
        if (weight === 'bold') return 'Archivo-Bold';
        if (weight === 'semibold' || weight === 'medium') return 'Archivo-SemiBold';
        return 'Archivo-Regular';
      }
      if (weight === 'black' || weight === 'heavy' || weight === 'bold') {
        return 'SegoeUI-Bold';
      }
      if (weight === 'semibold' || weight === 'medium') {
        return 'SegoeUI-SemiBold';
      }
      return 'SegoeUI-Regular';
    }

    switch (variant) {
      case 'hero':
      case 'display':
      case 'numeric':
        return 'Archivo-Black';
      case 'headline':
      case 'title':
        return 'Archivo-Bold';
      case 'label':
        return 'Archivo-SemiBold';
      case 'subtitle':
      case 'caption':
        return 'SegoeUI-SemiBold';
      case 'sub':
      case 'body':
      default:
        return 'SegoeUI-Regular';
    }
  }, [variant, weight]);

  const variantStyle: TextStyle = React.useMemo(() => {
    const fontFamily = getFontFamily();

    switch (variant) {
      case 'hero':
        return {
          fontFamily,
          fontSize: typography.fontSizes.hero,
          fontWeight: typography.fontWeights.black as TextStyle['fontWeight'],
          lineHeight: typography.lineHeights.hero,
          letterSpacing: -0.5,
          color: colors.text,
        };
      case 'display':
        return {
          fontFamily,
          fontSize: typography.fontSizes.display,
          fontWeight: typography.fontWeights.black as TextStyle['fontWeight'],
          lineHeight: typography.lineHeights.display,
          letterSpacing: -0.3,
          color: colors.text,
        };
      case 'headline':
        return {
          fontFamily,
          fontSize: typography.fontSizes.headline,
          fontWeight: typography.fontWeights.heavy as TextStyle['fontWeight'],
          lineHeight: typography.lineHeights.display,
          color: colors.text,
        };
      case 'title':
        return {
          fontFamily,
          fontSize: typography.fontSizes.title,
          fontWeight: typography.fontWeights.bold as TextStyle['fontWeight'],
          lineHeight: typography.lineHeights.heading,
          color: colors.text,
        };
      case 'subtitle':
        return {
          fontFamily,
          fontSize: typography.fontSizes.subtitle,
          fontWeight: typography.fontWeights.semibold as TextStyle['fontWeight'],
          lineHeight: typography.lineHeights.body,
          color: colors.text,
        };
      case 'caption':
        return {
          fontFamily,
          fontSize: typography.fontSizes.caption,
          fontWeight: typography.fontWeights.medium as TextStyle['fontWeight'],
          lineHeight: typography.lineHeights.tight,
          color: colors.textMuted,
        };
      case 'sub':
        return {
          fontFamily,
          fontSize: typography.fontSizes.sub,
          fontWeight: typography.fontWeights.normal as TextStyle['fontWeight'],
          lineHeight: typography.lineHeights.sub,
          color: colors.textMuted,
        };
      case 'label':
        return {
          fontFamily,
          fontSize: typography.fontSizes.caption,
          fontWeight: typography.fontWeights.heavy as TextStyle['fontWeight'],
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: colors.textMuted,
        };
      case 'mono':
        return {
          fontFamily,
          fontSize: typography.fontSizes.sub,
          fontWeight: typography.fontWeights.medium as TextStyle['fontWeight'],
          letterSpacing: 0.5,
          color: colors.text,
        };
      case 'numeric':
        return {
          fontFamily,
          fontSize: typography.fontSizes.headline,
          fontWeight: typography.fontWeights.black as TextStyle['fontWeight'],
          letterSpacing: 1.5,
          color: colors.text,
        };
      case 'body':
      default:
        return {
          fontFamily,
          fontSize: typography.fontSizes.body,
          fontWeight: typography.fontWeights.normal as TextStyle['fontWeight'],
          lineHeight: typography.lineHeights.body,
          color: colors.text,
        };
    }
  }, [variant, colors, typography, getFontFamily]);

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

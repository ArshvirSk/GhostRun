import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface TacticalDividerProps {
  label?: string;
  sublabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'solid' | 'dashed' | 'bracket' | 'minimal';
  color?: string;
  accentColor?: string;
  style?: ViewStyle;
}

export function TacticalDivider({
  label,
  sublabel,
  icon,
  variant = 'solid',
  color,
  accentColor,
  style,
}: TacticalDividerProps) {
  const { colors, isDark } = useTheme();

  const lineColor = color || (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.10)');
  const badgeAccent = accentColor || colors.primary;

  if (!label) {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.pip}>
          <Text style={[styles.pipText, { color: lineColor }]}>+</Text>
        </View>
        <View
          style={[
            styles.line,
            { backgroundColor: lineColor },
            variant === 'dashed' && styles.dashedLine,
          ]}
        />
        <View style={styles.pip}>
          <Text style={[styles.pipText, { color: lineColor }]}>+</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {/* Left Line */}
      <View
        style={[
          styles.line,
          { backgroundColor: lineColor },
          variant === 'dashed' && styles.dashedLine,
        ]}
      />

      {/* Center Tactical Badge */}
      <View
        style={[
          styles.badge,
          {
            backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
            borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)',
          },
        ]}
      >
        {variant === 'bracket' && (
          <Text style={[styles.bracketText, { color: badgeAccent }]}>⌜</Text>
        )}

        {icon && (
          <Ionicons
            name={icon}
            size={11}
            color={badgeAccent}
            style={{ marginRight: 5 }}
          />
        )}

        <Text style={[styles.labelText, { color: colors.text }]}>
          {label.toUpperCase()}
        </Text>

        {sublabel && (
          <>
            <Text style={[styles.separatorSlash, { color: lineColor }]}> //</Text>
            <Text style={[styles.sublabelText, { color: badgeAccent }]}>
              {sublabel.toUpperCase()}
            </Text>
          </>
        )}

        {variant === 'bracket' && (
          <Text style={[styles.bracketText, { color: badgeAccent, marginLeft: 2 }]}>⌟</Text>
        )}
      </View>

      {/* Right Line */}
      <View
        style={[
          styles.line,
          { backgroundColor: lineColor },
          variant === 'dashed' && styles.dashedLine,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    width: '100%',
  },
  line: {
    flex: 1,
    height: 1.5,
  },
  dashedLine: {
    borderStyle: 'dashed',
    borderWidth: 0.75,
    height: 0,
  },
  pip: {
    paddingHorizontal: 2,
  },
  pipText: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    marginHorizontal: 10,
  },
  bracketText: {
    fontFamily: 'Archivo-Black',
    fontSize: 11,
    lineHeight: 12,
    marginRight: 3,
  },
  labelText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  separatorSlash: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 9,
    marginHorizontal: 2,
  },
  sublabelText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.0,
    marginLeft: 3,
  },
});

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Pressable, ScrollView, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { triggerHaptic } from '../motion/haptics';

export interface TacticalRangeSelectorProps {
  radiusM: number;
  minRadiusM?: number;
  maxRadiusM?: number;
  stepM?: number;
  onChange: (radius: number) => void;
  style?: ViewStyle;
}

const DIAL_STEPS = [
  200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000,
];

const PRESETS = [300, 600, 1000, 1500, 2000];

const ITEM_WIDTH = 58;

export function TacticalRangeSelector({
  radiusM,
  minRadiusM = 200,
  maxRadiusM = 2000,
  stepM = 100,
  onChange,
  style,
}: TacticalRangeSelectorProps) {
  const { colors, isDark } = useTheme();
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);

  const accentBg = isDark ? 'rgba(184, 163, 255, 0.16)' : 'rgba(102, 80, 164, 0.12)';

  const clampedRadius = Math.max(minRadiusM, Math.min(maxRadiusM, radiusM));
  const diameterM = clampedRadius * 2;

  const formatDistance = (m: number) => {
    if (m >= 1000) {
      const km = m / 1000;
      return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)}km`;
    }
    return `${m}m`;
  };

  const handleDecrement = () => {
    if (clampedRadius <= minRadiusM) return;
    triggerHaptic('buttonTap');
    const next = Math.max(minRadiusM, clampedRadius - stepM);
    onChange(next);
  };

  const handleIncrement = () => {
    if (clampedRadius >= maxRadiusM) return;
    triggerHaptic('buttonTap');
    const next = Math.min(maxRadiusM, clampedRadius + stepM);
    onChange(next);
  };

  const handleSelectRadius = (r: number) => {
    if (r === clampedRadius) return;
    triggerHaptic('buttonTap');
    onChange(r);
  };

  // Auto-scroll dial so the active value is centered
  useEffect(() => {
    const idx = DIAL_STEPS.findIndex((s) => s === clampedRadius);
    if (idx !== -1 && scrollRef.current) {
      scrollRef.current.scrollTo({
        x: Math.max(0, idx * ITEM_WIDTH - 60),
        animated: true,
      });
    }
  }, [clampedRadius]);

  const canDecrement = clampedRadius > minRadiusM;
  const canIncrement = clampedRadius < maxRadiusM;

  return (
    <View style={[styles.container, style]}>
      {/* Readout Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.labelGroup}>
          <Ionicons name="scan-outline" size={13} color={colors.accent} />
          <Text
            variant="label"
            style={{
              color: colors.textMuted,
              fontSize: 10,
              letterSpacing: 0.8,
              fontWeight: '800',
            }}
          >
            ARENA ZONE RADIUS
          </Text>
        </View>

        <View style={styles.readoutGroup}>
          <Text
            style={[
              styles.readoutMain,
              { color: colors.accent },
            ]}
          >
            {formatDistance(clampedRadius)}
          </Text>
          <Text style={[styles.readoutDiameter, { color: colors.textMuted }]}>
            {`Ø ${formatDistance(diameterM)}`}
          </Text>
        </View>
      </View>

      {/* Stepper Controls & Center Dial Tape */}
      <View style={styles.stepperRow}>
        {/* Decrement Button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decrease zone radius"
          disabled={!canDecrement}
          onPress={handleDecrement}
          style={({ pressed }) => [
            styles.stepButton,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.border,
              opacity: canDecrement ? (pressed ? 0.75 : 1) : 0.35,
            },
          ]}
        >
          <Ionicons
            name="remove"
            size={16}
            color={canDecrement ? colors.text : colors.textMuted}
          />
        </Pressable>

        {/* Horizontal Dial Tape */}
        <View
          style={[
            styles.dialWindow,
            {
              backgroundColor: isDark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.04)',
              borderColor: colors.borderLight,
            },
          ]}
        >
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dialScrollContent}
          >
            {DIAL_STEPS.map((step) => {
              const isActive = step === clampedRadius;
              return (
                <Pressable
                  key={step}
                  onPress={() => handleSelectRadius(step)}
                  style={[
                    styles.dialItem,
                    isActive && [
                      styles.dialItemActive,
                      {
                        backgroundColor: accentBg,
                        borderColor: colors.accent,
                      },
                    ],
                  ]}
                >
                  <Text
                    style={[
                      styles.dialItemText,
                      {
                        color: isActive ? colors.accent : colors.textMuted,
                        fontWeight: isActive ? '900' : '600',
                        fontSize: isActive ? 13 : 11,
                      },
                    ]}
                  >
                    {formatDistance(step)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Increment Button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Increase zone radius"
          disabled={!canIncrement}
          onPress={handleIncrement}
          style={({ pressed }) => [
            styles.stepButton,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.border,
              opacity: canIncrement ? (pressed ? 0.75 : 1) : 0.35,
            },
          ]}
        >
          <Ionicons
            name="add"
            size={16}
            color={canIncrement ? colors.text : colors.textMuted}
          />
        </Pressable>
      </View>

      {/* Quick Jump Snap Chips */}
      <View style={styles.presetsRow}>
        {PRESETS.map((p) => {
          const isSelected = clampedRadius === p;
          const label = p === 2000 ? '2.0KM MAX' : formatDistance(p).toUpperCase();
          return (
            <Pressable
              key={p}
              accessibilityRole="button"
              onPress={() => handleSelectRadius(p)}
              style={[
                styles.presetChip,
                {
                  backgroundColor: isSelected
                    ? accentBg
                    : isDark
                    ? colors.surfaceElevated
                    : colors.surface,
                  borderColor: isSelected ? colors.accent : colors.border,
                },
              ]}
            >
              <Text
                style={{
                  fontFamily: 'Archivo-Bold',
                  fontSize: 10,
                  fontWeight: '800',
                  color: isSelected ? colors.accent : colors.textMuted,
                  letterSpacing: 0.3,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  labelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  readoutGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  readoutMain: {
    fontFamily: 'Archivo-Black',
    fontSize: 15,
    fontWeight: '900',
  },
  readoutDiameter: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '700',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialWindow: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  dialScrollContent: {
    alignItems: 'center',
    paddingHorizontal: 6,
    gap: 4,
  },
  dialItem: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialItemActive: {
    borderWidth: 1,
  },
  dialItemText: {
    fontFamily: 'Archivo-Bold',
  },
  presetsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
    marginTop: 6,
  },
  presetChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
});

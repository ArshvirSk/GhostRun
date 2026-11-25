import React from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ParamDef } from '../modes/types';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface ParamFieldProps {
  param: ParamDef;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}

export function ParamField({ param, value, onChange, disabled = false }: ParamFieldProps) {
  const { colors, spacing, radii } = useTheme();

  const currentValue = value !== undefined ? value : param.defaultValue;

  const handleTextChange = (text: string) => {
    if (param.type === 'number') {
      const parsed = parseInt(text, 10);
      onChange(param.key, isNaN(parsed) ? 0 : parsed);
    } else {
      onChange(param.key, text);
    }
  };

  const stepNumber = (delta: number) => {
    const cur = typeof currentValue === 'number' ? currentValue : Number(currentValue) || 0;
    const step = param.step || 1;
    let next = cur + delta * step;
    if (param.min !== undefined && next < param.min) next = param.min;
    if (param.max !== undefined && next > param.max) next = param.max;
    onChange(param.key, next);
  };

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: colors.borderLight,
          paddingVertical: spacing.md,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.labelCol}>
          <Text style={styles.label} variant="body" weight="bold">
            {param.label}
          </Text>
          {param.description && (
            <Text color={colors.textMuted} style={styles.desc} variant="body">
              {param.description}
            </Text>
          )}
        </View>

        {/* Control based on ParamType */}
        {param.type === 'boolean' && (
          <Switch
            disabled={disabled}
            onValueChange={(val) => onChange(param.key, val)}
            thumbColor={Boolean(currentValue) ? colors.primary : colors.textMuted}
            trackColor={{ false: colors.border, true: colors.primaryLight }}
            value={Boolean(currentValue)}
          />
        )}
      </View>

      {/* Number Stepper Field */}
      {param.type === 'number' && (
        <View style={styles.stepperRow}>
          <Pressable
            accessibilityLabel={`Decrease ${param.label}`}
            accessibilityRole="button"
            disabled={disabled || (param.min !== undefined && Number(currentValue) <= param.min)}
            onPress={() => stepNumber(-1)}
            style={[
              styles.stepBtn,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
                borderRadius: radii.sm,
              },
            ]}
          >
            <Text variant="body" weight="bold">
              −
            </Text>
          </Pressable>

          <View
            style={[
              styles.numberInputBox,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.sm,
              },
            ]}
          >
            <TextInput
              editable={!disabled}
              keyboardType="number-pad"
              onChangeText={handleTextChange}
              style={[styles.input, { color: colors.text }]}
              value={String(currentValue)}
            />
            {param.unit && (
              <Text color={colors.textMuted} style={styles.unitText} variant="label">
                {param.unit}
              </Text>
            )}
          </View>

          <Pressable
            accessibilityLabel={`Increase ${param.label}`}
            accessibilityRole="button"
            disabled={disabled || (param.max !== undefined && Number(currentValue) >= param.max)}
            onPress={() => stepNumber(1)}
            style={[
              styles.stepBtn,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
                borderRadius: radii.sm,
              },
            ]}
          >
            <Text variant="body" weight="bold">
              +
            </Text>
          </Pressable>
        </View>
      )}

      {/* Slider / Stepped Tactical Bar Field */}
      {param.type === 'slider' && (() => {
        const min = param.min ?? 0;
        const max = param.max ?? 100;
        const step = param.step ?? 1;
        const numVal = typeof currentValue === 'number' ? currentValue : Number(currentValue) || min;
        const clamped = Math.min(max, Math.max(min, numVal));
        const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0;

        const tickCount = Math.round((max - min) / step) + 1;
        const quickTicks =
          tickCount <= 6
            ? Array.from({ length: tickCount }, (_, i) => min + i * step)
            : [min, Math.round((min + max) / 2 / step) * step, max];

        return (
          <View style={styles.sliderWrap}>
            <View style={styles.sliderTopRow}>
              <Pressable
                accessibilityLabel={`Decrease ${param.label}`}
                accessibilityRole="button"
                disabled={disabled || clamped <= min}
                onPress={() => stepNumber(-1)}
                style={[
                  styles.sliderStepBtn,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radii.sm,
                    opacity: disabled || clamped <= min ? 0.45 : 1,
                  },
                ]}
              >
                <Ionicons name="remove" size={16} color={colors.text} />
              </Pressable>

              <View style={styles.sliderTrackCol}>
                <View style={styles.sliderValueRow}>
                  <Text variant="mono" style={{ color: colors.accent, fontSize: 16, fontWeight: '800' }}>
                    {clamped}
                    {param.unit ? ` ${param.unit}` : ''}
                  </Text>
                </View>
                <View style={[styles.sliderTrackBg, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
                  <View
                    style={[
                      styles.sliderTrackFill,
                      { width: `${pct}%`, backgroundColor: colors.accent },
                    ]}
                  />
                </View>
                <View style={styles.sliderTicksRow}>
                  {quickTicks.map((tick) => {
                    const activeTick = clamped === tick;
                    return (
                      <Pressable
                        key={tick}
                        disabled={disabled}
                        onPress={() => onChange(param.key, tick)}
                        style={[
                          styles.sliderTickChip,
                          {
                            backgroundColor: activeTick ? `${colors.accent}22` : 'transparent',
                            borderColor: activeTick ? colors.accent : colors.border,
                          },
                        ]}
                      >
                        <Text
                          variant="mono"
                          style={{
                            fontSize: 11,
                            color: activeTick ? colors.accent : colors.textMuted,
                            fontWeight: activeTick ? '700' : '500',
                          }}
                        >
                          {tick}
                          {param.unit || ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Pressable
                accessibilityLabel={`Increase ${param.label}`}
                accessibilityRole="button"
                disabled={disabled || clamped >= max}
                onPress={() => stepNumber(1)}
                style={[
                  styles.sliderStepBtn,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radii.sm,
                    opacity: disabled || clamped >= max ? 0.45 : 1,
                  },
                ]}
              >
                <Ionicons name="add" size={16} color={colors.text} />
              </Pressable>
            </View>
          </View>
        );
      })()}

      {/* Enum Options Selector (Cards for descriptive options, Pills for compact) */}
      {param.type === 'enum' && param.options && (() => {
        const useRichCards = param.options.some((o) => o.label.length > 22 || o.label.includes('('));
        if (!useRichCards) {
          return (
            <View style={styles.enumPills}>
              {param.options.map((opt) => {
                const isSelected = currentValue === opt.value;
                return (
                  <Pressable
                    key={String(opt.value)}
                    accessibilityRole="button"
                    disabled={disabled}
                    onPress={() => onChange(param.key, opt.value)}
                    style={[
                      styles.pill,
                      {
                        backgroundColor: isSelected ? colors.primary : colors.surfaceMuted,
                        borderColor: isSelected ? colors.primaryHover : colors.border,
                        borderRadius: radii.pill,
                      },
                    ]}
                  >
                    <Text
                      color={isSelected ? colors.backgroundDark : colors.text}
                      variant="label"
                      weight={isSelected ? 'bold' : 'normal'}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        }

        return (
          <View style={styles.enumCardsCol}>
            {param.options.map((opt) => {
              const isSelected = currentValue === opt.value;
              const match = opt.label.match(/^(.*?)\s*\((.+)\)\s*$/);
              const titleText = match ? match[1].trim() : opt.label;
              const subtitleText = match ? match[2].trim() : null;

              return (
                <Pressable
                  key={String(opt.value)}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                  disabled={disabled}
                  onPress={() => onChange(param.key, opt.value)}
                  style={[
                    styles.enumCard,
                    {
                      backgroundColor: isSelected ? `${colors.accent}18` : colors.surfaceMuted,
                      borderColor: isSelected ? colors.accent : colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.enumRadio,
                      {
                        borderColor: isSelected ? colors.accent : colors.textMuted,
                        backgroundColor: isSelected ? colors.accent : 'transparent',
                      },
                    ]}
                  >
                    {isSelected && <Ionicons name="checkmark" size={12} color={colors.backgroundDark} />}
                  </View>
                  <View style={styles.enumCardTextCol}>
                    <Text
                      variant="body"
                      weight="bold"
                      style={{ fontSize: 13, color: isSelected ? colors.accent : colors.text }}
                    >
                      {titleText}
                    </Text>
                    {subtitleText && (
                      <Text
                        variant="body"
                        style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}
                      >
                        {subtitleText}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  labelCol: {
    flex: 1,
    paddingRight: 10,
  },
  label: {
    fontSize: 15,
  },
  desc: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  stepperRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  stepBtn: {
    alignItems: 'center',
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 44,
  },
  numberInputBox: {
    alignItems: 'center',
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    height: 40,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    padding: 0,
  },
  unitText: {
    fontSize: 12,
  },
  enumPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  pill: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  sliderWrap: {
    marginTop: 10,
  },
  sliderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sliderStepBtn: {
    width: 38,
    height: 38,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderTrackCol: {
    flex: 1,
    gap: 6,
  },
  sliderValueRow: {
    alignItems: 'center',
  },
  sliderTrackBg: {
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sliderTrackFill: {
    height: '100%',
    borderRadius: 4,
  },
  sliderTicksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  sliderTickChip: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  enumCardsCol: {
    gap: 8,
    marginTop: 10,
  },
  enumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  enumRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enumCardTextCol: {
    flex: 1,
  },
});

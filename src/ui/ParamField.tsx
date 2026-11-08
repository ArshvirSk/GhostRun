import React from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
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

      {/* Enum Options Pill Selector */}
      {param.type === 'enum' && param.options && (
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
      )}
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
});

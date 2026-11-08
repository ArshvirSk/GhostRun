import React, { useRef, useState } from 'react';
import {
  Animated,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { triggerHaptic } from '../motion/haptics';

export interface CodeBoxesProps {
  length?: number;
  value?: string;
  onChangeCode?: (code: string) => void;
  onChange?: (code: string) => void;
  onComplete?: (code: string) => void;
  error?: boolean;
  hasError?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function CodeBoxes({
  length = 4,
  value = '',
  onChangeCode,
  onChange,
  onComplete,
  error = false,
  hasError = false,
  disabled = false,
  style,
}: CodeBoxesProps) {
  const { colors, radii } = useTheme();
  const inputRefs = useRef<any[]>([]);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [shakeAnim] = useState(() => new Animated.Value(0));

  const isError = error || hasError;

  const handleUpdate = (newVal: string) => {
    onChangeCode?.(newVal);
    onChange?.(newVal);
  };

  // Split string into characters
  const chars = value.split('').slice(0, length);
  while (chars.length < length) {
    chars.push('');
  }

  React.useEffect(() => {
    if (isError) {
      triggerHaptic('error');
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
    }
  }, [isError, shakeAnim]);

  const handleChangeText = (text: string, index: number) => {
    if (disabled) return;

    // Handle multi-character paste
    const clean = text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (clean.length > 1) {
      const newChars = clean.slice(0, length);
      handleUpdate(newChars);
      triggerHaptic('buttonTap');
      if (newChars.length === length) {
        onComplete?.(newChars);
        inputRefs.current[length - 1]?.focus();
      } else {
        inputRefs.current[newChars.length]?.focus();
      }
      return;
    }

    const updated = [...chars];
    updated[index] = clean;
    const finalStr = updated.join('');
    handleUpdate(finalStr);

    if (clean) {
      triggerHaptic('buttonTap');
      if (index < length - 1) {
        inputRefs.current[index + 1]?.focus();
      } else {
        inputRefs.current[index]?.blur();
        if (finalStr.length === length) {
          onComplete?.(finalStr);
        }
      }
    }
  };

  const handleKeyPress = (
    e: NativeSyntheticEvent<{ key: string }>,
    index: number
  ) => {
    if (e.nativeEvent.key === 'Backspace') {
      if (!chars[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
        const updated = [...chars];
        updated[index - 1] = '';
        handleUpdate(updated.join(''));
      }
    }
  };

  return (
    <Animated.View
      style={[
        styles.row,
        { transform: [{ translateX: shakeAnim }] },
        style,
      ]}
    >
      {Array.from({ length }).map((_, index) => {
        const isFocused = focusedIndex === index;
        const char = chars[index] || '';

        let borderColor: string = colors.borderDark;
        if (isError) {
          borderColor = colors.danger;
        } else if (isFocused) {
          borderColor = colors.accent;
        } else if (char) {
          borderColor = colors.border;
        }

        return (
          <Pressable
            key={index}
            onPress={() => inputRefs.current[index]?.focus()}
            style={[
              styles.box,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor,
                borderRadius: radii.md,
              },
            ]}
          >
            <TextInput
              ref={(ref) => {
                inputRefs.current[index] = ref;
              }}
              accessibilityLabel={`Room code digit ${index + 1}`}
              autoCapitalize="characters"
              autoCorrect={false}
              cursorColor={colors.accent}
              editable={!disabled}
              keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'visible-password'}
              maxLength={1}
              onBlur={() => setFocusedIndex(-1)}
              onChangeText={(txt) => handleChangeText(txt, index)}
              onFocus={() => setFocusedIndex(index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              selectTextOnFocus
              style={[
                styles.input,
                {
                  color: error ? colors.danger : colors.text,
                },
              ]}
              value={char}
            />
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  box: {
    width: 60,
    height: 72,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
    width: '100%',
    height: '100%',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

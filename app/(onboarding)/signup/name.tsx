import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { triggerHaptic } from '../../../src/motion/haptics';
import { useSignupStore } from '../../../src/stores/signupStore';
import { colors, radii, spacing } from '../../../src/theme/tokens';
import { Button } from '../../../src/ui/Button';
import { Card } from '../../../src/ui/Card';
import { Text } from '../../../src/ui/Text';

export default function SignupNameScreen() {
  const router = useRouter();
  const storedName = useSignupStore((s) => s.name);
  const storedColor = useSignupStore((s) => s.color);
  const setName = useSignupStore((s) => s.setName);
  const setColor = useSignupStore((s) => s.setColor);

  const [localName, setLocalName] = useState(storedName || '');
  const [selectedColor, setSelectedColor] = useState(storedColor || colors.palette[0]);
  const [error, setError] = useState('');

  const trimmed = localName.trim();
  const isValid = trimmed.length >= 1 && trimmed.length <= 20;

  const handleNext = () => {
    if (!isValid) {
      setError('Codename must be between 1 and 20 characters.');
      triggerHaptic('error');
      return;
    }
    setError('');
    setName(trimmed);
    setColor(selectedColor);
    triggerHaptic('buttonTap');
    router.push('/signup/account' as any);
  };

  const handleColorSelect = (hex: string) => {
    setSelectedColor(hex);
    setColor(hex);
    triggerHaptic('buttonTap');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoid}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header & Step Tracker */}
          <View style={styles.header}>
            <Text style={styles.stepIndicator} variant="label">
              STEP 1 OF 4 • IDENTITY
            </Text>
            <Text style={styles.title} variant="headline">
              What should we call you?
            </Text>
            <Text style={styles.subtitle} variant="body">
              It&apos;s how you show up on the radar blips and in match intel.
            </Text>
          </View>

          {/* Live "On The Radar" Preview Chip Card */}
          <Card style={styles.previewCard} variant="elevated">
            <Text style={styles.previewLabel} variant="label">
              LIVE RADAR PREVIEW
            </Text>
            <View style={styles.previewRow}>
              {/* Radar Entity Pin */}
              <View style={[styles.radarPin, { borderColor: selectedColor }]}>
                <View style={[styles.radarPinCenter, { backgroundColor: selectedColor }]} />
              </View>

              {/* Codename Callout Chip */}
              <View style={[styles.calloutChip, { borderColor: selectedColor }]}>
                <Text style={styles.calloutText} variant="mono">
                  {trimmed.length > 0 ? trimmed.toUpperCase() : 'CODENAME'}
                </Text>
              </View>
            </View>
            <Text style={styles.previewSubtext} variant="caption">
              Seen by teammates during active games and everyone on the recap.
            </Text>
          </Card>

          {/* Display Name Input */}
          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.inputLabel} variant="label">
                CODENAME / DISPLAY NAME
              </Text>
              <Text style={styles.charCount} variant="mono">
                {trimmed.length}/20
              </Text>
            </View>

            <TextInput
              accessibilityLabel="Codename input"
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={20}
              onChangeText={(text) => {
                setLocalName(text);
                if (error) setError('');
              }}
              placeholder="e.g. Nightrunner, Ghost-7"
              placeholderTextColor={colors.textSubtle}
              style={[styles.textInput, error ? styles.textInputError : null]}
              value={localName}
            />
            {error ? (
              <Text style={styles.errorText} variant="caption">
                {error}
              </Text>
            ) : null}
          </View>

          {/* 8-Color Tactical Palette */}
          <View style={styles.paletteGroup}>
            <Text style={styles.inputLabel} variant="label">
              PLAYER COLOR ACCENT
            </Text>
            <Text style={styles.paletteSubtitle} variant="caption">
              Marks your blips and trail points on the tactical map.
            </Text>

            <View style={styles.paletteGrid}>
              {colors.palette.map((hex: string) => {
                const isSelected = selectedColor === hex;
                return (
                  <Pressable
                    accessibilityLabel={`Choose player color ${hex}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={hex}
                    onPress={() => handleColorSelect(hex)}
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: hex },
                      isSelected ? styles.colorSwatchSelected : null,
                    ]}
                  >
                    {isSelected ? <View style={styles.colorSwatchInnerRing} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Footer Navigation */}
        <View style={styles.footer}>
          <Button
            accessibilityHint="Continues to account creation step"
            disabled={!isValid}
            onPress={handleNext}
            size="lg"
            title="Continue"
            variant="primary"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    marginBottom: spacing.xl,
  },
  stepIndicator: {
    color: colors.primary,
    letterSpacing: 2,
    marginBottom: spacing.xs,
  },
  title: {
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.textMuted,
  },
  previewCard: {
    padding: spacing.md,
    borderRadius: radii.card,
    alignItems: 'center',
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewLabel: {
    color: colors.textSubtle,
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  radarPin: {
    width: 24,
    height: 24,
    borderRadius: radii.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarPinCenter: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
  },
  calloutChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
  },
  calloutText: {
    color: colors.textLight,
    fontWeight: '700',
    fontSize: 14,
  },
  previewSubtext: {
    color: colors.textSubtle,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  inputGroup: {
    marginBottom: spacing.xl,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  inputLabel: {
    color: colors.textMuted,
    letterSpacing: 1,
  },
  charCount: {
    color: colors.textSubtle,
    fontSize: 12,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textLight,
    fontSize: 16,
    fontFamily: 'System',
  },
  textInputError: {
    borderColor: colors.danger,
  },
  errorText: {
    color: colors.danger,
    marginTop: spacing.xs,
  },
  paletteGroup: {
    marginBottom: spacing.xl,
  },
  paletteSubtitle: {
    color: colors.textSubtle,
    marginBottom: spacing.md,
  },
  paletteGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  colorSwatch: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatchSelected: {
    borderWidth: 3,
    borderColor: colors.textLight,
    transform: [{ scale: 1.1 }],
  },
  colorSwatchInnerRing: {
    width: 14,
    height: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.background,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceDark,
  },
});

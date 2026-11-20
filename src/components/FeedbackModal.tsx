import React, { useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  TextInput,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import { useDialogModalAnimation } from '../motion';
import { supabase } from '../lib/supabase';
import { buildDiagnosticBundle } from '../lib/diagnostics';

interface FeedbackModalProps {
  visible: boolean;
  onClose: () => void;
}

type FeedbackCategory = 'bug' | 'suggestion' | 'safety' | 'other';

export function FeedbackModal({ visible, onClose }: FeedbackModalProps) {
  const { colors, spacing, radii } = useTheme();
  const { mounted, fadeAnim, scaleAnim, handleClose } = useDialogModalAnimation(visible, onClose);
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit() {
    if (!message.trim() || submitting || !supabase) return;
    setErrorMsg('');
    setSubmitting(true);
    triggerHaptic('buttonTap');

    const bundle = includeDiagnostics ? buildDiagnosticBundle() : {};

    try {
      const { error } = await supabase.rpc('submit_feedback', {
        p_category: category,
        p_message: message.trim(),
        p_bundle: bundle,
      });

      if (error) {
        setErrorMsg(error.message);
        triggerHaptic('error');
      } else {
        triggerHaptic('tagConfirmed');
        Alert.alert(
          'Feedback Dispatched',
          'Thank you for reporting. Your field intelligence helps improve GhostRun operations.'
        );
        setMessage('');
        onClose();
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0,0,0,0.75)', opacity: fadeAnim },
          ]}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <Animated.View style={{ width: '100%', maxWidth: 400, opacity: fadeAnim, transform: [{ scale: scaleAnim }] }}>
          <Card
            variant="elevated"
            style={[
              styles.container,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderDark,
                borderRadius: radii.card,
                padding: spacing.xl,
              },
            ]}
          >
            {/* Header */}
            <View style={styles.header}>
              <View>
                <Text variant="label" style={{ color: colors.accent, letterSpacing: 1.5 }}>
                  FIELD INTELLIGENCE
                </Text>
                <Text variant="title" style={{ color: colors.text, marginTop: 2 }}>
                  Report Bug / Feedback
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close feedback modal"
                onPress={handleClose}
                style={[styles.closeBtn, { backgroundColor: colors.surfaceElevated }]}
              >
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>

          {/* Category Chips */}
          <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.md, marginBottom: 6, fontSize: 11 }}>
            CATEGORY
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[
              { id: 'bug', label: 'Bug Report' },
              { id: 'suggestion', label: 'Suggestion' },
              { id: 'safety', label: 'Safety Issue' },
              { id: 'other', label: 'Other' },
            ].map((cat) => {
              const isSelected = category === cat.id;
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => setCategory(cat.id as FeedbackCategory)}
                  style={[
                    styles.catChip,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.surfaceElevated,
                      borderColor: isSelected ? colors.primary : colors.borderDark,
                    },
                  ]}
                >
                  <Text
                    variant="label"
                    style={{
                      color: isSelected ? '#000' : colors.text,
                      fontSize: 11,
                      fontWeight: isSelected ? '700' : '500',
                    }}
                  >
                    {cat.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Text Input */}
          <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.md, marginBottom: 6, fontSize: 11 }}>
            TRANSMISSION DETAILS
          </Text>
          <TextInput
            style={[
              styles.textInput,
              {
                color: colors.text,
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.borderDark,
              },
            ]}
            placeholder="Describe what occurred, unexpected behaviour, or your suggestion…"
            placeholderTextColor={colors.textMuted}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={4}
            maxLength={2000}
          />

          {/* Diagnostics Toggle */}
          <View style={[styles.diagRow, { borderColor: colors.borderDark, marginTop: spacing.md }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="title" style={{ color: colors.text, fontSize: 13 }}>
                Attach System Diagnostics
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                Includes OS version & app version. Zero coordinates or personal names attached.
              </Text>
            </View>
            <Switch
              value={includeDiagnostics}
              onValueChange={setIncludeDiagnostics}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={colors.textLight}
            />
          </View>

          {errorMsg !== '' && (
            <Text variant="caption" style={{ color: colors.danger, textAlign: 'center', marginTop: 8 }}>
              {errorMsg}
            </Text>
          )}

          {/* Action Buttons */}
          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <Button
              title="Transmit Feedback"
              variant="primary"
              size="lg"
              disabled={!message.trim() || submitting}
              loading={submitting}
              onPress={() => void handleSubmit()}
            />
            <Button
              title="Cancel"
              variant="secondary"
              size="md"
              onPress={handleClose}
            />
          </View>
        </Card>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  catChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  textInput: {
    height: 90,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  diagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

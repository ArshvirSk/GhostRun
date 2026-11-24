import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Card } from '../ui/Card';
import { triggerHaptic } from '../motion/haptics';
import {
  validateDiscordWebhookUrl,
  testDiscordWebhookTransmission,
} from '../lib/discord';

export const DISCORD_WEBHOOK_STORAGE_KEY = '@ghostrun:discord_webhook_url';

export interface DiscordWebhookConfigCardProps {
  hostName?: string;
  onWebhookChange?: (url: string) => void;
}

export function DiscordWebhookConfigCard({
  hostName = 'Operative',
  onWebhookChange,
}: DiscordWebhookConfigCardProps) {
  const { colors, isDark } = useTheme();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null);

  useEffect(() => {
    async function loadSavedWebhook() {
      try {
        const saved = await AsyncStorage.getItem(DISCORD_WEBHOOK_STORAGE_KEY);
        if (saved) {
          setWebhookUrl(saved);
          if (onWebhookChange) onWebhookChange(saved);
        }
      } catch {
        // Non-blocking fallback
      }
    }
    void loadSavedWebhook();
  }, [onWebhookChange]);

  const isValid = validateDiscordWebhookUrl(webhookUrl);

  const handleUrlChange = (text: string) => {
    const trimmed = text.trim();
    setWebhookUrl(trimmed);
    setTestResult(null);
    if (onWebhookChange) onWebhookChange(trimmed);
  };

  const handleSave = async () => {
    triggerHaptic('buttonTap');
    try {
      await AsyncStorage.setItem(DISCORD_WEBHOOK_STORAGE_KEY, webhookUrl);
      setTestResult({ success: true, message: 'Webhook URL saved locally' });
    } catch {
      setTestResult({ success: false, message: 'Failed to persist webhook' });
    }
  };

  const handleTestTransmission = async () => {
    if (!isValid) return;
    triggerHaptic('buttonTap');
    setTesting(true);
    setTestResult(null);

    const res = await testDiscordWebhookTransmission(webhookUrl, hostName);
    setTesting(false);

    if (res.success) {
      setTestResult({
        success: true,
        message: 'Test transmission successful. Check your squad channel.',
      });
      // Automatically save valid working webhook
      void AsyncStorage.setItem(DISCORD_WEBHOOK_STORAGE_KEY, webhookUrl);
    } else {
      setTestResult({
        success: false,
        message: res.error || 'Failed to deliver webhook payload',
      });
    }
  };

  return (
    <Card
      variant="default"
      style={[
        styles.card,
        {
          backgroundColor: isDark ? colors.surface : colors.surfaceAlt,
          borderColor: isValid ? colors.primary : colors.borderDark,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTitleCol}>
          <View style={styles.badgeRow}>
            <View style={[styles.pulseDot, { backgroundColor: isValid ? colors.primary : colors.textMuted }]} />
            <Text style={[styles.badgeText, { color: isValid ? colors.primary : colors.textMuted }]}>
              NF-22 // SQUAD DISCORD INTEGRATION
            </Text>
          </View>
          <Text variant="title" style={[styles.title, { color: colors.text }]}>
            Squad Discord Webhook
          </Text>
        </View>
        <Ionicons name="logo-discord" size={24} color="#5865F2" />
      </View>

      <Text variant="caption" style={[styles.description, { color: colors.textMuted }]}>
        Automatically dispatches match lobbies, post-game tactical debriefs, and emergency SOS alerts with zero GPS coordinate leakage.
      </Text>

      {/* URL Input Field */}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
            borderColor: webhookUrl.length > 0 ? (isValid ? colors.primary : colors.danger) : colors.border,
          },
        ]}
      >
        <Ionicons
          name="link-outline"
          size={16}
          color={isValid ? colors.primary : colors.textMuted}
          style={styles.inputIcon}
        />
        <TextInput
          value={webhookUrl}
          onChangeText={handleUrlChange}
          placeholder="https://discord.com/api/webhooks/..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: colors.text }]}
        />
        {webhookUrl.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear Webhook URL"
            onPress={() => handleUrlChange('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Validation Status Indicator */}
      {webhookUrl.length > 0 && (
        <View style={styles.statusRow}>
          <Ionicons
            name={isValid ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            size={14}
            color={isValid ? colors.primary : colors.warning}
          />
          <Text
            variant="caption"
            style={{
              color: isValid ? colors.primary : colors.warning,
              fontFamily: 'SegoeUI-Bold',
              fontSize: 11,
            }}
          >
            {isValid ? 'WEBHOOK URL VALID // READY FOR DISPATCH' : 'INVALID WEBHOOK URL FORMAT'}
          </Text>
        </View>
      )}

      {/* Test Result Message */}
      {testResult && (
        <View
          style={[
            styles.resultBanner,
            {
              backgroundColor: testResult.success ? `${colors.primary}15` : `${colors.danger}15`,
              borderColor: testResult.success ? colors.primary : colors.danger,
            },
          ]}
        >
          <Ionicons
            name={testResult.success ? 'checkmark-circle' : 'warning'}
            size={14}
            color={testResult.success ? colors.primary : colors.danger}
          />
          <Text
            style={[
              styles.resultText,
              { color: testResult.success ? colors.primary : colors.danger },
            ]}
          >
            {testResult.message}
          </Text>
        </View>
      )}

      {/* Action Buttons Row */}
      <View style={styles.actionButtonsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Transmit Test Discord Embed"
          disabled={!isValid || testing}
          onPress={() => void handleTestTransmission()}
          style={({ pressed }) => [
            styles.testButton,
            {
              backgroundColor: isValid ? colors.primary : colors.borderDark,
              opacity: isValid && !testing ? (pressed ? 0.85 : 1) : 0.45,
            },
          ]}
        >
          {testing ? (
            <ActivityIndicator size="small" color="#0A0A0C" />
          ) : (
            <Text style={styles.testButtonText}>TRANSMIT TEST</Text>
          )}
        </Pressable>

        {isValid && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save Webhook Locally"
            onPress={() => void handleSave()}
            style={[styles.saveButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.saveButtonText, { color: colors.text }]}>SAVE</Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginVertical: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  headerTitleCol: {
    flex: 1,
    marginRight: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    letterSpacing: 0.8,
  },
  title: {
    fontFamily: 'Archivo-Black',
    fontSize: 15,
  },
  description: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 42,
    marginBottom: 8,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    paddingVertical: 0,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    marginLeft: 2,
  },
  resultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 10,
  },
  resultText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    flex: 1,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  testButton: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testButtonText: {
    fontFamily: 'Archivo-Black',
    fontSize: 11,
    color: '#0A0A0C',
    letterSpacing: 0.8,
  },
  saveButton: {
    paddingHorizontal: 16,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    letterSpacing: 0.8,
  },
});

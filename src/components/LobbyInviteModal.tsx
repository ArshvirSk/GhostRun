import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  Share,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { triggerHaptic } from '../motion/haptics';
import { buildInvitePayload, normalizeRoomCode } from '../lib/invite';
import { getCachedQrUri, pregenerateQrUri } from '../lib/qrCache';

interface LobbyInviteModalProps {
  visible: boolean;
  code: string;
  modeName?: string;
  modeId?: string;
  playerCount?: number;
  onClose: () => void;
}

export function LobbyInviteModal({
  visible,
  code,
  modeName = 'Classic Chase',
  modeId = 'classic_chase',
  playerCount,
  onClose,
}: LobbyInviteModalProps) {
  const { colors, spacing, radii } = useTheme();
  const cleanCode = normalizeRoomCode(code);

  const payload = buildInvitePayload({
    code: cleanCode,
    modeId,
    modeName,
    playerCount,
  });

  // Pre-load from memory cache for 0ms instantaneous display
  const [qrUri, setQrUri] = useState<string | null>(() => getCachedQrUri(payload.webLink));
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Eagerly pre-generate QR code as soon as component mounts or code is known (no waiting for modal visible)
  useEffect(() => {
    let active = true;
    if (cleanCode && payload.webLink) {
      const cached = getCachedQrUri(payload.webLink);
      if (cached) {
        setQrUri(cached);
      } else {
        pregenerateQrUri(payload.webLink, {
          width: 220,
          dark: '#000000',
          light: '#FFFFFF',
        }).then((uri) => {
          if (active && uri) setQrUri(uri);
        });
      }
    }
    return () => {
      active = false;
    };
  }, [cleanCode, payload.webLink]);

  async function handleShare() {
    triggerHaptic('buttonTap');
    try {
      await Share.share({
        title: payload.title,
        message: payload.message,
        url: payload.webLink,
      });
    } catch {
      // User cancelled share or dismissed
    }
  }

  async function handleCopyOrShare(type: 'code' | 'link') {
    triggerHaptic('buttonTap');
    const textToShare = type === 'code' ? cleanCode : payload.webLink;

    if (
      Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      navigator.clipboard
    ) {
      try {
        await navigator.clipboard.writeText(textToShare);
        if (type === 'code') {
          setCopiedCode(true);
          setTimeout(() => setCopiedCode(false), 2000);
        } else {
          setCopiedLink(true);
          setTimeout(() => setCopiedLink(false), 2000);
        }
        return;
      } catch {
        // Fallback to share
      }
    }

    try {
      await Share.share({
        message: textToShare,
        url: type === 'link' ? payload.webLink : undefined,
      });
    } catch {
      // User cancelled
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
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
                TACTICAL DEPLOYMENT
              </Text>
              <Text variant="title" style={{ color: colors.text, marginTop: 2 }}>
                Invite Operatives
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close invite modal"
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceElevated }]}
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {/* Code Banner */}
          <View
            style={[
              styles.codeBox,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.borderDark,
                borderRadius: radii.md,
                marginTop: spacing.md,
              },
            ]}
          >
            <View>
              <Text variant="label" style={{ color: colors.textMuted, fontSize: 10 }}>
                ROOM CODE
              </Text>
              <Text variant="display" style={{ color: colors.text, letterSpacing: 4 }}>
                {cleanCode}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share room code"
              onPress={() => void handleCopyOrShare('code')}
              style={[
                styles.copyBtn,
                {
                  backgroundColor: copiedCode ? colors.primary : colors.surfaceElevated,
                  borderColor: colors.borderDark,
                },
              ]}
            >
              <Ionicons
                name={copiedCode ? 'checkmark' : 'share-outline'}
                size={16}
                color={copiedCode ? '#000' : colors.text}
              />
              <Text
                variant="label"
                style={{
                  color: copiedCode ? '#000' : colors.text,
                  marginLeft: 4,
                  fontSize: 11,
                }}
              >
                {copiedCode ? 'COPIED' : 'CODE'}
              </Text>
            </Pressable>
          </View>

          {/* QR Code Container */}
          <View style={[styles.qrContainer, { marginTop: spacing.md }]}>
            {qrUri ? (
              <View style={[styles.qrWrapper, { borderRadius: radii.md }]}>
                <Image source={{ uri: qrUri }} style={styles.qrImage} />
              </View>
            ) : (
              <View style={[styles.qrLoading, { backgroundColor: colors.surfaceElevated, borderRadius: radii.md }]}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text variant="body" style={{ color: colors.textMuted, marginTop: 8 }}>
                  Generating QR Grid…
                </Text>
              </View>
            )}
            <Text variant="body" style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>
              Nearby players can scan with their phone camera to join
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <Button
              title="Share Full Invite Sheet"
              variant="primary"
              size="lg"
              onPress={() => void handleShare()}
            />
            <Button
              title={copiedLink ? 'Link Copied!' : 'Share Direct Join Link'}
              variant="secondary"
              size="md"
              onPress={() => void handleCopyOrShare('link')}
            />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 380,
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
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  qrContainer: {
    alignItems: 'center',
  },
  qrWrapper: {
    padding: 10,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  qrImage: {
    width: 180,
    height: 180,
  },
  qrLoading: {
    width: 180,
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

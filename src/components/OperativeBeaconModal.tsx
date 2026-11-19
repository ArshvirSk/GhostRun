import React, { useMemo } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  Image,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Button } from '../ui/Button';
import { generateQrBmpDataUrl } from '../lib/qrCache';
import { triggerHaptic } from '../motion/haptics';

interface OperativeBeaconModalProps {
  visible: boolean;
  onClose: () => void;
  displayName: string;
  handle?: string | null;
  userId: string;
  avatarColor?: string;
}

export function OperativeBeaconModal({
  visible,
  onClose,
  displayName,
  handle,
  userId,
  avatarColor,
}: OperativeBeaconModalProps) {
  const { colors, isDark } = useTheme();

  const beaconPayload = useMemo(() => {
    const identifier = handle ? `@${handle}` : userId;
    return `https://arshvirsk.github.io/GhostRun/invite?add=${encodeURIComponent(identifier)}`;
  }, [handle, userId]);

  const qrUri = useMemo(() => {
    if (!visible || !beaconPayload) return null;
    return generateQrBmpDataUrl(beaconPayload, {
      moduleScale: 6,
      margin: 2,
    });
  }, [visible, beaconPayload]);

  const handleShare = async () => {
    triggerHaptic('buttonTap');
    try {
      await Share.share({
        title: `GhostRun Operative Link — ${displayName}`,
        message: `Connect with operative ${displayName} on GhostRun:\n${beaconPayload}`,
        url: beaconPayload,
      });
    } catch (e) {
      console.warn('Share error:', e);
    }
  };

  const initial = (displayName || '?')[0].toUpperCase();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.dialog,
            {
              backgroundColor: isDark ? '#121216' : '#FFFFFF',
              borderColor: colors.borderDark || colors.border,
            },
          ]}
        >
          {/* Top Bar with Close button */}
          <View style={styles.topBar}>
            <View style={styles.headerLeft}>
              <View style={[styles.beaconDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.headerTitle, { color: colors.text }]}>OPERATIVE BEACON</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close Beacon"
              onPress={() => {
                triggerHaptic('buttonTap');
                onClose();
              }}
              style={[
                styles.closeBtn,
                { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
              ]}
            >
              <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>
          </View>

          {/* Operative Header Info */}
          <View style={styles.operativeInfoRow}>
            <View
              style={[
                styles.avatarCircle,
                { backgroundColor: avatarColor || colors.primary },
              ]}
            >
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={[styles.opName, { color: colors.text }]}>
                {displayName}
              </Text>
              <Text style={[styles.opHandle, { color: colors.textMuted }]}>
                {handle ? `@${handle}` : 'GhostRun Player'}
              </Text>
            </View>
          </View>

          {/* QR Code Container */}
          <View
            style={[
              styles.qrContainer,
              {
                backgroundColor: '#FFFFFF',
                borderColor: colors.primary,
              },
            ]}
          >
            {qrUri ? (
              <Image
                source={{ uri: qrUri }}
                style={styles.qrImage}
                resizeMode="contain"
                accessibilityLabel="Tactical QR Beacon"
              />
            ) : (
              <View style={styles.qrPlaceholder}>
                <Ionicons name="qr-code-outline" size={64} color="#000000" />
              </View>
            )}
          </View>

          {/* Subtitle / Instructions */}
          <Text style={[styles.instructions, { color: colors.textMuted }]}>
            Point another operative's GhostRun scanner at this beacon to link networks instantly with zero typing.
          </Text>

          {/* Share Action Button */}
          <View style={styles.actionsRow}>
            <Button
              title="Share Invite URL"
              variant="secondary"
              size="md"
              onPress={() => void handleShare()}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  topBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  beaconDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  operativeInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 20,
    fontWeight: '900',
    color: '#000000',
  },
  opName: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  opHandle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  qrContainer: {
    width: 220,
    height: 220,
    borderRadius: 18,
    borderWidth: 2,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  qrImage: {
    width: 200,
    height: 200,
  },
  qrPlaceholder: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructions: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  actionsRow: {
    width: '100%',
    flexDirection: 'row',
  },
});

import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  Image,
  Dimensions,
  Share,
  Alert,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Paths, File } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { triggerHaptic } from '../motion/haptics';
import { useSheetModalAnimation } from '../motion';
import { generateQrBmpDataUrl } from '../lib/qrCache';
import { formatFriendWebInviteUrl } from '../lib/friendsCore';
import { formatCodenameWithTag } from '../lib/codename';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 64, 310);

export interface HoloOperativeCardModalProps {
  visible: boolean;
  onClose: () => void;
  displayName: string;
  tagline?: string | null;
  handle?: string | null;
  userId: string;
  avatarColor?: string;
  tier?: string;
  echoPts?: number;
  stats?: any;
  isCipher?: boolean;
}

export function HoloOperativeCardModal({
  visible,
  onClose,
  displayName,
  tagline,
  userId,
  avatarColor,
}: HoloOperativeCardModalProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const cardRef = useRef<any>(null);
  const [sharing, setSharing] = useState(false);
  const { mounted, fadeAnim, slideAnim, handleClose } = useSheetModalAnimation(visible, onClose);

  const cleanName = displayName.toUpperCase() || 'OPERATIVE';
  const cleanTag = tagline?.toUpperCase() || (userId ? userId.slice(0, 4).toUpperCase() : '10D1');
  const fullIdentifier = formatCodenameWithTag(cleanName, cleanTag);
  const signatureColor = avatarColor || colors.primary;
  const initial = cleanName.charAt(0) || 'A';

  const webInviteUrl = useMemo(() => {
    return formatFriendWebInviteUrl(fullIdentifier);
  }, [fullIdentifier]);

  const qrUri = useMemo(() => {
    if (!visible || !webInviteUrl) return null;
    return generateQrBmpDataUrl(webInviteUrl, {
      moduleScale: 5,
      margin: 1,
    });
  }, [visible, webInviteUrl]);

  const captureCardImage = async (): Promise<string | null> => {
    try {
      if (!cardRef.current) return null;
      const uri = await captureRef(cardRef.current, {
        format: 'png',
        quality: 0.95,
      });
      return uri;
    } catch {
      return null;
    }
  };

  const handleShare = async () => {
    if (sharing) return;
    triggerHaptic('buttonTap');
    setSharing(true);
    try {
      const imgUri = await captureCardImage();
      const isAvailable = await Sharing.isAvailableAsync();
      if (imgUri && isAvailable) {
        await Sharing.shareAsync(imgUri, {
          mimeType: 'image/png',
          dialogTitle: `GhostRun - @${fullIdentifier}`,
        });
        setSharing(false);
        return;
      }
    } catch {
      // fallback
    }

    // Text fallback
    try {
      await Share.share({
        title: `GhostRun - @${fullIdentifier}`,
        message: `Deploy with me on GhostRun!\nOperative: @${fullIdentifier}\n${webInviteUrl}`,
        url: webInviteUrl,
      });
    } catch {
      // dismissed
    } finally {
      setSharing(false);
    }
  };

  const handleSave = async () => {
    if (sharing) return;
    triggerHaptic('tagConfirmed');
    setSharing(true);
    try {
      const imgUri = await captureCardImage();
      if (imgUri) {
        const src = new File(imgUri);
        const dest = new File(Paths.document, `GhostRun_${cleanName}_card.png`);
        src.copy(dest);
        Alert.alert('Card Saved', 'Profile card image saved successfully.');
      } else {
        Alert.alert('Save Failed', 'Could not render card image.');
      }
    } catch {
      Alert.alert('Save Failed', 'Could not save card to device.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        {/* Smooth Fading Backdrop */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              opacity: fadeAnim,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss share sheet"
            style={StyleSheet.absoluteFill}
            onPress={handleClose}
          />
        </Animated.View>

        {/* Sliding Bottom Sheet Modal Container */}
        <Animated.View
          style={[
            styles.bottomSheet,
            {
              backgroundColor: isDark ? '#11141B' : '#FFFFFF',
              borderTopColor: isDark ? '#1F2430' : '#E5E7EB',
              paddingBottom: Math.max(insets.bottom + 16, 28),
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Top Sheet Header Row */}
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHandle} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close share card"
              onPress={handleClose}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          {/* Minimal Floating Holographic Card (Duolingo Style) */}
          <View style={styles.cardCenterWrapper}>
            <LinearGradient
              colors={['#00f5ff', '#7928ca', '#ff0080', '#c7f36b', '#fbbf24', '#00f5ff']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.holoBorder, { width: CARD_WIDTH }]}
            >
              <View
                ref={cardRef}
                collapsable={false}
                style={[
                  styles.cardBody,
                  { backgroundColor: isDark ? '#0C0E14' : '#FFFFFF' },
                ]}
              >
                {/* Hero Avatar Banner Area */}
                <View
                  style={[
                    styles.avatarHeroBox,
                    {
                      backgroundColor: isDark
                        ? 'rgba(255, 255, 255, 0.04)'
                        : 'rgba(0, 0, 0, 0.03)',
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.avatarCircle,
                      {
                        backgroundColor: signatureColor,
                        shadowColor: signatureColor,
                      },
                    ]}
                  >
                    <Text style={styles.avatarInitial}>{initial}</Text>
                  </View>
                </View>

                {/* Bottom Row: Name, Tag & Brand on Left, QR on Right */}
                <View style={styles.cardBottomRow}>
                  <View style={styles.identityCol}>
                    <Text numberOfLines={1} style={[styles.nameText, { color: colors.text }]}>
                      @{cleanName}
                    </Text>
                    <Text style={[styles.tagText, { color: colors.textMuted }]}>
                      #{cleanTag}
                    </Text>
                    <Text style={[styles.brandWordmark, { color: colors.primary }]}>
                      ghostrun
                    </Text>
                  </View>

                  {/* QR Code */}
                  <View style={styles.qrWrapper}>
                    {qrUri ? (
                      <Image
                        source={{ uri: qrUri }}
                        style={styles.qrImage}
                        resizeMode="contain"
                        accessibilityLabel="Invite QR"
                      />
                    ) : (
                      <View style={styles.qrFallback}>
                        <Ionicons name="qr-code" size={30} color="#000000" />
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* Clean Share Tray (Circular Action Buttons) */}
          <View style={styles.shareTrayContainer}>
            <Text style={[styles.shareSectionLabel, { color: colors.textMuted }]}>
              SHARE
            </Text>

            <View style={styles.appsRow}>
              {/* WhatsApp */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share on WhatsApp"
                onPress={() => void handleShare()}
                style={({ pressed }) => [styles.appItem, pressed && { opacity: 0.65 }]}
              >
                <View style={[styles.appCircle, { backgroundColor: '#25D366' }]}>
                  <Ionicons name="logo-whatsapp" size={26} color="#FFFFFF" />
                </View>
                <Text style={[styles.appLabel, { color: colors.text }]}>WhatsApp</Text>
              </Pressable>

              {/* X */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share on X"
                onPress={() => void handleShare()}
                style={({ pressed }) => [styles.appItem, pressed && { opacity: 0.65 }]}
              >
                <View
                  style={[
                    styles.appCircle,
                    {
                      backgroundColor: '#111317',
                      borderColor: isDark ? '#262D38' : '#D1D5DB',
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Ionicons name="logo-twitter" size={22} color="#FFFFFF" />
                </View>
                <Text style={[styles.appLabel, { color: colors.text }]}>X</Text>
              </Pressable>

              {/* Messages */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share via Messages"
                onPress={() => void handleShare()}
                style={({ pressed }) => [styles.appItem, pressed && { opacity: 0.65 }]}
              >
                <View style={[styles.appCircle, { backgroundColor: '#007AFF' }]}>
                  <Ionicons name="chatbubble-ellipses" size={22} color="#FFFFFF" />
                </View>
                <Text style={[styles.appLabel, { color: colors.text }]}>Messages</Text>
              </Pressable>

              {/* Save Card Image */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save Card Image"
                onPress={() => void handleSave()}
                style={({ pressed }) => [styles.appItem, pressed && { opacity: 0.65 }]}
              >
                <View
                  style={[
                    styles.appCircle,
                    {
                      backgroundColor: isDark ? '#212631' : '#E5E7EB',
                      borderColor: isDark ? '#2E3544' : '#D1D5DB',
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Ionicons name="download-outline" size={22} color={colors.text} />
                </View>
                <Text style={[styles.appLabel, { color: colors.text }]}>Save</Text>
              </Pressable>

              {/* More / System Share */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="More share options"
                onPress={() => void handleShare()}
                style={({ pressed }) => [styles.appItem, pressed && { opacity: 0.65 }]}
              >
                <View
                  style={[
                    styles.appCircle,
                    {
                      backgroundColor: isDark ? '#212631' : '#E5E7EB',
                      borderColor: isDark ? '#2E3544' : '#D1D5DB',
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
                </View>
                <Text style={[styles.appLabel, { color: colors.text }]}>More</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdropPressable: {
    flex: 1,
  },
  bottomSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    alignItems: 'center',
  },
  sheetHeader: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignSelf: 'center',
    marginLeft: 32,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCenterWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  holoBorder: {
    borderRadius: 24,
    padding: 2.5,
    shadowColor: '#00f5ff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 10,
  },
  cardBody: {
    borderRadius: 22,
    overflow: 'hidden',
    padding: 16,
  },
  avatarHeroBox: {
    width: '100%',
    height: 140,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  avatarInitial: {
    fontFamily: 'Archivo-Black',
    fontSize: 40,
    fontWeight: '900',
    color: '#000000',
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  identityCol: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: 10,
  },
  nameText: {
    fontFamily: 'Archivo-Black',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  tagText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
    marginBottom: 8,
  },
  brandWordmark: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  qrWrapper: {
    width: 68,
    height: 68,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  qrImage: {
    width: '100%',
    height: '100%',
  },
  qrFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareTrayContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 4,
  },
  shareSectionLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 14,
  },
  appsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 4,
  },
  appItem: {
    alignItems: 'center',
    minWidth: 54,
  },
  appCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  appLabel: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 11,
    fontWeight: '600',
  },
});

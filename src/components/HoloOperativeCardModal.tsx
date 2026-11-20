import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  Image,
  Share,
  Linking,
  Dimensions,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import { generateQrBmpDataUrl } from '../lib/qrCache';
import { formatFriendWebInviteUrl } from '../lib/friendsCore';
import { formatCodenameWithTag } from '../lib/codename';
import { TACTICAL_GOLD } from '../theme/tokens';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 48, 340);

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
  stats?: {
    rounds?: number;
    won?: number;
    winRate?: number;
    bestEscape?: string;
    neverCaught?: number;
    farthestMeters?: number;
  };
  isCipher?: boolean;
}

export function HoloOperativeCardModal({
  visible,
  onClose,
  displayName,
  tagline,
  handle,
  userId,
  avatarColor,
  tier = 'Whisper',
  echoPts = 0,
  stats,
  isCipher = false,
}: HoloOperativeCardModalProps) {
  const { colors, isDark } = useTheme();
  const [copyFeedback, setCopyFeedback] = useState(false);

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
      moduleScale: 6,
      margin: 2,
    });
  }, [visible, webInviteUrl]);

  const shareMessage = useMemo(() => {
    return `Deploy with me on GhostRun!\nOperative: @${fullIdentifier}\nTier: ${tier} • ${echoPts} PTS\nJoin network: ${webInviteUrl}`;
  }, [fullIdentifier, tier, echoPts, webInviteUrl]);

  const handleSystemShare = async () => {
    triggerHaptic('buttonTap');
    try {
      await Share.share({
        title: `GhostRun Operative Credential — ${fullIdentifier}`,
        message: shareMessage,
        url: webInviteUrl,
      });
    } catch {
      // share dismissed
    }
  };

  const handleWhatsAppShare = async () => {
    triggerHaptic('buttonTap');
    const waUrl = `whatsapp://send?text=${encodeURIComponent(shareMessage)}`;
    try {
      const canOpen = await Linking.canOpenURL(waUrl);
      if (canOpen) {
        await Linking.openURL(waUrl);
      } else {
        await handleSystemShare();
      }
    } catch {
      await handleSystemShare();
    }
  };

  const handleTwitterShare = async () => {
    triggerHaptic('buttonTap');
    const tweetText = `Deploy with me on GhostRun! Connect to my operative network: @${fullIdentifier}\n${webInviteUrl}`;
    const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
    try {
      await Linking.openURL(xUrl);
    } catch {
      await handleSystemShare();
    }
  };

  const handleMessagesShare = async () => {
    triggerHaptic('buttonTap');
    const smsUrl = `sms:?body=${encodeURIComponent(shareMessage)}`;
    try {
      const canOpen = await Linking.canOpenURL(smsUrl);
      if (canOpen) {
        await Linking.openURL(smsUrl);
      } else {
        await handleSystemShare();
      }
    } catch {
      await handleSystemShare();
    }
  };

  const handleCopyLink = async () => {
    triggerHaptic('tagConfirmed');
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2200);
    // Since direct native clipboard might not be installed, launch system share or feedback
    await handleSystemShare();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onClose} />

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Top Bar with Dismiss */}
          <View style={[styles.topBar, { width: CARD_WIDTH }]}>
            <View style={styles.badgePill}>
              <View style={[styles.pulsingDot, { backgroundColor: colors.primary }]} />
              <Text style={styles.badgePillText}>TACTICAL ID CARD</Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close share card"
              onPress={() => {
                triggerHaptic('buttonTap');
                onClose();
              }}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          {/* Holographic Card Container */}
          <LinearGradient
            colors={['#00f5ff', '#7928ca', '#ff0080', '#c7f36b', '#fbbf24', '#00f5ff']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.holoBorderGradient, { width: CARD_WIDTH }]}
          >
            <View style={styles.holoCardBody}>
              {/* Holographic Shimmer Overlay */}
              <LinearGradient
                colors={[
                  'rgba(255, 255, 255, 0.09)',
                  'rgba(0, 245, 255, 0.04)',
                  'rgba(199, 243, 107, 0.05)',
                  'transparent',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.8 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />

              {/* Card Header Ribbon */}
              <View style={styles.cardHeaderRibbon}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
                  <Text style={[styles.cardHeaderTitle, { color: colors.textMuted }]}>
                    OPERATIVE DOSSIER
                  </Text>
                </View>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>VERIFIED</Text>
                </View>
              </View>

              {/* Avatar & Signature Section */}
              <View style={styles.avatarSection}>
                {/* Radar Signature Rings */}
                <View style={[styles.radarOuterRing, { borderColor: `${signatureColor}33` }]}>
                  <View style={[styles.radarMidRing, { borderColor: `${signatureColor}66` }]}>
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
                </View>

                {/* Identity Text */}
                <View style={styles.identityBlock}>
                  <View style={styles.codenameRow}>
                    <Text numberOfLines={1} style={[styles.codenameText, { color: '#FFFFFF' }]}>
                      @{cleanName}
                    </Text>
                    <Text style={[styles.taglineText, { color: colors.primary }]}>
                      #{cleanTag}
                    </Text>
                    {isCipher && (
                      <View style={styles.cpBadge}>
                        <Text style={styles.cpBadgeText}>CP</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.tierRow}>
                    <Ionicons name="trophy" size={12} color="#fbbf24" />
                    <Text style={[styles.tierText, { color: '#fbbf24' }]}>
                      Tier {tier}
                    </Text>
                    <Text style={styles.bulletSeparator}>•</Text>
                    <Text style={[styles.echoPtsText, { color: colors.textMuted }]}>
                      {echoPts} PTS
                    </Text>
                  </View>
                </View>
              </View>

              {/* Combat Telemetry Mini-Grid */}
              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={styles.statBoxNum}>{stats?.rounds ?? 0}</Text>
                  <Text style={styles.statBoxLabel}>MISSIONS</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statBoxNum}>{stats?.winRate ?? 0}%</Text>
                  <Text style={styles.statBoxLabel}>WIN RATE</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statBoxNum}>{stats?.bestEscape ?? '--'}</Text>
                  <Text style={styles.statBoxLabel}>ESCAPE</Text>
                </View>
              </View>

              {/* Tactical Divider */}
              <View style={styles.dashedDivider} />

              {/* Bottom Brand & QR Pairing Code (Duolingo Style) */}
              <View style={styles.cardFooter}>
                <View style={styles.footerBrandCol}>
                  <View style={styles.brandWordmarkRow}>
                    <Text style={styles.brandTitle}>GHOSTRUN</Text>
                    <View style={[styles.brandDot, { backgroundColor: colors.primary }]} />
                  </View>
                  <Text style={styles.brandSub}>SCAN TO DEPLOY TOGETHER</Text>
                  <Text style={styles.brandUrl}>ghostrun.app/invite</Text>
                </View>

                {/* QR Code Container */}
                <View style={styles.qrBox}>
                  {qrUri ? (
                    <Image
                      source={{ uri: qrUri }}
                      style={styles.qrImage}
                      resizeMode="contain"
                      accessibilityLabel="Operative QR Invite"
                    />
                  ) : (
                    <View style={styles.qrFallback}>
                      <Ionicons name="qr-code-outline" size={40} color="#000000" />
                    </View>
                  )}
                </View>
              </View>
            </View>
          </LinearGradient>

          {/* Bottom Share Sheet (Duolingo Style Action Tray) */}
          <View style={[styles.shareTray, { width: CARD_WIDTH }]}>
            <Text style={styles.shareTrayTitle}>SHARE YOUR CARD</Text>

            {/* Circular App Action Row */}
            <View style={styles.shareAppsRow}>
              {/* WhatsApp */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share on WhatsApp"
                onPress={() => void handleWhatsAppShare()}
                style={({ pressed }) => [styles.shareAppItem, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.appIconCircle, { backgroundColor: '#25D366' }]}>
                  <Ionicons name="logo-whatsapp" size={24} color="#FFFFFF" />
                </View>
                <Text style={styles.appIconLabel}>WhatsApp</Text>
              </Pressable>

              {/* X / Twitter */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share on X"
                onPress={() => void handleTwitterShare()}
                style={({ pressed }) => [styles.shareAppItem, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.appIconCircle, { backgroundColor: '#111317', borderColor: '#2d333b', borderWidth: 1 }]}>
                  <Ionicons name="logo-twitter" size={22} color="#FFFFFF" />
                </View>
                <Text style={styles.appIconLabel}>X</Text>
              </Pressable>

              {/* Messages / SMS */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share via Messages"
                onPress={() => void handleMessagesShare()}
                style={({ pressed }) => [styles.shareAppItem, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.appIconCircle, { backgroundColor: '#007AFF' }]}>
                  <Ionicons name="chatbubble-ellipses" size={22} color="#FFFFFF" />
                </View>
                <Text style={styles.appIconLabel}>Messages</Text>
              </Pressable>

              {/* Native System Share / More */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="More share options"
                onPress={() => void handleSystemShare()}
                style={({ pressed }) => [styles.shareAppItem, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.appIconCircle, { backgroundColor: '#1f242c', borderColor: '#343b47', borderWidth: 1 }]}>
                  <Ionicons name="share-social" size={22} color={colors.primary} />
                </View>
                <Text style={styles.appIconLabel}>More</Text>
              </Pressable>
            </View>

            {/* Primary Action Button */}
            <Button
              title={copyFeedback ? 'Operative Link Shared!' : 'Share Operative Card'}
              variant="primary"
              size="md"
              onPress={() => void handleSystemShare()}
              style={{ marginTop: 14 }}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdropTouch: {
    ...StyleSheet.absoluteFill,
  },
  scrollContent: {
    alignItems: 'center',
    paddingVertical: 32,
    justifyContent: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgePillText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#FFFFFF',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  holoBorderGradient: {
    borderRadius: 26,
    padding: 2.5,
    shadowColor: '#00f5ff',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 12,
  },
  holoCardBody: {
    backgroundColor: '#0c0f14',
    borderRadius: 24,
    padding: 20,
    overflow: 'hidden',
  },
  cardHeaderRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  cardHeaderTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  statusPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(74, 222, 128, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(74, 222, 128, 0.4)',
  },
  statusPillText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#4ade80',
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  radarOuterRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarMidRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  avatarInitial: {
    fontFamily: 'Archivo-Black',
    fontSize: 26,
    fontWeight: '900',
    color: '#000000',
  },
  identityBlock: {
    flex: 1,
  },
  codenameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexWrap: 'wrap',
  },
  codenameText: {
    fontFamily: 'Archivo-Black',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  taglineText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  cpBadge: {
    borderWidth: 1,
    borderColor: TACTICAL_GOLD.primary,
    backgroundColor: TACTICAL_GOLD.bgMedium,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  cpBadgeText: {
    fontFamily: 'Archivo-Black',
    fontSize: 9,
    fontWeight: '900',
    color: TACTICAL_GOLD.primary,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  tierText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  bulletSeparator: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontSize: 10,
  },
  echoPtsText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 11,
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statBoxNum: {
    fontFamily: 'Archivo-Black',
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  statBoxLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  dashedDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 16,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerBrandCol: {
    flex: 1,
    paddingRight: 12,
  },
  brandWordmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  brandTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#FFFFFF',
  },
  brandDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  brandSub: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 3,
  },
  brandUrl: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 2,
  },
  qrBox: {
    width: 72,
    height: 72,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 3,
    borderWidth: 1.5,
    borderColor: '#00f5ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrImage: {
    width: 64,
    height: 64,
  },
  qrFallback: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareTray: {
    marginTop: 18,
    backgroundColor: 'rgba(18, 22, 28, 0.95)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    padding: 16,
  },
  shareTrayTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    marginBottom: 14,
  },
  shareAppsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  shareAppItem: {
    alignItems: 'center',
    gap: 6,
  },
  appIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appIconLabel: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

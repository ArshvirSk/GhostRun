import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeProvider';
import { triggerHaptic } from '../motion/haptics';
import { useSheetModalAnimation } from '../motion';
import { TACTICAL_GOLD } from '../theme/tokens';

export const PRIVACY_DEFAULTS_ACK_KEY = '@ghostrun:privacy_defaults_ack_v1';

interface PrivacyDefaultsModalProps {
  visible: boolean;
  onClose: () => void;
}

export function PrivacyDefaultsModal({ visible, onClose }: PrivacyDefaultsModalProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { mounted, fadeAnim, slideAnim, handleClose } = useSheetModalAnimation(visible, onClose);

  const handleAcknowledge = async () => {
    triggerHaptic('buttonTap');
    try {
      await AsyncStorage.setItem(PRIVACY_DEFAULTS_ACK_KEY, 'true');
    } catch {
      // Non-blocking fallback
    }
    handleClose();
  };

  return (
    <Modal
      visible={mounted}
      animationType="none"
      transparent
      onRequestClose={handleAcknowledge}
    >
      <View style={styles.backdrop}>
        {/* Animated Dim Backdrop */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0, 0, 0, 0.82)', opacity: fadeAnim },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss privacy notice"
            style={StyleSheet.absoluteFill}
            onPress={handleAcknowledge}
          />
        </Animated.View>

        {/* Modal Card Sheet */}
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.borderDark,
              paddingBottom: Math.max(insets.bottom, 16) + 12,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Top Drag Handle */}
          <View style={styles.topHandleBar}>
            <View style={[styles.dragHandle, { backgroundColor: colors.border }]} />
          </View>

          {/* Tactical Header Badge */}
          <View style={styles.headerRow}>
            <View style={styles.statusTag}>
              <View style={[styles.pulseDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.statusTagText, { color: colors.primary }]}>
                TACTICAL HUD // PRIVACY DIRECTIVE
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close Privacy Directive"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={handleAcknowledge}
              style={[
                styles.closeBtn,
                { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)' },
              ]}
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Title & Shield Icon */}
            <View style={styles.heroSection}>
              <View style={[styles.iconShieldBox, { borderColor: colors.primary, backgroundColor: 'rgba(163, 230, 53, 0.12)' }]}>
                <Ionicons name="shield-checkmark" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>
                Privacy Defaults Active
              </Text>
              <Text style={[styles.subtitle, { color: colors.textMuted }]}>
                To streamline live operative discovery, multiplayer lobbies, and squad coordination, all privacy features are enabled by default for your profile.
              </Text>
            </View>

            {/* List of active features */}
            <View style={[styles.featureList, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: colors.borderDark }]}>
              <View style={styles.featureItem}>
                <Ionicons name="radio-outline" size={18} color={colors.primary} style={styles.featureIcon} />
                <View style={styles.featureTextCol}>
                  <Text style={[styles.featureTitle, { color: colors.text }]}>Live Presence & Radar</Text>
                  <Text style={[styles.featureDesc, { color: colors.textMuted }]}>Allows mutual squad friends to see when you are online and hosting matches.</Text>
                </View>
                <View style={[styles.activeTag, { backgroundColor: 'rgba(163, 230, 53, 0.15)', borderColor: colors.primary }]}>
                  <Text style={[styles.activeTagText, { color: colors.primary }]}>ON</Text>
                </View>
              </View>

              <View style={[styles.featureDivider, { backgroundColor: colors.borderDark }]} />

              <View style={styles.featureItem}>
                <Ionicons name="person-add-outline" size={18} color={colors.primary} style={styles.featureIcon} />
                <View style={styles.featureTextCol}>
                  <Text style={[styles.featureTitle, { color: colors.text }]}>Friend Requests & Invites</Text>
                  <Text style={[styles.featureDesc, { color: colors.textMuted }]}>Enables other operatives to search your codename or scan your QR code.</Text>
                </View>
                <View style={[styles.activeTag, { backgroundColor: 'rgba(163, 230, 53, 0.15)', borderColor: colors.primary }]}>
                  <Text style={[styles.activeTagText, { color: colors.primary }]}>ON</Text>
                </View>
              </View>

              <View style={[styles.featureDivider, { backgroundColor: colors.borderDark }]} />

              <View style={styles.featureItem}>
                <Ionicons name="git-branch-outline" size={18} color={colors.primary} style={styles.featureIcon} />
                <View style={styles.featureTextCol}>
                  <Text style={[styles.featureTitle, { color: colors.text }]}>Ghost Route Contributions</Text>
                  <Text style={[styles.featureDesc, { color: colors.textMuted }]}>Contributes trimmed, anonymous routes to the Ghost Library for solo runs.</Text>
                </View>
                <View style={[styles.activeTag, { backgroundColor: 'rgba(163, 230, 53, 0.15)', borderColor: colors.primary }]}>
                  <Text style={[styles.activeTagText, { color: colors.primary }]}>ON</Text>
                </View>
              </View>

              <View style={[styles.featureDivider, { backgroundColor: colors.borderDark }]} />

              <View style={styles.featureItem}>
                <Ionicons name="trophy-outline" size={18} color={colors.primary} style={styles.featureIcon} />
                <View style={styles.featureTextCol}>
                  <Text style={[styles.featureTitle, { color: colors.text }]}>Echo Score & Leaderboards</Text>
                  <Text style={[styles.featureDesc, { color: colors.textMuted }]}>Displays your tactical rank on seasonal and friends leaderboards.</Text>
                </View>
                <View style={[styles.activeTag, { backgroundColor: 'rgba(163, 230, 53, 0.15)', borderColor: colors.primary }]}>
                  <Text style={[styles.activeTagText, { color: colors.primary }]}>ON</Text>
                </View>
              </View>
            </View>

            {/* Tactical Control Reassurance Notice */}
            <View style={[styles.noticeCard, { backgroundColor: 'rgba(234, 179, 8, 0.08)', borderColor: TACTICAL_GOLD.border }]}>
              <Ionicons name="information-circle-outline" size={20} color={TACTICAL_GOLD.primary} style={{ marginTop: 1 }} />
              <Text style={[styles.noticeText, { color: colors.text }]}>
                <Text style={{ fontWeight: '700', color: TACTICAL_GOLD.primary }}>Tactical Control: </Text>
                You can change, customize, or disable any of your privacy settings at any time in <Text style={{ fontWeight: '700' }}>Settings &gt; Privacy</Text>.
              </Text>
            </View>

            {/* OK Button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Acknowledge and proceed"
              onPress={handleAcknowledge}
              style={({ pressed }) => [
                styles.okButton,
                { backgroundColor: colors.primary },
                pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
              ]}
            >
              <Text style={styles.okButtonText}>OK, UNDERSTOOD</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    maxHeight: '90%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  topHandleBar: {
    alignItems: 'center',
    marginBottom: 8,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  statusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 12,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusTagText: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 10,
    letterSpacing: 1.1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 16,
  },
  heroSection: {
    alignItems: 'center',
    marginVertical: 8,
  },
  iconShieldBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontFamily: 'Archivo-Black',
    fontSize: 20,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  featureList: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginVertical: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  featureIcon: {
    marginTop: 2,
  },
  featureTextCol: {
    flex: 1,
  },
  featureTitle: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 13,
    marginBottom: 2,
  },
  featureDesc: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    lineHeight: 15,
  },
  activeTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  activeTagText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  featureDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 4,
  },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginVertical: 10,
  },
  noticeText: {
    flex: 1,
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  okButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 6,
  },
  okButtonText: {
    fontFamily: 'Archivo-Black',
    fontSize: 14,
    color: '#0A0A0C',
    letterSpacing: 1,
  },
});

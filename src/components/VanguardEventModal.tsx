import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useUserStore } from '../stores/userStore';
import { triggerHaptic } from '../motion/haptics';

interface VanguardEventModalProps {
  visible: boolean;
  onClose: () => void;
}

export function VanguardEventModal({ visible, onClose }: VanguardEventModalProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const profile = useUserStore((s) => s.profile);
  const setProfile = useUserStore((s) => s.setProfile);

  const [activating, setActivating] = useState(false);
  const isVanguard = Boolean(profile?.is_vanguard);

  const displayName = profile?.display_name || 'Operative';
  const initial = displayName[0]?.toUpperCase() || 'A';
  const signatureColor = profile?.color || colors.primary;

  const handleActivate = async () => {
    triggerHaptic('tagConfirmed');
    setActivating(true);

    // Simulate instant secure activation & persistence
    setTimeout(() => {
      setProfile({
        display_name: displayName,
        color: signatureColor,
        is_vanguard: true,
      });
      setActivating(false);
      triggerHaptic('tagConfirmed');
    }, 600);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.borderDark,
              paddingBottom: Math.max(insets.bottom, 20) + 12,
            },
          ]}
        >
          {/* Header Bar */}
          <View style={styles.topHandleBar}>
            <View style={[styles.dragHandle, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.headerRow}>
            <View style={styles.classificationTag}>
              <View style={[styles.liveDot, { backgroundColor: colors.accent }]} />
              <Text style={[styles.classificationText, { color: colors.accent }]}>
                SEASON 1 LAUNCH EVENT · 14 DAYS LEFT
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => {
                triggerHaptic('buttonTap');
                onClose();
              }}
              style={[styles.closeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}
            >
              <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Vanguard Tactical Insignia */}
            <View style={styles.heroInsigniaWrap}>
              <View
                style={[
                  styles.insigniaPill,
                  {
                    borderColor: colors.accent,
                    backgroundColor: isDark ? 'rgba(184, 163, 255, 0.12)' : 'rgba(102, 80, 164, 0.08)',
                  },
                ]}
              >
                <Ionicons name="shield-checkmark" size={18} color={colors.accent} />
                <Text style={[styles.insigniaText, { color: colors.accent }]}>
                  VANGUARD
                </Text>
              </View>

              <Text style={[styles.heroTitle, { color: colors.text }]}>
                Vanguard Protocol
              </Text>
              <Text style={[styles.heroSubtitle, { color: colors.textMuted }]}>
                Deploy during Season 1 to permanently claim Founding Operative clearance. The VANGUARD insignia sits beside your callsign forever. After this window closes, no new operatives can ever receive it.
              </Text>
            </View>

            {/* Visual Preview: How Squads Will See You */}
            <View style={styles.previewSection}>
              <Text style={[styles.previewSectionHeader, { color: colors.textMuted }]}>
                HOW SQUADS WILL IDENTIFY YOU
              </Text>

              <View
                style={[
                  styles.previewCard,
                  {
                    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.65)',
                    borderColor: colors.borderDark,
                  },
                ]}
              >
                {/* Lobby Row Preview */}
                <View style={styles.previewRow}>
                  <Text style={[styles.previewRowLabel, { color: colors.textMuted }]}>
                    In every lobby
                  </Text>
                  <View style={styles.operativePreviewBadge}>
                    <View style={[styles.miniAvatar, { backgroundColor: signatureColor }]}>
                      <Text style={styles.miniAvatarText}>{initial}</Text>
                    </View>
                    <Text style={[styles.previewName, { color: colors.text }]} numberOfLines={1}>
                      {displayName}
                    </Text>
                    <View style={[styles.tagBadgePill, { borderColor: colors.accent }]}>
                      <Text style={[styles.tagBadgePillText, { color: colors.accent }]}>
                        VANGUARD
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={[styles.previewDivider, { backgroundColor: colors.borderDark }]} />

                {/* Profile Dossier Preview */}
                <View style={styles.previewRow}>
                  <Text style={[styles.previewRowLabel, { color: colors.textMuted }]}>
                    On your profile
                  </Text>
                  <View style={styles.operativePreviewBadge}>
                    <Text style={[styles.previewName, { color: colors.text }]}>
                      @{displayName.toUpperCase()}
                    </Text>
                    <View style={[styles.tagBadgePill, { borderColor: colors.accent }]}>
                      <Text style={[styles.tagBadgePillText, { color: colors.accent }]}>
                        VANGUARD
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={[styles.previewDivider, { backgroundColor: colors.borderDark }]} />

                {/* Leaderboard Preview */}
                <View style={styles.previewRow}>
                  <Text style={[styles.previewRowLabel, { color: colors.textMuted }]}>
                    On Leaderboard
                  </Text>
                  <View style={styles.operativePreviewBadge}>
                    <Text style={[styles.previewName, { color: colors.text }]}>
                      @{displayName.toUpperCase()}
                    </Text>
                    <View style={[styles.tagBadgePill, { borderColor: colors.accent }]}>
                      <Text style={[styles.tagBadgePillText, { color: colors.accent }]}>
                        VANGUARD
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>

            {/* Tactical Clearances Included */}
            <View style={styles.clearanceList}>
              <View style={styles.clearanceItem}>
                <Ionicons name="infinite-outline" size={18} color={colors.primary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.clearanceTitle, { color: colors.text }]}>
                    Unlimited Tactical Hosting
                  </Text>
                  <Text style={[styles.clearanceDesc, { color: colors.textMuted }]}>
                    Host private and competitive arenas of any squad size up to 20 operatives forever.
                  </Text>
                </View>
              </View>

              <View style={styles.clearanceItem}>
                <Ionicons name="people-outline" size={18} color={colors.primary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.clearanceTitle, { color: colors.text }]}>
                    Zero-Cost Squad Access
                  </Text>
                  <Text style={[styles.clearanceDesc, { color: colors.textMuted }]}>
                    Your friends deploy 100% free into your lobbies with your 4-letter room code.
                  </Text>
                </View>
              </View>

              <View style={styles.clearanceItem}>
                <Ionicons name="radio-outline" size={18} color={colors.primary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.clearanceTitle, { color: colors.text }]}>
                    Founder's Radar Wave
                  </Text>
                  <Text style={[styles.clearanceDesc, { color: colors.textMuted }]}>
                    Exclusive tactical radar wave signature visible during ping and detection cycles.
                  </Text>
                </View>
              </View>
            </View>

            {/* CTA Button */}
            {isVanguard ? (
              <View
                style={[
                  styles.activeBadgeBanner,
                  {
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    borderColor: colors.success,
                  },
                ]}
              >
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={[styles.activeBadgeText, { color: colors.success }]}>
                  VANGUARD CLEARANCE ACTIVE · FOUNDING OPERATIVE
                </Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Activate Vanguard Clearance"
                onPress={() => void handleActivate()}
                disabled={activating}
                style={({ pressed }) => [
                  styles.ctaButton,
                  { backgroundColor: colors.primary },
                  pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                ]}
              >
                <Text style={[styles.ctaButtonText, { color: colors.primaryText }]}>
                  {activating ? 'Authorizing Clearance…' : 'Activate Vanguard · ₹790.00'}
                </Text>
                <Text style={[styles.ctaSubtext, { color: colors.primaryText }]}>
                  One-time operative authorization · No subscription
                </Text>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss for now"
              onPress={() => {
                triggerHaptic('buttonTap');
                onClose();
              }}
              style={styles.notNowBtn}
            >
              <Text style={[styles.notNowText, { color: colors.textMuted }]}>
                {isVanguard ? 'Close Briefing' : 'Stand Down For Now'}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    maxHeight: '90%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  topHandleBar: {
    alignItems: 'center',
    paddingVertical: 4,
    marginBottom: 6,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  classificationTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  classificationText: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  heroInsigniaWrap: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  insigniaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 14,
  },
  insigniaText: {
    fontFamily: 'Archivo-Black',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  heroTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  previewSection: {
    marginTop: 18,
    marginBottom: 18,
  },
  previewSectionHeader: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
    textAlign: 'center',
  },
  previewCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  previewRowLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    fontWeight: '600',
  },
  operativePreviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#000000',
    fontWeight: '900',
  },
  previewName: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    fontWeight: '700',
  },
  tagBadgePill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginLeft: 2,
  },
  tagBadgePillText: {
    fontFamily: 'Archivo-Black',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  previewDivider: {
    height: 1,
    opacity: 0.6,
  },
  clearanceList: {
    gap: 14,
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  clearanceItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  clearanceTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  clearanceDesc: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    lineHeight: 16,
  },
  ctaButton: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonText: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  ctaSubtext: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    marginTop: 2,
    opacity: 0.85,
  },
  activeBadgeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
  },
  activeBadgeText: {
    fontFamily: 'Archivo-Black',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  notNowBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  notNowText: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 13,
    fontWeight: '700',
  },
});

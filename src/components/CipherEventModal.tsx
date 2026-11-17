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

interface CipherEventModalProps {
  visible: boolean;
  onClose: () => void;
}

export function CipherEventModal({ visible, onClose }: CipherEventModalProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const profile = useUserStore((s) => s.profile);
  const setProfile = useUserStore((s) => s.setProfile);

  const [activating, setActivating] = useState(false);
  const isCipher = Boolean(profile?.is_cipher || profile?.is_vanguard);

  const displayName = profile?.display_name || 'Operative';
  const initial = displayName[0]?.toUpperCase() || 'A';
  const signatureColor = profile?.color || colors.primary;

  // Stable procedural field ID derived from display name
  const charSum = displayName.split('').reduce((acc, c) => acc + c.charCodeAt(0), 100);
  const serialNumber = (charSum % 9000) + 1000;

  const handleActivate = () => {
    triggerHaptic('tagConfirmed');
    setActivating(true);

    setTimeout(() => {
      setProfile({
        display_name: displayName,
        color: signatureColor,
        is_cipher: true,
      });
      setActivating(false);
      triggerHaptic('tagConfirmed');
    }, 500);
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
          {/* Header Bar with Safe Drag Handle & Generous Close Target */}
          <View style={styles.topHandleBar}>
            <View style={[styles.dragHandle, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.headerRow}>
            <View style={styles.statusTag}>
              <View style={[styles.pulseDot, { backgroundColor: colors.accent }]} />
              <Text style={[styles.statusTagText, { color: colors.accent }]}>
                TACTICAL HUD // CLASSIFIED ACCESS
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close Tactical Briefing"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Title & Gimmick Briefing */}
            <View style={styles.heroSection}>
              <View
                style={[
                  styles.cipherPill,
                  {
                    borderColor: colors.accent,
                    backgroundColor: isDark
                      ? 'rgba(234, 179, 8, 0.12)'
                      : 'rgba(202, 138, 4, 0.08)',
                  },
                ]}
              >
                <Ionicons name="radio" size={15} color={colors.accent} style={{ marginRight: 5 }} />
                <Text style={[styles.cipherPillText, { color: colors.accent }]}>
                  CIPHER PROTOCOL
                </Text>
              </View>

              <Text style={[styles.heroTitle, { color: colors.text }]}>
                Project Ghost Cipher
              </Text>
              <Text style={[styles.heroSubtitle, { color: colors.textMuted }]}>
                Season 1 Founding Operative clearance. Calibrate your tactical transponder during the 14-day launch window to permanently claim custom radar camouflage and priority access to prototype combat mutators.
              </Text>
            </View>

            {/* Tactical Cyber Dossier Card (Original GhostRun ID - NOT Scram's 3 text lines) */}
            <View
              style={[
                styles.dossierCard,
                {
                  backgroundColor: isDark ? 'rgba(0, 0, 0, 0.40)' : 'rgba(255, 255, 255, 0.70)',
                  borderColor: colors.accent,
                },
              ]}
            >
              {/* Dossier Header */}
              <View style={styles.dossierHeader}>
                <View style={styles.dossierHeaderLeft}>
                  <Ionicons name="shield-checkmark" size={13} color={colors.accent} />
                  <Text style={[styles.dossierOrgText, { color: colors.accent }]}>
                    GHOSTRUN TACTICAL CORPS
                  </Text>
                </View>
                <View
                  style={[
                    styles.dossierClearanceBadge,
                    {
                      borderColor: colors.accent,
                      backgroundColor: isDark ? 'rgba(234, 179, 8, 0.18)' : 'rgba(202, 138, 4, 0.12)',
                    },
                  ]}
                >
                  <Text style={[styles.dossierClearanceText, { color: colors.accent }]}>
                    CIPHER-01
                  </Text>
                </View>
              </View>

              {/* Operative Identity Row */}
              <View style={styles.dossierIdentityRow}>
                <View style={[styles.operativeAvatar, { backgroundColor: signatureColor }]}>
                  <Text style={styles.operativeAvatarText}>{initial}</Text>
                  <View style={[styles.avatarStatusRing, { borderColor: colors.accent }]} />
                </View>

                <View style={styles.operativeDetails}>
                  <View style={styles.codenameRow}>
                    <Text style={[styles.dossierCodename, { color: colors.text }]} numberOfLines={1}>
                      @{displayName.toUpperCase()}
                    </Text>
                    <View
                      style={[
                        styles.inlineCipherBadge,
                        { borderColor: colors.accent, backgroundColor: 'rgba(234, 179, 8, 0.15)' },
                      ]}
                    >
                      <Ionicons name="radio" size={9} color={colors.accent} style={{ marginRight: 3 }} />
                      <Text style={[styles.inlineCipherBadgeText, { color: colors.accent }]}>
                        CIPHER
                      </Text>
                    </View>
                  </View>

                  <Text style={[styles.dossierSerial, { color: colors.textMuted }]}>
                    SERIAL: GR-OP-{serialNumber} · FOUNDING OPERATIVE
                  </Text>
                </View>
              </View>

              {/* Live Radar Scope Simulation Graphic (Direct Gameplay Tie-In) */}
              <View
                style={[
                  styles.radarScopeBox,
                  {
                    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.05)',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.08)',
                  },
                ]}
              >
                <View style={styles.radarVisualRow}>
                  {/* Concentric Radar Wave Graphic */}
                  <View style={styles.radarWavesContainer}>
                    <View style={[styles.radarCircleOuter, { borderColor: colors.accent }]} />
                    <View style={[styles.radarCircleMid, { borderColor: colors.accent }]} />
                    <View style={[styles.radarCenterBlip, { backgroundColor: colors.accent }]} />
                  </View>

                  <View style={styles.radarDetailsCol}>
                    <View style={styles.radarStatusLine}>
                      <View style={[styles.pulseDot, { backgroundColor: colors.accent }]} />
                      <Text style={[styles.radarStatusTitle, { color: colors.text }]}>
                        Gold Radar Pulse Waveform
                      </Text>
                    </View>
                    <Text style={[styles.radarStatusSub, { color: colors.textMuted }]}>
                      Custom gold wave signature emitted across all squad GPS radars during sweeps.
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Tactical Protocol Clearances (Distinct GhostRun Capabilities) */}
            <View style={styles.perksContainer}>
              <Text style={[styles.perksHeader, { color: colors.textMuted }]}>
                CLEARANCES INCLUDED WITH CIPHER TRANSPONDER
              </Text>

              {/* Perk 1: Radar Signature */}
              <View style={styles.perkCard}>
                <View
                  style={[
                    styles.perkIconBox,
                    {
                      borderColor: colors.accent,
                      backgroundColor: isDark ? 'rgba(234, 179, 8, 0.12)' : 'rgba(202, 138, 4, 0.08)',
                    },
                  ]}
                >
                  <Ionicons name="radio-outline" size={18} color={colors.accent} />
                </View>
                <View style={styles.perkTextCol}>
                  <Text style={[styles.perkTitle, { color: colors.text }]}>
                    Tactical Radar Signature
                  </Text>
                  <Text style={[styles.perkDescription, { color: colors.textMuted }]}>
                    Your position pulses with an exclusive translucent gold ripple on live hunter and runner field maps.
                  </Text>
                </View>
              </View>

              {/* Perk 2: Experimental Mutators */}
              <View style={styles.perkCard}>
                <View
                  style={[
                    styles.perkIconBox,
                    {
                      borderColor: colors.accent,
                      backgroundColor: isDark ? 'rgba(234, 179, 8, 0.12)' : 'rgba(202, 138, 4, 0.08)',
                    },
                  ]}
                >
                  <Ionicons name="hardware-chip-outline" size={18} color={colors.accent} />
                </View>
                <View style={styles.perkTextCol}>
                  <Text style={[styles.perkTitle, { color: colors.text }]}>
                    Prototype Mutator Access
                  </Text>
                  <Text style={[styles.perkDescription, { color: colors.textMuted }]}>
                    Priority clearance to host arenas with experimental modifiers (Phantom Sprint, EMP Bursts, Decoy Beacons).
                  </Text>
                </View>
              </View>

              {/* Perk 3: Unrestricted Arenas */}
              <View style={styles.perkCard}>
                <View
                  style={[
                    styles.perkIconBox,
                    {
                      borderColor: colors.accent,
                      backgroundColor: isDark ? 'rgba(234, 179, 8, 0.12)' : 'rgba(202, 138, 4, 0.08)',
                    },
                  ]}
                >
                  <Ionicons name="globe-outline" size={18} color={colors.accent} />
                </View>
                <View style={styles.perkTextCol}>
                  <Text style={[styles.perkTitle, { color: colors.text }]}>
                    Unrestricted Squad Operations
                  </Text>
                  <Text style={[styles.perkDescription, { color: colors.textMuted }]}>
                    Host private and competitive arenas up to 20 operatives forever with custom GPS boundaries.
                  </Text>
                </View>
              </View>
            </View>

            {/* Action Section */}
            <View style={styles.actionContainer}>
              {isCipher ? (
                <View
                  style={[
                    styles.activatedButton,
                    {
                      borderColor: colors.accent,
                      backgroundColor: isDark ? 'rgba(234, 179, 8, 0.15)' : 'rgba(202, 138, 4, 0.10)',
                    },
                  ]}
                >
                  <Ionicons name="checkmark-circle" size={18} color={colors.accent} style={{ marginRight: 6 }} />
                  <Text style={[styles.activatedButtonText, { color: colors.accent }]}>
                    CIPHER CLEARANCE ACTIVE
                  </Text>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Calibrate Cipher Transponder"
                  onPress={handleActivate}
                  disabled={activating}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: colors.accent,
                      opacity: activating ? 0.7 : pressed ? 0.92 : 1,
                      transform: [{ scale: pressed ? 0.985 : 1 }],
                    },
                  ]}
                >
                  <Ionicons name="radio" size={18} color="#000000" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryButtonText}>
                    {activating ? 'CALIBRATING...' : 'CALIBRATE TRANSPONDER'}
                  </Text>
                </Pressable>
              )}

              <Text style={[styles.finePrint, { color: colors.textMuted }]}>
                {isCipher
                  ? 'Transponder calibrated. [CIPHER] insignia active on your tactical dossier.'
                  : 'Season 1 Operative window · One-time calibration · Free launch clearance'}
              </Text>
            </View>
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
    maxHeight: '92%',
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
    marginBottom: 16,
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
    fontWeight: '800',
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
    paddingBottom: 24,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  cipherPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 12,
  },
  cipherPillText: {
    fontFamily: 'Archivo-Black',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  heroTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  dossierCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 22,
  },
  dossierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 14,
  },
  dossierHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dossierOrgText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  dossierClearanceBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  dossierClearanceText: {
    fontFamily: 'Archivo-Black',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  dossierIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  operativeAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarStatusRing: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  operativeAvatarText: {
    fontFamily: 'Archivo-Black',
    fontSize: 18,
    fontWeight: '900',
    color: '#000000',
  },
  operativeDetails: {
    flex: 1,
  },
  codenameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  dossierCodename: {
    fontFamily: 'Archivo-Bold',
    fontSize: 16,
    fontWeight: '800',
  },
  inlineCipherBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  inlineCipherBadgeText: {
    fontFamily: 'Archivo-Black',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  dossierSerial: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  radarScopeBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  radarVisualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  radarWavesContainer: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  radarCircleOuter: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    opacity: 0.35,
  },
  radarCircleMid: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    opacity: 0.7,
  },
  radarCenterBlip: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  radarDetailsCol: {
    flex: 1,
  },
  radarStatusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  radarStatusTitle: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 12,
    fontWeight: '700',
  },
  radarStatusSub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    lineHeight: 15,
  },
  perksContainer: {
    marginBottom: 22,
  },
  perksHeader: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginBottom: 12,
  },
  perkCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  perkIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  perkTextCol: {
    flex: 1,
  },
  perkTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  perkDescription: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  actionContainer: {
    alignItems: 'center',
  },
  primaryButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 14,
    marginBottom: 10,
  },
  primaryButtonText: {
    fontFamily: 'Archivo-Black',
    fontSize: 14,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.8,
  },
  activatedButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 10,
  },
  activatedButtonText: {
    fontFamily: 'Archivo-Black',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  finePrint: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    textAlign: 'center',
  },
});

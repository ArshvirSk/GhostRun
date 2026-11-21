import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import { useDialogModalAnimation } from '../motion';
import { generateQrBmpDataUrl } from '../lib/qrCache';
import type { LngLat } from '../lib/geo';
import {
  computeGloryHeadline,
  formatStoryCardMetrics,
  generateStorySvgPath,
  generateStoryShareText,
} from '../lib/storyCardCore';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Strict 9:16 ratio dimensions
const TARGET_ASPECT = 9 / 16; // 0.5625
const CARD_HEIGHT = Math.min(Math.round(SCREEN_HEIGHT * 0.72), 560);
const CARD_WIDTH = Math.round(CARD_HEIGHT * TARGET_ASPECT);

export interface StoryCardExportModalProps {
  visible: boolean;
  onClose: () => void;
  gameId: string;
  gameCode?: string;
  modeName: string;
  role: string;
  outcome: 'victorious' | 'completed' | 'tagged' | 'evaded' | 'defeated';
  durationSeconds: number;
  distanceMeters: number;
  peakSpeedMps?: number;
  opponentCount?: number;
  capturesCount?: number;
  isPatientZero?: boolean;
  rawTrailPoints?: LngLat[];
  shareTrailConsent?: boolean;
  displayName?: string;
}

export function StoryCardExportModal({
  visible,
  onClose,
  gameCode = '',
  modeName,
  role,
  outcome,
  durationSeconds,
  distanceMeters,
  peakSpeedMps,
  opponentCount = 1,
  capturesCount = 0,
  isPatientZero = false,
  rawTrailPoints = [],
  shareTrailConsent = true,
  displayName = 'OPERATIVE',
}: StoryCardExportModalProps) {
  const { colors, radii, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const cardRef = useRef<any>(null);
  const [sharing, setSharing] = useState(false);
  const { mounted, fadeAnim, scaleAnim, handleClose } = useDialogModalAnimation(visible, onClose);

  // Glory headline and tactical badges
  const glory = useMemo(() => {
    return computeGloryHeadline({
      mode: modeName,
      role,
      outcome,
      durationSeconds,
      distanceMeters,
      opponentCount,
      capturesCount,
      isPatientZero,
    });
  }, [modeName, role, outcome, durationSeconds, distanceMeters, opponentCount, capturesCount, isPatientZero]);

  // Formatted metric triad
  const metrics = useMemo(() => {
    return formatStoryCardMetrics({
      distanceMeters,
      durationSeconds,
      peakSpeedMps,
    });
  }, [distanceMeters, durationSeconds, peakSpeedMps]);

  // Route viewport dimensions
  const routeBoxWidth = CARD_WIDTH - 32;
  const routeBoxHeight = Math.round(CARD_HEIGHT * 0.36);

  // Privacy-trimmed normalized route points
  const routeData = useMemo(() => {
    if (!shareTrailConsent) {
      return {
        hasValidTrail: false,
        reason: 'Route confidential (consent C3 respected).',
        points: [],
        startPoint: null,
        endPoint: null,
        svgPath: '',
        originalDistanceM: 0,
        trimmedDistanceM: 0,
      };
    }
    return generateStorySvgPath(rawTrailPoints, routeBoxWidth, routeBoxHeight, 20);
  }, [rawTrailPoints, shareTrailConsent, routeBoxWidth, routeBoxHeight]);

  // Invite URL and pure JS QR Code data URI
  const inviteUrl = gameCode ? `https://ghostrun.app/join/${gameCode}` : 'https://ghostrun.app';
  const qrUri = useMemo(() => {
    if (!visible) return null;
    return generateQrBmpDataUrl(inviteUrl, {
      moduleScale: 3,
      margin: 1,
    });
  }, [visible, inviteUrl]);

  // Capture 9:16 Card Image
  const captureCardImage = async (): Promise<string | null> => {
    try {
      if (!cardRef.current) return null;
      return await captureRef(cardRef.current, {
        format: 'png',
        quality: 0.95,
      });
    } catch {
      return null;
    }
  };

  // One-Tap Share Action
  const handleShareStory = async () => {
    if (sharing) return;
    triggerHaptic('buttonTap');
    setSharing(true);

    const shareText = generateStoryShareText({
      headline: glory.title,
      subtitle: glory.subtitle,
      modeName,
      role,
      durationSeconds,
      distanceMeters,
      code: gameCode,
      roomUrl: inviteUrl,
    });

    try {
      const imgUri = await captureCardImage();
      const isAvailable = await Sharing.isAvailableAsync();
      if (imgUri && isAvailable) {
        await Sharing.shareAsync(imgUri, {
          mimeType: 'image/png',
          dialogTitle: `GhostRun // ${glory.title}`,
        });
        setSharing(false);
        return;
      }
    } catch {
      // Fall through to text share
    }

    try {
      await Share.share({
        title: `GhostRun // ${glory.title}`,
        message: shareText,
        url: inviteUrl,
      });
    } catch {
      // Cancelled by user
    } finally {
      setSharing(false);
    }
  };

  // Render path line segments connecting consecutive points
  const renderPathSegments = () => {
    if (!routeData.hasValidTrail || routeData.points.length < 2) return null;
    const segments: React.JSX.Element[] = [];

    for (let i = 0; i < routeData.points.length - 1; i++) {
      const p1 = routeData.points[i];
      const p2 = routeData.points[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.5) continue;

      const angleRad = Math.atan2(dy, dx);
      const angleDeg = (angleRad * 180) / Math.PI;

      // Midpoint-based positioning
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      segments.push(
        <View
          key={`seg-${i}`}
          style={{
            position: 'absolute',
            left: midX - length / 2,
            top: midY - 1,
            width: length,
            height: 2.2,
            backgroundColor: glory.badgeColor === '#EF4444' ? colors.danger : colors.accent,
            transform: [{ rotate: `${angleDeg}deg` }],
          }}
        />
      );
    }

    return segments;
  };

  return (
    <Modal animationType="none" onRequestClose={handleClose} transparent visible={mounted}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(5, 7, 12, 0.88)', opacity: fadeAnim },
          ]}
        />
        <Pressable onPress={handleClose} style={StyleSheet.absoluteFill} />

        <Animated.View
          style={[
            styles.modalContainer,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Top Actions Header */}
          <View style={styles.topBar}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons color={colors.accent} name="phone-portrait-outline" size={16} />
              <Text
                variant="label"
                style={{ color: colors.accent, marginLeft: 6, letterSpacing: 1.5, fontSize: 11 }}
              >
                9:16 STORY EXPORT
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close story modal"
              accessibilityRole="button"
              onPress={handleClose}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceElevated }]}
            >
              <Ionicons color={colors.textMuted} name="close" size={18} />
            </Pressable>
          </View>

          {/* Scrollable container for preview on smaller displays */}
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* The 9:16 Story Canvas (Screen-Shot Target) */}
            <View
              collapsable={false}
              ref={cardRef}
              style={[
                styles.storyCard,
                {
                  width: CARD_WIDTH,
                  height: CARD_HEIGHT,
                  backgroundColor: '#080C14',
                  borderColor: glory.badgeColor,
                  borderRadius: radii.md,
                },
              ]}
            >
              {/* Header Branding */}
              <View style={styles.cardHeader}>
                <View>
                  <Text
                    variant="caption"
                    style={{
                      color: colors.accent,
                      letterSpacing: 2,
                      fontSize: 10,
                      fontWeight: '800',
                    }}
                  >
                    GHOSTRUN // TACTICAL
                  </Text>
                  <Text variant="caption" style={{ color: colors.textMuted, fontSize: 9 }}>
                    STORY DISPATCH
                  </Text>
                </View>

                {gameCode ? (
                  <View style={[styles.codeBadge, { borderColor: colors.borderDark }]}>
                    <Text
                      variant="caption"
                      style={{ color: colors.textLight, fontWeight: '700', fontSize: 10 }}
                    >
                      #{gameCode}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Dynamic Glory Badge & Headline */}
              <View style={styles.glorySection}>
                <View
                  style={[
                    styles.badgePill,
                    {
                      borderColor: glory.badgeColor,
                      backgroundColor: `${glory.badgeColor}22`,
                    },
                  ]}
                >
                  <Text
                    variant="caption"
                    style={{
                      color: glory.badgeColor,
                      letterSpacing: 1.5,
                      fontWeight: '900',
                      fontSize: 10,
                    }}
                  >
                    {glory.badge}
                  </Text>
                </View>

                <Text
                  numberOfLines={2}
                  style={[styles.gloryTitle, { color: colors.textLight }]}
                  variant="headline"
                >
                  {glory.title}
                </Text>

                <Text
                  numberOfLines={2}
                  style={[styles.glorySubtitle, { color: colors.textMuted }]}
                  variant="caption"
                >
                  {glory.subtitle}
                </Text>
              </View>

              {/* Tactical Route Radar Box */}
              <View
                style={[
                  styles.routeBox,
                  {
                    width: routeBoxWidth,
                    height: routeBoxHeight,
                    backgroundColor: '#05070D',
                    borderColor: 'rgba(0, 240, 255, 0.2)',
                  },
                ]}
              >
                {/* Radar Grid Circles */}
                <View
                  style={[
                    styles.radarRing,
                    {
                      width: routeBoxHeight * 0.85,
                      height: routeBoxHeight * 0.85,
                      borderRadius: (routeBoxHeight * 0.85) / 2,
                      borderColor: 'rgba(0, 240, 255, 0.08)',
                    },
                  ]}
                />
                <View
                  style={[
                    styles.radarRing,
                    {
                      width: routeBoxHeight * 0.45,
                      height: routeBoxHeight * 0.45,
                      borderRadius: (routeBoxHeight * 0.45) / 2,
                      borderColor: 'rgba(0, 240, 255, 0.12)',
                    },
                  ]}
                />
                {/* Crosshairs */}
                <View style={styles.radarCrosshairH} />
                <View style={styles.radarCrosshairV} />

                {/* Render Path or Classified Radar Notice */}
                {routeData.hasValidTrail ? (
                  <>
                    {renderPathSegments()}

                    {/* Start Beacon */}
                    {routeData.startPoint && (
                      <View
                        style={[
                          styles.beaconPoint,
                          {
                            left: routeData.startPoint.x - 5,
                            top: routeData.startPoint.y - 5,
                            backgroundColor: colors.primary,
                            borderColor: '#FFFFFF',
                          },
                        ]}
                      />
                    )}

                    {/* End Beacon */}
                    {routeData.endPoint && (
                      <View
                        style={[
                          styles.beaconPoint,
                          {
                            left: routeData.endPoint.x - 5,
                            top: routeData.endPoint.y - 5,
                            backgroundColor: glory.badgeColor === '#EF4444' ? colors.danger : colors.accent,
                            borderColor: '#FFFFFF',
                          },
                        ]}
                      />
                    )}

                    {/* Shield Buffer Tag */}
                    <View style={styles.shieldBadge}>
                      <Ionicons color={colors.primary} name="shield-checkmark" size={10} />
                      <Text
                        variant="caption"
                        style={{ color: colors.primary, fontSize: 8, marginLeft: 4, fontWeight: '700' }}
                      >
                        150M ORIGIN BUFFER SHIELDED
                      </Text>
                    </View>
                  </>
                ) : (
                  <View style={styles.classifiedBox}>
                    <Ionicons color={colors.accent} name="shield-outline" size={24} />
                    <Text
                      variant="caption"
                      style={{
                        color: colors.accent,
                        fontSize: 9,
                        letterSpacing: 1.2,
                        marginTop: 4,
                        textAlign: 'center',
                        fontWeight: '700',
                      }}
                    >
                      CLASSIFIED TACTICAL ROUTE
                    </Text>
                    <Text
                      variant="caption"
                      style={{ color: colors.textMuted, fontSize: 8, marginTop: 2, textAlign: 'center' }}
                    >
                      Origin & extraction vectors protected (NF-10)
                    </Text>
                  </View>
                )}
              </View>

              {/* Tactical Triad Metrics */}
              <View style={[styles.triadRow, { borderColor: colors.borderDark }]}>
                <View style={styles.triadCol}>
                  <Text variant="caption" style={{ color: colors.textMuted, fontSize: 9 }}>
                    DISTANCE
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textLight, fontWeight: '800', fontSize: 13, marginTop: 1 }}
                  >
                    {metrics.distanceFormatted}
                  </Text>
                </View>

                <View style={[styles.triadDivider, { backgroundColor: colors.borderDark }]} />

                <View style={styles.triadCol}>
                  <Text variant="caption" style={{ color: colors.textMuted, fontSize: 9 }}>
                    DURATION
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.textLight, fontWeight: '800', fontSize: 13, marginTop: 1 }}
                  >
                    {metrics.durationFormatted}
                  </Text>
                </View>

                <View style={[styles.triadDivider, { backgroundColor: colors.borderDark }]} />

                <View style={styles.triadCol}>
                  <Text variant="caption" style={{ color: colors.textMuted, fontSize: 9 }}>
                    PEAK SPEED
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: colors.accent, fontWeight: '800', fontSize: 13, marginTop: 1 }}
                  >
                    {metrics.speedFormatted}
                  </Text>
                </View>
              </View>

              {/* Operative & QR Invite Pod */}
              <View style={styles.bottomPod}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text
                    numberOfLines={1}
                    style={{ color: colors.textLight, fontWeight: '800', fontSize: 11 }}
                    variant="caption"
                  >
                    AGENT: {displayName.toUpperCase()}
                  </Text>
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: 9,
                      marginTop: 1,
                      letterSpacing: 0.5,
                    }}
                    variant="caption"
                  >
                    ROLE: {role.toUpperCase()}
                  </Text>
                  <Text
                    style={{
                      color: colors.primary,
                      fontSize: 8,
                      marginTop: 4,
                      letterSpacing: 1,
                      fontWeight: '700',
                    }}
                    variant="caption"
                  >
                    SCAN QR TO INFILTRATE
                  </Text>
                </View>

                {qrUri ? (
                  <View style={[styles.qrFrame, { borderColor: colors.borderDark }]}>
                    <Image source={{ uri: qrUri }} style={{ width: 44, height: 44 }} />
                  </View>
                ) : null}
              </View>
            </View>

            {/* Modal Action Buttons */}
            <View style={[styles.actionButtons, { width: CARD_WIDTH, marginTop: spacing.md }]}>
              <Button
                accessibilityLabel="Share 9:16 vertical story card"
                loading={sharing}
                onPress={() => void handleShareStory()}
                size="md"
                title="Share Story (9:16)"
                variant="primary"
              />
              <Button
                accessibilityLabel="Dismiss story modal"
                onPress={handleClose}
                size="sm"
                title="Dismiss"
                variant="secondary"
              />
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    alignItems: 'center',
    width: '100%',
    maxHeight: '92%',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: CARD_WIDTH,
    marginBottom: 8,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: 16,
  },
  storyCard: {
    borderWidth: 1.5,
    padding: 14,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  codeBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#0F1420',
  },
  glorySection: {
    marginVertical: 4,
  },
  badgePill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
    marginBottom: 4,
  },
  gloryTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  glorySubtitle: {
    fontSize: 10,
    lineHeight: 13,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  routeBox: {
    position: 'relative',
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  radarRing: {
    position: 'absolute',
    borderWidth: 1,
  },
  radarCrosshairH: {
    position: 'absolute',
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(0, 240, 255, 0.08)',
  },
  radarCrosshairV: {
    position: 'absolute',
    height: '100%',
    width: 1,
    backgroundColor: 'rgba(0, 240, 255, 0.08)',
  },
  beaconPoint: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    zIndex: 10,
  },
  shieldBadge: {
    position: 'absolute',
    bottom: 6,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  classifiedBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  triadRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 6,
    marginVertical: 4,
  },
  triadCol: {
    alignItems: 'center',
    flex: 1,
  },
  triadDivider: {
    width: 1,
    height: 22,
  },
  bottomPod: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 4,
  },
  qrFrame: {
    borderWidth: 1,
    padding: 2,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  actionButtons: {
    gap: 8,
  },
});

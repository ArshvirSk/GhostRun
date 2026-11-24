import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PinpointScoreBreakdown } from '../modes/pinpoint/types';
import { getPinpointGradeBadge, getHeadingCompassLabel } from '../modes/pinpoint/engine';
import { triggerHaptic } from '../motion/haptics';

export interface PinpointPhotoComparisonModalProps {
  visible: boolean;
  onClose: () => void;
  roundNumber: number;
  totalRounds?: number;
  targetPhotoUrl: string;
  targetTitle?: string;
  targetHeading?: number;
  submissionPhotoUrl?: string;
  submissionHeading?: number;
  distanceErrorM: number;
  headingErrorDeg: number;
  scoreBreakdown: PinpointScoreBreakdown;
  scoutedBy?: string;
}

type ViewMode = 'side_by_side' | 'onion_skin';

export const PinpointPhotoComparisonModal: React.FC<PinpointPhotoComparisonModalProps> = ({
  visible,
  onClose,
  roundNumber,
  totalRounds = 3,
  targetPhotoUrl,
  targetTitle = 'Landmark Objective',
  targetHeading,
  submissionPhotoUrl,
  submissionHeading,
  distanceErrorM,
  headingErrorDeg,
  scoreBreakdown,
  scoutedBy,
}) => {
  const insets = useSafeAreaInsets();
  const [viewMode, setViewMode] = useState<ViewMode>('side_by_side');
  const [blendOpacity, setBlendOpacity] = useState<number>(0.5);

  const badge = getPinpointGradeBadge(scoreBreakdown.totalScore);
  const isBullseye = distanceErrorM <= 3.0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}>
        {/* Top Tactical Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => {
              triggerHaptic('buttonTap');
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="Close photo comparison modal"
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerSubtitle}>
              ROUND {roundNumber} OF {totalRounds} PERSPECTIVE AUDIT
            </Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {targetTitle.toUpperCase()}
            </Text>
          </View>

          <View style={[styles.gradePill, { backgroundColor: badge.accentColor, borderColor: badge.color }]}>
            <Text style={[styles.gradePillText, { color: badge.color }]}>
              {badge.title}
            </Text>
          </View>
        </View>

        {/* View Mode Switcher */}
        <View style={styles.modeSwitcherContainer}>
          <TouchableOpacity
            style={[
              styles.modeTab,
              viewMode === 'side_by_side' && styles.modeTabActive,
            ]}
            onPress={() => {
              triggerHaptic('buttonTap');
              setViewMode('side_by_side');
            }}
          >
            <Ionicons
              name="grid-outline"
              size={14}
              color={viewMode === 'side_by_side' ? '#000000' : '#94A3B8'}
            />
            <Text
              style={[
                styles.modeTabText,
                viewMode === 'side_by_side' && styles.modeTabTextActive,
              ]}
            >
              SIDE-BY-SIDE
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeTab,
              viewMode === 'onion_skin' && styles.modeTabActive,
            ]}
            onPress={() => {
              triggerHaptic('buttonTap');
              setViewMode('onion_skin');
            }}
          >
            <Ionicons
              name="layers-outline"
              size={14}
              color={viewMode === 'onion_skin' ? '#000000' : '#94A3B8'}
            />
            <Text
              style={[
                styles.modeTabText,
                viewMode === 'onion_skin' && styles.modeTabTextActive,
              ]}
            >
              ONION-SKIN BLEND
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 20) + 16 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Telemetry Delta Ribbon */}
          <View style={styles.telemetryRibbon}>
            <View style={styles.telemetryCell}>
              <Text style={styles.telemetryLabel}>DISTANCE DELTA</Text>
              <Text style={[styles.telemetryValue, isBullseye ? styles.textLime : styles.textCyan]}>
                {isBullseye ? `${distanceErrorM.toFixed(1)}m (BULLSEYE)` : `${distanceErrorM.toFixed(1)}m`}
              </Text>
            </View>

            <View style={styles.telemetryDivider} />

            <View style={styles.telemetryCell}>
              <Text style={styles.telemetryLabel}>HEADING DELTA</Text>
              <Text style={[styles.telemetryValue, headingErrorDeg < 15 ? styles.textLime : styles.textAmber]}>
                {headingErrorDeg.toFixed(1)}°
              </Text>
            </View>

            <View style={styles.telemetryDivider} />

            <View style={styles.telemetryCell}>
              <Text style={styles.telemetryLabel}>SCORE AWARDED</Text>
              <Text style={[styles.telemetryValue, styles.textLime]}>
                {scoreBreakdown.totalScore} / 5,000
              </Text>
            </View>
          </View>

          {/* Main Photo Visualizer */}
          {viewMode === 'side_by_side' ? (
            <View style={styles.sideBySideStack}>
              {/* Target Landmark Photo */}
              <View style={styles.photoContainer}>
                <View style={styles.photoHeaderBar}>
                  <View style={styles.tagBadge}>
                    <Text style={styles.tagBadgeText}>TARGET REFERENCE</Text>
                  </View>
                  {targetHeading !== undefined && (
                    <Text style={styles.photoSubheading}>
                      AZIMUTH: {getHeadingCompassLabel(targetHeading)}
                    </Text>
                  )}
                </View>

                <View style={styles.imageFrame}>
                  {targetPhotoUrl ? (
                    <Image
                      source={{ uri: targetPhotoUrl }}
                      style={styles.imageFull}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <Ionicons name="image-outline" size={36} color="#64748B" />
                      <Text style={styles.imagePlaceholderText}>NO TARGET IMAGE DATA</Text>
                    </View>
                  )}
                  <View style={[styles.cornerBracket, styles.bracketTL]} />
                  <View style={[styles.cornerBracket, styles.bracketTR]} />
                  <View style={[styles.cornerBracket, styles.bracketBL]} />
                  <View style={[styles.cornerBracket, styles.bracketBR]} />
                </View>
                {scoutedBy && (
                  <Text style={styles.scoutedCaption}>
                    SCOUTED BY TEAM: {scoutedBy.toUpperCase()}
                  </Text>
                )}
              </View>

              {/* Operative Submission Photo */}
              <View style={styles.photoContainer}>
                <View style={styles.photoHeaderBar}>
                  <View style={[styles.tagBadge, styles.tagBadgeCyan]}>
                    <Text style={[styles.tagBadgeText, styles.tagBadgeTextCyan]}>YOUR CAPTURE</Text>
                  </View>
                  {submissionHeading !== undefined && (
                    <Text style={styles.photoSubheading}>
                      AZIMUTH: {getHeadingCompassLabel(submissionHeading)}
                    </Text>
                  )}
                </View>

                <View style={styles.imageFrame}>
                  {submissionPhotoUrl ? (
                    <Image
                      source={{ uri: submissionPhotoUrl }}
                      style={styles.imageFull}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <Ionicons name="camera-outline" size={36} color="#64748B" />
                      <Text style={styles.imagePlaceholderText}>FIELD CAMERA CAPTURE</Text>
                    </View>
                  )}
                  <View style={[styles.cornerBracket, styles.bracketTL]} />
                  <View style={[styles.cornerBracket, styles.bracketTR]} />
                  <View style={[styles.cornerBracket, styles.bracketBL]} />
                  <View style={[styles.cornerBracket, styles.bracketBR]} />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.onionSkinSection}>
              {/* Onion Skin Controls */}
              <View style={styles.blendControlBox}>
                <Text style={styles.blendLabel}>
                  PERSPECTIVE OVERLAY BLEND ({Math.round(blendOpacity * 100)}%)
                </Text>
                <View style={styles.blendButtonGroup}>
                  {[0.0, 0.25, 0.5, 0.75, 1.0].map((val) => (
                    <TouchableOpacity
                      key={val}
                      style={[
                        styles.blendBtn,
                        Math.abs(blendOpacity - val) < 0.05 && styles.blendBtnActive,
                      ]}
                      onPress={() => {
                        triggerHaptic('buttonTap');
                        setBlendOpacity(val);
                      }}
                    >
                      <Text
                        style={[
                          styles.blendBtnText,
                          Math.abs(blendOpacity - val) < 0.05 && styles.blendBtnTextActive,
                        ]}
                      >
                        {Math.round(val * 100)}%
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Blended Viewport */}
              <View style={[styles.imageFrame, styles.imageFrameBlended]}>
                {/* Target photo (Bottom base layer) */}
                {targetPhotoUrl ? (
                  <Image
                    source={{ uri: targetPhotoUrl }}
                    style={styles.imageFull}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <Text style={styles.imagePlaceholderText}>TARGET BASE IMAGE</Text>
                  </View>
                )}

                {/* Submission photo (Overlay layer with dynamic opacity) */}
                {submissionPhotoUrl && (
                  <Image
                    source={{ uri: submissionPhotoUrl }}
                    style={[styles.imageOverlay, { opacity: blendOpacity }]}
                    resizeMode="cover"
                  />
                )}

                {/* Reticle Overlay */}
                <View style={styles.reticleCrosshair}>
                  <View style={styles.reticleLineH} />
                  <View style={styles.reticleLineV} />
                  <View style={styles.reticleCenterDot} />
                </View>

                {/* Corner Brackets */}
                <View style={[styles.cornerBracket, styles.bracketTL]} />
                <View style={[styles.cornerBracket, styles.bracketTR]} />
                <View style={[styles.cornerBracket, styles.bracketBL]} />
                <View style={[styles.cornerBracket, styles.bracketBR]} />
              </View>

              <Text style={styles.blendGuideNote}>
                Adjust blend percentage to inspect building angles, horizon level, and focal alignment.
              </Text>
            </View>
          )}

          {/* Scoring Matrix Breakdown Card */}
          <View style={styles.scoreCard}>
            <Text style={styles.scoreCardTitle}>5,000 PTS SCORING BREAKDOWN</Text>

            <View style={styles.metricRow}>
              <Text style={styles.metricName}>PROXIMITY (100M DECAY)</Text>
              <Text style={styles.metricScore}>
                +{scoreBreakdown.scoreProximity} / 4,000 PTS
              </Text>
            </View>
            <View style={styles.metricTrack}>
              <View
                style={[
                  styles.metricProgress,
                  { width: `${(scoreBreakdown.scoreProximity / 4000) * 100}%` },
                ]}
              />
            </View>

            <View style={[styles.metricRow, { marginTop: 12 }]}>
              <Text style={styles.metricName}>HEADING ALIGNMENT (COSINE)</Text>
              <Text style={styles.metricScore}>
                +{scoreBreakdown.scoreHeading} / 500 PTS
              </Text>
            </View>
            <View style={styles.metricTrack}>
              <View
                style={[
                  styles.metricProgress,
                  styles.metricProgressCyan,
                  { width: `${(scoreBreakdown.scoreHeading / 500) * 100}%` },
                ]}
              />
            </View>

            <View style={[styles.metricRow, { marginTop: 12 }]}>
              <Text style={styles.metricName}>TIME ELAPSED SPEED BONUS</Text>
              <Text style={styles.metricScore}>
                +{scoreBreakdown.scoreSpeed} / 500 PTS
              </Text>
            </View>
            <View style={styles.metricTrack}>
              <View
                style={[
                  styles.metricProgress,
                  styles.metricProgressAmber,
                  { width: `${(scoreBreakdown.scoreSpeed / 500) * 100}%` },
                ]}
              />
            </View>

            <View style={styles.multiplierBox}>
              <Text style={styles.multiplierLabel}>PROGRESSIVE CLUE PENALTY</Text>
              <Text style={styles.multiplierValue}>
                {scoreBreakdown.clueMultiplier.toFixed(1)}x MULTIPLIER
              </Text>
            </View>

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>TOTAL ROUND SCORE</Text>
              <Text style={styles.totalScoreNumber}>
                {scoreBreakdown.totalScore} PTS
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0E13',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#282732',
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#23222B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerSubtitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#00F0FF',
  },
  headerTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    color: '#FFFFFF',
    marginTop: 2,
  },
  gradePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  gradePillText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    letterSpacing: 1,
  },
  modeSwitcherContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#16151D',
    borderBottomWidth: 1,
    borderBottomColor: '#282732',
    gap: 8,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#23222B',
    gap: 6,
  },
  modeTabActive: {
    backgroundColor: '#C8FF00',
  },
  modeTabText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: '#94A3B8',
  },
  modeTabTextActive: {
    color: '#000000',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  telemetryRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#1A1924',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2F2E3D',
    paddingVertical: 12,
    marginBottom: 16,
  },
  telemetryCell: {
    alignItems: 'center',
    flex: 1,
  },
  telemetryLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: '#94A3B8',
    marginBottom: 3,
  },
  telemetryValue: {
    fontFamily: 'Archivo-Black',
    fontSize: 13,
  },
  telemetryDivider: {
    width: 1,
    height: 26,
    backgroundColor: '#2F2E3D',
  },
  textLime: {
    color: '#C8FF00',
  },
  textCyan: {
    color: '#00F0FF',
  },
  textAmber: {
    color: '#F59E0B',
  },
  sideBySideStack: {
    gap: 16,
    marginBottom: 16,
  },
  photoContainer: {
    backgroundColor: '#1A1924',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2F2E3D',
    padding: 12,
  },
  photoHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  tagBadge: {
    backgroundColor: 'rgba(200, 255, 0, 0.15)',
    borderColor: '#C8FF00',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  tagBadgeCyan: {
    backgroundColor: 'rgba(0, 240, 255, 0.15)',
    borderColor: '#00F0FF',
  },
  tagBadgeText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#C8FF00',
    letterSpacing: 0.8,
  },
  tagBadgeTextCyan: {
    color: '#00F0FF',
  },
  photoSubheading: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#94A3B8',
  },
  imageFrame: {
    width: '100%',
    height: 200,
    backgroundColor: '#09090C',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  imageFrameBlended: {
    height: 260,
  },
  imageFull: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#64748B',
    marginTop: 8,
    letterSpacing: 1,
  },
  cornerBracket: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: '#C8FF00',
  },
  bracketTL: {
    top: 6,
    left: 6,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  bracketTR: {
    top: 6,
    right: 6,
    borderTopWidth: 2,
    borderRightWidth: 2,
  },
  bracketBL: {
    bottom: 6,
    left: 6,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },
  bracketBR: {
    bottom: 6,
    right: 6,
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },
  scoutedCaption: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#64748B',
    marginTop: 6,
  },
  onionSkinSection: {
    marginBottom: 16,
  },
  blendControlBox: {
    backgroundColor: '#1A1924',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2F2E3D',
    padding: 12,
    marginBottom: 12,
  },
  blendLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: '#00F0FF',
    marginBottom: 8,
  },
  blendButtonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  blendBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: '#252433',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blendBtnActive: {
    backgroundColor: '#00F0FF',
  },
  blendBtnText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#94A3B8',
  },
  blendBtnTextActive: {
    color: '#000000',
  },
  reticleCrosshair: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  reticleLineH: {
    position: 'absolute',
    width: 60,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  reticleLineV: {
    position: 'absolute',
    height: 60,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  reticleCenterDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#C8FF00',
  },
  blendGuideNote: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 8,
    textAlign: 'center',
  },
  scoreCard: {
    backgroundColor: '#1A1924',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2F2E3D',
    padding: 16,
  },
  scoreCardTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    letterSpacing: 1,
    color: '#C8FF00',
    marginBottom: 14,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  metricName: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#94A3B8',
  },
  metricScore: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    color: '#FFFFFF',
  },
  metricTrack: {
    height: 5,
    backgroundColor: '#272635',
    borderRadius: 3,
    overflow: 'hidden',
  },
  metricProgress: {
    height: '100%',
    backgroundColor: '#C8FF00',
  },
  metricProgressCyan: {
    backgroundColor: '#00F0FF',
  },
  metricProgressAmber: {
    backgroundColor: '#F59E0B',
  },
  multiplierBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#282736',
  },
  multiplierLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#94A3B8',
  },
  multiplierValue: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    color: '#00F0FF',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#363548',
  },
  totalLabel: {
    fontFamily: 'Archivo-Black',
    fontSize: 13,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  totalScoreNumber: {
    fontFamily: 'Archivo-Black',
    fontSize: 18,
    color: '#C8FF00',
  },
});

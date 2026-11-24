import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PinpointScoreBreakdown } from '../modes/pinpoint/types';
import { getPinpointGradeBadge, getHeadingCompassLabel } from '../modes/pinpoint/engine';
import { PinpointPhotoComparisonModal } from './PinpointPhotoComparisonModal';
import { triggerHaptic } from '../motion/haptics';

export interface PinpointResultCardProps {
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

export const PinpointResultCard: React.FC<PinpointResultCardProps> = ({
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
  const [modalVisible, setModalVisible] = useState(false);

  const badge = getPinpointGradeBadge(scoreBreakdown.totalScore);
  const isBullseye = distanceErrorM <= 3.0;

  const handleOpenComparison = () => {
    triggerHaptic('buttonTap');
    setModalVisible(true);
  };

  return (
    <>
      <View style={styles.card}>
        {/* Top Header Row */}
        <View style={styles.headerRow}>
          <View style={styles.roundInfo}>
            <Text style={styles.roundLabel}>
              ROUND {roundNumber} OF {totalRounds}
            </Text>
            <Text style={styles.landmarkTitle} numberOfLines={1}>
              {targetTitle.toUpperCase()}
            </Text>
          </View>

          <View style={[styles.badgePill, { backgroundColor: badge.accentColor, borderColor: badge.color }]}>
            <Text style={[styles.badgeText, { color: badge.color }]}>
              {badge.title}
            </Text>
          </View>
        </View>

        {/* Side-by-Side Photographic Comparison View */}
        <TouchableOpacity
          style={styles.photoComparisonRow}
          activeOpacity={0.88}
          onPress={handleOpenComparison}
          accessibilityRole="button"
          accessibilityLabel="Open detailed side by side photographic audit"
        >
          {/* Target Reference Photo */}
          <View style={styles.photoColumn}>
            <View style={styles.photoBadgeBar}>
              <Text style={styles.photoTag}>TARGET REF</Text>
              {targetHeading !== undefined && (
                <Text style={styles.photoHeadingText}>{Math.round(targetHeading)}°</Text>
              )}
            </View>
            <View style={styles.imageBox}>
              {targetPhotoUrl ? (
                <Image
                  source={{ uri: targetPhotoUrl }}
                  style={styles.thumbnail}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.thumbPlaceholder}>
                  <Ionicons name="image-outline" size={20} color="#64748B" />
                </View>
              )}
              <View style={[styles.cornerBracket, styles.bracketTL]} />
              <View style={[styles.cornerBracket, styles.bracketTR]} />
            </View>
          </View>

          {/* Center VS Telemetry Indicator */}
          <View style={styles.centerIndicator}>
            <View style={styles.vsCircle}>
              <Text style={styles.vsText}>VS</Text>
            </View>
            <Ionicons name="scan-outline" size={16} color="#00F0FF" />
          </View>

          {/* Operative Viewfinder Capture */}
          <View style={styles.photoColumn}>
            <View style={styles.photoBadgeBar}>
              <Text style={[styles.photoTag, styles.photoTagCyan]}>YOUR SHOT</Text>
              {submissionHeading !== undefined && (
                <Text style={[styles.photoHeadingText, styles.photoHeadingTextCyan]}>
                  {Math.round(submissionHeading)}°
                </Text>
              )}
            </View>
            <View style={styles.imageBox}>
              {submissionPhotoUrl ? (
                <Image
                  source={{ uri: submissionPhotoUrl }}
                  style={styles.thumbnail}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.thumbPlaceholder}>
                  <Ionicons name="camera-outline" size={20} color="#64748B" />
                </View>
              )}
              <View style={[styles.cornerBracket, styles.bracketBL]} />
              <View style={[styles.cornerBracket, styles.bracketBR]} />
            </View>
          </View>
        </TouchableOpacity>

        {/* Delta Error Telemetry Banner */}
        <View style={styles.deltaBanner}>
          <View style={styles.deltaItem}>
            <Text style={styles.deltaLabel}>DISTANCE ERROR</Text>
            <Text style={[styles.deltaVal, isBullseye ? styles.textLime : styles.textCyan]}>
              {isBullseye ? `${distanceErrorM.toFixed(1)}m (BULLSEYE)` : `${distanceErrorM.toFixed(1)}m`}
            </Text>
          </View>
          <View style={styles.deltaSep} />
          <View style={styles.deltaItem}>
            <Text style={styles.deltaLabel}>HEADING DELTA</Text>
            <Text style={[styles.deltaVal, headingErrorDeg < 15 ? styles.textLime : styles.textAmber]}>
              {headingErrorDeg.toFixed(1)}°
            </Text>
          </View>
          <View style={styles.deltaSep} />
          <View style={styles.deltaItem}>
            <Text style={styles.deltaLabel}>ACCURACY</Text>
            <Text style={[styles.deltaVal, styles.textLime]}>
              {Math.max(0, Math.round((1 - distanceErrorM / 400) * 100))}%
            </Text>
          </View>
        </View>

        {/* 4-Metric Score Pill Grid */}
        <View style={styles.scoreGrid}>
          <View style={styles.scorePill}>
            <Text style={styles.scorePillLabel}>PROXIMITY</Text>
            <Text style={styles.scorePillValue}>{scoreBreakdown.scoreProximity} pts</Text>
          </View>
          <View style={styles.scorePill}>
            <Text style={styles.scorePillLabel}>ALIGNMENT</Text>
            <Text style={styles.scorePillValue}>{scoreBreakdown.scoreHeading} pts</Text>
          </View>
          <View style={styles.scorePill}>
            <Text style={styles.scorePillLabel}>SPEED</Text>
            <Text style={styles.scorePillValue}>{scoreBreakdown.scoreSpeed} pts</Text>
          </View>
          <View style={styles.scorePill}>
            <Text style={styles.scorePillLabel}>PENALTY</Text>
            <Text style={[styles.scorePillValue, { color: '#00F0FF' }]}>
              {scoreBreakdown.clueMultiplier.toFixed(1)}x
            </Text>
          </View>
        </View>

        {/* Card Footer: Total Score & Action Button */}
        <View style={styles.cardFooter}>
          <View style={styles.totalBlock}>
            <Text style={styles.totalScoreLabel}>ROUND SCORE</Text>
            <Text style={styles.totalScoreValue}>
              {scoreBreakdown.totalScore} <Text style={styles.totalScoreMax}>/ 5,000</Text>
            </Text>
          </View>

          <TouchableOpacity
            style={styles.expandBtn}
            onPress={handleOpenComparison}
            accessibilityRole="button"
            accessibilityLabel="Compare perspective overlay in full detail"
          >
            <Ionicons name="layers" size={14} color="#000000" />
            <Text style={styles.expandBtnText}>AUDIT OVERLAY</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Embedded Fullscreen Comparison Modal */}
      <PinpointPhotoComparisonModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        roundNumber={roundNumber}
        totalRounds={totalRounds}
        targetPhotoUrl={targetPhotoUrl}
        targetTitle={targetTitle}
        targetHeading={targetHeading}
        submissionPhotoUrl={submissionPhotoUrl}
        submissionHeading={submissionHeading}
        distanceErrorM={distanceErrorM}
        headingErrorDeg={headingErrorDeg}
        scoreBreakdown={scoreBreakdown}
        scoutedBy={scoutedBy}
      />
    </>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#16151D',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#292837',
    padding: 14,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  roundInfo: {
    flex: 1,
    marginRight: 8,
  },
  roundLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    letterSpacing: 1,
    color: '#00F0FF',
  },
  landmarkTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 14,
    color: '#FFFFFF',
    marginTop: 2,
  },
  badgePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    borderWidth: 1,
  },
  badgeText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    letterSpacing: 0.8,
  },
  photoComparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  photoColumn: {
    flex: 1,
  },
  photoBadgeBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  photoTag: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    letterSpacing: 0.6,
    color: '#C8FF00',
  },
  photoTagCyan: {
    color: '#00F0FF',
  },
  photoHeadingText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#94A3B8',
  },
  photoHeadingTextCyan: {
    color: '#00F0FF',
  },
  imageBox: {
    height: 105,
    backgroundColor: '#0A0A0E',
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#282736',
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    gap: 4,
  },
  vsCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#232230',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#363548',
  },
  vsText: {
    fontFamily: 'Archivo-Black',
    fontSize: 9,
    color: '#94A3B8',
  },
  cornerBracket: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderColor: '#C8FF00',
  },
  bracketTL: {
    top: 3,
    left: 3,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
  },
  bracketTR: {
    top: 3,
    right: 3,
    borderTopWidth: 1.5,
    borderRightWidth: 1.5,
  },
  bracketBL: {
    bottom: 3,
    left: 3,
    borderBottomWidth: 1.5,
    borderLeftWidth: 1.5,
  },
  bracketBR: {
    bottom: 3,
    right: 3,
    borderBottomWidth: 1.5,
    borderRightWidth: 1.5,
  },
  deltaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E1D2A',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2F2E40',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  deltaItem: {
    alignItems: 'center',
    flex: 1,
  },
  deltaLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 9,
    letterSpacing: 0.6,
    color: '#94A3B8',
    marginBottom: 2,
  },
  deltaVal: {
    fontFamily: 'Archivo-Black',
    fontSize: 11,
  },
  deltaSep: {
    width: 1,
    height: 18,
    backgroundColor: '#323144',
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
  scoreGrid: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  scorePill: {
    flex: 1,
    backgroundColor: '#1A1924',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#262534',
    paddingVertical: 5,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  scorePillLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 8,
    letterSpacing: 0.5,
    color: '#64748B',
    marginBottom: 2,
  },
  scorePillValue: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#FFFFFF',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#282736',
  },
  totalBlock: {
    flexDirection: 'column',
  },
  totalScoreLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 9,
    letterSpacing: 0.6,
    color: '#94A3B8',
  },
  totalScoreValue: {
    fontFamily: 'Archivo-Black',
    fontSize: 16,
    color: '#C8FF00',
  },
  totalScoreMax: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#64748B',
  },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#C8FF00',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    gap: 6,
  },
  expandBtnText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: '#000000',
  },
});

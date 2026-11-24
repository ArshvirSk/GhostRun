import React, { memo } from 'react';
import { StyleSheet, View, TouchableOpacity, Image } from 'react-native';
import { Text } from '../../ui/Text';
import type { HudWidget, HudWidgetProps } from '../types';

/**
 * Top HUD Dock displaying current Pinpoint Round, Clue Unlock Level, and Score Multiplier.
 */
export const PinpointTopWidget = memo(function PinpointTopWidget({
  state,
  serverNow,
}: HudWidgetProps) {
  const pp = (state as any).pinpoint || (state as any).game?.pinpoint;
  if (!pp) return null;

  const roundNum = pp.current_round ?? 1;
  const totalRounds = pp.total_rounds ?? 3;
  const clueLevel = pp.clues_unlocked ?? 0;
  const multiplier = clueLevel === 1 ? '0.9x' : clueLevel === 2 ? '0.8x' : clueLevel >= 3 ? '0.7x' : '1.0x';

  return (
    <View style={styles.topContainer}>
      <View style={styles.badgeLeft}>
        <Text style={styles.badgeLabel}>ROUND</Text>
        <Text style={styles.badgeValue}>
          {roundNum}/{totalRounds}
        </Text>
      </View>

      <View style={styles.badgeCenter}>
        <Text style={styles.clueTitle}>
          {clueLevel === 0 && 'CLUE 0: PURE SIGHT'}
          {clueLevel === 1 && 'CLUE 1: SONAR RADAR'}
          {clueLevel === 2 && 'CLUE 2: SECTOR TRIANGULATION'}
          {clueLevel >= 3 && 'CLUE 3: AZIMUTH BEARING'}
        </Text>
      </View>

      <View style={styles.badgeRight}>
        <Text style={styles.badgeLabel}>SCORE MULT</Text>
        <Text style={[styles.badgeValue, clueLevel > 0 ? styles.multAmber : styles.multMint]}>
          {multiplier}
        </Text>
      </View>
    </View>
  );
});

/**
 * Target photo thumbnail dock in the action row.
 */
export const PinpointTargetThumbnailWidget = memo(function PinpointTargetThumbnailWidget({
  state,
}: HudWidgetProps) {
  const pp = (state as any).pinpoint || (state as any).game?.pinpoint;
  const targetPhoto = pp?.target_photo_url;
  if (!targetPhoto) return null;

  return (
    <View style={styles.thumbnailContainer}>
      <Image source={{ uri: targetPhoto }} style={styles.targetImage} resizeMode="cover" />
      <View style={styles.thumbnailLabel}>
        <Text style={styles.thumbnailLabelText}>TARGET DROP</Text>
      </View>
    </View>
  );
});

export const pinpointWidgets: HudWidget[] = [
  {
    id: 'pinpoint_top_dock',
    slot: 'top',
    roles: ['runner', 'hunter'],
    phases: ['live'],
    priority: 10,
    Component: PinpointTopWidget,
  },
  {
    id: 'pinpoint_target_thumb',
    slot: 'actions',
    roles: ['runner', 'hunter'],
    phases: ['live'],
    priority: 5,
    Component: PinpointTargetThumbnailWidget,
  },
];

const styles = StyleSheet.create({
  topContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 12,
  },
  badgeLeft: {
    alignItems: 'flex-start',
  },
  badgeCenter: {
    alignItems: 'center',
  },
  badgeRight: {
    alignItems: 'flex-end',
  },
  badgeLabel: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 9,
    color: '#64748B',
    letterSpacing: 0.8,
  },
  badgeValue: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    color: '#F1F5F9',
  },
  clueTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#00F0FF',
    letterSpacing: 1,
  },
  multMint: {
    color: '#10B981',
  },
  multAmber: {
    color: '#F59E0B',
  },
  thumbnailContainer: {
    width: 64,
    height: 64,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#00F0FF',
    position: 'relative',
  },
  targetImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(9, 13, 20, 0.85)',
    paddingVertical: 2,
    alignItems: 'center',
  },
  thumbnailLabelText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 7,
    color: '#00F0FF',
    letterSpacing: 0.5,
  },
});

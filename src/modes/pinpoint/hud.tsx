import React, { memo } from 'react';
import { StyleSheet, View, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import { GeoJSONSource, Layer } from '../../lib/map';
import { buildAzimuthVectorLine, buildSectorQuadrantPolygon } from './liveHelpers';
import type { HudWidget, HudWidgetProps } from '../types';

/**
 * Top HUD Dock displaying current Pinpoint Round, Clue Unlock Level, Sector/Azimuth hint, and Score Multiplier.
 */
export const PinpointTopWidget = memo(function PinpointTopWidget({
  state,
}: HudWidgetProps) {
  const pp = (state as any).pinpoint || (state as any).game?.pinpoint;
  if (!pp) return null;

  const roundNum = pp.current_round ?? 1;
  const totalRounds = pp.total_rounds ?? 3;
  const clueLevel = pp.clues_unlocked ?? 0;
  const sector = pp.sector_quadrant as ('NW' | 'NE' | 'SW' | 'SE' | null) ?? null;
  const bearing = pp.bearing_to_target_deg as number | null ?? null;
  const totalScore = pp.cumulative_score ?? 0;
  const multiplier =
    clueLevel === 1 ? '0.9x' : clueLevel === 2 ? '0.8x' : clueLevel >= 3 ? '0.7x' : '1.0x';

  let clueHeadline = 'CLUE 0: PURE SIGHT';
  if (clueLevel === 1) {
    clueHeadline = 'CLUE 1: SONAR ACTIVE';
  } else if (clueLevel === 2) {
    clueHeadline = sector ? `CLUE 2: SECTOR ${sector}` : 'CLUE 2: SECTOR LOCK';
  } else if (clueLevel >= 3) {
    clueHeadline =
      bearing !== null
        ? `CLUE 3: AZIMUTH ${Math.round(bearing)} DEG`
        : 'CLUE 3: AZIMUTH VECTOR';
  }

  return (
    <View style={styles.topContainer}>
      <View style={styles.badgeLeft}>
        <Text style={styles.badgeLabel}>ROUND</Text>
        <Text style={styles.badgeValue}>
          {roundNum}/{totalRounds}
        </Text>
      </View>

      <View style={styles.badgeCenter}>
        <Text style={styles.clueTitle}>{clueHeadline}</Text>
        <Text style={styles.scoreSubtext}>{totalScore} PTS BANKED</Text>
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
 * Interactive Target photo thumbnail & Align/Capture trigger in the action row.
 */
export const PinpointTargetThumbnailWidget = memo(function PinpointTargetThumbnailWidget({
  state,
  actions,
}: HudWidgetProps) {
  const pp = (state as any).pinpoint || (state as any).game?.pinpoint;
  const targetPhoto = pp?.target_photo_url;
  if (!pp) return null;

  const handleOpenViewfinder = () => {
    actions.openPinpointViewfinder?.();
  };

  return (
    <View style={styles.actionRow}>
      {Boolean(targetPhoto) && (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleOpenViewfinder}
          style={styles.thumbnailContainer}
          accessibilityRole="button"
          accessibilityLabel="Inspect target reference photo and open camera viewfinder"
        >
          <Image source={{ uri: targetPhoto }} style={styles.targetImage} resizeMode="cover" />
          <View style={styles.thumbnailLabel}>
            <Text style={styles.thumbnailLabelText}>TARGET</Text>
          </View>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handleOpenViewfinder}
        style={styles.captureFab}
        accessibilityRole="button"
        accessibilityLabel="Open Pinpoint Camera Viewfinder"
      >
        <Ionicons name="camera" size={16} color="#000000" />
        <Text style={styles.captureFabText}>ALIGN & CAPTURE</Text>
      </TouchableOpacity>
    </View>
  );
});

/**
 * Progressive Hint 1 (T+0:45): Subtle edge-screen ambient glow aura reflecting Hot/Cold proximity.
 */
export const PinpointSonarAuraOverlay = memo(function PinpointSonarAuraOverlay({
  state,
}: HudWidgetProps) {
  const pp = (state as any).pinpoint || (state as any).game?.pinpoint;
  if (!pp || (pp.clues_unlocked ?? 0) < 1 || !pp.sonar_aura_color) return null;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.sonarAuraBorder,
        {
          borderColor: pp.sonar_aura_color,
        },
      ]}
    />
  );
});

/**
 * Progressive Hints 2 & 3 (T+1:30 & T+2:15): MapLibre Sector Quadrant highlight and Azimuth Vector line.
 */
export const PinpointMapLayer = memo(function PinpointMapLayer({
  state,
  ownFix,
}: HudWidgetProps) {
  const pp = (state as any).pinpoint || (state as any).game?.pinpoint;
  const area = state.game?.area;
  if (!pp || !area) return null;

  const clueLevel = pp.clues_unlocked ?? 0;
  const quadrant = pp.sector_quadrant as ('NW' | 'NE' | 'SW' | 'SE' | null) ?? null;
  const targetLat = pp.target_lat as number | undefined;
  const targetLng = pp.target_lng as number | undefined;

  return (
    <>
      {clueLevel >= 2 && quadrant && (
        <GeoJSONSource
          id="pinpoint-sector-quadrant"
          data={buildSectorQuadrantPolygon(area.latitude, area.longitude, area.radius_m, quadrant)}
        >
          <Layer
            id="pinpoint-sector-fill"
            type="fill"
            paint={{ 'fill-color': '#10B981', 'fill-opacity': 0.14 }}
          />
          <Layer
            id="pinpoint-sector-outline"
            type="line"
            paint={{ 'line-color': '#10B981', 'line-width': 2, 'line-dasharray': [4, 2] }}
          />
        </GeoJSONSource>
      )}

      {clueLevel >= 3 && ownFix && targetLat != null && targetLng != null && (
        <GeoJSONSource
          id="pinpoint-azimuth-vector"
          data={buildAzimuthVectorLine(ownFix.latitude, ownFix.longitude, targetLat, targetLng)}
        >
          <Layer
            id="pinpoint-azimuth-line"
            type="line"
            paint={{
              'line-color': '#F59E0B',
              'line-width': 3,
              'line-dasharray': [3, 2],
            }}
          />
        </GeoJSONSource>
      )}
    </>
  );
});

export const pinpointWidgets: HudWidget[] = [
  {
    id: 'pinpoint_top_dock',
    slot: 'top',
    roles: ['runner', 'hunter', 'solo'],
    phases: ['live'],
    priority: 10,
    Component: PinpointTopWidget,
  },
  {
    id: 'pinpoint_target_thumb',
    slot: 'actions',
    roles: ['runner', 'hunter', 'solo'],
    phases: ['live'],
    priority: 5,
    Component: PinpointTargetThumbnailWidget,
  },
  {
    id: 'pinpoint_sonar_aura',
    slot: 'overlay',
    roles: ['runner', 'hunter', 'solo'],
    phases: ['live'],
    priority: 12,
    Component: PinpointSonarAuraOverlay,
  },
  {
    id: 'pinpoint_map_layer',
    slot: 'mapLayer',
    roles: ['runner', 'hunter', 'solo'],
    phases: ['live'],
    priority: 8,
    Component: PinpointMapLayer,
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
  scoreSubtext: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 9,
    color: '#C8FF00',
    letterSpacing: 0.6,
    marginTop: 1,
  },
  multMint: {
    color: '#10B981',
  },
  multAmber: {
    color: '#F59E0B',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thumbnailContainer: {
    width: 58,
    height: 58,
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
  captureFab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#C8FF00',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  captureFabText: {
    fontFamily: 'Archivo-Black',
    fontSize: 11,
    color: '#000000',
    letterSpacing: 0.8,
  },
  sonarAuraBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 4,
    opacity: 0.45,
  },
});

import React, { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import { GeoJSONSource, Layer } from '../../lib/map';
import { distanceM, type PointCollection } from '../../lib/geo';
import type { HudWidget, HudWidgetProps } from '../types';

export const GhostDuelMapLayer = memo(function GhostDuelMapLayer({
  state,
}: HudWidgetProps) {
  const gd = state.ghost_duel;
  const ghost = gd?.ghost;

  const ghostPoint = useMemo<PointCollection | null>(() => {
    if (!ghost) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [ghost.longitude, ghost.latitude],
          },
          properties: {},
        },
      ],
    };
  }, [ghost]);

  if (!ghost || !ghostPoint) return null;

  return (
    <GeoJSONSource id="ghost-duel-npc" data={ghostPoint}>
      <Layer
        id="ghost-npc-halo"
        type="circle"
        paint={{
          'circle-radius': 18,
          'circle-color': '#A855F7',
          'circle-opacity': 0.35,
        }}
      />
      <Layer
        id="ghost-npc-point"
        type="circle"
        paint={{
          'circle-radius': 8,
          'circle-color': '#A855F7',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF',
        }}
      />
    </GeoJSONSource>
  );
});

export const GhostDuelTopWidget = memo(function GhostDuelTopWidget({
  state,
  ownFix,
}: HudWidgetProps) {
  const gd = state.ghost_duel;
  if (!gd) return null;

  const ghost = gd.ghost;
  const target = gd.target;

  const distToGhost =
    ownFix && ghost ? distanceM(ownFix, { longitude: ghost.longitude, latitude: ghost.latitude }) : null;
  const distToTarget =
    ownFix && target ? distanceM(ownFix, { longitude: target.longitude, latitude: target.latitude }) : null;

  return (
    <View style={styles.chipsContainer}>
      <View style={styles.chip}>
        <Text variant="label" style={styles.chipLabel}>
          GHOST
        </Text>
        <Text variant="numeric" style={[styles.chipValue, { color: '#A855F7' }]}>
          {distToGhost !== null ? `${Math.round(distToGhost)}m` : '--'}
        </Text>
      </View>
      <View style={styles.chip}>
        <Text variant="label" style={styles.chipLabel}>
          TARGET
        </Text>
        <Text variant="numeric" style={styles.chipValue}>
          {distToTarget !== null ? `${Math.round(distToTarget)}m` : '--'}
        </Text>
      </View>
    </View>
  );
});

export const GhostDuelTagButton = memo(function GhostDuelTagButton({
  state,
  actions,
}: HudWidgetProps) {
  const [tagging, setTagging] = useState(false);
  const gd = state.ghost_duel;
  if (gd?.variant !== 'mirror_chase') return null;

  const handleTag = async () => {
    setTagging(true);
    await actions.tagGhost();
    setTagging(false);
  };

  return (
    <Pressable
      accessibilityLabel="Tag Ghost Runner"
      accessibilityRole="button"
      disabled={tagging}
      onPress={handleTag}
      style={styles.tagGhostBtn}
    >
      {tagging ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <>
          <MaterialCommunityIcons color="#FFFFFF" name="ghost" size={18} />
          <Text variant="label" style={styles.tagGhostText}>
            TAG GHOST
          </Text>
        </>
      )}
    </Pressable>
  );
});

export const ghostDuelWidgets: HudWidget[] = [
  {
    id: 'ghost_duel_map_layer',
    slot: 'mapLayer',
    roles: ['runner', 'hunter', 'solo', 'spectator'],
    phases: ['countdown', 'head_start', 'live', 'ended'],
    priority: 10,
    Component: GhostDuelMapLayer,
  },
  {
    id: 'ghost_duel_top_widget',
    slot: 'top',
    roles: ['runner', 'hunter', 'solo'],
    phases: ['live'],
    priority: 8,
    Component: GhostDuelTopWidget,
  },
  {
    id: 'ghost_duel_tag_button',
    slot: 'actions',
    roles: ['hunter', 'solo'],
    phases: ['live'],
    priority: 1,
    Component: GhostDuelTagButton,
  },
];

const styles = StyleSheet.create({
  chipsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chipLabel: {
    fontSize: 9,
    color: '#8A9BA8',
  },
  chipValue: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  tagGhostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#9333EA',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  tagGhostText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
});

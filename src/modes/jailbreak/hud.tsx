import React, { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import { GeoJSONSource, Layer } from '../../lib/map';
import { circleRing, distanceM, type PointCollection } from '../../lib/geo';
import type { HudWidget, HudWidgetProps } from '../types';

export const JailbreakMapLayer = memo(function JailbreakMapLayer({
  state,
}: HudWidgetProps) {
  const jail = state.game.jail;

  const ring = useMemo(() => {
    if (!jail) return null;
    return circleRing({ longitude: jail.longitude, latitude: jail.latitude }, jail.radius_m || 15);
  }, [jail]);

  const point = useMemo<PointCollection | null>(() => {
    if (!jail) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [jail.longitude, jail.latitude],
          },
          properties: {},
        },
      ],
    };
  }, [jail]);

  if (!jail || !ring || !point) return null;

  return (
    <>
      <GeoJSONSource id="jail-radius" data={ring}>
        <Layer
          id="jail-radius-fill"
          type="fill"
          paint={{ 'fill-color': '#EF4444', 'fill-opacity': 0.12 }}
        />
        <Layer
          id="jail-radius-line"
          type="line"
          paint={{ 'line-color': '#EF4444', 'line-width': 2, 'line-dasharray': [3, 2] }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="jail-point" data={point}>
        <Layer
          id="jail-point-circle"
          type="circle"
          paint={{
            'circle-radius': 9,
            'circle-color': '#DC2626',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#FFFFFF',
          }}
        />
      </GeoJSONSource>
    </>
  );
});

export const JailbreakRescueButton = memo(function JailbreakRescueButton({
  state,
  ownFix,
  actions,
}: HudWidgetProps) {
  const [rescuing, setRescuing] = useState(false);
  const jail = state.game.jail;
  if (!jail || !ownFix) return null;

  const dist = distanceM(ownFix, { longitude: jail.longitude, latitude: jail.latitude });
  const isNear = dist <= (state.game.mode_params?.jailbreak as any)?.release_radius_m || 10;
  const jailedCount = state.players.filter((p) => p.team === 'runner' && p.status === 'jailed').length;

  if (jailedCount === 0 || !isNear) return null;

  const handleRescue = async () => {
    setRescuing(true);
    await actions.startRescue();
    // Simulate hold or complete
    setTimeout(async () => {
      await actions.completeRescue();
      setRescuing(false);
    }, 1000);
  };

  return (
    <Pressable
      accessibilityLabel="Break teammates out of jail"
      accessibilityRole="button"
      disabled={rescuing}
      onPress={handleRescue}
      style={styles.rescueButton}
    >
      {rescuing ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <>
          <MaterialCommunityIcons color="#FFFFFF" name="key-variant" size={18} />
          <Text variant="label" style={styles.rescueText}>
            RESCUE ({jailedCount})
          </Text>
        </>
      )}
    </Pressable>
  );
});

export const JailbreakStatusBanner = memo(function JailbreakStatusBanner({
  state,
}: HudWidgetProps) {
  const self = state.players.find((p) => p.id === state.my_player_id);
  if (self?.status !== 'jailed') return null;

  return (
    <View style={styles.jailedBanner}>
      <MaterialCommunityIcons color="#EF4444" name="lock-alert" size={20} />
      <View style={{ flex: 1 }}>
        <Text variant="label" style={{ color: '#EF4444' }}>
          JAILED: WAIT FOR A TEAMMATE RESCUE
        </Text>
        <Text variant="body" style={{ color: '#94A3B8', fontSize: 11 }}>
          Radar tracking paused. Free when a teammate executes stealth rescue.
        </Text>
      </View>
    </View>
  );
});

export const jailbreakWidgets: HudWidget[] = [
  {
    id: 'jailbreak_map_layer',
    slot: 'mapLayer',
    roles: ['runner', 'hunter', 'spectator', 'operator'],
    phases: ['countdown', 'head_start', 'live', 'ended'],
    priority: 10,
    Component: JailbreakMapLayer,
  },
  {
    id: 'jailbreak_rescue_button',
    slot: 'actions',
    roles: ['runner'],
    phases: ['live'],
    priority: 2,
    Component: JailbreakRescueButton,
  },
  {
    id: 'jailbreak_status_banner',
    slot: 'banner',
    roles: ['runner', 'spectator'],
    phases: ['live'],
    priority: 8,
    Component: JailbreakStatusBanner,
  },
];

const styles = StyleSheet.create({
  rescueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10B981',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  rescueText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  jailedBanner: {
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#EF4444',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});

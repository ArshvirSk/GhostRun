import React, { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import { GeoJSONSource, Layer } from '../../lib/map';
import { circleRing, type PointCollection } from '../../lib/geo';
import type { HudWidget, HudWidgetProps } from '../types';

export const RelayMapLayer = memo(function RelayMapLayer({
  state,
}: HudWidgetProps) {
  const relay = state.relay_heist;
  const extraction = relay?.extraction;
  const pkg = relay?.package;

  const extractionRing = useMemo(() => {
    if (!extraction) return null;
    return circleRing(
      { longitude: extraction.longitude, latitude: extraction.latitude },
      extraction.radius_m || 25
    );
  }, [extraction]);

  const packagePoint = useMemo<PointCollection | null>(() => {
    if (!pkg || pkg.status !== 'dropped' || pkg.longitude == null || pkg.latitude == null) {
      return null;
    }
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [pkg.longitude, pkg.latitude],
          },
          properties: {},
        },
      ],
    };
  }, [pkg]);

  return (
    <>
      {extractionRing && (
        <GeoJSONSource id="relay-extraction" data={extractionRing}>
          <Layer
            id="relay-extraction-fill"
            type="fill"
            paint={{ 'fill-color': '#10B981', 'fill-opacity': 0.15 }}
          />
          <Layer
            id="relay-extraction-line"
            type="line"
            paint={{ 'line-color': '#10B981', 'line-width': 2, 'line-dasharray': [3, 2] }}
          />
        </GeoJSONSource>
      )}

      {packagePoint && (
        <GeoJSONSource id="relay-package-dropped" data={packagePoint}>
          <Layer
            id="package-point"
            type="circle"
            paint={{
              'circle-radius': 10,
              'circle-color': '#F59E0B',
              'circle-stroke-width': 3,
              'circle-stroke-color': '#FFFFFF',
            }}
          />
        </GeoJSONSource>
      )}
    </>
  );
});

export const RelayPackageBanner = memo(function RelayPackageBanner({
  state,
}: HudWidgetProps) {
  const relay = state.relay_heist;
  if (!relay?.package) return null;

  const isCarrier = relay.is_carrier;
  const isDropped = relay.package.status === 'dropped';

  return (
    <View style={[styles.packageBanner, isCarrier && styles.packageCarrier]}>
      <MaterialCommunityIcons
        color={isCarrier ? '#10B981' : isDropped ? '#EF4444' : '#F59E0B'}
        name="briefcase"
        size={18}
      />
      <View style={{ flex: 1 }}>
        <Text
          variant="label"
          style={{ color: isCarrier ? '#10B981' : isDropped ? '#EF4444' : '#FFFFFF' }}
        >
          {isCarrier
            ? 'YOU ARE THE PACKAGE CARRIER!'
            : isDropped
              ? 'PACKAGE DROPPED ON FIELD!'
              : 'PACKAGE IS CARRIED BY SQUAD'}
        </Text>
        <Text variant="body" style={{ color: '#94A3B8', fontSize: 11 }}>
          {isCarrier
            ? 'Sprint to the extraction point or handoff to a teammate.'
            : isDropped
              ? 'Hurry to recover the package before hunters secure it.'
              : 'Escort your carrier to safety.'}
        </Text>
      </View>
    </View>
  );
});

export const RelayActions = memo(function RelayActions({
  state,
  myRole,
  actions,
}: HudWidgetProps) {
  const [busy, setBusy] = useState(false);
  const relay = state.relay_heist;
  if (!relay?.package) return null;

  const isRunner = myRole === 'runner';
  const isDropped = relay.package.status === 'dropped';

  if (isRunner && isDropped) {
    return (
      <Pressable
        accessibilityLabel="Pickup dropped package"
        accessibilityRole="button"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          await actions.pickupPackage();
          setBusy(false);
        }}
        style={[styles.actionBtn, { backgroundColor: '#F59E0B' }]}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text variant="label" style={styles.actionText}>
            PICKUP PACKAGE
          </Text>
        )}
      </Pressable>
    );
  }

  if (!isRunner && isDropped) {
    return (
      <Pressable
        accessibilityLabel="Secure dropped package"
        accessibilityRole="button"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          await actions.startSecuringPackage();
          setTimeout(async () => {
            await actions.completeSecurePackage();
            setBusy(false);
          }, 1000);
        }}
        style={[styles.actionBtn, { backgroundColor: '#DC2626' }]}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text variant="label" style={styles.actionText}>
            SECURE PACKAGE
          </Text>
        )}
      </Pressable>
    );
  }

  return null;
});

export const relayHeistWidgets: HudWidget[] = [
  {
    id: 'relay_heist_map_layer',
    slot: 'mapLayer',
    roles: ['runner', 'hunter', 'spectator', 'operator'],
    phases: ['countdown', 'head_start', 'live', 'ended'],
    priority: 10,
    Component: RelayMapLayer,
  },
  {
    id: 'relay_heist_banner',
    slot: 'banner',
    roles: ['runner', 'hunter'],
    phases: ['live'],
    priority: 6,
    Component: RelayPackageBanner,
  },
  {
    id: 'relay_heist_actions',
    slot: 'actions',
    roles: ['runner', 'hunter'],
    phases: ['live'],
    priority: 2,
    Component: RelayActions,
  },
];

const styles = StyleSheet.create({
  packageBanner: {
    marginHorizontal: 16,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  packageCarrier: {
    borderColor: '#10B981',
    backgroundColor: '#064E3B',
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
});

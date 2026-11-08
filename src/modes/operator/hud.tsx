import React, { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import { GeoJSONSource, Layer } from '../../lib/map';
import type { PointCollection } from '../../lib/geo';
import type { HudWidget, HudWidgetProps } from '../types';

export const OperatorMarkersLayer = memo(function OperatorMarkersLayer({
  state,
}: HudWidgetProps) {
  const rawMarkers = state.operator?.markers;

  const markersData = useMemo<PointCollection | null>(() => {
    if (!rawMarkers || rawMarkers.length === 0) return null;
    return {
      type: 'FeatureCollection',
      features: rawMarkers.map((m: any) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [m.longitude, m.latitude],
        },
        properties: {
          id: m.id,
          label: m.label,
        },
      })),
    };
  }, [rawMarkers]);

  if (!markersData) return null;

  return (
    <GeoJSONSource id="operator-markers" data={markersData}>
      <Layer
        id="operator-marker-halo"
        type="circle"
        paint={{
          'circle-radius': 16,
          'circle-color': '#0284C7',
          'circle-opacity': 0.3,
        }}
      />
      <Layer
        id="operator-marker-point"
        type="circle"
        paint={{
          'circle-radius': 7,
          'circle-color': '#38BDF8',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF',
        }}
      />
    </GeoJSONSource>
  );
});

export const OperatorScanButton = memo(function OperatorScanButton({
  state,
  actions,
}: HudWidgetProps) {
  const [scanning, setScanning] = useState(false);
  const isRunner = state.my_team === 'runner';

  const handleScan = async () => {
    setScanning(true);
    const targetCenter = isRunner ? undefined : { lat: state.game.area.latitude, lng: state.game.area.longitude };
    await actions.operatorScan(targetCenter);
    setScanning(false);
  };

  return (
    <Pressable
      accessibilityLabel={isRunner ? 'Trigger 150m tactical sweep' : 'Trigger 200m sector census'}
      accessibilityRole="button"
      disabled={scanning}
      onPress={handleScan}
      style={styles.scanBtn}
    >
      {scanning ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <>
          <MaterialCommunityIcons color="#FFFFFF" name="radar" size={18} />
          <Text variant="label" style={styles.scanText}>
            {isRunner ? 'TACTICAL SWEEP' : 'SECTOR CENSUS'}
          </Text>
        </>
      )}
    </Pressable>
  );
});

export const operatorWidgets: HudWidget[] = [
  {
    id: 'operator_markers_layer',
    slot: 'mapLayer',
    roles: ['runner', 'hunter', 'operator'],
    phases: ['live'],
    priority: 10,
    Component: OperatorMarkersLayer,
  },
  {
    id: 'operator_scan_button',
    slot: 'actions',
    roles: ['operator'],
    phases: ['live'],
    priority: 1,
    Component: OperatorScanButton,
  },
];

const styles = StyleSheet.create({
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0284C7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  scanText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
});

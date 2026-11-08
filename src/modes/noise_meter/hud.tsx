import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';
import type { HudWidget, HudWidgetProps } from '../types';

export const NoiseMeterBar = memo(function NoiseMeterBar({
  state,
}: HudWidgetProps) {
  // If noise meter is active, render runner noise indicator
  const noise = (state as any)?.modifiers_status?.noise ?? (state as any)?.noise ?? 15;
  const isHigh = noise >= 60;
  const isCritical = noise >= 85;

  const barColor = isCritical ? '#DC2626' : isHigh ? '#F59E0B' : '#10B981';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text variant="label" style={styles.label}>
          NOISE METER
        </Text>
        <Text variant="mono" style={[styles.val, { color: barColor }]}>
          {Math.round(noise)} / 100
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, noise)}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
});

export const noiseMeterWidgets: HudWidget[] = [
  {
    id: 'noise_meter_bar',
    slot: 'top',
    roles: ['runner'],
    phases: ['live'],
    priority: 4,
    Component: NoiseMeterBar,
  },
];

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 9,
    color: '#8A9BA8',
    letterSpacing: 0.5,
  },
  val: {
    fontSize: 10,
    fontWeight: '700',
  },
  track: {
    height: 4,
    backgroundColor: '#1E293B',
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});

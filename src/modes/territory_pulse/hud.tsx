import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';
import { GeoJSONSource, Layer } from '../../lib/map';
import { circleRing } from '../../lib/geo';
import type { HudWidget, HudWidgetProps } from '../types';
import { formatClock } from '../../game-shell/HudFrame';

export const TerritoryMapLayer = memo(function TerritoryMapLayer({
  state,
}: HudWidgetProps) {
  const tp = state.game.territory_pulse;
  const sectors = tp?.sectors ?? [];
  if (sectors.length === 0) return null;

  return (
    <>
      {sectors.map((sec) => {
        const ring = circleRing(
          { longitude: sec.longitude, latitude: sec.latitude },
          sec.radius_m || 40
        );
        const color =
          sec.controller === 'runner'
            ? '#06B6D4'
            : sec.controller === 'hunter'
              ? '#EF4444'
              : '#64748B';

        return (
          <GeoJSONSource key={sec.id} id={`sector-${sec.id}`} data={ring}>
            <Layer
              id={`sector-fill-${sec.id}`}
              type="fill"
              paint={{ 'fill-color': color, 'fill-opacity': 0.18 }}
            />
            <Layer
              id={`sector-line-${sec.id}`}
              type="line"
              paint={{ 'line-color': color, 'line-width': 2, 'line-dasharray': [3, 2] }}
            />
          </GeoJSONSource>
        );
      })}
    </>
  );
});

export const TerritoryTopWidget = memo(function TerritoryTopWidget({
  state,
  serverNow,
}: HudWidgetProps) {
  const tp = state.game.territory_pulse;
  if (!tp) return null;

  const nextPulseAt = tp.next_pulse_at;
  const secondsToNext = nextPulseAt
    ? Math.max(0, Math.ceil((Date.parse(nextPulseAt) - serverNow) / 1000))
    : 0;
  const scores = tp.scores || { runner: 0, hunter: 0 };

  return (
    <View style={styles.chipsContainer}>
      <View style={styles.chip}>
        <Text variant="label" style={styles.chipLabel}>
          PULSE
        </Text>
        <Text variant="numeric" style={styles.chipValue}>
          {formatClock(secondsToNext)}
        </Text>
      </View>
      <View style={styles.chip}>
        <Text variant="label" style={styles.chipLabel}>
          DOMINANCE
        </Text>
        <Text variant="numeric" style={[styles.chipValue, { color: '#06B6D4' }]}>
          {scores.runner}
        </Text>
        <Text variant="label" style={{ color: '#8A9BA8', fontSize: 10 }}>
          :
        </Text>
        <Text variant="numeric" style={[styles.chipValue, { color: '#EF4444' }]}>
          {scores.hunter}
        </Text>
      </View>
    </View>
  );
});

export const territoryPulseWidgets: HudWidget[] = [
  {
    id: 'territory_pulse_map_layer',
    slot: 'mapLayer',
    roles: ['runner', 'hunter', 'spectator', 'operator'],
    phases: ['countdown', 'head_start', 'live', 'ended'],
    priority: 10,
    Component: TerritoryMapLayer,
  },
  {
    id: 'territory_pulse_top_widget',
    slot: 'top',
    roles: ['runner', 'hunter', 'spectator', 'operator'],
    phases: ['live'],
    priority: 8,
    Component: TerritoryTopWidget,
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
});

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
  const tp = state.territory_pulse || state.game?.territory_pulse;
  const sectors = tp?.sectors ?? tp?.zones ?? [];
  if (sectors.length === 0) return null;

  return (
    <>
      {sectors.map((sec: any) => {
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
  const tp = state.territory_pulse || state.game?.territory_pulse;
  if (!tp) return null;

  const nextPulseAt = tp.next_pulse_at;
  const secondsToNext = nextPulseAt
    ? Math.max(0, Math.ceil((Date.parse(nextPulseAt) - serverNow) / 1000))
    : 0;
  const scores = tp.scores || { runner: 0, hunter: 0 };
  const sectors = tp.sectors || tp.zones || [];

  const runnerSectors = sectors.filter((s: any) => s.controller === 'runner').length;
  const hunterSectors = sectors.filter((s: any) => s.controller === 'hunter').length;
  const contestedSectors = Math.max(0, 7 - runnerSectors - hunterSectors);

  return (
    <View style={styles.topWidgetWrapper}>
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

      {/* 7-Segment Tactical Territory Dominance Bar */}
      <View style={styles.dominanceBarContainer}>
        <View style={styles.dominanceSegmentRow}>
          {Array.from({ length: 7 }).map((_, idx) => {
            const sec = sectors[idx];
            const color =
              sec?.controller === 'runner'
                ? '#06B6D4'
                : sec?.controller === 'hunter'
                  ? '#EF4444'
                  : '#F59E0B';
            return (
              <View
                key={idx}
                style={[
                  styles.dominanceSegment,
                  { backgroundColor: color },
                ]}
              />
            );
          })}
        </View>
        <View style={styles.dominanceTextRow}>
          <Text style={[styles.dominanceCountText, { color: '#06B6D4' }]}>
            RUNNERS [{runnerSectors}]
          </Text>
          <Text style={styles.dominanceDot}>•</Text>
          <Text style={[styles.dominanceCountText, { color: '#F59E0B' }]}>
            CONTESTED [{contestedSectors}]
          </Text>
          <Text style={styles.dominanceDot}>•</Text>
          <Text style={[styles.dominanceCountText, { color: '#EF4444' }]}>
            HUNTERS [{hunterSectors}]
          </Text>
        </View>
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
  topWidgetWrapper: {
    alignItems: 'center',
    gap: 4,
  },
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
  dominanceBarContainer: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignItems: 'center',
    width: 210,
  },
  dominanceSegmentRow: {
    flexDirection: 'row',
    width: '100%',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    gap: 2,
    marginBottom: 3,
  },
  dominanceSegment: {
    flex: 1,
    height: '100%',
    borderRadius: 1,
  },
  dominanceTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dominanceCountText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 8.5,
    letterSpacing: 0.3,
  },
  dominanceDot: {
    color: '#475569',
    fontSize: 7,
  },
});

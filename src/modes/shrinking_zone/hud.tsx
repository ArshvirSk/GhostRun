import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import type { HudWidget, HudWidgetProps } from '../types';

export const ShrinkingZoneBanner = memo(function ShrinkingZoneBanner({
  state,
}: HudWidgetProps) {
  const area = state.game.area;
  if (!area?.shrinking && !area?.zone_stage) return null;

  return (
    <View style={styles.banner}>
      <MaterialCommunityIcons color="#F59E0B" name="arrow-collapse-all" size={16} />
      <Text variant="label" style={styles.text}>
        ZONE SHRINKING: Stage {area.zone_stage || 1} Active ({area.radius_m}m)
      </Text>
    </View>
  );
});

export const shrinkingZoneWidgets: HudWidget[] = [
  {
    id: 'shrinking_zone_banner',
    slot: 'banner',
    roles: ['runner', 'hunter', 'solo', 'spectator', 'operator'],
    phases: ['live'],
    priority: 3,
    Component: ShrinkingZoneBanner,
  },
];

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#F59E0B',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '700',
  },
});

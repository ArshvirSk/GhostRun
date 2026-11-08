import React, { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import type { HudWidget, HudWidgetProps } from '../types';

export const HeatProbeButton = memo(function HeatProbeButton({
  state,
  actions,
}: HudWidgetProps) {
  const [pressing, setPressing] = useState(false);
  const charges = state.heat_charges ?? 6;

  const handlePress = async () => {
    setPressing(true);
    await actions.heatPress();
    setPressing(false);
  };

  return (
    <Pressable
      accessibilityLabel={`Probe proximity with Heat. ${charges} charges remaining`}
      accessibilityRole="button"
      disabled={pressing || charges <= 0}
      onPress={handlePress}
      style={[styles.heatButton, charges <= 0 && styles.disabled]}
    >
      {pressing ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <>
          <MaterialCommunityIcons color="#FFFFFF" name="radar" size={18} />
          <Text variant="label" style={styles.heatText}>
            HEAT ({charges})
          </Text>
        </>
      )}
    </Pressable>
  );
});

export const HeatResultOverlay = memo(function HeatResultOverlay({
  state,
}: HudWidgetProps) {
  const latestMark = state.heat_marks?.[0];
  if (!latestMark) return null;

  const ageS = (Date.now() - Date.parse(latestMark.pressed_at)) / 1000;
  if (ageS > 4) return null;

  const isHot = latestMark.result === 'hot';
  const color = isHot ? 'rgba(239, 68, 68, 0.35)' : 'rgba(59, 130, 246, 0.35)';

  return (
    <View pointerEvents="none" style={[styles.overlay, { backgroundColor: color }]}>
      <Text variant="title" style={styles.overlayText}>
        {isHot ? '🔥 HOT — RUNNER WITHIN PROXIMITY!' : '❄️ COLD — NO RUNNERS DETECTED'}
      </Text>
    </View>
  );
});

export const hotColdWidgets: HudWidget[] = [
  {
    id: 'hot_cold_probe_button',
    slot: 'actions',
    roles: ['hunter'],
    phases: ['live'],
    priority: 2,
    Component: HeatProbeButton,
  },
  {
    id: 'hot_cold_result_overlay',
    slot: 'overlay',
    roles: ['hunter'],
    phases: ['live'],
    priority: 10,
    Component: HeatResultOverlay,
  },
];

const styles = StyleSheet.create({
  heatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EA580C',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  disabled: {
    opacity: 0.5,
  },
  heatText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 40,
  },
  overlayText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 18,
    textShadowColor: '#000',
    textShadowRadius: 8,
  },
});

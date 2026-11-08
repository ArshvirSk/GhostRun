import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import type { HudWidget, HudWidgetProps } from '../types';

export const AiGmDispatchBanner = memo(function AiGmDispatchBanner({
  state,
}: HudWidgetProps) {
  const gm = state.ai_gm;
  if (!gm?.is_active || !gm.last_narration) return null;

  return (
    <View style={styles.banner}>
      <View style={styles.header}>
        <MaterialCommunityIcons color="#38BDF8" name="broadcast" size={16} />
        <Text variant="mono" style={styles.title}>
          {gm.last_title ? gm.last_title.toUpperCase() : 'GAME MASTER DISPATCH'}
        </Text>
        {gm.fog_active && (
          <View style={styles.fogPill}>
            <Ionicons color="#E0F2FE" name="cloudy" size={12} />
            <Text variant="label" style={styles.fogPillText}>
              FOG
            </Text>
          </View>
        )}
      </View>
      <Text variant="body" style={styles.narration}>
        {gm.last_narration}
      </Text>
    </View>
  );
});

export const AiGmFogOverlay = memo(function AiGmFogOverlay({
  state,
}: HudWidgetProps) {
  if (!state.ai_gm?.fog_active) return null;

  return (
    <View pointerEvents="none" style={styles.fogOverlay}>
      <View style={styles.fogHaze} />
    </View>
  );
});

export const aiGmWidgets: HudWidget[] = [
  {
    id: 'ai_gm_dispatch_banner',
    slot: 'banner',
    roles: ['runner', 'hunter', 'solo', 'spectator', 'operator'],
    phases: ['live'],
    priority: 9,
    Component: AiGmDispatchBanner,
  },
  {
    id: 'ai_gm_fog_overlay',
    slot: 'overlay',
    roles: ['runner', 'hunter', 'solo', 'spectator', 'operator'],
    phases: ['live'],
    priority: 5,
    Component: AiGmFogOverlay,
  },
];

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#0C4A6E',
    borderWidth: 1,
    borderColor: '#38BDF8',
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 10,
    fontWeight: '800',
    color: '#38BDF8',
    letterSpacing: 0.5,
    flex: 1,
  },
  fogPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0284C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  fogPillText: {
    fontSize: 9,
    color: '#E0F2FE',
    fontWeight: '700',
  },
  narration: {
    fontSize: 12,
    color: '#F0F9FF',
    lineHeight: 16,
  },
  fogOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 25,
  },
  fogHaze: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
});

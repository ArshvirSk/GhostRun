import React, { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import type { HudWidget, HudWidgetProps } from '../types';

export const DeadDropClaimButton = memo(function DeadDropClaimButton({
  state,
  actions,
}: HudWidgetProps) {
  const [claiming, setClaiming] = useState(false);
  const drops = (state as any)?.nearby_drops ?? [];
  const claimable = drops.find((d: any) => d.claimable);

  if (!claimable) return null;

  const handleClaim = async () => {
    setClaiming(true);
    await actions.claimDrop(claimable.id);
    setClaiming(false);
  };

  return (
    <Pressable
      accessibilityLabel="Claim tactical dead drop"
      accessibilityRole="button"
      disabled={claiming}
      onPress={handleClaim}
      style={styles.claimButton}
    >
      {claiming ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <>
          <MaterialCommunityIcons color="#FFFFFF" name="cube-outline" size={18} />
          <Text variant="label" style={styles.claimText}>
            CLAIM DROP
          </Text>
        </>
      )}
    </Pressable>
  );
});

export const deadDropsWidgets: HudWidget[] = [
  {
    id: 'dead_drops_claim_button',
    slot: 'actions',
    roles: ['runner', 'hunter'],
    phases: ['live'],
    priority: 3,
    Component: DeadDropClaimButton,
  },
];

const styles = StyleSheet.create({
  claimButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#7C3AED',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  claimText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
});

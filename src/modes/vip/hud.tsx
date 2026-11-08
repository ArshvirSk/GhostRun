import React, { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import type { HudWidget, HudWidgetProps } from '../types';

export const VipStatusBanner = memo(function VipStatusBanner({
  state,
}: HudWidgetProps) {
  const self = state.players.find((p) => p.id === state.my_player_id);
  const isVip = self?.secret_role === 'vip';
  const isFrozen = !!self?.frozen_until && Date.parse(self.frozen_until) > Date.now();

  if (isFrozen) {
    return (
      <View style={styles.frozenBanner}>
        <MaterialCommunityIcons color="#38BDF8" name="snowflake" size={18} />
        <Text variant="label" style={{ color: '#38BDF8' }}>
          BODYGUARD IMMOBILIZED (FROZEN FOR 60s)
        </Text>
      </View>
    );
  }

  if (isVip) {
    return (
      <View style={styles.vipBanner}>
        <MaterialCommunityIcons color="#F59E0B" name="crown" size={18} />
        <Text variant="label" style={{ color: '#F59E0B' }}>
          YOU ARE THE VIP — EVADE HUNTERS AT ALL COSTS!
        </Text>
      </View>
    );
  }

  return null;
});

export const VipSwapButton = memo(function VipSwapButton({
  state,
  actions,
}: HudWidgetProps) {
  const [swapping, setSwapping] = useState(false);
  const self = state.players.find((p) => p.id === state.my_player_id);
  const isBodyguard = self?.secret_role === 'bodyguard';
  const vipPlayer = state.players.find((p) => p.secret_role === 'vip');

  if (!isBodyguard || !vipPlayer) return null;

  const handleSwap = async () => {
    setSwapping(true);
    await actions.requestRoleSwap(vipPlayer.id);
    setSwapping(false);
  };

  return (
    <Pressable
      accessibilityLabel="Request tactical role swap with VIP"
      accessibilityRole="button"
      disabled={swapping}
      onPress={handleSwap}
      style={styles.swapBtn}
    >
      {swapping ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <>
          <MaterialCommunityIcons color="#FFFFFF" name="account-switch" size={16} />
          <Text variant="label" style={styles.swapText}>
            SWAP ROLE
          </Text>
        </>
      )}
    </Pressable>
  );
});

export const vipWidgets: HudWidget[] = [
  {
    id: 'vip_status_banner',
    slot: 'banner',
    roles: ['runner'],
    phases: ['live'],
    priority: 7,
    Component: VipStatusBanner,
  },
  {
    id: 'vip_swap_button',
    slot: 'actions',
    roles: ['runner'],
    phases: ['live'],
    priority: 2,
    Component: VipSwapButton,
  },
];

const styles = StyleSheet.create({
  vipBanner: {
    marginHorizontal: 16,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#451A03',
    borderWidth: 1,
    borderColor: '#F59E0B',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  frozenBanner: {
    marginHorizontal: 16,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#082F49',
    borderWidth: 1,
    borderColor: '#38BDF8',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#D97706',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  swapText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
});

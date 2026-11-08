import React, { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import type { HudWidget, HudWidgetProps } from '../types';

export const DoubleAgentControls = memo(function DoubleAgentControls({
  state,
  actions,
}: HudWidgetProps) {
  const [whispering, setWhispering] = useState(false);
  const [whisperResult, setWhisperResult] = useState<string | null>(null);

  const self = state.players.find((p) => p.id === state.my_player_id);
  const isAgent = self?.secret_role === 'agent' || self?.secret_role === 'double_agent';

  if (!isAgent) return null;

  const handleWhisper = async () => {
    setWhispering(true);
    const res = await actions.agentWhisper();
    if (res.ok && res.quadrant) {
      setWhisperResult(res.quadrant);
    }
    setWhispering(false);
  };

  return (
    <View style={styles.agentDock}>
      <View style={styles.header}>
        <MaterialCommunityIcons color="#A855F7" name="incognito" size={18} />
        <Text variant="mono" style={styles.title}>
          DOUBLE AGENT POWERS
        </Text>
      </View>

      <View style={styles.actionsRow}>
        <Pressable
          accessibilityLabel="Whisper secret target quadrant"
          accessibilityRole="button"
          disabled={whispering || !!whisperResult}
          onPress={handleWhisper}
          style={[styles.powerBtn, !!whisperResult && styles.powerUsed]}
        >
          {whispering ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text variant="label" style={styles.powerBtnText}>
              {whisperResult ? `TARGET: ${whisperResult}` : 'WHISPER TARGET'}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
});

export const doubleAgentWidgets: HudWidget[] = [
  {
    id: 'double_agent_controls',
    slot: 'sheet',
    roles: ['hunter'],
    phases: ['live'],
    priority: 5,
    Component: DoubleAgentControls,
  },
];

const styles = StyleSheet.create({
  agentDock: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#1E1B4B',
    borderWidth: 1,
    borderColor: '#6366F1',
    gap: 8,
    marginVertical: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 10,
    fontWeight: '800',
    color: '#A855F7',
    letterSpacing: 0.5,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  powerBtn: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  powerUsed: {
    backgroundColor: '#312E81',
  },
  powerBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});

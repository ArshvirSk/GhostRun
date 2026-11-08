import React, { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import type { HudWidget, HudWidgetProps } from '../types';

export const HunterTagButton = memo(function HunterTagButton({
  actions,
}: HudWidgetProps) {
  const [tagging, setTagging] = useState(false);

  const handleTag = async () => {
    setTagging(true);
    await actions.attemptTag();
    setTagging(false);
  };

  return (
    <Pressable
      accessibilityLabel="Attempt tag on nearby runner"
      accessibilityRole="button"
      disabled={tagging}
      onPress={handleTag}
      style={styles.tagButton}
    >
      {tagging ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <>
          <MaterialCommunityIcons color="#FFFFFF" name="hand-back-right" size={20} />
          <Text variant="label" style={styles.tagText}>
            TAG
          </Text>
        </>
      )}
    </Pressable>
  );
});

export const tagHuntWidgets: HudWidget[] = [
  {
    id: 'tag_hunt_tag_button',
    slot: 'actions',
    roles: ['hunter'],
    phases: ['live'],
    priority: 1,
    Component: HunterTagButton,
  },
];

const styles = StyleSheet.create({
  tagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
  tagText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1,
  },
});

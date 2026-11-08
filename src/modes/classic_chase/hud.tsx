import React, { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import type { HudWidget, HudWidgetProps } from '../types';
import { distanceM } from '../../lib/geo';

export const ClassicTagButton = memo(function ClassicTagButton({
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

export const ClassicArrivalBanner = memo(function ClassicArrivalBanner({
  state,
  ownFix,
}: HudWidgetProps) {
  if (!state.target || !ownFix) return null;
  const dist = distanceM(ownFix, state.target);
  const targetRadius = state.game.target_radius_m || 25;

  if (dist > targetRadius * 2) return null;

  const isInside = dist <= targetRadius;

  return (
    <View style={[styles.arrivalBanner, isInside && styles.arrivalInside]}>
      <Ionicons
        color={isInside ? '#10B981' : '#DB2777'}
        name={isInside ? 'checkmark-circle' : 'flag'}
        size={18}
      />
      <Text variant="label" style={{ color: isInside ? '#10B981' : '#FFFFFF' }}>
        {isInside
          ? 'EXTRACTION ZONE REACHED! Hold to win.'
          : `EXTRACTION ZONE: ${Math.round(dist)}m away`}
      </Text>
    </View>
  );
});

export const classicChaseWidgets: HudWidget[] = [
  {
    id: 'classic_chase_tag_button',
    slot: 'actions',
    roles: ['hunter'],
    phases: ['live'],
    priority: 1,
    Component: ClassicTagButton,
  },
  {
    id: 'classic_chase_arrival_banner',
    slot: 'banner',
    roles: ['runner'],
    phases: ['live'],
    priority: 5,
    Component: ClassicArrivalBanner,
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
  arrivalBanner: {
    marginHorizontal: 16,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#DB2777',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  arrivalInside: {
    borderColor: '#10B981',
    backgroundColor: '#064E3B',
  },
});

import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface MatchDurationTimelineProps {
  headStartS?: number;
  durationMinutes?: number;
  regroupMinutes?: number;
  style?: ViewStyle;
}

/**
 * MatchDurationTimeline
 * Displays match duration as a 3-segment tactical timeline formula:
 * [ START / HEAD START ] ▸ [ ACTIVE PLAY / CHASE ] ▸ [ END / REGROUP ]
 */
export function MatchDurationTimeline({
  headStartS = 90,
  durationMinutes = 15,
  regroupMinutes = 2,
  style,
}: MatchDurationTimelineProps): React.JSX.Element {
  const { colors, radii, spacing } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.borderDark,
          borderRadius: radii.md,
          padding: spacing.sm,
        },
        style,
      ]}
    >
      <View style={styles.segmentsRow}>
        {/* 1. START / HEAD START */}
        <View style={styles.segment}>
          <Text variant="caption" weight="bold" style={{ color: colors.warning, fontSize: 10 }}>
            START
          </Text>
          <Text variant="body" weight="heavy" style={{ color: colors.text, fontSize: 13, marginTop: 1 }}>
            {headStartS}s
          </Text>
          <Text variant="caption" numberOfLines={1} style={{ color: colors.textMuted, fontSize: 9 }}>
            Head Start
          </Text>
        </View>

        <Text variant="mono" style={{ color: colors.textSubtle, marginHorizontal: 4 }}>
          ▸
        </Text>

        {/* 2. MAIN ACTIVE PLAY */}
        <View style={[styles.segment, styles.activeSegment, { borderColor: colors.primary, backgroundColor: 'rgba(199, 243, 107, 0.08)' }]}>
          <Text variant="caption" weight="bold" style={{ color: colors.primary, fontSize: 10 }}>
            ACTIVE PLAY
          </Text>
          <Text variant="body" weight="heavy" style={{ color: colors.primary, fontSize: 14, marginTop: 1 }}>
            {durationMinutes}m
          </Text>
          <Text variant="caption" numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 9 }}>
            Main Survival
          </Text>
        </View>

        <Text variant="mono" style={{ color: colors.textSubtle, marginHorizontal: 4 }}>
          ▸
        </Text>

        {/* 3. REGROUP / END */}
        <View style={styles.segment}>
          <Text variant="caption" weight="bold" style={{ color: colors.accent, fontSize: 10 }}>
            REGROUP
          </Text>
          <Text variant="body" weight="heavy" style={{ color: colors.text, fontSize: 13, marginTop: 1 }}>
            {regroupMinutes}m
          </Text>
          <Text variant="caption" numberOfLines={1} style={{ color: colors.textMuted, fontSize: 9 }}>
            Rally & Debrief
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    marginVertical: 6,
  },
  segmentsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRadius: 8,
  },
  activeSegment: {
    borderWidth: 1,
  },
});

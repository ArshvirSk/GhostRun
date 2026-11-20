import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { evaluateAreaCompatibility } from '../lib/areaCompatibility';
import { Text } from './Text';

export interface AreaCompatibilityBadgeProps {
  radiusM: number;
  durationMinutes: number;
  showDetail?: boolean;
  style?: ViewStyle;
}

/**
 * AreaCompatibilityBadge
 * Evaluates whether area radius and match duration are physically
 * traversable on foot and displays a high-contrast tactical compatibility badge.
 */
export function AreaCompatibilityBadge({
  radiusM,
  durationMinutes,
  showDetail = false,
  style,
}: AreaCompatibilityBadgeProps): React.JSX.Element {
  const { colors, radii, spacing } = useTheme();
  const evaluation = evaluateAreaCompatibility(radiusM, durationMinutes);

  const isOptimal = evaluation.status === 'optimal';
  const badgeColor = isOptimal ? colors.success : colors.warning;
  const badgeBg = isOptimal ? 'rgba(199, 243, 107, 0.12)' : 'rgba(251, 191, 36, 0.12)';
  const badgeBorder = isOptimal ? 'rgba(199, 243, 107, 0.35)' : 'rgba(251, 191, 36, 0.35)';

  return (
    <View style={[styles.container, style]}>
      <View
        style={[
          styles.badge,
          {
            backgroundColor: badgeBg,
            borderColor: badgeBorder,
            borderRadius: radii.sm,
            paddingVertical: spacing.xs,
            paddingHorizontal: spacing.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          },
        ]}
      >
        <Ionicons
          name={isOptimal ? 'checkmark-circle' : 'alert-circle'}
          size={13}
          color={badgeColor}
        />
        <Text variant="caption" weight="bold" style={{ color: badgeColor, fontSize: 11, letterSpacing: 0.5 }}>
          {evaluation.badgeLabel}
        </Text>
      </View>

      {showDetail ? (
        <Text
          variant="caption"
          style={{
            color: colors.textMuted,
            fontSize: 11,
            lineHeight: 15,
            marginTop: 4,
            paddingHorizontal: 2,
          }}
        >
          {evaluation.detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
});

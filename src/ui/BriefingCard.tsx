import React, { useState } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { Card } from './Card';
import { Chip } from './Chip';
import { Button } from './Button';

export interface BriefingCardProps {
  codename: string;
  roleName?: string;
  roleTitle?: string;
  role?: string;
  tagline?: string;
  briefing?: string;
  intel?: string[];
  intelDirectives?: string[];
  complexity?: 'low' | 'high';
  isSecret?: boolean;
  onAcknowledge?: () => void;
  acknowledged?: boolean;
  style?: ViewStyle;
}

export function BriefingCard({
  codename,
  roleName,
  roleTitle,
  role,
  tagline,
  briefing,
  intel,
  intelDirectives,
  complexity = 'low',
  isSecret = false,
  onAcknowledge,
  acknowledged = false,
  style,
}: BriefingCardProps) {
  const { colors, radii } = useTheme();
  const [localAck, setLocalAck] = useState(acknowledged);

  const displayRoleName = roleTitle || roleName || role?.toUpperCase() || 'OPERATIVE';
  const displayTagline = briefing || tagline;
  const displayIntel = intelDirectives || intel || [];

  const handleToggleAck = () => {
    const next = !localAck;
    setLocalAck(next);
    if (next) {
      onAcknowledge?.();
    }
  };

  const isHighComplexity = complexity === 'high';

  return (
    <Card
      variant={isSecret ? 'accent' : 'default'}
      padding="md"
      style={style}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleArea}>
          <View style={styles.badgeRow}>
            {isSecret && (
              <Chip
                label="CONFIDENTIAL ROLE"
                variant="danger"
                icon={<Ionicons color={colors.danger} name="eye-off" size={12} />}
              />
            )}
            <Chip
              label={`COMPLEXITY: ${complexity.toUpperCase()}`}
              variant={isHighComplexity ? 'hunter' : 'muted'}
            />
          </View>
          <Text variant="headline" style={{ color: colors.text, marginTop: 4 }}>
            {displayRoleName}
          </Text>
          <Text variant="mono" style={{ color: colors.accent, fontSize: 11 }}>
            CODENAME: {codename}
          </Text>
          {displayTagline && (
            <Text variant="caption" style={{ color: colors.textMuted, marginTop: 4 }}>
              {displayTagline}
            </Text>
          )}
        </View>
      </View>

      {/* Intel Bullet Points */}
      <View style={[styles.intelList, { borderColor: colors.borderDark }]}>
        <Text variant="label" style={{ color: colors.textMuted, marginBottom: 4 }}>
          MISSION INTEL
        </Text>
        {displayIntel.map((item, idx) => (
          <View key={idx} style={styles.intelRow}>
            <MaterialCommunityIcons
              color={colors.accent}
              name="chevron-right"
              size={18}
              style={{ marginTop: 2 }}
            />
            <Text variant="body" style={{ color: colors.text, flex: 1, fontSize: 13, lineHeight: 18 }}>
              {item}
            </Text>
          </View>
        ))}
      </View>

      {/* High Complexity Acknowledgement */}
      {isHighComplexity && onAcknowledge && (
        <View style={[styles.ackContainer, { backgroundColor: colors.surfaceElevated, borderRadius: radii.md }]}>
          <View style={styles.ackInfo}>
            <Ionicons color={colors.warning} name="information-circle" size={20} />
            <Text variant="caption" style={{ color: colors.textMuted, flex: 1 }}>
              This role introduces advanced match mechanics. Confirm you understand your tactical briefing.
            </Text>
          </View>
          <Button
            size="sm"
            variant={localAck ? 'ghost' : 'hunter'}
            title={localAck ? 'BRIEFING ACKNOWLEDGED ✓' : 'I UNDERSTAND MY ROLE'}
            onPress={handleToggleAck}
            fullWidth
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  titleArea: {
    flex: 1,
    gap: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  intelList: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  intelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  ackContainer: {
    marginTop: 16,
    padding: 12,
    gap: 10,
  },
  ackInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});

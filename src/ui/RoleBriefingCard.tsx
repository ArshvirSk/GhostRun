import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { Card } from './Card';
import { Chip } from './Chip';
import { Button } from './Button';
import { triggerHaptic } from '../motion/haptics';

export interface RoleIntel {
  id: string;
  name: string;
  complexity: 'standard' | 'high';
  objective: string;
  duties: string[];
  classification: string;
}

const ROLE_INTEL: Record<string, RoleIntel> = {
  double_agent: {
    id: 'double_agent',
    name: 'Double Agent',
    complexity: 'high',
    classification: 'TOP SECRET · EYES ONLY',
    objective: 'Sabotage hunter tracking from within without blowing your cover.',
    duties: [
      'Transmit decoy pings and whisper runner quadrant hints.',
      'Arm scrambles on suspect hunters to jam their radars.',
      'Survive tribunal votes without being exposed.',
    ],
  },
  vip: {
    id: 'vip',
    name: 'VIP Escort',
    complexity: 'high',
    classification: 'HIGH VALUE TARGET',
    objective: 'Reach the designated extraction perimeter alive under bodyguard cover.',
    duties: [
      'Coordinate movement with escort runners.',
      'Avoid high-exposure corridors and choke points.',
      'Touch down at the extraction point to secure team victory.',
    ],
  },
  operator: {
    id: 'operator',
    name: 'Tactical Operator',
    complexity: 'high',
    classification: 'COMMAND CONSOLE',
    objective: 'Provide eyes-in-the-sky intelligence and tactical routing to field agents.',
    duties: [
      'Monitor satellite sweeps and real-time movement feeds.',
      'Flag high-risk vectors and direct team intercepts.',
      'Deploy tactical radar scans when available.',
    ],
  },
  hunter: {
    id: 'hunter',
    name: 'Hunter Unit',
    complexity: 'standard',
    classification: 'TACTICAL INTERCEPTOR',
    objective: 'Locate and tag all active runners before the round expires.',
    duties: [
      'Analyze periodic radar pings to deduce runner vectors.',
      'Deploy heat probes when within close proximity.',
      'Execute proximity tags (<15m) to eliminate targets.',
    ],
  },
  runner: {
    id: 'runner',
    name: 'Runner Operative',
    complexity: 'standard',
    classification: 'EVASION SPECIALIST',
    objective: 'Evade hunter interception and reach objectives before time runs out.',
    duties: [
      'Keep moving after radar pings reveal your historic coordinates.',
      'Utilize natural terrain and concealment corridors.',
      'Reach the target or outlast the round clock.',
    ],
  },
};

export interface RoleBriefingCardProps {
  roleId: string;
  team?: 'runner' | 'hunter' | 'unassigned';
  acknowledged?: boolean;
  onToggleAcknowledge?: (ack: boolean) => void;
}

export function RoleBriefingCard({
  roleId,
  team,
  acknowledged = false,
  onToggleAcknowledge,
}: RoleBriefingCardProps) {
  const { colors, spacing } = useTheme();

  // Resolve intel
  const intelKey = roleId || (team === 'hunter' ? 'hunter' : 'runner');
  const intel = ROLE_INTEL[intelKey] ?? {
    id: intelKey,
    name: intelKey.replace(/_/g, ' ').toUpperCase(),
    complexity: 'standard' as const,
    classification: 'CONFIDENTIAL',
    objective: 'Follow team mission parameters and coordinate with operatives.',
    duties: ['Maintain tactical readiness and situational awareness.'],
  };

  const isHighComplexity = intel.complexity === 'high';

  return (
    <Card
      variant={isHighComplexity ? 'elevated' : 'default'}
      style={[
        styles.container,
        {
          borderColor: isHighComplexity ? colors.warning : colors.borderDark,
          borderWidth: 1,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <MaterialCommunityIcons
            name={isHighComplexity ? 'shield-alert-outline' : 'shield-account-outline'}
            size={20}
            color={isHighComplexity ? colors.warning : colors.primary}
          />
          <Text variant="label" style={{ color: colors.textMuted, marginLeft: spacing.xs }}>
            {intel.classification}
          </Text>
        </View>
        <Chip
          label={isHighComplexity ? 'COMPLEXITY: HIGH' : 'STANDARD'}
          variant={isHighComplexity ? 'warning' : 'muted'}
          size="sm"
        />
      </View>

      <Text variant="title" style={{ marginTop: spacing.xs, color: colors.text }}>
        {intel.name}
      </Text>

      <View style={[styles.section, { borderTopColor: colors.borderDark }]}>
        <Text variant="label" style={{ color: colors.textMuted, marginBottom: 2 }}>
          PRIMARY OBJECTIVE
        </Text>
        <Text variant="body" style={{ color: colors.text, lineHeight: 20 }}>
          {intel.objective}
        </Text>
      </View>

      <View style={[styles.section, { borderTopColor: colors.borderDark }]}>
        <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
          TACTICAL DIRECTIVES
        </Text>
        {intel.duties.map((duty, idx) => (
          <View key={idx} style={styles.dutyRow}>
            <Text variant="mono" style={{ color: colors.primary, marginRight: spacing.xs }}>
              0{idx + 1}.
            </Text>
            <Text variant="body" style={{ color: colors.textMuted, flex: 1, fontSize: 13, lineHeight: 18 }}>
              {duty}
            </Text>
          </View>
        ))}
      </View>

      {isHighComplexity && (
        <View style={[styles.ackContainer, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}>
          <View style={styles.ackTextWrap}>
            <Text variant="label" style={{ color: colors.warning }}>
              MANDATORY BRIEFING ACKNOWLEDGEMENT
            </Text>
            <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
              High-complexity roles require briefing confirmation before ready-up.
            </Text>
          </View>
          <Button
            title={acknowledged ? 'ACKNOWLEDGED' : 'ACKNOWLEDGE ROLE'}
            variant={acknowledged ? 'secondary' : 'primary'}
            size="sm"
            icon={acknowledged ? 'checkmark-circle' : 'shield-checkmark-outline'}
            onPress={() => {
              triggerHaptic('buttonTap');
              onToggleAcknowledge?.(!acknowledged);
            }}
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  section: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  dutyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  ackContainer: {
    marginTop: 14,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'column',
    gap: 10,
  },
  ackTextWrap: {
    flex: 1,
  },
});

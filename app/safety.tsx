import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';

export default function SafetyScreen() {
  const { colors, spacing, radii } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const rules = [
    {
      title: 'PEDESTRIAN TERRAIN ONLY',
      icon: 'walk' as const,
      color: colors.primary,
      body: 'Matches must strictly be held in pedestrian areas such as public parks, sports grounds, and quiet campuses. Never cross busy roads, railway tracks, private property, or hazardous construction zones.',
    },
    {
      title: 'LOOK UP WHILE MOVING',
      icon: 'eye-outline' as const,
      color: colors.warning,
      body: 'GhostRun uses audio and haptic cues so you do not need to look at the screen while sprinting. Check your radar when stopped or in cover, and keep your eyes on the physical path ahead.',
    },
    {
      title: 'VEHICLE DETECTION & SPEED GUARD',
      icon: 'car-off' as const,
      color: colors.danger,
      body: 'Using bicycles, e-scooters, or motor vehicles to gain an evasion advantage is strictly prohibited. The server monitors velocity: sustained movement above 8 m/s (29 km/h) automatically triggers vehicle warnings and halts the round.',
    },
    {
      title: 'EMERGENCY SOS & MATCH PAUSE',
      icon: 'alert-octagon-outline' as const,
      color: colors.danger,
      body: 'The red SOS button is available in the top bar of every game screen. Pressing SOS immediately pauses the active match for everyone, freezes the clock, and alerts all players to stop play and assist.',
    },
    {
      title: 'NIGHT CURFEW & VISIBILITY',
      icon: 'weather-night' as const,
      color: colors.radarScan,
      body: 'For games configured after sunset, hosts must enforce curfew limits. Wear high-visibility clothing or reflective markers, avoid unlit isolated trails, and never play alone in unfamiliar areas.',
    },
    {
      title: 'AGE & SUPERVISION POLICY',
      icon: 'account-child-circle' as const,
      color: colors.ghostTrail,
      body: 'GhostRun requires players to be 18 years or older, or playing under direct guardian supervision. Hosts must ensure that all participants are physically fit and capable of outdoor jogging/running.',
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: spacing.lg,
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 32,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.backRow}
        >
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
          <Text variant="label" style={{ color: colors.primary, marginLeft: spacing.xs }}>
            BACK
          </Text>
        </Pressable>

        <Text variant="display" style={{ color: colors.text, marginTop: spacing.md }}>
          SAFETY PROTOCOL
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg }}>
          Mandatory outdoor guidelines and safety mechanisms for GhostRun operations.
        </Text>

        <Card
          variant="elevated"
          style={[
            styles.alertCard,
            { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder, marginBottom: spacing.lg },
          ]}
        >
          <View style={styles.alertHeader}>
            <MaterialCommunityIcons name="alert-circle" size={24} color={colors.danger} />
            <Text variant="title" style={{ color: colors.dangerText, marginLeft: spacing.sm, flex: 1 }}>
              REAL-WORLD SAFETY FIRST
            </Text>
          </View>
          <Text variant="body" style={{ color: colors.dangerText, marginTop: spacing.xs, fontSize: 13, lineHeight: 18 }}>
            No in-game objective, high score, or escape is worth physical injury. If conditions become hazardous, abort the match immediately.
          </Text>
        </Card>

        {rules.map((rule, idx) => (
          <Card key={idx} variant="default" style={[styles.ruleCard, { marginBottom: spacing.md }]}>
            <View style={styles.ruleHeader}>
              <MaterialCommunityIcons name={rule.icon} size={20} color={rule.color} />
              <Text variant="label" style={{ color: rule.color, marginLeft: spacing.xs }}>
                {rule.title}
              </Text>
            </View>
            <Text variant="body" style={{ color: colors.text, marginTop: spacing.sm, lineHeight: 20 }}>
              {rule.body}
            </Text>
          </Card>
        ))}

        <View style={[styles.footerNote, { backgroundColor: colors.surface, borderRadius: radii.card, padding: spacing.md }]}>
          <Text variant="label" style={{ color: colors.textMuted }}>
            GUARDIAN & EVENT HOST RESPONSIBILITY
          </Text>
          <Text variant="caption" style={{ color: colors.textMuted, marginTop: 4, lineHeight: 18 }}>
            Game hosts must inspect the play boundary prior to launching a match. Verify that terrain is free of hazards and that emergency contacts are accessible.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 48,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  alertCard: {
    padding: 16,
    borderWidth: 1,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ruleCard: {
    padding: 16,
  },
  ruleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerNote: {
    marginTop: 12,
  },
});

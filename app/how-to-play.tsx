import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';
import { Button } from '../src/ui/Button';

export default function HowToPlayScreen() {
  const { colors, spacing, radii } = useTheme();
  const router = useRouter();

  const sections = [
    {
      title: 'THE GROUND & BOUNDARY',
      icon: 'map-marker-radius-outline' as const,
      color: colors.primary,
      body: 'Every match takes place inside a defined physical boundary. The host sets the perimeter before the round begins. Stepping outside warns you immediately; staying outside reveals extra pings to opponents.',
    },
    {
      title: 'HEAD START & THE SQUEEZE',
      icon: 'timer-sand' as const,
      color: colors.warning,
      body: 'Runners receive a head-start countdown to disperse across the play area. Hunters cannot track or tag until the head-start expires. As time progresses, shrinking zone modifiers or curfews compress the operational area.',
    },
    {
      title: 'RADAR PINGS VS REAL LOCATION',
      icon: 'radar' as const,
      color: colors.radarScan,
      body: 'Hunters do NOT see live dots. Instead, delayed radar pings pulse at configured intervals (e.g. every 60–120s), revealing historic fixes. When a ping triggers, your ghost echo remains where you were—keep moving to maintain evasion.',
    },
    {
      title: 'TAGS & PROXIMITY HEAT',
      icon: 'target' as const,
      color: colors.hunter,
      body: 'Hunters must physically close the distance to within 15 meters to execute a tag. With Hot & Cold active, hunters can deploy heat probes to check if runners are nearby. Failed tags trigger a mandatory tactical cooldown.',
    },
    {
      title: 'SPECIAL ROLES & OBJECTIVES',
      icon: 'shield-account-outline' as const,
      color: colors.ghostTrail,
      body: 'Specialist roles introduce hidden intelligence: Double Agents sabotage hunter tracking from within; VIPs must reach safe extraction zones; Operators coordinate satellite intel for their ground squads.',
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { padding: spacing.lg }]}>
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
          FIELD MANUAL
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg }}>
          GhostRun operational mechanics, evasion tactics, and radar intelligence rules.
        </Text>

        <Card
          variant="elevated"
          style={[
            styles.tourCard,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.borderAccent, marginBottom: spacing.lg },
          ]}
        >
          <View style={styles.tourHeader}>
            <MaterialCommunityIcons name="movie-play-outline" size={24} color={colors.primary} />
            <Text variant="title" style={{ color: colors.text, marginLeft: spacing.sm, flex: 1 }}>
              Interactive Briefing Tour
            </Text>
          </View>
          <Text variant="body" style={{ color: colors.textMuted, marginVertical: spacing.sm, fontSize: 13, lineHeight: 18 }}>
            Experience the real in-game HUD and radar mechanics in an offline 8-beat tactical simulation.
          </Text>
          <Button
            title="Launch Briefing Tour"
            variant="primary"
            size="sm"
            onPress={() => router.push('/briefing' as any)}
          />
        </Card>

        {sections.map((sec, idx) => (
          <Card key={idx} variant="default" style={[styles.sectionCard, { marginBottom: spacing.md }]}>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name={sec.icon} size={20} color={sec.color} />
              <Text variant="label" style={{ color: sec.color, marginLeft: spacing.xs }}>
                {sec.title}
              </Text>
            </View>
            <Text variant="body" style={{ color: colors.text, marginTop: spacing.sm, lineHeight: 20 }}>
              {sec.body}
            </Text>
          </Card>
        ))}

        <View style={[styles.footerCard, { backgroundColor: colors.surface, borderRadius: radii.card, padding: spacing.md }]}>
          <Text variant="label" style={{ color: colors.textMuted }}>
            SAFETY & FAIR PLAY
          </Text>
          <Text variant="caption" style={{ color: colors.textMuted, marginTop: 4, lineHeight: 18 }}>
            Always prioritize physical safety over tactical objectives. Look up while running, avoid traffic, and obey local laws.
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/safety' as any)}
            style={{ marginTop: spacing.sm }}
          >
            <Text variant="label" style={{ color: colors.primary }}>
              READ SAFETY PROTOCOL →
            </Text>
          </Pressable>
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
  tourCard: {
    padding: 16,
    borderWidth: 1,
  },
  tourHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionCard: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerCard: {
    marginTop: 12,
  },
});

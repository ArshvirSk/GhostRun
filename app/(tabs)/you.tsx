import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Card } from '../../src/ui/Card';
import { Button } from '../../src/ui/Button';
import { supabase } from '../../src/lib/supabase';

export default function YouTab() {
  const { colors, spacing, radii } = useTheme();
  const router = useRouter();
  const [profile, setProfile] = useState<{ display_name: string; color: string } | null>(null);

  useEffect(() => {
    async function load() {
      if (!supabase) return;
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        const { data } = await supabase
          .from('profiles')
          .select('display_name, color')
          .eq('id', userData.user.id)
          .maybeSingle();
        if (data) setProfile(data);
      }
    }
    void load();
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { padding: spacing.lg }]}>
        <View style={styles.topRow}>
          <Text variant="display" style={{ color: colors.text, marginTop: spacing.xl }}>
            CASE FILE
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => router.push('/settings' as any)}
            style={[styles.settingsButton, { backgroundColor: colors.surface, marginTop: spacing.xl }]}
          >
            <Ionicons name="settings-sharp" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        <Card variant="default" style={{ marginTop: spacing.md, padding: spacing.lg }}>
          <View style={styles.profileRow}>
            <View
              style={[
                styles.colorDot,
                { backgroundColor: profile?.color || colors.accent, borderRadius: radii.sm },
              ]}
            />
            <View>
              <Text variant="title" style={{ color: colors.text }}>
                {profile?.display_name || 'Agent'}
              </Text>
              <Text variant="label" style={{ color: colors.textMuted }}>
                STATUS: ACTIVE OPERATIVE
              </Text>
            </View>
          </View>
        </Card>

        {/* Stats Grid Preview */}
        <View style={[styles.statsGrid, { marginTop: spacing.lg }]}>
          <Card variant="elevated" style={styles.statCard}>
            <Text variant="display" style={{ color: colors.accent }}>
              0
            </Text>
            <Text variant="label" style={{ color: colors.textMuted }}>
              ROUNDS
            </Text>
          </Card>
          <Card variant="elevated" style={styles.statCard}>
            <Text variant="display" style={{ color: colors.text }}>
              0
            </Text>
            <Text variant="label" style={{ color: colors.textMuted }}>
              WON
            </Text>
          </Card>
          <Card variant="elevated" style={styles.statCard}>
            <Text variant="display" style={{ color: colors.radarScan }}>
              --
            </Text>
            <Text variant="label" style={{ color: colors.textMuted }}>
              BEST ESCAPE
            </Text>
          </Card>
          <Card variant="elevated" style={styles.statCard}>
            <Text variant="display" style={{ color: colors.warning }}>
              0m
            </Text>
            <Text variant="label" style={{ color: colors.textMuted }}>
              FARTHEST
            </Text>
          </Card>
        </View>

        <Card variant="default" style={{ marginTop: spacing.xl, padding: spacing.lg }}>
          <Text variant="title" style={{ color: colors.text, marginBottom: spacing.xs }}>
            Empty Case File
          </Text>
          <Text variant="body" style={{ color: colors.textMuted, marginBottom: spacing.md }}>
            No rounds on file. Play a match with your crew and your tactical history fills in here.
          </Text>
          <Button
            title="Privacy & Data Management"
            variant="ghost"
            onPress={() => router.push('/privacy' as any)}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 100,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  colorDot: {
    width: 24,
    height: 24,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    padding: 16,
    alignItems: 'center',
  },
});

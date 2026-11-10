import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { getModeModule } from '../../src/modes/registry';
import { useHostStore } from '../../src/stores/hostStore';
import { triggerHaptic } from '../../src/motion/haptics';
import { supabase } from '../../src/lib/supabase';

export default function HostReviewScreen() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const modeId = useHostStore((s) => s.mode);
  const preset = useHostStore((s) => s.preset);
  const rules = useHostStore((s) => s.rules);
  const selectedModifiers = useHostStore((s) => s.selectedModifiers);
  const selectedRoles = useHostStore((s) => s.selectedRoles);
  const radius = useHostStore((s) => s.radius);
  const placements = useHostStore((s) => s.placements);
  const buildCreateGamePayload = useHostStore((s) => s.buildCreateGamePayload);

  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const modeModule = getModeModule(modeId);

  async function handleCreate() {
    if (!supabase) {
      setErrorMessage('Supabase is not configured yet. Add the project URL and anon key first.');
      return;
    }

    setBusy(true);
    setErrorMessage('');

    try {
      const payload = buildCreateGamePayload();
      const { data, error } = await supabase.rpc('create_game', payload);

      if (error) {
        setErrorMessage(error.message);
        triggerHaptic('error');
        setBusy(false);
        return;
      }

      const created = Array.isArray(data) ? data[0] : data;
      if (!created?.game_id) {
        setErrorMessage('The server did not return the new game. Please try again.');
        triggerHaptic('error');
        setBusy(false);
        return;
      }

      // If mode placed a target or jail, call the placement RPCs
      if (modeId === 'classic_chase' && placements.target) {
        try {
          await supabase.rpc('set_target', {
            game_id: created.game_id,
            lat: placements.target[1],
            lng: placements.target[0],
          });
        } catch {
          // Non-blocking: target can be adjusted in lobby
        }
      } else if (modeId === 'jailbreak' && placements.jail) {
        try {
          await supabase.rpc('set_jail_location', {
            p_game_id: created.game_id,
            p_lat: placements.jail[1],
            p_lng: placements.jail[0],
            p_radius_m: 10,
          });
        } catch {
          // Non-blocking: jail can be placed in lobby
        }
      }

      triggerHaptic('tagConfirmed');
      router.replace({ pathname: '/lobby/[id]', params: { id: created.game_id } });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create game.');
      triggerHaptic('error');
      setBusy(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Header Bar */}
      <View style={[styles.topBar, { paddingHorizontal: spacing.lg, paddingTop: Math.max(insets.top, 16) + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Area"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textMuted} />
        </Pressable>
        <View style={styles.stepIndicator}>
          <Text variant="label" style={{ color: colors.accent }}>
            STEP 5 OF 5
          </Text>
          <Text variant="label" style={{ color: colors.textMuted }}>
            REVIEW & DEPLOY
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: Math.max(insets.bottom, 16) + 90 }]}>
        <Text variant="display" style={{ color: colors.text, marginTop: spacing.sm }}>
          Session Review
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginBottom: spacing.lg }}>
          Verify tactical parameters and safety rules before launching the lobby.
        </Text>

        {/* Mode Overview Card */}
        <Card variant="default" style={{ padding: spacing.lg, marginBottom: spacing.md }}>
          <View style={styles.modeHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text variant="label" style={{ color: colors.accent }}>
                BASE MODE
              </Text>
              <Text variant="display" style={{ color: colors.text, fontSize: 24 }}>
                {modeModule?.name || modeId}
              </Text>
            </View>
            <Chip label={preset.toUpperCase()} variant="accent" size="sm" />
          </View>
          <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs }}>
            {modeModule?.tagline}
          </Text>

          <View style={[styles.metricGrid, { marginTop: spacing.md, paddingTop: spacing.md, borderTopColor: colors.border, borderTopWidth: 1 }]}>
            <View style={styles.metricItem}>
              <Text variant="label" numberOfLines={1} style={[styles.metricLabel, { color: colors.textMuted }]}>DURATION</Text>
              <Text variant="title" numberOfLines={1} style={{ color: colors.text }}>{Math.round(rules.durationS / 60)}m</Text>
            </View>
            <View style={styles.metricItem}>
              <Text variant="label" numberOfLines={1} style={[styles.metricLabel, { color: colors.textMuted }]}>RADAR PING</Text>
              <Text variant="title" numberOfLines={1} style={{ color: colors.radarScan }}>{rules.pingIntervalS}s</Text>
            </View>
            <View style={styles.metricItem}>
              <Text variant="label" numberOfLines={1} style={[styles.metricLabel, { color: colors.textMuted }]}>TAG RADIUS</Text>
              <Text variant="title" numberOfLines={1} style={{ color: colors.warning }}>{rules.tagRadiusM}m</Text>
            </View>
            <View style={styles.metricItem}>
              <Text variant="label" numberOfLines={1} style={[styles.metricLabel, { color: colors.textMuted }]}>BOUNDARY</Text>
              <Text variant="title" numberOfLines={1} style={{ color: colors.text }}>{radius}m</Text>
            </View>
          </View>
        </Card>

        {/* Roles & Modifiers Active */}
        {(selectedRoles.length > 0 || selectedModifiers.length > 0) && (
          <Card variant="default" style={{ padding: spacing.md, marginBottom: spacing.md }}>
            <Text variant="label" style={{ color: colors.radarScan, marginBottom: spacing.sm }}>
              ACTIVE EXTRAS & ROLES
            </Text>
            <View style={styles.chipsWrap}>
              {selectedRoles.map((rId) => (
                <Chip key={rId} label={getModeModule(rId)?.name || rId} variant="accent" size="sm" />
              ))}
              {selectedModifiers.map((mId) => (
                <Chip key={mId} label={getModeModule(mId)?.name || mId} variant="default" size="sm" />
              ))}
            </View>
          </Card>
        )}

        {/* Safety Checklist Card */}
        <Card variant="elevated" style={{ padding: spacing.md, marginBottom: spacing.lg }}>
          <View style={styles.safetyHeader}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
            <Text variant="title" style={{ color: colors.text, fontSize: 15 }}>
              Pedestrian Safety Checklist
            </Text>
          </View>
          <View style={{ marginTop: spacing.sm, gap: 6 }}>
            <Text variant="body" style={{ color: colors.textMuted, fontSize: 13 }}>
              • Pedestrian only: Sustained vehicle speeds will trigger speed alerts.
            </Text>
            <Text variant="body" style={{ color: colors.textMuted, fontSize: 13 }}>
              • Look up while navigating: GPS updates are spaced to avoid continuous screen gazing.
            </Text>
            <Text variant="body" style={{ color: colors.textMuted, fontSize: 13 }}>
              • Emergency SOS: In-game SOS pauses the match immediately for all participants.
            </Text>
          </View>
        </Card>

        {/* Error Card */}
        {errorMessage !== '' && (
          <Card
            variant="danger"
            style={[styles.errorCard, { padding: spacing.md, marginBottom: spacing.lg }]}
          >
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
              <Text variant="body" style={{ color: colors.danger, flex: 1, fontSize: 13 }}>
                {errorMessage}
              </Text>
            </View>
          </Card>
        )}
      </ScrollView>

      {/* Bottom Sticky Action Dock */}
      <View
        style={[
          styles.bottomDock,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
          },
        ]}
      >
        <Button
          title={busy ? 'Initializing Match…' : 'Create Game Lobby'}
          variant="primary"
          size="lg"
          loading={busy}
          disabled={busy}
          onPress={() => void handleCreate()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 8,
  },
  stepIndicator: {
    alignItems: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingBottom: 110,
  },
  modeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  metricGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  metricLabel: {
    fontSize: 9.5,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 2,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  safetyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorCard: {
    borderWidth: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bottomDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
  },
});

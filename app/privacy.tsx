import React, { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';
import { Button } from '../src/ui/Button';
import {
  PRIVACY_CHANGELOG,
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_POLICY_URL,
  PRIVACY_SECTIONS,
  PRIVACY_SHORT_VERSION,
  PRIVACY_VERSION,
} from '../src/lib/privacy';
import { supabase } from '../src/lib/supabase';

type ConsentState = {
  granted: boolean;
  policy_version: number | null;
  created_at: string;
};

type Consents = Partial<Record<string, ConsentState>>;

type GhostRecord = {
  ghost_id: string;
  created_at: string;
  duration_s: number;
  point_count: number;
  difficulty: string;
  expires_at: string;
};

export default function PrivacyScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const isGate = mode === 'gate';

  const [consents, setConsents] = useState<Consents | null>(null);
  const [ghosts, setGhosts] = useState<GhostRecord[]>([]);
  const [deletingGhosts, setDeletingGhosts] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const acknowledgedVersion = consents?.policy_ack?.granted
    ? (consents.policy_ack.policy_version ?? 0)
    : 0;
  const needsAcknowledgement = acknowledgedVersion < PRIVACY_VERSION;

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoadError('');
    const [consentsRes, ghostsRes] = await Promise.all([
      supabase.rpc('get_my_consents'),
      supabase.rpc('list_my_ghosts'),
    ]);
    if (consentsRes.error) {
      setLoadError(consentsRes.error.message);
      return;
    }
    setConsents((consentsRes.data ?? {}) as Consents);
    if (!ghostsRes.error && Array.isArray(ghostsRes.data)) {
      setGhosts(ghostsRes.data as GhostRecord[]);
    }
  }, []);

  async function handleDeleteGhosts() {
    if (!supabase) return;
    setDeletingGhosts(true);
    setActionError('');
    const { data, error } = await supabase.rpc('delete_my_ghosts');
    setDeletingGhosts(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    setToast(`Deleted ${data ?? 0} ghost route(s).`);
    setTimeout(() => setToast(''), 2500);
    await load();
  }

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function setConsent(type: string, granted: boolean) {
    if (!supabase) return;
    setBusy(type);
    setActionError('');
    const { error } = await supabase.rpc('set_consent', {
      consent_type: type,
      granted,
      policy_version: null,
    });
    setBusy('');
    if (error) {
      setActionError(error.message);
      return;
    }
    setToast('Choice saved.');
    setTimeout(() => setToast(''), 1800);
    await load();
  }

  async function acknowledge() {
    if (!supabase || !ageConfirmed) return;
    setBusy('ack');
    setActionError('');
    const { error } = await supabase.rpc('set_consent', {
      consent_type: 'policy_ack',
      granted: true,
      policy_version: PRIVACY_VERSION,
    });
    setBusy('');
    if (error) {
      setActionError(error.message);
      return;
    }
    await AsyncStorage.setItem('@ghostrun:onboarded', 'true');
    router.replace('/play' as any);
  }

  if (!consents && !loadError) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.md }}>
          Loading your privacy choices…
        </Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text variant="body" style={{ color: colors.danger, marginBottom: spacing.md }}>
          {loadError}
        </Text>
        <Button
          title="Try again"
          variant="secondary"
          size="sm"
          onPress={() => void load()}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.screen, { padding: spacing.lg }]}>
        {!isGate && (
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.backRow}
          >
            <Ionicons color={colors.primary} name="chevron-back" size={20} />
            <Text variant="label" style={{ color: colors.primary, marginLeft: spacing.xs }}>
              BACK
            </Text>
          </Pressable>
        )}

        <Text variant="display" style={{ color: colors.text, marginTop: spacing.xs }}>
          PRIVACY PROTOCOL
        </Text>
        <Text variant="caption" style={{ color: colors.textMuted, marginTop: 4 }}>
          Version {PRIVACY_VERSION}.0 · Updated 2026-11-08
        </Text>

        {needsAcknowledgement && (
          <Card
            variant="elevated"
            style={[
              styles.card,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.borderAccent, marginTop: spacing.md },
            ]}
          >
            <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
              {acknowledgedVersion === 0 ? 'Before you play' : 'What changed'}
            </Text>
            {(PRIVACY_CHANGELOG[PRIVACY_VERSION] ?? []).map((line) => (
              <Text key={line} variant="body" style={{ color: colors.textMuted, marginTop: 4, fontSize: 13, lineHeight: 18 }}>
                • {line}
              </Text>
            ))}
          </Card>
        )}

        <Card
          variant="default"
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}
        >
          <Text variant="label" style={{ color: colors.primary, marginBottom: spacing.xs }}>
            THE SHORT VERSION
          </Text>
          {PRIVACY_SHORT_VERSION.map((line) => (
            <Text key={line} variant="body" style={{ color: colors.text, marginTop: 4, fontSize: 13, lineHeight: 18 }}>
              • {line}
            </Text>
          ))}
        </Card>

        {!isGate && (
          <Card
            variant="default"
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}
          >
            <Text variant="label" style={{ color: colors.primary, marginBottom: spacing.sm }}>
              YOUR CHOICES
            </Text>

            <ChoiceRow
              busy={busy === 'ghost'}
              label="Contribute routes to Ghost Library"
              onValueChange={(value) => void setConsent('ghost', value)}
              value={consents?.ghost?.granted ?? true}
              colors={colors}
            />
            <ChoiceRow
              busy={busy === 'leaderboard_name'}
              label="Public leaderboard name"
              onValueChange={(value) => void setConsent('leaderboard_name', value)}
              value={consents?.leaderboard_name?.granted ?? false}
              colors={colors}
            />
            <ChoiceRow
              busy={busy === 'diagnostics'}
              label="Diagnostics (no location telemetry)"
              onValueChange={(value) => void setConsent('diagnostics', value)}
              value={consents?.diagnostics?.granted ?? false}
              colors={colors}
            />

            <View style={[styles.staticRow, { borderTopWidth: 1, borderTopColor: colors.borderDark, paddingTop: spacing.sm, marginTop: spacing.sm }]}>
              <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                Share route in replays
              </Text>
              <Text variant="caption" style={{ color: colors.primary }}>
                Asked in every lobby
              </Text>
            </View>
            <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2, lineHeight: 16 }}>
              You pick per game when joining a lobby. Positions are visible only to players the rules allow, routes are shared only if you choose to share them, and data is deleted after the retention period.
            </Text>

            <View style={[styles.ghostSection, { borderTopWidth: 1, borderTopColor: colors.borderDark, paddingTop: spacing.sm, marginTop: spacing.sm }]}>
              <View style={styles.staticRow}>
                <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                  Ghost Library Contributions
                </Text>
                <Text variant="caption" style={{ color: colors.radarScan }}>
                  {ghosts.length === 0 ? 'None active' : `${ghosts.length} active`}
                </Text>
              </View>
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2, lineHeight: 16 }}>
                Contributed routes are anonymous, have 150m automatically trimmed from the start and end to protect your origin and destination privacy, and are automatically deleted after 90 days.
              </Text>
              {ghosts.length > 0 && (
                <Button
                  title={deletingGhosts ? 'Deleting...' : `Delete all ghost routes (${ghosts.length})`}
                  variant="danger"
                  size="sm"
                  style={{ marginTop: spacing.sm }}
                  disabled={deletingGhosts}
                  onPress={() => void handleDeleteGhosts()}
                />
              )}
            </View>
          </Card>
        )}

        <Card
          variant="default"
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark, marginTop: spacing.md }]}
        >
          <Text variant="label" style={{ color: colors.primary, marginBottom: spacing.xs }}>
            TACTICAL DETAILS
          </Text>
          {PRIVACY_SECTIONS.map((section) => {
            const open = expanded === section.title;
            return (
              <View key={section.title} style={[styles.section, { borderTopColor: colors.borderDark }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => setExpanded(open ? null : section.title)}
                  style={styles.sectionHeader}
                >
                  <Text variant="title" style={{ color: colors.text, fontSize: 14, flex: 1 }}>
                    {section.title}
                  </Text>
                  <Ionicons color={colors.textMuted} name={open ? 'chevron-up' : 'chevron-down'} size={16} />
                </Pressable>
                {open && (
                  <Text variant="body" style={{ color: colors.textMuted, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
                    {section.body}
                  </Text>
                )}
              </View>
            );
          })}
        </Card>

        {PRIVACY_POLICY_URL ? (
          <Text variant="caption" style={{ color: colors.primary, marginTop: spacing.md, textAlign: 'center' }}>
            {PRIVACY_POLICY_URL}
          </Text>
        ) : (
          <Text variant="caption" style={{ color: colors.textSubtle, marginTop: spacing.md, textAlign: 'center' }}>
            For privacy inquiries, account data questions, or the full policy text, contact {PRIVACY_CONTACT_EMAIL}.
          </Text>
        )}

        {isGate && (
          <Card
            variant="elevated"
            style={[
              styles.gateCard,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.borderAccent, marginTop: spacing.lg },
            ]}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: ageConfirmed }}
              onPress={() => setAgeConfirmed((value) => !value)}
              style={styles.checkboxRow}
            >
              <Ionicons
                color={ageConfirmed ? colors.primary : colors.textSubtle}
                name={ageConfirmed ? 'checkbox' : 'square-outline'}
                size={24}
              />
              <Text variant="body" style={{ color: colors.text, marginLeft: spacing.xs, flex: 1, fontSize: 13, lineHeight: 18 }}>
                I have read this and I am 18 or older, or playing under a guardian&apos;s supervision.
              </Text>
            </Pressable>
            <Button
              title={busy === 'ack' ? 'Confirming...' : 'Continue'}
              variant="primary"
              size="lg"
              style={{ marginTop: spacing.md }}
              disabled={!ageConfirmed || busy === 'ack'}
              onPress={() => void acknowledge()}
            />
            {actionError !== '' && (
              <Text variant="caption" style={{ color: colors.danger, marginTop: spacing.xs, textAlign: 'center' }}>
                {actionError}
              </Text>
            )}
          </Card>
        )}

        {toast !== '' && (
          <Text variant="body" style={{ color: colors.primary, marginTop: spacing.md, textAlign: 'center' }}>
            {toast}
          </Text>
        )}
        {!isGate && actionError !== '' && (
          <Text variant="body" style={{ color: colors.danger, marginTop: spacing.md, textAlign: 'center' }}>
            {actionError}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function ChoiceRow({
  busy,
  label,
  onValueChange,
  value,
  colors,
}: {
  busy: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
  colors: any;
}) {
  return (
    <View style={styles.choiceRow}>
      <Text variant="body" style={{ color: colors.text, flex: 1, fontSize: 14 }}>
        {label}
      </Text>
      {busy ? (
        <ActivityIndicator color={colors.primary} size="small" />
      ) : (
        <Switch
          accessibilityLabel={label}
          onValueChange={onValueChange}
          thumbColor={colors.textLight}
          trackColor={{ false: colors.borderDark, true: colors.primary }}
          value={value}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  screen: {
    paddingBottom: 48,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  backRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingVertical: 8,
  },
  card: {
    padding: 16,
    borderWidth: 1,
  },
  choiceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  staticRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ghostSection: {
    marginTop: 8,
  },
  section: {
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gateCard: {
    padding: 16,
    borderWidth: 1,
  },
  checkboxRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

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
    // Deferred so the fetch does not set state synchronously inside the effect.
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
    router.replace('/home');
  }

  if (!consents && !loadError) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1D4ED8" size="large" />
        <Text style={styles.centeredText}>Loading your privacy choices…</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.error}>
          {loadError}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void load()}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {!isGate && (
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.backRow}
        >
          <Ionicons color="#1D4ED8" name="chevron-back" size={20} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      )}

      <Text style={styles.title}>Privacy</Text>
      <Text style={styles.versionLine}>Version {PRIVACY_VERSION}.0 · Updated 2026-11-01</Text>

      {needsAcknowledgement && (
        <View style={styles.changedCard}>
          <Text style={styles.changedTitle}>
            {acknowledgedVersion === 0 ? 'Before you play' : 'What changed'}
          </Text>
          {(PRIVACY_CHANGELOG[PRIVACY_VERSION] ?? []).map((line) => (
            <Text key={line} style={styles.changedLine}>
              • {line}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardEyebrow}>THE SHORT VERSION</Text>
        {PRIVACY_SHORT_VERSION.map((line) => (
          <Text key={line} style={styles.shortLine}>
            • {line}
          </Text>
        ))}
      </View>

      {!isGate && (
        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>YOUR CHOICES</Text>

          <ChoiceRow
            busy={busy === 'leaderboard_name'}
            label="Public leaderboard name"
            onValueChange={(value) => void setConsent('leaderboard_name', value)}
            value={consents?.leaderboard_name?.granted ?? false}
          />
          <ChoiceRow
            busy={busy === 'diagnostics'}
            label="Diagnostics (no location)"
            onValueChange={(value) => void setConsent('diagnostics', value)}
            value={consents?.diagnostics?.granted ?? false}
          />

          <View style={styles.staticRow}>
            <Text style={styles.choiceLabel}>Share my route in replays</Text>
            <Text style={styles.staticValue}>Asked in every lobby</Text>
          </View>
          <Text style={styles.helper}>
            You pick per game when you join a lobby. You can change it there until the round ends,
            and hide your route later from the result screen.
          </Text>
          <View style={styles.ghostSection}>
            <View style={styles.staticRow}>
              <Text style={styles.choiceLabel}>Ghost Library Contributions</Text>
              <Text style={styles.staticValue}>
                {ghosts.length === 0 ? 'None active' : `${ghosts.length} active`}
              </Text>
            </View>
            <Text style={styles.helper}>
              Contributed routes are completely anonymous, have 150m automatically trimmed from the
              start and end to protect your origin and destination privacy, and are automatically
              deleted after 90 days.
            </Text>
            {ghosts.length > 0 && (
              <Pressable
                accessibilityRole="button"
                disabled={deletingGhosts}
                onPress={() => void handleDeleteGhosts()}
                style={styles.deleteGhostsButton}
              >
                {deletingGhosts ? (
                  <ActivityIndicator color="#DC2626" size="small" />
                ) : (
                  <Text style={styles.deleteGhostsText}>
                    Delete all my ghost routes ({ghosts.length})
                  </Text>
                )}
              </Pressable>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings' as any)}
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>Export or delete my data</Text>
            <Ionicons color="#1D4ED8" name="chevron-forward" size={16} />
          </Pressable>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardEyebrow}>DETAILS</Text>
        {PRIVACY_SECTIONS.map((section) => {
          const open = expanded === section.title;
          return (
            <View key={section.title} style={styles.section}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => setExpanded(open ? null : section.title)}
                style={styles.sectionHeader}
              >
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Ionicons color="#64748B" name={open ? 'chevron-up' : 'chevron-down'} size={16} />
              </Pressable>
              {open && <Text style={styles.sectionBody}>{section.body}</Text>}
            </View>
          );
        })}
      </View>

      {PRIVACY_POLICY_URL ? (
        <Text style={styles.policyLink}>{PRIVACY_POLICY_URL}</Text>
      ) : (
        <Text style={styles.placeholder}>
          TODO: hosted full-policy URL is not set yet. Contact {PRIVACY_CONTACT_EMAIL} for the full
          text.
        </Text>
      )}

      {isGate && (
        <View style={styles.gateCard}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ageConfirmed }}
            onPress={() => setAgeConfirmed((value) => !value)}
            style={styles.checkboxRow}
          >
            <Ionicons
              color={ageConfirmed ? '#1D4ED8' : '#94A3B8'}
              name={ageConfirmed ? 'checkbox' : 'square-outline'}
              size={24}
            />
            <Text style={styles.checkboxLabel}>
              I have read this and I am 18 or older, or playing with a guardian.
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!ageConfirmed || busy === 'ack'}
            onPress={() => void acknowledge()}
            style={[styles.primaryButton, !ageConfirmed && styles.primaryButtonDisabled]}
          >
            {busy === 'ack' ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
          {actionError !== '' && (
            <Text accessibilityRole="alert" style={styles.error}>
              {actionError}
            </Text>
          )}
        </View>
      )}

      {toast !== '' && <Text style={styles.toast}>{toast}</Text>}
      {!isGate && actionError !== '' && (
        <Text accessibilityRole="alert" style={styles.error}>
          {actionError}
        </Text>
      )}
    </ScrollView>
  );
}

function ChoiceRow({
  busy,
  label,
  onValueChange,
  value,
}: {
  busy: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <View style={styles.choiceRow}>
      <Text style={styles.choiceLabel}>{label}</Text>
      {busy ? (
        <ActivityIndicator color="#1D4ED8" size="small" />
      ) : (
        <Switch
          accessibilityLabel={label}
          onValueChange={onValueChange}
          thumbColor="#FFFFFF"
          trackColor={{ false: '#CBD5E1', true: '#1D4ED8' }}
          value={value}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#E2E8F0', padding: 18, paddingBottom: 48 },
  centered: {
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  centeredText: { color: '#475569', fontSize: 15, marginTop: 12 },
  backRow: { alignItems: 'center', flexDirection: 'row', marginTop: 8 },
  backText: { color: '#1D4ED8', fontSize: 15, fontWeight: '700' },
  title: { color: '#0F172A', fontSize: 28, fontWeight: '900', marginTop: 12 },
  versionLine: { color: '#64748B', fontSize: 13, marginBottom: 14, marginTop: 4 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    elevation: 2,
    marginBottom: 14,
    padding: 16,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  cardEyebrow: {
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  shortLine: { color: '#0F172A', fontSize: 15, lineHeight: 23 },
  choiceRow: {
    alignItems: 'center',
    borderBottomColor: '#E2E8F0',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
  },
  choiceLabel: { color: '#0F172A', flex: 1, fontSize: 15, fontWeight: '600', paddingRight: 12 },
  staticRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  staticValue: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  helper: { color: '#64748B', fontSize: 13, lineHeight: 19, marginBottom: 8 },
  ghostSection: {
    borderBottomColor: '#E2E8F0',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  deleteGhostsButton: {
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    borderColor: '#FECACA',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    marginBottom: 8,
    marginTop: 4,
    paddingVertical: 10,
  },
  deleteGhostsText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
  linkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    minHeight: 44,
  },
  linkText: { color: '#1D4ED8', fontSize: 15, fontWeight: '700' },
  section: { borderBottomColor: '#E2E8F0', borderBottomWidth: StyleSheet.hairlineWidth },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  sectionTitle: { color: '#0F172A', fontSize: 15, fontWeight: '600' },
  sectionBody: { color: '#475569', fontSize: 14, lineHeight: 21, paddingBottom: 12 },
  changedCard: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  changedTitle: { color: '#1E3A8A', fontSize: 16, fontWeight: '800', marginBottom: 6 },
  changedLine: { color: '#1E3A8A', fontSize: 14, lineHeight: 21 },
  gateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginTop: 4,
    padding: 16,
  },
  checkboxRow: { alignItems: 'flex-start', flexDirection: 'row', minHeight: 48 },
  checkboxLabel: { color: '#0F172A', flex: 1, fontSize: 15, lineHeight: 22, marginLeft: 10 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 52,
  },
  primaryButtonDisabled: { backgroundColor: '#94A3B8' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  error: { color: '#991B1B', fontSize: 14, marginTop: 10, textAlign: 'center' },
  toast: {
    color: '#065F46',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
  },
  policyLink: { color: '#1D4ED8', fontSize: 13, marginVertical: 6, textAlign: 'center' },
  placeholder: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 18,
    marginVertical: 8,
    textAlign: 'center',
  },
});

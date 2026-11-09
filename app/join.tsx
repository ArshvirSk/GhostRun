import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Button } from '../src/ui/Button';
import { Card } from '../src/ui/Card';
import { CodeBoxes } from '../src/ui/CodeBoxes';
import { triggerHaptic } from '../src/motion/haptics';
import { supabase } from '../src/lib/supabase';

const CODE_LENGTH = 4;

export default function JoinGameScreen() {
  const { colors, spacing, radii } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();

  const initialCode = typeof params.code === 'string'
    ? params.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
    : '';
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [hasError, setHasError] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Handle deep-link prefill (?code=ABCD)
  useEffect(() => {
    if (params.code) {
      const clean = params.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
      if (clean && clean !== code) {
        const timer = setTimeout(() => setCode(clean), 0);
        return () => clearTimeout(timer);
      }
    }
  }, [params.code, code]);

  async function handleJoin(inputCode = code) {
    const normalized = inputCode.trim().toUpperCase();
    if (normalized.length !== CODE_LENGTH) {
      setErrorMessage(`Enter the ${CODE_LENGTH}-character lobby code.`);
      setHasError(true);
      triggerHaptic('error');
      return;
    }

    if (!supabase) {
      setErrorMessage('Supabase is not configured yet. Add the project URL and anon key first.');
      setHasError(true);
      return;
    }

    setBusy(true);
    setErrorMessage('');
    setHasError(false);

    try {
      const { data, error } = await supabase.rpc('join_game', { code: normalized });
      if (error) {
        setErrorMessage(error.message);
        setHasError(true);
        triggerHaptic('error');
        setBusy(false);
        return;
      }

      triggerHaptic('tagConfirmed');
      router.replace({ pathname: '/lobby/[id]', params: { id: data } });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to join game.');
      setHasError(true);
      triggerHaptic('error');
      setBusy(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.content, { padding: spacing.xl }]}>
        {/* Navigation Header */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={[styles.closeButton, { backgroundColor: colors.surface }]}
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Hero Section */}
        <View style={{ marginTop: spacing.lg }}>
          <Text variant="label" style={{ color: colors.accent, letterSpacing: 1.5 }}>
            JOIN YOUR CREW
          </Text>
          <Text variant="display" style={{ color: colors.text, marginTop: spacing.xs }}>
            Got a code?
          </Text>
          <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs }}>
            Your host has it at the top of their lobby screen.
          </Text>
        </View>

        {/* Code Boxes */}
        <View style={{ marginTop: spacing.xxl, alignItems: 'center' }}>
          <CodeBoxes
            length={CODE_LENGTH}
            value={code}
            onChangeCode={(newCode) => {
              setCode(newCode);
              setErrorMessage('');
              setHasError(false);
            }}
            onComplete={(fullCode) => {
              void handleJoin(fullCode);
            }}
            hasError={hasError}
            disabled={busy}
          />
        </View>

        {/* Error Alert */}
        {errorMessage !== '' && (
          <Card
            variant="danger"
            style={[
              styles.errorCard,
              {
                marginTop: spacing.lg,
                padding: spacing.md,
                borderRadius: radii.md,
              },
            ]}
          >
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              <Text variant="body" style={{ color: colors.danger, flex: 1, fontSize: 13 }}>
                {errorMessage}
              </Text>
            </View>
          </Card>
        )}

        {/* Action Controls */}
        <View style={{ marginTop: spacing.xxl }}>
          <Button
            title={busy ? 'Joining Lobby…' : 'Enter Lobby'}
            variant="primary"
            size="lg"
            disabled={code.length !== CODE_LENGTH || busy}
            loading={busy}
            onPress={() => void handleJoin()}
            style={{ marginBottom: spacing.md }}
          />

          <Button
            title={scannerOpen ? 'Close QR Scanner' : 'Scan Host QR Code'}
            variant="secondary"
            size="md"
            onPress={() => {
              triggerHaptic('buttonTap');
              setScannerOpen(!scannerOpen);
            }}
          />
        </View>

        {/* QR Scanner Placeholder */}
        {scannerOpen && (
          <Card
            variant="default"
            style={[
              styles.qrBox,
              {
                borderColor: colors.border,
                marginTop: spacing.lg,
                padding: spacing.xl,
                borderRadius: radii.lg,
              },
            ]}
          >
            <Ionicons name="qr-code-outline" size={48} color={colors.radarScan} />
            <Text variant="title" style={{ color: colors.text, marginTop: spacing.md }}>
              Camera Scanner Ready
            </Text>
            <Text variant="body" style={{ color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs }}>
              Point camera at the host lobby QR code to join automatically.
            </Text>
          </Card>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 8,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorCard: {
    borderWidth: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qrBox: {
    borderWidth: 1,
    alignItems: 'center',
  },
});

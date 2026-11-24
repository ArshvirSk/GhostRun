import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  Animated,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Vibration,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Button } from '../src/ui/Button';
import { Card } from '../src/ui/Card';
import { CodeBoxes } from '../src/ui/CodeBoxes';
import { triggerHaptic } from '../src/motion/haptics';
import { playSound } from '../src/lib/audio';
import { supabase } from '../src/lib/supabase';
import { parseInviteUrl } from '../src/lib/invite';
import { consumeFriendInvite } from '../src/lib/friends';

const GHOSTRUN_MARK_MINT = require('../assets/ghostrun-mark-mint.png');
const GHOSTRUN_MARK_OLIVE = require('../assets/ghostrun-mark-olive.png');

const CODE_LENGTH = 4;

export default function JoinGameScreen() {
  const { colors, spacing, radii, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    code?: string;
    friend_invite?: string;
    add?: string;
  }>();

  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ success: boolean; message: string } | null>(
    null,
  );

  const initialCode =
    typeof params.code === 'string'
      ? parseInviteUrl(params.code).code ||
        params.code
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, CODE_LENGTH)
      : '';

  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [hasError, setHasError] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const lastScannedRef = useRef<string | null>(null);

  // Animated laser sweep for camera viewfinder
  useEffect(() => {
    if (!scannerOpen || !permission?.granted) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 150,
          duration: 1600,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 1600,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scannerOpen, permission?.granted, scanLineAnim]);

  // Handle deep-link prefill (?code=ABCD)
  useEffect(() => {
    if (params.code) {
      const clean =
        parseInviteUrl(params.code).code ||
        params.code
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, CODE_LENGTH);
      if (clean && clean !== code) {
        const timer = setTimeout(() => setCode(clean), 0);
        return () => clearTimeout(timer);
      }
    }
  }, [params.code, code]);

  // Handle incoming friend invite token (?friend_invite=XYZ)
  useEffect(() => {
    if (params.friend_invite) {
      const token = params.friend_invite.trim();
      if (!token) return;
      setBusy(true);
      void consumeFriendInvite(token).then((res) => {
        setBusy(false);
        if (res.success && res.owner) {
          triggerHaptic('tagConfirmed');
          Alert.alert(
            'Operative Linked',
            `You are now connected with operative ${res.owner.displayName}.`,
            [
              {
                text: 'View Profile',
                onPress: () =>
                  router.push({
                    pathname: '/profile/[id]',
                    params: {
                      id: res.owner!.ownerId,
                      name: res.owner!.displayName,
                      color: res.owner!.color,
                    },
                  }),
              },
              {
                text: 'Allies Network',
                onPress: () => router.push('/friends'),
              },
            ],
          );
        } else {
          triggerHaptic('error');
          setErrorMessage(res.error || 'Failed to accept friend invite.');
          setHasError(true);
        }
      });
    }
  }, [params.friend_invite, router]);

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
      // Ensure player has an active authenticated session (frictionless guest join fallback)
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
        if (anonError) {
          setErrorMessage(anonError.message);
          setHasError(true);
          triggerHaptic('error');
          setBusy(false);
          setIsScanning(false);
          lastScannedRef.current = null;
          setScanFeedback(null);
          return;
        }

        if (anonData.user) {
          const guestSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
          await supabase.from('profiles').upsert(
            {
              id: anonData.user.id,
              display_name: `GUEST-${guestSuffix}`,
              color: '#10B981',
            },
            { onConflict: 'id' }
          );
        }
      }

      const { data, error } = await supabase.rpc('join_game', { code: normalized });
      if (error) {
        setErrorMessage(error.message);
        setHasError(true);
        triggerHaptic('error');
        setBusy(false);
        setIsScanning(false);
        lastScannedRef.current = null;
        setScanFeedback(null);
        return;
      }

      triggerHaptic('tagConfirmed');
      router.replace({ pathname: '/lobby/[id]', params: { id: data } });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to join game.');
      setHasError(true);
      triggerHaptic('error');
      setBusy(false);
      setIsScanning(false);
      lastScannedRef.current = null;
      setScanFeedback(null);
    }
  }

  async function handleBarcodeScanned({ data }: { data: string }) {
    if (isScanning || busy) return;
    if (lastScannedRef.current === data) return;
    lastScannedRef.current = data;

    // 1. Check for friend invite token (?friend_invite=XYZ)
    const friendInviteMatch = data.match(/friend_invite=([a-zA-Z0-9]+)/i);
    if (friendInviteMatch) {
      const token = friendInviteMatch[1];
      setIsScanning(true);
      playSound('scan_success');
      Vibration.vibrate([0, 70, 30, 70]);
      triggerHaptic('tagConfirmed');
      setScanFeedback({ success: true, message: 'OPERATIVE BEACON DETECTED' });

      try {
        const res = await consumeFriendInvite(token);
        if (res.success && res.owner) {
          setScanFeedback({ success: true, message: `LINKED: ${res.owner.displayName}` });
          setTimeout(() => {
            router.push({
              pathname: '/profile/[id]',
              params: {
                id: res.owner!.ownerId,
                name: res.owner!.displayName,
                color: res.owner!.color,
              },
            });
          }, 800);
          return;
        } else {
          setScanFeedback({ success: false, message: res.error || 'Failed to link operative' });
        }
      } catch {
        setScanFeedback({ success: false, message: 'Network error linking operative' });
      }

      setTimeout(() => {
        setIsScanning(false);
        lastScannedRef.current = null;
        setScanFeedback(null);
      }, 2000);
      return;
    }

    // 2. Check for operative handle beacon (?add=@handle)
    const addMatch = data.match(/[?&]add=([^&]+)/i);
    if (addMatch) {
      const identifier = decodeURIComponent(addMatch[1]);
      setIsScanning(true);
      playSound('scan_success');
      Vibration.vibrate([0, 70, 30, 70]);
      triggerHaptic('tagConfirmed');
      setScanFeedback({ success: true, message: `OPERATIVE BEACON: ${identifier}` });

      setTimeout(() => {
        router.push({
          pathname: '/friends',
          params: { add: identifier },
        });
      }, 700);
      return;
    }

    // 3. Check parsed match lobby invite URL or raw 4-char string
    const parsed = parseInviteUrl(data);
    let extractedCode = parsed.isValid ? parsed.code : null;

    if (!extractedCode) {
      const rawMatch = data.toUpperCase().match(/\b([A-HJ-NP-Z2-9]{4})\b/);
      if (rawMatch) {
        extractedCode = rawMatch[1];
      }
    }

    if (extractedCode) {
      setIsScanning(true);
      playSound('scan_success');
      Vibration.vibrate([0, 70, 30, 70]);
      triggerHaptic('tagConfirmed');

      setScanFeedback({ success: true, message: `LOBBY DETECTED: ${extractedCode}` });
      setCode(extractedCode);
      setErrorMessage('');
      setHasError(false);

      // Brief delay so player sees feedback, then join
      setTimeout(() => {
        void handleJoin(extractedCode!);
      }, 500);
    } else {
      triggerHaptic('error');
      setScanFeedback({ success: false, message: 'Invalid GhostRun QR code' });
      setTimeout(() => {
        setIsScanning(false);
        lastScannedRef.current = null;
        setScanFeedback(null);
      }, 2000);
    }
  }

  function handleToggleScanner() {
    triggerHaptic('buttonTap');
    const willOpen = !scannerOpen;
    setScannerOpen(willOpen);
    setScanFeedback(null);
    setIsScanning(false);
    lastScannedRef.current = null;

    if (willOpen && !permission?.granted) {
      void requestPermission();
    }
  }

  const logoColor = isDark ? '#FFFFFF' : '#000000';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: spacing.lg,
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 24,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Navigation & Branding Header */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={[
              styles.closeButton,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark },
            ]}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>

          <View style={styles.brandRow}>
            <Image
              source={isDark ? GHOSTRUN_MARK_MINT : GHOSTRUN_MARK_OLIVE}
              style={[styles.logoMark, { tintColor: logoColor }]}
              resizeMode="contain"
              accessibilityLabel="GhostRun Mark"
            />
            <Text style={[styles.brandText, { color: logoColor }]}>GHOSTRUN</Text>
          </View>
        </View>

        {/* Hero Section */}
        <View style={styles.heroSection}>
          <Text variant="display" style={[styles.heroTitle, { color: colors.text }]}>
            Join Your Crew
          </Text>
          <Text variant="body" style={[styles.heroSubtitle, { color: colors.textMuted }]}>
            Enter the 4-character lobby code or scan your host's tactical QR beacon to enter the
            grid.
          </Text>
        </View>

        {/* Code Boxes Input Card */}
        <View
          style={[
            styles.codeBoxContainer,
            { backgroundColor: colors.surface, borderColor: colors.borderDark },
          ]}
        >
          <Text style={[styles.codeBoxLabel, { color: colors.textMuted }]}>LOBBY CODE</Text>

          <View style={styles.boxesWrapper}>
            <CodeBoxes
              length={CODE_LENGTH}
              value={code}
              autoFocus={true}
              onChangeCode={(newCode) => {
                const parsed = parseInviteUrl(newCode).code ?? newCode;
                setCode(parsed.slice(0, CODE_LENGTH));
                setErrorMessage('');
                setHasError(false);
              }}
              onComplete={(fullCode) => {
                const parsed = parseInviteUrl(fullCode).code ?? fullCode;
                void handleJoin(parsed);
              }}
              hasError={hasError}
              disabled={busy}
            />
          </View>

          {code.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear code"
              onPress={() => {
                triggerHaptic('buttonTap');
                setCode('');
                setErrorMessage('');
                setHasError(false);
              }}
              style={styles.clearBtn}
            >
              <Text style={[styles.clearBtnText, { color: colors.textMuted }]}>Clear code</Text>
            </Pressable>
          )}
        </View>

        {/* Error Alert */}
        {errorMessage !== '' && (
          <Card
            variant="danger"
            style={[
              styles.errorCard,
              {
                marginTop: spacing.md,
                padding: spacing.md,
                borderRadius: radii.md,
              },
            ]}
          >
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text
                variant="body"
                style={{ color: colors.danger, flex: 1, fontSize: 13, fontWeight: '600' }}
              >
                {errorMessage}
              </Text>
            </View>
          </Card>
        )}

        {/* Action Controls */}
        <View style={styles.actionControls}>
          <Button
            title={busy ? 'Connecting to Grid…' : 'Enter Lobby'}
            variant="primary"
            size="lg"
            disabled={code.length !== CODE_LENGTH || busy}
            loading={busy}
            onPress={() => void handleJoin()}
            style={{ marginBottom: spacing.sm }}
          />

          <Button
            title={scannerOpen ? 'Close QR Scanner' : 'Scan Host QR Code'}
            variant="secondary"
            size="md"
            onPress={handleToggleScanner}
          />
        </View>

        {/* LIVE CAMERA VIEW / SCANNER */}
        {scannerOpen && (
          <View style={[styles.scannerWrapper, { marginTop: spacing.md }]}>
            {!permission ? (
              <View
                style={[
                  styles.permissionCard,
                  { backgroundColor: colors.surface, borderColor: colors.borderDark },
                ]}
              >
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={[styles.permissionText, { color: colors.textMuted }]}>
                  Initializing camera…
                </Text>
              </View>
            ) : !permission.granted ? (
              <View
                style={[
                  styles.permissionCard,
                  { backgroundColor: colors.surface, borderColor: colors.borderDark },
                ]}
              >
                <MaterialCommunityIcons name="camera-off-outline" size={40} color={colors.danger} />
                <Text style={[styles.permissionTitle, { color: colors.text }]}>
                  Camera Access Required
                </Text>
                <Text style={[styles.permissionDesc, { color: colors.textMuted }]}>
                  GhostRun needs camera permissions to scan your host's lobby QR code.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void requestPermission()}
                  style={[styles.grantBtn, { backgroundColor: colors.primary }]}
                >
                  <Text style={styles.grantBtnText}>Grant Camera Access</Text>
                </Pressable>
              </View>
            ) : (
              <View
                style={[
                  styles.cameraContainer,
                  {
                    borderColor: isScanning ? colors.primary : colors.borderDark,
                    borderRadius: radii.card,
                  },
                ]}
              >
                <CameraView
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr'],
                  }}
                  enableTorch={torch}
                  facing="back"
                  onBarcodeScanned={isScanning ? undefined : handleBarcodeScanned}
                  style={StyleSheet.absoluteFill}
                />

                {/* Tactical Camera HUD Overlay */}
                <View style={styles.cameraOverlay}>
                  {/* Top Control Strip inside camera */}
                  <View style={styles.cameraTopRow}>
                    <View style={{ flex: 1 }} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Toggle Flashlight"
                      onPress={() => {
                        triggerHaptic('buttonTap');
                        setTorch((t) => !t);
                      }}
                      style={[styles.torchBtn, torch && styles.torchBtnActive]}
                    >
                      <Ionicons
                        name={torch ? 'flash' : 'flash-outline'}
                        size={18}
                        color={torch ? '#EAB308' : '#FFFFFF'}
                      />
                    </Pressable>
                  </View>

                  {/* Central Reticle & Viewfinder Frame */}
                  <View style={styles.reticleContainer}>
                    <View style={styles.viewfinder}>
                      {/* 4 neon corner brackets */}
                      <View
                        style={[
                          styles.reticleCorner,
                          styles.reticleTL,
                          { borderColor: colors.primary },
                        ]}
                      />
                      <View
                        style={[
                          styles.reticleCorner,
                          styles.reticleTR,
                          { borderColor: colors.primary },
                        ]}
                      />
                      <View
                        style={[
                          styles.reticleCorner,
                          styles.reticleBL,
                          { borderColor: colors.primary },
                        ]}
                      />
                      <View
                        style={[
                          styles.reticleCorner,
                          styles.reticleBR,
                          { borderColor: colors.primary },
                        ]}
                      />

                      {/* Animated Laser Sweep Line */}
                      <Animated.View
                        style={[
                          styles.laserLine,
                          {
                            backgroundColor: colors.primary,
                            transform: [{ translateY: scanLineAnim }],
                          },
                        ]}
                      />
                    </View>
                  </View>

                  {/* Bottom Feedback Banner */}
                  {scanFeedback ? (
                    <View
                      style={[
                        styles.feedbackBadge,
                        scanFeedback.success ? styles.feedbackSuccess : styles.feedbackError,
                      ]}
                    >
                      <Ionicons
                        name={scanFeedback.success ? 'checkmark-circle' : 'alert-circle'}
                        size={16}
                        color="#FFFFFF"
                      />
                      <Text style={styles.feedbackText}>{scanFeedback.message}</Text>
                    </View>
                  ) : (
                    <Text style={styles.cameraHint}>Keep it steady</Text>
                  )}
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'flex-start',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoMark: {
    width: 22,
    height: 22,
  },
  brandText: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  heroSection: {
    marginBottom: 24,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  codeBoxContainer: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
  },
  codeBoxLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  boxesWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtn: {
    marginTop: 12,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  errorCard: {
    borderWidth: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionControls: {
    marginTop: 20,
  },
  scannerWrapper: {
    width: '100%',
  },
  permissionCard: {
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    gap: 10,
  },
  permissionTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 4,
  },
  permissionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  permissionDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  grantBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  grantBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  cameraContainer: {
    height: 270,
    width: '100%',
    overflow: 'hidden',
    borderWidth: 2,
    position: 'relative',
    backgroundColor: '#000000',
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    justifyContent: 'space-between',
    padding: 12,
    alignItems: 'center',
  },
  cameraTopRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cameraStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 6,
  },
  cameraDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cameraStatusText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  torchBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  torchBtnActive: {
    backgroundColor: 'rgba(234, 179, 8, 0.3)',
    borderWidth: 1,
    borderColor: '#EAB308',
  },
  reticleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinder: {
    width: 170,
    height: 170,
    position: 'relative',
  },
  reticleCorner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderWidth: 3,
  },
  reticleTL: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 8,
  },
  reticleTR: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 8,
  },
  reticleBL: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
  },
  reticleBR: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 8,
  },
  laserLine: {
    width: '100%',
    height: 2,
    opacity: 0.85,
  },
  feedbackBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 6,
  },
  feedbackSuccess: {
    backgroundColor: '#10B981',
  },
  feedbackError: {
    backgroundColor: '#EF4444',
  },
  feedbackText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cameraHint: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
});

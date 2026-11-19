import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  Animated,
  ActivityIndicator,
  Vibration,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import { playSound } from '../lib/audio';
import { parseInviteUrl } from '../lib/invite';

interface OperativeBeaconScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onOperativeScanned: (target: string) => Promise<{ success: boolean; message: string }>;
}

export function OperativeBeaconScannerModal({
  visible,
  onClose,
  onOperativeScanned,
}: OperativeBeaconScannerModalProps) {
  const { colors, isDark } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const lastScannedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setTorch(false);
      setIsProcessing(false);
      setFeedback(null);
      lastScannedRef.current = null;
      return;
    }

    if (!permission?.granted) {
      void requestPermission();
    }
  }, [visible, permission?.granted, requestPermission]);

  // Animated laser sweep for camera viewfinder
  useEffect(() => {
    if (!visible || !permission?.granted) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 170,
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
  }, [visible, permission?.granted, scanLineAnim]);

  async function handleBarcodeScanned({ data }: { data: string }) {
    if (isProcessing) return;
    if (lastScannedRef.current === data) return;
    lastScannedRef.current = data;

    let targetIdentifier: string | null = null;

    // 1. Check invite URL parsing
    const parsed = parseInviteUrl(data);
    if (parsed.isValid && parsed.code) {
      targetIdentifier = parsed.code;
    } else {
      // 2. Check query string params (e.g. ?add=@operative or ?add=uuid)
      const addParamMatch = data.match(/[?&]add=([^&#\s]+)/i);
      if (addParamMatch) {
        targetIdentifier = decodeURIComponent(addParamMatch[1]);
      } else if (data.startsWith('@') || /^[a-zA-Z0-9_-]{3,30}$/.test(data.trim())) {
        targetIdentifier = data.trim();
      }
    }

    if (!targetIdentifier) {
      triggerHaptic('error');
      setFeedback({ success: false, message: 'Invalid Operative Beacon QR' });
      setTimeout(() => {
        lastScannedRef.current = null;
        setFeedback(null);
      }, 2000);
      return;
    }

    setIsProcessing(true);
    playSound('scan_success');
    Vibration.vibrate([0, 70, 30, 70]);
    triggerHaptic('tagConfirmed');

    setFeedback({ success: true, message: `OPERATIVE DETECTED: ${targetIdentifier}` });

    try {
      const res = await onOperativeScanned(targetIdentifier);
      setFeedback({ success: res.success, message: res.message });
      if (res.success) {
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setTimeout(() => {
          setIsProcessing(false);
          lastScannedRef.current = null;
          setFeedback(null);
        }, 2500);
      }
    } catch {
      setFeedback({ success: false, message: 'Failed to dispatch ally request' });
      setTimeout(() => {
        setIsProcessing(false);
        lastScannedRef.current = null;
        setFeedback(null);
      }, 2500);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: '#000000' }]}>
        {/* Top Control Bar */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Scanner"
            onPress={() => {
              triggerHaptic('buttonTap');
              onClose();
            }}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </Pressable>

          <View style={styles.titleRow}>
            <View style={[styles.beaconDot, { backgroundColor: colors.primary }]} />
            <Text style={styles.titleText}>BEACON SCANNER</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle Torch"
            onPress={() => {
              triggerHaptic('buttonTap');
              setTorch((t) => !t);
            }}
            style={[styles.torchBtn, torch && styles.torchBtnActive]}
          >
            <Ionicons
              name={torch ? 'flash' : 'flash-outline'}
              size={20}
              color={torch ? '#EAB308' : '#FFFFFF'}
            />
          </Pressable>
        </View>

        {/* Camera / Permission View */}
        {!permission ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.statusText}>Initializing Camera…</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.permissionCard}>
            <MaterialCommunityIcons name="camera-off-outline" size={54} color={colors.danger} />
            <Text style={styles.permissionTitle}>Camera Access Required</Text>
            <Text style={styles.permissionDesc}>
              GhostRun needs camera permissions to scan an operative's QR beacon.
            </Text>
            <Button
              title="Grant Camera Access"
              variant="primary"
              size="md"
              onPress={() => void requestPermission()}
              style={{ marginTop: 16 }}
            />
          </View>
        ) : (
          <View style={styles.cameraWrapper}>
            <CameraView
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              enableTorch={torch}
              facing="back"
              onBarcodeScanned={isProcessing ? undefined : handleBarcodeScanned}
              style={StyleSheet.absoluteFill}
            />

            {/* Tactical HUD Overlay */}
            <View style={styles.hudOverlay}>
              <View style={styles.reticle}>
                {/* 4 Neon corner brackets */}
                <View style={[styles.corner, styles.tl, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.tr, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.bl, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.br, { borderColor: colors.primary }]} />

                {/* Animated Laser Sweep */}
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

              {/* Status and Feedback Banner */}
              {feedback ? (
                <View
                  style={[
                    styles.feedbackBanner,
                    feedback.success ? styles.feedbackSuccess : styles.feedbackError,
                  ]}
                >
                  <Ionicons
                    name={feedback.success ? 'checkmark-circle' : 'alert-circle'}
                    size={20}
                    color="#FFFFFF"
                  />
                  <Text style={styles.feedbackText}>{feedback.message}</Text>
                </View>
              ) : (
                <View style={styles.hintContainer}>
                  <Text style={styles.hintText}>Point camera at operative's QR beacon</Text>
                  <Text style={styles.hintSubText}>Keep device steady for auto-capture</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.85)',
    zIndex: 10,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  beaconDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  torchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  torchBtnActive: {
    backgroundColor: 'rgba(234, 179, 8, 0.3)',
    borderWidth: 1,
    borderColor: '#EAB308',
  },
  cameraWrapper: {
    flex: 1,
    position: 'relative',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  permissionCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  permissionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  permissionDesc: {
    color: '#9CA3AF',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  hudOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: 240,
    height: 240,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderWidth: 4,
  },
  tl: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 10,
  },
  tr: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 10,
  },
  bl: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
  },
  br: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 10,
  },
  laserLine: {
    width: '100%',
    height: 2,
    opacity: 0.9,
  },
  hintContainer: {
    marginTop: 36,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  hintText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  hintSubText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 4,
  },
  feedbackBanner: {
    marginTop: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    maxWidth: '85%',
  },
  feedbackSuccess: {
    backgroundColor: '#10B981',
  },
  feedbackError: {
    backgroundColor: '#EF4444',
  },
  feedbackText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    flexShrink: 1,
  },
});

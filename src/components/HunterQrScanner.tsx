import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';

import { playSound } from '../lib/audio';
import { supabase } from '../lib/supabase';

export function HunterQrScanner({
  gameId,
  visible,
  onClose,
  onTagSuccess,
}: {
  gameId: string;
  visible: boolean;
  onClose: () => void;
  onTagSuccess?: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);

  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const lastScannedToken = useRef<string | null>(null);

  // Viewfinder scan line sweep animation
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 200,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scanLineAnim, visible]);

  // Reset state when opened
  useEffect(() => {
    if (visible) {
      setIsProcessing(false);
      setScanMessage(null);
      setIsError(false);
      setScanSuccess(false);
      lastScannedToken.current = null;
    }
  }, [visible]);

  async function handleBarcodeScanned({ data }: { data: string }) {
    if (isProcessing || scanSuccess) return;
    if (lastScannedToken.current === data) return; // Prevent duplicate rapid submissions

    lastScannedToken.current = data;
    setIsProcessing(true);
    setScanMessage('Verifying QR token…');
    setIsError(false);

    playSound('scan_success');
    Vibration.vibrate([0, 80, 40, 80]);

    try {
      if (!supabase) {
        setIsError(true);
        setScanMessage('Supabase client unavailable.');
        setIsProcessing(false);
        return;
      }

      const { data: tagResult, error } = await supabase.rpc('tag_by_qr', {
        game_id: gameId,
        token: data,
      });

      if (error) {
        setIsError(true);
        setScanMessage(error.message);
        setTimeout(() => {
          setIsProcessing(false);
          lastScannedToken.current = null;
        }, 2200);
        return;
      }

      const res = tagResult as { success?: boolean; reason?: string; winner?: string } | null;
      if (res?.success) {
        setScanSuccess(true);
        setIsError(false);
        setScanMessage('TAG CONFIRMED!');
        playSound('tag');
        Vibration.vibrate(500);
        if (onTagSuccess) onTagSuccess();
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setIsError(true);
        const reason = res?.reason ?? 'Invalid QR token';
        setScanMessage(
          reason === 'expired' ? 'Token expired. Runner must show a fresh code.' : reason,
        );
        setTimeout(() => {
          setIsProcessing(false);
          lastScannedToken.current = null;
        }, 2200);
      }
    } catch (err) {
      setIsError(true);
      setScanMessage(err instanceof Error ? err.message : 'Scan verification failed.');
      setTimeout(() => {
        setIsProcessing(false);
        lastScannedToken.current = null;
      }, 2200);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      <View style={styles.container}>
        {!permission ? (
          <View style={styles.centeredNotice}>
            <ActivityIndicator color="#FFFFFF" size="large" />
            <Text style={styles.noticeText}>Checking camera permissions…</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.centeredNotice}>
            <MaterialCommunityIcons color="#EF4444" name="camera-off" size={48} />
            <Text style={styles.noticeTitle}>Camera Access Required</Text>
            <Text style={styles.noticeText}>
              GhostRun needs camera access to scan runner QR codes and verify tags.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void requestPermission()}
              style={styles.permissionBtn}
            >
              <Text style={styles.permissionBtnText}>Grant Camera Permission</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <CameraView
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            enableTorch={torch}
            facing="back"
            onBarcodeScanned={isProcessing ? undefined : handleBarcodeScanned}
            style={StyleSheet.absoluteFill}
          >
            {/* Top Bar with torch & close */}
            <View style={styles.topBar}>
              <Pressable
                accessibilityLabel="Toggle Flashlight"
                accessibilityRole="button"
                onPress={() => setTorch((t) => !t)}
                style={[styles.topIconBtn, torch && styles.topIconBtnActive]}
              >
                <Ionicons
                  color={torch ? '#EAB308' : '#FFFFFF'}
                  name={torch ? 'flash' : 'flash-outline'}
                  size={24}
                />
              </Pressable>

              <Text style={styles.topTitle}>Scan Runner Tag</Text>

              <Pressable
                accessibilityLabel="Close Scanner"
                accessibilityRole="button"
                onPress={onClose}
                style={styles.topIconBtn}
              >
                <Ionicons color="#FFFFFF" name="close" size={24} />
              </Pressable>
            </View>

            {/* Viewfinder Target */}
            <View style={styles.overlay}>
              <View style={styles.viewfinder}>
                {/* 4 corner markers */}
                <View style={[styles.corner, styles.topLeft]} />
                <View style={[styles.corner, styles.topRight]} />
                <View style={[styles.corner, styles.bottomLeft]} />
                <View style={[styles.corner, styles.bottomRight]} />

                {/* Animated scan sweep line */}
                <Animated.View
                  style={[
                    styles.scanLine,
                    {
                      transform: [{ translateY: scanLineAnim }],
                    },
                  ]}
                />
              </View>

              {/* Status / feedback badge */}
              {scanMessage && (
                <View
                  style={[
                    styles.feedbackBadge,
                    scanSuccess && styles.feedbackSuccess,
                    isError && styles.feedbackError,
                  ]}
                >
                  {isProcessing && !scanSuccess && !isError && (
                    <ActivityIndicator color="#FFFFFF" size="small" style={{ marginRight: 6 }} />
                  )}
                  {scanSuccess && (
                    <Ionicons
                      color="#FFFFFF"
                      name="checkmark-circle"
                      size={18}
                      style={{ marginRight: 6 }}
                    />
                  )}
                  <Text style={styles.feedbackText}>{scanMessage}</Text>
                </View>
              )}

              <Text style={styles.hintText}>Aim at runner’s QR code to confirm tag</Text>
            </View>
          </CameraView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#090D16',
    flex: 1,
  },
  centeredNotice: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  noticeTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 16,
    textAlign: 'center',
  },
  noticeText: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  permissionBtn: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 48,
    paddingHorizontal: 24,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  cancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 40,
    paddingHorizontal: 16,
  },
  cancelBtnText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 54,
    zIndex: 10,
  },
  topTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  topIconBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  topIconBtnActive: {
    backgroundColor: 'rgba(234, 179, 8, 0.25)',
  },
  overlay: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  viewfinder: {
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 24,
    borderWidth: 1,
    height: 240,
    overflow: 'hidden',
    position: 'relative',
    width: 240,
  },
  corner: {
    borderColor: '#38BDF8',
    height: 28,
    position: 'absolute',
    width: 28,
  },
  topLeft: {
    borderLeftWidth: 3,
    borderTopLeftRadius: 16,
    borderTopWidth: 3,
    left: 0,
    top: 0,
  },
  topRight: {
    borderRightWidth: 3,
    borderTopRightRadius: 16,
    borderTopWidth: 3,
    right: 0,
    top: 0,
  },
  bottomLeft: {
    borderBottomLeftRadius: 16,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    bottom: 0,
    left: 0,
  },
  bottomRight: {
    borderBottomRightRadius: 16,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: 0,
    right: 0,
  },
  scanLine: {
    backgroundColor: '#38BDF8',
    height: 2,
    left: 10,
    position: 'absolute',
    right: 10,
    shadowColor: '#38BDF8',
    shadowOpacity: 0.8,
    shadowRadius: 6,
    top: 20,
  },
  feedbackBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 14,
    flexDirection: 'row',
    marginTop: 24,
    maxWidth: '85%',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  feedbackSuccess: {
    backgroundColor: '#059669',
  },
  feedbackError: {
    backgroundColor: '#DC2626',
  },
  feedbackText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  hintText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 16,
  },
});

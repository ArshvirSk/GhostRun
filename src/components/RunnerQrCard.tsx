import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { supabase } from '../lib/supabase';

type QrResponse = {
  token: string;
  expires_at: string;
  ttl_s: number;
};

export function RunnerQrCard({
  gameId,
  visible,
  onClose,
}: {
  gameId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [secondsRemaining, setSecondsRemaining] = useState(20);
  const [errorMsg, setErrorMsg] = useState('');
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const fetchToken = useCallback(async () => {
    if (!supabase || !gameId) return;
    try {
      const { data, error } = await supabase.rpc('qr_token', { game_id: gameId });
      if (!mountedRef.current) return;
      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
        return;
      }

      const res = data as QrResponse;
      setToken(res.token);
      setErrorMsg('');

      const uri = await QRCode.toDataURL(res.token, {
        margin: 1,
        width: 240,
        color: {
          dark: '#0F172A',
          light: '#FFFFFF',
        },
      });
      if (!mountedRef.current) return;
      setQrUri(uri);
      setLoading(false);

      const expMs = Date.parse(res.expires_at);
      const remainingSec = Math.max(1, Math.round((expMs - Date.now()) / 1000));
      setSecondsRemaining(remainingSec);

      // Schedule next fetch 3 seconds before current token expires
      const refreshInMs = Math.max(2000, (remainingSec - 3) * 1000);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        void fetchToken();
      }, refreshInMs);
    } catch (err) {
      if (mountedRef.current) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to generate QR token');
        setLoading(false);
      }
    }
  }, [gameId]);

  useEffect(() => {
    mountedRef.current = true;
    if (visible) {
      setLoading(true);
      void fetchToken();
    }
    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [fetchToken, visible]);

  // Tick down seconds remaining
  useEffect(() => {
    if (!visible || !token) return;
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [token, visible]);

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <MaterialCommunityIcons color="#0F172A" name="qrcode" size={24} />
              <Text style={styles.title}>Runner Tag Code</Text>
            </View>
            <Pressable
              accessibilityLabel="Close QR Code"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.closeBtn}
            >
              <Ionicons color="#64748B" name="close" size={20} />
            </Pressable>
          </View>

          <Text style={styles.instructions}>
            Show this screen to a hunter. When they scan it within tag range, your physical
            encounter is confirmed.
          </Text>

          <View style={styles.qrContainer}>
            {loading ? (
              <ActivityIndicator color="#1D4ED8" size="large" style={{ marginVertical: 40 }} />
            ) : errorMsg !== '' ? (
              <Text style={styles.errorText}>{errorMsg}</Text>
            ) : qrUri ? (
              <Image
                accessibilityLabel="Rotating Runner QR Code"
                source={{ uri: qrUri }}
                style={styles.qrImage}
              />
            ) : null}
          </View>

          <View style={styles.timerRow}>
            <Ionicons color="#3B82F6" name="sync" size={16} />
            <Text style={styles.timerText}>
              Rotating code: updates in <Text style={styles.bold}>{secondsRemaining}s</Text>
            </Text>
          </View>

          <Pressable accessibilityRole="button" onPress={onClose} style={styles.doneBtn}>
            <Text style={styles.doneBtnText}>Hide Code</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    elevation: 8,
    maxWidth: 360,
    padding: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    width: '100%',
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    width: '100%',
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  title: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 4,
  },
  instructions: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
    textAlign: 'center',
  },
  qrContainer: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    padding: 16,
  },
  qrImage: {
    borderRadius: 8,
    height: 220,
    width: 220,
  },
  timerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 16,
  },
  timerText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '500',
  },
  bold: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    padding: 20,
    textAlign: 'center',
  },
  doneBtn: {
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 46,
    width: '100%',
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

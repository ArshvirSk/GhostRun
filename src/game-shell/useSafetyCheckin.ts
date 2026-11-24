import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { triggerHaptic } from '../motion/haptics';

export * from '../lib/safetyCheckinCore';

interface UseSafetyCheckinOptions {
  gameId: string;
  isLive: boolean;
  intervalMinutes?: number;
  onSos: () => void;
}

export function useSafetyCheckin({
  gameId,
  isLive,
  intervalMinutes = 15,
  onSos,
}: UseSafetyCheckinOptions) {
  const [modalVisible, setModalVisible] = useState(false);
  const [countdown, setCountdown] = useState(60);

  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const checkinTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearAllTimers = useCallback(() => {
    if (checkinTimerRef.current) {
      clearTimeout(checkinTimerRef.current);
      checkinTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const handleMissedCheckin = useCallback(async () => {
    clearAllTimers();
    setModalVisible(false);
    triggerHaptic('error');

    if (supabase && gameId) {
      try {
        await (supabase.rpc as any)('report_missed_checkin', { game_id: gameId });
      } catch {
        // Non-blocking fallback
      }
    }
  }, [clearAllTimers, gameId]);

  const startCountdown = useCallback(() => {
    setCountdown(60);
    setModalVisible(true);
    triggerHaptic('noiseWarning');

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          void handleMissedCheckin();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [handleMissedCheckin]);

  const scheduleNextCheckin = useCallback(() => {
    clearAllTimers();
    if (!isLive || intervalMinutes <= 0) return;

    const ms = intervalMinutes * 60 * 1000;
    checkinTimerRef.current = setTimeout(() => {
      startCountdown();
    }, ms);
  }, [clearAllTimers, isLive, intervalMinutes, startCountdown]);

  // Handle "I'M OK"
  const handleConfirmOk = useCallback(async () => {
    clearAllTimers();
    setModalVisible(false);
    triggerHaptic('buttonTap');

    if (supabase && gameId) {
      try {
        await (supabase.rpc as any)('record_safety_checkin', { game_id: gameId });
      } catch {
        // Non-blocking fallback
      }
    }

    scheduleNextCheckin();
  }, [clearAllTimers, gameId, scheduleNextCheckin]);

  // Handle "EMERGENCY SOS"
  const handleTriggerSos = useCallback(() => {
    clearAllTimers();
    setModalVisible(false);
    onSos();
  }, [clearAllTimers, onSos]);

  // Lifecycle
  useEffect(() => {
    if (isLive && intervalMinutes > 0) {
      scheduleNextCheckin();
    } else {
      clearAllTimers();
      setModalVisible(false);
    }
    return () => clearAllTimers();
  }, [isLive, intervalMinutes, scheduleNextCheckin, clearAllTimers]);

  return {
    modalVisible,
    countdown,
    handleConfirmOk,
    handleTriggerSos,
    startCheckinNow: startCountdown,
  };
}

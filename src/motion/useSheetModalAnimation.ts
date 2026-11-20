import { useEffect, useRef, useState, useCallback } from 'react';
import { Animated } from 'react-native';

export interface UseSheetModalAnimationOptions {
  slideDistance?: number;
  fadeInDuration?: number;
  fadeOutDuration?: number;
  slideOutDuration?: number;
}

export function useSheetModalAnimation(
  visible: boolean,
  onClose: () => void,
  options?: UseSheetModalAnimationOptions
) {
  const slideDistance = options?.slideDistance ?? 500;
  const fadeInDuration = options?.fadeInDuration ?? 220;
  const fadeOutDuration = options?.fadeOutDuration ?? 180;
  const slideOutDuration = options?.slideOutDuration ?? 200;

  const [mounted, setMounted] = useState(visible);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(slideDistance)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: fadeInDuration,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          damping: 26,
          stiffness: 260,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: fadeOutDuration,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: slideDistance,
          duration: slideOutDuration,
          useNativeDriver: true,
        }),
      ]).start(() => setMounted(false));
    }
  }, [visible, slideDistance, fadeInDuration, fadeOutDuration, slideOutDuration, fadeAnim, slideAnim]);

  const handleClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: fadeOutDuration,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: slideDistance,
        duration: slideOutDuration,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setMounted(false);
      onClose();
    });
  }, [fadeOutDuration, slideOutDuration, slideDistance, onClose, fadeAnim, slideAnim]);

  return { mounted, fadeAnim, slideAnim, handleClose };
}

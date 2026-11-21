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
  const fadeAnim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const slideAnim = useRef(new Animated.Value(visible ? 0 : slideDistance)).current;
  const isFirstRender = useRef(true);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (!visible) {
        return;
      }
    }

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
      ]).start(({ finished }) => {
        if (finished && !visibleRef.current) {
          setMounted(false);
        }
      });
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
    ]).start(({ finished }) => {
      if (finished) {
        setMounted(false);
        onClose();
      }
    });
  }, [fadeOutDuration, slideOutDuration, slideDistance, onClose, fadeAnim, slideAnim]);

  return { mounted, fadeAnim, slideAnim, handleClose };
}

export interface UseDialogModalAnimationOptions {
  fadeInDuration?: number;
  fadeOutDuration?: number;
}

export function useDialogModalAnimation(
  visible: boolean,
  onClose: () => void,
  options?: UseDialogModalAnimationOptions
) {
  const fadeInDuration = options?.fadeInDuration ?? 220;
  const fadeOutDuration = options?.fadeOutDuration ?? 180;

  const [mounted, setMounted] = useState(visible);
  const fadeAnim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const scaleAnim = useRef(new Animated.Value(visible ? 1 : 0.92)).current;
  const isFirstRender = useRef(true);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (!visible) {
        return;
      }
    }

    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: fadeInDuration,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          damping: 24,
          stiffness: 240,
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
        Animated.timing(scaleAnim, {
          toValue: 0.94,
          duration: fadeOutDuration,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished && !visibleRef.current) {
          setMounted(false);
        }
      });
    }
  }, [visible, fadeInDuration, fadeOutDuration, fadeAnim, scaleAnim]);

  const handleClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: fadeOutDuration,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.94,
        duration: fadeOutDuration,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setMounted(false);
        onClose();
      }
    });
  }, [fadeOutDuration, onClose, fadeAnim, scaleAnim]);

  return { mounted, fadeAnim, scaleAnim, handleClose };
}

import React, { useEffect, useState } from 'react';
import { StyleSheet, Animated, ViewStyle } from 'react-native';
import { colors } from '../theme/tokens';
import { useReducedMotion } from './reduced-motion';
import { triggerHaptic } from './haptics';

export interface HeatWashProps {
  active: boolean;
  type?: 'hot' | 'cold';
  onComplete?: () => void;
  style?: ViewStyle;
}

export function HeatWash({
  active,
  type = 'hot',
  onComplete,
  style,
}: HeatWashProps): React.JSX.Element | null {
  const reducedMotion = useReducedMotion();
  const [opacityAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active) {
      opacityAnim.setValue(0);
      return;
    }

    // Trigger haptic feedback corresponding to thermal reading
    triggerHaptic(type === 'hot' ? 'heatHot' : 'heatCold');

    if (reducedMotion) {
      // Reduced motion: static subtle wash for 2 seconds without animated fade
      opacityAnim.setValue(0.2);
      const timer = setTimeout(() => {
        opacityAnim.setValue(0);
        onComplete?.();
      }, 2000);
      return () => clearTimeout(timer);
    }

    // Spec timing: fade in 150ms, hold 1500ms, fade out 1500ms (0 flashing)
    Animated.sequence([
      Animated.timing(opacityAnim, {
        toValue: 0.35,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.delay(1500),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 1500,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onComplete?.();
    });
  }, [active, type, reducedMotion, opacityAnim, onComplete]);

  if (!active) return null;

  const tintColor = type === 'hot' ? colors.heatHot : colors.heatCold;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.overlay,
        {
          backgroundColor: tintColor,
          opacity: opacityAnim,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    zIndex: 9999,
  },
});

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, TextStyle } from 'react-native';
import { Text } from '../ui/Text';
import { motion } from '../theme/tokens';
import { useReducedMotion } from './reduced-motion';

export interface CountUpProps {
  from?: number;
  to: number;
  duration?: number;
  formatValue?: (val: number) => string;
  variant?: 'numeric' | 'display' | 'title' | 'hero';
  color?: string;
  style?: TextStyle;
}

export function CountUp({
  from = 0,
  to,
  duration = motion.reveal,
  formatValue = (v) => Math.round(v).toString(),
  variant = 'numeric',
  color,
  style,
}: CountUpProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [currentValue, setCurrentValue] = useState<number>(from);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    const startTime = Date.now();
    const startVal = from;
    const diff = to - startVal;
    let animationFrameId: number;

    const tick = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const val = startVal + diff * easeOut;
      setCurrentValue(val);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(tick);
      }
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [from, to, duration, reducedMotion]);

  const displayVal = reducedMotion ? to : currentValue;

  return (
    <View style={styles.container}>
      <Text variant={variant} color={color} style={style}>
        {formatValue(displayVal)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

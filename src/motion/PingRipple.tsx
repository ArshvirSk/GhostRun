import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Animated, ViewStyle } from 'react-native';
import { colors, motion } from '../theme/tokens';
import { useReducedMotion } from './reduced-motion';
import { triggerHaptic } from './haptics';

export interface PingRippleProps {
  active?: boolean;
  size?: number;
  color?: string;
  triggerHaptics?: boolean;
  style?: ViewStyle;
}

export function PingRipple({
  active = true,
  size = 120,
  color = colors.radarScan,
  triggerHaptics = false,
  style,
}: PingRippleProps): React.JSX.Element | null {
  const reducedMotion = useReducedMotion();
  const [anim1] = useState(() => new Animated.Value(0));
  const [anim2] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active) {
      anim1.setValue(0);
      anim2.setValue(0);
      return;
    }

    if (triggerHaptics) {
      triggerHaptic('pingArrival');
    }

    if (reducedMotion) {
      anim1.setValue(1);
      return;
    }

    const createRipple = (animVal: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(animVal, {
            toValue: 1,
            duration: motion.ambient,
            useNativeDriver: true,
          }),
          Animated.timing(animVal, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );
    };

    const loop1 = createRipple(anim1, 0);
    const loop2 = createRipple(anim2, motion.ambient / 2);

    loop1.start();
    loop2.start();

    return () => {
      loop1.stop();
      loop2.stop();
    };
  }, [active, reducedMotion, triggerHaptics, anim1, anim2]);

  if (!active) return null;

  if (reducedMotion) {
    return (
      <View
        style={[
          styles.container,
          { width: size, height: size },
          style,
        ]}
      >
        <View
          style={[
            styles.staticRing,
            {
              width: size * 0.8,
              height: size * 0.8,
              borderRadius: (size * 0.8) / 2,
              borderColor: color,
            },
          ]}
        />
      </View>
    );
  }

  const scale1 = anim1.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 1],
  });
  const opacity1 = anim1.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.8, 0.2, 0],
  });

  const scale2 = anim2.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 1],
  });
  const opacity2 = anim2.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.8, 0.2, 0],
  });

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size },
        style,
      ]}
      pointerEvents="none"
    >
      <Animated.View
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: color,
            transform: [{ scale: scale1 }],
            opacity: opacity1,
          },
        ]}
      />
      <Animated.View
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: color,
            transform: [{ scale: scale2 }],
            opacity: opacity2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
  staticRing: {
    borderWidth: 1.5,
    opacity: 0.4,
  },
});

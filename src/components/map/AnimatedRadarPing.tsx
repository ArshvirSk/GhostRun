import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../../theme/tokens';
import { useReducedMotion } from '../../motion/reduced-motion';

export interface AnimatedRadarPingProps {
  size?: number;
  color?: string;
  style?: ViewStyle;
}

/**
 * AnimatedRadarPing
 * Combines the high-resolution Spectral Violet ghost ping sprite with
 * dual GPU-accelerated shockwave rings that expand outward and dissipate.
 */
export function AnimatedRadarPing({
  size = 64,
  color = colors.pingViolet,
  style,
}: AnimatedRadarPingProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) return;

    const createWave = (anim: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );
    };

    const anim1 = createWave(ring1, 0);
    const anim2 = createWave(ring2, 600);

    anim1.start();
    anim2.start();

    return () => {
      anim1.stop();
      anim2.stop();
    };
  }, [reducedMotion, ring1, ring2]);

  // Interpolations for expanding shockwaves
  const scale1 = ring1.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 2.0],
  });
  const opacity1 = ring1.interpolate({
    inputRange: [0, 0.2, 0.8, 1],
    outputRange: [0, 0.7, 0.2, 0],
  });

  const scale2 = ring2.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 2.0],
  });
  const opacity2 = ring2.interpolate({
    inputRange: [0, 0.2, 0.8, 1],
    outputRange: [0, 0.7, 0.2, 0],
  });

  return (
    <View style={[styles.container, { width: size * 2, height: size * 2 }, style]}>
      {/* Expanding Ripple 1 */}
      {!reducedMotion && (
        <Animated.View
          style={[
            styles.shockwaveRing,
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
      )}

      {/* Expanding Ripple 2 */}
      {!reducedMotion && (
        <Animated.View
          style={[
            styles.shockwaveRing,
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
      )}

      {/* Core Ghost Ping Sprite */}
      <Image
        source={require('../../../assets/map/markers/radar-ghost-ping.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shockwaveRing: {
    position: 'absolute',
    borderWidth: 2,
  },
});

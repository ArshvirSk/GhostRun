import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../../theme/tokens';
import { useReducedMotion } from '../../motion/reduced-motion';

export interface AnimatedExtractionTargetProps {
  size?: number;
  color?: string;
  style?: ViewStyle;
}

/**
 * AnimatedExtractionTarget
 * Renders the Acid Lime extraction bullseye with continuous breathing
 * radar pulses and a slowly rotating beacon ring.
 */
export function AnimatedExtractionTarget({
  size = 72,
  color = colors.runner,
  style,
}: AnimatedExtractionTargetProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) return;

    // 1. Breathing pulse loop
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    // 2. Slow rotation loop for radar beacon ticks
    const rotateLoop = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 12000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    pulseLoop.start();
    rotateLoop.start();

    return () => {
      pulseLoop.stop();
      rotateLoop.stop();
    };
  }, [reducedMotion, pulseAnim, rotateAnim]);

  const targetScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.05],
  });

  const auraScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.0, 1.35],
  });

  const auraOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.4, 0.15, 0.0],
  });

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.container, { width: size * 1.5, height: size * 1.5 }, style]}>
      {/* Outer Radiating Pulse Ring */}
      {!reducedMotion && (
        <Animated.View
          style={[
            styles.pulseAura,
            {
              width: size * 1.2,
              height: size * 1.2,
              borderRadius: (size * 1.2) / 2,
              borderColor: color,
              transform: [{ scale: auraScale }],
              opacity: auraOpacity,
            },
          ]}
        />
      )}

      {/* Rotating Core Bullseye Asset */}
      <Animated.View
        style={{
          transform: [
            { scale: reducedMotion ? 1 : targetScale },
            { rotate: reducedMotion ? '0deg' : rotation },
          ],
        }}
      >
        <Image
          source={require('../../../assets/map/markers/extraction-target.png')}
          style={{ width: size, height: size }}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseAura: {
    position: 'absolute',
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
});

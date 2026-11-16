import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { useReducedMotion } from '../../motion/reduced-motion';

export interface TacticalSonarArcProps {
  /** Distance from center in pixels */
  radius: number;
  /** Bearing angle in degrees (0 = North / 12 o'clock) */
  bearingDeg: number;
  /** Color of the curved sonar arc */
  color?: string;
  /** Stroke thickness of the arc */
  strokeWidth?: number;
  /** Arc span in degrees (approximate via container rotation) */
  spanDeg?: number;
  /** Opacity */
  opacity?: number;
  /** Whether the arc pulses outward */
  pulse?: boolean;
  style?: ViewStyle;
}

/**
 * TacticalSonarArc
 *
 * Renders PlayCulture-style curved radial sonar wavefront arcs:
 * - Concentric forward broadcast ripples in front of the centered player
 * - Peripheral directional sector arcs indicating approaching threats or allies
 */
export function TacticalSonarArc({
  radius,
  bearingDeg,
  color = '#2DD4BF',
  strokeWidth = 8,
  opacity = 0.65,
  pulse = true,
  style,
}: TacticalSonarArcProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion || !pulse) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [reducedMotion, pulse, pulseAnim]);

  const scale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.0, 1.06],
  });

  const animOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [opacity * 0.75, opacity],
  });

  // Border top spans 90 deg (-45 to +45 from top)
  const rotation = `${bearingDeg - 45}deg`;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.arc,
        {
          width: radius * 2,
          height: radius * 2,
          borderRadius: radius,
          borderWidth: strokeWidth,
          borderTopColor: color,
          borderRightColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: 'transparent',
          shadowColor: color,
          shadowOpacity: 0.9,
          shadowRadius: strokeWidth * 1.5,
          opacity: reducedMotion ? opacity : animOpacity,
          transform: [{ rotate: rotation }, { scale }],
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  arc: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

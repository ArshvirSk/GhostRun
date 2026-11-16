import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View, ViewStyle } from 'react-native';
import { useReducedMotion } from '../../motion/reduced-motion';

export interface ProximityRadialBloomProps {
  /** Whether the contact is a Hunter/Zombie (Red) or Runner/Normal (Blue) */
  isHunter?: boolean;
  /** Distance to operative in meters */
  distanceM?: number;
  /** Range threshold beyond which bloom stays at min size (default: 150m) */
  maxRangeM?: number;
  /** Tag danger threshold where bloom reaches maximum heat (default: 20m) */
  dangerThresholdM?: number;
  /** Minimum pixel diameter when far (default: 32) */
  minSize?: number;
  /** Maximum pixel diameter when in close proximity (default: 112) */
  maxSize?: number;
  /** Optional custom container style */
  style?: ViewStyle;
}

const hunterBloomSource = require('../../../assets/map/fx/radial-bloom-hunter.png');
const runnerBloomSource = require('../../../assets/map/fx/radial-bloom-runner.png');

/**
 * ProximityRadialBloom
 *
 * Renders a PlayCulture-style two-color radiant gradient bloom (Red for Hunters/Zombies,
 * Blue for Runners/Normals) that dynamically expands and intensifies based on physical
 * distance to the operative.
 *
 * Each bloom is discrete and never merges into GIS rainbow heat maps.
 */
export function ProximityRadialBloom({
  isHunter = true,
  distanceM = 100,
  maxRangeM = 150,
  dangerThresholdM = 25,
  minSize = 34,
  maxSize = 116,
  style,
}: ProximityRadialBloomProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const pulseAnim = useRef(new Animated.Value(0)).current;

  // Calculate distance factor [0.0 = very far, 1.0 = right on top of player]
  const clampedDist = Math.max(0, distanceM);
  const normalizedFactor =
    clampedDist <= dangerThresholdM
      ? 1.0
      : clampedDist >= maxRangeM
      ? 0.0
      : 1.0 - (clampedDist - dangerThresholdM) / (maxRangeM - dangerThresholdM);

  // Dynamic diameter: smoothly scales from minSize to maxSize based on proximity
  const dynamicSize = Math.round(minSize + normalizedFactor * (maxSize - minSize));

  // Dynamic opacity: faint far away (0.28), intense up close (0.92)
  const baseOpacity = 0.28 + normalizedFactor * 0.64;

  const isHot = clampedDist <= dangerThresholdM * 1.5;

  // Pulse animation: faster and stronger when in danger zone
  useEffect(() => {
    if (reducedMotion || !isHot) {
      pulseAnim.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: clampedDist <= dangerThresholdM ? 600 : 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: clampedDist <= dangerThresholdM ? 600 : 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [reducedMotion, isHot, clampedDist, dangerThresholdM, pulseAnim]);

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.0, isHot ? 1.18 : 1.05],
  });

  const pulseOpacityDelta = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.15],
  });

  const imageSource = isHunter ? hunterBloomSource : runnerBloomSource;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.container,
        {
          width: dynamicSize,
          height: dynamicSize,
        },
        style,
      ]}
    >
      <Animated.Image
        source={imageSource}
        style={[
          styles.bloomImage,
          {
            width: dynamicSize,
            height: dynamicSize,
            opacity: reducedMotion ? baseOpacity : Animated.add(baseOpacity, pulseOpacityDelta),
            transform: [{ scale: pulseScale }],
          },
        ]}
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
  bloomImage: {
    position: 'absolute',
  },
});

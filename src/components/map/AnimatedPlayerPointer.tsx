import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View, ViewStyle } from 'react-native';
import { useReducedMotion } from '../../motion/reduced-motion';

export interface AnimatedPlayerPointerProps {
  role?: 'runner' | 'hunter';
  heading?: number;
  size?: number;
  style?: ViewStyle;
}

/**
 * AnimatedPlayerPointer
 * Directional tactical heading chevron that smoothly rotates with device gyro/compass
 * and features a gentle breathing vision cone emission.
 */
export function AnimatedPlayerPointer({
  role = 'runner',
  heading = 0,
  size = 56,
  style,
}: AnimatedPlayerPointerProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const animatedHeading = useRef(new Animated.Value(heading)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  // Smooth rotation when heading updates
  useEffect(() => {
    Animated.timing(animatedHeading, {
      toValue: heading,
      duration: reducedMotion ? 0 : 250,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [heading, reducedMotion, animatedHeading]);

  // Breathing forward vision cone
  useEffect(() => {
    if (reducedMotion) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [reducedMotion, pulseAnim]);

  const rotation = animatedHeading.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  const coneOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1.0],
  });

  const imageSource =
    role === 'hunter'
      ? require('../../../assets/map/pointers/hunter-pointer.png')
      : require('../../../assets/map/pointers/runner-pointer.png');

  // The pointer asset is 128x128 with the arrow graphic centered at y=47 (17px above PNG center).
  // Translating down by (17/128 * size) places the chevron arrow's visual centroid exactly at (0,0)
  // so the arrow tip and body are concentric with the player GPS coordinates and tag radius ring.
  const yOffset = Math.round(size * (17 / 128));

  return (
    <View style={[styles.container, { width: size, height: size }, style]}>
      <Animated.View
        style={{
          width: size,
          height: size,
          transform: [{ rotate: rotation }],
          opacity: reducedMotion ? 1 : coneOpacity,
        }}
      >
        <Image
          source={imageSource}
          style={{
            width: size,
            height: size,
            transform: [{ translateY: yOffset }],
          }}
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
});

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Animated, ViewStyle } from 'react-native';
import { colors, motion } from '../theme/tokens';
import { useReducedMotion } from './reduced-motion';

export interface RadarSweepProps {
  size?: number;
  duration?: number;
  color?: string;
  style?: ViewStyle;
}

export function RadarSweep({
  size = 200,
  duration = motion.ambient * 2, // 3000ms full revolution
  color = colors.radarScan,
  style,
}: RadarSweepProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [rotateAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) {
      rotateAnim.setValue(0);
      return;
    }

    const sweep = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      })
    );
    sweep.start();

    return () => {
      sweep.stop();
    };
  }, [reducedMotion, duration, rotateAnim]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
      pointerEvents="none"
    >
      {/* Outer subtle boundary */}
      <View
        style={[
          styles.outerRing,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      />
      {/* Inner crosshairs */}
      <View style={styles.crosshairH} />
      <View style={styles.crosshairV} />

      {/* Sweep Arm */}
      {!reducedMotion && (
        <Animated.View
          style={[
            styles.armContainer,
            { width: size, height: size, transform: [{ rotate: spin }] },
          ]}
        >
          <View
            style={[
              styles.sweepRay,
              {
                height: size / 2,
                backgroundColor: color,
              },
            ]}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  outerRing: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  crosshairH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.borderLight,
  },
  crosshairV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.borderLight,
  },
  armContainer: {
    position: 'absolute',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  sweepRay: {
    width: 2,
    opacity: 0.6,
  },
});

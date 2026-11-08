import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Animated, ViewStyle } from 'react-native';
import { colors, motion } from '../theme/tokens';
import { useReducedMotion } from './reduced-motion';

export interface GhostEchoProps {
  children?: React.ReactNode;
  active?: boolean;
  echoCount?: number;
  color?: string;
  style?: ViewStyle;
}

export function GhostEcho({
  children,
  active = true,
  echoCount = 3,
  color = colors.ghostTrail,
  style,
}: GhostEchoProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [pulseAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active || reducedMotion) {
      pulseAnim.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: motion.ambient,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: motion.ambient,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();

    return () => {
      loop.stop();
    };
  }, [active, reducedMotion, pulseAnim]);

  if (reducedMotion || !active) {
    return <View style={style}>{children}</View>;
  }

  return (
    <View style={[styles.container, style]}>
      {/* Echo trail layers */}
      {Array.from({ length: echoCount }).map((_, idx) => {
        const offset = (idx + 1) * 3;
        const opacity = pulseAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.15 / (idx + 1), 0.35 / (idx + 1)],
        });
        const scale = pulseAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [1 + idx * 0.05, 1 + (idx + 1) * 0.08],
        });

        return (
          <Animated.View
            key={`echo-${idx}`}
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.echoLayer,
              {
                borderColor: color,
                opacity,
                transform: [
                  { translateX: offset },
                  { translateY: offset },
                  { scale },
                ],
              },
            ]}
          />
        );
      })}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  echoLayer: {
    borderRadius: 8,
    borderWidth: 1,
  },
});

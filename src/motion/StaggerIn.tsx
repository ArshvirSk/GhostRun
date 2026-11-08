import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Animated, ViewStyle } from 'react-native';
import { motion } from '../theme/tokens';
import { useReducedMotion } from './reduced-motion';

export interface StaggerInProps {
  children: React.ReactNode[];
  staggerMs?: number;
  duration?: number;
  style?: ViewStyle;
}

export function StaggerIn({
  children,
  staggerMs = 60,
  duration = motion.transition,
  style,
}: StaggerInProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [anims] = useState(() => children.map(() => new Animated.Value(reducedMotion ? 1 : 0)));

  useEffect(() => {
    if (reducedMotion) {
      anims.forEach((anim) => anim.setValue(1));
      return;
    }

    const animations = anims.map((anim, idx) => {
      return Animated.sequence([
        Animated.delay(idx * staggerMs),
        Animated.timing(anim, {
          toValue: 1,
          duration,
          useNativeDriver: true,
        }),
      ]);
    });

    Animated.parallel(animations).start();
  }, [reducedMotion, staggerMs, duration, anims]);

  if (reducedMotion) {
    return <View style={style}>{children}</View>;
  }

  return (
    <View style={style}>
      {children.map((child, idx) => {
        const anim = anims[idx] || anims[0];
        const opacity = anim;
        const translateY = anim.interpolate({
          inputRange: [0, 1],
          outputRange: [16, 0],
        });

        return (
          <Animated.View
            key={idx}
            style={[
              styles.itemWrapper,
              {
                opacity,
                transform: [{ translateY }],
              },
            ]}
          >
            {child}
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  itemWrapper: {
    width: '100%',
  },
});

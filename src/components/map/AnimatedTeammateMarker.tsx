import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { useReducedMotion } from '../../motion/reduced-motion';

export interface AnimatedTeammateMarkerProps {
  name?: string;
  size?: number;
  color?: string;
  style?: ViewStyle;
}

/**
 * AnimatedTeammateMarker
 * Friendly operative pin with a gentle breathing radar telemetry pulse
 * and callsign label.
 */
export function AnimatedTeammateMarker({
  name,
  size = 48,
  color = colors.heatCold,
  style,
}: AnimatedTeammateMarkerProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const auraAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(auraAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(auraAnim, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [reducedMotion, auraAnim]);

  const auraScale = auraAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.0, 1.4],
  });

  const auraOpacity = auraAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.08],
  });

  return (
    <View style={[styles.container, style]}>
      {/* Outer Telemetry Pulse Aura */}
      {!reducedMotion && (
        <Animated.View
          style={[
            styles.auraRing,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: color,
              transform: [{ scale: auraScale }],
              opacity: auraOpacity,
            },
          ]}
        />
      )}

      {/* Core Teammate Marker Image */}
      <Image
        source={require('../../../assets/map/pointers/teammate-marker.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />

      {/* Callsign Label */}
      {name ? (
        <View style={[styles.labelPill, { backgroundColor: colors.surfaceDark, borderColor: colors.borderDark }]}>
          <Text variant="caption" weight="bold" numberOfLines={1} style={{ color: colors.text, fontSize: 10 }}>
            {name}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraRing: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  labelPill: {
    marginTop: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
  },
});

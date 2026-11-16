import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import { useReducedMotion } from '../../motion/reduced-motion';

export interface TacticalContactCardProps {
  /** Distance in meters */
  distanceM: number;
  /** Whether this contact is a hunter / threat (Red) or runner / friendly (Cyan/Teal/Lime) */
  isHunter?: boolean;
  /** Specific color override */
  color?: string;
  /** Tag danger threshold in meters (default: 25) */
  tagRadiusM?: number;
  /** Role label or ID */
  roleLabel?: string;
  /** Optional custom container style */
  style?: ViewStyle;
}

/**
 * TacticalContactCard
 *
 * PlayCulture-inspired vertical reticle card for radar & map contacts:
 * - Corner reticle targeting brackets ⌜ ⌝ around heart/skull icon
 * - Dynamic crisp distance readout (e.g. 45m, 335)
 * - Mini status/stamina gauge bar
 * - Dynamic danger proximity aura when close (<= 50m)
 */
export function TacticalContactCard({
  distanceM,
  isHunter = true,
  color,
  tagRadiusM = 25,
  roleLabel,
  style,
}: TacticalContactCardProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const pulseAnim = useRef(new Animated.Value(0)).current;

  const isClose = distanceM <= Math.max(tagRadiusM * 2, 50);
  const cardColor = color || (isHunter ? '#FF8A75' : '#2DD4BF');
  const auraColor = isHunter ? 'rgba(255, 42, 85, 0.32)' : 'rgba(45, 212, 191, 0.28)';

  // Proximity pulsing for close contacts
  useEffect(() => {
    if (reducedMotion || !isClose) {
      pulseAnim.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: distanceM <= tagRadiusM ? 600 : 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: distanceM <= tagRadiusM ? 600 : 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [reducedMotion, isClose, distanceM, tagRadiusM, pulseAnim]);

  const auraScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.0, 1.25],
  });

  const auraOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.7],
  });

  const formattedDist =
    distanceM < 1000 ? `${Math.round(distanceM)}${isClose ? 'm' : ''}` : `${(distanceM / 1000).toFixed(1)}k`;

  return (
    <View style={[styles.wrapper, style]}>
      {/* 1. Proximity Danger Halo (Radiates when contact is within threat range) */}
      {isClose && !reducedMotion && (
        <Animated.View
          style={[
            styles.proximityHalo,
            {
              backgroundColor: auraColor,
              borderColor: cardColor,
              transform: [{ scale: auraScale }],
              opacity: auraOpacity,
            },
          ]}
        />
      )}

      {/* 2. Tactical Reticle Card */}
      <View style={[styles.card, { borderColor: cardColor }]}>
        {/* Reticle Corner Brackets & Icon */}
        <View style={styles.reticleContainer}>
          {/* Top Left Bracket */}
          <View style={[styles.cornerBracketTL, { borderColor: cardColor }]} />
          {/* Top Right Bracket */}
          <View style={[styles.cornerBracketTR, { borderColor: cardColor }]} />
          {/* Bottom Left Bracket */}
          <View style={[styles.cornerBracketBL, { borderColor: cardColor }]} />
          {/* Bottom Right Bracket */}
          <View style={[styles.cornerBracketBR, { borderColor: cardColor }]} />

          <Ionicons
            name={isHunter ? 'skull' : 'heart'}
            size={11}
            color={cardColor}
            style={{ alignSelf: 'center' }}
          />
        </View>

        {/* Distance Readout */}
        <Text style={[styles.distanceText, { color: cardColor }]}>
          {formattedDist}
        </Text>

        {/* Mini Status / Gauge Bar */}
        <View style={styles.gaugeContainer}>
          <View
            style={[
              styles.gaugeFill,
              {
                backgroundColor: cardColor,
                width: isClose ? '100%' : distanceM < 150 ? '60%' : '35%',
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  proximityHalo: {
    position: 'absolute',
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1,
  },
  card: {
    width: 32,
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderRadius: 6,
    borderWidth: 1.5,
    backgroundColor: '#16091A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 5,
  },
  reticleContainer: {
    width: 18,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 1,
  },
  cornerBracketTL: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 3,
    height: 3,
    borderTopWidth: 1,
    borderLeftWidth: 1,
  },
  cornerBracketTR: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 3,
    height: 3,
    borderTopWidth: 1,
    borderRightWidth: 1,
  },
  cornerBracketBL: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 3,
    height: 3,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
  },
  cornerBracketBR: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 3,
    height: 3,
    borderBottomWidth: 1,
    borderRightWidth: 1,
  },
  distanceText: {
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: -0.2,
    marginVertical: 1,
    textAlign: 'center',
  },
  gaugeContainer: {
    width: 18,
    height: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 1.5,
    overflow: 'hidden',
    marginTop: 1,
  },
  gaugeFill: {
    height: '100%',
    borderRadius: 1.5,
  },
});

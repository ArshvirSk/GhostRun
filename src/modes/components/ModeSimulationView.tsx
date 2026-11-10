import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from '../../ui/Text';
import { Chip } from '../../ui/Chip';
import { triggerHaptic } from '../../motion/haptics';

const DARK_MAP = require('../../../assets/onboarding/tactical-city-map-portrait.jpg');
const LIGHT_MAP = require('../../../assets/onboarding/tactical-city-map-light.jpg');

interface ModeSimulationViewProps {
  modeId: string;
}

interface SimConfig {
  title: string;
  subtitle: string;
  runnerLabel: string;
  hunterLabel?: string;
  hasTarget?: boolean;
  targetLabel?: string;
  hasJail?: boolean;
  hasShrinkingZone?: boolean;
  hasTerritories?: boolean;
  hasGhost?: boolean;
}

const MODE_CONFIGS: Record<string, SimConfig> = {
  classic_chase: {
    title: 'EXTRACTION INFILTRATION',
    subtitle: 'Runner moves toward secret target; hunter tracks via delayed radar pings',
    runnerLabel: 'Runner',
    hunterLabel: 'Hunter',
    hasTarget: true,
    targetLabel: 'EXTRACTION',
  },
  tag_hunt: {
    title: 'ZONE CONTRACTION PURSUIT',
    subtitle: 'Perimeter contracts; runners evade hunters to outlast the timer',
    runnerLabel: 'Runner',
    hunterLabel: 'Hunter',
    hasShrinkingZone: true,
  },
  jailbreak: {
    title: 'PRISON INFILTRATION & RESCUE',
    subtitle: 'Free runner infiltrates secure jail zone to break out tagged teammates',
    runnerLabel: 'Infiltrator',
    hunterLabel: 'Guard',
    hasJail: true,
  },
  assassin_ring: {
    title: 'CIRCULAR TARGET PURSUIT',
    subtitle: 'Every player tracks an assigned target while being hunted by another',
    runnerLabel: 'Agent A',
    hunterLabel: 'Target B',
  },
  relay_heist: {
    title: 'INTEL RELAY EXCHANGE',
    subtitle: 'Runners pass the glowing intel beacon between zones while evading patrols',
    runnerLabel: 'Carrier',
    hunterLabel: 'Patrol',
    hasTarget: true,
    targetLabel: 'EXCHANGE',
  },
  territory_pulse: {
    title: 'TERRITORY CAPTURE & HOLD',
    subtitle: 'Teams contest and control active pulse sectors across the street grid',
    runnerLabel: 'Team Alpha',
    hunterLabel: 'Team Bravo',
    hasTerritories: true,
  },
  ghost_duel: {
    title: 'AFTERIMAGE TIME TRIAL',
    subtitle: 'Race head-to-head against a recorded ghost runner pace along the streets',
    runnerLabel: 'You',
    hasGhost: true,
  },
};

export function ModeSimulationView({ modeId }: ModeSimulationViewProps) {
  const { isDark, colors, radii, spacing } = useTheme();
  const config = MODE_CONFIGS[modeId] || MODE_CONFIGS.classic_chase;
  const [isPlaying, setIsPlaying] = useState(true);

  // Position animated values in pixels (all useNativeDriver: true via transform)
  const runnerPos = useRef(new Animated.ValueXY({ x: 75, y: 155 })).current;
  const hunterPos = useRef(new Animated.ValueXY({ x: 215, y: 75 })).current;
  const ghostPos = useRef(new Animated.ValueXY({ x: 75, y: 155 })).current;

  // Effects animated values
  const radarScale = useRef(new Animated.Value(0.2)).current;
  const radarOpacity = useRef(new Animated.Value(0.85)).current;
  const zoneScale = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isPlaying) return;

    // Reset initial positions
    runnerPos.setValue({ x: 75, y: 155 });
    hunterPos.setValue({ x: 215, y: 75 });
    ghostPos.setValue({ x: 75, y: 155 });
    radarScale.setValue(0.2);
    radarOpacity.setValue(0.85);
    zoneScale.setValue(1);
    pulseAnim.setValue(1);

    // Continuous pulse for target / capture zones
    const targetPulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.25,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    targetPulse.start();

    // Radar ping ripples
    const radarPing = Animated.loop(
      Animated.parallel([
        Animated.timing(radarScale, {
          toValue: 2.2,
          duration: 2000,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(radarOpacity, {
          toValue: 0,
          duration: 2000,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    radarPing.start();

    // Shrinking zone animation for Tag Hunt
    let zoneAnim: Animated.CompositeAnimation | null = null;
    if (config.hasShrinkingZone) {
      zoneAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(zoneScale, {
            toValue: 0.55,
            duration: 4800,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(800),
          Animated.timing(zoneScale, {
            toValue: 1,
            duration: 1400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
      zoneAnim.start();
    }

    // Runner movement loop
    let runnerAnim: Animated.CompositeAnimation;
    if (config.hasTarget) {
      // Moves towards top-right extraction target (x: 210, y: 50)
      runnerAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(runnerPos, {
            toValue: { x: 120, y: 120 },
            duration: 2000,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(runnerPos, {
            toValue: { x: 120, y: 65 },
            duration: 1800,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(runnerPos, {
            toValue: { x: 205, y: 55 },
            duration: 1800,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.delay(900),
          Animated.timing(runnerPos, {
            toValue: { x: 75, y: 155 },
            duration: 1200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
    } else if (config.hasJail) {
      // Moves toward center jail zone (x: 145, y: 105)
      runnerAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(runnerPos, {
            toValue: { x: 95, y: 110 },
            duration: 2000,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(runnerPos, {
            toValue: { x: 145, y: 105 },
            duration: 1800,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.delay(900),
          Animated.timing(runnerPos, {
            toValue: { x: 235, y: 165 },
            duration: 2200,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.delay(600),
          Animated.timing(runnerPos, {
            toValue: { x: 75, y: 155 },
            duration: 1200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
    } else {
      // Circuit patrol / evasion
      runnerAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(runnerPos, {
            toValue: { x: 75, y: 75 },
            duration: 2400,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(runnerPos, {
            toValue: { x: 215, y: 75 },
            duration: 2400,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(runnerPos, {
            toValue: { x: 215, y: 155 },
            duration: 2400,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(runnerPos, {
            toValue: { x: 75, y: 155 },
            duration: 2400,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ])
      );
    }
    runnerAnim.start();

    // Hunter patrol loop
    const hunterAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(hunterPos, {
          toValue: { x: 215, y: 145 },
          duration: 2600,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(hunterPos, {
          toValue: { x: 140, y: 145 },
          duration: 2200,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(hunterPos, {
          toValue: { x: 140, y: 75 },
          duration: 2200,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(hunterPos, {
          toValue: { x: 215, y: 75 },
          duration: 2400,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    );
    hunterAnim.start();

    // Ghost NPC loop for solo duel (offset pace)
    let ghostAnim: Animated.CompositeAnimation | null = null;
    if (config.hasGhost) {
      ghostAnim = Animated.loop(
        Animated.sequence([
          Animated.delay(600),
          Animated.timing(ghostPos, {
            toValue: { x: 75, y: 75 },
            duration: 2400,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(ghostPos, {
            toValue: { x: 215, y: 75 },
            duration: 2400,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(ghostPos, {
            toValue: { x: 215, y: 155 },
            duration: 2400,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(ghostPos, {
            toValue: { x: 75, y: 155 },
            duration: 2400,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ])
      );
      ghostAnim.start();
    }

    return () => {
      targetPulse.stop();
      radarPing.stop();
      runnerAnim.stop();
      hunterAnim.stop();
      if (zoneAnim) zoneAnim.stop();
      if (ghostAnim) ghostAnim.stop();
    };
  }, [isPlaying, config, runnerPos, hunterPos, ghostPos, radarScale, radarOpacity, zoneScale, pulseAnim]);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
          <Text variant="label" numberOfLines={1} style={{ color: colors.primary, fontSize: 11, flexShrink: 1 }}>
            MODE IN ACTION
          </Text>
        </View>
        <Chip
          label={isPlaying ? 'ACTIVE' : 'PAUSED'}
          variant={isPlaying ? 'accent' : 'muted'}
          size="sm"
        />
      </View>

      <Text variant="title" style={{ color: colors.text, fontSize: 15, marginTop: 4 }}>
        {config.title}
      </Text>
      <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm }}>
        {config.subtitle}
      </Text>

      {/* Visual Map Canvas Viewport */}
      <View
        style={[
          styles.mapViewport,
          {
            borderRadius: radii.md,
            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
          },
        ]}
      >
        <Image
          source={isDark ? DARK_MAP : LIGHT_MAP}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(10,12,18,0.55)' : 'rgba(240,244,248,0.40)' }]} />

        {/* Floating Map Play/Pause Control (securely positioned inside map box) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause tactical simulation' : 'Play tactical simulation'}
          onPress={() => {
            triggerHaptic('buttonTap');
            setIsPlaying(!isPlaying);
          }}
          style={[styles.mapPlayToggle, { backgroundColor: 'rgba(16, 16, 20, 0.78)', borderColor: 'rgba(255,255,255,0.22)' }]}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={14}
            color="#FFFFFF"
          />
        </Pressable>

        {/* Tactical Perimeter Boundary Circle */}
        <Animated.View
          style={[
            styles.boundaryRing,
            {
              borderColor: config.hasShrinkingZone ? '#EF4444' : colors.primary,
              transform: [{ scale: zoneScale }],
            },
          ]}
        />

        {/* Target Extraction Point (Classic Chase, Relay Heist) */}
        {config.hasTarget && (
          <View style={[styles.targetWrapper, { left: 205, top: 45 }]}>
            <Animated.View
              style={[
                styles.targetPulseRing,
                {
                  transform: [{ scale: pulseAnim }],
                  borderColor: '#EAB308',
                },
              ]}
            />
            <View style={[styles.targetMarker, { backgroundColor: '#EAB308' }]}>
              <MaterialCommunityIcons name="target" size={14} color="#000000" />
            </View>
            <View style={styles.markerBadge}>
              <Text variant="mono" style={{ color: '#EAB308', fontSize: 9, fontWeight: '700' }}>
                {config.targetLabel}
              </Text>
            </View>
          </View>
        )}

        {/* Secure Jail Zone (Jailbreak) */}
        {config.hasJail && (
          <View style={[styles.jailZone, { left: 135, top: 95 }]}>
            <View style={styles.jailBorder}>
              <MaterialCommunityIcons name="lock-outline" size={14} color="#EF4444" />
              <Text variant="mono" style={{ color: '#EF4444', fontSize: 9, fontWeight: '700', marginTop: 1 }}>
                JAIL
              </Text>
            </View>
          </View>
        )}

        {/* Territories (Territory Pulse) */}
        {config.hasTerritories && (
          <>
            <View style={[styles.sectorRing, { left: 75, top: 80, borderColor: colors.primary }]}>
              <Text variant="mono" style={{ color: colors.primary, fontSize: 8 }}>SEC A</Text>
            </View>
            <View style={[styles.sectorRing, { left: 215, top: 140, borderColor: '#EF4444' }]}>
              <Text variant="mono" style={{ color: '#EF4444', fontSize: 8 }}>SEC B</Text>
            </View>
          </>
        )}

        {/* Ghost Afterimage Blip (Solo Ghost Duel) */}
        {config.hasGhost && (
          <Animated.View
            style={[
              styles.blipContainer,
              {
                transform: [
                  { translateX: ghostPos.x },
                  { translateY: ghostPos.y },
                ],
                opacity: 0.65,
              },
            ]}
          >
            <View style={[styles.blipCore, { backgroundColor: '#A855F7', borderColor: '#FFFFFF' }]} />
            <View style={[styles.blipPill, { backgroundColor: 'rgba(168, 85, 247, 0.9)' }]}>
              <Text variant="mono" style={{ color: '#FFFFFF', fontSize: 9 }}>Ghost</Text>
            </View>
          </Animated.View>
        )}

        {/* Hunter Blip (contains the pulsing radar ripple directly centered on hunter) */}
        {config.hunterLabel && (
          <Animated.View
            style={[
              styles.blipContainer,
              {
                transform: [
                  { translateX: hunterPos.x },
                  { translateY: hunterPos.y },
                ],
              },
            ]}
          >
            <Animated.View
              style={[
                styles.radarRipple,
                {
                  borderColor: '#EF4444',
                  opacity: radarOpacity,
                  transform: [{ scale: radarScale }],
                },
              ]}
            />
            <View style={[styles.blipCore, { backgroundColor: '#EF4444', borderColor: '#FFFFFF' }]} />
            <View style={[styles.blipPill, { backgroundColor: 'rgba(239, 68, 68, 0.9)' }]}>
              <Text variant="mono" style={{ color: '#FFFFFF', fontSize: 9 }}>
                {config.hunterLabel}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Runner Blip */}
        <Animated.View
          style={[
            styles.blipContainer,
            {
              transform: [
                { translateX: runnerPos.x },
                { translateY: runnerPos.y },
              ],
            },
          ]}
        >
          <View style={[styles.blipCore, { backgroundColor: colors.primary, borderColor: '#000000' }]} />
          <View style={[styles.blipPill, { backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)' }]}>
            <Text variant="mono" style={{ color: colors.text, fontSize: 9, fontWeight: '700' }}>
              {config.runnerLabel}
            </Text>
          </View>
        </Animated.View>

        {/* Bottom Simulation Legend */}
        <View style={styles.legendOverlay}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
            <Text variant="caption" style={{ color: '#FFFFFF', fontSize: 10 }}>
              {config.runnerLabel}
            </Text>
          </View>
          {config.hunterLabel && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
              <Text variant="caption" style={{ color: '#FFFFFF', fontSize: 10 }}>
                {config.hunterLabel}
              </Text>
            </View>
          )}
          {config.hasGhost && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#A855F7' }]} />
              <Text variant="caption" style={{ color: '#FFFFFF', fontSize: 10 }}>
                Ghost Pacer
              </Text>
            </View>
          )}
          {config.hasTarget && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#EAB308' }]} />
              <Text variant="caption" style={{ color: '#FFFFFF', fontSize: 10 }}>
                {config.targetLabel}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  mapPlayToggle: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    zIndex: 20,
    elevation: 4,
  },
  mapViewport: {
    width: '100%',
    height: 220,
    marginTop: 8,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
  },
  boundaryRing: {
    position: 'absolute',
    top: 15,
    left: 25,
    width: 250,
    height: 190,
    borderRadius: 95,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    opacity: 0.65,
  },
  targetWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetPulseRing: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    opacity: 0.5,
  },
  targetMarker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerBadge: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginTop: 2,
  },
  jailZone: {
    position: 'absolute',
  },
  jailBorder: {
    width: 50,
    height: 50,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#EF4444',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectorRing: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarRipple: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    top: -23,
    left: -23,
  },
  blipContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  blipCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  blipPill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginTop: 2,
  },
  legendOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
});

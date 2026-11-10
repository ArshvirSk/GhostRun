import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Dimensions,
  Image,
  Animated,
  Easing,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import { useReducedMotion } from '../motion/reduced-motion';
import { TourScript, TourBeat, TourMarker } from './TourScript';

export interface TourPlayerProps {
  script: TourScript;
  onFinish?: () => void;
  onSkip?: () => void;
  onSignUp?: () => void;
  onSignIn?: () => void;
  onHostGame?: () => void;
  onJoinCode?: () => void;
  onDemoRound?: () => void;
  isAuthenticated?: boolean;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const DARK_MAP_ASSET = require('../../assets/onboarding/tactical-city-map-portrait.jpg');
const LIGHT_MAP_ASSET = require('../../assets/onboarding/tactical-city-map-light.jpg');

function AnimatedMarkerItem({
  marker,
  beatId,
  isDark,
  colors,
}: {
  marker: TourMarker;
  beatId: string;
  isDark: boolean;
  colors: any;
}) {
  const posAnim = useRef(new Animated.ValueXY({ x: marker.x, y: marker.y })).current;

  useEffect(() => {
    posAnim.setValue({ x: marker.x, y: marker.y });
    if (marker.targetX !== undefined && marker.targetY !== undefined) {
      Animated.timing(posAnim, {
        toValue: { x: marker.targetX, y: marker.targetY },
        duration: 3200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }
  }, [beatId, marker.x, marker.y, marker.targetX, marker.targetY, posAnim]);

  const isHunter = marker.role === 'hunter';
  const isTagged = marker.isTagged;
  const isEcho = marker.isEcho;

  // Dot color scheme
  let dotBg = '#FFFFFF';
  let dotBorder = '#101014';
  if (isHunter) {
    dotBg = '#FF5236'; // Hunter Coral/Red
  } else if (isTagged) {
    dotBg = '#FF5236';
  } else if (isEcho) {
    dotBg = 'transparent';
    dotBorder = colors.primary;
  } else if (marker.label?.toLowerCase() === 'you') {
    dotBg = colors.primary; // Neon mint / tactical olive
  }

  return (
    <Animated.View
      style={[
        styles.markerContainer,
        {
          left: posAnim.x.interpolate({
            inputRange: [0, 100],
            outputRange: ['0%', '100%'],
          }),
          top: posAnim.y.interpolate({
            inputRange: [0, 100],
            outputRange: ['0%', '100%'],
          }),
        },
      ]}
    >
      {/* Visual Marker Dot */}
      <View
        style={[
          styles.markerDot,
          {
            backgroundColor: dotBg,
            borderColor: dotBorder,
            borderWidth: isEcho ? 2 : 1.5,
            opacity: isEcho ? 0.75 : 1,
          },
        ]}
      />

      {/* Floating Tactical Callout Capsule */}
      {marker.label && (
        <View
          style={[
            styles.markerBadge,
            {
              backgroundColor: isDark ? 'rgba(16, 16, 20, 0.88)' : 'rgba(255, 255, 255, 0.92)',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)',
            },
          ]}
        >
          <Text
            style={[
              styles.markerLabelText,
              { color: isDark ? '#FFFFFF' : '#101014' },
            ]}
          >
            {marker.label}
          </Text>
          {marker.sublabel && (
            <Text
              style={[
                styles.markerSublabelText,
                { color: marker.isOutsideZone || marker.isTagged ? '#FF5236' : isDark ? '#9E9DA8' : '#6A6773' },
              ]}
            >
              {' '}{marker.sublabel}
            </Text>
          )}
        </View>
      )}
    </Animated.View>
  );
}

export function TourPlayer({
  script,
  onFinish,
  onSkip,
  onSignUp,
  onSignIn,
  onHostGame,
  onJoinCode,
  onDemoRound,
  isAuthenticated = false,
}: TourPlayerProps): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [currentBeatIndex, setCurrentBeatIndex] = useState(0);

  const beat = script.beats[currentBeatIndex] || script.beats[0];
  const totalBeats = script.beats.length;
  const isLastBeat = currentBeatIndex === totalBeats - 1;

  // Animated Camera States (Zoom & Pan)
  const initialRawZoom = script.beats[0]?.camera.zoom || 14;
  const initialZoom = initialRawZoom >= 10 ? (initialRawZoom - 10) * 0.08 + 1.0 : initialRawZoom;
  const zoomAnim = useRef(new Animated.Value(initialZoom)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;

  // Animated Zone Perimeter (Radius)
  const zoneRadiusAnim = useRef(new Animated.Value(beat.zoneRadiusPct || 76)).current;

  // Animated Ping Ripple Wave
  const pingScaleAnim = useRef(new Animated.Value(0.1)).current;
  const pingOpacityAnim = useRef(new Animated.Value(0.8)).current;

  // Camera and Zone transition on beat change
  useEffect(() => {
    const rawZoom = beat.camera.zoom || 14;
    const targetZoom = rawZoom >= 10 ? (rawZoom - 10) * 0.08 + 1.0 : rawZoom;
    const [cx, cy] = beat.camera.center || [50, 50];
    const targetTx = (50 - cx) * 2.2;
    const targetTy = (50 - cy) * 2.2;

    Animated.parallel([
      Animated.spring(zoomAnim, {
        toValue: targetZoom,
        useNativeDriver: true,
        friction: 7,
        tension: 40,
      }),
      Animated.spring(translateXAnim, {
        toValue: targetTx,
        useNativeDriver: true,
        friction: 7,
        tension: 40,
      }),
      Animated.spring(translateYAnim, {
        toValue: targetTy,
        useNativeDriver: true,
        friction: 7,
        tension: 40,
      }),
      Animated.spring(zoneRadiusAnim, {
        toValue: beat.zoneRadiusPct || 76,
        useNativeDriver: false,
        friction: 7,
        tension: 35,
      }),
    ]).start();

    // Trigger radar ripple if present
    const hasRipple = beat.overlays.some((o) => o.type === 'pingRipple');
    if (hasRipple) {
      pingScaleAnim.setValue(0.1);
      pingOpacityAnim.setValue(0.85);
      Animated.parallel([
        Animated.timing(pingScaleAnim, {
          toValue: 2.8,
          duration: 1800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pingOpacityAnim, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [currentBeatIndex, beat, zoomAnim, translateXAnim, translateYAnim, zoneRadiusAnim, pingScaleAnim, pingOpacityAnim]);

  // Auto-advance logic
  useEffect(() => {
    if (reducedMotion || isLastBeat) return;
    const timer = setTimeout(() => {
      setCurrentBeatIndex((prev) => Math.min(prev + 1, totalBeats - 1));
    }, beat.durationMs);

    return () => clearTimeout(timer);
  }, [currentBeatIndex, reducedMotion, isLastBeat, beat.durationMs, totalBeats]);

  const handleNext = () => {
    triggerHaptic('buttonTap');
    if (isLastBeat) {
      if (onFinish) {
        onFinish();
      } else if (!isAuthenticated && onSignUp) {
        onSignUp();
      } else {
        router.replace('/play' as any);
      }
    } else {
      setCurrentBeatIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    triggerHaptic('buttonTap');
    if (currentBeatIndex > 0) {
      setCurrentBeatIndex((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    triggerHaptic('buttonTap');
    if (onSkip) {
      onSkip();
    } else {
      setCurrentBeatIndex(totalBeats - 1);
    }
  };

  const handleHostAction = () => {
    triggerHaptic('buttonTap');
    if (onHostGame) {
      onHostGame();
    } else if (isAuthenticated) {
      router.push('/host/mode' as any);
    } else if (onSignUp) {
      onSignUp();
    } else {
      router.push('/signup/name' as any);
    }
  };

  const handleJoinAction = () => {
    triggerHaptic('buttonTap');
    if (onJoinCode) {
      onJoinCode();
    } else {
      router.push('/join' as any);
    }
  };

  const handleRestart = () => {
    triggerHaptic('buttonTap');
    setCurrentBeatIndex(0);
  };

  const isHunterView = beat.viewMode === 'hunters';
  const hasRipple = beat.overlays.some((o) => o.type === 'pingRipple');

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#101014' : '#F3F0E8' }]}>
      {/* 1. Full-Bleed Map Canvas with Animated Camera */}
      <View style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            styles.mapAnimatedWrapper,
            {
              transform: [
                { scale: zoomAnim },
                { translateX: translateXAnim },
                { translateY: translateYAnim },
              ],
            },
          ]}
        >
          <Image
            source={isDark ? DARK_MAP_ASSET : LIGHT_MAP_ASSET}
            style={styles.mapImage}
            resizeMode="cover"
          />

          {/* Animated Tactical Perimeter Zone Circle */}
          <Animated.View
            style={[
              styles.perimeterCircle,
              {
                width: zoneRadiusAnim.interpolate({
                  inputRange: [0, 100],
                  outputRange: [0, SCREEN_WIDTH],
                }),
                height: zoneRadiusAnim.interpolate({
                  inputRange: [0, 100],
                  outputRange: [0, SCREEN_WIDTH],
                }),
                borderRadius: zoneRadiusAnim.interpolate({
                  inputRange: [0, 100],
                  outputRange: [0, SCREEN_WIDTH / 2],
                }),
                borderColor: '#FF5236',
              },
            ]}
          />

          {/* Radar Ping Ripple Wave */}
          {hasRipple && (
            <Animated.View
              style={[
                styles.pingRippleWave,
                {
                  transform: [{ scale: pingScaleAnim }],
                  opacity: pingOpacityAnim,
                  borderColor: isDark ? colors.primary : '#557A22',
                },
              ]}
            />
          )}

          {/* Dynamic Map Markers with Coordinate Interpolation */}
          {beat.markers.map((marker) => (
            <AnimatedMarkerItem
              key={`${beat.id}-${marker.id}`}
              marker={marker}
              beatId={beat.id}
              isDark={isDark}
              colors={colors}
            />
          ))}
        </Animated.View>
      </View>

      {/* 2. Top Bar & Story Progress Segments */}
      <View
        style={[
          styles.topControls,
          {
            paddingTop: Math.max(insets.top, 20) + 4,
          },
        ]}
      >
        {/* Progress Bar Segments */}
        <View style={styles.segmentsRow}>
          {script.beats.map((_, idx) => (
            <View
              key={idx}
              style={[
                styles.segment,
                {
                  backgroundColor:
                    idx === currentBeatIndex
                      ? isDark ? '#FFFFFF' : '#101014'
                      : idx < currentBeatIndex
                      ? isDark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.45)'
                      : isDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(0, 0, 0, 0.12)',
                },
              ]}
            />
          ))}
        </View>

        {/* Skip Button */}
        <View style={styles.skipRow}>
          <TouchableOpacity
            onPress={isLastBeat ? handleNext : handleSkip}
            accessibilityRole="button"
            accessibilityLabel={isLastBeat ? 'Done' : 'Skip'}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text
              style={[
                styles.skipText,
                { color: isDark ? '#FFFFFF' : '#101014' },
              ]}
            >
              {isLastBeat ? 'Done' : 'Skip'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 3. Floating HUD Card */}
        <View
          style={[
            styles.hudCard,
            {
              backgroundColor: isDark ? '#1C1D24E6' : '#FFFFFFF2',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
            },
          ]}
        >
          {/* Left Block: Timer / Head Start */}
          <View style={styles.hudLeftBlock}>
            <Text style={[styles.hudLabel, { color: isDark ? '#9E9DA8' : '#5D5A62' }]}>
              {beat.hudLeftLabel || 'Time left'}
            </Text>
            <Text style={[styles.hudValue, { color: isDark ? '#FFFFFF' : '#101014' }]}>
              {beat.hudLeftValue || '28:00'}
            </Text>
          </View>

          {/* Vertical Divider */}
          <View
            style={[
              styles.hudDivider,
              { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)' },
            ]}
          />

          {/* Right Block: Next Ping & Progress */}
          <View style={styles.hudRightBlock}>
            <View style={styles.hudRightTop}>
              <Text style={[styles.hudLabel, { color: isDark ? '#9E9DA8' : '#5D5A62' }]}>
                {beat.hudRightLabel || 'Next ping'}
              </Text>
              <Text
                style={[
                  styles.hudPingValue,
                  {
                    color: beat.hudRightValue === 'Now' ? '#FF5236' : isDark ? '#FFFFFF' : '#101014',
                  },
                ]}
              >
                {beat.hudRightValue || '2:00'}
              </Text>
            </View>

            {/* Ping Progress Bar */}
            <View
              style={[
                styles.pingProgressBarTrack,
                { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.10)' },
              ]}
            >
              <View
                style={[
                  styles.pingProgressBarFill,
                  {
                    width: `${Math.round((beat.hudRightProgress ?? 0.2) * 100)}%`,
                    backgroundColor: '#FF5236',
                  },
                ]}
              />
            </View>

            <Text style={[styles.hudSubtext, { color: isDark ? '#9E9DA8' : '#5D5A62' }]}>
              {beat.hudRightSubtext || 'Hunters see every runner'}
            </Text>
          </View>
        </View>

        {/* Hunters' Map / Runners' Map Badge Pill */}
        {beat.badgeText && (
          <View
            style={[
              styles.mapModeBadge,
              {
                backgroundColor: isDark ? '#FFFFFF' : '#101014',
              },
            ]}
          >
            <Text
              style={[
                styles.mapModeBadgeText,
                { color: isDark ? '#101014' : '#FFFFFF' },
              ]}
            >
              {beat.badgeText}
            </Text>
          </View>
        )}
      </View>

      {/* 4. Story Touch Zones (Tap left: Step Backward, Tap right: Step Forward) */}
      <View style={styles.touchContainer} pointerEvents={isLastBeat ? 'box-none' : 'auto'}>
        <Pressable
          onPress={handlePrev}
          style={styles.touchLeft}
          accessibilityRole="button"
          accessibilityLabel="Previous briefing step"
        />
        <Pressable
          onPress={isLastBeat ? undefined : handleNext}
          style={styles.touchRight}
          accessibilityRole="button"
          accessibilityLabel="Next briefing step"
        />
      </View>

      {/* 5. Bottom Story Card */}
      <View
        style={[
          styles.bottomCard,
          {
            backgroundColor: isDark ? '#1C1D24F0' : '#FFFFFFFA',
            borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)',
            marginBottom: Math.max(insets.bottom, 16) + 6,
          },
        ]}
      >
        {/* Category Pill Tag */}
        <Text style={[styles.categoryTag, { color: '#FF5236' }]}>
          {beat.category}
        </Text>

        {/* Title */}
        <Text style={[styles.cardTitle, { color: isDark ? '#FFFFFF' : '#101014' }]}>
          {beat.title}
        </Text>

        {/* Subtitle */}
        <Text style={[styles.cardSubtitle, { color: isDark ? '#B7B2BF' : '#5D5A62' }]}>
          {beat.subtitle}
        </Text>

        {/* Final Slide Interactive Action Buttons */}
        {isLastBeat ? (
          <View style={styles.actionSection}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Host a game"
              onPress={handleHostAction}
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
                Host a game
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Join with a code"
              onPress={handleJoinAction}
              style={[
                styles.secondaryButton,
                {
                  backgroundColor: isDark ? '#2B2C36' : '#FFFFFF',
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)',
                },
              ]}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                Join with a code
              </Text>
            </Pressable>

            <View style={styles.bottomLinksRow}>
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic('buttonTap');
                  if (onDemoRound) onDemoRound();
                  else router.push('/host/mode' as any);
                }}
              >
                <Text style={[styles.subLinkText, { color: colors.textMuted }]}>
                  Try a demo round
                </Text>
              </TouchableOpacity>
              <Text style={[styles.dotSeparator, { color: colors.textMuted }]}>·</Text>
              <TouchableOpacity onPress={handleRestart}>
                <Text style={[styles.subLinkText, { color: colors.textMuted }]}>
                  Watch again
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.finePrint, { color: isDark ? '#7E7D8A' : '#8A8794' }]}>
              These are the default times. The host can change them, or turn pings and the zone off.
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={handleNext}
            style={styles.continuePrompt}
            accessibilityRole="button"
            accessibilityLabel="Tap to continue"
          >
            <Text style={[styles.continuePromptText, { color: isDark ? '#9E9DA8' : '#73707D' }]}>
              Tap to continue ›
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
  },
  mapAnimatedWrapper: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapImage: {
    width: SCREEN_WIDTH * 1.5,
    height: SCREEN_HEIGHT * 1.3,
  },
  perimeterCircle: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'solid',
    shadowColor: '#FF5236',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
  },
  pingRippleWave: {
    position: 'absolute',
    width: SCREEN_WIDTH * 0.75,
    height: SCREEN_WIDTH * 0.75,
    borderRadius: (SCREEN_WIDTH * 0.75) / 2,
    borderWidth: 3,
  },
  markerContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -10,
    marginTop: -10,
    zIndex: 5,
  },
  markerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 4,
  },
  markerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5,
  },
  markerLabelText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    fontWeight: '800',
  },
  markerSublabelText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    fontWeight: '500',
  },
  topControls: {
    paddingHorizontal: 16,
    zIndex: 10,
  },
  segmentsRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 10,
  },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },
  skipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  skipText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  hudCard: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  hudLeftBlock: {
    flex: 1,
    justifyContent: 'center',
  },
  hudDivider: {
    width: 1,
    marginHorizontal: 14,
  },
  hudRightBlock: {
    flex: 1.4,
    justifyContent: 'center',
  },
  hudLabel: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  hudValue: {
    fontFamily: 'Archivo-Black',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  hudRightTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  hudPingValue: {
    fontFamily: 'Archivo-Black',
    fontSize: 14,
    fontWeight: '900',
  },
  pingProgressBarTrack: {
    height: 4,
    borderRadius: 2,
    marginVertical: 4,
    overflow: 'hidden',
  },
  pingProgressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  hudSubtext: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    fontWeight: '500',
  },
  mapModeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    marginTop: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 6,
  },
  mapModeBadgeText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  touchContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  touchLeft: {
    flex: 1,
    height: '100%',
  },
  touchRight: {
    flex: 1,
    height: '100%',
  },
  bottomCard: {
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 22,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 12,
  },
  categoryTag: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  cardTitle: {
    fontFamily: 'Archivo-Black',
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 32,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  cardSubtitle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
  continuePrompt: {
    marginTop: 14,
    paddingVertical: 4,
  },
  continuePromptText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 13,
    fontWeight: '600',
  },
  actionSection: {
    marginTop: 18,
  },
  primaryButton: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  primaryButtonText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  secondaryButtonText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  bottomLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    gap: 8,
  },
  subLinkText: {
    fontFamily: 'SegoeUI-SemiBold',
    fontSize: 14,
    fontWeight: '600',
  },
  dotSeparator: {
    fontSize: 14,
    fontWeight: '700',
  },
  finePrint: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
});

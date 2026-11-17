import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  RefreshControl,
  ScrollView,
  ScrollViewProps,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { triggerHaptic } from '../motion/haptics';
import { Text } from '../ui/Text';

const GHOST_PEEK_DARK = require('../../assets/ghost-peek-dark.png');
const GHOST_PEEK_LIGHT = require('../../assets/ghost-peek-light.png');

const BASE_THRESHOLD = 76;
const BASE_RESTING = 70;

function isLightColor(hex: string): boolean {
  if (!hex || typeof hex !== 'string') return false;
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 155;
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) return false;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 155;
}

export interface TacticalPullRefreshScrollViewProps extends ScrollViewProps {
  refreshing: boolean;
  onRefresh: () => void | Promise<void>;
  tintColor?: string;
  children?: React.ReactNode;
}

export const TacticalPullRefreshScrollView = forwardRef<
  React.ElementRef<typeof ScrollView>,
  TacticalPullRefreshScrollViewProps
>(function TacticalPullRefreshScrollView(
  {
    refreshing,
    onRefresh,
    tintColor,
    children,
    style,
    contentContainerStyle,
    onScroll,
    ...restProps
  },
  ref
) {
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets?.top || 0, 24);
  const restingHeight = topInset + 92;
  const thresholdHeight = topInset + 104;
  const maxPullHeight = topInset + 175;

  const { colors, isDark } = useTheme();
  const primaryColor = tintColor || colors.primary;
  const isLightAccent = isLightColor(primaryColor);
  const textColor = isLightAccent ? '#0A0A0E' : '#FFFFFF';

  const internalScrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  useImperativeHandle(ref, () => internalScrollRef.current as React.ElementRef<typeof ScrollView>);

  const scrollYRef = useRef(0);
  const isRefreshingRef = useRef(refreshing);
  isRefreshingRef.current = refreshing;

  const pullAnim = useRef(new Animated.Value(0)).current;
  const wobbleAnim = useRef(new Animated.Value(0)).current;
  const bobAnim = useRef(new Animated.Value(0)).current;
  const radarAnim = useRef(new Animated.Value(0)).current;

  const currentPullRef = useRef(0);
  const isDraggingPull = useRef(false);
  const hasTriggeredHaptic = useRef(false);
  const [pullState, setPullState] = useState<'idle' | 'pulling' | 'threshold' | 'refreshing'>('idle');

  // Looping playful animations while refreshing
  const startRefreshingAnimations = useCallback(() => {
    // Wobble loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(wobbleAnim, {
          toValue: 1,
          duration: 220,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(wobbleAnim, {
          toValue: -1,
          duration: 440,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(wobbleAnim, {
          toValue: 0,
          duration: 220,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    ).start();

    // Bob loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(bobAnim, {
          toValue: -5,
          duration: 280,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(bobAnim, {
          toValue: 0,
          duration: 280,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    ).start();

    // Radar scan wave loop
    Animated.loop(
      Animated.timing(radarAnim, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      })
    ).start();
  }, [wobbleAnim, bobAnim, radarAnim]);

  const stopRefreshingAnimations = useCallback(() => {
    wobbleAnim.stopAnimation();
    bobAnim.stopAnimation();
    radarAnim.stopAnimation();
    wobbleAnim.setValue(0);
    bobAnim.setValue(0);
    radarAnim.setValue(0);
  }, [wobbleAnim, bobAnim, radarAnim]);

  // Synchronize with external refreshing prop
  useEffect(() => {
    if (refreshing) {
      setPullState('refreshing');
      Animated.spring(pullAnim, {
        toValue: restingHeight,
        useNativeDriver: false,
        friction: 7,
        tension: 40,
      }).start();
      startRefreshingAnimations();
    } else {
      stopRefreshingAnimations();
      setPullState('idle');
      hasTriggeredHaptic.current = false;
      currentPullRef.current = 0;
      isDraggingPull.current = false;
      Animated.spring(pullAnim, {
        toValue: 0,
        useNativeDriver: false,
        friction: 8,
        tension: 50,
      }).start();
    }
  }, [refreshing, pullAnim, restingHeight, startRefreshingAnimations, stopRefreshingAnimations]);

  // Robust PanResponder that captures pull gesture at scrollY <= 2
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (isRefreshingRef.current) return false;
        if (scrollYRef.current > 2) return false;
        return gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.1;
      },
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        if (isRefreshingRef.current) return false;
        if (scrollYRef.current > 2) return false;
        return gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.1;
      },
      onPanResponderGrant: () => {
        isDraggingPull.current = true;
        hasTriggeredHaptic.current = false;
        setPullState('pulling');
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy <= 0) {
          pullAnim.setValue(0);
          currentPullRef.current = 0;
          setPullState('idle');
          return;
        }
        const dy = Math.max(0, gestureState.dy);
        const pull = Math.min(maxPullHeight, Math.pow(dy, 0.82) * 2.2);
        currentPullRef.current = pull;
        pullAnim.setValue(pull);

        if (pull >= thresholdHeight) {
          setPullState('threshold');
          if (!hasTriggeredHaptic.current) {
            hasTriggeredHaptic.current = true;
            triggerHaptic('buttonTap');
          }
        } else {
          setPullState('pulling');
          if (hasTriggeredHaptic.current) {
            hasTriggeredHaptic.current = false;
          }
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        isDraggingPull.current = false;
        const dy = Math.max(0, gestureState.dy);
        const pull = Math.min(maxPullHeight, Math.pow(dy, 0.82) * 2.2);

        if (pull >= thresholdHeight && !isRefreshingRef.current) {
          setPullState('refreshing');
          triggerHaptic('tagConfirmed');
          Animated.spring(pullAnim, {
            toValue: restingHeight,
            useNativeDriver: false,
            friction: 7,
            tension: 40,
          }).start();
          startRefreshingAnimations();
          void onRefresh();
        } else {
          setPullState('idle');
          currentPullRef.current = 0;
          Animated.spring(pullAnim, {
            toValue: 0,
            useNativeDriver: false,
            friction: 8,
            tension: 50,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        isDraggingPull.current = false;
        if (isRefreshingRef.current) return;
        setPullState('idle');
        currentPullRef.current = 0;
        Animated.spring(pullAnim, {
          toValue: 0,
          useNativeDriver: false,
          friction: 8,
          tension: 50,
        }).start();
      },
    })
  ).current;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y;
    onScroll?.(e);
  };

  // Interpolations
  const mascotTranslateY = pullAnim.interpolate({
    inputRange: [0, 40, thresholdHeight],
    outputRange: [24, 12, 0],
    extrapolate: 'clamp',
  });

  const mascotScale = pullAnim.interpolate({
    inputRange: [0, 40, thresholdHeight, maxPullHeight],
    outputRange: [0.7, 0.85, 1.0, 1.08],
    extrapolate: 'clamp',
  });

  const mascotOpacity = pullAnim.interpolate({
    inputRange: [0, 15, 45],
    outputRange: [0, 0.5, 1],
    extrapolate: 'clamp',
  });

  const wobbleRotation = wobbleAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-4deg', '0deg', '4deg'],
  });

  const radarScale = radarAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 2.2],
  });

  const radarOpacity = radarAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.45, 0.25, 0],
  });

  const isPullActive = pullState !== 'idle';

  return (
    <View style={[styles.rootContainer, style]} {...panResponder.panHandlers}>
      {/* Snapchat-Style Pull Down Curtain */}
      <Animated.View
        style={[
          styles.curtainContainer,
          {
            height: pullAnim,
            backgroundColor: primaryColor,
            borderBottomColor: isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.15)',
          },
        ]}
      >
        {/* Pulsing radar waves behind the mascot during refresh */}
        {pullState === 'refreshing' && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.radarRing,
              {
                borderColor: isLightAccent ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.45)',
                transform: [{ scale: radarScale }],
                opacity: radarOpacity,
              },
            ]}
          />
        )}

        {/* Tactical Status Tag */}
        <Animated.View
          style={[
            styles.statusBadge,
            {
              top: topInset + 4,
              opacity: mascotOpacity,
            },
          ]}
        >
          <Text style={[styles.statusText, { color: textColor }]}>
            {pullState === 'threshold'
              ? 'RELEASE TO SCAN'
              : pullState === 'refreshing'
              ? 'SCANNING HUD...'
              : 'PULL TO SYNC'}
          </Text>
        </Animated.View>

        {/* Ghost Mascot Peeking over the divider ledge */}
        <Animated.View
          style={[
            styles.mascotAnchor,
            {
              opacity: mascotOpacity,
              transform: [
                { translateY: Animated.add(mascotTranslateY, bobAnim) },
                { scale: mascotScale },
                { rotate: wobbleRotation },
              ],
            },
          ]}
        >
          <Image
            source={isDark ? GHOST_PEEK_DARK : GHOST_PEEK_LIGHT}
            style={styles.mascotImage}
            resizeMode="contain"
            accessibilityLabel="GhostRun Mascot"
          />
        </Animated.View>
      </Animated.View>

      {/* Main Screen Content ScrollView */}
      <ScrollView
        ref={internalScrollRef}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        overScrollMode="never"
        bounces={false}
        scrollEnabled={!isPullActive}
        contentContainerStyle={contentContainerStyle}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['transparent']}
            tintColor="transparent"
            progressBackgroundColor="transparent"
            progressViewOffset={-1000}
          />
        }
        {...restProps}
      >
        {children}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  curtainContainer: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderBottomWidth: 2,
  },
  statusBadge: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  statusText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  mascotAnchor: {
    width: 98,
    height: 66,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: -1, // Sits precisely flush with the bottom ledge line
  },
  mascotImage: {
    width: 98,
    height: 66,
  },
  radarRing: {
    position: 'absolute',
    bottom: 12,
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    alignSelf: 'center',
  },
});

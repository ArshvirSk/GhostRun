import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  ScrollView,
  ScrollViewProps,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { triggerHaptic } from '../motion/haptics';

const GHOST_PEEK_DARK = require('../../assets/ghost-peek-dark.png');
const GHOST_PEEK_LIGHT = require('../../assets/ghost-peek-light.png');

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
  const restingHeight = topInset + 72;
  const thresholdHeight = topInset + 88;
  const maxPullHeight = topInset + 160;

  const { colors, isDark } = useTheme();
  const primaryColor = tintColor || colors.primary;

  const internalScrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  useImperativeHandle(ref, () => internalScrollRef.current as React.ElementRef<typeof ScrollView>);

  const scrollYRef = useRef(0);
  const isRefreshingRef = useRef(false);

  const pullAnim = useRef(new Animated.Value(0)).current;
  const currentPullRef = useRef(0);
  const isDraggingPull = useRef(false);
  const hasTriggeredHaptic = useRef(false);
  const pullPhaseRef = useRef<'idle' | 'pulling' | 'threshold' | 'refreshing'>('idle');

  // Single guarded refresh trigger — prevents double-reboot
  const executeRefresh = async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    pullPhaseRef.current = 'refreshing';

    // Hold at resting height while async onRefresh runs
    Animated.spring(pullAnim, {
      toValue: restingHeight,
      useNativeDriver: false,
      friction: 8,
      tension: 40,
    }).start();

    try {
      await Promise.all([
        Promise.resolve(onRefresh()),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
    } finally {
      isRefreshingRef.current = false;
      currentPullRef.current = 0;
      pullPhaseRef.current = 'idle';
      Animated.spring(pullAnim, {
        toValue: 0,
        useNativeDriver: false,
        friction: 9,
        tension: 50,
      }).start();
    }
  };

  // PanResponder strictly for deliberate vertical downward pull at scrollY <= 0
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,

      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (isRefreshingRef.current) return false;
        if (scrollYRef.current > 1) return false;
        return (
          gestureState.dy > 12 &&
          gestureState.dy > Math.abs(gestureState.dx) * 1.8
        );
      },

      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        if (isRefreshingRef.current) return false;
        if (scrollYRef.current > 1) return false;
        return (
          gestureState.dy > 12 &&
          gestureState.dy > Math.abs(gestureState.dx) * 1.8
        );
      },

      onPanResponderGrant: () => {
        isDraggingPull.current = true;
        hasTriggeredHaptic.current = false;
        pullPhaseRef.current = 'pulling';
      },

      onPanResponderTerminationRequest: () => !isDraggingPull.current,

      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy <= 0) {
          pullAnim.setValue(0);
          currentPullRef.current = 0;
          pullPhaseRef.current = 'idle';
          return;
        }

        const dy = Math.max(0, gestureState.dy);
        // Elastic rubber-band resistance curve
        const pull = Math.min(maxPullHeight, Math.pow(dy, 0.82) * 2.0);
        currentPullRef.current = pull;
        pullAnim.setValue(pull);

        if (pull >= thresholdHeight) {
          pullPhaseRef.current = 'threshold';
          if (!hasTriggeredHaptic.current) {
            hasTriggeredHaptic.current = true;
            triggerHaptic('buttonTap');
          }
        } else {
          pullPhaseRef.current = 'pulling';
          if (hasTriggeredHaptic.current) {
            hasTriggeredHaptic.current = false;
          }
        }
      },

      onPanResponderRelease: () => {
        isDraggingPull.current = false;
        const finalPull = currentPullRef.current;

        if (finalPull >= thresholdHeight && !isRefreshingRef.current) {
          triggerHaptic('tagConfirmed');
          void executeRefresh();
        } else if (!isRefreshingRef.current) {
          pullPhaseRef.current = 'idle';
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
        if (!isRefreshingRef.current) {
          pullPhaseRef.current = 'idle';
          currentPullRef.current = 0;
          Animated.spring(pullAnim, {
            toValue: 0,
            useNativeDriver: false,
            friction: 8,
            tension: 50,
          }).start();
        }
      },
    })
  ).current;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y;
    onScroll?.(e);
  };

  return (
    <View style={[styles.rootContainer, style]} {...panResponder.panHandlers}>
      {/* Snapchat-Style Pull Down Curtain — strictly NO border, zero thin line at rest */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.curtainContainer,
          {
            height: pullAnim,
            backgroundColor: primaryColor,
          },
        ]}
      >
        {/* Ghost Mascot stuck directly to the bottom ledge of the pulled curtain */}
        <View style={styles.mascotAnchor}>
          <Image
            source={isDark ? GHOST_PEEK_DARK : GHOST_PEEK_LIGHT}
            style={styles.mascotImage}
            resizeMode="contain"
            accessibilityLabel="GhostRun Mascot"
          />
        </View>
      </Animated.View>

      {/* Main Screen Content ScrollView */}
      <ScrollView
        ref={internalScrollRef}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        overScrollMode="never"
        bounces={false}
        nestedScrollEnabled={true}
        contentContainerStyle={contentContainerStyle}
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
    borderBottomWidth: 0, // NO border line — zero thin line when closed
  },
  mascotAnchor: {
    width: 96,
    height: 65,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: -1, // Sits precisely flush with the bottom ledge of the pulled curtain
  },
  mascotImage: {
    width: 96,
    height: 65,
  },
});
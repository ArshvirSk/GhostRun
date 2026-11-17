import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  Animated,
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

  // Synchronize curtain animation with external refreshing prop
  useEffect(() => {
    if (refreshing) {
      Animated.spring(pullAnim, {
        toValue: restingHeight,
        useNativeDriver: false,
        friction: 8,
        tension: 40,
      }).start();
    } else {
      currentPullRef.current = 0;
      isDraggingPull.current = false;
      hasTriggeredHaptic.current = false;
      Animated.spring(pullAnim, {
        toValue: 0,
        useNativeDriver: false,
        friction: 9,
        tension: 50,
      }).start();
    }
  }, [refreshing, restingHeight, pullAnim]);

  // Single guarded refresh trigger — prevents duplicate syncs and 2-time reboots
  const executeRefresh = async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    try {
      await Promise.resolve(onRefresh());
    } finally {
      isRefreshingRef.current = false;
    }
  };

  // PanResponder to track finger pull in real-time
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,

      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (refreshing || isRefreshingRef.current) return false;
        if (scrollYRef.current > 2) return false;
        return (
          gestureState.dy > 3 &&
          gestureState.dy > Math.abs(gestureState.dx) * 1.1
        );
      },

      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        if (refreshing || isRefreshingRef.current) return false;
        if (scrollYRef.current > 2) return false;
        return (
          gestureState.dy > 3 &&
          gestureState.dy > Math.abs(gestureState.dx) * 1.1
        );
      },

      onPanResponderGrant: () => {
        isDraggingPull.current = true;
        hasTriggeredHaptic.current = false;
      },

      onPanResponderTerminationRequest: () => false,

      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy <= 0) {
          pullAnim.setValue(0);
          currentPullRef.current = 0;
          return;
        }

        const dy = Math.max(0, gestureState.dy);
        const pull = Math.min(maxPullHeight, Math.pow(dy, 0.82) * 2.0);
        currentPullRef.current = pull;
        pullAnim.setValue(pull);

        if (pull >= thresholdHeight) {
          if (!hasTriggeredHaptic.current) {
            hasTriggeredHaptic.current = true;
            triggerHaptic('buttonTap');
          }
        } else {
          if (hasTriggeredHaptic.current) {
            hasTriggeredHaptic.current = false;
          }
        }
      },

      onPanResponderRelease: () => {
        isDraggingPull.current = false;
        const finalPull = currentPullRef.current;

        if (finalPull >= thresholdHeight) {
          triggerHaptic('tagConfirmed');
          void executeRefresh();
        } else {
          currentPullRef.current = 0;
          hasTriggeredHaptic.current = false;
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
        currentPullRef.current = 0;
        hasTriggeredHaptic.current = false;
        if (!refreshing) {
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void executeRefresh();
            }}
            colors={['transparent']}
            tintColor="transparent"
            progressBackgroundColor="transparent"
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
    borderBottomWidth: 0, // Zero thin line when closed
  },
  mascotAnchor: {
    width: 96,
    height: 65,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: -1, // Pinned flush to the bottom ledge divider of the pulled curtain
  },
  mascotImage: {
    width: 96,
    height: 65,
  },
});

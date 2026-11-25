import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
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
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

const GHOST_PEEK_DARK = require('../../assets/ghost-peek-dark.png');
const GHOST_PEEK_LIGHT = require('../../assets/ghost-peek-light.png');

export interface TacticalPullRefreshScrollViewProps extends ScrollViewProps {
  refreshing: boolean;
  onRefresh: () => void | Promise<void>;
  tintColor?: string;
  children?: React.ReactNode;
}

type RefreshStatus = 'idle' | 'pulling' | 'refreshing' | 'closing';

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
  const { height: windowHeight } = useWindowDimensions();

  const topInset = Math.max(insets?.top || 0, 24);
  const restingHeight = topInset + 68;
  const thresholdHeight = topInset + 92;
  // Extended pull range: allows deep pull-down just like Snapchat (up to 380dp)
  const maxPullHeight = Math.min((windowHeight || 800) * 0.48, 380);

  const { colors, isDark } = useTheme();
  const primaryColor = tintColor || colors.primary;

  const internalScrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  useImperativeHandle(ref, () => internalScrollRef.current as React.ElementRef<typeof ScrollView>);

  const scrollYRef = useRef(0);
  const refreshStatusRef = useRef<RefreshStatus>('idle');
  const lastRefreshEndTimeRef = useRef(0);
  const pullAnim = useRef(new Animated.Value(0)).current;
  const currentPullRef = useRef(0);
  const hasTriggeredHaptic = useRef(false);

  // Progressive elastic response curve — direct tactile feel that tracks finger movement
  const calculatePull = (dy: number) => {
    if (dy <= 0) return 0;
    if (dy <= thresholdHeight) {
      return dy * 0.95; // direct 1:1 finger tracking
    }
    // Smooth progressive resistance past threshold all the way down
    const extra = dy - thresholdHeight;
    const stretch = Math.pow(extra, 0.76) * 1.85;
    return Math.min(maxPullHeight, thresholdHeight * 0.95 + stretch);
  };

  // Guarded refresh executor — guaranteed single execution with smooth hold and clean spring-shut
  const executeRefresh = async () => {
    if (refreshStatusRef.current === 'refreshing' || refreshStatusRef.current === 'closing') {
      return;
    }
    refreshStatusRef.current = 'refreshing';

    // Smoothly snap to resting height while data syncs (natural bounce is fine here)
    Animated.spring(pullAnim, {
      toValue: restingHeight,
      useNativeDriver: false,
      friction: 8,
      tension: 44,
    }).start();

    try {
      await Promise.all([
        Promise.resolve(onRefresh?.()),
        new Promise((resolve) => setTimeout(resolve, 550)),
      ]);
    } catch {
      // Graceful fallback on network glitch
    } finally {
      refreshStatusRef.current = 'closing';
      Animated.spring(pullAnim, {
        toValue: 0,
        useNativeDriver: false,
        friction: 9,
        tension: 52,
        overshootClamping: true, // never cross 0, so the curtain can't bounce back open
      }).start(() => {
        pullAnim.setValue(0); // guarantee a clean final state
        refreshStatusRef.current = 'idle';
        currentPullRef.current = 0;
        hasTriggeredHaptic.current = false;
        lastRefreshEndTimeRef.current = Date.now();
      });
    }
  };

  // Responsive gesture disambiguation:
  // 1. Must be idle and past 500ms post-refresh lockout (completely blocks momentum flings from re-opening)
  // 2. Must be at top of list (scrollY <= 1)
  // 3. dy > 6: fires just before Android ScrollView's ~8dp touchSlop locks the gesture
  // 4. dy > |dx| * 1.8: strict vertical cone (~29 deg) so horizontal/diagonal screen swipes pass to PagerView
  const shouldStartPull = (gestureState: { dx: number; dy: number }) => {
    if (refreshStatusRef.current !== 'idle') return false;
    if (Date.now() - lastRefreshEndTimeRef.current < 500) return false;
    if (scrollYRef.current > 1) return false;
    return (
      gestureState.dy > 6 &&
      gestureState.dy > Math.abs(gestureState.dx) * 1.8
    );
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,

      onMoveShouldSetPanResponder: (_, gestureState) => shouldStartPull(gestureState),
      onMoveShouldSetPanResponderCapture: (_, gestureState) => shouldStartPull(gestureState),

      onPanResponderGrant: () => {
        refreshStatusRef.current = 'pulling';
        currentPullRef.current = 0;
        hasTriggeredHaptic.current = false;
      },

      onPanResponderTerminationRequest: () => {
        return refreshStatusRef.current !== 'pulling';
      },

      onPanResponderMove: (_, gestureState) => {
        if (refreshStatusRef.current !== 'pulling') return;

        if (gestureState.dy <= 0) {
          pullAnim.setValue(0);
          currentPullRef.current = 0;
          return;
        }

        const pull = calculatePull(gestureState.dy);
        currentPullRef.current = pull;
        pullAnim.setValue(pull);

        if (pull >= thresholdHeight) {
          if (!hasTriggeredHaptic.current) {
            hasTriggeredHaptic.current = true;
            // triggerHaptic('buttonTap'); // <-- this fires when you cross the threshold
          }
        } else {
          if (hasTriggeredHaptic.current) {
            hasTriggeredHaptic.current = false;
          }
        }
      },

      onPanResponderRelease: () => {
        if (refreshStatusRef.current !== 'pulling') return;

        const finalPull = currentPullRef.current;
        if (finalPull >= thresholdHeight) {
          // triggerHaptic('tagConfirmed');
          void executeRefresh();
        } else {
          // User let go before threshold — snap back smoothly like Snapchat
          refreshStatusRef.current = 'closing';
          Animated.spring(pullAnim, {
            toValue: 0,
            useNativeDriver: false,
            friction: 8,
            tension: 50,
            overshootClamping: true,
          }).start(() => {
            pullAnim.setValue(0);
            refreshStatusRef.current = 'idle';
            currentPullRef.current = 0;
            hasTriggeredHaptic.current = false;
            lastRefreshEndTimeRef.current = Date.now();
          });
        }
      },

      onPanResponderTerminate: () => {
        if (refreshStatusRef.current === 'pulling') {
          refreshStatusRef.current = 'closing';
          Animated.spring(pullAnim, {
            toValue: 0,
            useNativeDriver: false,
            friction: 8,
            tension: 50,
            overshootClamping: true,
          }).start(() => {
            pullAnim.setValue(0);
            refreshStatusRef.current = 'idle';
            currentPullRef.current = 0;
            hasTriggeredHaptic.current = false;
            lastRefreshEndTimeRef.current = Date.now();
          });
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
      {/* Snapchat-Style Pull Down Curtain — strictly NO border line at rest */}
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

      {/* Main Screen Content ScrollView — strictly NO native RefreshControl spinner circle */}
      <ScrollView
        ref={internalScrollRef}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        overScrollMode="never"
        bounces={false}
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
    marginBottom: -6, // Sits precisely flush with the bottom ledge of the pulled curtain, zero green gap
  },
  mascotImage: {
    width: 96,
    height: 65,
  },
});
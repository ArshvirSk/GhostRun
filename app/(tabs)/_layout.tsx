import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  useWindowDimensions,
  BackHandler,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ScrollView,
} from 'react-native';
import { Slot, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme/ThemeProvider';
import { triggerHaptic } from '../../src/motion/haptics';

import { PlayContent } from './play';
import { ModesContent } from './modes';
import { YouContent } from './you';

function YouTabIcon({ focused }: { color: string; focused: boolean }) {
  const { colors, isDark } = useTheme();
  const [initial, setInitial] = useState('A');

  useEffect(() => {
    AsyncStorage.getItem('@ghostrun:profile').then((val) => {
      if (val) {
        try {
          const parsed = JSON.parse(val);
          if (parsed.display_name) {
            setInitial(parsed.display_name.trim().charAt(0).toUpperCase() || 'A');
          }
        } catch {
          // ignore
        }
      }
    });
  }, []);

  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: focused
          ? colors.primary
          : isDark
          ? colors.surfaceMuted
          : colors.borderDark,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: 'Archivo-Black',
          fontSize: 11,
          fontWeight: '900',
          color: focused ? colors.primaryText : isDark ? colors.textMuted : '#FFFFFF',
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

function TabIconWrapper({
  children,
}: {
  focused: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        width: 50,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}

/**
 * Maps the active route name or pathname to its exact visual slot index:
 * 0 -> Play (left)
 * 1 -> Modes (center)
 * 2 -> You (right)
 */
function getVisualTabIndex(pathname: string): number {
  if (pathname.includes('/modes') || pathname.includes('modes')) return 1;
  if (pathname.includes('/you') || pathname.includes('you')) return 2;
  return 0;
}

export default function TabsLayout() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();

  const [activeTabIndex, setActiveTabIndex] = useState(() => getVisualTabIndex(pathname));
  const activeTabIndexRef = useRef(activeTabIndex);
  const isDraggingRef = useRef(false);

  const pagerRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  // Geometry calculations for floating bottom bar and sliding pill
  const paddingH = 16;
  const navbarMarginH = 24;
  const usableWidth = Math.max(0, screenWidth - navbarMarginH * 2 - paddingH * 2);
  const tabWidth = usableWidth > 0 ? usableWidth / 3 : 0;
  const pillWidth = 56;
  const pillOffset = (tabWidth - pillWidth) / 2;

  const x0 = paddingH + pillOffset;
  const x1 = paddingH + tabWidth + pillOffset;
  const x2 = paddingH + 2 * tabWidth + pillOffset;

  const pillTranslateX = scrollX.interpolate({
    inputRange: [0, screenWidth || 1, 2 * (screenWidth || 1)],
    outputRange: [x0, x1, x2],
    extrapolate: 'clamp',
  });

  // Keep activeTabIndex in sync when pathname changes externally
  useEffect(() => {
    const targetIndex = getVisualTabIndex(pathname);
    if (targetIndex !== activeTabIndexRef.current && !isDraggingRef.current) {
      activeTabIndexRef.current = targetIndex;
      setActiveTabIndex(targetIndex);
      if (screenWidth > 0) {
        pagerRef.current?.scrollTo({ x: targetIndex * screenWidth, animated: true });
      }
    }
  }, [pathname, screenWidth]);

  // Initial scroll to match current pathname on mount
  const [initialOffsetSet, setInitialOffsetSet] = useState(false);
  useEffect(() => {
    if (!initialOffsetSet && screenWidth > 0) {
      const initialIdx = getVisualTabIndex(pathname);
      if (initialIdx > 0) {
        pagerRef.current?.scrollTo({ x: initialIdx * screenWidth, animated: false });
        scrollX.setValue(initialIdx * screenWidth);
      }
      setInitialOffsetSet(true);
    }
  }, [screenWidth, initialOffsetSet, pathname, scrollX]);

  // Handle Tab Press from Bottom Navbar
  const handleTabPress = useCallback(
    (index: number) => {
      triggerHaptic('buttonTap');
      activeTabIndexRef.current = index;
      setActiveTabIndex(index);
      if (screenWidth > 0) {
        pagerRef.current?.scrollTo({ x: index * screenWidth, animated: true });
      }
      const targetPath = index === 0 ? '/play' : index === 1 ? '/modes' : '/you';
      if (pathname !== targetPath) {
        router.navigate(targetPath as any);
      }
    },
    [screenWidth, pathname, router]
  );

  // Android Hardware Back Button: navigate back to Play if on Modes or You
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (activeTabIndexRef.current > 0) {
        handleTabPress(0);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [handleTabPress]);

  // Handle real-time finger drag across the screen
  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    {
      useNativeDriver: false,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (screenWidth > 0) {
          const x = e.nativeEvent.contentOffset.x;
          const currentIdx = Math.min(2, Math.max(0, Math.round(x / screenWidth)));
          if (currentIdx !== activeTabIndexRef.current) {
            activeTabIndexRef.current = currentIdx;
            setActiveTabIndex(currentIdx);
          }
        }
      },
    }
  );

  const handleMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    isDraggingRef.current = false;
    if (screenWidth > 0) {
      const x = e.nativeEvent.contentOffset.x;
      const newIndex = Math.min(2, Math.max(0, Math.round(x / screenWidth)));
      if (newIndex !== activeTabIndexRef.current) {
        triggerHaptic('buttonTap');
        activeTabIndexRef.current = newIndex;
        setActiveTabIndex(newIndex);
      }
      const targetPath = newIndex === 0 ? '/play' : newIndex === 1 ? '/modes' : '/you';
      if (pathname !== targetPath) {
        router.navigate(targetPath as any);
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Master Stitched Horizontal Pager: Play <-> Modes <-> You edge-to-edge */}
      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        onScrollBeginDrag={() => {
          isDraggingRef.current = true;
        }}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        style={{ flex: 1 }}
      >
        {/* Page 0: Play */}
        <View style={{ width: screenWidth, flex: 1 }}>
          <PlayContent />
        </View>

        {/* Page 1: Modes & Mutators */}
        <View style={{ width: screenWidth, flex: 1 }}>
          <ModesContent />
        </View>

        {/* Page 2: You Profile */}
        <View style={{ width: screenWidth, flex: 1 }}>
          <YouContent />
        </View>
      </Animated.ScrollView>

      {/* Floating Tactical Bottom Navbar with Real-Time Sliding Pill */}
      <View
        style={[
          styles.navbarContainer,
          {
            backgroundColor: isDark ? colors.surfaceElevated : '#FFFFFF',
            borderColor: isDark ? colors.border : 'rgba(0, 0, 0, 0.12)',
            bottom: Math.max(insets.bottom, 16) + 10,
          },
        ]}
      >
        {/* Animated Accent Slider Pill */}
        {tabWidth > 0 && (
          <Animated.View
            style={[
              styles.sliderPill,
              {
                width: pillWidth,
                backgroundColor: colors.primaryLight,
                transform: [{ translateX: pillTranslateX }],
              },
            ]}
          />
        )}

        {/* Tab 0: Play */}
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTabIndex === 0 }}
          accessibilityLabel="Play"
          onPress={() => handleTabPress(0)}
          android_ripple={{ color: 'transparent' }}
          style={[styles.tabButton, { width: tabWidth }]}
        >
          <TabIconWrapper focused={activeTabIndex === 0}>
            <Ionicons
              name={activeTabIndex === 0 ? 'map' : 'map-outline'}
              size={19}
              color={activeTabIndex === 0 ? colors.primary : colors.textMuted}
            />
          </TabIconWrapper>
          <Text
            style={[
              styles.tabLabel,
              { color: activeTabIndex === 0 ? colors.primary : colors.textMuted },
            ]}
          >
            Play
          </Text>
        </Pressable>

        {/* Tab 1: Modes */}
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTabIndex === 1 }}
          accessibilityLabel="Modes"
          onPress={() => handleTabPress(1)}
          android_ripple={{ color: 'transparent' }}
          style={[styles.tabButton, { width: tabWidth }]}
        >
          <TabIconWrapper focused={activeTabIndex === 1}>
            <Ionicons
              name={activeTabIndex === 1 ? 'trophy' : 'trophy-outline'}
              size={19}
              color={activeTabIndex === 1 ? colors.primary : colors.textMuted}
            />
          </TabIconWrapper>
          <Text
            style={[
              styles.tabLabel,
              { color: activeTabIndex === 1 ? colors.primary : colors.textMuted },
            ]}
          >
            Modes
          </Text>
        </Pressable>

        {/* Tab 2: You */}
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTabIndex === 2 }}
          accessibilityLabel="You"
          onPress={() => handleTabPress(2)}
          android_ripple={{ color: 'transparent' }}
          style={[styles.tabButton, { width: tabWidth }]}
        >
          <TabIconWrapper focused={activeTabIndex === 2}>
            <YouTabIcon
              color={activeTabIndex === 2 ? colors.primary : colors.textMuted}
              focused={activeTabIndex === 2}
            />
          </TabIconWrapper>
          <Text
            style={[
              styles.tabLabel,
              { color: activeTabIndex === 2 ? colors.primary : colors.textMuted },
            ]}
          >
            You
          </Text>
        </Pressable>
      </View>

      {/* Hidden Slot satisfying Expo Router route hierarchy */}
      <View style={styles.hiddenSlot} pointerEvents="none">
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  navbarContainer: {
    position: 'absolute',
    left: 24,
    right: 24,
    height: 66,
    borderRadius: 36,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    zIndex: 100,
  },
  sliderPill: {
    position: 'absolute',
    top: 7,
    height: 32,
    left: 0,
    borderRadius: 16,
    zIndex: 1,
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    zIndex: 2,
  },
  tabLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  hiddenSlot: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
    overflow: 'hidden',
  },
});

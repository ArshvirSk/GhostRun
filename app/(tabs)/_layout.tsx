import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme/ThemeProvider';
import { triggerHaptic } from '../../src/motion/haptics';

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

function SlidingTabBarBackground({ activeIndex }: { activeIndex: number }) {
  const { colors } = useTheme();
  const [containerWidth, setContainerWidth] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // tabBarStyle paddingHorizontal is 16 on left and right
  const paddingH = 16;
  const usableWidth = containerWidth > paddingH * 2 ? containerWidth - paddingH * 2 : 0;
  const tabWidth = usableWidth > 0 ? usableWidth / 3 : 0;
  const pillWidth = 56;

  useEffect(() => {
    if (tabWidth > 0) {
      const targetX = paddingH + activeIndex * tabWidth + (tabWidth - pillWidth) / 2;
      Animated.spring(slideAnim, {
        toValue: targetX,
        friction: 8,
        tension: 75,
        useNativeDriver: true,
      }).start();
    }
  }, [activeIndex, tabWidth, slideAnim]);

  return (
    <View
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      {tabWidth > 0 && (
        <Animated.View
          style={[
            styles.sliderPill,
            {
              width: pillWidth,
              backgroundColor: colors.primaryLight,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        />
      )}
    </View>
  );
}

export default function TabsLayout() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  const initialIndex = pathname.includes('modes') ? 1 : pathname.includes('you') ? 2 : 0;
  const [activeTabIndex, setActiveTabIndex] = useState(initialIndex);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Tabs
        screenListeners={{
          state: (e: any) => {
            const index = e?.data?.state?.index;
            if (typeof index === 'number') {
              setActiveTabIndex(index);
            }
          },
          tabPress: () => {
            triggerHaptic('buttonTap');
          },
        }}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarBackground: () => (
            <SlidingTabBarBackground activeIndex={activeTabIndex} />
          ),
          tabBarStyle: {
            backgroundColor: isDark ? colors.surfaceElevated : '#FFFFFF',
            borderColor: isDark ? colors.border : 'rgba(0, 0, 0, 0.12)',
            borderWidth: 1.5,
            height: 66,
            paddingBottom: 6,
            paddingTop: 6,
            paddingHorizontal: 16,
            position: 'absolute',
            bottom: Math.max(insets.bottom, 16) + 10,
            left: 24,
            right: 24,
            start: 24,
            end: 24,
            borderRadius: 36,
            elevation: 24,
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: isDark ? 0.65 : 0.2,
            shadowRadius: 20,
          },
          tabBarItemStyle: {
            alignItems: 'center',
            justifyContent: 'center',
          },
          tabBarLabelStyle: {
            fontFamily: 'Archivo-Bold',
            fontSize: 10,
            fontWeight: '800',
            letterSpacing: 0.5,
            marginTop: 2,
          },
        }}
      >
        <Tabs.Screen
          name="play"
          options={{
            title: 'Play',
            tabBarIcon: ({ color, focused }) => (
              <TabIconWrapper focused={focused}>
                <Ionicons
                  name={focused ? 'map' : 'map-outline'}
                  size={19}
                  color={color as string}
                />
              </TabIconWrapper>
            ),
          }}
        />
        <Tabs.Screen
          name="modes"
          options={{
            title: 'Modes',
            tabBarIcon: ({ color, focused }) => (
              <TabIconWrapper focused={focused}>
                <Ionicons
                  name={focused ? 'trophy' : 'trophy-outline'}
                  size={19}
                  color={color as string}
                />
              </TabIconWrapper>
            ),
          }}
        />
        <Tabs.Screen
          name="you"
          options={{
            title: 'You',
            tabBarIcon: ({ color, focused }) => (
              <TabIconWrapper focused={focused}>
                <YouTabIcon color={color as string} focused={focused} />
              </TabIconWrapper>
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  sliderPill: {
    position: 'absolute',
    top: 7,
    height: 32,
    left: 0,
    borderRadius: 16,
    zIndex: 1,
  },
});

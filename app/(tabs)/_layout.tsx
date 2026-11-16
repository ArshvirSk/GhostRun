import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { Tabs } from 'expo-router';
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

function SlidingTabBar({ state, descriptors, navigation }: any) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const routes = state.routes;
  const numTabs = routes.length;
  // Padding inside container is 8px left/right
  const tabWidth = barWidth > 16 && numTabs > 0 ? (barWidth - 16) / numTabs : 0;

  useEffect(() => {
    if (tabWidth > 0) {
      Animated.spring(slideAnim, {
        toValue: 8 + state.index * tabWidth + 2,
        friction: 8,
        tension: 75,
        useNativeDriver: true,
      }).start();
    }
  }, [state.index, tabWidth, slideAnim]);

  return (
    <View
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      style={[
        styles.tabBarContainer,
        {
          backgroundColor: isDark ? colors.surfaceElevated : '#FFFFFF',
          borderColor: isDark ? colors.border : 'rgba(0, 0, 0, 0.12)',
          bottom: Math.max(insets.bottom, 16) + 10,
          shadowOpacity: isDark ? 0.65 : 0.2,
        },
      ]}
    >
      {/* Sliding Active Indicator Pill */}
      {tabWidth > 0 && (
        <Animated.View
          style={[
            styles.sliderPill,
            {
              width: tabWidth - 4,
              backgroundColor: colors.primaryLight,
              borderColor: colors.primary,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        />
      )}

      {routes.map((route: any, index: number) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;

        const onPress = () => {
          triggerHaptic('buttonTap');
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const renderIcon = () => {
          const iconColor = isFocused ? colors.primary : colors.textMuted;
          if (route.name === 'play') {
            return (
              <Ionicons
                name={isFocused ? 'map' : 'map-outline'}
                size={19}
                color={iconColor}
              />
            );
          }
          if (route.name === 'modes') {
            return (
              <Ionicons
                name={isFocused ? 'trophy' : 'trophy-outline'}
                size={19}
                color={iconColor}
              />
            );
          }
          if (route.name === 'you') {
            return <YouTabIcon color={iconColor} focused={isFocused} />;
          }
          return null;
        };

        const label =
          options.tabBarLabel !== undefined
            ? options.tabBarLabel
            : options.title !== undefined
            ? options.title
            : route.name;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={options.tabBarTestID}
            onPress={onPress}
            style={styles.tabItem}
          >
            <View style={styles.iconWrap}>{renderIcon()}</View>
            <Text
              style={[
                styles.tabLabel,
                {
                  color: isFocused ? colors.primary : colors.textMuted,
                },
              ]}
            >
              {typeof label === 'string' ? label : route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Tabs
        tabBar={(props) => <SlidingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tabs.Screen
          name="play"
          options={{
            title: 'Play',
          }}
        />
        <Tabs.Screen
          name="modes"
          options={{
            title: 'Modes',
          }}
        />
        <Tabs.Screen
          name="you"
          options={{
            title: 'You',
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBarContainer: {
    position: 'absolute',
    left: 24,
    right: 24,
    height: 64,
    borderRadius: 34,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    elevation: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    zIndex: 100,
  },
  sliderPill: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    borderRadius: 26,
    borderWidth: 1,
    zIndex: 1,
  },
  tabItem: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 24,
  },
  tabLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 2,
  },
});

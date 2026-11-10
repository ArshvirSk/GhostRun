import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
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

function TabIconWrapper({
  focused,
  children,
}: {
  focused: boolean;
  children: React.ReactNode;
}) {
  const { isDark } = useTheme();
  return (
    <View
      style={{
        width: 50,
        height: 28,
        borderRadius: 14,
        backgroundColor: focused
          ? isDark
            ? 'rgba(199, 243, 107, 0.16)'
            : 'rgba(85, 122, 34, 0.14)'
          : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}

export default function TabsLayout() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenListeners={{
        tabPress: () => {
          triggerHaptic('buttonTap');
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: isDark ? '#1C1D24' : '#FFFFFF',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
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
          shadowOpacity: isDark ? 0.65 : 0.20,
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
  );
}

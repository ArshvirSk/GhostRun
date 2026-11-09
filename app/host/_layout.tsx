import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function HostLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="mode" />
      <Stack.Screen name="rules" />
      <Stack.Screen name="extras" />
      <Stack.Screen name="area" />
      <Stack.Screen name="review" />
    </Stack>
  );
}

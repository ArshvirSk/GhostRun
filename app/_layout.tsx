import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';

// Registers the background location task at startup, including a cold start
// performed by the OS while a round is live.
import '../src/lib/location';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootNavigator />
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { isDark } = useTheme();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="host" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="how-to-play" />
        <Stack.Screen name="safety" />
        <Stack.Screen name="modes/[id]" />
        <Stack.Screen name="debug/hud-gallery" />
        <Stack.Screen name="home" />
        <Stack.Screen name="create" />
        <Stack.Screen name="join" />
        <Stack.Screen name="lobby/[id]" />
        <Stack.Screen name="target/[id]" />
        <Stack.Screen name="game/[id]" />
        <Stack.Screen name="result/[id]" />
        <Stack.Screen name="replay/[id]" />
      </Stack>
    </>
  );
}

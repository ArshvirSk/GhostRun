import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// Registers the background location task at startup, including a cold start
// performed by the OS while a round is live.
import '../src/lib/location';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="home" />
        <Stack.Screen name="create" />
        <Stack.Screen name="join" />
        <Stack.Screen name="lobby/[id]" />
        <Stack.Screen name="target/[id]" />
        <Stack.Screen name="game/[id]" />
      </Stack>
    </>
  );
}

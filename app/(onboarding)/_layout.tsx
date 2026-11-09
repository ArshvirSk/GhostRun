import { Stack } from 'expo-router';
import { colors } from '../../src/theme/tokens';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'fade',
      }}
    >
      <Stack.Screen name="welcome" />
      <Stack.Screen name="signin" />
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="briefing" />
      <Stack.Screen name="signup/name" />
      <Stack.Screen name="signup/account" />
      <Stack.Screen name="signup/code" />
      <Stack.Screen name="signup/before-you-play" />
    </Stack>
  );
}

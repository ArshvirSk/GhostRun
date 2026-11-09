import { Redirect } from 'expo-router';

/**
 * Backward-compatibility redirect shim for `/onboarding`.
 * Routes legacy links and stored navigation states to `/welcome`.
 */
export default function OnboardingScreen() {
  return <Redirect href={'/welcome' as any} />;
}

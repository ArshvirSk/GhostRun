import { Redirect } from 'expo-router';

/**
 * Backward-compatibility redirect shim for `/onboarding`.
 * Routes legacy links and stored navigation states to `/briefing`.
 */
export default function OnboardingScreen() {
  return <Redirect href={'/briefing' as any} />;
}

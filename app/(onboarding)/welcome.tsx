import { Redirect } from 'expo-router';

/**
 * Backward-compatibility redirect shim for `/welcome`.
 * Routes directly to the onboarding briefing tour.
 */
export default function WelcomeScreen() {
  return <Redirect href={'/briefing' as any} />;
}

import { Redirect } from 'expo-router';

/**
 * Backward-compatibility redirect shim for `/auth`.
 * Routes legacy links and stored navigation states to `/signin`.
 */
export default function AuthScreen() {
  return <Redirect href={'/signin' as any} />;
}

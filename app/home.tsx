import { Redirect } from 'expo-router';

/**
 * Backward-compatibility redirect shim for `/home`.
 * Routes legacy navigation states to the new Play tab (`/play`).
 */
export default function HomeScreen() {
  return <Redirect href={'/play' as any} />;
}

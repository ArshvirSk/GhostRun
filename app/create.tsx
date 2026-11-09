import { Redirect } from 'expo-router';

/**
 * Backward-compatibility redirect shim for `/create`.
 * Routes legacy links to Step 1 of the new Host Wizard (`/host/mode`).
 */
export default function CreateGameScreen() {
  return <Redirect href={'/host/mode' as any} />;
}

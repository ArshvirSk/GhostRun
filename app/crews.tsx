import { Redirect } from 'expo-router';

/**
 * Backward-compatibility redirect shim for `/crews`.
 * Routes legacy navigation states to the dedicated Squads screen (`/squads`).
 */
export default function CrewsShim() {
  return <Redirect href={'/squads' as any} />;
}

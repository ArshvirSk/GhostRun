import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Backward-compatibility redirect shim for `/target/[id]`.
 * Extraction target placement is folded into Step 4 of the Host Wizard
 * and can be edited directly on the lobby map.
 */
export default function TargetSelectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const gameId = Array.isArray(id) ? id[0] : id;

  return <Redirect href={{ pathname: '/lobby/[id]', params: { id: gameId } } as any} />;
}

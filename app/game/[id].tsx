import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { GameShell } from '../../src/game-shell/GameShell';

/**
 * GameScreen (/game/[id])
 *
 * Restructured in UI-M2: Delegates all in-game rendering, lifecycle,
 * location tracking, and role-based widget composition to GameShell.
 * Holds zero mode-specific logic.
 */
export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const gameId = Array.isArray(id) ? id[0] : id;

  if (!gameId) return null;

  return <GameShell gameId={gameId} />;
}

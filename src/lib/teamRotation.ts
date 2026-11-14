export interface PlayerAssignment {
  id: string;
  user_id: string;
  team: 'runner' | 'hunter';
}

/**
 * Calculates hunter quota with guard:
 * - At least 1 hunter
 * - Target: ~33% (1 in 3)
 * - Upper bound: hunters never outnumber runners (max floor((total - 1) / 2))
 */
export function computeHunterCount(totalPlayers: number): number {
  if (totalPlayers <= 2) return 1;
  const target = Math.max(1, Math.floor(totalPlayers / 3));
  const maxAllowed = Math.max(1, Math.floor((totalPlayers - 1) / 2));
  return Math.min(target, maxAllowed);
}

/**
 * Rotates roles systematically so previous hunters become runners,
 * and previous runners step into the hunter squad.
 */
export function rotatePlayerRoles(players: PlayerAssignment[]): PlayerAssignment[] {
  if (players.length < 2) return players.map((p) => ({ ...p }));

  const total = players.length;
  const targetHunters = computeHunterCount(total);

  const prevHunters = players.filter((p) => p.team === 'hunter');
  const prevRunners = players.filter((p) => p.team === 'runner');

  const result: PlayerAssignment[] = [];
  let hunterCount = 0;

  // 1. Promote previous runners to hunters first
  for (const runner of prevRunners) {
    if (hunterCount < targetHunters) {
      result.push({ ...runner, team: 'hunter' });
      hunterCount++;
    } else {
      result.push({ ...runner, team: 'runner' });
    }
  }

  // 2. Previous hunters become runners (unless quota unmet)
  for (const hunter of prevHunters) {
    if (hunterCount < targetHunters) {
      result.push({ ...hunter, team: 'hunter' });
      hunterCount++;
    } else {
      result.push({ ...hunter, team: 'runner' });
    }
  }

  return result;
}

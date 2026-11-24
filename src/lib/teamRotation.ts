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
 * Modes where team role rotation is applicable.
 * Excludes solo duel and free-for-all contract modes like ghost_duel and assassin_ring.
 */
export const NON_ROTATABLE_MODES = new Set(['ghost_duel', 'assassin_ring']);

export function isRoleRotationApplicable(modeId?: string | null): boolean {
  if (!modeId) return true;
  return !NON_ROTATABLE_MODES.has(modeId);
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

/**
 * Randomizes team assignments while strictly maintaining the hunter ratio guard.
 * Accepts an optional deterministic PRNG for test reproducibility.
 */
export function randomizeTeams(
  players: PlayerAssignment[],
  rng: () => number = Math.random
): PlayerAssignment[] {
  if (players.length === 0) return [];
  const targetHunters = computeHunterCount(players.length);

  // Fisher-Yates shuffle copy
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }

  const assigned = new Set<string>();
  for (let i = 0; i < targetHunters; i++) {
    assigned.add(shuffled[i].id);
  }

  return players.map((p) => ({
    ...p,
    team: assigned.has(p.id) ? 'hunter' : 'runner',
  }));
}

/**
 * Fair role rotation accounting for multi-round career hunter counts.
 * Prioritizes players with the fewest historical rounds as hunter.
 */
export function rotatePlayerRolesWithHistory(
  players: PlayerAssignment[],
  hunterCountHistory: Record<string, number> = {}
): PlayerAssignment[] {
  if (players.length < 2) return players.map((p) => ({ ...p }));

  const targetHunters = computeHunterCount(players.length);

  // Sort candidates:
  // 1. Current runners prioritized over current hunters
  // 2. Lowest historical hunter count first
  // 3. Stable ID tiebreak
  const candidates = [...players].sort((a, b) => {
    if (a.team !== b.team) {
      return a.team === 'runner' ? -1 : 1;
    }
    const countA = hunterCountHistory[a.user_id] ?? 0;
    const countB = hunterCountHistory[b.user_id] ?? 0;
    if (countA !== countB) {
      return countA - countB;
    }
    return a.id.localeCompare(b.id);
  });

  const nextHunterIds = new Set(candidates.slice(0, targetHunters).map((p) => p.id));

  return players.map((p) => ({
    ...p,
    team: nextHunterIds.has(p.id) ? 'hunter' : 'runner',
  }));
}

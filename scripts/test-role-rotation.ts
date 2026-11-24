import {
  computeHunterCount,
  rotatePlayerRoles,
  randomizeTeams,
  rotatePlayerRolesWithHistory,
  isRoleRotationApplicable,
  type PlayerAssignment,
} from '../src/lib/teamRotation';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`PASS: ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

console.log('--- NF-03 Rematch & Role Rotation Unit Tests ---');

// Test 1: Hunter ratio guard & bounds across player counts
assert(computeHunterCount(2) === 1, '2 players: exactly 1 hunter');
assert(computeHunterCount(3) === 1, '3 players: exactly 1 hunter');
assert(computeHunterCount(4) === 1, '4 players: exactly 1 hunter');
assert(computeHunterCount(5) === 1, '5 players: exactly 1 hunter');
assert(computeHunterCount(6) === 2, '6 players: exactly 2 hunters');
assert(computeHunterCount(7) === 2, '7 players: exactly 2 hunters');
assert(computeHunterCount(8) === 2, '8 players: exactly 2 hunters');
assert(computeHunterCount(9) === 3, '9 players: exactly 3 hunters');
assert(computeHunterCount(12) === 4, '12 players: exactly 4 hunters');
assert(computeHunterCount(15) === 5, '15 players: exactly 5 hunters');

// Ratio ceiling: Hunters must NEVER outnumber runners for any N >= 2 (1v1 has 1 hunter and 1 runner)
for (let n = 2; n <= 30; n++) {
  const hunters = computeHunterCount(n);
  const runners = n - hunters;
  const neverOutnumbers = n === 2 ? hunters <= runners : hunters < runners;
  assert(hunters >= 1 && neverOutnumbers, `N=${n}: hunters (${hunters}) <= runners (${runners}) strictly holds`);
}

// Test 2: 2-player swap invariance
const pair: PlayerAssignment[] = [
  { id: 'p1', user_id: 'u1', team: 'hunter' },
  { id: 'p2', user_id: 'u2', team: 'runner' },
];
const rotatedPair = rotatePlayerRoles(pair);
const newH = rotatedPair.find((p) => p.team === 'hunter');
const newR = rotatedPair.find((p) => p.team === 'runner');
assert(newH?.user_id === 'u2', '2-player swap: Previous runner becomes hunter');
assert(newR?.user_id === 'u1', '2-player swap: Previous hunter becomes runner');

// Test 3: 4-player rotation (1 hunter, 3 runners)
const squad4: PlayerAssignment[] = [
  { id: 'p1', user_id: 'u1', team: 'hunter' },
  { id: 'p2', user_id: 'u2', team: 'runner' },
  { id: 'p3', user_id: 'u3', team: 'runner' },
  { id: 'p4', user_id: 'u4', team: 'runner' },
];
const rotated4 = rotatePlayerRoles(squad4);
assert(rotated4.filter((p) => p.team === 'hunter').length === 1, '4 players has exactly 1 hunter');
assert(rotated4.find((p) => p.user_id === 'u1')?.team === 'runner', 'Previous hunter u1 became runner');
assert(rotated4.find((p) => p.user_id === 'u2')?.team === 'hunter', 'Previous runner u2 promoted to hunter');

// Test 4: 6-player rotation (2 hunters, 4 runners)
const squad6: PlayerAssignment[] = [
  { id: 'p1', user_id: 'u1', team: 'hunter' },
  { id: 'p2', user_id: 'u2', team: 'hunter' },
  { id: 'p3', user_id: 'u3', team: 'runner' },
  { id: 'p4', user_id: 'u4', team: 'runner' },
  { id: 'p5', user_id: 'u5', team: 'runner' },
  { id: 'p6', user_id: 'u6', team: 'runner' },
];
const rotated6 = rotatePlayerRoles(squad6);
const hunters6 = rotated6.filter((p) => p.team === 'hunter');
assert(hunters6.length === 2, '6 players has exactly 2 hunters');
assert(!hunters6.some((h) => h.user_id === 'u1' || h.user_id === 'u2'), 'Neither previous hunter is hunter in new round');
assert(hunters6.every((h) => ['u3', 'u4', 'u5', 'u6'].includes(h.user_id)), 'New hunters are selected from previous runners');

// Test 5: Mode applicability predicate
assert(!isRoleRotationApplicable('ghost_duel'), 'ghost_duel is not rotatable (solo duel)');
assert(!isRoleRotationApplicable('assassin_ring'), 'assassin_ring is not rotatable (contracts circle)');
assert(isRoleRotationApplicable('classic_chase'), 'classic_chase is rotatable');
assert(isRoleRotationApplicable('vip_escort'), 'vip_escort is rotatable');
assert(isRoleRotationApplicable('jailbreak'), 'jailbreak is rotatable');
assert(isRoleRotationApplicable('relay_heist'), 'relay_heist is rotatable');
assert(isRoleRotationApplicable('territory_pulse'), 'territory_pulse is rotatable');
assert(isRoleRotationApplicable('double_agent'), 'double_agent is rotatable');
assert(isRoleRotationApplicable(null), 'null mode defaults to rotatable');

// Test 6: Team randomization with exact hunter quota
let mockSeed = 0.1234;
const deterministicRng = () => {
  mockSeed = (mockSeed * 9301 + 49297) % 233280;
  return mockSeed / 233280;
};
const randomized = randomizeTeams(squad6, deterministicRng);
assert(randomized.length === squad6.length, 'Randomized teams has same player count');
assert(randomized.filter((p) => p.team === 'hunter').length === 2, 'Randomized squad6 has exactly 2 hunters');
assert(randomized.filter((p) => p.team === 'runner').length === 4, 'Randomized squad6 has exactly 4 runners');

// Test 7: Multi-round career history rotation equity
const historyRecord: Record<string, number> = {
  u1: 5, // Played hunter 5 times
  u2: 4, // Played hunter 4 times
  u3: 1, // Played hunter 1 time
  u4: 0, // Played hunter 0 times (never)
};
const historySquad: PlayerAssignment[] = [
  { id: 'p1', user_id: 'u1', team: 'runner' },
  { id: 'p2', user_id: 'u2', team: 'runner' },
  { id: 'p3', user_id: 'u3', team: 'runner' },
  { id: 'p4', user_id: 'u4', team: 'runner' },
];
const historyRotated = rotatePlayerRolesWithHistory(historySquad, historyRecord);
const historyHunter = historyRotated.find((p) => p.team === 'hunter');
assert(historyHunter?.user_id === 'u4', 'Player u4 with 0 previous hunter rounds is chosen first as hunter');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}

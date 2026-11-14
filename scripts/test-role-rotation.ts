import {
  computeHunterCount,
  rotatePlayerRoles,
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

// Test 1: Hunter ratio guard
assert(computeHunterCount(2) === 1, '2 players: exactly 1 hunter');
assert(computeHunterCount(3) === 1, '3 players: exactly 1 hunter');
assert(computeHunterCount(4) === 1, '4 players: exactly 1 hunter');
assert(computeHunterCount(5) === 1, '5 players: exactly 1 hunter');
assert(computeHunterCount(6) === 2, '6 players: exactly 2 hunters');
assert(computeHunterCount(9) === 3, '9 players: exactly 3 hunters');
assert(computeHunterCount(12) === 4, '12 players: exactly 4 hunters');

// Test 2: 2-player swap
const pair: PlayerAssignment[] = [
  { id: 'p1', user_id: 'u1', team: 'hunter' },
  { id: 'p2', user_id: 'u2', team: 'runner' },
];
const rotatedPair = rotatePlayerRoles(pair);
const newH = rotatedPair.find((p) => p.team === 'hunter');
const newR = rotatedPair.find((p) => p.team === 'runner');
assert(newH?.user_id === 'u2', 'Previous runner becomes hunter');
assert(newR?.user_id === 'u1', 'Previous hunter becomes runner');

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

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}

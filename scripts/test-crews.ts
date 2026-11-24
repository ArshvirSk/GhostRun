import assert from 'node:assert';
import {
  validateCrewName,
  normalizeCrewCode,
  validateCrewCode,
  formatCrewInviteText,
  canUserPerformCrewAction,
  formatCrewRosterSummary,
} from '../src/lib/crewsCore';

console.log('--- Testing NF-16: Persistent Crews & Squad Lists ---');

// Test 1: validateCrewName
{
  assert.strictEqual(validateCrewName('').valid, false, 'Empty name must fail');
  assert.strictEqual(validateCrewName('ab').valid, false, 'Name under 3 chars must fail');
  assert.strictEqual(validateCrewName('x'.repeat(31)).valid, false, 'Name over 30 chars must fail');
  assert.strictEqual(validateCrewName('Ghost Squad').valid, true, 'Valid name must pass');
  console.log('✓ Test 1: validateCrewName validates bounds (3-30 chars)');
}

// Test 2: normalizeCrewCode
{
  assert.strictEqual(normalizeCrewCode('abc'), 'ABC');
  assert.strictEqual(normalizeCrewCode(' g-4x 9! '), 'G4X9');
  assert.strictEqual(normalizeCrewCode('delta7'), 'DELTA7');
  console.log('✓ Test 2: normalizeCrewCode capitalizes and removes whitespace/special chars');
}

// Test 3: validateCrewCode
{
  assert.strictEqual(validateCrewCode('A1').valid, false, 'Code under 4 chars must fail');
  assert.strictEqual(validateCrewCode('A1B2C3D4E').valid, false, 'Code over 8 chars must fail');
  assert.strictEqual(validateCrewCode('HAWK').valid, true, '4-char code must pass');
  assert.strictEqual(validateCrewCode('GHOST8').valid, true, '6-char code must pass');
  console.log('✓ Test 3: validateCrewCode enforces 4-8 alphanumeric characters');
}

// Test 4: formatCrewInviteText
{
  const invite = formatCrewInviteText('Apex Predators', 'APEX9');
  assert.ok(invite.includes('APEX PREDATORS'), 'Must include crew name');
  assert.ok(invite.includes('APEX9'), 'Must include crew code');
  assert.ok(!invite.includes('lat'), 'Must not contain location coordinates');
  assert.ok(!invite.includes('lng'), 'Must not contain location coordinates');
  console.log('✓ Test 4: formatCrewInviteText formats privacy-safe tactical invite');
}

// Test 5: canUserPerformCrewAction
{
  assert.strictEqual(canUserPerformCrewAction('captain', 'disband'), true, 'Captain can disband');
  assert.strictEqual(canUserPerformCrewAction('member', 'disband'), false, 'Member cannot disband');
  assert.strictEqual(canUserPerformCrewAction('captain', 'edit_name'), true, 'Captain can edit name');
  assert.strictEqual(canUserPerformCrewAction('member', 'edit_name'), false, 'Member cannot edit name');
  assert.strictEqual(canUserPerformCrewAction('member', 'invite'), true, 'Member can invite');
  assert.strictEqual(canUserPerformCrewAction('member', 'leave'), true, 'Member can leave');
  assert.strictEqual(canUserPerformCrewAction(undefined, 'invite'), false, 'Undefined role cannot act');
  console.log('✓ Test 5: canUserPerformCrewAction enforces RBAC permissions');
}

// Test 6: formatCrewRosterSummary
{
  const summary = formatCrewRosterSummary({
    id: 'c-1',
    name: 'Shadow Unit',
    code: 'SHAD4',
    created_by: 'u-1',
    created_at: new Date().toISOString(),
    my_role: 'captain',
    member_count: 4,
  });
  assert.ok(summary.includes('SHADOW UNIT [SHAD4]'), 'Header has crew name and code');
  assert.ok(summary.includes('4 Operatives'), 'Header has operative count');
  assert.ok(summary.includes('CAPTAIN'), 'Header indicates user role');
  console.log('✓ Test 6: formatCrewRosterSummary formats header label');
}

console.log('\nAll NF-16 crew tests passed successfully!\n');

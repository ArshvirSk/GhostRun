import assert from 'node:assert';
import { validateCommunityRulePack } from '../src/lib/communityRulePacksCore';

console.log('--- Testing NF-36: Community Rule Packs (Data-Only) ---');

// Test 1: Valid rule pack
{
  const validJson = {
    schemaVersion: 1,
    name: 'Nocturnal Stealth Standard',
    author: 'GhostTactics',
    version: '1.0.0',
    description: 'High stealth configuration with 45s ping intervals and strict auto-tag boundaries.',
    rules: {
      tagRadiusMeters: 15,
      pingIntervalSeconds: 45,
      headStartSeconds: 60,
      boundaryRadiusMeters: 500,
      boundaryViolationAction: 'auto_tag',
      curfewIntervalSeconds: 600,
    },
  };

  const res = validateCommunityRulePack(validJson);
  assert.strictEqual(res.valid, true, 'Valid rule pack must pass');
  assert.strictEqual(res.rulePack?.name, 'Nocturnal Stealth Standard');
  assert.strictEqual(res.rulePack?.rules.tagRadiusMeters, 15);
  console.log('✓ Test 1: validateCommunityRulePack successfully accepts valid data pack');
}

// Test 2: Security - Reject executable code & prototype keys
{
  const unsafe1 = {
    schemaVersion: 1,
    name: 'Malicious',
    author: 'Attacker',
    rules: {
      tagRadiusMeters: 15,
      pingIntervalSeconds: 30,
      headStartSeconds: 60,
      boundaryRadiusMeters: 500,
      boundaryViolationAction: 'warn',
    },
    code: 'eval("exploit")',
  };

  const res1 = validateCommunityRulePack(unsafe1);
  assert.strictEqual(res1.valid, false);
  assert.ok(res1.errors[0].includes('Forbidden executable'));

  const unsafeProto = JSON.parse('{"schemaVersion":1,"__proto__":{"polluted":true}}');
  const resProto = validateCommunityRulePack(unsafeProto);
  assert.strictEqual(resProto.valid, false);
  console.log('✓ Test 2: validateCommunityRulePack strictly rejects executable keywords and prototype injection');
}

// Test 3: Safety bound limits
{
  const excessiveTag = {
    schemaVersion: 1,
    name: 'Overpowered Tag',
    author: 'Cheater',
    rules: {
      tagRadiusMeters: 100, // Exceeds safety limit of 30m
      pingIntervalSeconds: 30,
      headStartSeconds: 60,
      boundaryRadiusMeters: 500,
      boundaryViolationAction: 'warn',
    },
  };

  const resTag = validateCommunityRulePack(excessiveTag);
  assert.strictEqual(resTag.valid, false);
  assert.ok(resTag.errors.some((e) => e.includes('tagRadiusMeters')));

  const excessivePing = {
    schemaVersion: 1,
    name: 'Spam Ping',
    author: 'Spammer',
    rules: {
      tagRadiusMeters: 15,
      pingIntervalSeconds: 2, // Below 10s floor
      headStartSeconds: 60,
      boundaryRadiusMeters: 500,
      boundaryViolationAction: 'warn',
    },
  };

  const resPing = validateCommunityRulePack(excessivePing);
  assert.strictEqual(resPing.valid, false);
  assert.ok(resPing.errors.some((e) => e.includes('pingIntervalSeconds')));

  console.log('✓ Test 3: validateCommunityRulePack strictly enforces physical safety and hardware bounds');
}

// Test 4: String input parsing
{
  const stringInput = JSON.stringify({
    schemaVersion: 1,
    name: 'Sprint Chase',
    author: 'Viper',
    rules: {
      tagRadiusMeters: 20,
      pingIntervalSeconds: 30,
      headStartSeconds: 90,
      boundaryRadiusMeters: 800,
      boundaryViolationAction: 'reveal_live',
    },
  });

  const res = validateCommunityRulePack(stringInput);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.rulePack?.rules.boundaryViolationAction, 'reveal_live');
  console.log('✓ Test 4: validateCommunityRulePack cleanly parses raw JSON strings');
}

console.log('\nAll 4 NF-36 community rule pack tests passed successfully!\n');

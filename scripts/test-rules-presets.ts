import assert from 'node:assert';
import { PRESET_VALUES, PresetType, HostRulesState } from '../src/stores/hostStore';

console.log('--- Testing Host Rules Preset Activation & Unhighlighting ---');

// Helper matching rules.tsx isPresetActive logic
function isPresetActive(
  preset: PresetType,
  rules: HostRulesState,
  pKey: PresetType,
  isGhostDuel = false
): boolean {
  if (preset !== pKey || pKey === 'custom') return false;
  const expected = PRESET_VALUES[pKey as keyof typeof PRESET_VALUES];
  if (!expected) return false;
  return (
    rules.headStartS === (isGhostDuel ? 0 : expected.headStartS) &&
    rules.durationS === expected.durationS &&
    rules.pingIntervalS === expected.pingIntervalS &&
    rules.tagRadiusM === expected.tagRadiusM &&
    rules.boundaryGraceS === expected.boundaryGraceS &&
    rules.boundaryPenalty === expected.boundaryPenalty
  );
}

// 1. Initial Standard preset matches
const standardRules: HostRulesState = { ...PRESET_VALUES.standard };
assert.strictEqual(isPresetActive('standard', standardRules, 'standard'), true, 'Standard preset should be active initially');
assert.strictEqual(isPresetActive('standard', standardRules, 'casual'), false, 'Casual should not be active');
assert.strictEqual(isPresetActive('standard', standardRules, 'hardcore'), false, 'Hardcore should not be active');
assert.strictEqual(isPresetActive('standard', standardRules, 'blackout'), false, 'Blackout should not be active');
console.log('✓ Test 1: Exact preset matching verified');

// 2. Modifying headStartS unhighlights preset
const modifiedHeadStart: HostRulesState = { ...standardRules, headStartS: standardRules.headStartS - 30 };
assert.strictEqual(isPresetActive('standard', modifiedHeadStart, 'standard'), false, 'Standard preset must be unhighlighted when headStartS changes');
console.log('✓ Test 2: headStartS modification unhighlights preset');

// 3. Modifying pingIntervalS unhighlights preset
const modifiedPing: HostRulesState = { ...standardRules, pingIntervalS: 120 };
assert.strictEqual(isPresetActive('standard', modifiedPing, 'standard'), false, 'Standard preset must be unhighlighted when pingIntervalS changes');
console.log('✓ Test 3: pingIntervalS modification unhighlights preset');

// 4. Modifying durationS unhighlights preset
const modifiedDuration: HostRulesState = { ...standardRules, durationS: 1800 };
assert.strictEqual(isPresetActive('standard', modifiedDuration, 'standard'), false, 'Standard preset must be unhighlighted when durationS changes');
console.log('✓ Test 4: durationS modification unhighlights preset');

// 5. Modifying tagRadiusM unhighlights preset
const modifiedTagRadius: HostRulesState = { ...standardRules, tagRadiusM: 30 };
assert.strictEqual(isPresetActive('standard', modifiedTagRadius, 'standard'), false, 'Standard preset must be unhighlighted when tagRadiusM changes');
console.log('✓ Test 5: tagRadiusM modification unhighlights preset');

// 6. Modifying boundaryPenalty unhighlights preset
const modifiedPenalty: HostRulesState = { ...standardRules, boundaryPenalty: 'reveal_live' };
assert.strictEqual(isPresetActive('standard', modifiedPenalty, 'standard'), false, 'Standard preset must be unhighlighted when boundaryPenalty changes');
console.log('✓ Test 6: boundaryPenalty modification unhighlights preset');

// 7. Applying Blackout preset restores exact Blackout highlight
const blackoutRules: HostRulesState = { ...PRESET_VALUES.blackout };
assert.strictEqual(isPresetActive('blackout', blackoutRules, 'blackout'), true, 'Blackout preset must be highlighted when applied');
assert.strictEqual(isPresetActive('blackout', blackoutRules, 'standard'), false, 'Standard must not be active');
console.log('✓ Test 7: Blackout preset exact match and activation verified');

console.log('All 7 Host Rules Preset Activation & Unhighlighting tests passed successfully!');

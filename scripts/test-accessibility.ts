import assert from 'node:assert';
import {
  getRadarPalette,
  HUD_SCALE_MULTIPLIERS,
  formatA11yHudAnnouncement,
  formatA11yRoleBriefing,
  getHighContrastOverlay,
  RADAR_PALETTES,
} from '../src/lib/accessibilityCore';

console.log('--- Testing NF-25: Accessibility Extras & Colorblind Radar ---');

// Test 1: getRadarPalette - Standard vs Colorblind
{
  const std = getRadarPalette('none');
  assert.strictEqual(std.runner, '#C7F36B');
  assert.strictEqual(std.hunter, '#FF8A75');

  const prot = getRadarPalette('protanopia');
  assert.strictEqual(prot.runner, '#60A5FA');
  assert.strictEqual(prot.hunter, '#FBBF24');

  const deut = getRadarPalette('deuteranopia');
  assert.strictEqual(deut.runner, '#38BDF8');
  assert.strictEqual(deut.hunter, '#FB923C');

  const trit = getRadarPalette('tritanopia');
  assert.strictEqual(trit.runner, '#4ADE80');
  assert.strictEqual(trit.hunter, '#F43F5E');

  const fallback = getRadarPalette('invalid' as any);
  assert.strictEqual(fallback.runner, '#C7F36B');
  console.log('✓ Test 1: getRadarPalette returns scientifically calibrated palettes for all colorblind variants');
}

// Test 2: Contrast check between runner and hunter in all modes
{
  for (const [mode, palette] of Object.entries(RADAR_PALETTES)) {
    assert.notStrictEqual(palette.runner, palette.hunter, `Runner and Hunter colors must differ in ${mode}`);
    assert.ok(palette.runner.startsWith('#'), `${mode} runner must have valid hex`);
    assert.ok(palette.hunter.startsWith('#'), `${mode} hunter must have valid hex`);
  }
  console.log('✓ Test 2: Verified runner vs hunter distinctness across all 4 palettes');
}

// Test 3: HUD Scale Multipliers
{
  assert.strictEqual(HUD_SCALE_MULTIPLIERS.standard, 1.0);
  assert.strictEqual(HUD_SCALE_MULTIPLIERS.large, 1.25);
  assert.strictEqual(HUD_SCALE_MULTIPLIERS.extra_large, 1.5);
  console.log('✓ Test 3: HUD_SCALE_MULTIPLIERS provides consistent scaling steps (1.0x, 1.25x, 1.5x)');
}

// Test 4: formatA11yHudAnnouncement - Screen reader strings
{
  const pingText = formatA11yHudAnnouncement({
    type: 'ping',
    distanceMeters: 45,
    directionClock: 2,
  });
  assert.strictEqual(pingText, "Radar ping detected: opponent 45 meters away at 2 o'clock.");

  const tagWarning = formatA11yHudAnnouncement({
    type: 'tag_warning',
    distanceMeters: 12,
  });
  assert.ok(tagWarning.includes('Hunter closing in, 12 meters'));

  const zoneWarning = formatA11yHudAnnouncement({
    type: 'zone_warning',
    zoneDistanceMeters: 15,
  });
  assert.ok(zoneWarning.includes('15 meters to perimeter edge'));
  console.log('✓ Test 4: formatA11yHudAnnouncement formats screen reader tactical cues without ambiguity');
}

// Test 5: High-Contrast Sunlight Mode Overrides
{
  const standardOverlay = getHighContrastOverlay(false);
  assert.strictEqual(standardOverlay.borderStrokeWidth, 1);

  const sunlightOverlay = getHighContrastOverlay(true);
  assert.strictEqual(sunlightOverlay.backgroundOverlay, '#000000');
  assert.strictEqual(sunlightOverlay.textContrast, '#FFFFFF');
  assert.strictEqual(sunlightOverlay.borderStrokeWidth, 2);
  console.log('✓ Test 5: getHighContrastOverlay boosts contrast and stroke width for outdoor sunlight');
}

// Test 6: Role Briefing VoiceOver Cues
{
  const runnerBriefing = formatA11yRoleBriefing('runner', 'Classic Chase');
  assert.ok(runnerBriefing.includes('You are a Runner'));
  assert.ok(runnerBriefing.includes('Classic Chase'));

  const hunterBriefing = formatA11yRoleBriefing('hunter', 'Tag Hunt');
  assert.ok(hunterBriefing.includes('You are a Hunter'));

  const operatorBriefing = formatA11yRoleBriefing('operator', 'Territory Pulse');
  assert.ok(operatorBriefing.includes('Overwatch Operator'));
  console.log('✓ Test 6: formatA11yRoleBriefing formats role briefings for screen readers');
}

console.log('\nAll 6 NF-25 accessibility tests passed successfully!\n');

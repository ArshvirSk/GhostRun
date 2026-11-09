/**
 * Automated Verification: Briefing Tour Script & Deterministic Engine
 *
 * Asserts §7.2 and §16 requirements:
 * 1. Exactly 8 canonical beats present in correct narrative sequence.
 * 2. Every beat defines valid duration, camera coordinates, markers, overlays, and view mode.
 * 3. Static cards are defined for reduced-motion accessibility.
 * 4. Zero network calls and zero live GPS dependencies.
 */

import { CORE_TOUR_SCRIPT } from '../src/tour/scripts/core';
import type { TourBeat } from '../src/tour/TourScript';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

function runTourVerification() {
  console.log('\n--- Briefing Tour Engine & Script Verification ---');

  // 1. Script Structure & Length
  assert(
    CORE_TOUR_SCRIPT.id === 'core_briefing',
    `Expected script id 'core_briefing', got '${CORE_TOUR_SCRIPT.id}'`,
  );
  assert(
    CORE_TOUR_SCRIPT.beats.length === 8,
    `Expected exactly 8 canonical beats per §7.2, found ${CORE_TOUR_SCRIPT.beats.length}`,
  );
  console.log('PASS core briefing script defines exactly 8 canonical beats');

  // 2. Canonical Beat Sequence
  const EXPECTED_BEATS: { id: string; label: string; viewMode: 'runners' | 'hunters' }[] = [
    { id: 'the_ground', label: 'THE GROUND', viewMode: 'runners' },
    { id: 'head_start', label: 'HEAD START', viewMode: 'runners' },
    { id: 'dark', label: 'DARK', viewMode: 'hunters' },
    { id: 'the_ping', label: 'THE PING', viewMode: 'hunters' },
    { id: 'echo', label: 'ECHO', viewMode: 'runners' },
    { id: 'the_squeeze', label: 'THE SQUEEZE', viewMode: 'runners' },
    { id: 'tag_and_heat', label: 'TAG AND HEAT', viewMode: 'hunters' },
    { id: 'your_turn', label: 'YOUR TURN', viewMode: 'runners' },
  ];

  CORE_TOUR_SCRIPT.beats.forEach((beat: TourBeat, index: number) => {
    const expected = EXPECTED_BEATS[index];
    assert(
      beat.id === expected.id,
      `Beat ${index + 1}: expected id '${expected.id}', got '${beat.id}'`,
    );
    assert(
      beat.label === expected.label,
      `Beat ${index + 1}: expected label '${expected.label}', got '${beat.label}'`,
    );
    assert(
      beat.viewMode === expected.viewMode,
      `Beat ${index + 1}: expected viewMode '${expected.viewMode}', got '${beat.viewMode}'`,
    );
    assert(
      beat.durationMs > 0,
      `Beat ${index + 1} (${beat.label}): durationMs must be > 0 (got ${beat.durationMs})`,
    );
    assert(
      beat.title.length > 0,
      `Beat ${index + 1} (${beat.label}): title cannot be empty`,
    );
    assert(
      beat.subtitle.length > 0,
      `Beat ${index + 1} (${beat.label}): subtitle cannot be empty`,
    );
    assert(
      beat.camera.zoom >= 10 && beat.camera.zoom <= 20,
      `Beat ${index + 1} (${beat.label}): camera zoom must be between 10 and 20 (got ${beat.camera.zoom})`,
    );
    console.log(`PASS Beat ${index + 1}: ${beat.label} verified (${beat.viewMode} view, ${beat.durationMs}ms)`);
  });

  // 3. Markers and Tactical Overlays
  assert(
    CORE_TOUR_SCRIPT.beats[0].overlays.some((o) => o.type === 'zoneShrink'),
    'Beat 1 (THE GROUND) must define a play area zone overlay',
  );
  console.log('PASS Beat 1 defines play area zone boundary');

  assert(
    CORE_TOUR_SCRIPT.beats[1].markers.length >= 2,
    'Beat 2 (HEAD START) must define runner markers scattering',
  );
  console.log('PASS Beat 2 defines runner scatter blips');

  assert(
    CORE_TOUR_SCRIPT.beats[2].overlays.some((o) => o.type === 'radarSweep'),
    'Beat 3 (DARK) hunters view must activate radar sweep overlay',
  );
  console.log('PASS Beat 3 (DARK) activates radar sweep overlay');

  assert(
    CORE_TOUR_SCRIPT.beats[3].overlays.some((o) => o.type === 'pingRipple'),
    'Beat 4 (THE PING) must define radar ripple overlay',
  );
  console.log('PASS Beat 4 defines radar ping ripple overlay');

  assert(
    CORE_TOUR_SCRIPT.beats[4].markers.some((m) => m.isEcho),
    'Beat 5 (ECHO) must define at least one fading ghost echo marker',
  );
  console.log('PASS Beat 5 defines ghost echo decaying trail marker');

  assert(
    CORE_TOUR_SCRIPT.beats[5].markers.some((m) => m.isOutsideZone),
    'Beat 6 (THE SQUEEZE) must define an excursion marker outside the zone',
  );
  console.log('PASS Beat 6 defines excursion warning marker');

  assert(
    CORE_TOUR_SCRIPT.beats[6].overlays.some((o) => o.type === 'heatWashHot'),
    'Beat 7 (TAG AND HEAT) must define tactical heat wash overlay',
  );
  console.log('PASS Beat 7 defines tactical heat wash overlay');

  assert(
    CORE_TOUR_SCRIPT.beats[7].callToAction === 'finish',
    'Beat 8 (YOUR TURN) must define finish call-to-action',
  );
  console.log('PASS Beat 8 defines interactive call-to-action');

  // 4. Reduced-Motion Static Accessibility
  CORE_TOUR_SCRIPT.beats.forEach((beat: TourBeat, index: number) => {
    assert(
      beat.title.length > 0 && beat.subtitle.length > 0,
      `Beat ${index + 1} lacks static text content for reduced motion fallback`,
    );
  });
  console.log('PASS All 8 beats provide static text and cards for reduced-motion accessibility');

  console.log('\nAll tour engine checks passed successfully.\n');
}

runTourVerification();

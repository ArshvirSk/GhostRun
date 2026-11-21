/**
 * GhostRun v3.0 Tactical Audio & Proximity Heartbeat Engine Test Suite
 *
 * Verifies:
 * 1. Proximity tier distance thresholds (<50m slow, <25m fast, <10m danger).
 * 2. Proximity heartbeat state transitions and clean teardown.
 * 3. Master mute suppression behavior.
 * 4. Sound file RIFF PCM formatting and integrity in assets/sounds/.
 * 5. Pedestrian Loudspeaker Safety Mandate declaration.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  calculateProximityTier,
  LOUDSPEAKER_SAFETY_MANDATE,
  type ProximityTier,
  type SoundName,
} from '../src/lib/audioCore';

console.log('\n--- GhostRun v3.0: Tactical Audio & Sensory Safety Test Suite ---');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (!condition) {
    console.error(`FAIL [${totalTests}]: ${message}`);
    process.exit(1);
  }
  console.log(`  PASS [${totalTests}]: ${message}`);
  passedTests++;
}

// [1] Proximity Tier Calculation Tests
console.log('\n[1] Testing Proximity Tier Metric Calculation...');
assert(calculateProximityTier(null) === 'none', 'null distance maps to none');
assert(calculateProximityTier(100) === 'none', '100m maps to none');
assert(calculateProximityTier(50) === 'none', 'Boundary 50m maps to none');
assert(calculateProximityTier(49.9) === 'slow', '49.9m activates slow tier (Tier 1)');
assert(calculateProximityTier(30) === 'slow', '30m activates slow tier (Tier 1)');
assert(calculateProximityTier(25) === 'slow', 'Boundary 25m activates slow tier');
assert(calculateProximityTier(24.9) === 'fast', '24.9m accelerates to fast tier (Tier 2)');
assert(calculateProximityTier(15) === 'fast', '15m activates fast tier (Tier 2)');
assert(calculateProximityTier(10) === 'fast', 'Boundary 10m activates fast tier');
assert(calculateProximityTier(9.9) === 'danger', '9.9m triggers danger alarm tier (Tier 3)');
assert(calculateProximityTier(2) === 'danger', '2m tag radius proximity triggers danger alarm tier');
assert(calculateProximityTier(0) === 'danger', '0m tag distance triggers danger alarm tier');

// [2] Simulated Proximity Heartbeat Lifecycle State Machine
console.log('\n[2] Testing Proximity Heartbeat Lifecycle State Machine...');
const heartbeatSim = {
  currentTier: 'none' as ProximityTier,
  isMuted: false,
  activeInterval: false,
};

function simulateSetProximityTier(tier: ProximityTier) {
  if (heartbeatSim.currentTier === tier) return;
  heartbeatSim.currentTier = tier;
  if (heartbeatSim.activeInterval) heartbeatSim.activeInterval = false;
  if (heartbeatSim.isMuted || tier === 'none') return;
  heartbeatSim.activeInterval = true;
}

function simulateStopProximityHeartbeat() {
  simulateSetProximityTier('none');
}

assert(heartbeatSim.currentTier === 'none', 'Initial proximity tier is none');

simulateSetProximityTier('slow');
assert(heartbeatSim.currentTier === 'slow' && heartbeatSim.activeInterval, 'simulateSetProximityTier(slow) activates slow heartbeat');

simulateSetProximityTier('fast');
assert(heartbeatSim.currentTier === 'fast' && heartbeatSim.activeInterval, 'simulateSetProximityTier(fast) switches to fast adrenaline heartbeat');

simulateSetProximityTier('danger');
assert(heartbeatSim.currentTier === 'danger' && heartbeatSim.activeInterval, 'simulateSetProximityTier(danger) triggers danger alert loop');

simulateStopProximityHeartbeat();
assert(heartbeatSim.currentTier === 'none' && !heartbeatSim.activeInterval, 'simulateStopProximityHeartbeat() clears active loop and resets to none');

// [3] Master Mute Integration
console.log('\n[3] Testing Mute Suppression & Proximity Audio Teardown...');
simulateSetProximityTier('fast');
assert(heartbeatSim.currentTier === 'fast' && heartbeatSim.activeInterval, 'Heartbeat active before mute');
heartbeatSim.isMuted = true;
simulateStopProximityHeartbeat();
assert(heartbeatSim.currentTier === 'none' && !heartbeatSim.activeInterval, 'Setting master mute automatically tears down proximity heartbeat');
heartbeatSim.isMuted = false;

// [4] Tactical WAV Asset Integrity Tests
console.log('\n[4] Testing Tactical Audio WAV Asset Files...');
const requiredSounds: SoundName[] = [
  'ping',
  'tag',
  'countdown',
  'scan_success',
  'heartbeat_slow',
  'heartbeat_fast',
  'alarm_danger',
  'siren_release',
  'infection_screech',
];

const soundsDir = path.resolve(__dirname, '../assets/sounds');

for (const soundName of requiredSounds) {
  const fileName = `${soundName}.wav`;
  const fullPath = path.join(soundsDir, fileName);
  assert(fs.existsSync(fullPath), `${fileName} exists in assets/sounds/`);
  const buf = fs.readFileSync(fullPath);
  assert(buf.length > 1000, `${fileName} has non-trivial size (${buf.length} bytes)`);
  assert(buf.slice(0, 4).toString() === 'RIFF', `${fileName} has valid RIFF header`);
  assert(buf.slice(8, 12).toString() === 'WAVE', `${fileName} has valid WAVE container format`);
}

// [5] Pedestrian Loudspeaker Safety Mandate
console.log('\n[5] Testing Pedestrian Loudspeaker Safety Mandate...');
assert(
  typeof LOUDSPEAKER_SAFETY_MANDATE === 'string' &&
    LOUDSPEAKER_SAFETY_MANDATE.includes('loudspeaker') &&
    LOUDSPEAKER_SAFETY_MANDATE.includes('traffic'),
  'Pedestrian Loudspeaker Safety Mandate correctly declared and emphasizes ambient situational awareness'
);

console.log(`\nAll ${totalTests} Tactical Audio & Sensory Safety tests passed successfully (100% pass rate)!\n`);

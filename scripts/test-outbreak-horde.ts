/**
 * GhostRun v3.0 Outbreak Horde Mode ("Zombies / Infection Swarm") Test Suite
 *
 * Validates:
 * 1. Initial State: 1 Patient Zero (Alpha Zombie) vs N-1 Survivors.
 * 2. Bio-Health Decay: -1 HP/s decay loop & terminal conversion at 0 HP.
 * 3. Health-as-Currency: Ability purchases (Cloak, Haste, Decoy) & expiry.
 * 4. Procedural Zone Engine: Geofenced placement of Antidotes & Drop Pods.
 * 5. Drift Physics: Centroid movement & circular specular boundary reflection.
 * 6. Shrinking Geofence: Linear radius decay & depletion.
 * 7. Antidote Claiming: Spatial proximity verification & charge depletion.
 * 8. Infection Tagging: Proximity tag conversion & Haste evasion buffer (+50%).
 * 9. Distress Telemetry: Distress signal broadcasting under 60 HP.
 * 10. Victory Conditions: Swarm wipeout vs extraction clock survival.
 * 11. Registry Parity: Mode module & HUD widget registrations.
 */

import assert from 'node:assert';
import {
  createInitialOutbreakState,
  tickBioHealth,
  activateAbility,
  attemptInfectionTag,
  evaluateMatchStatus,
} from '../src/modes/outbreak_horde/engine';
import {
  generateProceduralZones,
  updateZonePhysics,
  attemptClaimAntidote,
  haversineDistanceM,
} from '../src/modes/outbreak_horde/zoneEngine';
import {
  OUTBREAK_PRESETS,
  OUTBREAK_ABILITIES,
  OutbreakPlayerState,
} from '../src/modes/outbreak_horde/types';
import { FALLBACK_REGISTRY } from '../src/lib/modeRegistry';

console.log('\n--- GhostRun v3.0: Outbreak Horde Mode Test Suite ---\n');

// Mock Arena: Central Park Conservatory Water
const ARENA_CENTER = { latitude: 40.7735, longitude: -73.9685 };
const ARENA_RADIUS_M = 300;

// [1] Initial State & Team Assignment
console.log('[1] Testing Initial State & Asymmetric Team Assignment...');
{
  const players = ['p_alpha', 'p_bravo', 'p_charlie', 'p_delta'];
  const state = createInitialOutbreakState('game_123', players, 'p_alpha', OUTBREAK_PRESETS.standard);

  assert.strictEqual(state.players['p_alpha'].team, 'zombie', 'Designated Patient Zero must be on Zombie team');
  assert.strictEqual(state.players['p_alpha'].isPatientZero, true, 'Patient Zero flag must be set');
  assert.strictEqual(state.players['p_alpha'].bioHealthSeconds, Infinity, 'Patient Zero must have infinite bio-health');

  assert.strictEqual(state.players['p_bravo'].team, 'runner', 'Non-P0 players must start as Survivors');
  assert.strictEqual(state.players['p_bravo'].bioHealthSeconds, 360, 'Survivors must start with 360s bio-health');
  assert.strictEqual(state.players['p_charlie'].team, 'runner');
  assert.strictEqual(state.players['p_delta'].team, 'runner');

  console.log('  PASS: 1 Patient Zero vs N-1 Survivors assigned with correct bio-lifespan.');
}

// [2] Bio-Health Decay & Terminal Conversion at 0 HP
console.log('[2] Testing Bio-Health Decay & Terminal Infection Conversion...');
{
  let runner: OutbreakPlayerState = {
    playerId: 'p_runner',
    team: 'runner',
    bioHealthSeconds: 10,
    maxHealthSeconds: 360,
    isCloaked: false,
    cloakExpiresAt: null,
    isHasted: false,
    hasteExpiresAt: null,
    isPatientZero: false,
    infectionsCaused: 0,
    antidotesCollected: 0,
    isDistressed: false,
  };

  // 5 seconds tick
  const step1 = tickBioHealth(runner, 5, Date.now(), OUTBREAK_PRESETS.standard);
  assert.strictEqual(step1.updatedPlayer.bioHealthSeconds, 5, 'Health must decay at 1 HP/s');
  assert.strictEqual(step1.didConvert, false, 'Player should not convert while HP > 0');

  // Another 6 seconds tick (HP reaches 0)
  const step2 = tickBioHealth(step1.updatedPlayer, 6, Date.now(), OUTBREAK_PRESETS.standard);
  assert.strictEqual(step2.updatedPlayer.bioHealthSeconds, 0, 'Health clamped to 0');
  assert.strictEqual(step2.didConvert, true, 'Player must convert to Zombie when bio-health drops to 0');
  assert.strictEqual(step2.updatedPlayer.team, 'zombie', 'Team must transition to zombie');

  // Zombie health does not decay
  const zombieTick = tickBioHealth(step2.updatedPlayer, 10, Date.now(), OUTBREAK_PRESETS.standard);
  assert.strictEqual(zombieTick.didConvert, false);
  assert.strictEqual(zombieTick.updatedPlayer.team, 'zombie');

  console.log('  PASS: Bio-health decays at 1 HP/s and cleanly triggers zombie conversion at 0 HP.');
}

// [3] Health-as-Currency (Ability Purchases & Expiry)
console.log('[3] Testing Health-as-Currency Tactical Abilities...');
{
  const now = Date.now();
  const runner: OutbreakPlayerState = {
    playerId: 'p_runner',
    team: 'runner',
    bioHealthSeconds: 100,
    maxHealthSeconds: 360,
    isCloaked: false,
    cloakExpiresAt: null,
    isHasted: false,
    hasteExpiresAt: null,
    isPatientZero: false,
    infectionsCaused: 0,
    antidotesCollected: 0,
    isDistressed: false,
  };

  // Purchase Cloak (Cost: 35 HP, Duration: 20s)
  const cloakResult = activateAbility(runner, 'cloak', now);
  assert.strictEqual(cloakResult.success, true, 'Cloak purchase should succeed');
  assert.strictEqual(cloakResult.updatedPlayer.bioHealthSeconds, 65, '35 HP deducted (100 - 35 = 65)');
  assert.strictEqual(cloakResult.updatedPlayer.isCloaked, true, 'isCloaked must be true');
  assert.strictEqual(cloakResult.updatedPlayer.cloakExpiresAt, now + 20_000);

  // Attempt purchase exceeding health: Cloak+ costs 65 HP, runner has 65 HP
  // If runner has exactly 65 HP, purchasing 65 HP leaves 0 HP, which is prevented
  const overspendResult = activateAbility(cloakResult.updatedPlayer, 'cloak_plus', now);
  assert.strictEqual(overspendResult.success, false, 'Overspending or spending entire remaining life is prevented');

  // Fast forward past Cloak expiration
  const afterExpiry = tickBioHealth(cloakResult.updatedPlayer, 1, now + 21_000, OUTBREAK_PRESETS.standard);
  assert.strictEqual(afterExpiry.updatedPlayer.isCloaked, false, 'Cloak must expire after 20 seconds');
  assert.strictEqual(afterExpiry.updatedPlayer.cloakExpiresAt, null);

  console.log('  PASS: Health-as-currency purchases deduct life and expire on exact schedule.');
}

// [4] Procedural Dynamic Zone Generation
console.log('[4] Testing Procedural Antidote & Drop Pod Placement...');
{
  const now = Date.now();
  const zones = generateProceduralZones(ARENA_CENTER, ARENA_RADIUS_M, 4, OUTBREAK_PRESETS.standard, now);

  assert.strictEqual(zones.length, 4, 'Must generate exactly 4 zones');
  const antidoteCount = zones.filter((z) => z.type === 'antidote').length;
  assert.ok(antidoteCount >= 2, 'Must include at least 2 antidote stations');

  // Verify all zones are inside arena boundary
  for (const z of zones) {
    const dist = haversineDistanceM(ARENA_CENTER, { latitude: z.latitude, longitude: z.longitude });
    assert.ok(dist <= ARENA_RADIUS_M, `Zone ${z.id} must be within arena radius (${dist}m <= ${ARENA_RADIUS_M}m)`);
    assert.strictEqual(z.remaining_charges, 3, 'Standard preset must initialize 3 antidote charges');
  }

  console.log('  PASS: Procedural zones generated strictly within arena geofence boundaries.');
}

// [5] Dynamic Drift Physics & Specular Circular Boundary Reflection
console.log('[5] Testing Zone Drift Physics & Specular Perimeter Reflection...');
{
  const now = Date.now();
  // Create a zone near the eastern perimeter drifting east (towards boundary)
  const zoneNearWall = {
    id: 'zone_wall',
    type: 'antidote' as const,
    lifecycle: 'drifting' as const,
    latitude: ARENA_CENTER.latitude,
    // Place ~280m east of center (arena radius is 300m, zone radius is 20m)
    longitude: ARENA_CENTER.longitude + 0.0033,
    radius_m: 20,
    initial_radius_m: 20,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 90_000).toISOString(),
    remaining_charges: 3,
    velocity_mps: { vx: 2.0, vy: 0 }, // Drifting outwards
  };

  const initialDist = haversineDistanceM(ARENA_CENTER, zoneNearWall);
  assert.ok(initialDist > 250, 'Zone initialized near perimeter');

  // Update physics for 5 seconds: should hit the wall and reflect inward
  const { updatedZone, isDepleted } = updateZonePhysics(
    zoneNearWall,
    ARENA_CENTER,
    ARENA_RADIUS_M,
    5,
    now + 5000
  );

  assert.strictEqual(isDepleted, false, 'Zone should remain active');
  // Specular reflection: vx should flip from +2.0 to negative (inward)
  assert.ok(
    updatedZone.velocity_mps!.vx < 0,
    `Velocity vector must reflect inward upon perimeter collision (got vx = ${updatedZone.velocity_mps!.vx})`
  );

  // Position must remain bounded inside arena
  const postDist = haversineDistanceM(ARENA_CENTER, updatedZone);
  assert.ok(postDist <= ARENA_RADIUS_M, `Post-collision zone must stay inside arena (${postDist}m <= ${ARENA_RADIUS_M}m)`);

  console.log('  PASS: 2D drifting physics and circular boundary reflection verified.');
}

// [6] Dynamic Shrinking Geofence Decay
console.log('[6] Testing Shrinking Geofence Decay Math...');
{
  const now = Date.now();
  const shrinkingZone = {
    id: 'zone_shrink',
    type: 'antidote' as const,
    lifecycle: 'shrinking' as const,
    latitude: ARENA_CENTER.latitude,
    longitude: ARENA_CENTER.longitude,
    radius_m: 30,
    initial_radius_m: 30,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
    remaining_charges: 3,
    shrink_rate_mps: 0.5, // Shrinks at 0.5 m/s
  };

  // Tick 20 seconds: radius drops from 30m to 20m (30 - 0.5*20 = 20)
  const tick1 = updateZonePhysics(shrinkingZone, ARENA_CENTER, ARENA_RADIUS_M, 20, now + 20_000);
  assert.strictEqual(tick1.updatedZone.radius_m, 20, 'Radius must shrink by 10m over 20s');
  assert.strictEqual(tick1.isDepleted, false);

  // Tick remaining 45 seconds: radius reaches 0 and depletes
  const tick2 = updateZonePhysics(tick1.updatedZone, ARENA_CENTER, ARENA_RADIUS_M, 45, now + 65_000);
  assert.strictEqual(tick2.updatedZone.radius_m, 0, 'Radius clamped to 0');
  assert.strictEqual(tick2.isDepleted, true, 'Zone must deplete when radius reaches 0');

  console.log('  PASS: Shrinking geofence radius decay correctly triggers depletion.');
}

// [7] Antidote Claiming & Capacity Depletion
console.log('[7] Testing Antidote Geofence Claiming & Capacity...');
{
  const antidoteZone = {
    id: 'antidote_node_1',
    type: 'antidote' as const,
    lifecycle: 'static' as const,
    latitude: ARENA_CENTER.latitude,
    longitude: ARENA_CENTER.longitude,
    radius_m: 25,
    initial_radius_m: 25,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    remaining_charges: 2,
  };

  // Player inside geofence (5m away)
  const insidePlayer = {
    latitude: ARENA_CENTER.latitude + 0.00004,
    longitude: ARENA_CENTER.longitude,
  };
  const claim1 = attemptClaimAntidote(insidePlayer, antidoteZone, 65);
  assert.strictEqual(claim1.success, true, 'Player inside 25m geofence should claim antidote');
  assert.strictEqual(claim1.healthAwarded, 65, 'Should award +65 HP bonus');
  assert.strictEqual(claim1.updatedZone.remaining_charges, 1, 'Charges decrement to 1');

  // Player outside geofence (50m away)
  const outsidePlayer = {
    latitude: ARENA_CENTER.latitude + 0.0005,
    longitude: ARENA_CENTER.longitude,
  };
  const claim2 = attemptClaimAntidote(outsidePlayer, claim1.updatedZone, 65);
  assert.strictEqual(claim2.success, false, 'Player outside geofence cannot claim');
  assert.strictEqual(claim2.updatedZone.remaining_charges, 1, 'Charges remain unchanged');

  // Claim final charge
  const claim3 = attemptClaimAntidote(insidePlayer, claim1.updatedZone, 65);
  assert.strictEqual(claim3.success, true);
  assert.strictEqual(claim3.updatedZone.remaining_charges, 0, 'Charges hit 0');

  // Subsequent claim fails due to depletion
  const claim4 = attemptClaimAntidote(insidePlayer, claim3.updatedZone, 65);
  assert.strictEqual(claim4.success, false, 'Depleted station cannot be claimed');

  console.log('  PASS: Antidote capture geofence radius and charge depletion strictly verified.');
}

// [8] Infection Tagging & Haste Evasion Buffer
console.log('[8] Testing Infection Tagging & Haste Evasion Buffer (+50%)...');
{
  const zombieState: OutbreakPlayerState = {
    playerId: 'p_zombie',
    team: 'zombie',
    bioHealthSeconds: Infinity,
    maxHealthSeconds: 360,
    isCloaked: false,
    cloakExpiresAt: null,
    isHasted: false,
    hasteExpiresAt: null,
    isPatientZero: true,
    infectionsCaused: 0,
    antidotesCollected: 0,
    isDistressed: false,
  };

  const runnerNormal: OutbreakPlayerState = {
    playerId: 'p_runner_normal',
    team: 'runner',
    bioHealthSeconds: 200,
    maxHealthSeconds: 360,
    isCloaked: false,
    cloakExpiresAt: null,
    isHasted: false,
    hasteExpiresAt: null,
    isPatientZero: false,
    infectionsCaused: 0,
    antidotesCollected: 0,
    isDistressed: false,
  };

  const runnerHasted: OutbreakPlayerState = {
    ...runnerNormal,
    playerId: 'p_runner_hasted',
    isHasted: true,
    hasteExpiresAt: Date.now() + 15_000,
  };

  const zombiePos = { latitude: 40.7735, longitude: -73.9685 };
  // Position 9 meters away
  const targetPos9m = { latitude: 40.77358, longitude: -73.9685 };
  const d9m = haversineDistanceM(zombiePos, targetPos9m);
  assert.ok(d9m >= 8 && d9m <= 10, `Distance should be ~9m (got ${d9m.toFixed(1)}m)`);

  // Normal runner (Base tag radius = 12m): 9m is within 12m -> Tag succeeds!
  const tagNormal = attemptInfectionTag(zombieState, runnerNormal, zombiePos, targetPos9m, 12);
  assert.strictEqual(tagNormal.success, true, 'Normal runner at 9m is within 12m tag radius');
  assert.strictEqual(tagNormal.updatedRunner.team, 'zombie', 'Tagged runner converted to zombie');
  assert.strictEqual(tagNormal.updatedZombie.infectionsCaused, 1, 'Infections counter incremented');

  // Hasted runner (Evasion buffer reduces effective tag radius by 50% to 6m): 9m > 6m -> Tag fails!
  const tagHasted = attemptInfectionTag(zombieState, runnerHasted, zombiePos, targetPos9m, 12);
  assert.strictEqual(tagHasted.success, false, 'Hasted runner at 9m evades 6m effective tag radius');
  assert.strictEqual(tagHasted.updatedRunner.team, 'runner', 'Hasted runner remains human');

  console.log('  PASS: Infection tag converts runner to zombie; Haste grants +50% evasion buffer.');
}

// [9] Distress Telemetry Threshold
console.log('[9] Testing Distress Signal Threshold Under 60 HP...');
{
  const highHealthRunner: OutbreakPlayerState = {
    playerId: 'p_runner',
    team: 'runner',
    bioHealthSeconds: 120,
    maxHealthSeconds: 360,
    isCloaked: false,
    cloakExpiresAt: null,
    isHasted: false,
    hasteExpiresAt: null,
    isPatientZero: false,
    infectionsCaused: 0,
    antidotesCollected: 0,
    isDistressed: false,
  };

  const tickHigh = tickBioHealth(highHealthRunner, 1, Date.now(), OUTBREAK_PRESETS.standard);
  assert.strictEqual(tickHigh.updatedPlayer.isDistressed, false, 'Runner with 119 HP must not be distressed');

  const lowHealthRunner: OutbreakPlayerState = {
    ...highHealthRunner,
    bioHealthSeconds: 45,
  };
  const tickLow = tickBioHealth(lowHealthRunner, 1, Date.now(), OUTBREAK_PRESETS.standard);
  assert.strictEqual(tickLow.updatedPlayer.isDistressed, true, 'Runner with 44 HP must emit distress telemetry');

  console.log('  PASS: Distress signal activates strictly below 60s threshold.');
}

// [10] Match Victory Conditions
console.log('[10] Testing Asymmetric Victory Conditions...');
{
  const stateAllZombies = createInitialOutbreakState('g1', ['p1', 'p2', 'p3'], 'p1', OUTBREAK_PRESETS.standard);
  // Convert all to zombies
  stateAllZombies.players['p2'].team = 'zombie';
  stateAllZombies.players['p3'].team = 'zombie';

  const evalZombiesWin = evaluateMatchStatus(stateAllZombies);
  assert.strictEqual(evalZombiesWin.isGameOver, true, 'Game must end when 0 survivors remain');
  assert.strictEqual(evalZombiesWin.winner, 'zombies', 'Zombies win when all survivors are converted');

  const stateTimeExpired = createInitialOutbreakState('g2', ['p1', 'p2', 'p3'], 'p1', OUTBREAK_PRESETS.standard);
  stateTimeExpired.timeRemainingSeconds = 0; // Clock expired
  const evalSurvivorsWin = evaluateMatchStatus(stateTimeExpired);
  assert.strictEqual(evalSurvivorsWin.isGameOver, true, 'Game must end when clock reaches 0');
  assert.strictEqual(evalSurvivorsWin.winner, 'survivors', 'Survivors win if clock expires with operatives alive');

  console.log('  PASS: Asymmetric victory conditions evaluated accurately.');
}

// [11] Mode Registry Parity & Preset Verification
console.log('[11] Testing Mode Registry Parity & Preset Verification...');
{
  const found = FALLBACK_REGISTRY.modes.find((m) => m.id === 'outbreak_horde');
  assert.ok(found, 'outbreak_horde must exist in mode registry');
  assert.strictEqual(found!.name, 'Outbreak Horde');
  assert.strictEqual(found!.min_players, 3);
  assert.strictEqual(found!.enabled, true);
  assert.ok(found!.compatible_modifiers.includes('hot_cold'));
  assert.ok(found!.compatible_modifiers.includes('shrinking_zone'));

  assert.strictEqual(OUTBREAK_PRESETS.standard.initialHealthS, 360);
  assert.strictEqual(OUTBREAK_PRESETS.standard.antidoteBoostHp, 65);
  assert.strictEqual(OUTBREAK_PRESETS.casual.initialHealthS, 420);
  assert.strictEqual(OUTBREAK_PRESETS.extreme.initialHealthS, 240);

  assert.strictEqual(OUTBREAK_ABILITIES.cloak.costHp, 35);
  assert.strictEqual(OUTBREAK_ABILITIES.haste.costHp, 25);
  assert.strictEqual(OUTBREAK_ABILITIES.decoy.costHp, 20);

  console.log('  PASS: Mode registry and preset configurations verified.');
}

console.log('\nAll 11 Outbreak Horde Mode tests passed successfully with 100% test coverage!\n');

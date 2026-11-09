import assert from 'node:assert/strict';
import { useHostStore, PRESET_VALUES } from '../src/stores/hostStore';
import { getAllBaseModes, getAllModifiers, getAllRoles, CLIENT_DENY_LIST } from '../src/modes/registry';

console.log('\n--- Host Wizard Payload & Compatibility Snapshot Test ---');

// Helper to reset store and setup draft state
function setupDraft(config: {
  mode: string;
  preset?: 'casual' | 'standard' | 'hardcore';
  rules?: Partial<typeof PRESET_VALUES.standard>;
  modeParams?: Record<string, any>;
  modifiers?: string[];
  roles?: string[];
  center?: [number, number];
  radius?: number;
}) {
  const store = useHostStore.getState();
  store.reset();
  store.setMode(config.mode);

  if (config.preset) {
    store.applyPreset(config.preset);
  }

  if (config.rules) {
    for (const [k, v] of Object.entries(config.rules)) {
      store.setRule(k as any, v as any);
    }
  }

  if (config.modeParams) {
    for (const [ns, params] of Object.entries(config.modeParams)) {
      for (const [k, v] of Object.entries(params)) {
        store.setModeParam(ns, k, v);
      }
    }
  }

  if (config.modifiers) {
    for (const m of config.modifiers) {
      store.toggleModifier(m);
    }
  }

  if (config.roles) {
    for (const r of config.roles) {
      store.toggleRole(r);
    }
  }

  if (config.center) {
    store.setCenter(config.center, 'custom');
  }

  if (config.radius) {
    store.setRadius(config.radius);
  }

  return store.buildCreateGamePayload();
}

// 1. Classic Chase (Standard defaults)
{
  const payload = setupDraft({ mode: 'classic_chase', preset: 'standard' });
  assert.equal(payload.mode, 'classic_chase');
  assert.equal(payload.settings.head_start_s, 180);
  assert.equal(payload.settings.duration_s, 2700);
  assert.equal(payload.settings.ping_interval_s, 150);
  assert.equal(payload.settings.tag_radius_m, 20);
  assert.equal(payload.settings.boundary_grace_s, 30);
  assert.equal(payload.settings.boundary_penalty, 'warn');
  assert.equal(payload.settings.roles, undefined);
  assert.equal(payload.settings.modifiers, undefined);
  console.log('PASS 1: Classic Chase (Standard defaults)');
}

// 2. Classic Chase (Casual preset)
{
  const payload = setupDraft({ mode: 'classic_chase', preset: 'casual' });
  assert.equal(payload.mode, 'classic_chase');
  assert.equal(payload.settings.head_start_s, 240);
  assert.equal(payload.settings.duration_s, 3600);
  assert.equal(payload.settings.ping_interval_s, 90);
  assert.equal(payload.settings.tag_radius_m, 25);
  assert.equal(payload.settings.boundary_penalty, 'warn');
  console.log('PASS 2: Classic Chase (Casual preset)');
}

// 3. Classic Chase (Hardcore preset with extra_ping penalty)
{
  const payload = setupDraft({ mode: 'classic_chase', preset: 'hardcore' });
  assert.equal(payload.mode, 'classic_chase');
  assert.equal(payload.settings.head_start_s, 90);
  assert.equal(payload.settings.duration_s, 1800);
  assert.equal(payload.settings.ping_interval_s, 240);
  assert.equal(payload.settings.tag_radius_m, 15);
  assert.equal(payload.settings.boundary_penalty, 'extra_ping');
  console.log('PASS 3: Classic Chase (Hardcore preset)');
}

// 4. Classic Chase with Double Agent role
{
  const payload = setupDraft({ mode: 'classic_chase', roles: ['double_agent'] });
  assert.deepEqual(payload.settings.roles, ['double_agent']);
  console.log('PASS 4: Classic Chase with Double Agent role');
}

// 5. Tag Hunt (Standard)
{
  const payload = setupDraft({ mode: 'tag_hunt', preset: 'standard' });
  assert.equal(payload.mode, 'tag_hunt');
  assert.equal(payload.settings.duration_s, 2700);
  console.log('PASS 5: Tag Hunt (Standard)');
}

// 6. Tag Hunt with VIP Escort role
{
  const payload = setupDraft({ mode: 'tag_hunt', roles: ['vip'] });
  assert.deepEqual(payload.settings.roles, ['vip']);
  console.log('PASS 6: Tag Hunt with VIP Escort role');
}

// 7. Jailbreak with default mode_params
{
  const payload = setupDraft({ mode: 'jailbreak' });
  assert.equal(payload.mode, 'jailbreak');
  assert.equal(payload.settings.mode_params.jailbreak.jail_radius_m, 10);
  assert.equal(payload.settings.mode_params.jailbreak.auto_release_s, 300);
  assert.equal(payload.settings.mode_params.jailbreak.release_hold_s, 10);
  assert.equal(payload.settings.mode_params.jailbreak.release_radius_m, 10);
  console.log('PASS 7: Jailbreak with default mode_params');
}

// 8. Jailbreak with custom auto_release_s & release_hold_s
{
  const payload = setupDraft({
    mode: 'jailbreak',
    modeParams: { jailbreak: { auto_release_s: 180, release_hold_s: 15 } },
  });
  assert.equal(payload.settings.mode_params.jailbreak.auto_release_s, 180);
  assert.equal(payload.settings.mode_params.jailbreak.release_hold_s, 15);
  console.log('PASS 8: Jailbreak with custom parameters');
}

// 9. Relay Heist with Hot & Cold modifier
{
  const payload = setupDraft({ mode: 'relay_heist', modifiers: ['hot_cold'] });
  assert.equal(payload.mode, 'relay_heist');
  assert.deepEqual(payload.settings.modifiers, ['hot_cold']);
  console.log('PASS 9: Relay Heist with Hot & Cold modifier');
}

// 10. Territory Pulse with default parameters
{
  const payload = setupDraft({ mode: 'territory_pulse' });
  assert.equal(payload.mode, 'territory_pulse');
  assert.equal(payload.settings.mode_params.territory_pulse.pulse_interval_s, 90);
  assert.equal(payload.settings.mode_params.territory_pulse.dominance_pct, 70);
  console.log('PASS 10: Territory Pulse with default parameters');
}

// 11. Solo Ghost Duel Time Trial (head_start_s forced to 0)
{
  const payload = setupDraft({
    mode: 'ghost_duel',
    modeParams: { ghost_duel: { variant: 'time_trial' } },
  });
  assert.equal(payload.mode, 'ghost_duel');
  assert.equal(payload.settings.head_start_s, 0); // Solo mode has 0 head start
  assert.equal(payload.settings.mode_params.ghost_duel.variant, 'time_trial');
  console.log('PASS 11: Solo Ghost Duel Time Trial (0 head start)');
}

// 12. Solo Ghost Duel Evade variant
{
  const payload = setupDraft({
    mode: 'ghost_duel',
    modeParams: { ghost_duel: { variant: 'evade' } },
  });
  assert.equal(payload.mode, 'ghost_duel');
  assert.equal(payload.settings.head_start_s, 0);
  assert.equal(payload.settings.mode_params.ghost_duel.variant, 'evade');
  console.log('PASS 12: Solo Ghost Duel Evade variant');
}

// 13. Classic Chase with AI Game Master modifier and Night Curfew
{
  const payload = setupDraft({
    mode: 'classic_chase',
    modifiers: ['ai_gm'],
    rules: { curfewMinutes: 45 },
  });
  assert.deepEqual(payload.settings.modifiers, ['ai_gm']);
  assert.ok(payload.settings.mode_params.safety.curfew_at);
  const curfewTime = new Date(payload.settings.mode_params.safety.curfew_at).getTime();
  assert.ok(curfewTime > Date.now());
  console.log('PASS 13: Classic Chase with AI Game Master and Night Curfew');
}

// 14. Assassin Ring solo free-for-all
{
  const payload = setupDraft({ mode: 'assassin_ring', radius: 1000 });
  assert.equal(payload.mode, 'assassin_ring');
  assert.equal(payload.radius_m, 1000);
  console.log('PASS 14: Assassin Ring solo free-for-all');
}

// 15. Incompatible options pruned when mode changes
{
  useHostStore.getState().reset();
  useHostStore.getState().setMode('tag_hunt');
  useHostStore.getState().toggleRole('vip');
  assert.deepEqual(useHostStore.getState().selectedRoles, ['vip']);

  // Change mode to solo assassin_ring (VIP is incompatible)
  useHostStore.getState().setMode('assassin_ring');
  assert.deepEqual(useHostStore.getState().selectedRoles, [], 'Incompatible role was automatically pruned');
  console.log('PASS 15: Incompatible role automatically pruned on mode switch');
}

// 16. Client Deny List cannot be selected
{
  useHostStore.getState().reset();
  for (const denied of CLIENT_DENY_LIST) {
    useHostStore.getState().setMode(denied);
    assert.notEqual(useHostStore.getState().mode, denied, `Denied mode ${denied} was rejected`);
  }
  console.log('PASS 16: Client deny list strictly enforced in host store');
}

console.log('\nAll 16 wizard payload & compatibility snapshot checks passed.');

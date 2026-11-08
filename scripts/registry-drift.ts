import { createClient } from '@supabase/supabase-js';
import { CLIENT_DENY_LIST, getShippingRegistry } from '../src/modes/registry';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(url, anonKey);

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS ${message}`);
}

async function runDriftCheck() {
  console.log('\n--- Registry Drift Audit vs Server Catalogues ---\n');

  // Authenticate temporary test session to invoke get_mode_registry
  const testEmail = `drift-check-${Date.now()}@ghostrun.test`;
  const { error: signUpError } = await supabase.auth.signUp({
    email: testEmail,
    password: 'password123',
  });
  if (signUpError) {
    console.error('Failed to create test session:', signUpError);
    process.exit(1);
  }

  // Fetch server-authoritative catalogue snapshot
  const { data: serverRegistry, error: rpcError } = await supabase.rpc('get_mode_registry');
  if (rpcError || !serverRegistry) {
    console.error('Failed to query get_mode_registry:', rpcError);
    process.exit(1);
  }

  const clientRegistry = getShippingRegistry();
  const clientBaseModes = new Map(clientRegistry.modes.map((m) => [m.id, m]));
  const clientModifiers = new Map(clientRegistry.modifiers.map((m) => [m.id, m]));
  const clientRoles = new Map(clientRegistry.roles.map((r) => [r.id, r]));

  // 1. Assert Deny List Integrity
  assert(CLIENT_DENY_LIST.has('haunted_map'), 'haunted_map is in client deny list');
  assert(CLIENT_DENY_LIST.has('horde'), 'horde is in client deny list');
  assert(CLIENT_DENY_LIST.has('manhunt'), 'manhunt is in client deny list');
  assert(CLIENT_DENY_LIST.has('qr_tagging'), 'qr_tagging is in client deny list');

  for (const deniedId of CLIENT_DENY_LIST) {
    assert(
      !clientBaseModes.has(deniedId),
      `denied mode ${deniedId} is not in shipping base modes`,
    );
    assert(
      !clientModifiers.has(deniedId),
      `denied modifier ${deniedId} is not in shipping modifiers`,
    );
  }

  // 2. Base Modes Verification
  const serverModes = (serverRegistry.modes || []).filter(
    (m: { enabled: boolean; id: string }) => m.enabled && !CLIENT_DENY_LIST.has(m.id),
  );

  for (const sMode of serverModes) {
    const cMode = clientBaseModes.get(sMode.id);
    assert(Boolean(cMode), `server base mode ${sMode.id} exists in client registry`);
    if (!cMode) continue;

    assert(
      cMode.name.toLowerCase() === sMode.name.toLowerCase(),
      `base mode ${sMode.id} name matches (${cMode.name})`,
    );
    assert(
      cMode.minPlayers === sMode.min_players,
      `base mode ${sMode.id} min_players matches server (${cMode.minPlayers} === ${sMode.min_players})`,
    );

    // Assert parameter parity
    const serverParamKeys = Object.keys(sMode.parameters || {});
    const clientParamKeys = cMode.params.map((p) => p.key);
    for (const pKey of serverParamKeys) {
      assert(
        clientParamKeys.includes(pKey),
        `base mode ${sMode.id} parameter ${pKey} is defined in client`,
      );
    }
  }

  // 3. Modifiers Verification
  const serverModifiers = (serverRegistry.modifiers || []).filter(
    (m: { enabled: boolean; id: string }) => m.enabled && !CLIENT_DENY_LIST.has(m.id),
  );

  for (const sMod of serverModifiers) {
    const cMod = clientModifiers.get(sMod.id);
    assert(Boolean(cMod), `server modifier ${sMod.id} exists in client registry`);
    if (!cMod) continue;

    const serverParamKeys = Object.keys(sMod.parameters || {});
    const clientParamKeys = cMod.params.map((p) => p.key);
    for (const pKey of serverParamKeys) {
      assert(
        clientParamKeys.includes(pKey),
        `modifier ${sMod.id} parameter ${pKey} is defined in client`,
      );
    }
  }

  // 4. Roles Verification
  const serverRoles = (serverRegistry.roles || []).filter(
    (r: { enabled: boolean; id: string }) => r.enabled,
  );

  for (const sRole of serverRoles) {
    const cRole = clientRoles.get(sRole.id);
    assert(Boolean(cRole), `server role ${sRole.id} exists in client registry`);
  }

  console.log('\nAll registry drift checks passed.\n');
}

runDriftCheck().catch((err) => {
  console.error('Unexpected error during registry drift check:', err);
  process.exit(1);
});

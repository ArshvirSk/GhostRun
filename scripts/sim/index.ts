/**
 * GhostRun v2 simulator (desk testing without phones).
 *
 * Creates throwaway email/password players against the configured Supabase
 * project and drives server RPCs like a client would. Scenarios are named so
 * later milestones can add one per rule:
 *
 *   npx tsx scripts/sim/index.ts mode-framework
 *   npx tsx scripts/sim/index.ts            (runs every scenario)
 *
 * Requires "Confirm email" off (sign-up must return a session) or
 * SUPABASE_SERVICE_ROLE_KEY to mint pre-confirmed accounts. In v2 it is the
 * harness the milestone acceptance criteria run through.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL and/or EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}

const CENTER = { lat: 37.7749, lng: -122.4194 };
const failures: string[] = [];

function pass(label: string) {
  console.log(`PASS ${label}`);
}

function fail(label: string, detail: string) {
  failures.push(`${label}: ${detail}`);
  console.error(`FAIL ${label} (${detail})`);
}

function expect(condition: boolean, label: string, detail: string) {
  if (condition) pass(label);
  else fail(label, detail);
}

function publicClient() {
  return createClient(url!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function newPlayer(displayName: string): Promise<SupabaseClient> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `sim-${displayName.toLowerCase()}-${suffix}@ghostrun.test`;
  const password = `sim-${Math.random().toString(36).slice(2)}-${suffix}`;
  const client = publicClient();

  if (serviceRoleKey) {
    const admin = createClient(url!, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`Admin create failed: ${error.message}`);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);
  } else {
    const { error } = await client.auth.signUp({ email, password });
    if (error) throw new Error(`Sign-up failed: ${error.message}`);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) {
      throw new Error(
        `Sign-in after sign-up failed (${signInError.message}). Turn off "Confirm email" or set SUPABASE_SERVICE_ROLE_KEY.`,
      );
    }
  }

  const { error: profileError } = await client.rpc('upsert_profile', {
    name: displayName,
    color: '#1D4ED8',
  });
  if (profileError) throw new Error(`Profile failed: ${profileError.message}`);
  return client;
}

async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
  return client.rpc(fn, args) as unknown as { data: T | null; error: { message: string } | null };
}

async function playerId(client: SupabaseClient, gameId: string): Promise<string> {
  const { data: user } = await client.auth.getUser();
  const { data, error } = await client
    .from('players')
    .select('id')
    .eq('game_id', gameId)
    .eq('user_id', user.user?.id ?? '')
    .single();
  if (error || !data?.id) throw new Error(`Could not read player row: ${error?.message ?? 'missing'}`);
  return data.id as string;
}

/** Scripted: config validation and flag gating on game creation. */
async function modeFrameworkScenario() {
  console.log('\n--- mode framework ---');
  const host = await newPlayer('SimHost');
  const hunter = await newPlayer('SimHunter');

  const create = (settings: Record<string, unknown>) =>
    rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
      mode: 'classic_chase',
      lat: CENTER.lat,
      lng: CENTER.lng,
      radius_m: 600,
      settings,
    });

  const incompatible = await rpc<unknown>(host, 'create_game', {
    mode: 'tag_hunt',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: { roles: ['vip'] },
  });
  expect(
    Boolean(incompatible.error) && /cannot be combined/i.test(incompatible.error?.message ?? ''),
    'an incompatible role and mode are rejected',
    String(incompatible.error?.message ?? 'call unexpectedly succeeded'),
  );

  const unknown = await create({ modifiers: ['teleport'] });
  expect(
    Boolean(unknown.error) && /unknown modifier/i.test(unknown.error?.message ?? ''),
    'an unknown modifier is rejected',
    String(unknown.error?.message ?? 'call unexpectedly succeeded'),
  );

  const duplicate = await create({ modifiers: ['noise_meter', 'noise_meter'] });
  expect(
    Boolean(duplicate.error) && /only be chosen once/i.test(duplicate.error?.message ?? ''),
    'a duplicate modifier is rejected',
    String(duplicate.error?.message ?? 'call unexpectedly succeeded'),
  );

  const flagOff = await create({ modifiers: ['noise_meter'] });
  expect(
    Boolean(flagOff.error) && /not available yet/i.test(flagOff.error?.message ?? ''),
    'a valid but disabled modifier is rejected until its flag is on',
    String(flagOff.error?.message ?? 'call unexpectedly succeeded'),
  );

  const valid = await create({});
  if (valid.error || !valid.data?.[0]?.game_id) {
    fail('a default game can be created', String(valid.error?.message ?? 'no game returned'));
    return;
  }
  pass('a default game can be created');
  const gameId = valid.data[0].game_id;

  const joined = await rpc<string>(hunter, 'join_game', { code: valid.data[0].code });
  if (joined.error) throw new Error(`join failed: ${joined.error.message}`);
  await rpc(host, 'set_team', {
    game_id: gameId,
    player_id: await playerId(host, gameId),
    team: 'runner',
  });
  await rpc(hunter, 'set_team', {
    game_id: gameId,
    player_id: await playerId(hunter, gameId),
    team: 'hunter',
  });

  const registry = await rpc<{ modes: { id: string; enabled: boolean }[]; modifiers: { id: string; enabled: boolean }[] }>(
    host,
    'get_mode_registry',
    {},
  );
  expect(
    Array.isArray(registry.data?.modes) &&
      registry.data!.modes.some((mode) => mode.id === 'classic_chase' && mode.enabled),
    'the registry exposes enabled base modes',
    JSON.stringify(registry.error?.message ?? registry.data),
  );
  expect(
    Array.isArray(registry.data?.modifiers) &&
      registry.data!.modifiers.every((modifier) => !modifier.enabled),
    'unimplemented modifiers stay disabled',
    JSON.stringify(registry.data?.modifiers),
  );

  // Lobby-side mode setup also validates: a known-but-disabled modifier fails,
  // and an empty configuration saves cleanly.
  const badSave = await rpc(host, 'set_game_modes', {
    game_id: gameId,
    modifiers: ['hot_cold'],
    roles: [],
    mode_params: {},
  });
  expect(
    Boolean(badSave.error) && /not available yet/i.test(badSave.error?.message ?? ''),
    'set_game_modes rejects a disabled modifier',
    String(badSave.error?.message ?? 'call unexpectedly succeeded'),
  );
  const goodSave = await rpc(host, 'set_game_modes', {
    game_id: gameId,
    modifiers: [],
    roles: [],
    mode_params: {},
  });
  expect(!goodSave.error, 'set_game_modes saves an empty configuration', String(goodSave.error?.message ?? ''));

  const outsider = await newPlayer('SimOutsider');
  const outsiderSave = await rpc(outsider, 'set_game_modes', {
    game_id: gameId,
    modifiers: [],
    roles: [],
    mode_params: {},
  });
  expect(
    Boolean(outsiderSave.error),
    'a non-host cannot change the mode setup',
    'call unexpectedly succeeded',
  );

  for (const client of [host, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

const SCENARIOS: Record<string, () => Promise<void>> = {
  'mode-framework': modeFrameworkScenario,
};

async function main() {
  const requested = process.argv[2];
  const names = requested ? [requested] : Object.keys(SCENARIOS);
  for (const name of names) {
    const scenario = SCENARIOS[name];
    if (!scenario) throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}`);
    await scenario();
  }

  console.log('\n--- summary ---');
  if (failures.length === 0) {
    console.log('All simulator checks passed.');
  } else {
    console.log(`${failures.length} check(s) failed:`);
    for (const failure of failures) console.log(`- ${failure}`);
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

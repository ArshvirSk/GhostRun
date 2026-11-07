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
  if (error || !data?.id)
    throw new Error(`Could not read player row: ${error?.message ?? 'missing'}`);
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
    mode: 'assassin_ring',
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

  const flagOff = await create({ modifiers: ['qr_tagging'] });
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

  const registry = await rpc<{
    modes: { id: string; enabled: boolean }[];
    modifiers: { id: string; enabled: boolean }[];
  }>(host, 'get_mode_registry', {});
  expect(
    Array.isArray(registry.data?.modes) &&
      registry.data!.modes.some((mode) => mode.id === 'classic_chase' && mode.enabled),
    'the registry exposes enabled base modes',
    JSON.stringify(registry.error?.message ?? registry.data),
  );
  const enabled = new Set(
    (registry.data?.modifiers ?? []).filter((modifier) => modifier.enabled).map((m) => m.id),
  );
  expect(
    enabled.has('noise_meter') &&
      enabled.has('dead_drops') &&
      enabled.has('shrinking_zone') &&
      enabled.has('hot_cold'),
    'the implemented modifiers are enabled in the registry',
    JSON.stringify([...enabled]),
  );
  expect(
    !enabled.has('qr_tagging'),
    'unimplemented modifiers stay disabled',
    JSON.stringify([...enabled]),
  );

  // Lobby-side mode setup also validates: a known-but-disabled modifier fails,
  // and an empty configuration saves cleanly.
  const badSave = await rpc(host, 'set_game_modes', {
    game_id: gameId,
    modifiers: ['qr_tagging'],
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
  expect(
    !goodSave.error,
    'set_game_modes saves an empty configuration',
    String(goodSave.error?.message ?? ''),
  );

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPhase(
  client: SupabaseClient,
  gameId: string,
  phases: string[],
  timeoutMs = 25000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data } = await rpc<{ game: { status: string } }>(client, 'get_game_state', {
      game_id: gameId,
    });
    if (data && phases.includes(data.game.status)) return data.game.status;
    await sleep(1000);
  }
  return null;
}

/** Scripted: Noise Meter, Dead Drops and the Shrinking Zone. */
async function modifiersScenario() {
  console.log('\n--- modifiers ---');
  const host = await newPlayer('SimRunner');
  const hunter = await newPlayer('SimHunter');
  const admin = serviceRoleKey
    ? createClient(url!, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'tag_hunt',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      modifiers: ['noise_meter', 'dead_drops', 'shrinking_zone'],
      head_start_s: 0,
      duration_s: 300,
      ping_interval_s: 30,
    },
  });
  if (created.error || !created.data?.[0]?.game_id) {
    fail('a game with M3 modifiers is created', String(created.error?.message ?? 'no game'));
    return;
  }
  pass('a game with M3 modifiers is created');
  const gameId = created.data[0].game_id;

  const joined = await rpc<unknown>(hunter, 'join_game', { code: created.data[0].code });
  if (joined.error) {
    fail('the second player joins', joined.error.message);
    return;
  }
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
  for (const client of [host, hunter]) {
    await rpc(client, 'set_share_trail', { game_id: gameId, share: true });
  }

  const started = await rpc<unknown>(host, 'start_game', { game_id: gameId });
  if (started.error) {
    fail('the modifier round starts', started.error.message);
    return;
  }
  const live = await waitForPhase(host, gameId, ['live']);
  expect(live === 'live', 'the round reaches live', String(live));
  if (live !== 'live') return;

  const firstState = await rpc<{
    game: {
      area: { radius_m: number; base_radius_m: number; shrinking: boolean; zone_stage: number };
    };
  }>(host, 'get_game_state', { game_id: gameId });
  expect(
    firstState.data?.game.area.shrinking === true &&
      firstState.data?.game.area.radius_m === firstState.data?.game.area.base_radius_m,
    'the zone starts at full size',
    JSON.stringify(firstState.data?.game.area),
  );

  // Noise: moving at 5 m/s raises the bar and is readable only by the owner.
  let lastNoise = 0;
  for (let i = 0; i < 3; i += 1) {
    const upload = await rpc<{ noise: number }>(host, 'submit_position', {
      game_id: gameId,
      lat: CENTER.lat + i * 0.00002,
      lng: CENTER.lng,
      accuracy: 5,
      speed: 5,
      is_mock: true,
    });
    lastNoise = upload.data?.noise ?? 0;
    await sleep(1100);
  }
  expect(lastNoise > 0, 'moving raises the runner noise bar', `noise=${lastNoise}`);

  const myStatus = await rpc<{ noise: number; noise_enabled: boolean; drops_enabled: boolean }>(
    host,
    'get_my_status',
    { game_id: gameId },
  );
  expect(
    myStatus.data?.noise_enabled === true && myStatus.data?.drops_enabled === true,
    'get_my_status reports the active modifiers',
    JSON.stringify(myStatus.error?.message ?? myStatus.data),
  );
  expect(
    (myStatus.data?.noise ?? 0) > 0,
    'the owner reads their own noise value',
    JSON.stringify(myStatus.data),
  );

  const nearby = await rpc<{ range_m: number; drops: unknown[] }>(host, 'nearby_drops', {
    game_id: gameId,
  });
  expect(
    nearby.data?.range_m === 40 && Array.isArray(nearby.data?.drops),
    'nearby_drops returns the 40 m reveal envelope',
    JSON.stringify(nearby.error?.message ?? nearby.data),
  );

  const outsider = await newPlayer('SimOutsider');
  const outsiderDrops = await rpc<unknown>(outsider, 'nearby_drops', { game_id: gameId });
  expect(
    Boolean(outsiderDrops.error),
    'an outsider cannot reveal drops',
    'call unexpectedly succeeded',
  );

  const qrOff = await rpc<unknown>(host, 'qr_token', { game_id: gameId });
  expect(
    Boolean(qrOff.error) && /qr tagging/i.test(qrOff.error?.message ?? ''),
    'QR tokens are refused when the modifier is off',
    String(qrOff.error?.message ?? 'call unexpectedly succeeded'),
  );

  if (!admin) {
    console.log('SKIP drop and zone checks need SUPABASE_SERVICE_ROLE_KEY');
  } else {
    const drops = await admin
      .from('entities')
      .select('id')
      .eq('game_id', gameId)
      .eq('kind', 'drop');
    expect(
      drops.data?.length === 6,
      'six drops spawn when the round goes live',
      JSON.stringify(drops.error?.message ?? drops.data?.length),
    );

    // Time travel the round to its last tenth so the zone stages have run.
    await admin
      .from('games')
      .update({
        live_at: new Date(Date.now() - 280_000).toISOString(),
        ends_at: new Date(Date.now() + 300_000).toISOString(),
      })
      .eq('id', gameId);

    const zoneState = await rpc<{
      game: { area: { radius_m: number; base_radius_m: number; zone_stage: number } };
      events: { type: string }[];
    }>(host, 'get_game_state', { game_id: gameId });
    const area = zoneState.data?.game.area;
    expect(
      Boolean(area) && area!.radius_m < area!.base_radius_m && area!.zone_stage >= 2,
      'the effective radius shrinks near the end of the round',
      JSON.stringify(area),
    );
    expect(
      (zoneState.data?.events ?? []).some((event) => event.type === 'zone_shrunk'),
      'a zone shrink is announced in the activity feed',
      JSON.stringify((zoneState.data?.events ?? []).map((event) => event.type)),
    );
  }

  for (const client of [host, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

/** Scripted: Hot & Cold Hunt modifier checks (Variant A proximity, Variant B trend, cooldowns, secrecy). */
async function hotColdScenario() {
  console.log('\n--- hot & cold hunt ---');

  const host = await newPlayer('SimHCHost');
  const hunter = await newPlayer('SimHCHunter');
  const outsider = await newPlayer('SimHCOutsider');

  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'tag_hunt',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 500,
    settings: {
      modifiers: ['hot_cold'],
      head_start_s: 0,
      duration_s: 600,
      ping_interval_s: 60,
      mode_params: {
        hot_cold: {
          variant: 'proximity',
          heat_charges: 6,
          cooldown_s: 2,
          radius_m: 150,
        },
      },
    },
  });

  const gameId = created.data?.[0]?.game_id;
  const code = created.data?.[0]?.code;
  if (!gameId || !code) throw new Error(`Create failed: ${created.error?.message ?? 'no id'}`);

  await rpc<unknown>(hunter, 'join_game', { code });
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
  for (const client of [host, hunter]) {
    await rpc(client, 'set_share_trail', { game_id: gameId, share: true });
  }

  const started = await rpc<unknown>(host, 'start_game', { game_id: gameId });
  expect(!started.error, 'game with Hot & Cold starts cleanly', started.error?.message ?? 'ok');

  const live = await waitForPhase(host, gameId, ['live']);
  expect(live === 'live', 'the round reaches live', String(live));
  if (live !== 'live') return;

  // Verify ping_interval_s was multiplied by 3 (60 -> 180)
  const state = await rpc<{ game: { ping_interval_s: number; status: string } }>(
    hunter,
    'get_game_state',
    { game_id: gameId },
  );
  expect(
    state.data?.game.ping_interval_s === 180,
    'Hot & Cold triples the scheduled ping interval',
    String(state.data?.game.ping_interval_s),
  );

  // Runner calling heat_press is rejected
  const runnerPress = await rpc<{ result: string }>(host, 'heat_press', { game_id: gameId });
  expect(
    Boolean(runnerPress.error) && /only hunters/i.test(runnerPress.error?.message ?? ''),
    'runners cannot use HEAT',
    runnerPress.error?.message ?? 'unexpected success',
  );

  // Hunter calling heat_press before uploading position returns stale_position
  const stalePress = await rpc<{ result: string; charges_left: number }>(hunter, 'heat_press', {
    game_id: gameId,
  });
  expect(
    stalePress.data?.result === 'stale_position',
    'HEAT returns stale_position when hunter has no fresh fix',
    JSON.stringify(stalePress.data ?? stalePress.error?.message),
  );

  // Hunter uploads position at center
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  // Runner uploads position 50 m from hunter (within 150 m radius)
  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.00045,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  // Hunter presses HEAT -> returns 'hot'
  const hotPress = await rpc<{ result: string; charges_left: number }>(hunter, 'heat_press', {
    game_id: gameId,
  });
  expect(
    hotPress.data?.result === 'hot' && hotPress.data?.charges_left === 5,
    'HEAT returns hot when a runner is within heat radius and spends 1 charge',
    JSON.stringify(hotPress.data ?? hotPress.error?.message),
  );

  // Immediate re-press fails personal cooldown
  const cooldownPress = await rpc<{ result: string }>(hunter, 'heat_press', { game_id: gameId });
  expect(
    Boolean(cooldownPress.error) && /cooldown/i.test(cooldownPress.error?.message ?? ''),
    'HEAT enforces personal cooldown',
    cooldownPress.error?.message ?? 'unexpected success',
  );

  // Check hunter sees heat mark in feed view
  const { data: feedMarks } = await hunter
    .from('heat_press_feed')
    .select('*')
    .eq('game_id', gameId);
  expect(
    (feedMarks?.length ?? 0) >= 1 && feedMarks?.[0]?.result === 'hot',
    'hunter sees the mark in heat_press_feed view',
    JSON.stringify(feedMarks),
  );
  expect(
    feedMarks?.[0] && !('nearest_runner_m' in feedMarks[0]),
    'heat_press_feed does not expose nearest_runner_m',
    JSON.stringify(feedMarks?.[0]),
  );

  // Runner and outsider cannot see marks in heat_press_feed
  const { data: runnerFeed } = await host.from('heat_press_feed').select('*').eq('game_id', gameId);
  expect(
    (runnerFeed?.length ?? 0) === 0,
    'runner cannot see marks in heat_press_feed',
    JSON.stringify(runnerFeed),
  );

  const { data: outsiderFeed } = await outsider
    .from('heat_press_feed')
    .select('*')
    .eq('game_id', gameId);
  expect(
    (outsiderFeed?.length ?? 0) === 0,
    'outsider cannot see marks in heat_press_feed',
    JSON.stringify(outsiderFeed),
  );

  // Base table heat_presses is locked during play
  const { data: basePresses } = await hunter.from('heat_presses').select('*').eq('game_id', gameId);
  expect(
    (basePresses?.length ?? 0) === 0,
    'heat_presses base table is unreadable during live play',
    JSON.stringify(basePresses),
  );

  // Check events for hunter and runner:
  // Hunter receives heat_mark event
  const hunterState = await rpc<{ events: { type: string; payload?: { result?: string } }[] }>(
    hunter,
    'get_game_state',
    { game_id: gameId },
  );
  const hunterEvents = hunterState.data?.events ?? [];
  expect(
    hunterEvents.some((e) => e.type === 'heat_mark' && e.payload?.result === 'hot'),
    'hunter receives heat_mark event with result',
    JSON.stringify(hunterEvents.map((e) => e.type)),
  );

  // Runner receives heat_used (without result) and sensed pulse event
  const runnerState = await rpc<{ events: { type: string; payload?: Record<string, unknown> }[] }>(
    host,
    'get_game_state',
    { game_id: gameId },
  );
  const runnerEvents = runnerState.data?.events ?? [];
  expect(
    runnerEvents.some((e) => e.type === 'heat_used'),
    'runner receives heat_used announcement',
    JSON.stringify(runnerEvents.map((e) => e.type)),
  );
  expect(
    runnerEvents.some((e) => e.type === 'sensed'),
    'runner receives sensed pulse when within heat radius',
    JSON.stringify(runnerEvents.map((e) => e.type)),
  );
  expect(
    !runnerEvents.some((e) => e.type === 'heat_mark'),
    'runner does not receive heat_mark event',
    'runner leaked heat_mark',
  );

  // Wait for cooldown (2 s)
  await new Promise((r) => setTimeout(r, 2200));

  // Runner moves far away (350 m away from hunter)
  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.0035,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  // Hunter refreshes position
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  // Hunter presses again -> returns 'cold'
  const coldPress = await rpc<{ result: string; charges_left: number }>(hunter, 'heat_press', {
    game_id: gameId,
  });
  expect(
    coldPress.data?.result === 'cold' && coldPress.data?.charges_left === 4,
    'HEAT returns cold when runners are outside heat radius',
    JSON.stringify(coldPress.data ?? coldPress.error?.message),
  );

  for (const client of [host, hunter, outsider]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

async function doubleAgentScenario() {
  console.log('\n--- double agent ---');
  const host = await newPlayer('DA-Host');
  const hunter1 = await newPlayer('DA-Hunter1');
  const hunter2 = await newPlayer('DA-Hunter2');

  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'classic_chase',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      roles: ['double_agent'],
      duration_s: 1800,
      head_start_s: 0,
      ping_interval_s: 30,
    },
  });
  const game = created.data?.[0];
  if (!game?.game_id) throw new Error(`Game creation failed: ${created.error?.message}`);
  const gameId = game.game_id;
  const code = game.code;

  await rpc(hunter1, 'join_game', { code });
  await rpc(hunter2, 'join_game', { code });

  await rpc(host, 'set_team', {
    game_id: gameId,
    player_id: await playerId(host, gameId),
    team: 'runner',
  });
  await rpc(hunter1, 'set_team', {
    game_id: gameId,
    player_id: await playerId(hunter1, gameId),
    team: 'hunter',
  });
  await rpc(hunter2, 'set_team', {
    game_id: gameId,
    player_id: await playerId(hunter2, gameId),
    team: 'hunter',
  });

  for (const client of [host, hunter1, hunter2]) {
    await rpc(client, 'set_share_trail', { game_id: gameId, share: true });
    await rpc(client, 'set_ready', { game_id: gameId, ready: true });
  }

  await rpc(host, 'begin_target_selection', { game_id: gameId });
  await rpc(host, 'set_target', {
    game_id: gameId,
    lat: CENTER.lat + 0.002,
    lng: CENTER.lng,
  });

  for (const client of [host, hunter1, hunter2]) {
    await rpc(client, 'set_ready', { game_id: gameId, ready: true });
  }

  const startRes = await rpc<{ status: string }>(host, 'start_game', { game_id: gameId });
  expect(
    !startRes.error && startRes.data?.status === 'countdown',
    'game with Double Agent starts cleanly',
    JSON.stringify(startRes.data ?? startRes.error?.message),
  );

  await new Promise((r) => setTimeout(r, 11000));
  await rpc(host, 'advance_game', { game_id: gameId });

  const role1 = await rpc<{ role: string | null }>(hunter1, 'get_my_role', { game_id: gameId });
  const role2 = await rpc<{ role: string | null }>(hunter2, 'get_my_role', { game_id: gameId });

  const h1IsAgent = role1.data?.role === 'agent';
  const h2IsAgent = role2.data?.role === 'agent';

  expect(
    (h1IsAgent && !h2IsAgent) || (!h1IsAgent && h2IsAgent),
    'exactly one hunter is secretly assigned as Double Agent',
    `h1: ${role1.data?.role}, h2: ${role2.data?.role}`,
  );

  const agent = h1IsAgent ? hunter1 : hunter2;
  const loyalHunter = h1IsAgent ? hunter2 : hunter1;

  const whisper = await rpc<{ quadrant: string }>(agent, 'agent_whisper', { game_id: gameId });
  expect(
    whisper.data?.quadrant === 'North',
    'Whisper reveals correct cardinal quadrant of target',
    JSON.stringify(whisper.data ?? whisper.error?.message),
  );

  const repeatWhisper = await rpc(agent, 'agent_whisper', { game_id: gameId });
  expect(
    Boolean(repeatWhisper.error),
    'Whisper cannot be used twice',
    'call unexpectedly succeeded',
  );

  const loyalWhisper = await rpc(loyalHunter, 'agent_whisper', { game_id: gameId });
  expect(
    Boolean(loyalWhisper.error),
    'loyal hunter cannot use Whisper',
    'call unexpectedly succeeded',
  );

  const hostState = await rpc<{ players: { id: string; team: string }[] }>(
    host,
    'get_game_state',
    { game_id: gameId },
  );
  const runnerId = hostState.data!.players.find((p) => p.team === 'runner')!.id;

  const scramble = await rpc<{ success: boolean }>(agent, 'agent_scramble', {
    game_id: gameId,
    runner_id: runnerId,
  });
  expect(
    scramble.data?.success === true,
    'Scramble is armed on chosen runner',
    JSON.stringify(scramble.data ?? scramble.error?.message),
  );

  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const agentStatus = await rpc<{ player_id: string }>(agent, 'get_my_status', { game_id: gameId });
  const agentId = agentStatus.data!.player_id;

  const tribunalStart = await rpc<{ tribunal_id: string; status: string }>(
    loyalHunter,
    'start_tribunal',
    {
      game_id: gameId,
      accused_hunter_id: agentId,
    },
  );
  expect(
    !tribunalStart.error,
    'loyal hunter can convene tribunal against suspect',
    JSON.stringify(tribunalStart.data ?? tribunalStart.error?.message),
  );

  const voteRes = await rpc<{ status: string; outcome: string; was_agent: boolean }>(
    agent,
    'cast_vote',
    {
      game_id: gameId,
      vote: true,
    },
  );
  expect(
    voteRes.data?.outcome === 'ejected' && voteRes.data?.was_agent === true,
    'majority tribunal vote ejects the Double Agent with bonus ping',
    JSON.stringify(voteRes.data ?? voteRes.error?.message),
  );

  for (const client of [host, hunter1, hunter2]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

async function recapStatsScenario() {
  console.log('\n--- recap stats ---');
  const host = await newPlayer('Recap-Host');
  const hunter = await newPlayer('Recap-Hunter');

  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'tag_hunt',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      duration_s: 1800,
      head_start_s: 0,
      ping_interval_s: 30,
    },
  });
  const game = created.data?.[0];
  if (!game?.game_id) throw new Error(`Game creation failed: ${created.error?.message}`);
  const gameId = game.game_id;
  const code = game.code;

  await rpc(hunter, 'join_game', { code });
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

  await rpc(host, 'set_share_trail', { game_id: gameId, share: true });
  await rpc(hunter, 'set_share_trail', { game_id: gameId, share: false });

  await rpc(host, 'set_ready', { game_id: gameId, ready: true });
  await rpc(hunter, 'set_ready', { game_id: gameId, ready: true });

  await rpc(host, 'start_game', { game_id: gameId });
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(host, 'advance_game', { game_id: gameId });

  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  await rpc(hunter, 'attempt_tag', { game_id: gameId });

  const stats = await rpc<{
    winner: string;
    players: {
      player_id: string;
      share_trail: boolean | null;
      closest_call_m: number | null;
      loudest_noise: number;
    }[];
  }>(host, 'get_game_stats', { game_id: gameId });

  expect(
    !stats.error && stats.data?.winner === 'hunters',
    'get_game_stats returns completed game summary',
    JSON.stringify(stats.data ?? stats.error?.message),
  );

  const runnerStat = stats.data?.players.find((p) => p.share_trail === true);
  const hunterStat = stats.data?.players.find((p) => p.share_trail === false);

  expect(
    hunterStat !== undefined && hunterStat.closest_call_m === null,
    'private route player has null closest_call_m in stats',
    JSON.stringify(hunterStat),
  );
  expect(
    typeof runnerStat?.loudest_noise === 'number',
    'recap stats include loudest noise value',
    JSON.stringify(runnerStat),
  );

  for (const client of [host, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

/** Scripted: v2.2 Haunted Map & Ghost NPC simulation engine. */
async function hauntedMapScenario() {
  console.log('\n--- Scenario: haunted-map (v2.2 Haunted Map & Ghost NPCs) ---');
  const host = await newPlayer('HauntHost');
  const hunter = await newPlayer('HauntHunter');

  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'haunted_map',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: { head_start_s: 0, duration_s: 300, ping_interval_s: 30 },
  });

  if (created.error || !created.data?.[0]?.game_id) {
    throw new Error(`haunted_map create failed: ${created.error?.message}`);
  }
  const gameId = created.data[0].game_id;

  const joined = await rpc<string>(hunter, 'join_game', { code: created.data[0].code });
  if (joined.error || joined.data !== gameId) {
    throw new Error(`hunter join failed: ${joined.error?.message}`);
  }

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

  await rpc(host, 'set_share_trail', { game_id: gameId, share: true });
  await rpc(hunter, 'set_share_trail', { game_id: gameId, share: true });

  await rpc(host, 'set_ready', { game_id: gameId, ready: true });
  await rpc(hunter, 'set_ready', { game_id: gameId, ready: true });

  const startRes = await rpc<Record<string, unknown>>(host, 'start_game', { game_id: gameId });
  expect(
    !startRes.error && startRes.data?.status === 'countdown',
    'Haunted Map game starts successfully in countdown',
    String(startRes.error?.message ?? startRes.data?.status),
  );

  // Fast forward past countdown to live
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(host, 'advance_game', { game_id: gameId });

  // 1. Verify ghosts_spawned event
  const events = (await host.from('events').select('*').eq('game_id', gameId)).data ?? [];
  expect(
    events.some((e) => e.type === 'ghosts_spawned'),
    'ghosts_spawned event emitted to players',
    JSON.stringify(events.map((e) => e.type)),
  );

  // Step the simulation to advance ghost positions along paths
  await rpc(host, 'advance_game', { game_id: gameId });

  // 2. Submit runner position near Ghost 1's interpolated position along synthetic loop
  // Ghost 1 starts along synthetic loop at offset 0 deg (CENTER.lat, CENTER.lng + 0.00375)
  const ghostEstimateLat = CENTER.lat;
  const ghostEstimateLng = CENTER.lng + 0.00375;

  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: ghostEstimateLat,
    lng: ghostEstimateLng,
    accuracy: 3,
    recorded_at: new Date().toISOString(),
  });

  // 3. Test nearby_entities
  const runnerNearby = await rpc<
    { id: string; kind: string; latitude: number; longitude: number; distance_m: number }[]
  >(host, 'nearby_entities', { game_id: gameId });

  expect(
    !runnerNearby.error && Array.isArray(runnerNearby.data),
    'runner can query nearby_entities for ghost blips',
    JSON.stringify(runnerNearby.data ?? runnerNearby.error),
  );

  const hunterNearby = await rpc<unknown[]>(hunter, 'nearby_entities', { game_id: gameId });
  expect(
    !hunterNearby.error && Array.isArray(hunterNearby.data) && hunterNearby.data.length === 0,
    'hunter receives zero raw ghost entities from nearby_entities',
    JSON.stringify(hunterNearby.data ?? hunterNearby.error),
  );

  // 4. Test haunted tag interaction with 3-second dwell requirement (Milestone S1 / D3)
  // If ghost was detected by runner within 80m, submit exact position at ghost
  if (runnerNearby.data && runnerNearby.data.length > 0) {
    const detected = runnerNearby.data[0];
    await rpc(host, 'submit_position', {
      game_id: gameId,
      lat: detected.latitude,
      lng: detected.longitude,
      accuracy: 2,
      recorded_at: new Date().toISOString(),
    });
  }

  // First tick: starts dwell timer, runner should NOT be tagged yet
  await rpc(host, 'advance_game', { game_id: gameId });

  let updatedEvents = (await host.from('events').select('*').eq('game_id', gameId)).data ?? [];
  let hasHauntedTag = updatedEvents.some(
    (e) => e.type === 'runner_tagged' && e.payload?.by === 'ghost',
  );
  expect(
    !hasHauntedTag,
    'ghost does not tag runner without 3-second continuous dwell',
    'tagged prematurely without 3s dwell',
  );

  // Continuous dwell: submit runner positions tracking the moving ghost each second for 4 seconds
  for (let s = 0; s < 4; s++) {
    await new Promise((r) => setTimeout(r, 1000));
    const refreshedNearby = await rpc<
      { id: string; kind: string; latitude: number; longitude: number; distance_m: number }[]
    >(host, 'nearby_entities', { game_id: gameId });
    if (refreshedNearby.data && refreshedNearby.data.length > 0) {
      const currentGhost = refreshedNearby.data[0];
      await rpc(host, 'submit_position', {
        game_id: gameId,
        lat: currentGhost.latitude,
        lng: currentGhost.longitude,
        accuracy: 2,
        recorded_at: new Date().toISOString(),
      });
    }
    await rpc(host, 'advance_game', { game_id: gameId });
  }

  updatedEvents = (await host.from('events').select('*').eq('game_id', gameId)).data ?? [];
  hasHauntedTag = updatedEvents.some(
    (e) => e.type === 'runner_tagged' && e.payload?.by === 'ghost',
  );
  expect(
    hasHauntedTag,
    'ghost tags runner within 12m with haunted tag event',
    JSON.stringify(updatedEvents.map((e) => e.payload ?? e.type)),
  );

  for (const client of [host, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

/** Scripted: v2.2 Ghost Library contribution, preview, listing, and deletion. */
async function ghostContributionScenario() {
  console.log('\n--- Scenario: ghost-contribution (v2.2 Ghost Library & Trimming) ---');
  const host = await newPlayer('GhostRunner');
  const hunter = await newPlayer('GhostTagger');

  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'tag_hunt',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: { head_start_s: 0, duration_s: 300, ping_interval_s: 30 },
  });

  if (created.error || !created.data?.[0]?.game_id) {
    throw new Error(`tag_hunt create failed: ${created.error?.message}`);
  }
  const gameId = created.data[0].game_id;

  await rpc(hunter, 'join_game', { code: created.data[0].code });

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

  await rpc(host, 'set_share_trail', { game_id: gameId, share: true });
  await rpc(hunter, 'set_share_trail', { game_id: gameId, share: true });

  await rpc(host, 'set_ready', { game_id: gameId, ready: true });
  await rpc(hunter, 'set_ready', { game_id: gameId, ready: true });

  await rpc(host, 'start_game', { game_id: gameId });
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(host, 'advance_game', { game_id: gameId });

  // Submit 10 fixes covering ~800m total path (0.0008 deg lat per step ≈ 88.9m)
  // Spaced 11 seconds apart to satisfy the 10s trail_points throttle and <120s freshness
  const nowMs = Date.now();
  for (let i = 0; i < 10; i++) {
    await rpc(host, 'submit_position', {
      game_id: gameId,
      lat: CENTER.lat + i * 0.0008,
      lng: CENTER.lng,
      accuracy: 5,
      recorded_at: new Date(nowMs - (9 - i) * 11000).toISOString(),
    });
  }

  // Hunter tags runner at final point to end game
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 9 * 0.0008,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'attempt_tag', { game_id: gameId });

  // 1. Preview Ghost
  const preview = await rpc<{
    can_contribute: boolean;
    original_length_m: number;
    trimmed_length_m: number;
    duration_s: number;
    geojson: unknown;
  }>(host, 'preview_ghost', { game_id: gameId });

  expect(
    preview.data?.can_contribute === true,
    'preview_ghost confirms route is eligible for contribution',
    JSON.stringify(preview.data ?? preview.error),
  );
  expect(
    Number(preview.data?.trimmed_length_m) >= 300,
    'trimmed length is at least 300m after privacy trimming',
    String(preview.data?.trimmed_length_m),
  );

  // 2. Contribute Ghost
  const contribute = await rpc<{
    success: boolean;
    ghost_id: string;
    trimmed_length_m: number;
    duration_s: number;
  }>(host, 'contribute_ghost', { game_id: gameId });

  expect(
    contribute.data?.success === true && typeof contribute.data?.ghost_id === 'string',
    'contribute_ghost successfully stores ghost into ghost_library',
    JSON.stringify(contribute.data ?? contribute.error),
  );
  const ghostId = contribute.data?.ghost_id;

  // 3. List My Ghosts
  const myGhosts = await rpc<{ ghost_id: string; length_m: number }[]>(host, 'list_my_ghosts', {});
  expect(
    Array.isArray(myGhosts.data) && myGhosts.data.some((g) => g.ghost_id === ghostId),
    'list_my_ghosts contains the newly contributed ghost',
    JSON.stringify(myGhosts.data ?? myGhosts.error),
  );

  // 4. Delete My Ghost
  const del = await rpc<{ deleted_count: number }>(host, 'delete_my_ghosts', {
    ghost_ids: [ghostId],
  });
  expect(
    del.data?.deleted_count === 1,
    'delete_my_ghosts deletes the selected ghost',
    JSON.stringify(del.data ?? del.error),
  );

  const afterDelete = await rpc<{ ghost_id: string }[]>(host, 'list_my_ghosts', {});
  expect(
    Array.isArray(afterDelete.data) && !afterDelete.data.some((g) => g.ghost_id === ghostId),
    'deleted ghost is absent from list_my_ghosts',
    JSON.stringify(afterDelete.data ?? afterDelete.error),
  );

  for (const client of [host, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

/** Scripted: Milestone S1 Security, Fairness, Clock Timing, Assist Mode, Safety Guards & Health Ping Abuse. */
async function s1SecurityTimingScenario() {
  console.log('\n--- Scenario: s1-security-timing (Milestone S1) ---');
  const host = await newPlayer('S1Host');
  const hunter = await newPlayer('S1Hunter');

  // 1. Clock Advancement (advance_active_games / idle clock advancement)
  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'tag_hunt',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: { head_start_s: 0, duration_s: 300, ping_interval_s: 30, ping_visible_s: 10, ghost_mode: 'assist' },
  });
  if (created.error || !created.data?.[0]?.game_id) {
    throw new Error(`s1 create_game failed: ${created.error?.message}`);
  }
  const gameId = created.data[0].game_id;

  await rpc(hunter, 'join_game', { code: created.data[0].code });
  await rpc(host, 'set_team', { game_id: gameId, player_id: await playerId(host, gameId), team: 'runner' });
  await rpc(hunter, 'set_team', { game_id: gameId, player_id: await playerId(hunter, gameId), team: 'hunter' });
  await rpc(host, 'set_share_trail', { game_id: gameId, share: true });
  await rpc(hunter, 'set_share_trail', { game_id: gameId, share: true });
  await rpc(host, 'set_ready', { game_id: gameId, ready: true });
  await rpc(hunter, 'set_ready', { game_id: gameId, ready: true });

  const startRes = await rpc<{ status: string }>(host, 'start_game', { game_id: gameId });
  expect(startRes.data?.status === 'countdown', 'game starts in countdown', String(startRes.data?.status));

  // Wait 11 seconds for countdown to expire
  await new Promise((r) => setTimeout(r, 11000));

  // Advance idle games via advance_active_games without players calling advance_game directly
  const unauthClient = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const advRes = await unauthClient.rpc('advance_active_games', { limit_count: 10 });
  expect(
    !advRes.error && Number(advRes.data?.advanced_count) >= 1,
    'advance_active_games advances idle active games',
    JSON.stringify(advRes.data ?? advRes.error),
  );

  const stateAfterAdv = await rpc<Record<string, unknown>>(host, 'get_game_state', { game_id: gameId });
  expect(
    (stateAfterAdv.data?.game as any)?.status === 'live',
    'idle game reached live status through advance_active_games clock tick',
    (stateAfterAdv.data?.game as any)?.status,
  );

  // 2. Ping Window Visibility (D5)
  expect(
    (stateAfterAdv.data?.game as any)?.ping_visible_s === 10,
    'game ping_visible_s is 10 by default',
    String((stateAfterAdv.data?.game as any)?.ping_visible_s),
  );

  // 3. Safety Guard: Mock Location Detection
  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 5,
    is_mock: true,
    recorded_at: new Date().toISOString(),
  });

  const mockEvents = (await host.from('events').select('*').eq('game_id', gameId).eq('type', 'mock_location_detected')).data ?? [];
  expect(
    mockEvents.length > 0,
    'mock_location_detected event is emitted when mock fix is submitted',
    `events=${mockEvents.length}`,
  );

  // 4. Safety Guard: Universal Vehicle Warning
  // Warm up exponential speed smoothing above 8 m/s across sustained window
  for (let i = 0; i < 4; i++) {
    await rpc(host, 'submit_position', {
      game_id: gameId,
      lat: CENTER.lat + 0.0001 * (i + 1),
      lng: CENTER.lng,
      speed: 15.0,
      accuracy: 5,
      recorded_at: new Date(Date.now() - 11000 + i * 200).toISOString(),
    });
  }
  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.001,
    lng: CENTER.lng,
    speed: 15.0,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });
  const vehicleEvents = (await host.from('events').select('*').eq('game_id', gameId).eq('type', 'vehicle_warning')).data ?? [];
  expect(
    vehicleEvents.length > 0,
    'vehicle_warning event is emitted when speed >= 8 m/s for 10 s',
    `events=${vehicleEvents.length}`,
  );

  for (const client of [host, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }

  // 5. Ghost Assist Mode (D3) & Inaccuracy Gating
  const assistHost = await newPlayer('AssistHost');
  const assistHunter = await newPlayer('AssistHunter');
  const assistCreated = await rpc<{ game_id: string; code: string }[]>(assistHost, 'create_game', {
    mode: 'haunted_map',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: { head_start_s: 0, duration_s: 300, ghost_mode: 'assist' },
  });
  const assistGameId = assistCreated.data![0].game_id;
  await rpc(assistHunter, 'join_game', { code: assistCreated.data![0].code });
  await rpc(assistHost, 'set_team', { game_id: assistGameId, player_id: await playerId(assistHost, assistGameId), team: 'runner' });
  await rpc(assistHunter, 'set_team', { game_id: assistGameId, player_id: await playerId(assistHunter, assistGameId), team: 'hunter' });
  await rpc(assistHost, 'set_share_trail', { game_id: assistGameId, share: true });
  await rpc(assistHunter, 'set_share_trail', { game_id: assistGameId, share: true });
  await rpc(assistHost, 'set_ready', { game_id: assistGameId, ready: true });
  await rpc(assistHunter, 'set_ready', { game_id: assistGameId, ready: true });
  await rpc(assistHost, 'start_game', { game_id: assistGameId });
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(assistHost, 'advance_game', { game_id: assistGameId });

  // 1. Inaccuracy check: runner near ghost with accuracy 35m (>30m) must be ignored
  await rpc(assistHost, 'submit_position', {
    game_id: assistGameId,
    lat: CENTER.lat,
    lng: CENTER.lng + 0.00375,
    accuracy: 35.0,
    recorded_at: new Date().toISOString(),
  });
  await rpc(assistHost, 'advance_game', { game_id: assistGameId });

  const inaccuratePings = (await assistHunter.from('pings').select('*').eq('game_id', assistGameId).eq('reason', 'ghost_sighting')).data ?? [];
  expect(
    inaccuratePings.length === 0,
    'inaccurate runner fix (>30m) is ignored by ghost and produces no sighting ping',
    `pings=${inaccuratePings.length}`,
  );

  // 2. Assist sighting check: runner near ghost with accuracy 5m (<=30m) within 40m triggers ghost_sighting ping
  await rpc(assistHost, 'submit_position', {
    game_id: assistGameId,
    lat: CENTER.lat,
    lng: CENTER.lng + 0.00375,
    accuracy: 5.0,
    recorded_at: new Date().toISOString(),
  });
  await rpc(assistHost, 'advance_game', { game_id: assistGameId });

  const sightingPings = (await assistHunter.from('pings').select('*').eq('game_id', assistGameId).eq('reason', 'ghost_sighting')).data ?? [];
  expect(
    sightingPings.length > 0,
    'ghost in assist mode emits sighting ping to hunters within 40m',
    `pings=${sightingPings.length}`,
  );

  for (const client of [assistHost, assistHunter]) {
    await rpc(client, 'leave_game', { game_id: assistGameId });
  }

  // 6. Hardened health_ping 100-call rapid abuse test
  const pingPromises = Array.from({ length: 100 }, async () => {
    let res = await unauthClient.rpc('health_ping', { body: {} });
    if (res.error) {
      // Transient network retry for cloud endpoint test
      res = await unauthClient.rpc('health_ping', { body: {} });
    }
    return res;
  });
  const pingResults = await Promise.all(pingPromises);
  const allSucceeded = pingResults.every((res) => !res.error && res.data?.ok === true && res.data?.app === 'ghostrun');
  expect(
    allSucceeded,
    '100 rapid concurrent health_ping keep-alive calls all succeed cleanly without failure',
    `succeeded=${pingResults.filter((r) => r.data?.ok).length}`,
  );
}

/** Scripted: B1 Jailbreak mode scenarios (jail placement, jailing, rescue hold, auto-release, all-jailed win). */
async function jailbreakScenario() {
  console.log('\n--- Scenario: jailbreak (B1 Jailbreak Base Mode) ---');
  const host = await newPlayer('JailHost'); // Runner 1
  const runner2 = await newPlayer('JailRunner2'); // Runner 2
  const hunter = await newPlayer('JailHunter'); // Hunter

  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'jailbreak',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      head_start_s: 0,
      duration_s: 300,
      ping_interval_s: 30,
      mode_params: {
        jailbreak: {
          jail_radius_m: 15,
          auto_release_s: 10,
          release_hold_s: 2,
          release_radius_m: 10,
        },
      },
    },
  });

  if (created.error || !created.data?.[0]?.game_id) {
    throw new Error(`jailbreak create failed: ${created.error?.message}`);
  }
  const gameId = created.data[0].game_id;
  const code = created.data[0].code;

  await rpc(runner2, 'join_game', { code });
  await rpc(hunter, 'join_game', { code });

  await rpc(host, 'set_team', {
    game_id: gameId,
    player_id: await playerId(host, gameId),
    team: 'runner',
  });
  await rpc(runner2, 'set_team', {
    game_id: gameId,
    player_id: await playerId(runner2, gameId),
    team: 'runner',
  });
  await rpc(hunter, 'set_team', {
    game_id: gameId,
    player_id: await playerId(hunter, gameId),
    team: 'hunter',
  });

  for (const client of [host, runner2, hunter]) {
    await rpc(client, 'set_share_trail', { game_id: gameId, share: true });
    await rpc(client, 'set_ready', { game_id: gameId, ready: true });
  }

  // 1. start_game fails before jail is placed
  const earlyStart = await rpc(host, 'start_game', { game_id: gameId });
  expect(
    Boolean(earlyStart.error) && /place the jail/i.test(earlyStart.error?.message ?? ''),
    'start requires jail placement in Jailbreak mode',
    String(earlyStart.error?.message ?? 'unexpected success'),
  );

  // 2. set_jail_location outside area fails
  const outsideJail = await rpc(host, 'set_jail_location', {
    game_id: gameId,
    lat: CENTER.lat + 0.2,
    lng: CENTER.lng,
  });
  expect(
    Boolean(outsideJail.error) && /inside the play area/i.test(outsideJail.error?.message ?? ''),
    'jail placement outside boundary is rejected',
    String(outsideJail.error?.message ?? 'unexpected success'),
  );

  // 3. set_jail_location inside area succeeds
  const jailLat = CENTER.lat + 0.001;
  const jailLng = CENTER.lng;
  const placedJail = await rpc<{ jail_id: string; radius_m: number }>(host, 'set_jail_location', {
    game_id: gameId,
    lat: jailLat,
    lng: jailLng,
  });
  expect(
    !placedJail.error && Boolean(placedJail.data?.jail_id),
    'jail placement inside boundary succeeds',
    String(placedJail.error?.message ?? placedJail.data?.jail_id),
  );

  // 4. start_game succeeds now
  const started = await rpc<{ status: string }>(host, 'start_game', { game_id: gameId });
  expect(
    !started.error && started.data?.status === 'countdown',
    'Jailbreak game starts cleanly in countdown',
    String(started.error?.message ?? started.data?.status),
  );

  // Fast forward past countdown to live
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(host, 'advance_game', { game_id: gameId });

  const liveState = await rpc<{ game: { status: string; jail: { latitude: number; longitude: number } } }>(
    host,
    'get_game_state',
    { game_id: gameId }
  );
  expect(
    liveState.data?.game.status === 'live' && Boolean(liveState.data?.game.jail),
    'Jailbreak round reaches live with jail entity in state snapshot',
    JSON.stringify(liveState.data?.game),
  );

  // 5. Hunter tags Runner 2 -> Runner 2 becomes 'jailed'
  await rpc(runner2, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.002,
    lng: CENTER.lng + 0.002,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.002,
    lng: CENTER.lng + 0.002,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const tagRes = await rpc<{ success: boolean; runner_id: string; phase: string }>(
    hunter,
    'attempt_tag',
    { game_id: gameId }
  );
  expect(
    tagRes.data?.success === true && tagRes.data.phase === 'live',
    'hunter tags runner 2 and game remains live',
    JSON.stringify(tagRes.data ?? tagRes.error),
  );

  const stateAfterTag = await rpc<{ players: { id: string; status: string }[] }>(
    host,
    'get_game_state',
    { game_id: gameId }
  );
  const runner2Player = stateAfterTag.data?.players.find((p) => p.id === tagRes.data?.runner_id);
  expect(
    runner2Player?.status === 'jailed',
    'tagged runner transitions to jailed status',
    JSON.stringify(runner2Player),
  );

  // 6. Rescue hold validates distance: runner 1 far from jail cannot start rescue
  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat - 0.003, // ~330m away from jail
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const farRescue = await rpc(host, 'start_rescue', { game_id: gameId });
  expect(
    Boolean(farRescue.error) && /within.*meters/i.test(farRescue.error?.message ?? ''),
    'start_rescue fails when runner is far from jail',
    String(farRescue.error?.message ?? 'unexpected success'),
  );

  // 7. Hunter cannot call start_rescue
  const hunterRescue = await rpc(hunter, 'start_rescue', { game_id: gameId });
  expect(
    Boolean(hunterRescue.error) && /only runners/i.test(hunterRescue.error?.message ?? ''),
    'hunters cannot call start_rescue',
    String(hunterRescue.error?.message ?? 'unexpected success'),
  );

  // 8. Runner 1 moves to jail location and starts rescue
  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: jailLat,
    lng: jailLng,
    accuracy: 4,
    recorded_at: new Date().toISOString(),
  });

  const validRescue = await rpc<{ success: boolean; hold_s: number }>(host, 'start_rescue', {
    game_id: gameId,
  });
  expect(
    validRescue.data?.success === true && validRescue.data?.hold_s === 2,
    'runner within 10m starts rescue successfully',
    JSON.stringify(validRescue.data ?? validRescue.error),
  );

  // Hunter does not see rescue_started event (audience 'runner')
  const hunterEvents = (await hunter.from('events').select('*').eq('game_id', gameId)).data ?? [];
  expect(
    !hunterEvents.some((e) => e.type === 'rescue_started'),
    'rescue_started event is hidden from hunters',
    'hunter leaked rescue_started',
  );

  // 9. complete_rescue fails before hold duration
  const earlyComplete = await rpc(host, 'complete_rescue', { game_id: gameId });
  expect(
    Boolean(earlyComplete.error) && /not completed/i.test(earlyComplete.error?.message ?? ''),
    'complete_rescue fails before hold duration expires',
    String(earlyComplete.error?.message ?? 'unexpected success'),
  );

  // 10. complete_rescue succeeds after hold duration
  await new Promise((r) => setTimeout(r, 2200)); // hold_s is 2
  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: jailLat,
    lng: jailLng,
    accuracy: 4,
    recorded_at: new Date().toISOString(),
  });

  const freedRes = await rpc<{ success: boolean; freed_count: number }>(host, 'complete_rescue', {
    game_id: gameId,
  });
  expect(
    freedRes.data?.success === true && freedRes.data.freed_count === 1,
    'complete_rescue frees jailed runner after hold duration',
    JSON.stringify(freedRes.data ?? freedRes.error),
  );

  const stateAfterFree = await rpc<{ players: { id: string; status: string }[] }>(
    host,
    'get_game_state',
    { game_id: gameId }
  );
  const runner2Freed = stateAfterFree.data?.players.find((p) => p.id === runner2Player?.id);
  expect(
    runner2Freed?.status === 'active',
    'previously jailed runner is restored to active status',
    JSON.stringify(runner2Freed),
  );

  // 11. Auto-release after timeout (auto_release_s: 10)
  // Hunter tags Runner 2 again
  await rpc(runner2, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.002,
    lng: CENTER.lng + 0.002,
    accuracy: 4,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.002,
    lng: CENTER.lng + 0.002,
    accuracy: 4,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'attempt_tag', { game_id: gameId });

  // Wait 11 seconds for auto_release_s (10s) to elapse
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(host, 'advance_game', { game_id: gameId });

  const stateAfterAuto = await rpc<{ players: { id: string; status: string }[] }>(
    host,
    'get_game_state',
    { game_id: gameId }
  );
  const runner2Auto = stateAfterAuto.data?.players.find((p) => p.id === runner2Player?.id);
  expect(
    runner2Auto?.status === 'active',
    'jailed runner is auto-released after auto_release_s expires',
    JSON.stringify(runner2Auto),
  );

  // 12. All-jailed win condition
  // Tag runner 1
  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.002,
    lng: CENTER.lng + 0.002,
    accuracy: 4,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.002,
    lng: CENTER.lng + 0.002,
    accuracy: 4,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'attempt_tag', { game_id: gameId });

  // Tag runner 2 (both now jailed)
  await rpc(runner2, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.002,
    lng: CENTER.lng + 0.002,
    accuracy: 4,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.002,
    lng: CENTER.lng + 0.002,
    accuracy: 4,
    recorded_at: new Date().toISOString(),
  });
  const finalTag = await rpc<{ success: boolean; phase: string; winner: string; end_reason: string }>(
    hunter,
    'attempt_tag',
    { game_id: gameId }
  );
  expect(
    finalTag.data?.success === true &&
      finalTag.data.phase === 'ended' &&
      finalTag.data.winner === 'hunters' &&
      finalTag.data.end_reason === 'all_jailed',
    'tagging the last free runner ends Jailbreak game with all_jailed for hunters',
    JSON.stringify(finalTag.data ?? finalTag.error),
  );

  for (const client of [host, runner2, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

async function assassinRingScenario() {
  console.log('\n--- Scenario: assassin-ring (B2 Assassin Ring Base Mode) ---');
  const pA = await newPlayer('AssassinA');
  const pB = await newPlayer('AssassinB');
  const pC = await newPlayer('AssassinC');

  const created = await rpc<{ game_id: string; code: string }[]>(pA, 'create_game', {
    mode: 'assassin_ring',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      head_start_s: 0,
      duration_s: 300,
      ping_interval_s: 30,
      mode_params: {
        assassin_ring: {
          tag_radius_m: 15,
          hunter_pulse_far_m: 100,
          hunter_pulse_near_m: 40,
        },
      },
    },
  });

  if (created.error || !created.data?.[0]?.game_id) {
    throw new Error(`assassin_ring create failed: ${created.error?.message}`);
  }
  const gameId = created.data[0].game_id;
  const code = created.data[0].code;

  await rpc(pB, 'join_game', { code });
  await rpc(pC, 'join_game', { code });

  for (const client of [pA, pB, pC]) {
    await rpc(client, 'set_share_trail', { game_id: gameId, share: true });
    await rpc(client, 'set_ready', { game_id: gameId, ready: true });
  }

  // 1. Host starts the game
  const started = await rpc(pA, 'start_game', { game_id: gameId });
  expect(
    !started.error,
    'Assassin Ring game starts cleanly in countdown',
    String(started.error?.message ?? 'ok'),
  );

  // 2. Safe zones auto-created
  const safeZonesRes = await pA
    .from('entities')
    .select('id, kind, geog, state')
    .eq('game_id', gameId)
    .eq('kind', 'safe_zone');
  expect(
    (safeZonesRes.data?.length ?? 0) >= 2,
    'two safe zones auto-created for Assassin Ring game',
    `found: ${safeZonesRes.data?.length}`,
  );

  const idA = await playerId(pA, gameId);
  const idB = await playerId(pB, gameId);
  const idC = await playerId(pC, gameId);

  // 3. Ring assignments generated (tested per-player under RLS)
  const ringA = (await pA.from('ring_assignments').select('hunter_player_id, prey_player_id, status').eq('game_id', gameId).eq('status', 'active')).data ?? [];
  const ringB = (await pB.from('ring_assignments').select('hunter_player_id, prey_player_id, status').eq('game_id', gameId).eq('status', 'active')).data ?? [];
  const ringC = (await pC.from('ring_assignments').select('hunter_player_id, prey_player_id, status').eq('game_id', gameId).eq('status', 'active')).data ?? [];

  expect(
    ringA.length === 1 && ringB.length === 1 && ringC.length === 1,
    'each player sees exactly one active assignment under RLS',
    `A=${ringA.length}, B=${ringB.length}, C=${ringC.length}`,
  );

  const preyA = ringA[0]?.prey_player_id;
  const preyB = ringB[0]?.prey_player_id;
  const preyC = ringC[0]?.prey_player_id;

  expect(
    preyA !== idA && preyB !== idB && preyC !== idC,
    'no player is their own prey in the ring',
    `A->${preyA}, B->${preyB}, C->${preyC}`,
  );

  const preySet = new Set([preyA, preyB, preyC]);
  expect(
    preySet.size === 3,
    'all prey assignments are unique forming a complete cycle',
    `preys=${Array.from(preySet).join(',')}`,
  );

  // Advance game to live through countdown
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(pA, 'advance_game', { game_id: gameId });

  // 4. Test proximity pulse
  const clientById: Record<string, typeof pA> = { [idA]: pA, [idB]: pB, [idC]: pC };
  const allAssignments = [
    { hunter: idA, prey: preyA },
    { hunter: idB, prey: preyB },
    { hunter: idC, prey: preyC },
  ];
  const hunterOfB_id = allAssignments.find((a) => a.prey === idB)!.hunter;
  const hunterOfB_client = clientById[hunterOfB_id];

  // Upload position for B at center
  await rpc(pB, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  // Hunter of B positions 28m away (close proximity <= 40m)
  await rpc(hunterOfB_client, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.00025, // ~28m
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  // Third player positions 300m away
  const thirdId = [idA, idB, idC].find((id) => id !== idB && id !== hunterOfB_id)!;
  await rpc(clientById[thirdId], 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.003,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const stateB = await rpc<{ assassin_ring: { hunter_proximity: string; my_prey: { player_id: string } } }>(
    pB,
    'get_game_state',
    { game_id: gameId }
  );

  expect(
    stateB.data?.assassin_ring?.hunter_proximity === 'close',
    'victim receives "close" proximity warning when hunter is within 40m',
    `received: ${stateB.data?.assassin_ring?.hunter_proximity}`,
  );
  expect(
    stateB.data?.assassin_ring?.my_prey?.player_id === preyB,
    'victim sees their assigned prey',
    `prey: ${stateB.data?.assassin_ring?.my_prey?.player_id}`,
  );

  // 5. Test safe zone tag protection
  const szCoord = await rpc<{ assassin_ring: { safe_zones: { latitude: number; longitude: number }[] } }>(
    pA,
    'get_game_state',
    { game_id: gameId }
  );
  const szList = szCoord.data?.assassin_ring?.safe_zones;
  const szLat = szList?.[0]?.latitude ?? CENTER.lat + 0.002;
  const szLng = szList?.[0]?.longitude ?? CENTER.lng;

  await rpc(hunterOfB_client, 'submit_position', {
    game_id: gameId,
    lat: szLat,
    lng: szLng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });
  await rpc(pB, 'submit_position', {
    game_id: gameId,
    lat: szLat,
    lng: szLng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const szTag = await rpc<{ success: boolean; reason: string }>(hunterOfB_client, 'attempt_tag', {
    game_id: gameId,
  });
  expect(
    szTag.data?.success === false && szTag.data?.reason === 'in_safe_zone',
    'tagging inside a safe zone is rejected with in_safe_zone',
    JSON.stringify(szTag.data ?? szTag.error),
  );

  // 6. Move outside safe zone and tag prey
  await rpc(hunterOfB_client, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.001,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });
  await rpc(pB, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.00105, // ~5m away
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  // Wait out 8s tag cooldown
  await new Promise((r) => setTimeout(r, 8500));

  const tagSuccess = await rpc<{ success: boolean; runner_id: string }>(hunterOfB_client, 'attempt_tag', {
    game_id: gameId,
  });
  expect(
    tagSuccess.data?.success === true && tagSuccess.data.runner_id === idB,
    'hunter successfully tags assigned prey outside safe zone',
    JSON.stringify(tagSuccess.data ?? tagSuccess.error),
  );

  // 7. Verify prey eliminated and ring relinked
  const postTagState = await rpc<{ assassin_ring: { my_prey: { player_id: string }; active_survivors: number } }>(
    hunterOfB_client,
    'get_game_state',
    { game_id: gameId }
  );
  expect(
    postTagState.data?.assassin_ring?.active_survivors === 2,
    'active survivors count decremented to 2',
    `survivors: ${postTagState.data?.assassin_ring?.active_survivors}`,
  );
  expect(
    postTagState.data?.assassin_ring?.my_prey?.player_id === preyB,
    'hunter inherits victim prey after elimination (ring relinked)',
    `new prey: ${postTagState.data?.assassin_ring?.my_prey?.player_id}`,
  );

  // 8. Final elimination: hunter tags new prey (third player)
  // Wait out 8s tag cooldown
  await new Promise((r) => setTimeout(r, 8500));

  await rpc(hunterOfB_client, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.001,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });
  await rpc(clientById[preyB!], 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.00107, // ~7m away
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const finalTag = await rpc<{ success: boolean; phase: string; winner: string; end_reason: string }>(
    hunterOfB_client,
    'attempt_tag',
    { game_id: gameId }
  );
  expect(
    finalTag.data?.success === true &&
      finalTag.data.phase === 'ended' &&
      finalTag.data.winner === 'solo' &&
      finalTag.data.end_reason === 'last_survivor',
    'last elimination terminates round with solo winner and last_survivor reason',
    JSON.stringify(finalTag.data ?? finalTag.error),
  );

  for (const client of [pA, pB, pC]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

/** Scripted: B3 Relay Heist mode scenarios (extraction placement, carrier assignment, physical handoff, package drop, recover, extraction win). */
async function relayHeistScenario() {
  console.log('\n--- Scenario: relay-heist (B3 Relay Heist Base Mode) ---');
  const host = await newPlayer('HeistHost'); // Runner 1
  const runner2 = await newPlayer('HeistRunner2'); // Runner 2
  const hunter = await newPlayer('HeistHunter'); // Hunter

  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'relay_heist',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      head_start_s: 0,
      ping_interval_s: 30,
      mode_params: {
        relay_heist: {
          extraction_radius_m: 25,
          handoff_radius_m: 5,
          drop_pickup_radius_m: 10,
          hunter_secure_hold_s: 20,
        },
      },
    },
  });

  if (created.error || !created.data?.[0]?.game_id) {
    throw new Error(`relay_heist create failed: ${created.error?.message}`);
  }
  const gameId = created.data[0].game_id;
  const code = created.data[0].code;

  await rpc(runner2, 'join_game', { code });
  await rpc(hunter, 'join_game', { code });

  const hostPid = await playerId(host, gameId);
  const runner2Pid = await playerId(runner2, gameId);
  const hunterPid = await playerId(hunter, gameId);

  await rpc(host, 'set_team', { game_id: gameId, player_id: hostPid, team: 'runner' });
  await rpc(runner2, 'set_team', { game_id: gameId, player_id: runner2Pid, team: 'runner' });
  await rpc(hunter, 'set_team', { game_id: gameId, player_id: hunterPid, team: 'hunter' });

  for (const client of [host, runner2, hunter]) {
    await rpc(client, 'set_share_trail', { game_id: gameId, share: true });
    await rpc(client, 'set_ready', { game_id: gameId, ready: true });
  }

  // 1. Attempt start before extraction placement fails
  const earlyStart = await rpc(host, 'start_game', { game_id: gameId });
  expect(
    Boolean(earlyStart.error) && /place the extraction point/i.test(earlyStart.error?.message ?? ''),
    'start requires extraction point placement in Relay Heist mode',
    String(earlyStart.error?.message ?? 'unexpected success'),
  );

  // 2. set_extraction_location outside area fails
  const outsideExtraction = await rpc(host, 'set_extraction_location', {
    p_game_id: gameId,
    p_lat: CENTER.lat + 0.05,
    p_lng: CENTER.lng + 0.05,
  });
  expect(
    Boolean(outsideExtraction.error),
    'setting extraction point outside area fails',
    String(outsideExtraction.error?.message ?? 'unexpected success'),
  );

  // 3. Set extraction inside area succeeds (approx 220m north)
  const extractionLat = CENTER.lat + 0.002;
  const extractionLng = CENTER.lng;
  const validExtraction = await rpc(host, 'set_extraction_location', {
    p_game_id: gameId,
    p_lat: extractionLat,
    p_lng: extractionLng,
    p_radius_m: 25,
  });
  expect(
    !validExtraction.error,
    'setting extraction point inside area succeeds',
    String(validExtraction.error?.message ?? ''),
  );

  // 4. Start game -> countdown -> live
  const started = await rpc<{ status: string }>(host, 'start_game', { game_id: gameId });
  expect(
    !started.error && started.data?.status === 'countdown',
    'Relay Heist game starts cleanly in countdown',
    String(started.error?.message ?? started.data?.status),
  );

  // Fast forward past countdown to live
  await new Promise((r) => setTimeout(r, 11000));

  type RelayGameState = {
    game: { status: string };
    relay_heist?: {
      extraction?: { latitude: number; longitude: number; radius_m: number };
      package?: {
        status: 'carried' | 'dropped';
        carrier_player_id?: string;
        is_carrier?: boolean;
        latitude?: number;
        longitude?: number;
      };
      is_carrier?: boolean;
      handoff_pending_from?: string;
    };
  };

  const hostLiveState = await rpc<RelayGameState>(host, 'get_game_state', { game_id: gameId });
  const runner2LiveState = await rpc<RelayGameState>(runner2, 'get_game_state', { game_id: gameId });
  const hunterLiveState = await rpc<RelayGameState>(hunter, 'get_game_state', { game_id: gameId });

  expect(
    hostLiveState.data?.game.status === 'live',
    'Relay Heist round reaches live status',
    JSON.stringify(hostLiveState.data?.game),
  );

  expect(
    Boolean(hostLiveState.data?.relay_heist?.extraction),
    'extraction point is present in runner state',
    JSON.stringify(hostLiveState.data?.relay_heist?.extraction),
  );

  expect(
    Boolean(hunterLiveState.data?.relay_heist?.extraction),
    'extraction point is public and present in hunter state from start',
    JSON.stringify(hunterLiveState.data?.relay_heist?.extraction),
  );

  // Verify carrier assignment
  const hostIsCarrier = hostLiveState.data?.relay_heist?.is_carrier;
  const runner2IsCarrier = runner2LiveState.data?.relay_heist?.is_carrier;
  expect(
    Boolean((hostIsCarrier && !runner2IsCarrier) || (!hostIsCarrier && runner2IsCarrier)),
    'exactly one runner is designated as carrier at match start',
    `host=${hostIsCarrier}, runner2=${runner2IsCarrier}`,
  );

  const initialCarrierClient = hostIsCarrier ? host : runner2;
  const initialCarrierPid = hostIsCarrier ? hostPid : runner2Pid;
  const otherRunnerClient = hostIsCarrier ? runner2 : host;
  const otherRunnerPid = hostIsCarrier ? runner2Pid : hostPid;

  // 5. Physical Handoff Test
  // Initial carrier submits position at CENTER
  await rpc(initialCarrierClient, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  // Other runner submits position ~33m away (too far for 5m handoff)
  await rpc(otherRunnerClient, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.0003,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const distantHandoff = await rpc<{ success: boolean; reason: string }>(initialCarrierClient, 'request_handoff', {
    p_game_id: gameId,
    p_target_player_id: otherRunnerPid,
  });
  expect(
    distantHandoff.data?.success === false && distantHandoff.data?.reason === 'too_far',
    'handoff request rejected when teammates are > 5m apart',
    JSON.stringify(distantHandoff.data ?? distantHandoff.error),
  );

  // Other runner moves to within 2.5m (approx 0.00002 deg lat ~ 2.2m)
  await rpc(otherRunnerClient, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.00002,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const validHandoffReq = await rpc(initialCarrierClient, 'request_handoff', {
    p_game_id: gameId,
    p_target_player_id: otherRunnerPid,
  });
  expect(
    !validHandoffReq.error,
    'handoff request accepted when within 5m',
    String(validHandoffReq.error?.message ?? ''),
  );

  // Other runner confirms handoff
  const confirmHandoffRes = await rpc(otherRunnerClient, 'confirm_handoff', {
    p_game_id: gameId,
  });
  expect(
    !confirmHandoffRes.error,
    'handoff confirmed by receiver',
    String(confirmHandoffRes.error?.message ?? ''),
  );

  // Verify carrier swap
  const swappedState = await rpc<RelayGameState>(otherRunnerClient, 'get_game_state', { game_id: gameId });
  expect(
    swappedState.data?.relay_heist?.is_carrier === true,
    'receiving runner is now the active package carrier',
    `is_carrier=${swappedState.data?.relay_heist?.is_carrier}`,
  );

  // 6. Carrier Tag & Package Drop Test
  // Hunter moves within 5m of new carrier
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.00003,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const tagCarrier = await rpc<{ success: boolean; phase: string }>(hunter, 'attempt_tag', {
    game_id: gameId,
  });
  expect(
    tagCarrier.data?.success === true,
    'hunter successfully tags package carrier',
    JSON.stringify(tagCarrier.data ?? tagCarrier.error),
  );

  // Inspect state: package should now be dropped on ground
  const dropState = await rpc<RelayGameState>(hunter, 'get_game_state', { game_id: gameId });
  expect(
    dropState.data?.relay_heist?.package?.status === 'dropped' &&
      dropState.data.relay_heist.package.latitude !== undefined,
    'package drops to ground and becomes visible to hunter',
    JSON.stringify(dropState.data?.relay_heist?.package),
  );

  // 7. Drop Contest: Hunter Securing
  const startSecuring = await rpc(hunter, 'start_securing_package', { p_game_id: gameId });
  expect(
    !startSecuring.error,
    'hunter within 10m can start securing dropped package',
    String(startSecuring.error?.message ?? ''),
  );

  const cancelSecuring = await rpc(hunter, 'cancel_securing_package', { p_game_id: gameId });
  expect(
    !cancelSecuring.error,
    'hunter can cancel securing hold cleanly',
    String(cancelSecuring.error?.message ?? ''),
  );

  // 8. Runner Recovery: Surviving runner recovers package
  // Initial carrier (who is not tagged) moves within 3m of dropped package
  await rpc(initialCarrierClient, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.00002,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const recoverRes = await rpc(initialCarrierClient, 'pickup_package', { p_game_id: gameId });
  expect(
    !recoverRes.error,
    'surviving runner recovers dropped package',
    String(recoverRes.error?.message ?? ''),
  );

  const recoveredState = await rpc<RelayGameState>(initialCarrierClient, 'get_game_state', { game_id: gameId });
  expect(
    recoveredState.data?.relay_heist?.is_carrier === true &&
      recoveredState.data?.relay_heist?.package?.status === 'carried',
    'recovering runner is now active carrier with carried package',
    JSON.stringify(recoveredState.data?.relay_heist),
  );

  // 9. Extraction Victory: Carrier reaches extraction zone
  await rpc(initialCarrierClient, 'submit_position', {
    game_id: gameId,
    lat: extractionLat,
    lng: extractionLng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const extractionState = await rpc<{ game: { status: string; winner: string; end_reason: string } }>(
    initialCarrierClient,
    'get_game_state',
    { game_id: gameId }
  );
  expect(
    extractionState.data?.game.status === 'ended' &&
      extractionState.data.game.winner === 'runners' &&
      extractionState.data.game.end_reason === 'extraction_complete',
    'carrier reaching extraction zone triggers runners victory with extraction_complete',
    JSON.stringify(extractionState.data?.game),
  );

  for (const client of [host, runner2, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

/** Scripted: B4 VIP Escort role scenarios (role assignment, secrecy, 5m role swap, bodyguard freeze, freeze tag rejection, VIP elimination). */
async function vipEscortScenario() {
  console.log('\n--- Scenario: vip-escort (B4 VIP Escort Role Add-on) ---');
  const host = await newPlayer('VipHost'); // Runner 1
  const runner2 = await newPlayer('VipRunner2'); // Runner 2
  const hunter = await newPlayer('VipHunter'); // Hunter

  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'tag_hunt',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      roles: ['vip'],
      head_start_s: 0,
      ping_interval_s: 30,
    },
  });

  if (created.error || !created.data?.[0]?.game_id) {
    throw new Error(`vip_escort create failed: ${created.error?.message}`);
  }
  const gameId = created.data[0].game_id;
  const code = created.data[0].code;

  await rpc(runner2, 'join_game', { code });
  await rpc(hunter, 'join_game', { code });

  const hostPid = await playerId(host, gameId);
  const runner2Pid = await playerId(runner2, gameId);
  const hunterPid = await playerId(hunter, gameId);

  await rpc(host, 'set_team', { game_id: gameId, player_id: hostPid, team: 'runner' });
  await rpc(runner2, 'set_team', { game_id: gameId, player_id: runner2Pid, team: 'runner' });
  await rpc(hunter, 'set_team', { game_id: gameId, player_id: hunterPid, team: 'hunter' });

  for (const client of [host, runner2, hunter]) {
    await rpc(client, 'set_share_trail', { game_id: gameId, share: true });
    await rpc(client, 'set_ready', { game_id: gameId, ready: true });
  }

  // 1. Start game and verify countdown -> live
  const started = await rpc(host, 'start_game', { game_id: gameId });
  expect(!started.error, 'VIP Escort game starts cleanly in countdown', JSON.stringify(started.error));

  await new Promise((r) => setTimeout(r, 11000));

  // 2. Verify role assignment (1 VIP, 1 Bodyguard)
  const hostState = await rpc<{ players: Array<{ id: string; team: string; secret_role?: string | null }> }>(
    host,
    'get_game_state',
    { game_id: gameId },
  );
  const runners = (hostState.data?.players ?? []).filter((p) => p.team === 'runner');
  const vipRunner = runners.find((p) => p.secret_role === 'vip');
  const bodyguardRunner = runners.find((p) => p.secret_role === 'bodyguard');

  expect(
    Boolean(vipRunner && bodyguardRunner),
    'exactly 1 VIP and 1 Bodyguard assigned among runners',
    JSON.stringify(runners),
  );

  // 3. Verify secrecy: Hunter sees secret_role = null
  const hunterState = await rpc<{ players: Array<{ id: string; team: string; secret_role?: string | null }> }>(
    hunter,
    'get_game_state',
    { game_id: gameId },
  );
  const hunterRunnerViews = (hunterState.data?.players ?? []).filter((p) => p.team === 'runner');
  const hunterSeesNoRoles = hunterRunnerViews.every((p) => p.secret_role === null || p.secret_role === undefined);
  expect(
    hunterSeesNoRoles,
    'hunter cannot see runner secret roles during live play',
    JSON.stringify(hunterRunnerViews),
  );

  const vipClient = vipRunner?.id === hostPid ? host : runner2;
  const bodyguardClient = bodyguardRunner?.id === hostPid ? host : runner2;
  const vipId = vipRunner!.id;
  const bodyguardId = bodyguardRunner!.id;

  // 4. Test Role Swap
  // Both runners submit positions within 2.5m of each other
  await rpc(vipClient, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });
  await rpc(bodyguardClient, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.00002, // ~2.2m
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const requestSwap = await rpc(bodyguardClient, 'request_role_swap', {
    p_game_id: gameId,
    p_target_player_id: vipId,
  });
  expect(!requestSwap.error, 'bodyguard requests role swap with VIP within 5m', JSON.stringify(requestSwap.error));

  const confirmSwap = await rpc(vipClient, 'confirm_role_swap', {
    p_game_id: gameId,
  });
  expect(!confirmSwap.error, 'VIP confirms role swap with bodyguard', JSON.stringify(confirmSwap.error));

  // Verify roles swapped
  const postSwapState = await rpc<{ players: Array<{ id: string; team: string; secret_role?: string | null }> }>(
    host,
    'get_game_state',
    { game_id: gameId },
  );
  const postSwapRunners = (postSwapState.data?.players ?? []).filter((p) => p.team === 'runner');
  const newVip = postSwapRunners.find((p) => p.secret_role === 'vip');
  const newBodyguard = postSwapRunners.find((p) => p.secret_role === 'bodyguard');

  expect(
    newVip?.id === bodyguardId && newBodyguard?.id === vipId,
    'VIP and bodyguard roles successfully swapped between players',
    `new VIP: ${newVip?.id}, new Bodyguard: ${newBodyguard?.id}`,
  );

  const activeVipClient = newVip?.id === hostPid ? host : runner2;
  const activeBodyguardClient = newBodyguard?.id === hostPid ? host : runner2;
  const activeVipId = newVip!.id;
  const activeBodyguardId = newBodyguard!.id;

  // 5. Test Bodyguard Freeze Tag
  // Move active bodyguard to hunter position; move active VIP 100m away
  await rpc(activeVipClient, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.001, // ~111m away
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });
  await rpc(activeBodyguardClient, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.00001,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const freezeTag = await rpc<{ success: boolean; frozen: boolean; frozen_seconds: number; tagged_player_id?: string; runner_id?: string }>(
    hunter,
    'attempt_tag',
    { game_id: gameId },
  );
  expect(
    freezeTag.data?.success === true &&
      freezeTag.data?.frozen === true &&
      (freezeTag.data?.runner_id === activeBodyguardId || freezeTag.data?.tagged_player_id === activeBodyguardId),
    'tagging bodyguard freezes bodyguard for 60s without ending game',
    JSON.stringify(freezeTag.data ?? freezeTag.error),
  );

  // 6. Test Tag Rejection on Frozen Bodyguard
  const repeatTag = await rpc<{ success: boolean; reason: string }>(hunter, 'attempt_tag', { game_id: gameId });
  expect(
    repeatTag.data?.success === false && repeatTag.data?.reason === 'already_frozen',
    'attempting to tag already frozen bodyguard returns already_frozen without penalty',
    JSON.stringify(repeatTag.data ?? repeatTag.error),
  );

  // 7. Test VIP Elimination Tag
  // Move hunter to active VIP position
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.001,
    lng: CENTER.lng,
    accuracy: 5,
    recorded_at: new Date().toISOString(),
  });

  const vipTag = await rpc<{ success: boolean; game_ended?: boolean; phase?: string; winner: string; end_reason: string }>(
    hunter,
    'attempt_tag',
    { game_id: gameId },
  );
  expect(
    vipTag.data?.success === true &&
      (vipTag.data?.phase === 'ended' || vipTag.data?.game_ended === true) &&
      vipTag.data?.winner === 'hunters' &&
      vipTag.data?.end_reason === 'vip_eliminated',
    'tagging VIP triggers immediate hunter victory with vip_eliminated',
    JSON.stringify(vipTag.data ?? vipTag.error),
  );

  // 8. Verify post-game secrecy lifted
  const endedHunterState = await rpc<{ players: Array<{ id: string; team: string; secret_role?: string | null }> }>(
    hunter,
    'get_game_state',
    { game_id: gameId },
  );
  const endedRunners = (endedHunterState.data?.players ?? []).filter((p) => p.team === 'runner');
  const allRolesRevealed = endedRunners.every((p) => p.secret_role === 'vip' || p.secret_role === 'bodyguard');
  expect(
    allRolesRevealed,
    'post-game state reveals all secret roles to hunters',
    JSON.stringify(endedRunners),
  );

  for (const client of [host, runner2, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

async function operatorScenario() {
  console.log('\n--- operatorScenario (B5: Operator Remote Role Add-on) ---');
  const host = await newPlayer('OpHost');
  const runnerOp = await newPlayer('OpRunnerOp');
  const hunterField = await newPlayer('OpHunterField');
  const hunterOp = await newPlayer('OpHunterOp');

  // 1. Create a game with Operator role enabled
  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'tag_hunt',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 500,
    settings: {
      roles: ['operator'],
      head_start_s: 0,
      ping_interval_s: 30,
    },
  });
  const gameId = created.data?.[0]?.game_id;
  const code = created.data?.[0]?.code;
  expect(Boolean(gameId), 'create classic chase game with operator role', JSON.stringify(created.error));
  if (!gameId || !code) return;

  // 2. Join players to lobby
  await rpc(runnerOp, 'join_game', { code });
  await rpc(hunterField, 'join_game', { code });
  await rpc(hunterOp, 'join_game', { code });

  const hostPid = await playerId(host, gameId);
  const runnerOpPid = await playerId(runnerOp, gameId);
  const hunterFieldPid = await playerId(hunterField, gameId);
  const hunterOpPid = await playerId(hunterOp, gameId);

  await rpc(host, 'set_team', { game_id: gameId, player_id: hostPid, team: 'runner' });
  await rpc(runnerOp, 'set_team', { game_id: gameId, player_id: runnerOpPid, team: 'runner' });
  await rpc(hunterField, 'set_team', { game_id: gameId, player_id: hunterFieldPid, team: 'hunter' });
  await rpc(hunterOp, 'set_team', { game_id: gameId, player_id: hunterOpPid, team: 'hunter' });

  // 3. Test Lobby Designation & Squad Limit
  const setRunnerOpRes = await rpc(runnerOp, 'set_player_remote', {
    p_game_id: gameId,
    p_is_remote: true,
  });
  expect(!setRunnerOpRes.error, 'runner designates remote operator', JSON.stringify(setRunnerOpRes.error));

  const setHunterOpRes = await rpc(hunterOp, 'set_player_remote', {
    p_game_id: gameId,
    p_is_remote: true,
  });
  expect(!setHunterOpRes.error, 'hunter designates remote operator', JSON.stringify(setHunterOpRes.error));

  // Limit check: second operator on runner squad is blocked
  const secondOpRes = await rpc(host, 'set_player_remote', {
    p_game_id: gameId,
    p_is_remote: true,
  });
  expect(Boolean(secondOpRes.error), 'second operator per squad blocked', 'unexpectedly allowed');

  // Ready-up and start game
  for (const client of [host, runnerOp, hunterField, hunterOp]) {
    await rpc(client, 'set_share_trail', { game_id: gameId, share: true });
    await rpc(client, 'set_ready', { game_id: gameId, ready: true });
  }

  const startRes = await rpc(host, 'start_game', { game_id: gameId });
  expect(!startRes.error, 'start_game succeeds with field + remote players', JSON.stringify(startRes.error));

  // Wait countdown to expire
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(host, 'advance_game', { game_id: gameId });

  // 4. Test State and Role Exposure in get_game_state
  const runnerOpState = await rpc<{
    operator?: { is_operator: boolean };
    markers?: Array<{ id: string; label: string }>;
  }>(runnerOp, 'get_game_state', { game_id: gameId });
  expect(
    runnerOpState.data?.operator?.is_operator === true,
    'remote player sees is_operator: true in round state',
    JSON.stringify(runnerOpState.data?.operator ?? runnerOpState.error),
  );

  // Field player (host) submits GPS fix
  const hostFix = await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.0001,
    lng: CENTER.lng + 0.0001,
    accuracy: 5,
  });
  expect(!hostFix.error, 'field runner submits valid GPS fix', JSON.stringify(hostFix.error));

  // Hunter field submits GPS fix
  const hunterFix = await rpc(hunterField, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.0003,
    lng: CENTER.lng + 0.0003,
    accuracy: 5,
  });
  expect(!hunterFix.error, 'field hunter submits valid GPS fix', JSON.stringify(hunterFix.error));

  // 5. Test Tactical Markers (Placement, Pruning, Clearing)
  const m1 = await rpc<{ marker_id: string }>(runnerOp, 'place_marker', {
    p_game_id: gameId,
    p_lat: CENTER.lat + 0.0002,
    p_lng: CENTER.lng + 0.0002,
    p_label: 'Marker Alpha',
  });
  expect(Boolean(m1.data?.marker_id), 'operator places marker 1', JSON.stringify(m1.data ?? m1.error));

  const m2 = await rpc<{ marker_id: string }>(runnerOp, 'place_marker', {
    p_game_id: gameId,
    p_lat: CENTER.lat + 0.0003,
    p_lng: CENTER.lng + 0.0003,
    p_label: 'Marker Bravo',
  });
  expect(Boolean(m2.data?.marker_id), 'operator places marker 2', JSON.stringify(m2.data ?? m2.error));

  const m3 = await rpc<{ marker_id: string }>(runnerOp, 'place_marker', {
    p_game_id: gameId,
    p_lat: CENTER.lat + 0.0004,
    p_lng: CENTER.lng + 0.0004,
    p_label: 'Marker Charlie',
  });
  expect(Boolean(m3.data?.marker_id), 'operator places marker 3', JSON.stringify(m3.data ?? m3.error));

  // Placing 4th marker automatically prunes oldest (marker 1) to respect max 3 per squad
  const m4 = await rpc<{ marker_id: string }>(runnerOp, 'place_marker', {
    p_game_id: gameId,
    p_lat: CENTER.lat + 0.0005,
    p_lng: CENTER.lng + 0.0005,
    p_label: 'Marker Delta',
  });
  expect(Boolean(m4.data?.marker_id), 'operator places marker 4 (prunes oldest)', JSON.stringify(m4.data ?? m4.error));

  const hostStateAfterMarkers = await rpc<{ markers?: Array<{ id: string; label: string }> }>(
    host,
    'get_game_state',
    { game_id: gameId },
  );
  const activeMarkers = hostStateAfterMarkers.data?.markers ?? [];
  expect(
    activeMarkers.length === 3 && !activeMarkers.some((m) => m.id === m1.data?.marker_id),
    'max 3 active team markers maintained (oldest pruned)',
    JSON.stringify(activeMarkers),
  );

  // Clear marker manually
  const clearRes = await rpc(runnerOp, 'clear_marker', {
    p_game_id: gameId,
    p_marker_id: m4.data?.marker_id,
  });
  expect(!clearRes.error, 'operator clears tactical marker', JSON.stringify(clearRes.error));

  // 6. Test Tactical Comms
  const commsRes = await rpc(runnerOp, 'send_operator_message', {
    p_game_id: gameId,
    p_message: 'Move south to extraction corridor',
  });
  expect(!commsRes.error, 'operator sends tactical broadcast message', JSON.stringify(commsRes.error));

  // 7. Test Reconnaissance Scans
  // Runner operator scan produces 150m vague envelope
  const sweepRes = await rpc<{
    scan_type: string;
    found: boolean;
    radius_m: number;
    latitude: number;
    longitude: number;
  }>(runnerOp, 'operator_scan', { p_game_id: gameId });
  expect(
    sweepRes.data?.scan_type === 'runner_sweep' && sweepRes.data?.found === true && sweepRes.data?.radius_m === 150,
    'runner operator sweep detects hunter within 150m envelope',
    JSON.stringify(sweepRes.data ?? sweepRes.error),
  );

  // Runner operator scan on cooldown
  const sweepCooldown = await rpc(runnerOp, 'operator_scan', { p_game_id: gameId });
  expect(
    Boolean(sweepCooldown.error) && /cooldown/i.test(sweepCooldown.error?.message ?? ''),
    'runner operator scan blocked by 90s cooldown',
    JSON.stringify(sweepCooldown.error ?? sweepCooldown.data),
  );

  // Hunter operator census scan returns integer count within 200m
  const censusRes = await rpc<{
    scan_type: string;
    count: number;
    radius_m: number;
  }>(hunterOp, 'operator_scan', {
    p_game_id: gameId,
    p_lat: CENTER.lat,
    p_lng: CENTER.lng,
  });
  expect(
    censusRes.data?.scan_type === 'hunter_census' && censusRes.data?.count >= 1 && censusRes.data?.radius_m === 200,
    'hunter operator census returns runner count within 200m',
    JSON.stringify(censusRes.data ?? censusRes.error),
  );

  // 8. Test Operator Immunity
  const directTagRemote = await rpc(hunterField, 'attempt_tag', {
    p_game_id: gameId,
    p_runner_id: runnerOpPid,
    p_hunter_lat: CENTER.lat + 0.0003,
    p_hunter_lng: CENTER.lng + 0.0003,
  });
  expect(
    Boolean(directTagRemote.error),
    'attempt_tag on remote operator is rejected',
    JSON.stringify(directTagRemote.error ?? directTagRemote.data),
  );

  for (const client of [host, runnerOp, hunterField, hunterOp]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

async function ghostDuelScenario() {
  console.log('\n--- Scenario: ghost-duel (Phase B Milestone B6: Solo Ghost Duel) ---');
  const soloRunner = await newPlayer('SoloSpeedster');

  // 1. Time Trial Variant: 1-Player Creation and Solo Start
  const created = await rpc<{ game_id: string; code: string }[]>(soloRunner, 'create_game', {
    mode: 'ghost_duel',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      head_start_s: 0,
      duration_s: 300,
      ping_interval_s: 30,
      mode_params: { ghost_duel: { variant: 'time_trial' } },
    },
  });

  if (created.error || !created.data?.[0]?.game_id) {
    throw new Error(`ghost_duel create failed: ${created.error?.message}`);
  }
  const gameId = created.data[0].game_id;

  await rpc(soloRunner, 'set_share_trail', { game_id: gameId, share: true });
  await rpc(soloRunner, 'set_ready', { game_id: gameId, ready: true });

  const startRes = await rpc<Record<string, unknown>>(soloRunner, 'start_game', { game_id: gameId });
  expect(
    !startRes.error && startRes.data?.status === 'countdown',
    'Solo Ghost Duel starts in countdown with 1 player',
    String(startRes.error?.message ?? startRes.data?.status),
  );

  // Fast forward past countdown to live
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(soloRunner, 'advance_game', { game_id: gameId });

  // 2. Verify state includes ghost_duel snapshot with target and ghost
  const gameStateRes = await rpc<{
    game: { status: string; mode_id: string };
    ghost_duel?: {
      variant: string;
      target?: { latitude: number; longitude: number; radius_m: number };
      ghost?: { latitude: number; longitude: number; duration_s: number; elapsed_s: number };
    };
  }>(soloRunner, 'get_game_state', { game_id: gameId });

  expect(
    gameStateRes.data?.game?.status === 'live',
    'Ghost Duel game transitions to live phase',
    JSON.stringify(gameStateRes.data?.game),
  );

  expect(
    gameStateRes.data?.ghost_duel?.variant === 'time_trial' &&
      Boolean(gameStateRes.data?.ghost_duel?.target) &&
      Boolean(gameStateRes.data?.ghost_duel?.ghost),
    'Ghost Duel state returns variant, target entity, and ghost entity',
    JSON.stringify(gameStateRes.data?.ghost_duel),
  );

  const targetLat = gameStateRes.data?.ghost_duel?.target?.latitude ?? CENTER.lat;
  const targetLng = gameStateRes.data?.ghost_duel?.target?.longitude ?? CENTER.lng;

  // 3. Step ghost position in advance_game
  await rpc(soloRunner, 'advance_game', { game_id: gameId });

  // Initial fix
  await rpc(soloRunner, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 3,
    recorded_at: new Date().toISOString(),
  });

  // 4. Submit player position reaching finish target -> ghost beaten!
  const finishPosRes = await rpc<{
    phase: string;
    target_reached?: boolean;
    end_reason?: string;
  }>(soloRunner, 'submit_position', {
    game_id: gameId,
    lat: targetLat,
    lng: targetLng,
    accuracy: 3,
    recorded_at: new Date().toISOString(),
  });

  expect(
    finishPosRes.data?.phase === 'ended',
    'Reaching finish target ends the ghost duel round',
    JSON.stringify(finishPosRes.data ?? finishPosRes.error),
  );

  // 5. Verify ghost_duel_scores row and leaderboard
  const scoreRowRes = await soloRunner
    .from('ghost_duel_scores')
    .select('*')
    .eq('game_id', gameId)
    .maybeSingle();

  expect(
    Boolean(scoreRowRes.data?.score) && scoreRowRes.data?.variant === 'time_trial',
    'ghost_duel_scores record created with score and metrics',
    JSON.stringify(scoreRowRes.data),
  );

  const leaderboardRes = await rpc<
    { rank: number; display_name: string; score: number; variant: string }[]
  >(soloRunner, 'get_ghost_duel_leaderboard', {
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 5000,
    variant: 'time_trial',
    row_limit: 5,
  });

  expect(
    Array.isArray(leaderboardRes.data) && leaderboardRes.data.length > 0,
    'get_ghost_duel_leaderboard returns top scores honoring consent',
    JSON.stringify(leaderboardRes.data ?? leaderboardRes.error),
  );

  await rpc(soloRunner, 'leave_game', { game_id: gameId });

  // 6. Test Mirror Chase Variant: Solo hunter tags ghost runner
  const soloHunter = await newPlayer('GhostCatcher');
  const mcCreated = await rpc<{ game_id: string; code: string }[]>(soloHunter, 'create_game', {
    mode: 'ghost_duel',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      head_start_s: 0,
      duration_s: 300,
      ping_interval_s: 30,
      mode_params: { ghost_duel: { variant: 'mirror_chase' } },
    },
  });

  if (mcCreated.error || !mcCreated.data?.[0]?.game_id) {
    throw new Error(`mirror_chase create failed: ${mcCreated.error?.message}`);
  }
  const mcGameId = mcCreated.data[0].game_id;

  await rpc(soloHunter, 'set_share_trail', { game_id: mcGameId, share: true });
  await rpc(soloHunter, 'set_ready', { game_id: mcGameId, ready: true });
  await rpc(soloHunter, 'start_game', { game_id: mcGameId });
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(soloHunter, 'advance_game', { game_id: mcGameId });

  const mcStateRes = await rpc<{
    ghost_duel?: {
      ghost?: { latitude: number; longitude: number };
    };
  }>(soloHunter, 'get_game_state', { game_id: mcGameId });

  const ghostLat = mcStateRes.data?.ghost_duel?.ghost?.latitude ?? CENTER.lat;
  const ghostLng = mcStateRes.data?.ghost_duel?.ghost?.longitude ?? CENTER.lng;

  // Submit hunter position right next to ghost (within 5m)
  await rpc(soloHunter, 'submit_position', {
    game_id: mcGameId,
    lat: ghostLat,
    lng: ghostLng,
    accuracy: 2,
    recorded_at: new Date().toISOString(),
  });

  const tagRes = await rpc<{
    success: boolean;
    score: number;
    game_ended: boolean;
  }>(soloHunter, 'tag_ghost', { game_id: mcGameId });

  expect(
    tagRes.data?.success === true && tagRes.data?.game_ended === true,
    'tag_ghost successfully catches ghost runner and ends game',
    JSON.stringify(tagRes.data ?? tagRes.error),
  );

  const mcGameCheck = await soloHunter
    .from('games')
    .select('status, end_reason')
    .eq('id', mcGameId)
    .single();

  expect(
    mcGameCheck.data?.status === 'ended' && mcGameCheck.data?.end_reason === 'ghost_tagged',
    'Mirror chase ends with end_reason ghost_tagged',
    JSON.stringify(mcGameCheck.data),
  );

  await rpc(soloHunter, 'leave_game', { game_id: mcGameId });

  // 7. Test Evade Variant: Runner caught by ghost hunter within 20m -> haunted
  const soloEvader = await newPlayer('GhostDodger');
  const evCreated = await rpc<{ game_id: string; code: string }[]>(soloEvader, 'create_game', {
    mode: 'ghost_duel',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      head_start_s: 0,
      duration_s: 300,
      ping_interval_s: 30,
      mode_params: { ghost_duel: { variant: 'evade' } },
    },
  });

  if (evCreated.error || !evCreated.data?.[0]?.game_id) {
    throw new Error(`evade create failed: ${evCreated.error?.message}`);
  }
  const evGameId = evCreated.data[0].game_id;

  await rpc(soloEvader, 'set_share_trail', { game_id: evGameId, share: true });
  await rpc(soloEvader, 'set_ready', { game_id: evGameId, ready: true });
  await rpc(soloEvader, 'start_game', { game_id: evGameId });
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(soloEvader, 'advance_game', { game_id: evGameId });

  const evStateRes = await rpc<{
    ghost_duel?: {
      ghost?: { latitude: number; longitude: number };
    };
  }>(soloEvader, 'get_game_state', { game_id: evGameId });

  const hunterGhostLat = evStateRes.data?.ghost_duel?.ghost?.latitude ?? CENTER.lat;
  const hunterGhostLng = evStateRes.data?.ghost_duel?.ghost?.longitude ?? CENTER.lng;

  // Submit position right next to ghost hunter (< 20m)
  const evadeCaughtRes = await rpc<{
    phase: string;
  }>(soloEvader, 'submit_position', {
    game_id: evGameId,
    lat: hunterGhostLat,
    lng: hunterGhostLng,
    accuracy: 2,
    recorded_at: new Date().toISOString(),
  });

  expect(
    evadeCaughtRes.data?.phase === 'ended',
    'Ghost hunter catching runner in evade ends round with haunted',
    JSON.stringify(evadeCaughtRes.data ?? evadeCaughtRes.error),
  );

  const evGameCheck = await soloEvader
    .from('games')
    .select('status, end_reason, winner')
    .eq('id', evGameId)
    .single();

  expect(
    evGameCheck.data?.status === 'ended' &&
      evGameCheck.data?.end_reason === 'haunted' &&
      evGameCheck.data?.winner === 'hunters',
    'Evade collision ends with end_reason haunted and hunters victory',
    JSON.stringify(evGameCheck.data),
  );

  await rpc(soloEvader, 'leave_game', { game_id: evGameId });
}

async function territoryPulseScenario() {
  console.log('\n--- territoryPulseScenario (B8: Territory Pulse Base Mode) ---');
  const host = await newPlayer('TerritoryHost');
  const runner2 = await newPlayer('TerritoryRunner2');
  const hunter = await newPlayer('TerritoryHunter');

  // 1. Create a Territory Pulse game with 2s pulse interval for simulation testing
  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'territory_pulse',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 300,
    settings: {
      duration_s: 300,
      head_start_s: 0,
      ping_interval_s: 30,
      mode_params: {
        territory_pulse: {
          pulse_interval_s: 2,
        },
      },
    },
  });

  const gameId = created.data?.[0]?.game_id;
  const code = created.data?.[0]?.code;
  if (!gameId || !code) {
    fail('territory_pulse_creation', 'Failed to create game: ' + JSON.stringify(created.error));
    return;
  }
  pass('create territory_pulse game');

  // 2. Join players into teams and mark ready
  await rpc(runner2, 'join_game', { code });
  await rpc(hunter, 'join_game', { code });

  const hostPid = await playerId(host, gameId);
  const runner2Pid = await playerId(runner2, gameId);
  const hunterPid = await playerId(hunter, gameId);

  await rpc(host, 'set_team', { game_id: gameId, player_id: hostPid, team: 'runner' });
  await rpc(runner2, 'set_team', { game_id: gameId, player_id: runner2Pid, team: 'runner' });
  await rpc(hunter, 'set_team', { game_id: gameId, player_id: hunterPid, team: 'hunter' });

  for (const client of [host, runner2, hunter]) {
    await rpc(client, 'set_share_trail', { game_id: gameId, share: true });
    await rpc(client, 'set_ready', { game_id: gameId, ready: true });
  }

  // 3. Start game and transition past countdown to live
  const startRes = await rpc<Record<string, unknown>>(host, 'start_game', { game_id: gameId });
  expect(
    !startRes.error && startRes.data?.status === 'countdown',
    'territory_pulse starts in countdown',
    String(startRes.error?.message ?? startRes.data?.status),
  );

  await new Promise((r) => setTimeout(r, 11000));
  await rpc(host, 'advance_game', { game_id: gameId });

  // 4. Verify initial Territory Pulse state and 7 spawned zones
  type TerritorySnapshot = {
    territory_pulse?: {
      pulse_seq: number;
      pulse_interval_s: number;
      scores: { runner: number; hunter: number };
      zones: Array<{
        id: string;
        name: string;
        zone_index: number;
        latitude: number;
        longitude: number;
        radius_m: number;
        controller: string | null;
        contender: string | null;
        contender_pulses: number;
      }>;
    };
    game: { status: string };
  };

  const initState = await rpc<TerritorySnapshot>(host, 'get_game_state', { game_id: gameId });
  const tp = initState.data?.territory_pulse;

  expect(
    initState.data?.game.status === 'live',
    'game transitioned to live',
    initState.data?.game.status ?? 'unknown',
  );
  expect(
    Array.isArray(tp?.zones) && tp!.zones.length === 7,
    '7 territory sectors spawned (Sector Core + 6 radial)',
    String(tp?.zones?.length),
  );
  expect(
    tp?.zones[0]?.name === 'Core' && tp?.zones[0]?.controller === null,
    'Sector Core spawned in neutral control',
    JSON.stringify(tp?.zones?.[0]),
  );

  // 5. Place host inside Sector Core and hunter & runner2 far away; trigger pulse
  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 2,
    recorded_at: new Date().toISOString(),
  });
  await rpc(runner2, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.05,
    lng: CENTER.lng + 0.05,
    accuracy: 2,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.05,
    lng: CENTER.lng + 0.05,
    accuracy: 2,
    recorded_at: new Date().toISOString(),
  });

  // Wait for 2s pulse interval
  await new Promise((r) => setTimeout(r, 2500));
  await rpc(host, 'advance_game', { game_id: gameId });

  const pulse1State = await rpc<TerritorySnapshot>(host, 'get_game_state', { game_id: gameId });
  const pulse1Tp = pulse1State.data?.territory_pulse;

  expect(
    pulse1Tp?.zones[0]?.controller === 'runner',
    'runner presence in neutral Sector Core captures it on pulse',
    JSON.stringify(pulse1Tp?.zones?.[0]),
  );
  expect(
    (pulse1Tp?.scores.runner ?? 0) >= 1,
    'runner score incremented for holding Sector Core',
    JSON.stringify(pulse1Tp?.scores),
  );

  // 6. Test Contest Tag: Move host far away, bring runner2 and hunter to Sector Core
  await rpc(host, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.05,
    lng: CENTER.lng + 0.05,
    accuracy: 2,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 2,
    recorded_at: new Date().toISOString(),
  });
  await rpc(runner2, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 2,
    recorded_at: new Date().toISOString(),
  });

  const tagRes = await rpc<{
    success: boolean;
    runner_id?: string;
    incapacitated?: boolean;
    incapacitated_seconds?: number;
  }>(hunter, 'attempt_tag', { game_id: gameId });

  expect(
    tagRes.data?.success === true &&
      tagRes.data?.incapacitated === true &&
      tagRes.data?.incapacitated_seconds === 60 &&
      tagRes.data?.runner_id === runner2Pid,
    'contest tag incapacitates runner2 for 60 seconds without ending game',
    JSON.stringify(tagRes.data ?? tagRes.error),
  );

  // 7. Verify incapacitated runner does not contribute to sector majority
  // Host is far away; runner2 is at Sector Core but incapacitated; hunter is at Sector Core
  await rpc(runner2, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 2,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 2,
    recorded_at: new Date().toISOString(),
  });

  // Pulse 2: Hunter alone has active presence (runner2 incapacitated). Sector becomes contested!
  await new Promise((r) => setTimeout(r, 2500));
  await rpc(host, 'advance_game', { game_id: gameId });

  const contestState = await rpc<TerritorySnapshot>(host, 'get_game_state', { game_id: gameId });
  const contestCore = contestState.data?.territory_pulse?.zones[0];

  expect(
    contestCore?.controller === 'runner' &&
      contestCore?.contender === 'hunter' &&
      contestCore?.contender_pulses === 1,
    'hunter majority marks runner sector as contested across 1st pulse',
    JSON.stringify(contestCore),
  );

  // Pulse 3: 2nd consecutive hunter pulse flips sector control
  await rpc(hunter, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 2,
    recorded_at: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 2500));
  await rpc(host, 'advance_game', { game_id: gameId });

  const flippedState = await rpc<TerritorySnapshot>(host, 'get_game_state', { game_id: gameId });
  const flippedCore = flippedState.data?.territory_pulse?.zones[0];

  expect(
    flippedCore?.controller === 'hunter' && flippedCore?.contender === null,
    'hunter majority flips sector to hunter control on 2nd pulse',
    JSON.stringify(flippedCore),
  );
  expect(
    (flippedState.data?.territory_pulse?.scores.hunter ?? 0) >= 1,
    'hunter score incremented after flipping Sector Core',
    JSON.stringify(flippedState.data?.territory_pulse?.scores),
  );

  // Cleanup
  for (const client of [host, runner2, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

async function safetyGuardScenario() {
  console.log('\n--- safetyGuardScenario (C1: Speed & Safety Guard) ---');
  const host = await newPlayer('SafetyHost');
  const runner = await newPlayer('SafetyRunner');
  const hunter = await newPlayer('SafetyHunter');

  // 1. Create a game with short curfew (45 seconds in the future) for curfew test
  const curfewDate = new Date(Date.now() + 45000).toISOString();
  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'tag_hunt',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 400,
    settings: {
      duration_s: 300,
      head_start_s: 0,
      ping_interval_s: 30,
      mode_params: {
        safety: {
          curfew_at: curfewDate,
        },
      },
    },
  });

  const gameId = created.data?.[0]?.game_id;
  const code = created.data?.[0]?.code;
  if (!gameId || !code) {
    fail('safety_guard_creation', 'Failed to create game: ' + JSON.stringify(created.error));
    return;
  }
  pass('create game with safety parameters');

  await rpc(runner, 'join_game', { code });
  await rpc(hunter, 'join_game', { code });

  const hostPid = await playerId(host, gameId);
  const runnerPid = await playerId(runner, gameId);
  const hunterPid = await playerId(hunter, gameId);

  await rpc(host, 'set_team', { game_id: gameId, player_id: hostPid, team: 'hunter' });
  await rpc(runner, 'set_team', { game_id: gameId, player_id: runnerPid, team: 'runner' });
  await rpc(hunter, 'set_team', { game_id: gameId, player_id: hunterPid, team: 'hunter' });

  for (const client of [host, runner, hunter]) {
    await rpc(client, 'set_share_trail', { game_id: gameId, share: true });
    await rpc(client, 'set_ready', { game_id: gameId, ready: true });
  }

  // Start game and wait 11s past countdown to live
  await rpc(host, 'start_game', { game_id: gameId });
  await new Promise((r) => setTimeout(r, 11000));
  await rpc(host, 'advance_game', { game_id: gameId });

  type SafetySnapshot = {
    game: { status: string; end_reason?: string | null };
    safety?: {
      is_paused: boolean;
      paused_by?: string | null;
      paused_by_name?: string | null;
      pause_reason?: string | null;
      pause_votes?: Record<string, boolean>;
      curfew_at?: string | null;
      is_night?: boolean;
      vehicle_warning?: boolean;
    };
  };

  let state = await rpc<SafetySnapshot>(host, 'get_game_state', { game_id: gameId });
  expect(state.data?.game.status === 'live', 'game is live', state.data?.game.status ?? 'unknown');
  expect(state.data?.safety?.is_paused === false, 'safety initial is_paused is false', String(state.data?.safety?.is_paused));
  expect(Boolean(state.data?.safety?.curfew_at), 'curfew_at is populated in safety snapshot', String(state.data?.safety?.curfew_at));

  // --- Test 1: Immediate Safety Pause ---
  const pauseRes = await rpc<{ success: boolean }>(runner, 'pause_game', {
    game_id: gameId,
    reason: 'twisted_ankle',
  });
  expect(pauseRes.data?.success === true, 'runner paused game for twisted ankle', JSON.stringify(pauseRes));

  state = await rpc<SafetySnapshot>(host, 'get_game_state', { game_id: gameId });
  expect(state.data?.game.status === 'paused', 'game status is paused', state.data?.game.status ?? 'unknown');
  expect(state.data?.safety?.is_paused === true, 'safety.is_paused is true', String(state.data?.safety?.is_paused));
  expect(state.data?.safety?.pause_reason === 'twisted_ankle', 'safety.pause_reason matches', String(state.data?.safety?.pause_reason));
  expect(state.data?.safety?.paused_by_name === 'SafetyRunner', 'safety.paused_by_name matches', String(state.data?.safety?.paused_by_name));

  // Verify advance_game does not alter paused state
  await rpc(host, 'advance_game', { game_id: gameId });
  state = await rpc<SafetySnapshot>(host, 'get_game_state', { game_id: gameId });
  expect(state.data?.game.status === 'paused', 'advance_game preserves paused state', state.data?.game.status ?? 'unknown');

  // --- Test 2: Resume Game ---
  const resumeRes = await rpc<{ success: boolean; phase: string }>(hunter, 'resume_game', {
    game_id: gameId,
  });
  expect(resumeRes.data?.success === true && resumeRes.data?.phase === 'live', 'hunter resumed game back to live', JSON.stringify(resumeRes));

  state = await rpc<SafetySnapshot>(host, 'get_game_state', { game_id: gameId });
  expect(state.data?.game.status === 'live', 'game status is back to live after resume', state.data?.game.status ?? 'unknown');
  expect(state.data?.safety?.is_paused === false, 'safety.is_paused is false after resume', String(state.data?.safety?.is_paused));

  // --- Test 3: Majority Vote Pause ---
  // Active field players = 3, majority needed = ceil(3/2) = 2
  const vote1 = await rpc<{ success: boolean; paused: boolean; yes_votes: number; needed: number }>(
    runner,
    'vote_pause_game',
    { game_id: gameId, vote: true },
  );
  expect(vote1.data?.paused === false && vote1.data?.yes_votes === 1, '1 vote does not trigger pause (needs 2)', JSON.stringify(vote1.data));

  const vote2 = await rpc<{ success: boolean; paused: boolean; yes_votes: number; needed: number }>(
    hunter,
    'vote_pause_game',
    { game_id: gameId, vote: true },
  );
  expect(vote2.data?.paused === true && vote2.data?.yes_votes === 2, '2nd vote triggers auto-pause by majority', JSON.stringify(vote2.data));

  state = await rpc<SafetySnapshot>(host, 'get_game_state', { game_id: gameId });
  expect(state.data?.game.status === 'paused', 'game is paused after majority vote', state.data?.game.status ?? 'unknown');
  expect(state.data?.safety?.pause_reason === 'majority_safety_vote', 'pause reason is majority_safety_vote', state.data?.safety?.pause_reason ?? 'unknown');

  // Resume game
  await rpc(host, 'resume_game', { game_id: gameId });

  // --- Test 4: SOS Auto-Pause ---
  const sosRes = await rpc<{ success: boolean }>(runner, 'send_sos', { game_id: gameId });
  expect(!sosRes.error, 'send_sos succeeds', JSON.stringify(sosRes));

  state = await rpc<SafetySnapshot>(host, 'get_game_state', { game_id: gameId });
  expect(state.data?.game.status === 'paused', 'SOS auto-pauses the game', state.data?.game.status ?? 'unknown');
  expect(state.data?.safety?.pause_reason === 'emergency_sos', 'safety pause reason is emergency_sos', state.data?.safety?.pause_reason ?? 'unknown');

  // Resume game so we can test vehicle warning and curfew
  await rpc(host, 'resume_game', { game_id: gameId });

  // --- Test 5: Vehicle Speed Warning in submit_position ---
  // Submit fix 1 with speed = 12 m/s
  const now = Date.now();
  await rpc(runner, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
    accuracy: 3,
    speed: 12.0,
    heading: 0,
    recorded_at: new Date(now - 12000).toISOString(),
  });
  // Submit fix 2 (12s later, sustained high speed)
  const speedRes = await rpc<{ vehicle_warning?: boolean }>(runner, 'submit_position', {
    game_id: gameId,
    lat: CENTER.lat + 0.001,
    lng: CENTER.lng + 0.001,
    accuracy: 3,
    speed: 12.0,
    heading: 45,
    recorded_at: new Date(now).toISOString(),
  });
  expect(speedRes.data?.vehicle_warning === true, 'submit_position flags sustained vehicle speed (>8 m/s)', JSON.stringify(speedRes.data));

  state = await rpc<SafetySnapshot>(runner, 'get_game_state', { game_id: gameId });
  expect(state.data?.safety?.vehicle_warning === true, 'safety snapshot reflects vehicle_warning for runner', String(state.data?.safety?.vehicle_warning));

  // --- Test 6: Curfew Deadline ---
  // Read current curfew and wait until it elapses
  const currentCurfewAt = state.data?.safety?.curfew_at;
  const curfewTime = currentCurfewAt ? Date.parse(currentCurfewAt) : Date.now();
  const remaining = curfewTime - Date.now();
  if (remaining > 0) {
    await new Promise((r) => setTimeout(r, remaining + 1000));
  }
  await rpc(host, 'advance_game', { game_id: gameId });

  state = await rpc<SafetySnapshot>(host, 'get_game_state', { game_id: gameId });
  expect(
    state.data?.game.status === 'ended' && state.data?.game.end_reason === 'curfew_reached',
    'game ended with curfew_reached after curfew deadline expired',
    JSON.stringify(state.data?.game),
  );

  // Cleanup
  for (const client of [host, runner, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
  }
}

const SCENARIOS: Record<string, () => Promise<void>> = {
  'mode-framework': modeFrameworkScenario,
  modifiers: modifiersScenario,
  'hot-cold': hotColdScenario,
  'double-agent': doubleAgentScenario,
  'recap-stats': recapStatsScenario,
  'haunted-map': hauntedMapScenario,
  'ghost-contribution': ghostContributionScenario,
  's1-security-timing': s1SecurityTimingScenario,
  jailbreak: jailbreakScenario,
  'assassin-ring': assassinRingScenario,
  'relay-heist': relayHeistScenario,
  'vip-escort': vipEscortScenario,
  operator: operatorScenario,
  'ghost-duel': ghostDuelScenario,
  'territory-pulse': territoryPulseScenario,
  'safety-guard': safetyGuardScenario,
};

async function main() {
  const requested = process.argv[2];
  const names = !requested || requested === 'all' ? Object.keys(SCENARIOS) : [requested];
  for (const name of names) {
    const scenario = SCENARIOS[name];
    if (!scenario)
      throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}, all`);
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

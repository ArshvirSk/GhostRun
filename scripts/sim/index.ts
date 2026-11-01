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

const SCENARIOS: Record<string, () => Promise<void>> = {
  'mode-framework': modeFrameworkScenario,
  modifiers: modifiersScenario,
  'hot-cold': hotColdScenario,
  'double-agent': doubleAgentScenario,
  'recap-stats': recapStatsScenario,
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

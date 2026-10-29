/**
 * End-to-end access check for the lobby, target-selection, round-start and live
 * location rules.
 *
 * Creates three anonymous players (host/runner, hunter, outsider) against the
 * configured Supabase project, plays the lobby through target selection and the
 * countdown, uploads live positions, waits for a scheduled ping round, tags the
 * last runner, and wins a separate Classic round by reaching the target. It
 * asserts that the secrecy, start, ping and ending rules hold for the real anon
 * key, and that the phase clock advances from stored timestamps.
 *
 * Run with:
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     npx tsx scripts/rls-check.ts
 *
 * The app signs players in anonymously, so this script uses anonymous sign-ins by
 * default. If Anonymous sign-ins are disabled in the project, set
 * SUPABASE_SERVICE_ROLE_KEY so the script can mint confirmed throwaway accounts
 * through the admin API instead. The service-role key is read from the
 * environment only: never commit it or embed it in the app.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL and/or EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}

const CENTER = { lat: 37.7749, lng: -122.4194 };
const failures: string[] = [];

function pass(label: string, detail = '') {
  console.log(`PASS ${label}${detail ? ` (${detail})` : ''}`);
}

function fail(label: string, detail: string) {
  failures.push(`${label}: ${detail}`);
  console.error(`FAIL ${label} (${detail})`);
}

function expect(condition: boolean, label: string, detail: string) {
  if (condition) pass(label);
  else fail(label, detail);
}

function expectEmpty(rows: unknown[] | null, label: string) {
  expect((rows?.length ?? 0) === 0, label, `expected no rows, got ${rows?.length ?? 0}`);
}

function expectRows(rows: unknown[] | null, label: string) {
  expect((rows?.length ?? 0) > 0, label, 'expected at least one visible row');
}
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function publicClient() {
  return createClient(url!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function withProfile(client: SupabaseClient, displayName: string) {
  const { error: profileError } = await client.rpc('upsert_profile', {
    name: displayName,
    color: '#1D4ED8',
  });
  if (profileError) {
    throw new Error(`Profile creation failed for ${displayName}: ${profileError.message}`);
  }
  return client;
}

/** Throwaway confirmed account, minted with the service-role key (server side only). */
async function adminClient(displayName: string): Promise<SupabaseClient> {
  const admin = createClient(url!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `rls-${displayName.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@ghostrun.test`;
  const password = `rls-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw new Error(`Test account creation failed: ${createError.message}`);

  const client = publicClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Test account sign-in failed: ${signInError.message}`);
  return withProfile(client, displayName);
}

async function anonymousClient(displayName: string): Promise<SupabaseClient> {
  if (serviceRoleKey) return adminClient(displayName);
  const client = publicClient();
  const { error: authError } = await client.auth.signInAnonymously();
  if (authError) {
    throw new Error(
      `Anonymous sign-in failed for ${displayName}: ${authError.message}. ` +
        'Enable Anonymous sign-ins in Supabase Auth (the app needs it too), or set SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  return withProfile(client, displayName);
}

async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args);
  return { data: data as T, error };
}

async function userId(client: SupabaseClient) {
  const { data } = await client.auth.getUser();
  if (!data.user) throw new Error('Test client has no user session.');
  return data.user.id;
}

async function main() {
  const host = await anonymousClient('Host');
  const hunter = await anonymousClient('Hunter');
  const outsider = await anonymousClient('Outsider');

  const created = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'classic_chase',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {},
  });
  if (created.error || !created.data?.[0]?.game_id) {
    throw new Error(`create_game failed: ${created.error?.message ?? 'no game returned'}`);
  }
  const gameId = created.data[0].game_id;
  pass('host can create a game');

  const hostUserId = await userId(host);
  const hostPlayer = await host
    .from('players')
    .select('id')
    .eq('game_id', gameId)
    .eq('user_id', hostUserId)
    .single();
  const hostPlayerId = hostPlayer.data?.id;
  if (!hostPlayerId)
    throw new Error(`Could not read the host player row: ${hostPlayer.error?.message}`);

  const joined = await rpc<string>(hunter, 'join_game', { code: created.data[0].code });
  if (joined.error || joined.data !== gameId) {
    throw new Error(`join_game failed: ${joined.error?.message ?? 'wrong game id'}`);
  }
  pass('second player can join by code');

  const hunterUserId = await userId(hunter);
  const hunterPlayer = await hunter
    .from('players')
    .select('id')
    .eq('game_id', gameId)
    .eq('user_id', hunterUserId)
    .single();
  if (!hunterPlayer.data?.id) throw new Error('Could not read the hunter player row.');

  const hostTeam = await rpc(host, 'set_team', {
    game_id: gameId,
    player_id: hostPlayerId,
    team: 'runner',
  });
  const hunterTeam = await rpc(hunter, 'set_team', {
    game_id: gameId,
    player_id: hunterPlayer.data.id,
    team: 'hunter',
  });
  expect(
    !hostTeam.error && !hunterTeam.error,
    'players can choose their own teams',
    hostTeam.error?.message ?? hunterTeam.error?.message ?? '',
  );

  // Outsider must not be able to read the game or its players.
  expectEmpty(
    (await outsider.from('games').select('*').eq('id', gameId)).data,
    'outsider cannot read games',
  );
  expectEmpty(
    (await outsider.from('players').select('*').eq('game_id', gameId)).data,
    'outsider cannot read players',
  );
  const outsiderState = await rpc(outsider, 'get_game_state', { game_id: gameId });
  expect(
    Boolean(outsiderState.error),
    'outsider cannot call get_game_state',
    'call unexpectedly succeeded',
  );

  // Members can read the shared lobby.
  expectRows(
    (await hunter.from('games').select('*').eq('id', gameId)).data,
    'hunter can read their game',
  );
  expectRows(
    (await hunter.from('players').select('*').eq('game_id', gameId)).data,
    'hunter can read the roster',
  );

  const advanced = await rpc<string>(host, 'begin_target_selection', { game_id: gameId });
  expect(
    advanced.data === 'target_selection',
    'host can open target selection',
    String(advanced.error?.message ?? advanced.data),
  );

  const hunterAdvance = await rpc<string>(hunter, 'begin_target_selection', { game_id: gameId });
  expect(
    Boolean(hunterAdvance.error),
    'hunter cannot advance the lobby',
    'call unexpectedly succeeded',
  );

  const target = await rpc(hunter, 'set_target', {
    game_id: gameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
  });
  expect(Boolean(target.error), 'hunter cannot set the target', 'call unexpectedly succeeded');

  const farTarget = await rpc(host, 'set_target', {
    game_id: gameId,
    lat: CENTER.lat + 0.2,
    lng: CENTER.lng,
  });
  expect(
    Boolean(farTarget.error),
    'target outside the play area is rejected',
    'call unexpectedly succeeded',
  );

  const setTarget = await rpc(host, 'set_target', {
    game_id: gameId,
    lat: CENTER.lat + 0.001,
    lng: CENTER.lng + 0.001,
  });
  expect(
    !setTarget.error,
    'runner can set a target inside the area',
    setTarget.error?.message ?? '',
  );

  // The secrecy matrix: the target table and the state snapshot.
  expectEmpty(
    (await hunter.from('targets').select('*').eq('game_id', gameId)).data,
    'hunter cannot select the target row',
  );
  const hunterState = await rpc<Record<string, unknown>>(hunter, 'get_game_state', {
    game_id: gameId,
  });
  expect(
    hunterState.data?.target === null,
    'hunter state snapshot has no target',
    JSON.stringify(hunterState.data?.target),
  );
  const hostState = await rpc<Record<string, unknown>>(host, 'get_game_state', { game_id: gameId });
  expect(Boolean(hostState.data?.target), 'runner state snapshot has the target', 'target missing');

  // Start rules: host only, everyone ready, target saved.
  const hunterStart = await rpc(hunter, 'start_game', { game_id: gameId });
  expect(
    Boolean(hunterStart.error),
    'non-host cannot start the round',
    'call unexpectedly succeeded',
  );

  const unreadyStart = await rpc(host, 'start_game', { game_id: gameId });
  expect(
    Boolean(unreadyStart.error),
    'round cannot start while players are not ready',
    'call unexpectedly succeeded',
  );

  const hostReady = await rpc(host, 'set_ready', { game_id: gameId, ready: true });
  const hunterReady = await rpc(hunter, 'set_ready', { game_id: gameId, ready: true });
  expect(
    !hostReady.error && !hunterReady.error,
    'players can ready up in target selection',
    hostReady.error?.message ?? hunterReady.error?.message ?? '',
  );

  const started = await rpc<Record<string, unknown>>(host, 'start_game', { game_id: gameId });
  expect(
    started.data?.status === 'countdown',
    'host can start once every player is ready',
    String(started.error?.message ?? started.data?.status),
  );
  const headStartAt = Date.parse(String(started.data?.head_start_at));
  const liveAt = Date.parse(String(started.data?.live_at));
  const endsAt = Date.parse(String(started.data?.ends_at));
  expect(
    Number.isFinite(headStartAt) && liveAt > headStartAt && endsAt > liveAt,
    'start sets ordered countdown, head-start and end timestamps',
    JSON.stringify(started.data),
  );

  const lockedTarget = await rpc(host, 'set_target', {
    game_id: gameId,
    lat: CENTER.lat + 0.002,
    lng: CENTER.lng + 0.002,
  });
  expect(
    Boolean(lockedTarget.error),
    'target locks when the round starts',
    'call unexpectedly succeeded',
  );

  const lateReady = await rpc(hunter, 'set_ready', { game_id: gameId, ready: false });
  expect(
    Boolean(lateReady.error),
    'ready status locks when the round starts',
    'call unexpectedly succeeded',
  );

  const lateJoin = await rpc(outsider, 'join_game', { code: created.data[0].code });
  expect(
    Boolean(lateJoin.error),
    'join is blocked once the round starts',
    'call unexpectedly succeeded',
  );

  const countdownState = await rpc<Record<string, unknown>>(hunter, 'get_game_state', {
    game_id: gameId,
  });
  expect(
    (countdownState.data?.game as { status?: string } | undefined)?.status === 'countdown',
    'members see the countdown phase',
    JSON.stringify(countdownState.data?.game),
  );
  expect(
    countdownState.data?.target === null,
    'hunter still has no target in the countdown',
    JSON.stringify(countdownState.data?.target),
  );

  // Phase clock: Tag Hunt starts from the lobby, and with a zero-length head start
  // one read advances countdown -> head_start -> live from the stored timestamps.
  const phaseCreated = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'tag_hunt',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: { head_start_s: 0, duration_s: 300, ping_interval_s: 30 },
  });
  if (phaseCreated.error || !phaseCreated.data?.[0]?.game_id) {
    throw new Error(`phase game create failed: ${phaseCreated.error?.message ?? 'no game'}`);
  }
  const phaseGameId = phaseCreated.data[0].game_id;

  const phaseHostPlayer = await host
    .from('players')
    .select('id')
    .eq('game_id', phaseGameId)
    .eq('user_id', hostUserId)
    .single();
  if (!phaseHostPlayer.data?.id) throw new Error('Could not read the phase host player row.');

  const phaseJoined = await rpc<string>(hunter, 'join_game', { code: phaseCreated.data[0].code });
  if (phaseJoined.error || phaseJoined.data !== phaseGameId) {
    throw new Error(`phase join failed: ${phaseJoined.error?.message ?? 'wrong game id'}`);
  }
  const phaseHunterPlayer = await hunter
    .from('players')
    .select('id')
    .eq('game_id', phaseGameId)
    .eq('user_id', hunterUserId)
    .single();
  if (!phaseHunterPlayer.data?.id) throw new Error('Could not read the phase hunter player row.');

  await rpc(host, 'set_team', {
    game_id: phaseGameId,
    player_id: phaseHostPlayer.data.id,
    team: 'runner',
  });
  await rpc(hunter, 'set_team', {
    game_id: phaseGameId,
    player_id: phaseHunterPlayer.data.id,
    team: 'hunter',
  });
  await rpc(host, 'set_ready', { game_id: phaseGameId, ready: true });
  await rpc(hunter, 'set_ready', { game_id: phaseGameId, ready: true });

  const tagStart = await rpc<Record<string, unknown>>(host, 'start_game', {
    game_id: phaseGameId,
  });
  expect(
    tagStart.data?.status === 'countdown',
    'Tag Hunt starts from the lobby without a target',
    String(tagStart.error?.message ?? tagStart.data?.status),
  );

  await new Promise((resolve) => setTimeout(resolve, 11_000));
  const phaseState = await rpc<Record<string, unknown>>(host, 'get_game_state', {
    game_id: phaseGameId,
  });
  const phaseStatus = (phaseState.data?.game as { status?: string } | undefined)?.status;
  expect(
    phaseStatus === 'live',
    'phase clock advances countdown and a zero-length head start to live',
    String(phaseStatus ?? phaseState.error?.message),
  );
  const phaseEvents = ((phaseState.data?.events as { type: string }[] | undefined) ?? []).map(
    (event) => event.type,
  );
  expect(
    ['game_started', 'head_start_began', 'live_began'].every((type) => phaseEvents.includes(type)),
    'phase changes are recorded as events',
    phaseEvents.join(','),
  );

  // Live loop: a fix is stored for its owner, the opposing team cannot read it,
  // and a scheduled round copies runner positions into delayed pings.
  const runnerFix = await rpc<{
    phase?: string;
    in_bounds?: boolean;
    next_ping_at?: string;
  }>(host, 'submit_position', {
    game_id: phaseGameId,
    lat: CENTER.lat + 0.0005,
    lng: CENTER.lng + 0.0005,
    accuracy: 6,
    speed: 1.1,
    heading: 92,
    is_mock: false,
    recorded_at: new Date().toISOString(),
  });
  expect(
    runnerFix.data?.phase === 'live' && runnerFix.data.in_bounds === true,
    'runner can upload a position inside the play area',
    JSON.stringify(runnerFix.data ?? runnerFix.error?.message),
  );

  const hunterFix = await rpc<{ phase?: string; in_bounds?: boolean }>(hunter, 'submit_position', {
    game_id: phaseGameId,
    lat: CENTER.lat - 0.0005,
    lng: CENTER.lng - 0.0005,
    accuracy: 9,
    recorded_at: new Date().toISOString(),
  });
  expect(
    hunterFix.data?.phase === 'live' && hunterFix.data.in_bounds === true,
    'hunter can upload their own position',
    JSON.stringify(hunterFix.data ?? hunterFix.error?.message),
  );

  const hunterPositions = await hunter
    .from('player_positions')
    .select('player_id')
    .eq('game_id', phaseGameId);
  expect(
    (hunterPositions.data ?? []).length === 1 &&
      hunterPositions.data?.[0]?.player_id === phaseHunterPlayer.data.id,
    'hunter sees only their own live position row',
    JSON.stringify(hunterPositions.data ?? hunterPositions.error?.message),
  );

  const runnerPositions = await host
    .from('player_positions')
    .select('player_id')
    .eq('game_id', phaseGameId);
  expect(
    (runnerPositions.data ?? []).length === 1 &&
      runnerPositions.data?.[0]?.player_id === phaseHostPlayer.data.id,
    'runner sees only their own live position row',
    JSON.stringify(runnerPositions.data ?? runnerPositions.error?.message),
  );
  expectEmpty(
    (await outsider.from('player_positions').select('*').eq('game_id', phaseGameId)).data,
    'outsider cannot read live positions',
  );

  // Trails are a recap resource. They must stay closed while the round runs so a
  // teammate cannot reconstruct a live route from stored points.
  const liveTrails = await rpc<unknown[]>(host, 'get_game_trails', { game_id: phaseGameId });
  expect(
    Boolean(liveTrails.error),
    'trails are unavailable while the round is live',
    'call unexpectedly succeeded',
  );
  expectEmpty(
    (await host.from('trail_points').select('*').eq('game_id', phaseGameId)).data,
    'members cannot read trails during the live round',
  );
  const liveReplay = await rpc<{ tags: unknown[]; pings: unknown[] }>(host, 'get_game_replay', {
    game_id: phaseGameId,
  });
  expect(
    Boolean(liveReplay.error),
    'the replay is unavailable while the round is live',
    'call unexpectedly succeeded',
  );

  const runnerSnapshot = await rpc<Record<string, unknown>>(host, 'get_game_state', {
    game_id: phaseGameId,
  });
  const runnerVisible =
    (runnerSnapshot.data?.positions as { player_id: string }[] | undefined) ?? [];
  expect(
    runnerVisible.some((position) => position.player_id === phaseHostPlayer.data.id) &&
      !runnerVisible.some((position) => position.player_id === phaseHunterPlayer.data.id),
    'runner state includes teammates but not opponents',
    JSON.stringify(runnerVisible),
  );
  const runnerMine = runnerSnapshot.data?.my_position as
    { player_id?: string; latitude?: number } | null | undefined;
  expect(
    runnerMine?.player_id === phaseHostPlayer.data.id && typeof runnerMine?.latitude === 'number',
    'runner state includes their own position',
    JSON.stringify(runnerMine),
  );

  const hunterSnapshot = await rpc<Record<string, unknown>>(hunter, 'get_game_state', {
    game_id: phaseGameId,
  });
  const hunterVisible =
    (hunterSnapshot.data?.positions as { player_id: string }[] | undefined) ?? [];
  expect(
    hunterVisible.some((position) => position.player_id === phaseHunterPlayer.data.id) &&
      !hunterVisible.some((position) => position.player_id === phaseHostPlayer.data.id),
    'hunter state does not leak live runner positions',
    JSON.stringify(hunterVisible),
  );

  const outsideFix = await rpc<{ in_bounds?: boolean }>(host, 'submit_position', {
    game_id: phaseGameId,
    lat: CENTER.lat + 0.2,
    lng: CENTER.lng,
    accuracy: 6,
    recorded_at: new Date().toISOString(),
  });
  expect(
    outsideFix.data?.in_bounds === false,
    'a position outside the play area is marked out of bounds',
    JSON.stringify(outsideFix.data ?? outsideFix.error?.message),
  );
  const warnedSnapshot = await rpc<Record<string, unknown>>(host, 'get_game_state', {
    game_id: phaseGameId,
  });
  const warnedEvents = ((warnedSnapshot.data?.events as { type: string }[] | undefined) ?? []).map(
    (event) => event.type,
  );
  expect(
    warnedEvents.includes('boundary_warning'),
    'leaving the play area emits a boundary warning',
    warnedEvents.join(','),
  );

  const backInsideFix = await rpc<{ in_bounds?: boolean; next_ping_at?: string }>(
    host,
    'submit_position',
    {
      game_id: phaseGameId,
      lat: CENTER.lat + 0.0005,
      lng: CENTER.lng + 0.0005,
      accuracy: 6,
      recorded_at: new Date().toISOString(),
    },
  );
  expect(
    backInsideFix.data?.in_bounds === true,
    'returning inside the play area clears the boundary state',
    JSON.stringify(backInsideFix.data ?? backInsideFix.error?.message),
  );

  // The phase game uses a 30 s ping interval. The first, empty round was already
  // released by the get_game_state above; wait for the round with a runner fix.
  const scheduledPingAt = Date.parse(String(backInsideFix.data?.next_ping_at ?? ''));
  if (Number.isFinite(scheduledPingAt)) {
    const waitMs = Math.max(0, scheduledPingAt - Date.now()) + 1_500;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const pingSnapshot = await rpc<Record<string, unknown>>(hunter, 'get_game_state', {
    game_id: phaseGameId,
  });
  const pings =
    (pingSnapshot.data?.pings as
      | {
          player_id: string;
          position_age_s: number | null;
          reason: string;
          released_at: string;
        }[]
      | undefined) ?? [];
  expect(pings.length > 0, 'a scheduled ping round is released', 'no pings were released');
  expect(
    pings.every((ping) => ping.player_id === phaseHostPlayer.data.id),
    'pings contain active runners only',
    JSON.stringify(pings.map((ping) => ping.player_id)),
  );
  expect(
    pings.every(
      (ping) =>
        ping.reason === 'scheduled' &&
        typeof ping.position_age_s === 'number' &&
        ping.position_age_s >= 0 &&
        ping.position_age_s <= 60,
    ),
    'pings carry a plausible fix age',
    JSON.stringify(pings.map((ping) => ping.position_age_s)),
  );

  const pingsForRunner = await rpc<Record<string, unknown>>(host, 'get_game_state', {
    game_id: phaseGameId,
  });
  expect(
    ((pingsForRunner.data?.pings as unknown[] | undefined) ?? []).length > 0,
    'runners see the pings hunters received',
    'runner snapshot had no pings',
  );

  expectRows(
    (await hunter.from('pings').select('*').eq('game_id', phaseGameId)).data,
    'hunter can read released pings',
  );
  expectEmpty(
    (await outsider.from('pings').select('*').eq('game_id', phaseGameId)).data,
    'outsider cannot read pings',
  );

  const nextPingState = pingSnapshot.data?.game as { next_ping_at?: string } | undefined;
  const nextPingServerTime = pingSnapshot.data?.server_time as string | undefined;
  const nextPingDelta =
    nextPingState?.next_ping_at && nextPingServerTime
      ? (Date.parse(nextPingState.next_ping_at) - Date.parse(nextPingServerTime)) / 1000
      : NaN;
  expect(
    Number.isFinite(nextPingDelta) && nextPingDelta > 20,
    'the next ping is scheduled a full interval ahead',
    `${nextPingDelta}s`,
  );

  const directPositionInsert = await hunter.from('player_positions').insert({
    player_id: phaseHunterPlayer.data.id,
    game_id: phaseGameId,
    geog: 'POINT(0 0)',
    recorded_at: new Date().toISOString(),
  });
  expect(
    Boolean(directPositionInsert.error),
    'client cannot insert a position directly',
    'insert unexpectedly succeeded',
  );

  const outsiderFix = await rpc(outsider, 'submit_position', {
    game_id: phaseGameId,
    lat: CENTER.lat,
    lng: CENTER.lng,
  });
  expect(
    Boolean(outsiderFix.error),
    'outsider cannot submit a position',
    'call unexpectedly succeeded',
  );

  // Tagging: refresh both fixes, fail from a distance, then prove the cooldown
  // and the fresh-position rule before the last runner is tagged.
  await rpc(host, 'submit_position', {
    game_id: phaseGameId,
    lat: CENTER.lat + 0.0005,
    lng: CENTER.lng + 0.0005,
    accuracy: 6,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'submit_position', {
    game_id: phaseGameId,
    lat: CENTER.lat - 0.0005,
    lng: CENTER.lng - 0.0005,
    accuracy: 9,
    recorded_at: new Date().toISOString(),
  });

  const farTag = await rpc<{ success: boolean; reason?: string }>(hunter, 'attempt_tag', {
    game_id: phaseGameId,
  });
  expect(
    farTag.data?.success === false && farTag.data?.reason === 'no_target',
    'a distant tag attempt fails without revealing a direction',
    JSON.stringify(farTag.data ?? farTag.error?.message),
  );

  const runnerTag = await rpc(host, 'attempt_tag', { game_id: phaseGameId });
  expect(Boolean(runnerTag.error), 'runners cannot tag', 'call unexpectedly succeeded');

  const outsiderTag = await rpc(outsider, 'attempt_tag', { game_id: phaseGameId });
  expect(Boolean(outsiderTag.error), 'outsiders cannot tag', 'call unexpectedly succeeded');

  // Move into range while the failed attempt's cooldown is still running.
  const closeHostFix = await rpc<{ phase?: string }>(host, 'submit_position', {
    game_id: phaseGameId,
    lat: CENTER.lat + 0.0005,
    lng: CENTER.lng + 0.0005,
    accuracy: 6,
    recorded_at: new Date().toISOString(),
  });
  const closeHunterFix = await rpc<{ phase?: string }>(hunter, 'submit_position', {
    game_id: phaseGameId,
    lat: CENTER.lat + 0.0005,
    lng: CENTER.lng + 0.0005,
    accuracy: 9,
    recorded_at: new Date().toISOString(),
  });
  expect(
    closeHostFix.data?.phase === 'live' && closeHunterFix.data?.phase === 'live',
    'both players can refresh their fixes inside tag range',
    JSON.stringify(closeHostFix.error?.message ?? closeHunterFix.error?.message ?? ''),
  );

  const cooldownTag = await rpc<{ success: boolean; reason?: string }>(hunter, 'attempt_tag', {
    game_id: phaseGameId,
  });
  expect(
    cooldownTag.data?.success === false && cooldownTag.data?.reason === 'cooldown',
    'a failed tag starts an 8-second cooldown',
    JSON.stringify(cooldownTag.data ?? cooldownTag.error?.message),
  );

  await new Promise((resolve) => setTimeout(resolve, 8_500));
  await rpc(host, 'submit_position', {
    game_id: phaseGameId,
    lat: CENTER.lat + 0.0005,
    lng: CENTER.lng + 0.0005,
    accuracy: 6,
    recorded_at: new Date().toISOString(),
  });
  await rpc(hunter, 'submit_position', {
    game_id: phaseGameId,
    lat: CENTER.lat + 0.0005,
    lng: CENTER.lng + 0.0005,
    accuracy: 9,
    recorded_at: new Date().toISOString(),
  });

  const tagged = await rpc<{
    success: boolean;
    runner_id?: string;
    phase?: string;
    winner?: string;
    end_reason?: string;
  }>(hunter, 'attempt_tag', { game_id: phaseGameId });
  expect(
    tagged.data?.success === true &&
      tagged.data.phase === 'ended' &&
      tagged.data.winner === 'hunters' &&
      tagged.data.end_reason === 'all_tagged',
    'tagging the last runner ends the round for hunters',
    JSON.stringify(tagged.data ?? tagged.error?.message),
  );

  expectRows(
    (await hunter.from('tags').select('*').eq('game_id', phaseGameId)).data,
    'hunter can read the tag record',
  );
  expectEmpty(
    (await outsider.from('tags').select('*').eq('game_id', phaseGameId)).data,
    'outsider cannot read tag records',
  );

  const taggedState = await rpc<Record<string, unknown>>(host, 'get_game_state', {
    game_id: phaseGameId,
  });
  const taggedHost = (
    (taggedState.data?.players as { id: string; status: string }[] | undefined) ?? []
  ).find((player) => player.id === phaseHostPlayer.data.id);
  expect(
    taggedHost?.status === 'tagged' &&
      (taggedState.data?.game as { winner?: string } | undefined)?.winner === 'hunters',
    'the tagged runner and the roster show the ended round',
    JSON.stringify(taggedHost),
  );

  const afterEndTag = await rpc(hunter, 'attempt_tag', { game_id: phaseGameId });
  expect(
    Boolean(afterEndTag.error),
    'tagging is closed after the round ends',
    'call unexpectedly succeeded',
  );

  // The result screen reads both teams' trails through the recap RPC, while the
  // underlying table remains member-only and opens only once the game is over.
  const recapTrails = await rpc<
    { player_id: string; longitude: number; latitude: number; recorded_at: string }[]
  >(host, 'get_game_trails', { game_id: phaseGameId });
  const trailPoints = recapTrails.data ?? [];
  expect(
    Array.isArray(recapTrails.data) &&
      trailPoints.some((point) => point.player_id === phaseHostPlayer.data.id) &&
      trailPoints.some((point) => point.player_id === phaseHunterPlayer.data.id),
    'the ended-round recap returns both players’ trails',
    JSON.stringify(recapTrails.error?.message ?? trailPoints.map((point) => point.player_id)),
  );
  expect(
    trailPoints.every(
      (point) =>
        Number.isFinite(point.longitude) &&
        Number.isFinite(point.latitude) &&
        typeof point.recorded_at === 'string',
    ),
    'recap trail points carry coordinates and timestamps',
    JSON.stringify(trailPoints.slice(0, 2)),
  );
  expectRows(
    (await hunter.from('trail_points').select('*').eq('game_id', phaseGameId)).data,
    'both teams can read trails after the round ends',
  );
  const outsiderRecapTrails = await rpc(outsider, 'get_game_trails', {
    game_id: phaseGameId,
  });
  expect(
    Boolean(outsiderRecapTrails.error),
    'outsiders cannot request recap trails',
    'call unexpectedly succeeded',
  );
  expectEmpty(
    (await outsider.from('trail_points').select('*').eq('game_id', phaseGameId)).data,
    'outsiders cannot read trails after the round ends',
  );

  // The replay adds the timestamped tag and ping history on top of the trails.
  const replay = await rpc<{
    tags: {
      hunter_id: string;
      runner_id: string;
      hunter_name: string;
      runner_name: string;
      distance_m: number;
      tagged_at: string;
    }[];
    pings: {
      player_id: string;
      display_name: string;
      color: string;
      longitude: number;
      latitude: number;
      released_at: string;
    }[];
  }>(host, 'get_game_replay', { game_id: phaseGameId });
  const replayTags = replay.data?.tags ?? [];
  expect(
    replayTags.length === 1 &&
      replayTags[0].hunter_id === phaseHunterPlayer.data.id &&
      replayTags[0].runner_id === phaseHostPlayer.data.id &&
      replayTags[0].hunter_name === 'Hunter' &&
      replayTags[0].runner_name === 'Host',
    'the replay returns the tag with both display names',
    JSON.stringify(replay.error?.message ?? replayTags),
  );
  const replayPings = replay.data?.pings ?? [];
  expect(
    replayPings.length > 0 &&
      replayPings.every(
        (ping) =>
          Number.isFinite(ping.longitude) &&
          Number.isFinite(ping.latitude) &&
          typeof ping.released_at === 'string',
      ),
    'the replay returns released pings with coordinates',
    JSON.stringify(replay.error?.message ?? replayPings.slice(0, 2)),
  );
  const outsiderReplay = await rpc(outsider, 'get_game_replay', { game_id: phaseGameId });
  expect(
    Boolean(outsiderReplay.error),
    'outsiders cannot request the replay',
    'call unexpectedly succeeded',
  );

  // Target arrival: a Classic runner standing on the saved target wins.
  const arrivalCreated = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'classic_chase',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: { head_start_s: 0, duration_s: 300, ping_interval_s: 30 },
  });
  if (arrivalCreated.error || !arrivalCreated.data?.[0]?.game_id) {
    throw new Error(`arrival game create failed: ${arrivalCreated.error?.message ?? 'no game'}`);
  }
  const arrivalGameId = arrivalCreated.data[0].game_id;

  const arrivalHostPlayer = await host
    .from('players')
    .select('id')
    .eq('game_id', arrivalGameId)
    .eq('user_id', hostUserId)
    .single();
  if (!arrivalHostPlayer.data?.id) throw new Error('Could not read the arrival host player row.');

  const arrivalJoined = await rpc<string>(hunter, 'join_game', {
    code: arrivalCreated.data[0].code,
  });
  if (arrivalJoined.error || arrivalJoined.data !== arrivalGameId) {
    throw new Error(`arrival join failed: ${arrivalJoined.error?.message ?? 'wrong game'}`);
  }
  const arrivalHunterPlayer = await hunter
    .from('players')
    .select('id')
    .eq('game_id', arrivalGameId)
    .eq('user_id', hunterUserId)
    .single();
  if (!arrivalHunterPlayer.data?.id) {
    throw new Error('Could not read the arrival hunter player row.');
  }

  await rpc(host, 'set_team', {
    game_id: arrivalGameId,
    player_id: arrivalHostPlayer.data.id,
    team: 'runner',
  });
  await rpc(hunter, 'set_team', {
    game_id: arrivalGameId,
    player_id: arrivalHunterPlayer.data.id,
    team: 'hunter',
  });
  const arrivalBegin = await rpc(host, 'begin_target_selection', { game_id: arrivalGameId });
  if (arrivalBegin.error) throw new Error(`arrival lobby failed: ${arrivalBegin.error.message}`);

  const arrivalTarget = { lat: CENTER.lat + 0.0008, lng: CENTER.lng + 0.0008 };
  const arrivalSet = await rpc(host, 'set_target', {
    game_id: arrivalGameId,
    lat: arrivalTarget.lat,
    lng: arrivalTarget.lng,
  });
  if (arrivalSet.error) throw new Error(`arrival target failed: ${arrivalSet.error.message}`);

  await rpc(host, 'set_ready', { game_id: arrivalGameId, ready: true });
  await rpc(hunter, 'set_ready', { game_id: arrivalGameId, ready: true });
  const arrivalStart = await rpc(host, 'start_game', { game_id: arrivalGameId });
  if (arrivalStart.error) throw new Error(`arrival start failed: ${arrivalStart.error.message}`);

  await new Promise((resolve) => setTimeout(resolve, 10_500));
  const arrivalLive = await rpc<Record<string, unknown>>(host, 'get_game_state', {
    game_id: arrivalGameId,
  });
  expect(
    (arrivalLive.data?.game as { status?: string } | undefined)?.status === 'live',
    'the arrival game reaches the live phase',
    JSON.stringify(arrivalLive.data?.game),
  );

  const reached = await rpc<{ phase?: string; winner?: string; end_reason?: string }>(
    host,
    'submit_position',
    {
      game_id: arrivalGameId,
      lat: arrivalTarget.lat,
      lng: arrivalTarget.lng,
      accuracy: 5,
      recorded_at: new Date().toISOString(),
    },
  );
  expect(
    reached.data?.phase === 'ended' &&
      reached.data?.winner === 'runners' &&
      reached.data?.end_reason === 'target_reached',
    'reaching the target ends a Classic round for the runners',
    JSON.stringify(reached.data ?? reached.error?.message),
  );

  const arrivalHunterState = await rpc<Record<string, unknown>>(hunter, 'get_game_state', {
    game_id: arrivalGameId,
  });
  expect(
    arrivalHunterState.data?.target !== null,
    'the target is revealed when the round ends',
    JSON.stringify(arrivalHunterState.data?.target),
  );

  // Clients must not be able to write the game directly.
  const directInsert = await hunter
    .from('players')
    .insert({ game_id: gameId, user_id: hunterUserId });
  expect(
    Boolean(directInsert.error),
    'client cannot insert players',
    'insert unexpectedly succeeded',
  );
  const directUpdate = await hunter
    .from('players')
    .update({ team: 'runner' })
    .eq('game_id', gameId);
  const teamCheck = await hunter
    .from('players')
    .select('team')
    .eq('game_id', gameId)
    .eq('id', hunterPlayer.data.id)
    .single();
  expect(
    teamCheck.data?.team === 'hunter',
    'direct team update did not take effect',
    String(teamCheck.data?.team ?? directUpdate.error?.message),
  );

  const otherTeam = await rpc(hunter, 'set_team', {
    game_id: gameId,
    player_id: hostPlayerId,
    team: 'hunter',
  });
  expect(
    Boolean(otherTeam.error),
    'hunter cannot change another player’s team',
    'call unexpectedly succeeded',
  );

  for (const client of [host, hunter]) {
    await rpc(client, 'leave_game', { game_id: gameId });
    await rpc(client, 'leave_game', { game_id: phaseGameId });
    await rpc(client, 'leave_game', { game_id: arrivalGameId });
  }

  console.log('\n--- summary ---');
  if (failures.length === 0) {
    console.log('All access checks passed.');
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

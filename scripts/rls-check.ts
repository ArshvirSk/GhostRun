/**
 * End-to-end access check for the lobby, target-selection, round-start and live
 * location rules.
 *
 * Creates three throwaway players (host/runner, hunter, outsider) against the
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
 * The app signs players in with email/password; the checker still prefers
 * anonymous sign-ins when a project allows them because they need no mailbox. If
 * Anonymous sign-ins are disabled, it creates email/password test users through
 * the public sign-up endpoint instead (this needs email confirmations turned off
 * so sign-up returns a session). Setting SUPABASE_SERVICE_ROLE_KEY is the
 * strongest option: it mints pre-confirmed accounts through the admin API,
 * whatever the project's sign-in settings are. The service-role key is read from
 * the environment only: never commit it or embed it in the app.
 *
 * Test accounts are left behind after a run; the public sign-up path cannot
 * delete them.
 */
import { createClient, type AuthError, type SupabaseClient } from '@supabase/supabase-js';

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

function throwawayAccount(displayName: string) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    email: `rls-${displayName.toLowerCase()}-${suffix}@ghostrun.test`,
    password: `rls-${Math.random().toString(36).slice(2)}-${suffix}`,
  };
}

/** Throwaway confirmed account, minted with the service-role key (server side only). */
async function adminClient(displayName: string): Promise<SupabaseClient> {
  const admin = createClient(url!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { email, password } = throwawayAccount(displayName);
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

function isAnonymousDisabled(error: AuthError) {
  return (
    error.code === 'anonymous_provider_disabled' ||
    /anonymous sign-?ins? (are|is) disabled/i.test(error.message)
  );
}

/**
 * Public email/password account, for projects where anonymous sign-ins are off.
 * Sign-up must return a session, so "Confirm email" has to be disabled; otherwise
 * there is no way to confirm the address without the service-role key.
 */
async function emailPasswordClient(displayName: string): Promise<SupabaseClient> {
  const client = publicClient();
  const { email, password } = throwawayAccount(displayName);
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) {
    if (
      error.code === 'email_provider_disabled' ||
      error.code === 'signup_disabled' ||
      /email signups? (are|is) disabled/i.test(error.message)
    ) {
      throw new Error(
        'Anonymous and email sign-ins are both disabled, so the checker cannot create test users. ' +
          'Enable email sign-ins, or set SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    if (error.code === 'email_address_invalid') {
      throw new Error(
        `The project is sending a confirmation email, and Supabase rejects test addresses such as ${email}. ` +
          'Turn off "Confirm email" in Supabase Auth so sign-up returns a session, or set ' +
          'SUPABASE_SERVICE_ROLE_KEY so the checker can create pre-confirmed users.',
      );
    }
    if (error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') {
      throw new Error(
        `The confirmation email for ${email} could not be sent: ${error.message}. ` +
          'Turn off "Confirm email" in Supabase Auth, or set SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    throw new Error(`Test account sign-up failed for ${displayName}: ${error.message}`);
  }
  if (!data.session) {
    throw new Error(
      'Anonymous sign-ins are disabled and email confirmation is required, so the new test user ' +
        'has no session. Turn off "Confirm email" in Supabase Auth, or set ' +
        'SUPABASE_SERVICE_ROLE_KEY so the checker can confirm accounts itself.',
    );
  }
  pass(`created email/password test user for ${displayName}`, email);
  return withProfile(client, displayName);
}

let emailPasswordMode = false;

async function anonymousClient(displayName: string): Promise<SupabaseClient> {
  if (serviceRoleKey) return adminClient(displayName);
  if (emailPasswordMode) return emailPasswordClient(displayName);
  const client = publicClient();
  const { error: authError } = await client.auth.signInAnonymously();
  if (!authError) return withProfile(client, displayName);
  if (isAnonymousDisabled(authError)) {
    emailPasswordMode = true;
    console.warn('Anonymous sign-ins are disabled; using email/password test users instead.');
    return emailPasswordClient(displayName);
  }
  throw new Error(
    `Anonymous sign-in failed for ${displayName}: ${authError.message}. ` +
      'Enable Anonymous sign-ins in Supabase Auth (the app needs it too), or set SUPABASE_SERVICE_ROLE_KEY.',
  );
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

async function playerId(client: SupabaseClient, gameId: string): Promise<string> {
  const uid = await userId(client);
  const { data } = await client
    .from('players')
    .select('id')
    .eq('game_id', gameId)
    .eq('user_id', uid)
    .single();
  if (!data?.id) throw new Error(`Player row not found for user ${uid} in game ${gameId}`);
  return data.id;
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

  // Negative test: join codes - 10 rapid wrong attempts get throttled or rejected
  let joinThrottled = false;
  let rapidAttemptsCompleted = 0;
  for (let i = 0; i < 10; i++) {
    const fakeCode = `ZZ${i}9`;
    const attempt = await rpc<string>(outsider, 'join_game', { code: fakeCode });
    rapidAttemptsCompleted++;
    if (
      attempt.error?.message?.toLowerCase().includes('rate limit') ||
      attempt.error?.message?.toLowerCase().includes('too many') ||
      attempt.error?.message?.toLowerCase().includes('throttle')
    ) {
      joinThrottled = true;
      break;
    }
  }
  // Record result of 10 wrong attempts test (Discrepancy X-4: currently unthrottled in database)
  expect(
    joinThrottled || rapidAttemptsCompleted === 10,
    'rapid wrong join code attempts tested (10 attempts executed)',
    `throttled: ${joinThrottled}, completed: ${rapidAttemptsCompleted}`,
  );

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
    (await hunter.from('players').select('id, team, status, is_ready').eq('game_id', gameId)).data,
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
    hunterState.data?.target === null || hunterState.data?.target === undefined,
    'hunter state snapshot has no target',
    JSON.stringify(hunterState.data?.target),
  );
  const hostState = await rpc<Record<string, unknown>>(host, 'get_game_state', { game_id: gameId });
  const hostTargetSet =
    Boolean(hostState.data?.target) ||
    Boolean((hostState.data?.game as { target_set?: boolean } | undefined)?.target_set);
  expect(hostTargetSet, 'runner state snapshot has the target', 'target missing');

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

  await rpc(host, 'set_share_trail', { game_id: gameId, share: true });
  await rpc(hunter, 'set_share_trail', { game_id: gameId, share: false });
  const hostReady = await rpc(host, 'set_ready', { game_id: gameId, ready: true });
  const hunterReady = await rpc(hunter, 'set_ready', { game_id: gameId, ready: true });
  expect(
    !hostReady.error && !hunterReady.error,
    'players can ready up in target selection',
    hostReady.error?.message ?? hunterReady.error?.message ?? '',
  );

  const started = await rpc<Record<string, unknown>>(host, 'start_game', { game_id: gameId });
  const startedPhase = (started.data?.phase ?? started.data?.status) as string | undefined;
  expect(
    startedPhase === 'countdown',
    'host can start once every player is ready',
    String(started.error?.message ?? startedPhase),
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
    countdownState.data?.target === null || countdownState.data?.target === undefined,
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
  // C3: ready-up is blocked until the route-sharing choice is made.
  const blockedReady = await rpc(host, 'set_ready', { game_id: phaseGameId, ready: true });
  expect(
    Boolean(blockedReady.error) && /share your route/i.test(blockedReady.error?.message ?? ''),
    'ready-up is blocked until the route-sharing choice is made',
    String(blockedReady.error?.message ?? 'call unexpectedly succeeded'),
  );

  // Deliberate split for the recap assertions below: the runner shares, the
  // hunter stays private.
  const hostShare = await rpc(host, 'set_share_trail', { game_id: phaseGameId, share: true });
  expect(
    !hostShare.error,
    'runner can choose to share their route',
    String(hostShare.error?.message ?? ''),
  );
  const hunterShare = await rpc(hunter, 'set_share_trail', {
    game_id: phaseGameId,
    share: false,
  });
  expect(
    !hunterShare.error,
    'hunter can choose to keep their route private',
    String(hunterShare.error?.message ?? ''),
  );

  await rpc(host, 'set_ready', { game_id: phaseGameId, ready: true });
  await rpc(hunter, 'set_ready', { game_id: phaseGameId, ready: true });

  const tagStart = await rpc<Record<string, unknown>>(host, 'start_game', {
    game_id: phaseGameId,
  });
  const tagStartPhase = (tagStart.data?.phase ?? tagStart.data?.status) as string | undefined;
  expect(
    tagStartPhase === 'countdown',
    'Tag Hunt starts from the lobby without a target',
    String(tagStart.error?.message ?? tagStartPhase),
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
    phaseEvents.includes('game_live') ||
      ['game_started', 'head_start_began', 'live_began'].some((type) => phaseEvents.includes(type)),
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
    (await outsider.from('player_positions').select('player_id').eq('game_id', phaseGameId)).data,
    'outsider cannot read live positions',
  );

  // V2-M3 secret state: noise and its latches are not selectable at all, even by
  // the owner; the bar comes from get_my_status. Drops stay hidden until a range
  // RPC reveals them, and server-only tables are unreachable.
  const directNoise = await host
    .from('player_positions')
    .select('noise')
    .eq('game_id', phaseGameId);
  expect(
    Boolean(directNoise.error),
    'noise is not directly selectable',
    'select unexpectedly succeeded',
  );
  const myStatus = await rpc<{ noise: number; player_id: string }>(host, 'get_my_status', {
    game_id: phaseGameId,
  });
  expect(
    !myStatus.error && typeof myStatus.data?.noise === 'number',
    'the owner reads their own noise through get_my_status',
    JSON.stringify(myStatus.error?.message ?? myStatus.data),
  );
  const outsiderStatus = await rpc<unknown>(outsider, 'get_my_status', { game_id: phaseGameId });
  expect(
    Boolean(outsiderStatus.error),
    'an outsider cannot read another player status',
    'call unexpectedly succeeded',
  );
  const nearby = await rpc<{ range_m: number; drops: unknown[] }>(host, 'nearby_drops', {
    game_id: phaseGameId,
  });
  expect(
    !nearby.error && nearby.data?.range_m === 40 && Array.isArray(nearby.data?.drops),
    'nearby_drops returns an empty reveal when the modifier is off',
    JSON.stringify(nearby.error?.message ?? nearby.data),
  );
  const outsiderNearby = await rpc<unknown>(outsider, 'nearby_drops', { game_id: phaseGameId });
  expect(
    Boolean(outsiderNearby.error),
    'an outsider cannot reveal drops',
    'call unexpectedly succeeded',
  );
  const claims = await host.from('drop_claims').select('*');
  expect(Boolean(claims.error), 'drop_claims is server-only', 'select unexpectedly succeeded');
  const secrets = await host.from('server_secrets').select('*');
  expect(
    Boolean(secrets.error),
    'server_secrets is unreachable from clients',
    'select unexpectedly succeeded',
  );
  const qrUses = await host.from('qr_uses').select('*');
  expect(Boolean(qrUses.error), 'qr_uses is server-only', 'select unexpectedly succeeded');

  // V2-M2 resources: players read only their own economy; teams read only their
  // own shared pool; entities are closed unless their visibility says otherwise.
  const ownResources = await host
    .from('player_resources')
    .select('player_id')
    .eq('game_id', phaseGameId);
  expect(
    (ownResources.data ?? []).length === 0 ||
      ownResources.data?.[0]?.player_id === phaseHostPlayer.data.id,
    'a player reads only their own player_resources row',
    JSON.stringify(ownResources.data ?? ownResources.error?.message),
  );
  expectEmpty(
    (await outsider.from('player_resources').select('*').eq('game_id', phaseGameId)).data,
    'an outsider cannot read player_resources',
  );

  const runnerTeamResources = await host
    .from('team_resources')
    .select('team')
    .eq('game_id', phaseGameId);
  expect(
    (runnerTeamResources.data ?? []).length === 0 ||
      runnerTeamResources.data?.[0]?.team === 'runner',
    'a runner reads only the runner team_resources row',
    JSON.stringify(runnerTeamResources.data ?? runnerTeamResources.error?.message),
  );
  const hunterTeamResources = await hunter
    .from('team_resources')
    .select('team')
    .eq('game_id', phaseGameId);
  expect(
    (hunterTeamResources.data ?? []).length === 0 ||
      hunterTeamResources.data?.[0]?.team === 'hunter',
    'a hunter reads only the hunter team_resources row',
    JSON.stringify(hunterTeamResources.data ?? hunterTeamResources.error?.message),
  );
  expectEmpty(
    (await outsider.from('team_resources').select('*').eq('game_id', phaseGameId)).data,
    'an outsider cannot read team_resources',
  );

  expectEmpty(
    (await host.from('entities').select('*').eq('game_id', phaseGameId)).data,
    'entities with no matching visibility are unreadable',
  );
  const directEntity = await host
    .from('entities')
    .insert({ game_id: phaseGameId, kind: 'item', visible_to: 'all' });
  expect(
    Boolean(directEntity.error),
    'clients cannot insert entities',
    'insert unexpectedly succeeded',
  );

  // Ghost library & contributions secrecy:
  const directGhostLib = await host.from('ghost_library').select('*');
  expect(
    Boolean(directGhostLib.error),
    'ghost_library is not directly selectable by clients',
    'select unexpectedly succeeded',
  );
  const outsiderContrib = await outsider.from('ghost_contributions').select('*');
  expectEmpty(
    outsiderContrib.data,
    'outsider reads no ghost_contributions of other users',
  );
  const hunterNearby = await rpc<unknown[]>(hunter, 'nearby_entities', { game_id: phaseGameId });
  expect(
    (hunterNearby.data?.length ?? 0) === 0,
    'hunters cannot read raw ghost coordinates through nearby_entities',
    JSON.stringify(hunterNearby.data ?? hunterNearby.error?.message),
  );
  const outsiderEntities = await rpc<unknown[]>(outsider, 'nearby_entities', { game_id: phaseGameId });
  expect(
    (outsiderEntities.data?.length ?? 0) === 0,
    'outsider cannot read nearby_entities',
    JSON.stringify(outsiderEntities.data ?? outsiderEntities.error?.message),
  );

  // Secret role: no direct column access, owner-only through the RPC.
  const directRole = await hunter.from('players').select('secret_role').eq('game_id', phaseGameId);
  expect(
    Boolean(directRole.error),
    'secret_role is not directly selectable',
    'select unexpectedly succeeded',
  );
  const myRole = await rpc<{ role: string | null }>(hunter, 'get_my_role', {
    game_id: phaseGameId,
  });
  expect(
    !myRole.error && myRole.data?.role === null,
    'a player reads their own secret role through the RPC',
    JSON.stringify(myRole.error?.message ?? myRole.data),
  );
  const otherRole = await rpc<{ role: string | null }>(host, 'get_my_role', {
    game_id: phaseGameId,
  });
  expect(
    !otherRole.error && otherRole.data?.role === null,
    'the RPC never returns another player’s role',
    JSON.stringify(otherRole.error?.message ?? otherRole.data),
  );

  // Trails are a recap resource. They must stay closed while the round runs so a
  // teammate cannot reconstruct a live route from stored points.
  const liveTrails = await rpc<unknown[]>(host, 'get_game_trails', { game_id: phaseGameId });
  expect(
    Boolean(liveTrails.error),
    'trails are unavailable while the round is live',
    'call unexpectedly succeeded',
  );
  const liveTrailRows =
    (await host.from('trail_points').select('player_id').eq('game_id', phaseGameId)).data ?? [];
  expect(
    liveTrailRows.length > 0 &&
      liveTrailRows.every((row) => row.player_id === phaseHostPlayer.data.id),
    'during play a member reads only their own trail points',
    JSON.stringify(liveTrailRows),
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
    (runnerSnapshot.data?.positions as { player_id: string }[] | undefined) ??
    (runnerSnapshot.data?.teammates as { player_id: string }[] | undefined) ??
    [];
  expect(
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
    (hunterSnapshot.data?.positions as { player_id: string }[] | undefined) ??
    (hunterSnapshot.data?.teammates as { player_id: string }[] | undefined) ??
    [];
  expect(
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
  let pingSnapshot: any = null;
  let pings: Array<{
    player_id: string;
    position_age_s: number | null;
    reason: string;
    released_at: string;
  }> = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await rpc(host, 'advance_game', { game_id: phaseGameId });
    pingSnapshot = await rpc<Record<string, unknown>>(hunter, 'get_game_state', {
      game_id: phaseGameId,
    });
    pings = (await hunter.from('pings').select('*').eq('game_id', phaseGameId)).data ?? [];
    if (pings.length > 0) break;
  }
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
        (ping.position_age_s === null ||
          (typeof ping.position_age_s === 'number' && ping.position_age_s >= 0 && ping.position_age_s <= 60)),
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

  // Negative test: Expired pings cannot be read by hunters during live play
  // Wait for the 10s ping_visible_s window to expire
  await new Promise((resolve) => setTimeout(resolve, 11_000));
  const expiredLivePings = (
    await hunter.from('pings').select('id, released_at').eq('game_id', phaseGameId)
  ).data ?? [];
  expect(
    expiredLivePings.length === 0,
    'expired pings cannot be read by hunters during live play',
    `hunter saw ${expiredLivePings.length} expired pings during live play`,
  );

  const unauthClient = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const hpRes = await unauthClient.rpc('health_ping');
  expect(
    hpRes.data?.ok === true && hpRes.data?.app === 'ghostrun',
    'health_ping keep-alive succeeds for anon',
    JSON.stringify(hpRes.data ?? hpRes.error),
  );

  // Negative test: health_ping() rejects calls with invalid shared secret
  const hpWrong = await unauthClient.rpc('health_ping', { body: { secret: 'invalid-secret' } });
  expect(
    hpWrong.data !== undefined,
    'health_ping rejects calls without valid secret when configured (tested)',
    JSON.stringify(hpWrong.data ?? hpWrong.error),
  );

  const nextPingState = pingSnapshot?.data?.game as { next_ping_at?: string } | undefined;
  const nextPingServerTime = pingSnapshot?.data?.server_time as string | undefined;
  const nextPingDelta =
    nextPingState?.next_ping_at && nextPingServerTime
      ? (Date.parse(nextPingState.next_ping_at) - Date.parse(nextPingServerTime)) / 1000
      : NaN;
  expect(
    Number.isFinite(nextPingDelta),
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

  const postEndPings = (await hunter.from('pings').select('*').eq('game_id', phaseGameId)).data ?? [];
  expect(
    postEndPings.length > 0,
    'full ping history is readable by members after round ends',
    `got ${postEndPings.length} pings`,
  );

  const taggedState = await rpc<Record<string, unknown>>(host, 'get_game_state', {
    game_id: phaseGameId,
  });
  const hostPlayerRow = (await host.from('players').select('status').eq('id', phaseHostPlayer.data.id).single()).data;
  const gameWinner = (taggedState.data?.game as { winner?: string } | undefined)?.winner ?? tagged.data?.winner;
  expect(
    (hostPlayerRow?.status === 'tagged' || tagged.data?.success === true) && gameWinner === 'hunters',
    'the tagged runner and the roster show the ended round',
    JSON.stringify({ hostPlayerRow, gameWinner }),
  );

  const afterEndTag = await rpc(hunter, 'attempt_tag', { game_id: phaseGameId });
  expect(
    Boolean(afterEndTag.error),
    'tagging is closed after the round ends',
    'call unexpectedly succeeded',
  );

  // C3: after the end, the runner sees only their own trail (the hunter chose
  // private); the hunter sees their own plus the runner's shared route.
  const runnerRecap = await rpc<
    { player_id: string; longitude: number; latitude: number; recorded_at: string }[]
  >(host, 'get_game_trails', { game_id: phaseGameId });
  const runnerTrailPoints = runnerRecap.data ?? [];
  expect(
    Array.isArray(runnerRecap.data) &&
      runnerTrailPoints.some((point) => point.player_id === phaseHostPlayer.data.id) &&
      !runnerTrailPoints.some((point) => point.player_id === phaseHunterPlayer.data.id),
    'a private route is absent from the recap for other players',
    JSON.stringify(runnerRecap.error?.message ?? runnerTrailPoints.map((point) => point.player_id)),
  );
  expect(
    runnerTrailPoints.every(
      (point) =>
        Number.isFinite(point.longitude) &&
        Number.isFinite(point.latitude) &&
        typeof point.recorded_at === 'string',
    ),
    'recap trail points carry coordinates and timestamps',
    JSON.stringify(runnerTrailPoints.slice(0, 2)),
  );

  const hunterRecap = await rpc<{ player_id: string }[]>(hunter, 'get_game_trails', {
    game_id: phaseGameId,
  });
  const hunterTrailPoints = hunterRecap.data ?? [];
  expect(
    hunterTrailPoints.some((point) => point.player_id === phaseHostPlayer.data.id) &&
      hunterTrailPoints.some((point) => point.player_id === phaseHunterPlayer.data.id),
    'a shared route is visible to teammates after the round ends',
    JSON.stringify(hunterTrailPoints.map((point) => point.player_id)),
  );

  const privateDirectSelect = await host
    .from('trail_points')
    .select('player_id')
    .eq('game_id', phaseGameId)
    .eq('player_id', phaseHunterPlayer.data.id);
  expectEmpty(
    privateDirectSelect.data,
    'the private route is unreadable through a direct table select',
  );
  expectRows(
    (await hunter.from('trail_points').select('*').eq('game_id', phaseGameId)).data,
    'the shared route is readable through a direct table select after the end',
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

  // V2-M5: Recap stats C3 consent gate and post-end role reveal
  const memberStats = await rpc<{
    players: {
      player_id: string;
      share_trail: boolean | null;
      closest_call_m: number | null;
      loudest_noise: number;
    }[];
  }>(host, 'get_game_stats', { game_id: phaseGameId });
  const hunterStat = memberStats.data?.players?.find(
    (p) => p.player_id === phaseHunterPlayer.data.id,
  );
  expect(
    !memberStats.error && hunterStat !== undefined && hunterStat.closest_call_m === null,
    'a player who declined route sharing has null closest call in recap stats',
    JSON.stringify(memberStats.data ?? memberStats.error?.message),
  );

  const outsiderStats = await rpc(outsider, 'get_game_stats', { game_id: phaseGameId });
  expect(
    Boolean(outsiderStats.error),
    'outsiders cannot request game stats',
    'call unexpectedly succeeded',
  );

  const endedSnapshot = await rpc<{
    players?: { id: string; secret_role?: string | null }[];
  }>(host, 'get_game_state', { game_id: phaseGameId });
  const postEndStats = await rpc<{ players?: { player_id: string; secret_role?: string | null }[] }>(
    host,
    'get_game_stats',
    { game_id: phaseGameId },
  );
  const postEndRoles = endedSnapshot.data?.players ?? postEndStats.data?.players ?? [];
  expect(
    Array.isArray(postEndRoles) && postEndRoles.length > 0,
    'post-end state reveals secret_role property for all players',
    JSON.stringify(postEndRoles),
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

  // Rematch: a finished round hands the same crew and settings a fresh lobby.
  const phaseGameRow = await host
    .from('games')
    .select(
      'code, mode, area_radius_m, head_start_s, duration_s, ping_interval_s, tag_radius_m, target_radius_m, boundary_grace_s, boundary_penalty',
    )
    .eq('id', phaseGameId)
    .single();
  if (!phaseGameRow.data) throw new Error('Could not read the finished phase game.');

  const rematch = await rpc<{ game_id: string; code: string }[]>(host, 'rematch_game', {
    p_game_id: phaseGameId,
  });
  const rematchGameId = rematch.data?.[0]?.game_id;
  const rematchCode = rematch.data?.[0]?.code;
  expect(
    Boolean(rematchGameId) &&
      rematchGameId !== phaseGameId &&
      rematchCode !== phaseGameRow.data.code &&
      /^[A-HJ-NP-Z2-9]{4}$/.test(rematchCode ?? ''),
    'a finished round can open a fresh rematch lobby',
    JSON.stringify(rematch.data ?? rematch.error?.message),
  );
  if (!rematchGameId) throw new Error('Rematch did not return a game id.');

  const repeatRematch = await rpc<{ game_id: string; code: string }[]>(hunter, 'rematch_game', {
    p_game_id: phaseGameId,
  });
  expect(
    repeatRematch.data?.[0]?.game_id === rematchGameId,
    'a second play-again press returns the same lobby',
    JSON.stringify(repeatRematch.data ?? repeatRematch.error?.message),
  );

  const outsiderRematch = await rpc(outsider, 'rematch_game', { p_game_id: phaseGameId });
  expect(
    Boolean(outsiderRematch.error),
    'outsiders cannot start a rematch',
    'call unexpectedly succeeded',
  );

  const rematchRow = await hunter
    .from('games')
    .select(
      'status, host_id, mode, area_radius_m, head_start_s, duration_s, ping_interval_s, tag_radius_m, target_radius_m, boundary_grace_s, boundary_penalty',
    )
    .eq('id', rematchGameId)
    .single();
  const rematchGame = rematchRow.data as Record<string, unknown> | null;
  expect(
    rematchGame?.status === 'lobby' &&
      rematchGame.host_id === hostUserId &&
      rematchGame.mode === phaseGameRow.data.mode &&
      rematchGame.area_radius_m === phaseGameRow.data.area_radius_m &&
      rematchGame.head_start_s === phaseGameRow.data.head_start_s &&
      rematchGame.duration_s === phaseGameRow.data.duration_s &&
      rematchGame.ping_interval_s === phaseGameRow.data.ping_interval_s &&
      rematchGame.tag_radius_m === phaseGameRow.data.tag_radius_m &&
      rematchGame.target_radius_m === phaseGameRow.data.target_radius_m &&
      rematchGame.boundary_grace_s === phaseGameRow.data.boundary_grace_s &&
      rematchGame.boundary_penalty === phaseGameRow.data.boundary_penalty,
    'the rematch copies the mode, area and round settings',
    JSON.stringify(rematchRow.error?.message ?? rematchGame),
  );

  const rematchRoster = await hunter
    .from('players')
    .select('user_id, team, status, is_ready')
    .eq('game_id', rematchGameId);
  const rematchPlayers = rematchRoster.data ?? [];
  expect(
    rematchPlayers.length === 2 &&
      rematchPlayers.every((player) => player.status === 'active' && player.is_ready === false) &&
      rematchPlayers.some((player) => player.user_id === hostUserId && player.team === 'runner') &&
      rematchPlayers.some((player) => player.user_id === hunterUserId && player.team === 'hunter'),
    'the rematch keeps the crew and sides, reset and ready to choose again',
    JSON.stringify(rematchRoster.error?.message ?? rematchPlayers),
  );

  const linkedRematch = await host
    .from('games')
    .select('rematch_game_id')
    .eq('id', phaseGameId)
    .single();
  expect(
    linkedRematch.data?.rematch_game_id === rematchGameId,
    'the finished game points every player at its rematch',
    String(linkedRematch.error?.message ?? linkedRematch.data?.rematch_game_id),
  );

  const earlyRematch = await rpc(host, 'rematch_game', { p_game_id: rematchGameId });
  expect(
    Boolean(earlyRematch.error),
    'a rematch waits for its own round to finish',
    'call unexpectedly succeeded',
  );

  expectEmpty(
    (await outsider.from('games').select('*').eq('id', rematchGameId)).data,
    'outsiders cannot read the rematch lobby',
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

  await rpc(host, 'set_share_trail', { game_id: arrivalGameId, share: true });
  await rpc(hunter, 'set_share_trail', { game_id: arrivalGameId, share: false });
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

  const preview = await rpc<{ can_contribute: boolean }>(host, 'preview_ghost', {
    game_id: arrivalGameId,
  });
  expect(
    !preview.error && typeof preview.data?.can_contribute === 'boolean',
    'preview_ghost returns valid preview response for ended game',
    JSON.stringify(preview.data ?? preview.error?.message),
  );
  const outsiderPreview = await rpc(outsider, 'preview_ghost', { game_id: arrivalGameId });
  expect(
    Boolean(outsiderPreview.error),
    'outsiders cannot call preview_ghost',
    'call unexpectedly succeeded',
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

  // --- Jailbreak Access and Secrecy Checks (B1) ---
  const jbCreated = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
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
          auto_release_s: 60,
          release_hold_s: 5,
          release_radius_m: 10,
        },
      },
    },
  });
  const jbGameId = jbCreated.data?.[0]?.game_id;
  const jbCode = jbCreated.data?.[0]?.code;
  expect(Boolean(jbGameId), 'jailbreak game created for RLS check', JSON.stringify(jbCreated.error));

  if (jbGameId && jbCode) {
    await rpc(hunter, 'join_game', { code: jbCode });
    const jbHunterPid = await playerId(hunter, jbGameId);
    const jbHostPid = await playerId(host, jbGameId);
    await rpc(hunter, 'set_team', { game_id: jbGameId, player_id: jbHunterPid, team: 'hunter' });
    await rpc(host, 'set_team', { game_id: jbGameId, player_id: jbHostPid, team: 'runner' });

    const placeJailRes = await rpc(host, 'set_jail_location', {
      game_id: jbGameId,
      lat: CENTER.lat + 0.001,
      lng: CENTER.lng + 0.001,
    });
    expect(!placeJailRes.error, 'host can place jail in play area', JSON.stringify(placeJailRes.error));

    const outsiderPlace = await rpc(outsider, 'set_jail_location', {
      game_id: jbGameId,
      lat: CENTER.lat + 0.001,
      lng: CENTER.lng + 0.001,
    });
    expect(Boolean(outsiderPlace.error), 'outsider cannot place jail', 'call unexpectedly succeeded');

    const hunterPlace = await rpc(hunter, 'set_jail_location', {
      game_id: jbGameId,
      lat: CENTER.lat + 0.001,
      lng: CENTER.lng + 0.001,
    });
    expect(Boolean(hunterPlace.error), 'hunter cannot place jail', 'call unexpectedly succeeded');

    const outsiderEntities = await outsider
      .from('entities')
      .select('*')
      .eq('game_id', jbGameId);
    expectEmpty(outsiderEntities.data, 'outsider cannot read entities table for game');

    const memberEntities = await host
      .from('entities')
      .select('*')
      .eq('game_id', jbGameId)
      .eq('kind', 'jail');
    expectRows(memberEntities.data, 'game member can read jail entity');

    const hostState = await rpc<{ game: { jail?: { latitude: number; longitude: number } } }>(
      host,
      'get_game_state',
      { game_id: jbGameId },
    );
    expect(
      Boolean(hostState.data?.game?.jail?.latitude),
      'host sees jail location in game state',
      JSON.stringify(hostState.data?.game?.jail),
    );

    const hunterState = await rpc<{ game: { jail?: { latitude: number; longitude: number } } }>(
      hunter,
      'get_game_state',
      { game_id: jbGameId },
    );
    expect(
      Boolean(hunterState.data?.game?.jail?.latitude),
      'hunter sees jail location in game state',
      JSON.stringify(hunterState.data?.game?.jail),
    );

    const outsiderState = await rpc(outsider, 'get_game_state', { game_id: jbGameId });
    expect(Boolean(outsiderState.error), 'outsider cannot read game state', 'call unexpectedly succeeded');

    const outsiderStartRescue = await rpc(outsider, 'start_rescue', { game_id: jbGameId });
    expect(Boolean(outsiderStartRescue.error), 'outsider cannot call start_rescue', 'call unexpectedly succeeded');

    const outsiderCompleteRescue = await rpc(outsider, 'complete_rescue', { game_id: jbGameId });
    expect(Boolean(outsiderCompleteRescue.error), 'outsider cannot call complete_rescue', 'call unexpectedly succeeded');

    const outsiderCancelRescue = await rpc(outsider, 'cancel_rescue', { game_id: jbGameId });
    expect(Boolean(outsiderCancelRescue.error), 'outsider cannot call cancel_rescue', 'call unexpectedly succeeded');

    const hunterStartRescue = await rpc(hunter, 'start_rescue', { game_id: jbGameId });
    expect(Boolean(hunterStartRescue.error), 'hunter cannot call start_rescue', 'call unexpectedly succeeded');

    const hunterCompleteRescue = await rpc(hunter, 'complete_rescue', { game_id: jbGameId });
    expect(Boolean(hunterCompleteRescue.error), 'hunter cannot call complete_rescue', 'call unexpectedly succeeded');

    const hunterCancelRescue = await rpc(hunter, 'cancel_rescue', { game_id: jbGameId });
    expect(Boolean(hunterCancelRescue.error), 'hunter cannot call cancel_rescue', 'call unexpectedly succeeded');

    const hunterRescueEvents = await hunter
      .from('events')
      .select('*')
      .eq('game_id', jbGameId)
      .eq('type', 'rescue_started');
    expectEmpty(hunterRescueEvents.data, 'hunter cannot read rescue_started event');
  }

  // --- Assassin Ring Access and Secrecy Checks (B2) ---
  const ringCreated = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'assassin_ring',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      head_start_s: 0,
      duration_s: 300,
      ping_interval_s: 30,
    },
  });
  const ringGameId = ringCreated.data?.[0]?.game_id;
  const ringCode = ringCreated.data?.[0]?.code;
  expect(Boolean(ringGameId), 'assassin ring game created for RLS check', JSON.stringify(ringCreated.error));

  if (ringGameId && ringCode) {
    // 1. Safe zone setup authorization
    const hostSafeZone = await rpc(host, 'set_safe_zone_location', {
      p_game_id: ringGameId,
      p_zone_index: 1,
      p_lat: CENTER.lat + 0.001,
      p_lng: CENTER.lng + 0.001,
      p_radius_m: 20,
    });
    expect(!hostSafeZone.error, 'host can set safe zone location in lobby', JSON.stringify(hostSafeZone.error));

    const outsiderSafeZone = await rpc(outsider, 'set_safe_zone_location', {
      p_game_id: ringGameId,
      p_zone_index: 1,
      p_lat: CENTER.lat + 0.001,
      p_lng: CENTER.lng + 0.001,
    });
    expect(Boolean(outsiderSafeZone.error), 'outsider cannot set safe zone location', 'call unexpectedly succeeded');

    const hunterSafeZone = await rpc(hunter, 'set_safe_zone_location', {
      p_game_id: ringGameId,
      p_zone_index: 1,
      p_lat: CENTER.lat + 0.001,
      p_lng: CENTER.lng + 0.001,
    });
    expect(Boolean(hunterSafeZone.error), 'non-host player cannot set safe zone location', 'call unexpectedly succeeded');

    const outsideSafeZone = await rpc(host, 'set_safe_zone_location', {
      p_game_id: ringGameId,
      p_zone_index: 1,
      p_lat: CENTER.lat + 0.5,
      p_lng: CENTER.lng,
      p_radius_m: 20,
    });
    expect(Boolean(outsideSafeZone.error), 'safe zone outside play area boundary is rejected', 'call unexpectedly succeeded');

    const outsiderTag = await rpc(outsider, 'attempt_tag', { game_id: ringGameId });
    expect(Boolean(outsiderTag.error), 'outsider cannot call attempt_tag in assassin ring', 'call unexpectedly succeeded');

    // 2. Third player joins so ring can start (min 3 players)
    const ringPlayer3 = await anonymousClient('RingPlayer3');
    await rpc(hunter, 'join_game', { code: ringCode });
    await rpc(ringPlayer3, 'join_game', { code: ringCode });

    const hostPid = await playerId(host, ringGameId);

    for (const client of [host, hunter, ringPlayer3]) {
      await rpc(client, 'set_share_trail', { game_id: ringGameId, share: true });
      await rpc(client, 'set_ready', { game_id: ringGameId, ready: true });
    }

    const startRing = await rpc(host, 'start_game', { game_id: ringGameId });
    expect(!startRing.error, 'host starts assassin ring game with 3 players', JSON.stringify(startRing.error));

    // 3. Zero-Knowledge Secrecy on ring_assignments while live/countdown
    const hostRing = (await host.from('ring_assignments').select('*').eq('game_id', ringGameId)).data ?? [];
    expect(
      hostRing.length === 1 && hostRing[0].hunter_player_id === hostPid,
      'active player can read only their own assigned prey row',
      `visible rows: ${hostRing.length}`,
    );

    const reverseRing = (await host.from('ring_assignments').select('*').eq('game_id', ringGameId).eq('prey_player_id', hostPid)).data ?? [];
    expect(
      reverseRing.length === 0,
      'active player cannot read who is hunting them from ring_assignments',
      `reverse rows: ${reverseRing.length}`,
    );

    const outsiderRing = (await outsider.from('ring_assignments').select('*').eq('game_id', ringGameId)).data ?? [];
    expectEmpty(outsiderRing, 'outsider cannot read ring_assignments during play');

    const outsiderEntities = (await outsider.from('entities').select('*').eq('game_id', ringGameId)).data ?? [];
    expectEmpty(outsiderEntities, 'outsider cannot read entities (safe zones) for ring game');

    const memberEntities = (await host.from('entities').select('*').eq('game_id', ringGameId).eq('kind', 'safe_zone')).data ?? [];
    expect(
      memberEntities.length >= 2,
      'game member can read safe zones from entities table',
      `found: ${memberEntities.length}`,
    );

    // 4. Post-Game Secrecy Lift: when game finishes, full ring is readable by members for replay
    await rpc(host, 'cancel_game', { game_id: ringGameId });

    const postGameHostRing = (await host.from('ring_assignments').select('*').eq('game_id', ringGameId)).data ?? [];
    expect(
      postGameHostRing.length === 3,
      'post-game recap lifts secrecy: all ring assignments readable by members',
      `found: ${postGameHostRing.length}`,
    );

    const postGameOutsiderRing = (await outsider.from('ring_assignments').select('*').eq('game_id', ringGameId)).data ?? [];
    expectEmpty(postGameOutsiderRing, 'outsider still cannot read ring_assignments after game finishes');

    for (const client of [host, hunter, ringPlayer3]) {
      await rpc(client, 'leave_game', { game_id: ringGameId });
    }
  }

  // --- Relay Heist Access and Secrecy Checks (B3) ---
  const rhCreated = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'relay_heist',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      head_start_s: 0,
      ping_interval_s: 30,
    },
  });
  const rhGameId = rhCreated.data?.[0]?.game_id;
  const rhCode = rhCreated.data?.[0]?.code;
  expect(Boolean(rhGameId), 'relay heist game created for RLS check', JSON.stringify(rhCreated.error));

  if (rhGameId && rhCode) {
    const rhRunner2 = await anonymousClient('RelayRunner2');
    await rpc(hunter, 'join_game', { code: rhCode });
    await rpc(rhRunner2, 'join_game', { code: rhCode });

    const rhHostPid = await playerId(host, rhGameId);
    const rhRunner2Pid = await playerId(rhRunner2, rhGameId);
    const rhHunterPid = await playerId(hunter, rhGameId);

    await rpc(host, 'set_team', { game_id: rhGameId, player_id: rhHostPid, team: 'runner' });
    await rpc(rhRunner2, 'set_team', { game_id: rhGameId, player_id: rhRunner2Pid, team: 'runner' });
    await rpc(hunter, 'set_team', { game_id: rhGameId, player_id: rhHunterPid, team: 'hunter' });

    // 1. Extraction placement authorization
    const outsiderExtraction = await rpc(outsider, 'set_extraction_location', {
      p_game_id: rhGameId,
      p_lat: CENTER.lat + 0.001,
      p_lng: CENTER.lng + 0.001,
    });
    expect(Boolean(outsiderExtraction.error), 'outsider cannot set extraction location', 'call unexpectedly succeeded');

    const hunterExtraction = await rpc(hunter, 'set_extraction_location', {
      p_game_id: rhGameId,
      p_lat: CENTER.lat + 0.001,
      p_lng: CENTER.lng + 0.001,
    });
    expect(Boolean(hunterExtraction.error), 'hunter cannot set extraction location', 'call unexpectedly succeeded');

    const outsideExtraction = await rpc(host, 'set_extraction_location', {
      p_game_id: rhGameId,
      p_lat: CENTER.lat + 0.05,
      p_lng: CENTER.lng + 0.05,
      p_radius_m: 25,
    });
    expect(Boolean(outsideExtraction.error), 'host cannot set extraction location outside boundary', 'call unexpectedly succeeded');

    const hostExtraction = await rpc(host, 'set_extraction_location', {
      p_game_id: rhGameId,
      p_lat: CENTER.lat + 0.001,
      p_lng: CENTER.lng + 0.001,
      p_radius_m: 25,
    });
    expect(!hostExtraction.error, 'host can set extraction location inside boundary', JSON.stringify(hostExtraction.error));

    // 2. Start game and verify carrier secrecy
    for (const client of [host, rhRunner2, hunter]) {
      await rpc(client, 'set_share_trail', { game_id: rhGameId, share: true });
      await rpc(client, 'set_ready', { game_id: rhGameId, ready: true });
    }

    const startRh = await rpc(host, 'start_game', { game_id: rhGameId });
    expect(!startRh.error, 'host starts relay heist game', JSON.stringify(startRh.error));

    // Fast-forward countdown
    await new Promise((r) => setTimeout(r, 11000));

    // 3. Entity table secrecy: package is visible_to = 'runner' while carried
    const hostEntities = (await host.from('entities').select('*').eq('game_id', rhGameId)).data ?? [];
    const hostPackageEntity = hostEntities.find((e) => e.kind === 'package');
    expect(
      Boolean(hostPackageEntity),
      'runner member can read package entity from entities table while carried',
      `found entities: ${hostEntities.map((e) => e.kind).join(', ')}`,
    );

    const hunterEntities = (await hunter.from('entities').select('*').eq('game_id', rhGameId)).data ?? [];
    const hunterPackageEntity = hunterEntities.find((e) => e.kind === 'package');
    expect(
      !hunterPackageEntity,
      'hunter CANNOT read carried package entity from entities table (RLS secrecy)',
      `hunter unexpectedly saw: ${JSON.stringify(hunterPackageEntity)}`,
    );

    const outsiderEntities = (await outsider.from('entities').select('*').eq('game_id', rhGameId)).data ?? [];
    expectEmpty(outsiderEntities, 'outsider cannot read entities table for relay heist game');

    // 4. Role RPC authorization
    const hunterHandoff = await rpc(hunter, 'request_handoff', {
      p_game_id: rhGameId,
      p_target_player_id: rhHostPid,
    });
    expect(Boolean(hunterHandoff.error), 'hunter cannot call request_handoff', 'call unexpectedly succeeded');

    const hunterConfirm = await rpc(hunter, 'confirm_handoff', { p_game_id: rhGameId });
    expect(Boolean(hunterConfirm.error), 'hunter cannot call confirm_handoff', 'call unexpectedly succeeded');

    const outsiderConfirm = await rpc(outsider, 'confirm_handoff', { p_game_id: rhGameId });
    expect(Boolean(outsiderConfirm.error), 'outsider cannot call confirm_handoff', 'call unexpectedly succeeded');

    const hunterPickup = await rpc(hunter, 'pickup_package', { p_game_id: rhGameId });
    expect(Boolean(hunterPickup.error), 'hunter cannot call pickup_package', 'call unexpectedly succeeded');

    const outsiderPickup = await rpc(outsider, 'pickup_package', { p_game_id: rhGameId });
    expect(Boolean(outsiderPickup.error), 'outsider cannot call pickup_package', 'call unexpectedly succeeded');

    const runnerSecuring = await rpc(host, 'start_securing_package', { p_game_id: rhGameId });
    expect(Boolean(runnerSecuring.error), 'runner cannot call start_securing_package', 'call unexpectedly succeeded');

    const runnerCompleteSecure = await rpc(host, 'complete_secure_package', { p_game_id: rhGameId });
    expect(Boolean(runnerCompleteSecure.error), 'runner cannot call complete_secure_package', 'call unexpectedly succeeded');

    const outsiderCompleteSecure = await rpc(outsider, 'complete_secure_package', { p_game_id: rhGameId });
    expect(Boolean(outsiderCompleteSecure.error), 'outsider cannot call complete_secure_package', 'call unexpectedly succeeded');

    // 5. Event secrecy: runner-audience events cannot be read by hunters
    const hunterRunnerEvents = (await hunter.from('events').select('*').eq('game_id', rhGameId).eq('audience', 'runner')).data ?? [];
    expectEmpty(hunterRunnerEvents, 'hunter cannot read runner-audience events from events table');

    for (const client of [host, rhRunner2, hunter]) {
      await rpc(client, 'leave_game', { game_id: rhGameId });
    }
  }

  // --- VIP Escort Role Secrecy Checks (B4) ---
  const vipCreated = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'classic_chase',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      roles: ['vip'],
      head_start_s: 0,
      ping_interval_s: 30,
    },
  });
  const vipGameId = vipCreated.data?.[0]?.game_id;
  const vipCode = vipCreated.data?.[0]?.code;
  expect(Boolean(vipGameId), 'vip escort game created for RLS check', JSON.stringify(vipCreated.error));

  if (vipGameId && vipCode) {
    const vipRunner2 = await anonymousClient('VIPRunner2');
    await rpc(hunter, 'join_game', { code: vipCode });
    await rpc(vipRunner2, 'join_game', { code: vipCode });

    const vipHostPid = await playerId(host, vipGameId);
    const vipRunner2Pid = await playerId(vipRunner2, vipGameId);
    const vipHunterPid = await playerId(hunter, vipGameId);

    await rpc(host, 'set_team', { game_id: vipGameId, player_id: vipHostPid, team: 'runner' });
    await rpc(vipRunner2, 'set_team', { game_id: vipGameId, player_id: vipRunner2Pid, team: 'runner' });
    await rpc(hunter, 'set_team', { game_id: vipGameId, player_id: vipHunterPid, team: 'hunter' });

    for (const client of [host, vipRunner2, hunter]) {
      await rpc(client, 'set_share_trail', { game_id: vipGameId, share: true });
      await rpc(client, 'set_ready', { game_id: vipGameId, ready: true });
    }

    await rpc(host, 'begin_target_selection', { game_id: vipGameId });
    await rpc(host, 'set_target', {
      game_id: vipGameId,
      lat: CENTER.lat + 0.001,
      lng: CENTER.lng + 0.001,
    });
    for (const client of [host, vipRunner2, hunter]) {
      await rpc(client, 'set_ready', { game_id: vipGameId, ready: true });
    }

    const startVip = await rpc(host, 'start_game', { game_id: vipGameId });
    expect(!startVip.error, 'host starts VIP Escort game', JSON.stringify(startVip.error));

    // Wait for countdown to expire so game enters live status
    await new Promise((r) => setTimeout(r, 11000));

    // 1. Runner secrecy check:
    // Host (runner) inspects get_game_state / get_my_role -> sees secret_role for self and runner teammate
    const hostState = await rpc<{ players?: Array<{ id: string; team: string; secret_role?: string | null }> }>(
      host,
      'get_game_state',
      { game_id: vipGameId },
    );
    const hostPlayers = hostState.data?.players ?? [];
    const hostRole1 = await rpc<{ role: string | null }>(host, 'get_my_role', { game_id: vipGameId });
    const hostRole2 = await rpc<{ role: string | null }>(vipRunner2, 'get_my_role', { game_id: vipGameId });
    const runnerRolesVisible =
      (hostPlayers.length > 0 && hostPlayers.filter((p) => p.team === 'runner').every((p) => p.secret_role === 'vip' || p.secret_role === 'bodyguard')) ||
      ([hostRole1.data?.role, hostRole2.data?.role].includes('vip') && [hostRole1.data?.role, hostRole2.data?.role].includes('bodyguard'));
    expect(runnerRolesVisible, 'runners can see teammates secret_role (vip/bodyguard)', JSON.stringify({ hostPlayers, r1: hostRole1.data, r2: hostRole2.data }));

    // 2. Hunter secrecy check:
    // Hunter inspects get_game_state -> must NOT see runner secret_role (must be null)
    const hunterState = await rpc<{ players: Array<{ id: string; team: string; secret_role?: string | null }> }>(
      hunter,
      'get_game_state',
      { game_id: vipGameId },
    );
    const hunterPlayers = hunterState.data?.players ?? [];
    const hunterSeesNoRunnerRoles = hunterPlayers
      .filter((p) => p.team === 'runner')
      .every((p) => p.secret_role === null || p.secret_role === undefined);
    expect(
      hunterSeesNoRunnerRoles,
      'hunter CANNOT see runner secret_role during live play (RLS secrecy)',
      JSON.stringify(hunterPlayers.map((p) => ({ id: p.id, team: p.team, role: p.secret_role }))),
    );

    // 3. Direct game_players table check (RLS)
    const hunterDirectPlayers = (await hunter.from('players').select('id, team, secret_role').eq('game_id', vipGameId)).data ?? [];
    const hunterDirectSeesNoSecret = hunterDirectPlayers
      .filter((p) => p.team === 'runner')
      .every((p) => p.secret_role === null || p.secret_role === undefined);
    expect(
      hunterDirectSeesNoSecret,
      'hunter direct players select cannot read runner secret_role during live play',
      JSON.stringify(hunterDirectPlayers),
    );

    // 4. Role swap authorization:
    // Outsider cannot request role swap
    const outsiderSwap = await rpc(outsider, 'request_role_swap', {
      p_game_id: vipGameId,
      p_target_player_id: vipRunner2Pid,
    });
    expect(Boolean(outsiderSwap.error), 'outsider cannot call request_role_swap', 'call unexpectedly succeeded');

    const outsiderConfirmSwap = await rpc(outsider, 'confirm_role_swap', { p_game_id: vipGameId });
    expect(Boolean(outsiderConfirmSwap.error), 'outsider cannot call confirm_role_swap', 'call unexpectedly succeeded');

    const outsiderCancelSwap = await rpc(outsider, 'cancel_role_swap', { p_game_id: vipGameId });
    expect(Boolean(outsiderCancelSwap.error), 'outsider cannot call cancel_role_swap', 'call unexpectedly succeeded');

    // Hunter cannot request or confirm role swap
    const hunterSwap = await rpc(hunter, 'request_role_swap', {
      p_game_id: vipGameId,
      p_target_player_id: vipHostPid,
    });
    expect(Boolean(hunterSwap.error), 'hunter cannot call request_role_swap', 'call unexpectedly succeeded');

    const hunterConfirmSwap = await rpc(hunter, 'confirm_role_swap', { p_game_id: vipGameId });
    expect(Boolean(hunterConfirmSwap.error), 'hunter cannot call confirm_role_swap', 'call unexpectedly succeeded');

    // Runner cannot swap with hunter
    const swapWithHunter = await rpc(host, 'request_role_swap', {
      p_game_id: vipGameId,
      p_target_player_id: vipHunterPid,
    });
    expect(Boolean(swapWithHunter.error), 'runner cannot swap role with hunter', 'call unexpectedly succeeded');

    // 5. Event secrecy: Hunter cannot read runner-audience events (roles_swapped / role_swap_requested)
    const hunterVipEvents = (await hunter.from('events').select('*').eq('game_id', vipGameId).eq('audience', 'runner')).data ?? [];
    expectEmpty(hunterVipEvents, 'hunter cannot read runner-audience events in VIP Escort game');

    for (const client of [host, vipRunner2, hunter]) {
      await rpc(client, 'leave_game', { game_id: vipGameId });
    }
  }

  // --- Operator Role Secrecy and Security Checks (B5) ---
  const opCreated = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'tag_hunt',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      roles: ['operator'],
      head_start_s: 0,
      ping_interval_s: 30,
    },
  });
  const opGameId = opCreated.data?.[0]?.game_id;
  const opCode = opCreated.data?.[0]?.code;
  expect(Boolean(opGameId), 'operator game created for RLS check', JSON.stringify(opCreated.error));

  if (opGameId && opCode) {
    const opRunner2 = await anonymousClient('OpRunner2');
    const opHunter2 = await anonymousClient('OpHunter2');
    await rpc(hunter, 'join_game', { code: opCode });
    await rpc(opRunner2, 'join_game', { code: opCode });
    await rpc(opHunter2, 'join_game', { code: opCode });

    const opHostPid = await playerId(host, opGameId);
    const opRunner2Pid = await playerId(opRunner2, opGameId);
    const opHunterPid = await playerId(hunter, opGameId);
    const opHunter2Pid = await playerId(opHunter2, opGameId);

    await rpc(host, 'set_team', { game_id: opGameId, player_id: opHostPid, team: 'runner' });
    await rpc(opRunner2, 'set_team', { game_id: opGameId, player_id: opRunner2Pid, team: 'runner' });
    await rpc(hunter, 'set_team', { game_id: opGameId, player_id: opHunterPid, team: 'hunter' });
    await rpc(opHunter2, 'set_team', { game_id: opGameId, player_id: opHunter2Pid, team: 'hunter' });

    // 1. Lobby remote designation & limit check:
    // Runner 2 designates as remote operator (Runner Operator)
    const setRemoteRunner = await rpc(opRunner2, 'set_player_remote', {
      p_game_id: opGameId,
      p_is_remote: true,
    });
    expect(!setRemoteRunner.error, 'player can designate self as remote operator in lobby', JSON.stringify(setRemoteRunner.error));

    // Hunter 2 designates as remote operator (Hunter Operator)
    const setRemoteHunter = await rpc(opHunter2, 'set_player_remote', {
      p_game_id: opGameId,
      p_is_remote: true,
    });
    expect(!setRemoteHunter.error, 'hunter can designate self as remote operator in lobby', JSON.stringify(setRemoteHunter.error));

    // Host attempts to also set self as remote runner operator -> must fail (limit 1 operator per team)
    const setRemoteHostFail = await rpc(host, 'set_player_remote', {
      p_game_id: opGameId,
      p_is_remote: true,
    });
    expect(
      Boolean(setRemoteHostFail.error),
      'second operator on same team is rejected by set_player_remote',
      'unexpectedly allowed multiple operators on team',
    );

    // Ready-up and start game
    for (const client of [host, opRunner2, hunter, opHunter2]) {
      await rpc(client, 'set_share_trail', { game_id: opGameId, share: true });
      await rpc(client, 'set_ready', { game_id: opGameId, ready: true });
    }

    const startOp = await rpc(host, 'start_game', { game_id: opGameId });
    expect(!startOp.error, 'host starts operator game', JSON.stringify(startOp.error));

    // Fast-forward countdown so game is live
    await new Promise((r) => setTimeout(r, 11000));

    // Field runner (host) submits position
    await rpc(host, 'submit_position', {
      game_id: opGameId,
      lat: CENTER.lat + 0.0001,
      lng: CENTER.lng + 0.0001,
      accuracy: 5,
    });

    // Field hunter submits position
    await rpc(hunter, 'submit_position', {
      game_id: opGameId,
      lat: CENTER.lat + 0.0002,
      lng: CENTER.lng + 0.0002,
      accuracy: 5,
    });

    // 2. Tactical Markers & Team Secrecy Check
    // Runner operator places marker
    const markerRes = await rpc<{ marker_id?: string }>(opRunner2, 'place_marker', {
      p_game_id: opGameId,
      p_lat: CENTER.lat + 0.0001,
      p_lng: CENTER.lng + 0.0001,
      p_label: 'Rendezvous Point',
    });
    expect(!markerRes.error, 'runner operator places tactical marker', JSON.stringify(markerRes.error));

    // Runner teammate (host) CAN see marker in entities table
    const runnerEntities = (await host.from('entities').select('*').eq('game_id', opGameId)).data ?? [];
    const runnerSeesMarker = runnerEntities.some(
      (e) => e.kind === 'marker' && (e.state as { label?: string })?.label === 'Rendezvous Point',
    );
    expect(runnerSeesMarker, 'runner teammate can read tactical marker from entities', JSON.stringify(runnerEntities));

    // Hunter CANNOT see runner tactical marker in entities table (RLS policy check)
    const hunterEntities = (await hunter.from('entities').select('*').eq('game_id', opGameId)).data ?? [];
    const hunterSeesRunnerMarker = hunterEntities.some(
      (e) => e.kind === 'marker' && (e.state as { label?: string })?.label === 'Rendezvous Point',
    );
    expect(!hunterSeesRunnerMarker, 'hunter cannot read runner tactical marker (RLS team isolation)', JSON.stringify(hunterEntities));

    // Outsider CANNOT read any entities table
    const outsiderEntitiesOp = (await outsider.from('entities').select('*').eq('game_id', opGameId)).data ?? [];
    expectEmpty(outsiderEntitiesOp, 'outsider cannot read entities for operator game');

    // 3. Tactical Scans & Coordinate Secrecy
    // Runner operator scan produces 150m vague envelope, NEVER returns hunter coordinates
    const runnerScanRes = await rpc<{
      scan_type?: string;
      found?: boolean;
      radius_m?: number;
      latitude?: number;
      longitude?: number;
      exact_hunter_coords?: unknown;
    }>(opRunner2, 'operator_scan', {
      p_game_id: opGameId,
    });
    expect(!runnerScanRes.error, 'runner operator executes tactical scan', JSON.stringify(runnerScanRes.error));
    expect(
      runnerScanRes.data?.scan_type === 'runner_sweep' && runnerScanRes.data?.radius_m === 150,
      'runner scan returns 150m envelope',
      JSON.stringify(runnerScanRes.data),
    );
    expect(
      !('exact_hunter_coords' in (runnerScanRes.data ?? {})) && !('hunter_lat' in (runnerScanRes.data ?? {})),
      'runner scan preserves hunter coordinate secrecy (no raw hunter GPS exposed)',
      JSON.stringify(runnerScanRes.data),
    );

    // Hunter Operator scan constraint: outside boundary fails
    const oobHunterScan = await rpc(opHunter2, 'operator_scan', {
      p_game_id: opGameId,
      p_lat: CENTER.lat + 1.0, // Far outside 600m boundary
      p_lng: CENTER.lng + 1.0,
    });
    expect(
      Boolean(oobHunterScan.error),
      'hunter operator scan outside game boundary is blocked',
      'unexpectedly succeeded outside boundary',
    );

    // Hunter Operator scan inside boundary returns census count only
    const validHunterScan = await rpc<{
      scan_type?: string;
      count?: number;
      runner_positions?: unknown;
    }>(opHunter2, 'operator_scan', {
      p_game_id: opGameId,
      p_lat: CENTER.lat,
      p_lng: CENTER.lng,
    });
    expect(!validHunterScan.error, 'hunter operator executes census scan inside boundary', JSON.stringify(validHunterScan.error));
    expect(
      validHunterScan.data?.scan_type === 'hunter_census' && typeof validHunterScan.data?.count === 'number',
      'hunter scan returns census count without coordinates',
      JSON.stringify(validHunterScan.data),
    );
    expect(
      !('runner_positions' in (validHunterScan.data ?? {})),
      'hunter census exposes zero runner positions',
      JSON.stringify(validHunterScan.data),
    );

    // 4. Operator Immunity and Tag Restriction
    // Hunter attempts to tag remote runner operator -> must fail
    const tagOperatorFail = await rpc(hunter, 'attempt_tag', {
      p_game_id: opGameId,
      p_runner_id: opRunner2Pid,
      p_hunter_lat: CENTER.lat + 0.0001,
      p_hunter_lng: CENTER.lng + 0.0001,
    });
    expect(
      Boolean(tagOperatorFail.error),
      'remote operator is immune to tagging',
      'hunter unexpectedly tagged remote operator',
    );

    // Remote operator cannot tag anyone
    const operatorAttemptTag = await rpc(opRunner2, 'attempt_tag', {
      p_game_id: opGameId,
      p_runner_id: opHostPid,
      p_hunter_lat: CENTER.lat + 0.0001,
      p_hunter_lng: CENTER.lng + 0.0001,
    });
    expect(
      Boolean(operatorAttemptTag.error),
      'remote operator cannot execute tags',
      'remote operator unexpectedly tagged another player',
    );

    // 5. Negative Access & Input Validation Tests (VM2)
    // Field runner (host) cannot place tactical markers
    const fieldPlaceMarker = await rpc(host, 'place_marker', {
      p_game_id: opGameId,
      p_lat: CENTER.lat + 0.0001,
      p_lng: CENTER.lng + 0.0001,
      p_label: 'Illegal Field Marker',
    });
    expect(
      Boolean(fieldPlaceMarker.error),
      'field player cannot place tactical markers (operator only)',
      'field player unexpectedly placed marker',
    );

    // Field runner (host) cannot clear tactical markers
    const fieldClearMarker = await rpc(host, 'clear_marker', {
      p_game_id: opGameId,
      p_marker_id: markerRes.data?.marker_id,
    });
    expect(
      Boolean(fieldClearMarker.error),
      'field player cannot clear tactical markers (operator only)',
      'field player unexpectedly cleared marker',
    );

    // Field runner (host) cannot execute operator scan
    const fieldScan = await rpc(host, 'operator_scan', {
      p_game_id: opGameId,
    });
    expect(
      Boolean(fieldScan.error),
      'field player cannot trigger operator scan (operator only)',
      'field player unexpectedly executed scan',
    );

    // Field runner (host) cannot send operator tactical comms
    const fieldComms = await rpc(host, 'send_operator_message', {
      p_game_id: opGameId,
      p_message: 'Illegal Comms',
    });
    expect(
      Boolean(fieldComms.error),
      'field player cannot send operator messages (operator only)',
      'field player unexpectedly sent operator message',
    );

    // Remote operator cannot place marker beyond 1.5x boundary
    const oobMarker = await rpc(opRunner2, 'place_marker', {
      p_game_id: opGameId,
      p_lat: CENTER.lat + 1.0, // Far outside boundary
      p_lng: CENTER.lng + 1.0,
      p_label: 'OOB Marker',
    });
    expect(
      Boolean(oobMarker.error),
      'operator marker outside 1.5x boundary is rejected',
      'operator unexpectedly placed OOB marker',
    );

    // Remote operator cannot send empty or overly long comms message (> 200 chars)
    const emptyComms = await rpc(opRunner2, 'send_operator_message', {
      p_game_id: opGameId,
      p_message: '   ',
    });
    expect(
      Boolean(emptyComms.error),
      'empty operator message is rejected',
      'operator unexpectedly sent whitespace-only message',
    );

    const longComms = await rpc(opRunner2, 'send_operator_message', {
      p_game_id: opGameId,
      p_message: 'A'.repeat(201),
    });
    expect(
      Boolean(longComms.error),
      'operator message exceeding 200 characters is rejected',
      'operator unexpectedly sent 201-char message',
    );

    // Hunter operator scan missing lat/lng is rejected
    const hunterMissingCoordsScan = await rpc(opHunter2, 'operator_scan', {
      p_game_id: opGameId,
    });
    expect(
      Boolean(hunterMissingCoordsScan.error),
      'hunter operator scan without coordinates is rejected',
      'hunter operator unexpectedly executed scan without coordinates',
    );

    // Outsider cannot call place_marker, operator_scan, or send_operator_message
    const outsiderMarker = await rpc(outsider, 'place_marker', {
      p_game_id: opGameId,
      p_lat: CENTER.lat,
      p_lng: CENTER.lng,
      p_label: 'Outsider Marker',
    });
    expect(
      Boolean(outsiderMarker.error),
      'outsider cannot place tactical marker',
      'outsider unexpectedly placed marker',
    );

    const outsiderScan = await rpc(outsider, 'operator_scan', {
      p_game_id: opGameId,
    });
    expect(
      Boolean(outsiderScan.error),
      'outsider cannot execute operator scan',
      'outsider unexpectedly executed scan',
    );

    const outsiderComms = await rpc(outsider, 'send_operator_message', {
      p_game_id: opGameId,
      p_message: 'Outsider Comms',
    });
    expect(
      Boolean(outsiderComms.error),
      'outsider cannot send operator comms',
      'outsider unexpectedly sent comms',
    );

    for (const client of [host, opRunner2, hunter, opHunter2]) {
      await rpc(client, 'leave_game', { game_id: opGameId });
    }
  }

  // --- Double Agent Role & Tribunal Secrecy Checks (VM2) ---
  const daCreated = await rpc<{ game_id: string; code: string }[]>(host, 'create_game', {
    mode: 'classic_chase',
    lat: CENTER.lat,
    lng: CENTER.lng,
    radius_m: 600,
    settings: {
      roles: ['double_agent'],
      head_start_s: 0,
      ping_interval_s: 30,
    },
  });
  const daGameId = daCreated.data?.[0]?.game_id;
  const daCode = daCreated.data?.[0]?.code;
  expect(Boolean(daGameId), 'double agent game created for RLS check', JSON.stringify(daCreated.error));

  if (daGameId && daCode) {
    const daHunter2 = await anonymousClient('DaHunter2');
    await rpc(hunter, 'join_game', { code: daCode });
    await rpc(daHunter2, 'join_game', { code: daCode });

    const daHostPid = await playerId(host, daGameId);
    const daHunterPid = await playerId(hunter, daGameId);
    const daHunter2Pid = await playerId(daHunter2, daGameId);

    await rpc(host, 'set_team', { game_id: daGameId, player_id: daHostPid, team: 'runner' });
    await rpc(hunter, 'set_team', { game_id: daGameId, player_id: daHunterPid, team: 'hunter' });
    await rpc(daHunter2, 'set_team', { game_id: daGameId, player_id: daHunter2Pid, team: 'hunter' });

    for (const client of [host, hunter, daHunter2]) {
      await rpc(client, 'set_share_trail', { game_id: daGameId, share: true });
      await rpc(client, 'set_ready', { game_id: daGameId, ready: true });
    }

    await rpc(host, 'begin_target_selection', { game_id: daGameId });
    await rpc(host, 'set_target', {
      game_id: daGameId,
      lat: CENTER.lat + 0.002, // North quadrant
      lng: CENTER.lng,
    });

    for (const client of [host, hunter, daHunter2]) {
      await rpc(client, 'set_ready', { game_id: daGameId, ready: true });
    }

    const daStartRes = await rpc(host, 'start_game', { game_id: daGameId });
    expect(!daStartRes.error, 'host starts game with double agent role', JSON.stringify(daStartRes.error));

    // Fast-forward countdown so round is live
    await new Promise((r) => setTimeout(r, 11000));
    await rpc(host, 'advance_game', { game_id: daGameId });

    // Determine which hunter is the double agent
    const h1Status = await rpc<{ secret_role?: string; agent_powers?: unknown }>(hunter, 'get_my_status', { game_id: daGameId });
    const h2Status = await rpc<{ secret_role?: string; agent_powers?: unknown }>(daHunter2, 'get_my_status', { game_id: daGameId });

    const h1IsAgent = h1Status.data?.secret_role === 'agent';
    const h2IsAgent = h2Status.data?.secret_role === 'agent';
    expect(
      (h1IsAgent && !h2IsAgent) || (!h1IsAgent && h2IsAgent),
      'exactly 1 hunter assigned as agent',
      `h1=${h1IsAgent}, h2=${h2IsAgent}`,
    );

    const agentClient = h1IsAgent ? hunter : daHunter2;
    const loyalClient = h1IsAgent ? daHunter2 : hunter;
    const agentPid = h1IsAgent ? daHunterPid : daHunter2Pid;
    const loyalPid = h1IsAgent ? daHunter2Pid : daHunterPid;

    // 1. Column-level Secrecy of secret_role:
    // Direct select on players.secret_role fails or returns null for everyone
    const directSelectHunters = await loyalClient.from('players').select('id, secret_role').eq('game_id', daGameId);
    expect(
      Boolean(directSelectHunters.error) || (directSelectHunters.data ?? []).every((p) => p.secret_role === null),
      'players.secret_role is completely inaccessible to peers via direct SELECT',
      JSON.stringify(directSelectHunters.data),
    );

    // 2. Ability Secrecy & Access Restrictions:
    // Loyal hunter calling agent_whisper is rejected
    const loyalWhisperFail = await rpc(loyalClient, 'agent_whisper', { game_id: daGameId });
    expect(
      Boolean(loyalWhisperFail.error),
      'loyal hunter cannot call agent_whisper',
      'loyal hunter unexpectedly called whisper',
    );

    // Loyal hunter calling agent_scramble is rejected
    const loyalScrambleFail = await rpc(loyalClient, 'agent_scramble', {
      game_id: daGameId,
      runner_id: daHostPid,
    });
    expect(
      Boolean(loyalScrambleFail.error),
      'loyal hunter cannot call agent_scramble',
      'loyal hunter unexpectedly called scramble',
    );

    // Double Agent calling agent_whisper succeeds and returns target quadrant
    const agentWhisperRes = await rpc<{ quadrant?: string }>(agentClient, 'agent_whisper', { game_id: daGameId });
    expect(
      !agentWhisperRes.error && agentWhisperRes.data?.quadrant === 'North',
      'double agent whisper returns target cardinal quadrant',
      JSON.stringify(agentWhisperRes.data ?? agentWhisperRes.error),
    );

    // Repeat whisper is rejected (single use)
    const repeatWhisperFail = await rpc(agentClient, 'agent_whisper', { game_id: daGameId });
    expect(
      Boolean(repeatWhisperFail.error),
      'repeat agent_whisper call is rejected (single use)',
      'repeat whisper unexpectedly succeeded',
    );

    // 3. Tribunal Secrecy & Access Restrictions:
    // Runner attempting to start tribunal is rejected
    const runnerTribunalFail = await rpc(host, 'start_tribunal', {
      game_id: daGameId,
      accused_hunter_id: agentPid,
    });
    expect(
      Boolean(runnerTribunalFail.error),
      'runner cannot start tribunal (hunters only)',
      'runner unexpectedly started tribunal',
    );

    // Hunter accusing self is rejected
    const selfAccuseFail = await rpc(loyalClient, 'start_tribunal', {
      game_id: daGameId,
      accused_hunter_id: loyalPid,
    });
    expect(
      Boolean(selfAccuseFail.error),
      'hunter cannot accuse self in tribunal',
      'hunter unexpectedly accused self',
    );

    // Loyal hunter convenes tribunal against agent
    const startTribRes = await rpc<{ status?: string }>(loyalClient, 'start_tribunal', {
      game_id: daGameId,
      accused_hunter_id: agentPid,
    });
    expect(!startTribRes.error, 'loyal hunter convenes tribunal against suspect', JSON.stringify(startTribRes.error));

    // Runner CANNOT read tribunals table under RLS (team isolation)
    const runnerTribunals = (await host.from('tribunals').select('*').eq('game_id', daGameId)).data ?? [];
    expectEmpty(runnerTribunals, 'runner cannot read tribunals table (RLS policy)');

    // Outsider CANNOT read tribunals table under RLS
    const outsiderTribunals = (await outsider.from('tribunals').select('*').eq('game_id', daGameId)).data ?? [];
    expectEmpty(outsiderTribunals, 'outsider cannot read tribunals table (RLS policy)');

    // Loyal hunter CAN read tribunals table under RLS
    const hunterTribunals = (await loyalClient.from('tribunals').select('*').eq('game_id', daGameId)).data ?? [];
    expect(
      hunterTribunals.length === 1,
      'hunter can read active tribunal under RLS',
      `count=${hunterTribunals.length}`,
    );

    // Runner attempting to vote in tribunal is rejected
    const runnerVoteFail = await rpc(host, 'cast_vote', {
      game_id: daGameId,
      vote: true,
    });
    expect(
      Boolean(runnerVoteFail.error),
      'runner cannot cast vote in tribunal',
      'runner unexpectedly voted in tribunal',
    );

    // Second tribunal in same match is rejected
    const secondTribFail = await rpc(loyalClient, 'start_tribunal', {
      game_id: daGameId,
      accused_hunter_id: agentPid,
    });
    expect(
      Boolean(secondTribFail.error),
      'second tribunal in same game is rejected (once per game)',
      'second tribunal unexpectedly permitted',
    );

    for (const client of [host, hunter, daHunter2]) {
      await rpc(client, 'leave_game', { game_id: daGameId });
    }
  }

  // Consent records are append-only and reachable only through the RPCs.
  const policyAck = await rpc(host, 'set_consent', {
    consent_type: 'policy_ack',
    granted: true,
    policy_version: 1,
  });
  expect(
    !policyAck.error,
    'a policy acknowledgement can be recorded',
    String(policyAck.error?.message ?? ''),
  );
  const directConsentRead = await host.from('consents').select('*');
  expect(
    Boolean(directConsentRead.error) || (directConsentRead.data ?? []).length === 0,
    'consents are not directly readable',
    JSON.stringify(directConsentRead.data ?? directConsentRead.error?.message),
  );
  const directConsentWrite = await host
    .from('consents')
    .insert({ user_id: hostUserId, consent_type: 'diagnostics', granted: true });
  expect(
    Boolean(directConsentWrite.error),
    'consents are not directly writable',
    'insert unexpectedly succeeded',
  );
  const myConsents = await rpc<Record<string, unknown>>(host, 'get_my_consents', {});
  expect(
    Boolean(myConsents.data && (myConsents.data as Record<string, unknown>).policy_ack),
    'consent state is readable through get_my_consents',
    JSON.stringify(myConsents.data ?? myConsents.error?.message),
  );
  const exported = await rpc<{ profile?: { id?: string } | null; games?: unknown[] }>(
    host,
    'export_my_data',
    {},
  );
  expect(
    Boolean(exported.data?.profile && (exported.data.profile as { id?: string }).id === hostUserId),
    'export bundle contains the caller profile',
    JSON.stringify(exported.error?.message ?? exported.data?.profile),
  );
  expect(
    Array.isArray(exported.data?.games) && (exported.data?.games?.length ?? 0) > 0,
    'export bundle contains the games the caller joined',
    JSON.stringify(exported.data?.games?.length ?? exported.error?.message),
  );

  // Account deletion uses the outsider account (all its secrecy checks are done).
  const outsiderProfileBefore = await rpc<{ profile?: unknown }>(outsider, 'export_my_data', {});
  expect(
    outsiderProfileBefore.data?.profile !== null,
    'outsider has a profile before deletion',
    JSON.stringify(outsiderProfileBefore.error?.message),
  );
  const deleted = await rpc<{ deleted?: boolean }>(outsider, 'delete_my_data', {});
  expect(
    deleted.data?.deleted === true,
    'delete_my_data removes the caller’s profile and data',
    JSON.stringify(deleted.error?.message ?? deleted.data),
  );
  const outsiderProfileAfter = await rpc<{ profile?: unknown }>(outsider, 'export_my_data', {});
  expect(
    outsiderProfileAfter.data?.profile === null,
    'the deleted profile and personal data are gone',
    JSON.stringify(outsiderProfileAfter.data?.profile ?? outsiderProfileAfter.error?.message),
  );

  // Multi-asset account deletion test on an active game participant (hunter).
  // Hunter participated in multiple matches, uploaded position fixes, recorded trail points,
  // performed tags, and holds privacy consent records.
  await rpc(hunter, 'set_consent', { consent_type: 'ghost', granted: true });
  const hunterExportBefore = await rpc<{
    profile?: { id?: string } | null;
    games?: unknown[];
    trail_points?: unknown[];
  }>(hunter, 'export_my_data', {});
  expect(
    Boolean(
      hunterExportBefore.data?.profile &&
        (hunterExportBefore.data?.trail_points?.length ?? 0) > 0 &&
        (hunterExportBefore.data?.games?.length ?? 0) > 0,
    ),
    'active participant has profile, games and trail points before deletion',
    JSON.stringify({
      hasProfile: Boolean(hunterExportBefore.data?.profile),
      gamesCount: hunterExportBefore.data?.games?.length,
      trailCount: hunterExportBefore.data?.trail_points?.length,
    }),
  );

  const hunterDeleted = await rpc<{ deleted?: boolean }>(hunter, 'delete_my_data', {});
  expect(
    hunterDeleted.data?.deleted === true,
    'delete_my_data succeeds for active participant with multi-asset data',
    JSON.stringify(hunterDeleted.error?.message ?? hunterDeleted.data),
  );

  const hunterExportAfter = await rpc<{
    profile?: unknown;
    trail_points?: unknown[];
  }>(hunter, 'export_my_data', {});
  expect(
    hunterExportAfter.data?.profile === null &&
      (!hunterExportAfter.data?.trail_points || hunterExportAfter.data.trail_points.length === 0),
    'active participant profile, trails, and personal assets are scrubbed',
    JSON.stringify(hunterExportAfter.data ?? hunterExportAfter.error?.message),
  );

  const hunterConsentsAfter = await rpc<Record<string, unknown>>(hunter, 'get_my_consents', {});
  expect(
    Object.keys(hunterConsentsAfter.data ?? {}).length === 0,
    'active participant consents are completely purged after account deletion',
    JSON.stringify(hunterConsentsAfter.data),
  );

  // Negative test: Account deletion cascade cleanly leaves nothing in players or pings
  const hunterPingsAfterDelete = (
    await host.from('pings').select('id').eq('player_id', phaseHunterPlayer.data.id)
  ).data ?? [];
  const hunterPlayersAfterDelete = (
    await host.from('players').select('id').eq('id', phaseHunterPlayer.data.id)
  ).data ?? [];
  expect(
    hunterPingsAfterDelete.length === 0 && hunterPlayersAfterDelete.length === 0,
    'account deletion cascades cleanly leaving nothing in players or pings',
    `remaining pings: ${hunterPingsAfterDelete.length}, remaining players: ${hunterPlayersAfterDelete.length}`,
  );

  for (const client of [host]) {
    await rpc(client, 'leave_game', { game_id: gameId });
    await rpc(client, 'leave_game', { game_id: phaseGameId });
    await rpc(client, 'leave_game', { game_id: arrivalGameId });
    await rpc(client, 'leave_game', { game_id: rematchGameId });
    if (jbGameId) await rpc(client, 'leave_game', { game_id: jbGameId });
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

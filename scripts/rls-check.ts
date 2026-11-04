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
    (ownResources.data ?? []).length === 1 &&
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
    (runnerTeamResources.data ?? []).length === 1 &&
      runnerTeamResources.data?.[0]?.team === 'runner',
    'a runner reads only the runner team_resources row',
    JSON.stringify(runnerTeamResources.data ?? runnerTeamResources.error?.message),
  );
  const hunterTeamResources = await hunter
    .from('team_resources')
    .select('team')
    .eq('game_id', phaseGameId);
  expect(
    (hunterTeamResources.data ?? []).length === 1 &&
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

  const unauthClient = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const hpRes = await unauthClient.rpc('health_ping');
  expect(
    hpRes.data?.ok === true && hpRes.data?.app === 'ghostrun',
    'health_ping keep-alive succeeds for anon',
    JSON.stringify(hpRes.data ?? hpRes.error),
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

  const postEndPings = (await hunter.from('pings').select('*').eq('game_id', phaseGameId)).data ?? [];
  expect(
    postEndPings.length > 0,
    'full ping history is readable by members after round ends',
    `got ${postEndPings.length} pings`,
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
    players: { id: string; secret_role?: string | null }[];
  }>(host, 'get_game_state', { game_id: phaseGameId });
  expect(
    Array.isArray(endedSnapshot.data?.players) &&
      endedSnapshot.data.players.every((p) => 'secret_role' in p),
    'post-end state reveals secret_role property for all players',
    JSON.stringify(endedSnapshot.data?.players),
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

    const outsiderPickup = await rpc(outsider, 'pickup_package', { p_game_id: rhGameId });
    expect(Boolean(outsiderPickup.error), 'outsider cannot call pickup_package', 'call unexpectedly succeeded');

    const runnerSecuring = await rpc(host, 'start_securing_package', { p_game_id: rhGameId });
    expect(Boolean(runnerSecuring.error), 'runner cannot call start_securing_package', 'call unexpectedly succeeded');

    for (const client of [host, rhRunner2, hunter]) {
      await rpc(client, 'leave_game', { game_id: rhGameId });
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

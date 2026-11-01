-- Milestone S1 fixes v2:
-- 1. Drop old 0-argument health_ping() overload to eliminate PostgREST function overload ambiguity
-- 2. Update advance_active_games to use created_at (started_at does not exist on games)
-- 3. Update start_game() to return head_start_at, live_at, AND ends_at

-- 1. Drop 0-arg health_ping overload
drop function if exists public.health_ping();

-- 2. Update advance_active_games (use created_at, not started_at)
create or replace function public.advance_active_games(limit_count integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  g_rec record;
  advanced_ids uuid[] := array[]::uuid[];
  v_lim integer := least(greatest(1, limit_count), 50);
begin
  for g_rec in
    select id from public.games
    where status in ('countdown', 'head_start', 'live')
    order by
      case
        when status = 'countdown' then 1
        when status = 'head_start' then 2
        when status = 'live' then 3
        else 4
      end,
      coalesce(next_ping_at, live_at, head_start_at, ends_at, created_at) asc
    limit v_lim
  loop
    begin
      perform public.advance_game(g_rec.id);
      advanced_ids := array_append(advanced_ids, g_rec.id);
    exception when others then
      -- Bounded failure: skip individual game errors
      null;
    end;
  end loop;

  return jsonb_build_object(
    'advanced_count', coalesce(array_length(advanced_ids, 1), 0),
    'advanced_ids', to_jsonb(advanced_ids),
    'advanced_at', now()
  );
end;
$$;

revoke all on function public.advance_active_games(integer) from public;
grant execute on function public.advance_active_games(integer) to anon, authenticated, service_role, postgres;

-- 3. Re-declare health_ping with default body parameter
create or replace function public.health_ping(body jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_configured_secret text;
  v_adv jsonb;
  v_last_cleanup timestamptz;
  v_retention_swept boolean := false;
begin
  -- Optional shared-secret validation
  select value into v_configured_secret from public.server_secrets where key = 'health_ping_secret';
  if v_configured_secret is not null and length(v_configured_secret) > 0 then
    if coalesce(body->>'secret', body->>'request_secret', '') <> v_configured_secret then
      return jsonb_build_object(
        'ok', false,
        'error', 'unauthorized',
        'server_time', now()
      );
    end if;
  end if;

  -- Advance up to 5 active games (bounded fallback)
  v_adv := public.advance_active_games(5);

  -- Rate-limited 30-day retention cleanup (at most once every 10 minutes)
  select value::timestamptz into v_last_cleanup from public.server_secrets where key = 'last_retention_sweep';
  if v_last_cleanup is null or now() - v_last_cleanup >= interval '10 minutes' then
    begin
      perform public.cleanup_old_games();
      insert into public.server_secrets (key, value)
      values ('last_retention_sweep', now()::text)
      on conflict (key) do update set value = excluded.value;
      v_retention_swept := true;
    exception when others then
      v_retention_swept := false;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'app', 'ghostrun',
    'server_time', now(),
    'games_advanced', coalesce((v_adv->>'advanced_count')::int, 0),
    'retention_swept', v_retention_swept
  );
end;
$$;

revoke all on function public.health_ping(jsonb) from public;
grant execute on function public.health_ping(jsonb) to anon, authenticated, service_role;

-- 4. Update start_game RPC
create or replace function public.start_game(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  active_runners integer;
  active_hunters integer;
  unassigned integer;
  missing_consent integer;
  countdown_ends timestamptz;
  live_starts timestamptz;
  round_ends timestamptz;
  hunter_heat_charges integer := 0;
  chosen_agent_id uuid;
  agent_charges integer;
  agent_cooldown integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g
    where g.id = start_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.host_id <> caller_id then
    raise exception 'Only the host can start the round.';
  end if;
  if current_game.status not in ('lobby', 'target_selection') then
    raise exception 'This game has already started.';
  end if;
  if current_game.mode_id = 'classic_chase' and current_game.status <> 'target_selection' then
    raise exception 'Choose the secret target before starting the round.';
  end if;

  perform public.assert_mode_config(
    current_game.mode_id, current_game.roles, current_game.modifiers
  );

  select count(*) filter (where p.team = 'runner'),
         count(*) filter (where p.team = 'hunter'),
         count(*) filter (where p.team = 'unassigned')
    into active_runners, active_hunters, unassigned
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active';

  if current_game.mode_id not in ('haunted_map', 'ghost_duel') then
    if active_runners = 0 or active_hunters = 0 then
      raise exception 'Assign at least one runner and one hunter before starting.';
    end if;
  else
    if active_runners = 0 and active_hunters = 0 then
      raise exception 'Assign at least one player before starting.';
    end if;
  end if;

  if unassigned > 0 then
    raise exception 'Every player must choose a team before the round starts.';
  end if;
  if current_game.mode_id = 'classic_chase'
     and not exists (select 1 from public.targets t where t.game_id = start_game.game_id) then
    raise exception 'Runners must save the secret target first.';
  end if;

  select count(*) into missing_consent
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active' and p.share_trail is null;
  if missing_consent > 0 then
    raise exception 'Every player must choose whether to share their route before the round starts.';
  end if;

  if 'double_agent' = any(current_game.roles) then
    if active_hunters >= 2 then
      select p.id into chosen_agent_id
      from public.players p
      where p.game_id = current_game.id and p.team = 'hunter' and p.status = 'active'
      order by random()
      limit 1;

      agent_charges := coalesce((current_game.mode_params->'double_agent'->>'scramble_charges')::int, 1);
      agent_cooldown := coalesce((current_game.mode_params->'double_agent'->>'scramble_cooldown_s')::int, 120);

      update public.players
      set secret_role = 'agent',
          status_detail = jsonb_build_object(
            'scramble_available', true,
            'scramble_charges', agent_charges,
            'scramble_cooldown_s', agent_cooldown,
            'whisper_available', true
          )
      where id = chosen_agent_id;

      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id,
        'agent_assigned',
        chosen_agent_id,
        'player',
        jsonb_build_object('message', 'You are secretly working as the Double Agent.')
      );
    else
      current_game.roles := array_remove(current_game.roles, 'double_agent');
      update public.games set roles = current_game.roles where id = current_game.id;
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'role_disabled',
        'all',
        jsonb_build_object(
          'role', 'double_agent',
          'reason', 'Requires at least 2 active hunters to maintain mystery.'
        )
      );
    end if;
  end if;

  countdown_ends := clock_timestamp() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);
  round_ends := live_starts + make_interval(secs => current_game.duration_s);

  update public.games
    set status = 'countdown',
        head_start_at = countdown_ends,
        live_at = live_starts,
        ends_at = round_ends,
        next_ping_at = live_starts + make_interval(secs => current_game.ping_interval_s),
        ping_seq = 0
    where id = current_game.id;

  if current_game.mode_id in ('haunted_map', 'ghost_duel') then
    perform public.spawn_ghost_npcs(current_game.id);
  end if;

  if 'dead_drops' = any(current_game.modifiers) then
    perform public.spawn_drops(start_game.game_id, null);
  end if;

  if 'hot_cold' = any(current_game.modifiers) or current_game.mode_id = 'hot_cold' then
    hunter_heat_charges := coalesce((current_game.mode_params->'hot_cold'->>'heat_charges')::integer, 6);
  end if;

  -- Ensure player_resources rows exist for all active players
  insert into public.player_resources (player_id, game_id)
  select p.id, p.game_id
  from public.players p
  where p.game_id = current_game.id and p.status = 'active'
  on conflict (player_id) do nothing;

  -- Ensure team_resources rows exist for runner and hunter
  insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
  values
    (current_game.id, 'runner', 0, now()),
    (current_game.id, 'hunter', hunter_heat_charges, now())
  on conflict on constraint team_resources_pkey do update
    set heat_charges = excluded.heat_charges,
        heat_updated_at = excluded.heat_updated_at;

  insert into public.events (game_id, type, payload)
  values (
    start_game.game_id,
    'game_started',
    jsonb_build_object(
      'mode', current_game.mode,
      'mode_id', current_game.mode_id,
      'modifiers', to_jsonb(current_game.modifiers),
      'roles', to_jsonb(current_game.roles),
      'head_start_at', countdown_ends,
      'live_at', live_starts,
      'ends_at', round_ends
    )
  );

  return jsonb_build_object(
    'status', 'countdown',
    'head_start_at', countdown_ends,
    'live_at', live_starts,
    'ends_at', round_ends
  );
end;
$$;

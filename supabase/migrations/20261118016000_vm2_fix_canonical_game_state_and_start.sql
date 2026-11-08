-- Migration: 20261118016000_vm2_fix_canonical_game_state_and_start.sql
-- VM2 Hotfix: Fix get_game_state target projection and start_game countdown interval
-- Fixes runtime errors encountered during remote test suite verification:
-- 1. record "v_target_row" has no field "id" (targets table PK is game_id, radius is on games)
-- 2. record "current_game" has no field "countdown_s" (games table has no countdown_s column; interval is 10s)

-- 1. Canonical start_game (fix countdown interval) -------------------------------
create or replace function public.start_game(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  active_runners integer;
  active_hunters integer;
  field_runners integer;
  field_hunters integer;
  unassigned integer;
  active_total integer;
  missing_consent integer;
  countdown_ends timestamptz;
  live_starts timestamptz;
  round_ends timestamptz;
  safe_zone_count integer;
  chosen_carrier_id uuid;
  chosen_vip_id uuid;
  chosen_agent_id uuid;
  agent_charges integer;
  agent_cooldown integer;
  v_pulse_int integer;
  v_gm_interval integer;
  v_gm_max integer;
  v_new_mode_params jsonb;
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

  -- For Jailbreak mode, jail must be placed before start
  if current_game.mode_id = 'jailbreak' then
    if not exists (select 1 from public.entities e where e.game_id = current_game.id and e.kind = 'jail') then
      raise exception 'Place the jail before starting the round.';
    end if;
  end if;

  -- For Relay Heist mode, extraction point must be placed before start
  if current_game.mode_id = 'relay_heist' then
    if not exists (select 1 from public.entities e where e.game_id = current_game.id and e.kind in ('extraction', 'extraction_point')) then
      raise exception 'Place the extraction point before starting the round.';
    end if;
  end if;

  -- For Ghost Duel mode, enforce correct team assignment for solo player based on variant
  if current_game.mode_id = 'ghost_duel' then
    update public.players
    set team = case when coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial') = 'mirror_chase' then 'hunter'::public.team_type else 'runner'::public.team_type end
    where players.game_id = current_game.id and players.status = 'active';
  end if;

  select count(*) filter (where p.team = 'runner'),
         count(*) filter (where p.team = 'hunter'),
         count(*) filter (where p.team = 'runner' and not p.is_remote),
         count(*) filter (where p.team = 'hunter' and not p.is_remote),
         count(*) filter (where p.team = 'unassigned'),
         count(*)
    into active_runners, active_hunters, field_runners, field_hunters, unassigned, active_total
    from public.players p
    where p.game_id = current_game.id and p.status = 'active';

  if current_game.mode_id = 'assassin_ring' then
    if active_total < 3 then
      raise exception 'Assassin Ring requires at least 3 players to form a ring.';
    end if;

    update public.players p
      set team = 'solo'
      where p.game_id = current_game.id and p.status = 'active';

    select count(*) into safe_zone_count
      from public.entities e
      where e.game_id = current_game.id and e.kind = 'safe_zone';

    if safe_zone_count < 2 then
      insert into public.entities (game_id, kind, geog, state, visible_to)
      values
        (current_game.id, 'safe_zone',
         extensions.st_project(current_game.area_center, current_game.area_radius_m * 0.45, radians(0)),
         jsonb_build_object('zone_index', 1, 'radius_m', 20), 'all'),
        (current_game.id, 'safe_zone',
         extensions.st_project(current_game.area_center, current_game.area_radius_m * 0.45, radians(180)),
         jsonb_build_object('zone_index', 2, 'radius_m', 20), 'all');
    end if;

    with shuffled as (
      select p.id,
             row_number() over (order by random()) as rn,
             count(*) over () as total
      from public.players p
      where p.game_id = current_game.id and p.status = 'active'
    ),
    ring as (
      select s1.id as hunter_id,
             s2.id as prey_id
      from shuffled s1
      join shuffled s2 on s2.rn = (case when s1.rn = s1.total then 1 else s1.rn + 1 end)
    )
    insert into public.ring_assignments (game_id, hunter_player_id, prey_player_id, status)
    select current_game.id, hunter_id, prey_id, 'active'
    from ring;

  elsif current_game.mode_id not in ('haunted_map', 'ghost_duel') then
    if active_runners = 0 or active_hunters = 0 then
      raise exception 'Assign at least one runner and one hunter before starting.';
    end if;
    if unassigned > 0 then
      raise exception 'Every player must choose a team before the round starts.';
    end if;
    -- Operator Role: require at least 1 field player per squad
    if 'operator' = any(current_game.roles) then
      if field_runners = 0 then
        raise exception 'Runners require at least one active field runner.';
      end if;
      if field_hunters = 0 then
        raise exception 'Hunters require at least one active field hunter.';
      end if;
    end if;
  else
    if active_runners = 0 and active_hunters = 0 then
      raise exception 'Assign at least one player before starting.';
    end if;
  end if;

  if current_game.mode_id = 'classic_chase'
     and not exists (select 1 from public.targets t where t.game_id = current_game.id) then
    raise exception 'Runners must save the secret target first.';
  end if;

  select count(*) into missing_consent
    from public.players p
    where p.game_id = current_game.id and p.status = 'active' and p.share_trail is null;
  if missing_consent > 0 then
    raise exception 'Every player must choose whether to share their route before the round starts.';
  end if;

  -- VIP Escort: exactly 1 runner is VIP, other runners become bodyguard
  if 'vip' = any(current_game.roles) then
    select p.id into chosen_vip_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and not p.is_remote
    order by random()
    limit 1;

    if chosen_vip_id is not null then
      update public.players
      set secret_role = 'vip'
      where id = chosen_vip_id;

      update public.players
      set secret_role = 'bodyguard'
      where players.game_id = current_game.id and players.team = 'runner' and players.status = 'active' and players.id <> chosen_vip_id and not players.is_remote;
    else
      raise exception '%', jsonb_build_object(
        'error', jsonb_build_object(
          'role', 'vip',
          'reason', 'VIP Escort requires at least 2 active field runners (1 VIP + 1 bodyguard).'
        )
      );
    end if;
  end if;

  -- Double Agent assignment (exclude remote operators)
  if 'double_agent' = any(current_game.roles) and current_game.mode_id <> 'assassin_ring' then
    if field_hunters >= 2 then
      select p.id into chosen_agent_id
      from public.players p
      where p.game_id = current_game.id and p.team = 'hunter' and p.status = 'active' and not p.is_remote
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
        'hunter',
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
          'reason', 'Double Agent requires at least 2 active field hunters.'
        )
      );
    end if;
  end if;

  -- Territory Pulse setup: spawn 7 sector zones and initialize mode parameters
  if current_game.mode_id = 'territory_pulse' then
    perform public.spawn_territory_zones(current_game.id);
    v_pulse_int := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_interval_s')::int, 90);
    v_new_mode_params := coalesce(current_game.mode_params, '{}'::jsonb);
    v_new_mode_params := jsonb_set(
      v_new_mode_params,
      '{territory_pulse}',
      jsonb_build_object(
        'pulse_interval_s', v_pulse_int,
        'next_pulse_at', clock_timestamp() + make_interval(secs => 10 + current_game.head_start_s + v_pulse_int),
        'scores', jsonb_build_object('runner', 0, 'hunter', 0),
        'dominance_pct', 70,
        'consecutive_dominance', jsonb_build_object('runner', 0, 'hunter', 0)
      )
    );
    update public.games set mode_params = v_new_mode_params where id = current_game.id;
  end if;

  -- AI Game Master setup
  if 'ai_gm' = any(current_game.modifiers) then
    v_gm_interval := coalesce((current_game.mode_params->'ai_gm'->>'event_interval_s')::int, 180);
    v_gm_max := coalesce((current_game.mode_params->'ai_gm'->>'max_events')::int, 12);
    v_new_mode_params := coalesce(current_game.mode_params, '{}'::jsonb);
    v_new_mode_params := jsonb_set(
      v_new_mode_params,
      '{ai_gm}',
      jsonb_build_object(
        'event_interval_s', v_gm_interval,
        'max_events', v_gm_max,
        'event_count', 0,
        'next_event_at', clock_timestamp() + make_interval(secs => 10 + current_game.head_start_s + v_gm_interval),
        'shrink_scale', 1.0,
        'fog_ends_at', null,
        'last_event_type', null,
        'last_narration', null
      )
    );
    update public.games set mode_params = v_new_mode_params where id = current_game.id;
  end if;

  -- Spawn NPC ghosts if in haunted_map or ghost_duel
  if current_game.mode_id in ('haunted_map', 'ghost_duel') then
    perform public.spawn_ghost_npcs(current_game.id);
  end if;

  -- Spawn drops if dead_drops modifier is active
  if 'dead_drops' = any(current_game.modifiers) then
    perform public.spawn_drops(current_game.id);
  end if;

  -- For Relay Heist mode, assign initial carrier
  if current_game.mode_id = 'relay_heist' then
    select p.id into chosen_carrier_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and not p.is_remote
    order by random()
    limit 1;

    if chosen_carrier_id is not null then
      update public.entities
      set state = jsonb_build_object('carrier_player_id', chosen_carrier_id, 'status', 'carried', 'next_carrier_ping_at', clock_timestamp() + make_interval(secs => greatest(10, current_game.ping_interval_s * 2 / 3)))
      where entities.game_id = current_game.id and entities.kind = 'package';

      update public.players
      set status_detail = jsonb_build_object('is_carrier', true)
      where id = chosen_carrier_id;

      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id,
        'carrier_assigned',
        chosen_carrier_id,
        'runner',
        jsonb_build_object('message', 'You are carrying the package! Reach the extraction point.')
      );
    end if;
  end if;

  countdown_ends := clock_timestamp() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);
  round_ends := live_starts + make_interval(secs => current_game.duration_s);

  update public.games g
    set status = 'countdown',
        started_at = clock_timestamp(),
        head_start_at = countdown_ends,
        live_at = live_starts,
        ends_at = round_ends,
        next_ping_at = live_starts + make_interval(secs => current_game.ping_interval_s),
        ping_seq = 0
    where g.id = current_game.id;

  update public.players p
    set status = 'active'
    where p.game_id = current_game.id and p.status in ('lobby', 'joined');

  insert into public.events (game_id, type, payload)
    values (current_game.id, 'game_started', jsonb_build_object('status', 'countdown'));

  return jsonb_build_object('status', 'countdown', 'head_start_at', countdown_ends, 'live_at', live_starts);
end;
$$;

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;

-- 2. Canonical get_game_state (fix target projection) ---------------------------
create or replace function public.get_game_state(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  mine public.players%rowtype;
  v_ghost_duel jsonb;
  v_territory_pulse jsonb;
  v_ai_gm jsonb;
  v_fog_until timestamptz;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(game_id) then raise exception 'You are not a member of this game.'; end if;

  perform public.advance_game(get_game_state.game_id);

  select * into current_game from public.games g where g.id = get_game_state.game_id;
  select * into mine from public.players p where p.game_id = get_game_state.game_id and p.user_id = caller_id;

  v_ghost_duel := case
    when current_game.mode_id = 'ghost_duel' then jsonb_build_object(
      'variant', coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial'),
      'target', (
        select jsonb_build_object(
          'id', e.id,
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 20)
        )
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'target'
        limit 1
      ),
      'ghost', (
        select jsonb_build_object(
          'id', e.id,
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'duration_s', coalesce((e.state->>'duration_s')::int, 240),
          'elapsed_s', greatest(0, extract(epoch from (clock_timestamp() - current_game.live_at))::int),
          'total_length_m', coalesce((e.state->>'total_length_m')::real, 0),
          'path_wkt', e.state->>'path_wkt'
        )
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'ghost'
        limit 1
      )
    )
    else null
  end;

  v_territory_pulse := case
    when current_game.mode_id = 'territory_pulse' then jsonb_build_object(
      'pulse_seq', coalesce((current_game.mode_params->'territory_pulse'->>'pulse_seq')::int, 0),
      'pulse_interval_s', coalesce((current_game.mode_params->'territory_pulse'->>'pulse_interval_s')::int, 90),
      'next_pulse_at', current_game.mode_params->'territory_pulse'->>'next_pulse_at',
      'last_pulse_at', current_game.mode_params->'territory_pulse'->>'last_pulse_at',
      'scores', coalesce(current_game.mode_params->'territory_pulse'->'scores', jsonb_build_object('runner', 0, 'hunter', 0)),
      'dominance_pct', coalesce((current_game.mode_params->'territory_pulse'->>'dominance_pct')::int, 70),
      'zones', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'name', coalesce(e.state->>'name', 'Sector'),
            'zone_index', coalesce((e.state->>'zone_index')::int, 0),
            'latitude', extensions.st_y(e.geog::extensions.geometry),
            'longitude', extensions.st_x(e.geog::extensions.geometry),
            'radius_m', coalesce((e.state->>'radius_m')::int, 60),
            'controller', e.state->>'controller',
            'contender', e.state->>'contender',
            'contender_pulses', coalesce((e.state->>'contender_pulses')::int, 0)
          ) order by (e.state->>'zone_index')::int asc
        ), '[]'::jsonb)
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'zone'
      )
    )
    else null
  end;

  v_fog_until := (current_game.mode_params->'ai_gm'->>'fog_active_until')::timestamptz;

  v_ai_gm := case
    when 'ai_gm' = any(current_game.modifiers) then jsonb_build_object(
      'is_active', true,
      'event_count', coalesce((current_game.mode_params->'ai_gm'->>'event_count')::int, 0),
      'max_events', coalesce((current_game.mode_params->'ai_gm'->>'max_events')::int, 12),
      'event_interval_s', coalesce((current_game.mode_params->'ai_gm'->>'event_interval_s')::int, 180),
      'last_event_type', current_game.mode_params->'ai_gm'->>'last_event_type',
      'last_title', current_game.mode_params->'ai_gm'->>'last_title',
      'last_narration', current_game.mode_params->'ai_gm'->>'last_narration',
      'last_event_at', current_game.mode_params->'ai_gm'->>'last_event_at',
      'next_event_at', current_game.mode_params->'ai_gm'->>'next_event_at',
      'fog_active', (v_fog_until is not null and v_fog_until > clock_timestamp()),
      'fog_ends_at', current_game.mode_params->'ai_gm'->>'fog_active_until'
    )
    else null
  end;

  return jsonb_build_object(
    'server_time', clock_timestamp(),
    'ghost_duel', v_ghost_duel,
    'territory_pulse', v_territory_pulse,
    'ai_gm', v_ai_gm,
    'safety', jsonb_build_object(
      'is_paused', (current_game.status = 'paused'),
      'paused_at', current_game.mode_params->'safety'->>'paused_at',
      'pause_reason', current_game.mode_params->'safety'->>'pause_reason',
      'pause_timeout_at', current_game.mode_params->'safety'->>'pause_timeout_at',
      'pre_pause_status', current_game.mode_params->'safety'->>'pre_pause_status',
      'vote_count', coalesce((current_game.mode_params->'safety'->>'vote_count')::int, 0),
      'votes_required', coalesce((current_game.mode_params->'safety'->>'votes_required')::int, 0)
    ),
    'game', jsonb_build_object(
      'id', current_game.id,
      'code', current_game.code,
      'host_id', current_game.host_id,
      'mode', current_game.mode,
      'mode_id', current_game.mode_id,
      'status', current_game.status,
      'area', jsonb_build_object(
        'latitude', extensions.st_y(current_game.area_center::extensions.geometry),
        'longitude', extensions.st_x(current_game.area_center::extensions.geometry),
        'radius_m', public.effective_radius_m(current_game.id),
        'base_radius_m', current_game.area_radius_m,
        'zone_stage', current_game.zone_stage,
        'zone_stage_count', array_length(public.zone_stage_values(current_game.id), 1),
        'shrinking', ('shrinking_zone' = any(current_game.modifiers) or (current_game.mode_params->'ai_gm'->>'shrink_scale') is not null)
      ),
      'ai_gm', v_ai_gm,
      'target_set', exists (select 1 from public.targets t where t.game_id = current_game.id),
      'ping_visible_s', current_game.ping_visible_s,
      'ghost_mode', current_game.ghost_mode,
      'roles', current_game.roles,
      'modifiers', current_game.modifiers,
      'duration_s', current_game.duration_s,
      'head_start_s', current_game.head_start_s,
      'ping_interval_s', current_game.ping_interval_s,
      'tag_radius_m', current_game.tag_radius_m,
      'target_radius_m', current_game.target_radius_m,
      'boundary_grace_s', current_game.boundary_grace_s,
      'boundary_penalty', current_game.boundary_penalty,
      'created_at', current_game.created_at,
      'head_start_at', current_game.head_start_at,
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'ended_at', current_game.ended_at,
      'winner', current_game.winner,
      'end_reason', current_game.end_reason,
      'ping_seq', current_game.ping_seq,
      'zone_announced', current_game.zone_announced,
      'rematch_game_id', current_game.rematch_game_id,
      'mode_params', current_game.mode_params,
      'jail', (
        select jsonb_build_object(
          'id', e.id,
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 15)
        )
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'jail'
        limit 1
      ),
      'jail_rules', case
        when current_game.mode_id = 'jailbreak' then jsonb_build_object(
          'auto_release_s', coalesce((current_game.mode_params->'jailbreak'->>'auto_release_s')::int, 300),
          'release_hold_s', coalesce((current_game.mode_params->'jailbreak'->>'release_hold_s')::int, 10),
          'release_radius_m', coalesce((current_game.mode_params->'jailbreak'->>'release_radius_m')::int, 10)
        )
        else null
      end,
      'relay_heist', case
        when current_game.mode_id = 'relay_heist' then jsonb_build_object(
          'extraction', (
            select jsonb_build_object(
              'id', e.id,
              'latitude', extensions.st_y(e.geog::extensions.geometry),
              'longitude', extensions.st_x(e.geog::extensions.geometry),
              'radius_m', coalesce((e.state->>'radius_m')::int, 25)
            )
            from public.entities e
            where e.game_id = current_game.id and e.kind in ('extraction', 'extraction_point')
            limit 1
          ),
          'package', (
            select case
              when (e.state->>'status') = 'dropped' then
                jsonb_build_object(
                  'status', 'dropped',
                  'longitude', extensions.st_x(e.geog::extensions.geometry),
                  'latitude', extensions.st_y(e.geog::extensions.geometry),
                  'dropped_at', e.state->>'dropped_at',
                  'securing_hunter_id', e.state->>'securing_hunter_id',
                  'securing_started_at', e.state->>'securing_started_at'
                )
              when (e.state->>'status') = 'carried' and (e.state->>'handoff_pending_to') is not null then
                jsonb_build_object(
                  'status', 'carried',
                  'longitude', extensions.st_x(e.geog::extensions.geometry),
                  'latitude', extensions.st_y(e.geog::extensions.geometry),
                  'handoff_pending_to', e.state->>'handoff_pending_to',
                  'handoff_expires_at', e.state->>'handoff_expires_at'
                )
              else
                jsonb_build_object(
                  'status', 'carried'
                )
            end
            from public.entities e
            where e.game_id = current_game.id and e.kind = 'package'
            limit 1
          ),
          'is_carrier', exists (
            select 1 from public.entities e
            where e.game_id = current_game.id and e.kind = 'package'
              and (e.state->>'carrier_player_id') = mine.id::text
              and (e.state->>'status') = 'carried'
          ),
          'handoff_pending_from', (
            select e.state->>'carrier_player_id'
            from public.entities e
            where e.game_id = current_game.id and e.kind = 'package'
              and (e.state->>'handoff_pending_to') = mine.id::text
              and (e.state->>'handoff_expires_at')::timestamptz > clock_timestamp()
            limit 1
          )
        )
        else null
      end,
      'vip_escort', case
        when 'vip' = any(current_game.roles) then jsonb_build_object(
          'is_active', true,
          'vip_player_id', case
            when mine.team = 'runner' or current_game.status in ('ended', 'cancelled') then (
              select p.id from public.players p
              where p.game_id = current_game.id and p.team = 'runner' and p.secret_role = 'vip' and p.status = 'active'
              limit 1
            )
            else null
          end
        )
        else null
      end
    ),
    'my_player_id', mine.id,
    'my_team', mine.team,
    'my_position', (
      select jsonb_build_object(
        'player_id', pp.player_id,
        'longitude', extensions.st_x(pp.geog::extensions.geometry),
        'latitude', extensions.st_y(pp.geog::extensions.geometry),
        'accuracy_m', pp.accuracy_m,
        'heading', pp.heading,
        'speed_mps', pp.speed_mps,
        'recorded_at', pp.recorded_at,
        'in_bounds', extensions.st_dwithin(pp.geog, current_game.area_center, public.effective_radius_m(current_game.id)),
        'noise', pp.noise
      )
      from public.player_positions pp
      where pp.player_id = mine.id
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'user_id', p.user_id,
        'display_name', pr.display_name,
        'color', pr.color,
        'team', p.team,
        'status', p.status,
        'is_ready', p.is_ready,
        'is_remote', p.is_remote,
        'secret_role', case
          when current_game.status in ('ended', 'cancelled') or p.id = mine.id then p.secret_role
          when 'vip' = any(current_game.roles) and mine.team = 'runner' and p.team = 'runner' then p.secret_role
          else null
        end
      ) order by p.joined_at asc)
      from public.players p
      join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id
        and p.status <> 'left'
    ), '[]'::jsonb),
    'target', case
      when (mine.team = 'runner' or current_game.status in ('ended', 'cancelled')) then (
        select jsonb_build_object(
          'latitude', extensions.st_y(t.geog::extensions.geometry),
          'longitude', extensions.st_x(t.geog::extensions.geometry),
          'radius_m', coalesce(current_game.target_radius_m, 25)
        )
        from public.targets t
        where t.game_id = current_game.id
        limit 1
      )
      else null
    end,
    'operator', jsonb_build_object(
      'is_operator', coalesce(mine.is_remote, false),
      'team', mine.team,
      'scan_cooldown_s', coalesce((
        select greatest(0, ceil(extract(epoch from (
          (pr.cooldowns->>'operator_scan')::timestamptz + interval '90 seconds' - clock_timestamp()
        ))))::int
        from public.player_resources pr
        where pr.player_id = mine.id
      ), 0)
    ),
    'scan_envelope', (
      select jsonb_build_object(
        'id', e.id,
        'latitude', extensions.st_y(e.geog::extensions.geometry),
        'longitude', extensions.st_x(e.geog::extensions.geometry),
        'radius_m', coalesce((e.state->>'radius_m')::int, 150),
        'expires_at', e.state->>'expires_at'
      )
      from public.entities e
      where e.game_id = current_game.id
        and e.kind = 'scan_envelope'
        and (e.visible_to = 'all' or e.visible_to = mine.team::text or e.team = mine.team::text)
        and (e.state->>'expires_at')::timestamptz > clock_timestamp()
      order by e.updated_at desc
      limit 1
    ),
    'markers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'label', e.state->>'label',
        'latitude', extensions.st_y(e.geog::extensions.geometry),
        'longitude', extensions.st_x(e.geog::extensions.geometry),
        'placed_at', e.updated_at
      ) order by e.updated_at asc)
      from public.entities e
      where e.game_id = current_game.id
        and e.kind = 'marker'
        and (e.visible_to = 'all' or e.visible_to = mine.team::text or e.team = mine.team::text)
    ), '[]'::jsonb),
    'teammates', case
      when mine.team = 'solo' then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_id', p.id,
          'user_id', p.user_id,
          'display_name', pr.display_name,
          'color', pr.color,
          'status', p.status,
          'is_remote', p.is_remote,
          'longitude', extensions.st_x(pp.geog::extensions.geometry),
          'latitude', extensions.st_y(pp.geog::extensions.geometry),
          'accuracy_m', pp.accuracy_m,
          'heading', pp.heading,
          'speed_mps', pp.speed_mps,
          'recorded_at', pp.recorded_at
        ))
        from public.players p
        join public.profiles pr on pr.id = p.user_id
        left join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = mine.team
          and p.id <> mine.id
          and p.status <> 'left'
      ), '[]'::jsonb)
    end,
    'pings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pi.id,
        'seq', pi.seq,
        'player_id', pi.player_id,
        'longitude', extensions.st_x(pi.geog::extensions.geometry),
        'latitude', extensions.st_y(pi.geog::extensions.geometry),
        'accuracy_m', pi.accuracy_m,
        'position_age_s', pi.position_age_s,
        'reason', pi.reason,
        'released_at', pi.released_at
      ) order by pi.seq desc)
      from public.pings pi
      where pi.game_id = current_game.id
        and (
          current_game.status in ('ended', 'cancelled')
          or pi.released_at > clock_timestamp() - make_interval(secs => current_game.ping_visible_s)
        )
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ev.id,
        'type', ev.type,
        'payload', ev.payload,
        'created_at', ev.created_at
      ) order by ev.id desc)
      from public.events ev
      where ev.game_id = current_game.id
        and (
          ev.audience = 'all'
          or (ev.audience = 'team' and ev.target_player in (
            select p2.id from public.players p2 where p2.game_id = current_game.id and p2.team = mine.team
          ))
          or (ev.audience in ('runner', 'hunter') and ev.audience = mine.team::text)
          or (ev.target_player = mine.id)
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_game_state(uuid) from public, anon;
grant execute on function public.get_game_state(uuid) to authenticated;

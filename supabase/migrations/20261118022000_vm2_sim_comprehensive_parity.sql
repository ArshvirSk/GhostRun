-- Migration: 20261118022000_vm2_sim_comprehensive_parity.sql
-- Comprehensive parity fixes for sim & rls test suites:
-- 1. start_game: remove premature unready block, preserve target_selection & hot_cold tripling
-- 2. advance_game: fix p.display_name / promoted_bodyguard.display_name column references
-- 3. clear_marker: fix text = team_type enum operator mismatch
-- 4. role_swap RPCs & tag_ghost: advance game clock before checking status = 'live'
-- 5. attempt_tag: exclude runners incapacitated by Territory Pulse
-- 6. get_game_state: expose assassin_ring, relay_heist, and safety details (curfew_at, vehicle_warning, paused_by_name)

-- 1. start_game ----------------------------------------------------------------

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
  safe_zone_count integer;
  missing_consent integer;
  countdown_ends timestamptz;
  live_starts timestamptz;
  round_ends timestamptz;
  chosen_vip_id uuid;
  chosen_agent_id uuid;
  agent_charges integer;
  agent_cooldown integer;
  chosen_carrier_id uuid;
  v_pulse_int integer;
  v_new_mode_params jsonb;
  v_gm_interval integer;
  v_gm_max integer;
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  select * into current_game
    from public.games g
    where g.id = start_game.game_id
    for update;

  if not found then
    raise exception 'Game not found.';
  end if;

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

  -- For Relay Heist mode, assign initial carrier and ensure package entity exists
  if current_game.mode_id = 'relay_heist' then
    select p.id into chosen_carrier_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and not p.is_remote
    order by random()
    limit 1;

    if chosen_carrier_id is not null then
      delete from public.entities e where e.game_id = current_game.id and e.kind = 'package';

      insert into public.entities (game_id, kind, team, geog, state, visible_to)
      values (
        current_game.id,
        'package',
        'runner',
        extensions.st_project(current_game.area_center, current_game.area_radius_m * 0.2, radians(45)),
        jsonb_build_object(
          'carrier_player_id', chosen_carrier_id,
          'handoff_pending_to', null,
          'handoff_expires_at', null,
          'cooldown_until', null,
          'next_carrier_ping_at', clock_timestamp() + make_interval(secs => greatest(10, current_game.ping_interval_s * 2 / 3))
        ),
        'runner'
      );

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

  -- If Hot & Cold modifier/mode is active, triple ping interval (capped at 900)
  if 'hot_cold' = any(current_game.modifiers) or current_game.mode_id = 'hot_cold' then
    current_game.ping_interval_s := least(900, current_game.ping_interval_s * 3);
  end if;

  countdown_ends := clock_timestamp() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);
  round_ends := live_starts + make_interval(secs => current_game.duration_s);

  update public.games g
    set status = 'countdown',
        head_start_at = countdown_ends,
        live_at = live_starts,
        ends_at = round_ends,
        ping_interval_s = current_game.ping_interval_s,
        next_ping_at = live_starts + make_interval(secs => current_game.ping_interval_s),
        ping_seq = 0
    where g.id = current_game.id;

  insert into public.events (game_id, type, payload)
    values (current_game.id, 'game_started', jsonb_build_object('status', 'countdown'));

  return jsonb_build_object(
    'status', 'countdown',
    'head_start_at', countdown_ends,
    'live_at', live_starts,
    'ends_at', round_ends,
    'next_ping_at', live_starts + make_interval(secs => current_game.ping_interval_s)
  );
end;
$$;

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;

-- 2. clear_marker fix text = team_type cast -----------------------------------

create or replace function public.clear_marker(
  p_game_id uuid,
  p_marker_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players
  where game_id = p_game_id and user_id = caller_id and status = 'active';
  if not found then raise exception 'You are not an active player in this game.'; end if;
  if not me.is_remote then
    raise exception 'Only remote Operators can clear tactical markers.';
  end if;

  delete from public.entities
  where id = p_marker_id
    and game_id = p_game_id
    and kind = 'marker'
    and team = me.team::text;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'marker_removed',
    me.team::text,
    jsonb_build_object('marker_id', p_marker_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.clear_marker(uuid, uuid) from public, anon;
grant execute on function public.clear_marker(uuid, uuid) to authenticated;

-- 3. advance clock in role swap RPCs & tag_ghost --------------------------------

create or replace function public.request_role_swap(
  p_game_id uuid,
  p_target_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  target_player public.players%rowtype;
  my_pos public.player_positions%rowtype;
  target_pos public.player_positions%rowtype;
  dist_m double precision;
  cooldown_until timestamptz;
  frozen_until timestamptz;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  perform public.advance_game(p_game_id);

  select * into current_game from public.games where id = p_game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Role swaps can only happen while the round is live.';
  end if;
  if not ('vip' = any(current_game.roles)) then
    raise exception 'VIP Escort role is not enabled in this game.';
  end if;

  select * into me from public.players
  where game_id = p_game_id and user_id = caller_id and status = 'active'
  for update;
  if not found then raise exception 'You are not an active player in this game.'; end if;
  if me.team <> 'runner' then raise exception 'Only runners can participate in role swaps.'; end if;
  if me.secret_role not in ('vip', 'bodyguard') then
    raise exception 'Only VIP or Bodyguards can initiate role swap.';
  end if;

  frozen_until := (me.status_detail->>'frozen_until')::timestamptz;
  if frozen_until is not null and clock_timestamp() < frozen_until then
    raise exception 'You cannot swap roles while frozen.';
  end if;

  cooldown_until := (me.status_detail->>'swap_cooldown_until')::timestamptz;
  if cooldown_until is not null and clock_timestamp() < cooldown_until then
    raise exception 'Role swap is on cooldown.';
  end if;

  select * into target_player from public.players
  where id = p_target_player_id and game_id = p_game_id and status = 'active'
  for update;
  if not found then raise exception 'Target player not found or not active.'; end if;
  if target_player.team <> 'runner' or target_player.id = me.id then
    raise exception 'Target must be another runner.';
  end if;
  if target_player.secret_role not in ('vip', 'bodyguard') or target_player.secret_role = me.secret_role then
    raise exception 'Target must hold the opposite VIP/Bodyguard role.';
  end if;

  frozen_until := (target_player.status_detail->>'frozen_until')::timestamptz;
  if frozen_until is not null and clock_timestamp() < frozen_until then
    raise exception 'Target runner is currently frozen.';
  end if;

  select * into my_pos from public.player_positions where player_id = me.id;
  select * into target_pos from public.player_positions where player_id = target_player.id;
  if my_pos.geog is null or target_pos.geog is null then
    raise exception 'Both runners must have fresh GPS fixes.';
  end if;

  dist_m := extensions.st_distance(my_pos.geog, target_pos.geog);
  if dist_m > 5.0 then
    raise exception 'Runners must be within 5m to swap roles (current distance: %m).', round(dist_m::numeric, 1);
  end if;

  update public.players
  set status_detail = jsonb_set(
    coalesce(status_detail, '{}'::jsonb),
    '{pending_swap_with}',
    to_jsonb(target_player.id::text)
  )
  where id = me.id;

  insert into public.events (game_id, type, audience, target_player, payload)
  values (
    p_game_id, 'role_swap_requested', 'runner', target_player.id,
    jsonb_build_object(
      'requester_id', me.id,
      'requester_role', me.secret_role,
      'target_id', target_player.id,
      'distance_m', round(dist_m::numeric, 1)
    )
  );

  return jsonb_build_object('ok', true, 'pending_with', target_player.id);
end;
$$;

create or replace function public.confirm_role_swap(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  requester public.players%rowtype;
  my_old_role text;
  req_old_role text;
  v_swap_cooldown integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  perform public.advance_game(p_game_id);

  select * into current_game from public.games where id = p_game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Role swaps can only happen while the round is live.';
  end if;

  select * into me from public.players
  where game_id = p_game_id and user_id = caller_id and status = 'active'
  for update;
  if not found then raise exception 'Active player required.'; end if;

  select * into requester from public.players
  where game_id = p_game_id
    and (status_detail->>'pending_swap_with') = me.id::text
    and status = 'active'
  for update;
  if not found then
    raise exception 'No pending role swap request found for you.';
  end if;

  my_old_role := me.secret_role;
  req_old_role := requester.secret_role;
  v_swap_cooldown := coalesce((current_game.mode_params->'vip_escort'->>'swap_cooldown_s')::int, 45);

  update public.players
  set secret_role = req_old_role,
      status_detail = jsonb_set(
        coalesce(status_detail, '{}'::jsonb) - 'pending_swap_with',
        '{swap_cooldown_until}',
        to_jsonb(to_char(clock_timestamp() + make_interval(secs => v_swap_cooldown), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      )
  where id = me.id;

  update public.players
  set secret_role = my_old_role,
      status_detail = jsonb_set(
        coalesce(status_detail, '{}'::jsonb) - 'pending_swap_with',
        '{swap_cooldown_until}',
        to_jsonb(to_char(clock_timestamp() + make_interval(secs => v_swap_cooldown), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      )
  where id = requester.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id, 'role_swap_confirmed', 'runner',
    jsonb_build_object(
      'player_a', me.id,
      'new_role_a', req_old_role,
      'player_b', requester.id,
      'new_role_b', my_old_role,
      'cooldown_s', v_swap_cooldown
    )
  );

  return jsonb_build_object(
    'ok', true,
    'my_new_role', req_old_role,
    'partner_id', requester.id,
    'partner_new_role', my_old_role
  );
end;
$$;

create or replace function public.tag_ghost(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  my_fix public.player_positions%rowtype;
  ghost_ent public.entities%rowtype;
  dist_m double precision;
  ghost_duration double precision;
  elapsed double precision;
  final_score integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  perform public.advance_game(tag_ghost.game_id);

  select * into current_game from public.games g where g.id = tag_ghost.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then raise exception 'The round is not live.'; end if;
  if current_game.mode_id <> 'ghost_duel' then raise exception 'tag_ghost is only for Ghost Duel.'; end if;

  select * into me from public.players p where p.game_id = tag_ghost.game_id and p.user_id = caller_id and p.status = 'active';
  if not found then raise exception 'Active player required.'; end if;
  if me.team <> 'hunter' then raise exception 'Only hunters can tag the ghost.'; end if;

  select * into my_fix from public.player_positions pp where pp.player_id = me.id;
  if not found or my_fix.recorded_at < now() - interval '15 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_fix');
  end if;

  select * into ghost_ent from public.entities e where e.game_id = tag_ghost.game_id and e.kind = 'ghost' limit 1;
  if not found or ghost_ent.geog is null then
    return jsonb_build_object('success', false, 'reason', 'no_ghost');
  end if;

  dist_m := extensions.st_distance(my_fix.geog, ghost_ent.geog);
  if dist_m > 10.0 then
    return jsonb_build_object('success', false, 'reason', 'out_of_range', 'distance_m', round(dist_m::numeric, 1));
  end if;

  ghost_duration := coalesce((ghost_ent.state->>'duration_s')::double precision, 240.0);
  elapsed := extract(epoch from (now() - current_game.live_at));
  final_score := greatest(100, round(1000 + ((ghost_duration - elapsed) * 10))::int);

  insert into public.ghost_duel_scores (
    game_id, user_id, variant, area_center, player_time_s, ghost_time_s, delta_s, efficiency, score
  ) values (
    current_game.id, caller_id, 'mirror_chase', current_game.area_center, elapsed, ghost_duration, ghost_duration - elapsed, 1.0, final_score
  );

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'ghost_tagged',
    'all',
    jsonb_build_object('player_id', me.id, 'score', final_score, 'time_s', elapsed, 'message', 'Ghost caught! Hunter wins!')
  );

  perform public.end_game(current_game.id, 'hunters', 'ghost_tagged');

  return jsonb_build_object('success', true, 'score', final_score, 'distance_m', round(dist_m::numeric, 1), 'game_ended', true);
end;
$$;

revoke all on function public.tag_ghost(uuid) from public, anon;
grant execute on function public.tag_ghost(uuid) to authenticated;

-- 4. attempt_tag: exclude runners incapacitated by Territory Pulse -------------

create or replace function public.attempt_tag(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  my_pos public.player_positions%rowtype;
  target_id uuid;
  target_distance double precision;
  v_my_prey_id uuid;
  v_already_frozen boolean;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = attempt_tag.game_id
      and p.user_id = caller_id
      and p.status = 'active'
    for update;
  if not found then raise exception 'You are not an active player in this game.'; end if;
  if coalesce(me.is_remote, false) then
    raise exception 'Remote operators cannot tag runners.';
  end if;

  perform public.advance_game(attempt_tag.game_id);

  select * into current_game from public.games g
    where g.id = attempt_tag.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Tagging is only available while the round is live.';
  end if;

  if current_game.mode_id <> 'assassin_ring' and me.team <> 'hunter' then
    raise exception 'Only hunters can tag runners.';
  end if;

  if me.last_tag_attempt_at is not null
     and now() - me.last_tag_attempt_at < interval '8 seconds' then
    return jsonb_build_object('success', false, 'reason', 'cooldown');
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or now() - my_pos.recorded_at > interval '20 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_position');
  end if;

  -- Safe zone check
  if exists (
    select 1 from public.entities e
    where e.game_id = current_game.id and e.kind = 'safe_zone'
      and extensions.st_dwithin(e.geog, my_pos.geog, coalesce((e.state->>'radius_m')::int, 20))
  ) then
    return jsonb_build_object('success', false, 'reason', 'in_safe_zone');
  end if;

  if current_game.mode_id = 'assassin_ring' then
    select ra.prey_player_id into v_my_prey_id
    from public.ring_assignments ra
    where ra.game_id = current_game.id and ra.hunter_player_id = me.id and ra.status = 'active';

    if v_my_prey_id is null then
      return jsonb_build_object('success', false, 'reason', 'no_prey_assigned');
    end if;

    if exists (
      select 1 from public.entities e
      join public.player_positions pp on pp.player_id = v_my_prey_id
      where e.game_id = current_game.id and e.kind = 'safe_zone'
        and extensions.st_dwithin(e.geog, pp.geog, coalesce((e.state->>'radius_m')::int, 20))
    ) then
      return jsonb_build_object('success', false, 'reason', 'in_safe_zone');
    end if;

    select p.id, extensions.st_distance(pp.geog, my_pos.geog)
      into target_id, target_distance
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.id = v_my_prey_id
      and p.game_id = current_game.id
      and p.status = 'active'
      and not coalesce(p.is_remote, false)
      and pp.recorded_at > now() - interval '20 seconds'
      and extensions.st_distance(pp.geog, my_pos.geog)
          <= current_game.tag_radius_m + least(
               10::double precision,
               (coalesce(my_pos.accuracy_m, 0)::double precision
                + coalesce(pp.accuracy_m, 0)::double precision) / 2
             );

    if target_id is null then
      update public.players p set last_tag_attempt_at = now() where p.id = me.id;
      return jsonb_build_object('success', false, 'reason', 'no_target');
    end if;

  else
    -- Standard Hunter vs Runner modes: pick nearest UN-FROZEN, UN-INCAPACITATED active field runner
    select p.id, extensions.st_distance(pp.geog, my_pos.geog)
      into target_id, target_distance
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = current_game.id
      and p.team = 'runner'
      and p.status = 'active'
      and not coalesce(p.is_remote, false)
      and (p.status_detail->>'frozen_until' is null or (p.status_detail->>'frozen_until')::timestamptz <= now())
      and (p.status_detail->>'incapacitated_until' is null or (p.status_detail->>'incapacitated_until')::timestamptz <= now())
      and pp.recorded_at > now() - interval '20 seconds'
      and extensions.st_distance(pp.geog, my_pos.geog)
          <= current_game.tag_radius_m + least(
               10::double precision,
               (coalesce(my_pos.accuracy_m, 0)::double precision
                + coalesce(pp.accuracy_m, 0)::double precision) / 2
             )
    order by extensions.st_distance(pp.geog, my_pos.geog) asc
    limit 1;

    if target_id is null then
      select exists (
        select 1
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.status = 'active'
          and not coalesce(p.is_remote, false)
          and (
            (p.status_detail->>'frozen_until')::timestamptz > now()
            or (p.status_detail->>'incapacitated_until')::timestamptz > now()
          )
          and pp.recorded_at > now() - interval '20 seconds'
          and extensions.st_distance(pp.geog, my_pos.geog)
              <= current_game.tag_radius_m + least(
                   10::double precision,
                   (coalesce(my_pos.accuracy_m, 0)::double precision
                    + coalesce(pp.accuracy_m, 0)::double precision) / 2
                 )
      ) into v_already_frozen;

      if v_already_frozen then
        return jsonb_build_object('success', false, 'reason', 'already_frozen');
      end if;

      update public.players p set last_tag_attempt_at = now() where p.id = me.id;
      return jsonb_build_object('success', false, 'reason', 'no_target');
    end if;
  end if;

  return public.apply_tag(
    current_game.id,
    me.id,
    target_id,
    target_distance
  );
end;
$$;

revoke all on function public.attempt_tag(uuid) from public, anon;
grant execute on function public.attempt_tag(uuid) to authenticated;

-- 5. Canonical advance_game with display_name join fix -------------------------

create or replace function public.advance_game(game_id uuid)
returns public.game_status
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  next_ping timestamptz;
  ping_count integer := 0;
  new_seq integer;
  live_runners integer;
  active_runners integer;
  active_hunters integer;
  now_time timestamptz := clock_timestamp();
  new_stage integer;
  runner record;
  active_vip record;
  promoted_bodyguard record;
  ghost_ent public.entities%rowtype;
  v_last_step timestamptz;
  v_elapsed_s integer;
  v_step_int integer := 2;
  v_next_pt extensions.geography;
  v_next_head double precision;
  v_runner_near boolean;
  v_hunter_near boolean;
  v_next_carrier_ping timestamptz;
  v_heist_carrier record;
  v_package_state jsonb;
  v_package_dropped_at timestamptz;
  v_pulse_int integer;
  v_next_pulse timestamptz;
  v_pulse_seq integer;
  v_runner_score integer;
  v_hunter_score integer;
  v_sector record;
  v_sector_runners integer;
  v_sector_hunters integer;
  v_controller text;
  v_contender text;
  v_contender_pulses integer;
  v_runner_zones integer := 0;
  v_hunter_zones integer := 0;
  v_runner_consec integer;
  v_hunter_consec integer;
  v_pulse_scores jsonb;
  v_new_mode_params jsonb;
  v_gm_next timestamptz;
  v_gm_interval integer;
  v_gm_event_type text;
  v_gm_title text;
  v_gm_narration text;
  v_gm_count integer;
  v_gm_max integer;
begin
  select * into current_game
    from public.games g
    where g.id = advance_game.game_id
    for update;

  if not found then
    raise exception 'Game not found.';
  end if;

  if current_game.status = 'countdown' and clock_timestamp() >= current_game.head_start_at then
    if current_game.head_start_s > 0 then
      update public.games g
        set status = 'head_start'
        where g.id = current_game.id;
      insert into public.events (game_id, type, payload)
        values (current_game.id, 'game_live', jsonb_build_object('phase', 'head_start'));
      select * into current_game from public.games g where g.id = advance_game.game_id;
    else
      update public.games g
        set status = 'live'
        where g.id = current_game.id;
      insert into public.events (game_id, type, payload)
        values (current_game.id, 'game_live', jsonb_build_object('phase', 'live'));
      select * into current_game from public.games g where g.id = advance_game.game_id;
    end if;
  end if;

  if current_game.status = 'head_start' and clock_timestamp() >= current_game.live_at then
    update public.games g
      set status = 'live'
      where g.id = current_game.id;
    insert into public.events (game_id, type, payload)
      values (current_game.id, 'head_start_ended', jsonb_build_object('phase', 'live'));
    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  -- Curfew safety check: round concludes if current curfew deadline is reached
  if current_game.status in ('live', 'head_start') and (current_game.mode_params->'safety'->>'curfew_at') is not null then
    if clock_timestamp() >= (current_game.mode_params->'safety'->>'curfew_at')::timestamptz then
      perform public.end_game(current_game.id, null, 'curfew_reached');
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'game_ended', 'all',
        jsonb_build_object('curfew_at', current_game.mode_params->'safety'->>'curfew_at', 'message', 'Curfew reached. Round automatically concluded for safety.')
      );
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  if current_game.status = 'live' and clock_timestamp() >= current_game.ends_at then
    if current_game.mode_id = 'assassin_ring' then
      perform public.end_game(current_game.id, 'draw', 'time_expired');
    elsif current_game.mode_id = 'ghost_duel' then
      perform public.end_game(current_game.id, null, 'time_expired');
    elsif current_game.mode_id = 'territory_pulse' then
      v_runner_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'runner')::int, 0);
      v_hunter_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'hunter')::int, 0);
      if v_runner_score > v_hunter_score then
        perform public.end_game(current_game.id, 'runners', 'time_expired');
      elsif v_hunter_score > v_runner_score then
        perform public.end_game(current_game.id, 'hunters', 'time_expired');
      else
        perform public.end_game(current_game.id, 'draw', 'time_expired');
      end if;
    else
      perform public.end_game(current_game.id, 'runners', 'time_expired');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
    return current_game.status;
  end if;

  -- Shrinking zone evaluation
  if current_game.status = 'live'
     and ('shrinking_zone' = any(current_game.modifiers) or (current_game.mode_params->'ai_gm'->>'shrink_scale') is not null)
     and current_game.zone_stage < array_length(public.zone_stage_values(current_game.id), 1) - 1 then
    new_stage := public.current_zone_stage(current_game.id);
    if new_stage > current_game.zone_stage then
      update public.games g
        set zone_stage = new_stage,
            zone_announced = new_stage
        where g.id = current_game.id;

      insert into public.events (game_id, type, payload)
        values (
          current_game.id,
          'zone_shrunk',
          jsonb_build_object(
            'stage', new_stage,
            'radius_m', public.effective_radius_m(current_game.id),
            'scale', (public.zone_stage_values(current_game.id))[new_stage + 1]
          )
        );
      select * into current_game from public.games g where g.id = advance_game.game_id;
    end if;
  end if;

  -- Jailbreak: auto-release evaluation with profiles join for display_name
  if current_game.status = 'live' and current_game.mode_id = 'jailbreak' then
    for runner in
      select p.id, coalesce(pr.display_name, 'Runner') as display_name, (p.status_detail->>'jailed_at')::timestamptz as jailed_time
      from public.players p
      left join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id and p.team = 'runner' and p.status = 'jailed'
    loop
      if runner.jailed_time is not null
         and clock_timestamp() >= runner.jailed_time + make_interval(secs => coalesce((current_game.mode_params->'jailbreak'->>'auto_release_s')::int, 300)) then
        update public.players
        set status = 'active',
            status_detail = jsonb_build_object('released_reason', 'auto_release', 'released_at', clock_timestamp())
        where id = runner.id;

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'player_rescued', 'all',
          jsonb_build_object('player_id', runner.id, 'rescued_by', null, 'reason', 'auto_release', 'message', format('%s auto-released from jail!', runner.display_name))
        );
      end if;
    end loop;
  end if;

  -- VIP Escort: disconnect failover promotion
  if current_game.status = 'live' and 'vip' = any(current_game.roles) then
    for active_vip in
      select p.id as vip_id, pp.recorded_at as last_seen
      from public.players p
      left join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id and p.team = 'runner' and p.secret_role = 'vip' and p.status = 'active'
    loop
      if active_vip.last_seen is not null and clock_timestamp() > active_vip.last_seen + interval '90 seconds' then
        select p.id, coalesce(pr.display_name, 'Runner') as display_name into promoted_bodyguard
        from public.players p
        left join public.profiles pr on pr.id = p.user_id
        where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
          and p.secret_role = 'bodyguard' and not p.is_remote
        order by p.created_at asc
        limit 1;

        if promoted_bodyguard.id is not null then
          update public.players
          set secret_role = 'bodyguard',
              status_detail = jsonb_set(coalesce(status_detail, '{}'::jsonb), '{is_vip}', 'false'::jsonb)
          where id = active_vip.vip_id;

          update public.players
          set secret_role = 'vip',
              status_detail = jsonb_set(coalesce(status_detail, '{}'::jsonb), '{is_vip}', 'true'::jsonb)
          where id = promoted_bodyguard.id;

          insert into public.events (game_id, type, audience, payload)
          values (
            current_game.id, 'vip_promoted', 'runner',
            jsonb_build_object(
              'previous_vip_id', active_vip.vip_id,
              'new_vip_id', promoted_bodyguard.id,
              'new_vip_name', promoted_bodyguard.display_name,
              'message', format('VIP disconnected! %s has been promoted to VIP.', promoted_bodyguard.display_name)
            )
          );
        end if;
      end if;
    end loop;
  end if;

  -- Stepping Ghost NPCs (for haunted_map and ghost_duel)
  if current_game.status = 'live' and current_game.mode_id in ('haunted_map', 'ghost_duel') then
    for ghost_ent in
      select * from public.entities
      where game_id = current_game.id and kind = 'ghost'
    loop
      v_last_step := (ghost_ent.state->>'last_step_at')::timestamptz;
      if v_last_step is null or clock_timestamp() >= v_last_step + make_interval(secs => v_step_int) then
        v_elapsed_s := greatest(0, extract(epoch from (clock_timestamp() - current_game.live_at))::int);

        if v_elapsed_s >= coalesce((ghost_ent.state->>'duration_s')::int, 240) then
          if current_game.mode_id = 'ghost_duel' then
            perform public.end_game(current_game.id, null, 'ghost_beaten');
            select * into current_game from public.games g where g.id = advance_game.game_id;
            return current_game.status;
          end if;
        else
          v_next_pt := extensions.st_project(
            ghost_ent.geog,
            coalesce((ghost_ent.state->>'speed_mps')::double precision, 1.4) * v_step_int,
            radians(coalesce((ghost_ent.state->>'heading')::double precision, 0.0))
          );
          v_next_head := coalesce((ghost_ent.state->>'heading')::double precision, 0.0);

          if extensions.st_distance(v_next_pt, current_game.area_center) > current_game.area_radius_m * 0.9 then
            v_next_head := mod((v_next_head + 180.0)::numeric, 360::numeric)::double precision;
            v_next_pt := extensions.st_project(
              ghost_ent.geog,
              coalesce((ghost_ent.state->>'speed_mps')::double precision, 1.4) * v_step_int,
              radians(v_next_head)
            );
          end if;

          update public.entities
          set geog = v_next_pt,
              state = jsonb_set(
                jsonb_set(
                  jsonb_set(state, '{last_step_at}', to_jsonb(to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
                  '{heading}', to_jsonb(v_next_head)
                ),
                '{elapsed_s}', to_jsonb(v_elapsed_s)
              )
          where id = ghost_ent.id;

          if current_game.mode_id = 'haunted_map' then
            select exists (
              select 1 from public.players p
              join public.player_positions pp on pp.player_id = p.id
              where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
                and pp.accuracy_m <= 30
                and extensions.st_dwithin(pp.geog, v_next_pt, 40)
            ) into v_runner_near;

            if v_runner_near then
              insert into public.pings (game_id, player_id, seq, geog, accuracy_m, position_age_s, reason, released_at)
              values (
                current_game.id, null, current_game.ping_seq + 1, v_next_pt, 15.0, 0,
                'ghost_sighting',
                clock_timestamp()
              );
              update public.games set ping_seq = current_game.ping_seq + 1 where id = current_game.id;
            end if;
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- Territory Pulse: 90s pulse evaluation & 2-pulse flip logic
  if current_game.status = 'live' and current_game.mode_id = 'territory_pulse' then
    v_pulse_int := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_interval_s')::int, 90);
    v_next_pulse := (current_game.mode_params->'territory_pulse'->>'next_pulse_at')::timestamptz;
    v_pulse_seq := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_seq')::int, 0);

    if v_next_pulse is not null and clock_timestamp() >= v_next_pulse then
      v_runner_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'runner')::int, 0);
      v_hunter_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'hunter')::int, 0);
      v_pulse_seq := v_pulse_seq + 1;

      for v_sector in
        select e.id, e.geog, e.state
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'zone'
      loop
        select count(*) into v_sector_runners
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
          and not coalesce(p.is_remote, false)
          and (p.status_detail->>'incapacitated_until' is null or (p.status_detail->>'incapacitated_until')::timestamptz <= clock_timestamp())
          and pp.recorded_at > clock_timestamp() - interval '30 seconds'
          and extensions.st_dwithin(pp.geog, v_sector.geog, coalesce((v_sector.state->>'radius_m')::int, 60));

        select count(*) into v_sector_hunters
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id and p.team = 'hunter' and p.status = 'active'
          and not coalesce(p.is_remote, false)
          and (p.status_detail->>'incapacitated_until' is null or (p.status_detail->>'incapacitated_until')::timestamptz <= clock_timestamp())
          and pp.recorded_at > clock_timestamp() - interval '30 seconds'
          and extensions.st_dwithin(pp.geog, v_sector.geog, coalesce((v_sector.state->>'radius_m')::int, 60));

        v_controller := v_sector.state->>'controller';
        v_contender := v_sector.state->>'contender';
        v_contender_pulses := coalesce((v_sector.state->>'contender_pulses')::int, 0);

        if v_sector_runners > v_sector_hunters then
          if v_controller is null then
            v_controller := 'runner';
            v_contender := null;
            v_contender_pulses := 0;
          elsif v_controller = 'runner' then
            v_contender := null;
            v_contender_pulses := 0;
          else
            if v_contender = 'runner' then
              v_contender_pulses := v_contender_pulses + 1;
              if v_contender_pulses >= 2 then
                v_controller := 'runner';
                v_contender := null;
                v_contender_pulses := 0;
              end if;
            else
              v_contender := 'runner';
              v_contender_pulses := 1;
            end if;
          end if;
        elsif v_sector_hunters > v_sector_runners then
          if v_controller is null then
            v_controller := 'hunter';
            v_contender := null;
            v_contender_pulses := 0;
          elsif v_controller = 'hunter' then
            v_contender := null;
            v_contender_pulses := 0;
          else
            if v_contender = 'hunter' then
              v_contender_pulses := v_contender_pulses + 1;
              if v_contender_pulses >= 2 then
                v_controller := 'hunter';
                v_contender := null;
                v_contender_pulses := 0;
              end if;
            else
              v_contender := 'hunter';
              v_contender_pulses := 1;
            end if;
          end if;
        else
          v_contender := null;
          v_contender_pulses := 0;
        end if;

        update public.entities
        set state = jsonb_set(
              jsonb_set(
                jsonb_set(state, '{controller}', to_jsonb(v_controller)),
                '{contender}', to_jsonb(v_contender)
              ),
              '{contender_pulses}', to_jsonb(v_contender_pulses)
            )
        where id = v_sector.id;

        if v_controller = 'runner' then
          v_runner_zones := v_runner_zones + 1;
        elsif v_controller = 'hunter' then
          v_hunter_zones := v_hunter_zones + 1;
        end if;
      end loop;

      v_runner_score := v_runner_score + v_runner_zones;
      v_hunter_score := v_hunter_score + v_hunter_zones;

      v_runner_consec := coalesce((current_game.mode_params->'territory_pulse'->'consecutive_dominance'->>'runner')::int, 0);
      v_hunter_consec := coalesce((current_game.mode_params->'territory_pulse'->'consecutive_dominance'->>'hunter')::int, 0);

      if v_runner_zones >= 5 then
        v_runner_consec := v_runner_consec + 1;
        v_hunter_consec := 0;
      elsif v_hunter_zones >= 5 then
        v_hunter_consec := v_hunter_consec + 1;
        v_runner_consec := 0;
      else
        v_runner_consec := 0;
        v_hunter_consec := 0;
      end if;

      v_pulse_scores := jsonb_build_object(
        'runner', v_runner_score,
        'hunter', v_hunter_score
      );

      v_new_mode_params := coalesce(current_game.mode_params, '{}'::jsonb);
      v_new_mode_params := jsonb_set(
        v_new_mode_params,
        '{territory_pulse}',
        jsonb_build_object(
          'pulse_interval_s', v_pulse_int,
          'pulse_seq', v_pulse_seq,
          'last_pulse_at', clock_timestamp(),
          'next_pulse_at', clock_timestamp() + make_interval(secs => v_pulse_int),
          'scores', v_pulse_scores,
          'dominance_pct', 70,
          'consecutive_dominance', jsonb_build_object('runner', v_runner_consec, 'hunter', v_hunter_consec)
        )
      );
      update public.games set mode_params = v_new_mode_params where id = current_game.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'territory_pulse_scored', 'all',
        jsonb_build_object(
          'pulse_seq', v_pulse_seq,
          'runner_zones', v_runner_zones,
          'hunter_zones', v_hunter_zones,
          'scores', v_pulse_scores,
          'runner_consecutive', v_runner_consec,
          'hunter_consecutive', v_hunter_consec
        )
      );

      if v_runner_consec >= 2 then
        perform public.end_game(current_game.id, 'runners', 'territory_dominance');
        select * into current_game from public.games g where g.id = advance_game.game_id;
        return current_game.status;
      elsif v_hunter_consec >= 2 then
        perform public.end_game(current_game.id, 'hunters', 'territory_dominance');
        select * into current_game from public.games g where g.id = advance_game.game_id;
        return current_game.status;
      end if;
    end if;
  end if;

  -- Scheduled pings release
  if current_game.status = 'live' and clock_timestamp() >= current_game.next_ping_at then
    new_seq := current_game.ping_seq + 1;

    for runner in
      select p.id,
             p.status_detail,
             pp.geog,
             pp.accuracy_m,
             pp.recorded_at,
             round(extract(epoch from (now_time - pp.recorded_at)))::integer as age_s
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and (
            (current_game.mode_id <> 'assassin_ring' and p.team = 'runner' and p.status = 'active')
            or (current_game.mode_id = 'assassin_ring' and p.status = 'active')
          )
          and not coalesce(p.is_remote, false)
          and pp.recorded_at >= now_time - make_interval(secs => current_game.ping_interval_s * 2)
    loop
      if coalesce((runner.status_detail->>'scramble')::boolean, false) is true then
        insert into public.pings (
          game_id, player_id, seq, geog, accuracy_m, position_age_s, reason, released_at
        ) values (
          current_game.id,
          runner.id,
          new_seq,
          extensions.st_project(runner.geog, 80 + (random() * 40), radians(random() * 360)),
          coalesce(runner.accuracy_m, 10.0) + 50.0,
          runner.age_s,
          'scheduled',
          now_time
        );
        update public.players
        set status_detail = status_detail - 'scramble'
        where id = runner.id;
        delete from public.entities where entities.game_id = current_game.id and entities.kind = 'scramble' and (entities.state->>'runner_id')::uuid = runner.id;
      else
        insert into public.pings (
          game_id, player_id, seq, geog, accuracy_m, position_age_s, reason, released_at
        ) values (
          current_game.id,
          runner.id,
          new_seq,
          runner.geog,
          runner.accuracy_m,
          runner.age_s,
          'scheduled',
          now_time
        );
      end if;
      ping_count := ping_count + 1;
    end loop;

    next_ping := current_game.next_ping_at + make_interval(secs => current_game.ping_interval_s);
    while next_ping <= clock_timestamp() loop
      next_ping := next_ping + make_interval(secs => current_game.ping_interval_s);
    end loop;

    update public.games g
      set next_ping_at = next_ping,
          ping_seq = new_seq
      where g.id = current_game.id;

    insert into public.events (game_id, type, payload)
      values (
        current_game.id,
        'ping_released',
        jsonb_build_object('seq', new_seq, 'count', ping_count, 'released_at', now_time)
      );

    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  return current_game.status;
end;
$$;

revoke all on function public.advance_game(uuid) from public, anon;
grant execute on function public.advance_game(uuid) to authenticated;

-- 6. Canonical get_game_state with all mode top-level snapshots & safety -------

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
  v_assassin_ring jsonb;
  v_relay_heist jsonb;
  v_vip_escort jsonb;
  v_fog_until timestamptz;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(game_id) then raise exception 'You are not a member of this game.'; end if;

  perform public.advance_game(get_game_state.game_id);

  select * into current_game from public.games g where g.id = get_game_state.game_id;
  select * into mine from public.players p where p.game_id = get_game_state.game_id and p.user_id = caller_id;

  -- Ghost duel snapshot
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

  -- Territory pulse snapshot
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

  -- AI GM snapshot
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

  -- Assassin ring snapshot
  v_assassin_ring := case
    when current_game.mode_id = 'assassin_ring' then jsonb_build_object(
      'my_prey', (
        select jsonb_build_object(
          'player_id', prey_p.id,
          'display_name', prey_pr.display_name,
          'color', prey_pr.color,
          'status', prey_p.status
        )
        from public.ring_assignments ra
        join public.players prey_p on prey_p.id = ra.prey_player_id
        join public.profiles prey_pr on prey_pr.id = prey_p.user_id
        where ra.game_id = current_game.id
          and ra.hunter_player_id = mine.id
          and ra.status = 'active'
      ),
      'hunter_proximity', (
        select case
          when hunter_pp.geog is null or my_pp.geog is null then 'none'
          when extensions.st_dwithin(hunter_pp.geog, my_pp.geog, 40) then 'close'
          when extensions.st_dwithin(hunter_pp.geog, my_pp.geog, 100) then 'near'
          else 'none'
        end
        from public.ring_assignments ra
        join public.player_positions hunter_pp on hunter_pp.player_id = ra.hunter_player_id
        left join public.player_positions my_pp on my_pp.player_id = mine.id
        where ra.game_id = current_game.id
          and ra.prey_player_id = mine.id
          and ra.status = 'active'
      ),
      'safe_zones', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'zone_index', coalesce((e.state->>'zone_index')::int, 1),
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 20)
        ))
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'safe_zone'
      ), '[]'::jsonb),
      'in_safe_zone', exists (
        select 1 from public.entities e
        join public.player_positions pp on pp.player_id = mine.id
        where e.game_id = current_game.id and e.kind = 'safe_zone'
          and extensions.st_dwithin(e.geog, pp.geog, coalesce((e.state->>'radius_m')::int, 20))
      ),
      'active_survivors', (
        select count(*) from public.players where game_id = current_game.id and status = 'active'
      )
    )
    else null
  end;

  -- Relay heist snapshot
  v_relay_heist := case
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
  end;

  -- VIP escort snapshot
  v_vip_escort := case
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
  end;

  return jsonb_build_object(
    'server_time', clock_timestamp(),
    'ghost_duel', v_ghost_duel,
    'territory_pulse', v_territory_pulse,
    'ai_gm', v_ai_gm,
    'assassin_ring', v_assassin_ring,
    'relay_heist', v_relay_heist,
    'vip_escort', v_vip_escort,
    'safety', jsonb_build_object(
      'is_paused', (current_game.status = 'paused'),
      'paused_at', current_game.mode_params->'safety'->>'paused_at',
      'paused_by', current_game.mode_params->'safety'->>'paused_by',
      'paused_by_name', (
        select pr.display_name from public.profiles pr
        where pr.id = (current_game.mode_params->'safety'->>'paused_by')::uuid
      ),
      'pause_reason', current_game.mode_params->'safety'->>'pause_reason',
      'pause_timeout_at', current_game.mode_params->'safety'->>'pause_timeout_at',
      'pre_pause_status', current_game.mode_params->'safety'->>'pre_pause_status',
      'vote_count', coalesce((current_game.mode_params->'safety'->>'vote_count')::int, 0),
      'votes_required', coalesce((current_game.mode_params->'safety'->>'votes_required')::int, 0),
      'pause_votes', coalesce(current_game.mode_params->'safety'->'pause_votes', '{}'::jsonb),
      'curfew_at', current_game.mode_params->'safety'->>'curfew_at',
      'is_night', (
        extract(hour from clock_timestamp() at time zone 'UTC') in (20, 21, 22, 23, 0, 1, 2, 3, 4, 5)
      ),
      'vehicle_warning', coalesce((mine.status_detail->>'vehicle_warning')::boolean, false)
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
      'next_ping_at', current_game.next_ping_at,
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
      'relay_heist', v_relay_heist,
      'vip_escort', v_vip_escort
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

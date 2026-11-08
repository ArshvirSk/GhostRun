-- Migration: 20261118024000_vm2_sim_all_parity.sql
-- VM2 & Sim complete parity fixes:
-- 1. start_game: set 'status': 'carried' on package entity for Relay Heist
-- 2. attempt_tag & tag_ghost: support updated_at timestamp fallback for client clock skew
-- 3. submit_position: guard ghost duel target arrival check with me.team = 'runner' (exclude mirror chase hunters) and record score into ghost_duel_scores

-- 1. start_game with status: carried in relay package --------------------------
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

    delete from public.ring_assignments ra where ra.game_id = current_game.id;
    delete from public.entities e where e.game_id = current_game.id and e.kind = 'safe_zone';

    select count(*) into safe_zone_count from public.entities e where e.game_id = current_game.id and e.kind = 'safe_zone';
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
      join shuffled s2 on s2.rn = case when s1.rn = s1.total then 1 else s1.rn + 1 end
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
    -- Operator Role
    if field_runners = 0 then
      raise exception 'Cannot start game with only remote operator on runners team.';
    end if;
    if field_hunters = 0 then
      raise exception 'Cannot start game with only remote operator on hunters team.';
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
        'last_title', null,
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

  -- For Relay Heist mode, assign initial carrier with explicit 'status': 'carried'
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
          'status', 'carried',
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

-- 2. attempt_tag with clock skew fallback (updated_at) ------------------------
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
  if not found or (now() - my_pos.recorded_at > interval '20 seconds' and now() - my_pos.updated_at > interval '20 seconds') then
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
      and (pp.recorded_at > now() - interval '20 seconds' or pp.updated_at > now() - interval '20 seconds')
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
      and (pp.recorded_at > now() - interval '20 seconds' or pp.updated_at > now() - interval '20 seconds')
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
          and (pp.recorded_at > now() - interval '20 seconds' or pp.updated_at > now() - interval '20 seconds')
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

  return public.apply_tag(current_game.id, me.id, target_id, target_distance);
end;
$$;

revoke all on function public.attempt_tag(uuid) from public, anon;
grant execute on function public.attempt_tag(uuid) to authenticated;

-- 3. tag_ghost with clock skew fallback (updated_at) --------------------------
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
  if not found or (my_fix.recorded_at < now() - interval '20 seconds' and my_fix.updated_at < now() - interval '20 seconds') then
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

-- 4. submit_position with ghost_duel_scores insert and runner-only arrival check
create or replace function public.submit_position(
  game_id uuid,
  lat double precision,
  lng double precision,
  accuracy double precision default null,
  speed double precision default null,
  heading double precision default null,
  recorded_at timestamptz default null,
  is_mock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  fix_time timestamptz;
  fix_geog geography;
  v_in_bounds boolean;
  v_radius double precision;
  v_accuracy real;
  v_speed real;
  v_heading real;
  v_prev_out timestamptz;
  v_out_since timestamptz;
  v_prev_noise integer;
  v_prev_alerted boolean;
  v_prev_smoothed real;
  v_prev_anchor geography;
  v_prev_anchor_since timestamptz;
  v_prev_updated timestamptz;
  v_prev_fast_since timestamptz;
  v_prev_vehicle_warned boolean;
  v_smoothed real;
  v_fast_since timestamptz;
  v_vehicle_warned boolean;
  v_noise integer := 0;
  v_alerted boolean := false;
  v_anchor geography;
  v_anchor_since timestamptz;
  v_dt double precision;
  v_noise_seq integer;
  v_noise_on boolean;
  v_duel_variant text;
  v_duel_target public.entities%rowtype;
  v_ghost_ent public.entities%rowtype;
  v_p_time double precision;
  v_g_time double precision;
  v_delta double precision;
  v_straight_m double precision;
  v_actual_m double precision;
  v_eff real := 1.0;
  v_score integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if submit_position.game_id is null then raise exception 'Game not found.'; end if;

  select * into current_game from public.games where id = submit_position.game_id;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players where game_id = submit_position.game_id and user_id = caller_id;
  if not found then raise exception 'You are not a member of this game.'; end if;

  if coalesce(me.is_remote, false) then
    return jsonb_build_object(
      'phase', current_game.status,
      'is_remote', true,
      'in_bounds', true
    );
  end if;

  fix_time := coalesce(submit_position.recorded_at, clock_timestamp());
  fix_geog := extensions.st_setsrid(extensions.st_makepoint(submit_position.lng, submit_position.lat), 4326)::extensions.geography;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_dwithin(fix_geog, current_game.area_center, v_radius);
  v_accuracy := coalesce(submit_position.accuracy, 10)::real;
  v_speed := submit_position.speed::real;
  v_heading := submit_position.heading::real;

  select out_of_bounds_since, noise, noise_alerted, smoothed_speed_mps, anchor_geog, anchor_since, updated_at, fast_since, vehicle_warned
    into v_prev_out, v_prev_noise, v_prev_alerted, v_prev_smoothed, v_prev_anchor, v_prev_anchor_since, v_prev_updated, v_prev_fast_since, v_prev_vehicle_warned
    from public.player_positions
    where player_id = me.id;

  if v_in_bounds then
    v_out_since := null;
    if v_prev_out is not null then
      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id, 'boundary_restored', me.id, 'all',
        jsonb_build_object('user_id', caller_id, 'player_id', me.id)
      );
    end if;
  else
    v_out_since := coalesce(v_prev_out, fix_time);
    if v_prev_out is null then
      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id, 'boundary_warning', me.id, 'all',
        jsonb_build_object(
          'user_id', caller_id,
          'player_id', me.id,
          'message', 'You are outside the play area! Return inside.'
        )
      );
    end if;
  end if;

  v_dt := case
    when v_prev_updated is null then 1.0
    else greatest(0.5, least(10.0, extract(epoch from (now() - v_prev_updated))))
  end;

  -- Speed Smoothing & Vehicle Safety Warning (>8 m/s for 10 s)
  if v_speed is null then
    v_smoothed := coalesce(v_prev_smoothed, 0.0);
  elsif v_prev_smoothed is null then
    v_smoothed := v_speed;
  else
    v_smoothed := 0.75 * v_prev_smoothed + 0.25 * v_speed;
  end if;

  v_noise_on := ('noise_meter' = any(current_game.modifiers) or 'noise' = any(current_game.modifiers));

  if v_smoothed >= 8.0 then
    v_fast_since := coalesce(v_prev_fast_since, fix_time);
    v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);
    if not v_vehicle_warned and v_fast_since is not null and greatest(now(), fix_time) - v_fast_since >= interval '10 seconds' then
      insert into public.events (game_id, type, audience, payload, target_player)
      values (
        current_game.id, 'vehicle_warning', 'all',
        jsonb_build_object(
          'player_id', me.id,
          'user_id', caller_id,
          'speed_mps', round(v_smoothed::numeric, 1),
          'message', 'Vehicle speed detected (>8 m/s sustained for 10 s). Motorized transit is prohibited!'
        ),
        me.id
      );
      v_vehicle_warned := true;

      -- Mode-specific penalty: Noise meter spike to 100
      if v_noise_on and me.team = 'runner' then
        v_noise := 100;
      end if;

      update public.players
      set status_detail = coalesce(status_detail, '{}'::jsonb) || jsonb_build_object(
        'vehicle_warning', true,
        'speed_warning_at', clock_timestamp(),
        'speed_warnings_count', coalesce((status_detail->>'speed_warnings_count')::int, 0) + 1
      )
      where id = me.id;
    end if;
  else
    v_fast_since := null;
    v_vehicle_warned := false;
  end if;

  -- Mock location check
  if coalesce(submit_position.is_mock, false) then
    insert into public.events (game_id, type, target_player, audience, payload)
    values (
      current_game.id,
      'mock_location_detected',
      me.id,
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'message', 'Mock location detected from player.'
      )
    );
  end if;

  -- Noise modifier logic
  if v_noise_on and me.team = 'runner' and not v_vehicle_warned then
    if v_smoothed >= 8 then
      v_noise := round(coalesce(v_prev_noise, 0) + 8 * v_dt)::integer;
    elsif v_smoothed >= 5 then
      v_noise := round(coalesce(v_prev_noise, 0) + 4 * v_dt)::integer;
    elsif v_smoothed >= 2.5 then
      v_noise := round(coalesce(v_prev_noise, 0) + 1.5 * v_dt)::integer;
    elsif v_smoothed >= 0.5 then
      v_noise := greatest(0, round(coalesce(v_prev_noise, 0) - 2 * v_dt))::integer;
    else
      v_noise := greatest(0, round(coalesce(v_prev_noise, 0) - 5 * v_dt))::integer;
    end if;
    v_noise := least(100, greatest(0, v_noise));

    v_alerted := coalesce(v_prev_alerted, false);
    if v_noise >= 100 and not v_alerted then
      v_alerted := true;
      select coalesce(max(seq), 0) + 1 into v_noise_seq
        from public.pings
        where pings.game_id = current_game.id;
      insert into public.pings (game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at)
      values (
        current_game.id,
        v_noise_seq,
        me.id,
        fix_geog,
        coalesce(v_accuracy, 10)::real,
        0,
        'noise_burst',
        now()
      );
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'noise_spike',
        'hunter',
        jsonb_build_object('player_id', me.id, 'noise', v_noise)
      );
      v_noise := 50;
    elsif v_noise < 100 then
      v_alerted := false;
    end if;
  end if;

  insert into public.player_positions (
    player_id, game_id, geog, accuracy_m, speed_mps, heading,
    recorded_at, updated_at, is_mock, out_of_bounds_since,
    noise, noise_alerted, smoothed_speed_mps, anchor_geog, anchor_since,
    fast_since, vehicle_warned
  ) values (
    me.id, current_game.id, fix_geog, v_accuracy, v_speed, v_heading,
    fix_time, now(), coalesce(submit_position.is_mock, false), v_out_since,
    v_noise, v_alerted, v_smoothed, v_anchor, v_anchor_since,
    v_fast_since, v_vehicle_warned
  )
  on conflict (player_id) do update set
    game_id = excluded.game_id,
    geog = excluded.geog,
    accuracy_m = excluded.accuracy_m,
    speed_mps = excluded.speed_mps,
    heading = excluded.heading,
    recorded_at = excluded.recorded_at,
    updated_at = excluded.updated_at,
    out_of_bounds_since = excluded.out_of_bounds_since,
    noise = excluded.noise,
    noise_alerted = excluded.noise_alerted,
    smoothed_speed_mps = excluded.smoothed_speed_mps,
    anchor_geog = excluded.anchor_geog,
    anchor_since = excluded.anchor_since,
    fast_since = excluded.fast_since,
    vehicle_warned = excluded.vehicle_warned;

  -- Store trail points throttled to 10s
  if not coalesce(submit_position.is_mock, false) then
    insert into public.trail_points (game_id, player_id, geog, accuracy_m, recorded_at)
    select current_game.id, me.id, fix_geog, v_accuracy, fix_time
    where not exists (
      select 1
      from public.trail_points tp
      where tp.player_id = me.id
        and tp.recorded_at > fix_time - interval '10 seconds'
    );
  end if;

  -- Skip arrival & collision victory evaluations if game is paused
  if current_game.status <> 'paused' then
    -- Classic chase arrival check (guarded by VIP role if active)
    if current_game.mode_id = 'classic_chase' and me.team = 'runner' and current_game.status = 'live' then
      if (not ('vip' = any(coalesce(current_game.roles, '{}'::text[]))) or me.secret_role = 'vip') then
        if exists (
          select 1 from public.targets t
          where t.game_id = current_game.id
            and extensions.st_dwithin(fix_geog, t.geog, current_game.target_radius_m)
        ) then
          insert into public.events (game_id, type, target_player, audience, payload)
          values (
            current_game.id, 'target_reached', me.id, 'all',
            jsonb_build_object('runner_id', me.id, 'user_id', caller_id)
          );
          perform public.end_game(current_game.id, 'runners', 'target_reached');
          select * into current_game from public.games g where g.id = submit_position.game_id;
        end if;
      end if;
    end if;

    -- Relay Heist extraction check: carrier enters extraction zone
    if current_game.status = 'live'
       and current_game.mode_id = 'relay_heist'
       and me.team = 'runner'
       and exists (
         select 1
         from public.entities e_pkg
         join public.entities e_ext on e_ext.game_id = current_game.id and e_ext.kind = 'extraction'
         where e_pkg.game_id = current_game.id
           and e_pkg.kind = 'package'
           and (e_pkg.state->>'carrier_player_id') = me.id::text
           and (e_pkg.state->>'status') = 'carried'
           and extensions.st_dwithin(fix_geog, e_ext.geog, coalesce((e_ext.state->>'radius_m')::int, 25))
       ) then
      perform public.end_game(current_game.id, 'runners', 'extraction_complete');
      select * into current_game from public.games g where g.id = submit_position.game_id;
    end if;

    -- Ghost Duel arrival / collision checks (only for runner in time_trial or evade)
    if current_game.mode_id = 'ghost_duel' and current_game.status = 'live' and me.team = 'runner' then
      v_duel_variant := coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial');

      select * into v_duel_target from public.entities where entities.game_id = current_game.id and kind = 'target' limit 1;
      select * into v_ghost_ent from public.entities where entities.game_id = current_game.id and kind = 'ghost' limit 1;

      -- Evade collision check
      if v_duel_variant = 'evade' and v_ghost_ent.id is not null then
        if extensions.st_dwithin(fix_geog, v_ghost_ent.geog, 20.0) then
          perform public.end_game(current_game.id, 'hunters', 'haunted');
          select * into current_game from public.games g where g.id = submit_position.game_id;
        end if;
      end if;

      -- Time trial arrival check
      if v_duel_variant in ('time_trial', 'evade') and v_duel_target.id is not null and extensions.st_dwithin(fix_geog, v_duel_target.geog, coalesce((v_duel_target.state->>'radius_m')::double precision, 20.0)) then
        v_p_time := greatest(1.0, extract(epoch from (now() - current_game.live_at)));
        v_g_time := coalesce((v_ghost_ent.state->>'duration_s')::double precision, 240.0);
        v_delta := v_g_time - v_p_time;

        select extensions.st_distance(current_game.area_center, v_duel_target.geog) into v_straight_m;
        select coalesce(sum(extensions.st_length(tp.geog::extensions.geography)), v_straight_m) into v_actual_m
        from public.trail_points tp where tp.game_id = current_game.id and tp.player_id = me.id;

        if v_actual_m > 0 and v_straight_m > 0 then
          v_eff := least(1.0, (v_straight_m / v_actual_m)::real);
        else
          v_eff := 1.0;
        end if;

        v_score := greatest(100, round(1000.0 + (v_delta * 10.0) + (v_eff * 200.0))::integer);

        insert into public.ghost_duel_scores (
          game_id, user_id, variant, area_center, player_time_s, ghost_time_s, delta_s, efficiency, score
        ) values (
          current_game.id, caller_id, v_duel_variant, current_game.area_center, v_p_time, v_g_time, v_delta, v_eff, v_score
        );

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'ghost_duel_finish', 'all',
          jsonb_build_object(
            'player_id', me.id,
            'player_time_s', v_p_time,
            'ghost_time_s', v_g_time,
            'delta_s', v_delta,
            'efficiency', round(v_eff::numeric, 2),
            'score', v_score,
            'beaten', (v_delta >= 0)
          )
        );

        if v_duel_variant = 'evade' then
          perform public.end_game(current_game.id, 'runners', 'evaded');
        elsif v_delta >= 0 then
          perform public.end_game(current_game.id, 'runners', 'ghost_beaten');
        else
          perform public.end_game(current_game.id, 'runners', 'ghost_won');
        end if;
        select * into current_game from public.games g where g.id = submit_position.game_id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'phase', current_game.status,
    'server_time', clock_timestamp(),
    'live_at', current_game.live_at,
    'ends_at', current_game.ends_at,
    'next_ping_at', current_game.next_ping_at,
    'in_bounds', v_in_bounds,
    'effective_radius_m', v_radius,
    'my_status', me.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason,
    'noise', coalesce(v_noise, 0),
    'smoothed_speed_mps', round(v_smoothed::numeric, 2),
    'vehicle_warning', coalesce(v_vehicle_warned, false)
  );
end;
$$;

revoke all on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) from public, anon;
grant execute on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) to authenticated;

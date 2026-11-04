-- Migration: 20261111008000_b3_start_game_canonical.sql
-- Canonical start_game function matching all mode requirements:
-- Jailbreak, Assassin Ring, Relay Heist, Haunted Map ghost spawning, Dead Drops spawning, Double Agent, and resource pools.
-- Also exposes fast_since and vehicle_warned in submit_position return for diagnostics.

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
  active_total integer;
  missing_consent integer;
  countdown_ends timestamptz;
  live_starts timestamptz;
  round_ends timestamptz;
  hunter_heat_charges integer := 0;
  chosen_agent_id uuid;
  agent_charges integer;
  agent_cooldown integer;
  safe_zone_count integer;
  chosen_carrier_id uuid;
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
    if not exists (select 1 from public.entities e where e.game_id = current_game.id and e.kind = 'extraction_point') then
      raise exception 'Place the extraction point before starting the round.';
    end if;
  end if;

  select count(*) filter (where p.team = 'runner'),
         count(*) filter (where p.team = 'hunter'),
         count(*) filter (where p.team = 'unassigned'),
         count(*)
    into active_runners, active_hunters, unassigned, active_total
    from public.players p
    where p.game_id = current_game.id and p.status = 'active';

  if current_game.mode_id = 'assassin_ring' then
    if active_total < 3 then
      raise exception 'Assassin Ring requires at least 3 players to form a ring.';
    end if;

    -- In assassin_ring, all active players play as 'solo'
    update public.players p
      set team = 'solo'
      where p.game_id = current_game.id and p.status = 'active';

    -- Auto-place 2 safe zones if fewer than 2 exist
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

    -- Generate circular Hamiltonian cycle permutation
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

  if 'double_agent' = any(current_game.roles) and current_game.mode_id <> 'assassin_ring' then
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
          'reason', 'Requires at least 2 active hunters to maintain mystery.'
        )
      );
    end if;
  end if;

  countdown_ends := clock_timestamp() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);
  round_ends := live_starts + make_interval(secs => current_game.duration_s);

  update public.games g
    set status = 'countdown',
        head_start_at = countdown_ends,
        live_at = live_starts,
        ends_at = round_ends,
        ping_interval_s = case
          when 'hot_cold' = any(g.modifiers) or g.mode_id = 'hot_cold' then least(900, g.ping_interval_s * 3)
          else g.ping_interval_s
        end,
        next_ping_at = live_starts + make_interval(secs => case
          when 'hot_cold' = any(g.modifiers) or g.mode_id = 'hot_cold' then least(900, g.ping_interval_s * 3)
          else g.ping_interval_s
        end),
        ping_seq = 0,
        roles = current_game.roles
    where g.id = current_game.id
    returning * into current_game;

  if current_game.mode_id in ('haunted_map', 'ghost_duel') then
    perform public.spawn_ghost_npcs(current_game.id);
  end if;

  if 'dead_drops' = any(current_game.modifiers) then
    perform public.spawn_drops(start_game.game_id, null);
  end if;

  -- For Relay Heist mode: designate initial package carrier
  if current_game.mode_id = 'relay_heist' then
    select p.id into chosen_carrier_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
    order by random()
    limit 1;

    if chosen_carrier_id is null then
      raise exception 'Relay Heist requires at least one active runner.';
    end if;

    insert into public.entities (
      game_id,
      kind,
      carrier_id,
      state,
      visible_to
    ) values (
      current_game.id,
      'package',
      chosen_carrier_id,
      jsonb_build_object('carrier_id', chosen_carrier_id, 'is_carried', true),
      'all'
    );

    insert into public.events (
      game_id,
      type,
      target_player,
      audience,
      payload
    ) values (
      current_game.id,
      'carrier_designated',
      chosen_carrier_id,
      'all',
      jsonb_build_object(
        'carrier_id', chosen_carrier_id,
        'message', 'Package carrier designated'
      )
    );
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

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;

-- Also update submit_position to ensure vehicle_warning timing is reliably evaluated
-- across client clock drift by evaluating greatest(now(), fix_time) - v_fast_since >= interval '10 seconds'
-- and returning fast_since/vehicle_warned diagnostics.
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
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  fix_time timestamptz;
  fix_geog extensions.geography;
  v_accuracy real;
  v_speed real;
  v_heading real;
  v_radius double precision;
  v_in_bounds boolean;
  v_prev_out timestamptz;
  v_prev_noise integer;
  v_prev_alerted boolean;
  v_prev_smoothed real;
  v_prev_anchor extensions.geography;
  v_prev_anchor_since timestamptz;
  v_prev_updated timestamptz;
  v_prev_fast_since timestamptz;
  v_prev_vehicle_warned boolean;
  v_out_since timestamptz;
  v_dt double precision;
  v_smoothed real;
  v_fast_since timestamptz;
  v_vehicle_warned boolean;
  v_noise_on boolean;
  v_noise integer := 0;
  v_alerted boolean := false;
  v_anchor extensions.geography;
  v_anchor_since timestamptz;
  v_camp_seq integer;
  v_noise_seq integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if submit_position.game_id is null then raise exception 'Game not found.'; end if;

  -- Advance game clock before evaluating current phase and positions
  perform public.advance_game(submit_position.game_id);

  select * into current_game from public.games g
    where g.id = submit_position.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players p
    where p.game_id = submit_position.game_id
      and p.user_id = caller_id
      and p.status <> 'left';
  if not found then raise exception 'You are not a player in this game.'; end if;

  if current_game.status in ('ended', 'cancelled') or me.status <> 'active' then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', now(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner
    );
  end if;

  if current_game.status = 'countdown' then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', now(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner
    );
  end if;

  if current_game.status not in ('head_start', 'live') then
    raise exception 'The round is not accepting positions.';
  end if;
  if submit_position.lat is null
     or submit_position.lng is null
     or submit_position.lat not between -90 and 90
     or submit_position.lng not between -180 and 180 then
    raise exception 'Position coordinates are invalid.';
  end if;

  v_accuracy := case
    when submit_position.accuracy is null or submit_position.accuracy < 0 then null
    else least(submit_position.accuracy, 100000)::real
  end;
  v_speed := case
    when submit_position.speed is null or submit_position.speed < 0 then null
    else least(submit_position.speed, 200)::real
  end;
  v_heading := case
    when submit_position.heading is null then null
    else least(greatest(submit_position.heading, 0), 360)::real
  end;

  fix_time := coalesce(submit_position.recorded_at, now());
  if fix_time > now() + interval '5 seconds' or fix_time < now() - interval '2 minutes' then
    fix_time := now();
  end if;

  fix_geog := extensions.st_setsrid(
    extensions.st_makepoint(submit_position.lng, submit_position.lat),
    4326
  )::extensions.geography;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_distance(fix_geog, current_game.area_center) <= v_radius;

  select out_of_bounds_since, noise, noise_alerted,
         smoothed_speed_mps, anchor_geog, anchor_since, updated_at,
         fast_since, vehicle_warned
    into v_prev_out, v_prev_noise, v_prev_alerted,
         v_prev_smoothed, v_prev_anchor, v_prev_anchor_since, v_prev_updated,
         v_prev_fast_since, v_prev_vehicle_warned
    from public.player_positions
    where player_id = me.id;

  if v_in_bounds then
    v_out_since := null;
  else
    v_out_since := coalesce(v_prev_out, fix_time);
  end if;

  v_dt := case
    when v_prev_updated is null then 1.0
    else greatest(0.5, least(10.0, extract(epoch from (now() - v_prev_updated))))
  end;

  -- Universal Speed Smoothing & Vehicle Safety Warning (Safety Guard)
  if v_speed is null then
    v_smoothed := coalesce(v_prev_smoothed, 0.0);
  elsif v_prev_smoothed is null then
    v_smoothed := v_speed;
  else
    v_smoothed := 0.75 * v_prev_smoothed + 0.25 * v_speed;
  end if;

  if v_smoothed >= 8.0 then
    v_fast_since := coalesce(v_prev_fast_since, fix_time);
    v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);
    if not v_vehicle_warned and v_fast_since is not null and greatest(now(), fix_time) - v_fast_since >= interval '10 seconds' then
      insert into public.events (game_id, type, audience, payload, target_player)
      values (
        current_game.id, 'vehicle_warning', 'all',
        jsonb_build_object(
          'player_id', me.id,
          'speed_mps', round(v_smoothed::numeric, 1),
          'message', 'Vehicle speed detected (>8 m/s for 10 s)'
        ),
        me.id
      );
      v_vehicle_warned := true;
    end if;
  else
    v_fast_since := null;
    v_vehicle_warned := false;
  end if;

  -- Noise modifier logic
  v_noise_on := ('noise_meter' = any(current_game.modifiers) or 'noise' = any(current_game.modifiers));
  if v_noise_on then
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
        where game_id = current_game.id;
      insert into public.pings (game_id, seq, geog, reason, visible_until)
      values (
        current_game.id,
        v_noise_seq,
        fix_geog,
        'noise_spike',
        now() + make_interval(secs => current_game.ping_visible_s)
      );
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'noise_spike',
        'hunter',
        jsonb_build_object('player_id', me.id, 'noise', v_noise)
      );
    elsif v_noise < 100 then
      v_alerted := false;
    end if;
  end if;

  -- Shrinking zone camping check
  if ('shrinking_zone' = any(current_game.modifiers) or 'zone' = any(current_game.modifiers))
     and current_game.status = 'live' then
    if v_prev_anchor is null then
      v_anchor := fix_geog;
      v_anchor_since := now();
    else
      if extensions.st_distance(fix_geog, v_prev_anchor) > 10 then
        v_anchor := fix_geog;
        v_anchor_since := now();
      else
        v_anchor := v_prev_anchor;
        v_anchor_since := coalesce(v_prev_anchor_since, now());
        if now() - v_anchor_since >= interval '45 seconds' then
          select coalesce(max(seq), 0) + 1 into v_camp_seq
            from public.pings
            where game_id = current_game.id;
          insert into public.pings (game_id, seq, geog, reason, visible_until)
          values (
            current_game.id,
            v_camp_seq,
            fix_geog,
            'camping_runner',
            now() + make_interval(secs => current_game.ping_visible_s)
          );
          insert into public.events (game_id, type, audience, payload)
          values (
            current_game.id,
            'camping_ping',
            'all',
            jsonb_build_object('player_id', me.id)
          );
          v_anchor_since := now();
        end if;
      end if;
    end if;
  end if;

  -- Mock location detection
  if coalesce(submit_position.is_mock, false) then
    if not exists (
      select 1 from public.events ev
      where ev.game_id = current_game.id
        and ev.type = 'mock_location_detected'
        and (ev.payload->>'player_id') = me.id::text
        and ev.created_at > now() - interval '60 seconds'
    ) then
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'mock_location_detected',
        'all',
        jsonb_build_object(
          'player_id', me.id,
          'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id),
          'message', 'Mock location detected from player'
        )
      );
    end if;
  end if;

  insert into public.player_positions (
    player_id, game_id, geog, accuracy_m, speed_mps, heading, is_mock,
    recorded_at, updated_at, out_of_bounds_since,
    noise, noise_alerted, smoothed_speed_mps, anchor_geog, anchor_since,
    fast_since, vehicle_warned
  ) values (
    me.id, current_game.id, fix_geog, v_accuracy, v_speed, v_heading,
    coalesce(submit_position.is_mock, false), fix_time, now(), v_out_since,
    v_noise, v_alerted, v_smoothed, v_anchor, v_anchor_since,
    v_fast_since, v_vehicle_warned
  )
  on conflict (player_id) do update set
    game_id = excluded.game_id,
    geog = excluded.geog,
    accuracy_m = excluded.accuracy_m,
    speed_mps = excluded.speed_mps,
    heading = excluded.heading,
    is_mock = excluded.is_mock,
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

  if not v_in_bounds and v_prev_out is null then
    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'boundary_warning',
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id)
      )
    );
  elsif v_in_bounds and v_prev_out is not null then
    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'boundary_cleared',
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id)
      )
    );
  end if;

  if current_game.status = 'live'
     and current_game.mode = 'classic_chase'
     and me.team = 'runner'
     and exists (
       select 1
       from public.targets t
       where t.game_id = current_game.id
         and extensions.st_dwithin(fix_geog, t.geog, current_game.target_radius_m)
     ) then
    perform public.end_game(current_game.id, 'runners', 'target_reached');
    select * into current_game from public.games g where g.id = current_game.id;
  end if;

  return jsonb_build_object(
    'phase', current_game.status,
    'server_time', now(),
    'live_at', current_game.live_at,
    'ends_at', current_game.ends_at,
    'next_ping_at', current_game.next_ping_at,
    'in_bounds', v_in_bounds,
    'effective_radius_m', v_radius,
    'my_status', me.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason,
    'noise', v_noise,
    'smoothed_speed_mps', round(v_smoothed::numeric, 2),
    'fast_since', v_fast_since,
    'vehicle_warned', v_vehicle_warned
  );
end;
$$;

revoke all on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) from public, anon;
grant execute on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) to authenticated;

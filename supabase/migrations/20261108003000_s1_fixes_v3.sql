-- Milestone S1 fixes v3:
-- 1. In submit_position, evaluate vehicle speed duration using greatest(now(), fix_time) - v_fast_since >= interval '10 seconds'
-- 2. In advance_game, make 40m sighting check independent of 12m haunt tag check so assist sighting pings fire for all runners <= 40m

-- 1. Update submit_position
create or replace function public.submit_position(
  game_id uuid,
  lat double precision,
  lng double precision,
  accuracy double precision default null,
  speed double precision default null,
  heading double precision default null,
  is_mock boolean default false,
  recorded_at timestamptz default null
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
  v_radius double precision;
  v_in_bounds boolean;
  v_accuracy real;
  v_speed real;
  v_heading real;
  v_prev_out timestamptz;
  v_out_since timestamptz;
  v_penalty_seq integer;
  v_noise_on boolean;
  v_dt double precision;
  v_prev_smoothed real;
  v_prev_noise integer;
  v_prev_alerted boolean;
  v_prev_anchor extensions.geography;
  v_prev_anchor_since timestamptz;
  v_prev_updated timestamptz;
  v_prev_fast_since timestamptz;
  v_prev_vehicle_warned boolean;
  v_smoothed real;
  v_noise integer;
  v_alerted boolean;
  v_anchor extensions.geography;
  v_anchor_since timestamptz;
  v_fast_since timestamptz;
  v_vehicle_warned boolean;
  v_noise_seq integer;
  v_camp_seq integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if submit_position.game_id is null then raise exception 'Game not found.'; end if;

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
  v_noise_on := 'noise' = any(current_game.modifiers);
  if v_noise_on then
    if v_smoothed >= 8 then
      v_noise := round(coalesce(v_prev_noise, 0) + 8 * v_dt)::integer;
    else
      v_noise := case
        when v_smoothed >= 4 then round(coalesce(v_prev_noise, 0) + 5 * v_dt)
        when v_smoothed >= 2.8 then round(coalesce(v_prev_noise, 0) + 2 * v_dt)
        when v_smoothed >= 1.6 then round(coalesce(v_prev_noise, 0) - 1.0 * v_dt)
        else round(coalesce(v_prev_noise, 0) - 2.5 * v_dt)
      end::integer;
    end if;
    v_noise := least(100, greatest(0, v_noise));

    if v_prev_anchor is null
       or extensions.st_distance(fix_geog, v_prev_anchor) > 15 then
      v_anchor := fix_geog;
      v_anchor_since := fix_time;
    else
      v_anchor := v_prev_anchor;
      v_anchor_since := coalesce(v_prev_anchor_since, fix_time);
      if now() - v_anchor_since >= interval '240 seconds' then
        update public.games g
          set ping_seq = g.ping_seq + 1
          where g.id = current_game.id
          returning g.ping_seq into v_camp_seq;

        insert into public.pings (
          game_id, seq, player_id, geog, accuracy_m, position_age_s, reason
        ) values (
          current_game.id, v_camp_seq, me.id, fix_geog, v_accuracy,
          greatest(0, floor(extract(epoch from (now() - fix_time)))::integer),
          'camping'
        );

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'camping_ping', 'all',
          jsonb_build_object('player_id', me.id, 'seq', v_camp_seq)
        );

        v_anchor_since := now();
      end if;
    end if;

    v_alerted := case when v_noise < 50 then false else coalesce(v_prev_alerted, false) end;

    if v_noise >= 60 and not v_alerted then
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'noise_spark', 'hunter',
        jsonb_build_object('player_id', me.id)
      );
      v_alerted := true;
    end if;

    if v_noise >= 100 then
      update public.games g
        set ping_seq = g.ping_seq + 1
        where g.id = current_game.id
        returning g.ping_seq into v_noise_seq;

      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason
      ) values (
        current_game.id, v_noise_seq, me.id, fix_geog, v_accuracy,
        greatest(0, floor(extract(epoch from (now() - fix_time)))::integer),
        'noise'
      );

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'noise_ping', 'all',
        jsonb_build_object('player_id', me.id, 'seq', v_noise_seq)
      );

      v_noise := 40;
      v_alerted := false;
    end if;
  else
    v_noise := 0;
    v_alerted := false;
    v_anchor := null;
    v_anchor_since := null;
  end if;

  -- Mock Location Detection (Safety Guard)
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
  end if;

  if not v_in_bounds
     and current_game.boundary_penalty = 'extra_ping'
     and me.team = 'runner'
     and v_out_since is not null
     and now() >= v_out_since + make_interval(secs => current_game.boundary_grace_s)
     and not exists (
       select 1
       from public.events e
       where e.game_id = current_game.id
         and e.type = 'boundary_penalty'
         and e.payload->>'player_id' = me.id::text
         and e.created_at > v_out_since
     ) then
    update public.games g
      set ping_seq = g.ping_seq + 1
      where g.id = current_game.id
      returning g.ping_seq into v_penalty_seq;

    insert into public.pings (
      game_id, seq, player_id, geog, accuracy_m, position_age_s, reason
    ) values (
      current_game.id,
      v_penalty_seq,
      me.id,
      fix_geog,
      v_accuracy,
      greatest(0, floor(extract(epoch from (now() - fix_time)))::integer),
      'boundary'
    );

    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'boundary_penalty',
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'seq', v_penalty_seq,
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
    'smoothed_speed_mps', round(v_smoothed::numeric, 2)
  );
end;
$$;

-- 2. Update advance_game
create or replace function public.advance_game(game_id uuid)
returns public.game_status
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  next_ping timestamptz;
  ping_count integer := 0;
  runner record;
  ping_geog extensions.geography;
  shift_m double precision;
  bearing double precision;
  dist_from_center double precision;
  zone_on boolean;
  stages numeric[];
  stage_count integer;
  stage_index integer;
  progress double precision;
  next_stage integer;
  next_start timestamptz;
  ghost_rec record;
  patrol_geom geometry;
  path_len_m double precision;
  duration_s int;
  effective_duration_s int;
  elapsed_s float;
  loop_frac float;
  current_ghost_pt geometry;
  runner_fix record;
  active_runners_count int;
  v_dwells jsonb;
  v_first_seen timestamptz;
begin
  -- Allow internal background jobs (caller_id is null) or game members
  if caller_id is not null and not public.is_member(advance_game.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into current_game from public.games g
    where g.id = advance_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status = 'countdown'
     and current_game.head_start_at is not null
     and now() >= current_game.head_start_at then
    update public.games g set status = 'head_start'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type) values (current_game.id, 'head_start_began');
  end if;

  if current_game.status = 'head_start'
     and current_game.live_at is not null
     and now() >= current_game.live_at then
    update public.games g set status = 'live'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type) values (current_game.id, 'live_began');

    if 'dead_drops' = any(current_game.modifiers)
       and not exists (
         select 1 from public.entities e
         where e.game_id = current_game.id and e.kind = 'drop'
       ) then
      perform public.spawn_drops(current_game.id, null);
    end if;

    if current_game.mode_id in ('haunted_map', 'ghost_duel')
       and not exists (
         select 1 from public.entities e
         where e.game_id = current_game.id and e.kind = 'ghost'
       ) then
      perform public.spawn_ghost_npcs(current_game.id);
    end if;
  end if;

  -- Shrinking Zone: advance stage and announce 60 s before
  if current_game.status = 'live'
     and 'shrinking_zone' = any(current_game.modifiers)
     and current_game.live_at is not null
     and current_game.duration_s > 0 then
    zone_on := true;
    stages := public.zone_stage_values(current_game.id);
    stage_count := array_length(stages, 1);
    progress := greatest(
      0,
      least(1, extract(epoch from (now() - current_game.live_at)) / current_game.duration_s)
    );
    stage_index := public.zone_stage_at(current_game.id, progress);

    if current_game.zone_stage = 0 then
      update public.games g set zone_stage = 1 where g.id = current_game.id
        returning * into current_game;
    elsif stage_index > current_game.zone_stage then
      update public.games g set zone_stage = stage_index where g.id = current_game.id
        returning * into current_game;
      insert into public.events (game_id, type, payload)
      values (
        current_game.id, 'zone_shrunk',
        jsonb_build_object(
          'stage', stage_index,
          'stages', stage_count,
          'percent', stages[stage_index],
          'radius_m', round(current_game.area_radius_m * stages[stage_index] / 100.0)
        )
      );
    end if;

    next_stage := current_game.zone_stage + 1;
    if next_stage <= stage_count and current_game.zone_announced < next_stage then
      next_start := current_game.live_at
        + make_interval(secs => (
            current_game.duration_s * (
              2.0 / 3.0 + (next_stage - 2) * (1.0 / 3.0) / (stage_count - 1)
            )
          )::double precision);
      if now() >= next_start - interval '60 seconds' then
        update public.games g set zone_announced = next_stage where g.id = current_game.id
          returning * into current_game;
        insert into public.events (game_id, type, payload)
        values (
          current_game.id, 'zone_shrink_soon',
          jsonb_build_object(
            'stage', next_stage,
            'stages', stage_count,
            'percent', stages[next_stage],
            'radius_m', round(current_game.area_radius_m * stages[next_stage] / 100.0),
            'at', next_start
          )
        );
      end if;
    end if;
  end if;

  -- Ghost NPC simulation loop for Haunted Map & Ghost Duel
  if current_game.status = 'live' and current_game.mode_id in ('haunted_map', 'ghost_duel') then
    for ghost_rec in
      select * from public.entities e where e.game_id = current_game.id and e.kind = 'ghost'
    loop
      if (ghost_rec.state->>'path_wkt') is not null or (ghost_rec.state->>'path_geojson') is not null then
        if (ghost_rec.state->>'path_wkt') is not null then
          patrol_geom := extensions.st_geomfromtext(ghost_rec.state->>'path_wkt', 4326);
        else
          patrol_geom := extensions.st_geomfromgeojson(ghost_rec.state->>'path_geojson');
        end if;

        duration_s := greatest(30, coalesce((ghost_rec.state->>'duration_s')::int, 240));
        -- Fairness: clamp ghost velocity to <= 2.0 m/s along its patrol line
        path_len_m := coalesce(extensions.st_length(patrol_geom::geography), 0.0);
        effective_duration_s := greatest(duration_s, ceil(path_len_m / 2.0)::int);

        elapsed_s := extract(epoch from (now() - (ghost_rec.state->>'t0')::timestamptz));
        loop_frac := greatest(0.0, least(1.0, (mod(elapsed_s::numeric, effective_duration_s::numeric) / effective_duration_s::numeric)::float));

        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        -- Keep ghosts inside play boundary
        if current_game.area_center is not null and current_game.area_radius_m is not null then
          if extensions.st_distance(current_ghost_pt::geography, current_game.area_center) > current_game.area_radius_m then
            current_ghost_pt := extensions.st_project(
              current_game.area_center,
              greatest(5.0, current_game.area_radius_m - 10.0),
              extensions.st_azimuth(current_game.area_center::geometry, current_ghost_pt)
            )::geometry;
          end if;
        end if;

        v_dwells := coalesce(ghost_rec.state->'dwells', '{}'::jsonb);

        -- Evaluate active runners: ignore fixes with accuracy_m > 30.0 (fairness)
        for runner_fix in
          select p.id as runner_id, p.user_id, pr.display_name as runner_name, pp.geog as runner_geog,
                 pp.accuracy_m,
                 extensions.st_distance(current_ghost_pt::geography, pp.geog) as dist_m
          from public.players p
          join public.player_positions pp on pp.player_id = p.id
          left join public.profiles pr on pr.id = p.user_id
          where p.game_id = current_game.id
            and p.team = 'runner'
            and p.status = 'active'
            and pp.recorded_at > now() - interval '30 seconds'
            and coalesce(pp.accuracy_m, 999.0) <= 30.0
        loop
          -- 1. Sighting Interaction (within 40 m)
          if runner_fix.dist_m <= 40.0 then
            if current_game.ghost_mode = 'assist' then
              -- Assist Mode (D3): emit sighting pings to hunters
              if not exists (
                select 1 from public.pings pi
                where pi.game_id = current_game.id
                  and pi.player_id = runner_fix.runner_id
                  and pi.reason = 'ghost_sighting'
                  and pi.released_at > now() - interval '20 seconds'
              ) then
                insert into public.pings (
                  game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
                ) values (
                  current_game.id,
                  current_game.ping_seq,
                  runner_fix.runner_id,
                  current_ghost_pt::geography,
                  coalesce(runner_fix.accuracy_m, 15.0),
                  greatest(0, floor(extract(epoch from (now() - runner_fix.recorded_at)))::integer),
                  'ghost_sighting',
                  now()
                );

                insert into public.events (game_id, type, audience, payload)
                values (
                  current_game.id,
                  'ghost_sighting',
                  'hunter',
                  jsonb_build_object(
                    'ghost_index', ghost_rec.state->>'ghost_index',
                    'runner_id', runner_fix.runner_id,
                    'approx_lat', round(extensions.st_y(current_ghost_pt)::numeric, 5),
                    'approx_lng', round(extensions.st_x(current_ghost_pt)::numeric, 5),
                    'message', 'Ghost assisted hunters with a sighting ping!'
                  )
                );
              end if;
            else
              -- Haunt Mode: advisory event only
              if not exists (
                select 1 from public.events ev
                where ev.game_id = current_game.id
                  and ev.type = 'ghost_sighting'
                  and (ev.payload->>'runner_id') = runner_fix.runner_id::text
                  and ev.created_at > now() - interval '20 seconds'
              ) then
                insert into public.events (game_id, type, audience, payload)
                values (
                  current_game.id,
                  'ghost_sighting',
                  'hunter',
                  jsonb_build_object(
                    'ghost_index', ghost_rec.state->>'ghost_index',
                    'runner_id', runner_fix.runner_id,
                    'approx_lat', round(extensions.st_y(current_ghost_pt)::numeric, 5),
                    'approx_lng', round(extensions.st_x(current_ghost_pt)::numeric, 5),
                    'message', 'A ghost sighted a runner!'
                  )
                );
              end if;
            end if;
          end if;

          -- 2. Proximity Tag Interaction (within 12 m with 3-second continuous dwell)
          if runner_fix.dist_m <= 12.0 then
            -- 3-second continuous dwell gating
            if not (v_dwells ? runner_fix.runner_id::text) then
              v_dwells := jsonb_set(v_dwells, array[runner_fix.runner_id::text], to_jsonb(now()));
            else
              v_first_seen := (v_dwells->>runner_fix.runner_id::text)::timestamptz;
              if now() >= v_first_seen + interval '3 seconds' then
                v_dwells := v_dwells - runner_fix.runner_id::text;

                update public.players
                set status = 'tagged', tagged_at = now()
                where id = runner_fix.runner_id;

                insert into public.events (game_id, type, audience, payload)
                values (
                  current_game.id,
                  'runner_tagged',
                  'all',
                  jsonb_build_object(
                    'runner_id', runner_fix.runner_id,
                    'runner_name', runner_fix.runner_name,
                    'by', 'ghost',
                    'reason', 'haunted',
                    'tagged_at', now()
                  )
                );

                select count(*) into active_runners_count
                from public.players pl
                where pl.game_id = current_game.id and pl.team = 'runner' and pl.status = 'active';

                if active_runners_count = 0 then
                  perform public.end_game(current_game.id, 'hunters', 'all_tagged');
                  select * into current_game from public.games g where g.id = advance_game.game_id;
                  return current_game.status;
                end if;
              end if;
            end if;

          else
            -- Outside 12 m: clear dwell timer
            if v_dwells ? runner_fix.runner_id::text then
              v_dwells := v_dwells - runner_fix.runner_id::text;
            end if;
          end if;
        end loop;

        update public.entities
        set geog = current_ghost_pt::geography,
            state = jsonb_set(
              jsonb_set(
                jsonb_set(ghost_rec.state, '{current_lat}', to_jsonb(extensions.st_y(current_ghost_pt))),
                '{current_lng}', to_jsonb(extensions.st_x(current_ghost_pt))
              ),
              '{dwells}', v_dwells
            ),
            updated_at = now()
        where id = ghost_rec.id;
      end if;
    end loop;
  end if;

  if current_game.status = 'live'
     and current_game.next_ping_at is not null
     and now() >= current_game.next_ping_at then
    next_ping := current_game.next_ping_at
      + make_interval(secs => current_game.ping_interval_s);
    if next_ping <= now() then
      next_ping := now() + make_interval(secs => current_game.ping_interval_s);
    end if;

    update public.games g
      set ping_seq = g.ping_seq + 1,
          next_ping_at = next_ping
      where g.id = current_game.id
      returning * into current_game;

    for runner in
      select p.id, p.status_detail, pp.geog, pp.accuracy_m, pp.recorded_at
      from public.players p
      join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id
        and p.status = 'active'
        and p.team = 'runner'
    loop
      if runner.status_detail ? 'veil' then
        update public.players p
          set status_detail = p.status_detail - 'veil'
          where p.id = runner.id;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'veil_used', 'runner',
          jsonb_build_object('player_id', runner.id)
        );
        continue;
      end if;

      ping_geog := runner.geog;
      if (runner.status_detail ? 'decoy') or (runner.status_detail ? 'scramble') then
        shift_m := 150 + random() * 100;
        ping_geog := extensions.st_project(runner.geog, shift_m, radians(random() * 360));

        dist_from_center := extensions.st_distance(ping_geog, current_game.area_center);
        if dist_from_center > current_game.area_radius_m - 10 then
          bearing := extensions.st_azimuth(
            current_game.area_center::extensions.geometry,
            ping_geog::extensions.geometry
          );
          ping_geog := extensions.st_project(
            current_game.area_center,
            greatest(10, current_game.area_radius_m - 10),
            bearing
          );
        end if;

        if runner.status_detail ? 'scramble' then
          update public.players p
            set status_detail = p.status_detail - 'scramble'
            where p.id = runner.id;
        end if;

        if runner.status_detail ? 'decoy' then
          update public.players p
            set status_detail = p.status_detail - 'decoy'
            where p.id = runner.id;
          insert into public.events (game_id, type, audience, payload)
          values (
            current_game.id, 'decoy_used', 'runner',
            jsonb_build_object('player_id', runner.id)
          );
        end if;
      end if;

      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
      ) values (
        current_game.id,
        current_game.ping_seq,
        runner.id,
        ping_geog,
        runner.accuracy_m,
        greatest(0, floor(extract(epoch from (now() - runner.recorded_at)))::integer),
        'scheduled',
        now()
      );
      ping_count := ping_count + 1;
    end loop;

    if ping_count > 0 then
      insert into public.events (game_id, type, payload)
      values (
        current_game.id,
        'ping_released',
        jsonb_build_object(
          'seq', current_game.ping_seq,
          'count', ping_count,
          'released_at', now()
        )
      );
    end if;
  end if;

  if current_game.status in ('countdown', 'head_start', 'live')
     and current_game.ends_at is not null
     and now() >= current_game.ends_at then
    if current_game.mode = 'classic_chase' then
      perform public.end_game(current_game.id, 'hunters', 'time_expired');
    else
      perform public.end_game(current_game.id, 'runners', 'time_expired');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  return current_game.status;
end;
$$;

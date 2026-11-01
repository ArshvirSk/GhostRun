-- V2-M7 fix: Correct column reference from area_radius to area_radius_m

-- 1. contribute_ghost ---------------------------------------------------------
create or replace function public.contribute_ghost(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  p_id uuid;
  target_game record;
  full_line geometry;
  total_len real;
  start_frac real;
  end_frac real;
  trimmed_geom geometry;
  simplified_geom geometry;
  trimmed_path geography;
  duration int;
  pt_count int;
  new_ghost_id uuid;
  trimmed_len real;
begin
  if caller_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into target_game
  from public.games g
  where g.id = contribute_ghost.game_id;

  if target_game.id is null or target_game.status <> 'ended' then
    raise exception 'Game has not ended or does not exist.';
  end if;

  select p.id into p_id
  from public.players p
  where p.game_id = contribute_ghost.game_id and p.user_id = caller_id;

  if p_id is null then
    raise exception 'Caller is not a player in this game.';
  end if;

  select
    extensions.st_makeline(tp.geog::geometry order by tp.recorded_at asc),
    extract(epoch from (max(tp.recorded_at) - min(tp.recorded_at)))::int,
    count(*)
  into full_line, duration, pt_count
  from public.trail_points tp
  where tp.game_id = contribute_ghost.game_id and tp.player_id = p_id;

  if full_line is null or pt_count < 5 then
    raise exception 'Trail has insufficient points to contribute.';
  end if;

  total_len := extensions.st_length(full_line::geography);

  if total_len < 600.0 then
    raise exception 'Trail is too short (%m). Minimum 600m required for privacy trimming.', round(total_len);
  end if;

  start_frac := 150.0 / total_len;
  end_frac := (total_len - 150.0) / total_len;

  trimmed_geom := extensions.st_linesubstring(full_line, start_frac, end_frac);
  simplified_geom := extensions.st_simplify(trimmed_geom, 0.00008);
  trimmed_path := simplified_geom::geography;
  trimmed_len := extensions.st_length(trimmed_path);

  if trimmed_len < 300.0 then
    raise exception 'Trimmed route is under 300m (%m).', round(trimmed_len);
  end if;

  insert into public.ghost_library (
    area_center,
    area_radius,
    path,
    duration_s
  ) values (
    target_game.area_center,
    target_game.area_radius_m,
    trimmed_path,
    duration
  ) returning id into new_ghost_id;

  insert into public.ghost_contributions (
    ghost_id,
    user_id
  ) values (
    new_ghost_id,
    caller_id
  );

  insert into public.consents (user_id, consent_type, granted)
    values (caller_id, 'ghost', true);

  return jsonb_build_object(
    'success', true,
    'ghost_id', new_ghost_id,
    'trimmed_length_m', round(trimmed_len::numeric, 1),
    'duration_s', duration
  );
end;
$$;

-- 2. spawn_ghost_npcs ---------------------------------------------------------
create or replace function public.spawn_ghost_npcs(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  g record;
  ghost_rec record;
  patrol_geom geometry;
  spawn_count int := 0;
  target_count int := 2;
  ghost_idx int := 1;
begin
  select * into g from public.games where id = p_game_id;
  if g.id is null then return; end if;

  if (g.mode_params->'haunted_map'->>'ghost_count') is not null then
    target_count := greatest(1, least(4, (g.mode_params->'haunted_map'->>'ghost_count')::int));
  end if;

  delete from public.entities where game_id = p_game_id and kind = 'ghost';

  for ghost_rec in
    select gl.id, gl.path, gl.duration_s
    from public.ghost_library gl
    where extensions.st_dwithin(gl.area_center, g.area_center, g.area_radius_m + 500)
    order by extensions.st_distance(gl.area_center, g.area_center) asc
    limit target_count
  loop
    patrol_geom := ghost_rec.path::geometry;
    insert into public.entities (
      game_id,
      kind,
      team,
      geog,
      state,
      visible_to
    ) values (
      p_game_id,
      'ghost',
      'hunter',
      extensions.st_startpoint(patrol_geom)::geography,
      jsonb_build_object(
        'ghost_index', ghost_idx,
        'path_id', ghost_rec.id,
        'path_geojson', extensions.st_asgeojson(patrol_geom)::jsonb,
        'total_length_m', extensions.st_length(ghost_rec.path),
        'duration_s', ghost_rec.duration_s,
        'speed_mps', 1.3,
        't0', now()
      ),
      'none'
    );
    spawn_count := spawn_count + 1;
    ghost_idx := ghost_idx + 1;
  end loop;

  while spawn_count < target_count loop
    patrol_geom := public.generate_synthetic_patrol_path(g.area_center, g.area_radius_m, (spawn_count * 60.0)::float);
    insert into public.entities (
      game_id,
      kind,
      team,
      geog,
      state,
      visible_to
    ) values (
      p_game_id,
      'ghost',
      'hunter',
      extensions.st_startpoint(patrol_geom)::geography,
      jsonb_build_object(
        'ghost_index', ghost_idx,
        'path_id', null,
        'path_geojson', extensions.st_asgeojson(patrol_geom)::jsonb,
        'total_length_m', extensions.st_length(patrol_geom::geography),
        'duration_s', 240,
        'speed_mps', 1.3,
        't0', now()
      ),
      'none'
    );
    spawn_count := spawn_count + 1;
    ghost_idx := ghost_idx + 1;
  end loop;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'ghosts_spawned',
    'all',
    jsonb_build_object('count', spawn_count, 'message', spawn_count || ' ghosts are haunting the map.')
  );
end;
$$;

-- 3. start_game ---------------------------------------------------------------
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
  hunter_heat_charges integer := 0;
  chosen_agent_id uuid;
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

      update public.players
      set secret_role = 'agent',
          status_detail = jsonb_build_object('scramble_available', true, 'whisper_available', true)
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

  update public.games
    set status = 'countdown',
        started_at = clock_timestamp(),
        head_start_at = countdown_ends,
        live_at = live_starts,
        ends_at = live_starts + make_interval(secs => current_game.duration_s),
        next_ping_at = live_starts + make_interval(secs => current_game.ping_interval_s),
        effective_radius_m = current_game.area_radius_m,
        current_zone_stage = 1
    where id = start_game.game_id;

  if current_game.mode_id in ('haunted_map', 'ghost_duel') then
    perform public.spawn_ghost_npcs(current_game.id);
  end if;

  if 'dead_drops' = any(current_game.modifiers) then
    perform public.spawn_dead_drops(start_game.game_id);
  end if;

  if 'hot_cold' = any(current_game.modifiers) or current_game.mode_id = 'hot_cold' then
    hunter_heat_charges := 6;
  end if;

  insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
  values
    (current_game.id, 'runner', 0, clock_timestamp()),
    (current_game.id, 'hunter', hunter_heat_charges, clock_timestamp())
  on conflict (game_id, team) do update set
    heat_charges = excluded.heat_charges,
    heat_updated_at = excluded.heat_updated_at;

  insert into public.events (game_id, type, payload)
    values (start_game.game_id, 'game_started', jsonb_build_object('countdown_s', 10));

  return jsonb_build_object(
    'status', 'countdown',
    'head_start_at', countdown_ends,
    'live_at', live_starts
  );
end;
$$;

-- 4. advance_game -------------------------------------------------------------
create or replace function public.advance_game(game_id uuid)
returns public.game_status
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_game record;
  server_time timestamptz := clock_timestamp();
  new_status public.game_status;
  last_live_ping timestamptz;
  target_fix record;
  interval_s integer;
  penalty_ping boolean := false;
  zone_stage integer := 1;
  remaining_s integer;
  phase_length_s integer;
  shrunk_radius integer;
  warn_cutoff integer;
  active_runners_count int;
  active_hunters_count int;
  scrambled_runner uuid;
  scramble_offset_deg float;
  scramble_dist_m float;
  scramble_angle float;
  ghost_rec record;
  elapsed_s float;
  duration_s int;
  loop_frac float;
  patrol_geom geometry;
  current_ghost_pt geometry;
  runner_fix record;
begin
  select * into current_game
  from public.games g
  where g.id = advance_game.game_id
  for update;

  if not found then
    raise exception 'Game % not found.', advance_game.game_id;
  end if;

  new_status := current_game.status;

  if current_game.status = 'countdown' and server_time >= current_game.head_start_at then
    if current_game.live_at > current_game.head_start_at then
      new_status := 'head_start';
      update public.games set status = 'head_start' where id = current_game.id;
      insert into public.events (game_id, type, payload)
        values (current_game.id, 'phase_changed', jsonb_build_object('phase', 'head_start'));
    else
      new_status := 'live';
      update public.games set status = 'live' where id = current_game.id;
      insert into public.events (game_id, type, payload)
        values (current_game.id, 'phase_changed', jsonb_build_object('phase', 'live'));
    end if;
  end if;

  if new_status = 'head_start' and server_time >= current_game.live_at then
    new_status := 'live';
    update public.games set status = 'live' where id = current_game.id;
    insert into public.events (game_id, type, payload)
      values (current_game.id, 'phase_changed', jsonb_build_object('phase', 'live'));

    if current_game.mode_id in ('haunted_map', 'ghost_duel') then
      perform public.spawn_ghost_npcs(current_game.id);
    end if;
  end if;

  if new_status = 'live' and server_time >= current_game.ends_at then
    new_status := 'ended';
    update public.games
    set status = 'ended',
        winner = case when current_game.mode_id = 'classic_chase' then 'hunters' else 'runners' end,
        end_reason = 'time_expired',
        ended_at = server_time
    where id = current_game.id;
    insert into public.events (game_id, type, payload)
      values (current_game.id, 'game_ended',
        jsonb_build_object(
          'winner', case when current_game.mode_id = 'classic_chase' then 'hunters' else 'runners' end,
          'reason', 'time_expired'
        ));
    return new_status;
  end if;

  if new_status = 'live' and current_game.mode_id in ('haunted_map', 'ghost_duel') then
    for ghost_rec in
      select * from public.entities where game_id = current_game.id and kind = 'ghost'
    loop
      if (ghost_rec.state->>'path_geojson') is not null then
        patrol_geom := (ghost_rec.state->>'path_geojson')::geometry;
        duration_s := greatest(30, coalesce((ghost_rec.state->>'duration_s')::int, 240));
        elapsed_s := extract(epoch from (server_time - (ghost_rec.state->>'t0')::timestamptz));
        loop_frac := (elapsed_s % duration_s) / duration_s;

        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        update public.entities
        set geog = current_ghost_pt::geography,
            updated_at = server_time
        where id = ghost_rec.id;

        for runner_fix in
          select p.id as runner_id, p.user_id, pr.name as runner_name, pp.geog as runner_geog,
                 extensions.st_distance(current_ghost_pt::geography, pp.geog) as dist_m
          from public.players p
          join public.player_positions pp on pp.player_id = p.id
          left join public.profiles pr on pr.id = p.user_id
          where p.game_id = current_game.id
            and p.team = 'runner'
            and p.status = 'active'
            and pp.recorded_at > server_time - interval '30 seconds'
        loop
          if runner_fix.dist_m <= 12.0 then
            update public.players
            set status = 'tagged', tagged_at = server_time
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
                'tagged_at', server_time
              )
            );

            select count(*) into active_runners_count
            from public.players
            where game_id = current_game.id and team = 'runner' and status = 'active';

            if active_runners_count = 0 then
              new_status := 'ended';
              update public.games
              set status = 'ended', winner = 'hunters', end_reason = 'all_tagged', ended_at = server_time
              where id = current_game.id;
              insert into public.events (game_id, type, payload)
              values (current_game.id, 'game_ended', jsonb_build_object('winner', 'hunters', 'reason', 'all_tagged'));
              return new_status;
            end if;

          elsif runner_fix.dist_m <= 40.0 then
            if not exists (
              select 1 from public.events
              where game_id = current_game.id
                and type = 'ghost_sighting'
                and (payload->>'runner_id') = runner_fix.runner_id::text
                and created_at > server_time - interval '20 seconds'
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
        end loop;
      end if;
    end loop;
  end if;

  if new_status = 'live' and (current_game.modifiers @> array['shrinking_zone']::text[]) then
    remaining_s := greatest(0, extract(epoch from (current_game.ends_at - server_time))::integer);
    phase_length_s := (current_game.duration_s / 3)::integer;

    if remaining_s <= (phase_length_s / 2) then
      zone_stage := 3;
    elsif remaining_s <= phase_length_s then
      zone_stage := 2;
    else
      zone_stage := 1;
    end if;

    shrunk_radius := case zone_stage
      when 1 then current_game.area_radius_m
      when 2 then (current_game.area_radius_m * 0.70)::integer
      when 3 then (current_game.area_radius_m * 0.45)::integer
    end;

    if current_game.current_zone_stage < zone_stage then
      update public.games
      set current_zone_stage = zone_stage,
          effective_radius_m = shrunk_radius
      where id = current_game.id;

      insert into public.events (game_id, type, payload)
      values (
        current_game.id,
        'zone_shrunk',
        jsonb_build_object(
          'stage', zone_stage,
          'radius_m', shrunk_radius
        )
      );
    end if;
  end if;

  if new_status = 'live' and server_time >= current_game.next_ping_at then
    interval_s := current_game.ping_interval_s;

    select player_id into scrambled_runner
    from public.player_resources
    where game_id = current_game.id
      and resources ? 'scramble_armed'
    limit 1;

    if scrambled_runner is not null then
      update public.player_resources
      set resources = resources - 'scramble_armed'
      where game_id = current_game.id and player_id = scrambled_runner;

      scramble_dist_m := 150.0 + (random() * 100.0);
      scramble_angle := random() * 2 * pi();
    end if;

    insert into public.pings (game_id, runner_id, geog, position_age_s, released_at)
    select
      current_game.id,
      p.id,
      case
        when p.id = scrambled_runner then
          extensions.st_project(pp.geog, scramble_dist_m, scramble_angle)
        else
          pp.geog
      end,
      greatest(0, extract(epoch from (server_time - pp.recorded_at)))::integer,
      server_time
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = current_game.id
      and p.team = 'runner'
      and p.status = 'active'
      and pp.geog is not null;

    update public.games
    set next_ping_at = server_time + (interval_s || ' seconds')::interval
    where id = current_game.id;

    insert into public.events (game_id, type, payload)
    values (
      current_game.id,
      'ping_released',
      jsonb_build_object(
        'next_ping_at', server_time + (interval_s || ' seconds')::interval,
        'interval_s', interval_s
      )
    );
  end if;

  return new_status;
end;
$$;

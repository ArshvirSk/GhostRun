-- V2-M7 fix: Correct ghost patrol geometry parsing and display_name reference

-- 1. spawn_ghost_npcs ---------------------------------------------------------
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
        'path_wkt', extensions.st_astext(patrol_geom),
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
        'path_wkt', extensions.st_astext(patrol_geom),
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

-- 2. advance_game -------------------------------------------------------------
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
  duration_s int;
  elapsed_s float;
  loop_frac float;
  current_ghost_pt geometry;
  runner_fix record;
  active_runners_count int;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(advance_game.game_id) then
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
      select * from public.entities where game_id = current_game.id and kind = 'ghost'
    loop
      if (ghost_rec.state->>'path_wkt') is not null or (ghost_rec.state->>'path_geojson') is not null then
        if (ghost_rec.state->>'path_wkt') is not null then
          patrol_geom := extensions.st_geomfromtext(ghost_rec.state->>'path_wkt', 4326);
        else
          patrol_geom := extensions.st_geomfromgeojson(ghost_rec.state->>'path_geojson');
        end if;

        duration_s := greatest(30, coalesce((ghost_rec.state->>'duration_s')::int, 240));
        elapsed_s := extract(epoch from (now() - (ghost_rec.state->>'t0')::timestamptz));
        loop_frac := (elapsed_s % duration_s) / duration_s;

        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        update public.entities
        set geog = current_ghost_pt::geography,
            updated_at = now()
        where id = ghost_rec.id;

        for runner_fix in
          select p.id as runner_id, p.user_id, pr.display_name as runner_name, pp.geog as runner_geog,
                 extensions.st_distance(current_ghost_pt::geography, pp.geog) as dist_m
          from public.players p
          join public.player_positions pp on pp.player_id = p.id
          left join public.profiles pr on pr.id = p.user_id
          where p.game_id = current_game.id
            and p.team = 'runner'
            and p.status = 'active'
            and pp.recorded_at > now() - interval '30 seconds'
        loop
          if runner_fix.dist_m <= 12.0 then
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
            from public.players
            where game_id = current_game.id and team = 'runner' and status = 'active';

            if active_runners_count = 0 then
              perform public.end_game(current_game.id, 'all_tagged', 'hunter');
              select * into current_game from public.games g where g.id = advance_game.game_id;
              return current_game.status;
            end if;

          elsif runner_fix.dist_m <= 40.0 then
            if not exists (
              select 1 from public.events
              where game_id = current_game.id
                and type = 'ghost_sighting'
                and (payload->>'runner_id') = runner_fix.runner_id::text
                and created_at > now() - interval '20 seconds'
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
      perform public.end_game(current_game.id, 'time_expired', 'hunter');
    else
      perform public.end_game(current_game.id, 'time_expired', 'runner');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  return current_game.status;
end;
$$;

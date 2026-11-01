-- V2-M7 (v2.2): Server-Authoritative NPC Simulation Engine & Haunted Map
--
-- MODES.md §6.1:
-- - Haunted Map: 1-3 ghost hunters patrol paths from ghost_library (or synthetic loops).
-- - Ghosts join the hunter team as server-controlled NPCs (entities kind='ghost').
-- - Simulation advances during advance_game: interpolates position along path by time.
-- - Ghost sighting: runner within 40m triggers ghost_sighting ping for hunters.
-- - Haunted tag: runner within 12m is tagged out with reason 'haunted'.
-- - Runners see faint ghost blips within 80m via nearby_entities. Hunters never see raw ghost coordinates.

-- 1. App Settings feature flags -----------------------------------------------

insert into public.app_settings (key, value) values
  ('feature.mode.haunted_map', 'true'::jsonb),
  ('feature.mode.ghost_duel', 'true'::jsonb)
on conflict (key) do update set value = excluded.value;

-- 2. Update Mode Catalogue ----------------------------------------------------

create or replace function public.mode_catalogue()
returns jsonb
language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', 'classic_chase', 'layer', 'base', 'name', 'Classic Chase',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('double_agent', 'vip', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'tag_hunt', 'layer', 'base', 'name', 'Tag Hunt',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'haunted_map', 'layer', 'base', 'name', 'Haunted Map',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 1,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object('ghost_count', 2, 'ghost_speed_mps', 1.3)
    ),
    jsonb_build_object(
      'id', 'ghost_duel', 'layer', 'base', 'name', 'Ghost Duel',
      'teams', jsonb_build_array('runner'), 'min_players', 1,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object('variant', 'time_trial')
    )
  );
$$;

-- 3. Synthetic patrol generator helper ----------------------------------------
-- When ghost_library has no routes in this area, generate a smooth 8-point patrol loop.

create or replace function public.generate_synthetic_patrol_path(
  center geography,
  radius int,
  offset_deg float default 0
)
returns geometry
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  center_geom geometry := center::geometry;
  c_lng float := extensions.st_x(center_geom);
  c_lat float := extensions.st_y(center_geom);
  r_deg float := (radius * 0.55) / 111320.0;
  pts geometry[] := array[]::geometry[];
  angle float;
begin
  for i in 0..8 loop
    angle := radians(offset_deg + (i * 45.0));
    pts := array_append(
      pts,
      extensions.st_setsrid(
        extensions.st_makepoint(
          c_lng + (r_deg * cos(angle) / cos(radians(c_lat))),
          c_lat + (r_deg * sin(angle))
        ),
        4326
      )
    );
  end loop;
  return extensions.st_makeline(pts);
end;
$$;

-- 4. Spawn Ghost NPCs helper --------------------------------------------------

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

  -- Remove any existing ghosts for this game
  delete from public.entities where game_id = p_game_id and kind = 'ghost';

  -- 1. Try to find matching real ghosts from ghost_library within area radius + 500m
  for ghost_rec in
    select gl.id, gl.path, gl.duration_s
    from public.ghost_library gl
    where extensions.st_dwithin(gl.area_center, g.area_center, g.area_radius + 500)
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

  -- 2. If fewer ghosts found than target_count, synthesize remaining patrol loops
  while spawn_count < target_count loop
    patrol_geom := public.generate_synthetic_patrol_path(g.area_center, g.area_radius, (spawn_count * 60.0)::float);
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

-- 5. RPC: nearby_entities -----------------------------------------------------
-- Runners see faint ghost blips within 80 m. Hunters and outsiders receive nothing.

create or replace function public.nearby_entities(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  caller_team public.team_type;
  my_fix record;
begin
  if caller_id is null then
    return '[]'::jsonb;
  end if;

  select p.team into caller_team
  from public.players p
  where p.game_id = nearby_entities.game_id and p.user_id = caller_id;

  -- Only active runners can detect faint ghost blips within 80m
  if caller_team is null or caller_team <> 'runner' then
    return '[]'::jsonb;
  end if;

  select pp.geog into my_fix
  from public.player_positions pp
  join public.players p on p.id = pp.player_id
  where p.game_id = nearby_entities.game_id and p.user_id = caller_id;

  if my_fix.geog is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id,
      'kind', e.kind,
      'latitude', extensions.st_y(e.geog::geometry),
      'longitude', extensions.st_x(e.geog::geometry),
      'distance_m', round(extensions.st_distance(e.geog, my_fix.geog)::numeric, 1)
    ))
    from public.entities e
    where e.game_id = nearby_entities.game_id
      and e.kind = 'ghost'
      and e.geog is not null
      and extensions.st_dwithin(e.geog, my_fix.geog, 80)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.nearby_entities(uuid) from public, anon;
grant execute on function public.nearby_entities(uuid) to authenticated;

-- 6. Update advance_game to step NPC ghosts ------------------------------------

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

  -- Phase 1: Countdown -> Head Start or Live
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

  -- Phase 2: Head Start -> Live
  if new_status = 'head_start' and server_time >= current_game.live_at then
    new_status := 'live';
    update public.games set status = 'live' where id = current_game.id;
    insert into public.events (game_id, type, payload)
      values (current_game.id, 'phase_changed', jsonb_build_object('phase', 'live'));

    -- Spawn ghosts if Haunted Map
    if current_game.mode_id in ('haunted_map', 'ghost_duel') then
      perform public.spawn_ghost_npcs(current_game.id);
    end if;
  end if;

  -- Phase 3: Time expiry
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

  -- Phase 4: NPC Ghost Simulation Step (Live only)
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

        -- Sighting & Haunting check against live active runners
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
          -- 1. Haunted tag within 12 meters
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

            -- Check if all runners tagged
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

          -- 2. Ghost Sighting alert within 40 meters
          elsif runner_fix.dist_m <= 40.0 then
            -- Avoid spamming sightings more than once every 20 seconds
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

  -- Phase 5: Shrinking zone progression
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
      when 1 then current_game.area_radius
      when 2 then (current_game.area_radius * 0.70)::integer
      when 3 then (current_game.area_radius * 0.45)::integer
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

  -- Phase 6: Scheduled ping release
  if new_status = 'live' and server_time >= current_game.next_ping_at then
    interval_s := current_game.ping_interval_s;

    -- Check if Double Agent Scramble is primed
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

-- Migration: 20261114001000_b6_ghost_duel_lifecycle.sql
-- Phase B Milestone B6: Ghost Duel lifecycle, target placement, arrival, scoring & snapshot

-- 1. Mode Catalogue: update ghost_duel teams to allow runner and hunter ---------
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
      'compatible_roles', jsonb_build_array('double_agent', 'vip', 'operator'),
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
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 1,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array('noise_meter', 'shrinking_zone'),
      'parameters', jsonb_build_object('variant', 'time_trial')
    ),
    jsonb_build_object(
      'id', 'jailbreak', 'layer', 'base', 'name', 'Jailbreak',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 5,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object(
        'jail_radius_m', 15,
        'auto_release_s', 300,
        'release_hold_s', 10,
        'release_radius_m', 10
      )
    ),
    jsonb_build_object(
      'id', 'assassin_ring', 'layer', 'base', 'name', 'Assassin Ring',
      'teams', jsonb_build_array('solo'), 'min_players', 3,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object('safe_zones', 2, 'proximity_warning_m', 40)
    ),
    jsonb_build_object(
      'id', 'relay_heist', 'layer', 'base', 'name', 'Relay Heist',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 5,
      'compatible_roles', jsonb_build_array('operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object(
        'extraction_radius_m', 25,
        'handoff_radius_m', 5,
        'drop_pickup_radius_m', 10,
        'hunter_secure_hold_s', 20
      )
    )
  );
$$;

-- 2. spawn_ghost_npcs: configure Ghost Duel ghost & target ---------------------
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
  target_count int := 1;
  ghost_idx int := 1;
  v_variant text := 'time_trial';
  v_ghost_team public.team_type := 'hunter';
  v_visible_to text := 'none';
  v_target_pt geometry;
begin
  select * into g from public.games where id = p_game_id;
  if g.id is null then return; end if;

  if g.mode_id = 'ghost_duel' then
    target_count := 1;
    v_variant := coalesce(g.mode_params->'ghost_duel'->>'variant', 'time_trial');
    v_ghost_team := case when v_variant = 'mirror_chase' then 'runner'::public.team_type else 'hunter'::public.team_type end;
    -- In ghost duel, the ghost blip/path is visible on map to all members
    v_visible_to := 'all';
  elsif (g.mode_params->'haunted_map'->>'ghost_count') is not null then
    target_count := greatest(1, least(4, (g.mode_params->'haunted_map'->>'ghost_count')::int));
    v_ghost_team := 'hunter'::public.team_type;
    v_visible_to := 'none';
  else
    target_count := 2;
    v_ghost_team := 'hunter'::public.team_type;
    v_visible_to := 'none';
  end if;

  delete from public.entities where game_id = p_game_id and kind = 'ghost';

  -- 1. Try to find matching real ghosts from ghost_library within area radius + 500m
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
      v_ghost_team,
      extensions.st_startpoint(patrol_geom)::geography,
      jsonb_build_object(
        'ghost_index', ghost_idx,
        'variant', v_variant,
        'path_id', ghost_rec.id,
        'path_wkt', extensions.st_astext(patrol_geom),
        'total_length_m', extensions.st_length(ghost_rec.path),
        'duration_s', ghost_rec.duration_s,
        'speed_mps', 1.3,
        't0', clock_timestamp()
      ),
      v_visible_to
    );
    spawn_count := spawn_count + 1;
    ghost_idx := ghost_idx + 1;
  end loop;

  -- 2. Fall back to synthetic benchmark patrol path if needed
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
      v_ghost_team,
      extensions.st_startpoint(patrol_geom)::geography,
      jsonb_build_object(
        'ghost_index', ghost_idx,
        'variant', v_variant,
        'path_id', null,
        'path_wkt', extensions.st_astext(patrol_geom),
        'total_length_m', extensions.st_length(patrol_geom::geography),
        'duration_s', 240,
        'speed_mps', 1.3,
        't0', clock_timestamp()
      ),
      v_visible_to
    );
    spawn_count := spawn_count + 1;
    ghost_idx := ghost_idx + 1;
  end loop;

  -- 3. For Ghost Duel, set course finish target at end of ghost path
  if g.mode_id = 'ghost_duel' and patrol_geom is not null then
    v_target_pt := extensions.st_endpoint(patrol_geom);
    delete from public.entities where game_id = p_game_id and kind = 'target';
    insert into public.entities (
      game_id, kind, geog, state, visible_to
    ) values (
      p_game_id,
      'target',
      v_target_pt::geography,
      jsonb_build_object('radius_m', 20, 'name', 'Finish Line'),
      'all'
    );

    insert into public.targets (game_id, geog, set_by)
    values (
      p_game_id,
      v_target_pt::geography,
      (select p.id from public.players p where p.game_id = p_game_id limit 1)
    )
    on conflict (game_id) do update
      set geog = excluded.geog;
  end if;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'ghosts_spawned',
    'all',
    jsonb_build_object(
      'count', spawn_count,
      'variant', v_variant,
      'message', case
        when g.mode_id = 'ghost_duel' then 'Ghost Duel begins! Race the ghost to the finish line.'
        else spawn_count || ' ghosts are haunting the map.'
      end
    )
  );
end;
$$;

-- 3. start_game: handle Ghost Duel solo player and auto team assignment --------
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

  -- For Ghost Duel mode, auto-assign team for solo player if unassigned
  if current_game.mode_id = 'ghost_duel' then
    update public.players
    set team = case when coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial') = 'mirror_chase' then 'hunter'::public.team_type else 'runner'::public.team_type end
    where players.game_id = current_game.id and players.team = 'unassigned' and players.status = 'active';
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

  -- Relay Heist package carrier (exclude remote operators)
  if current_game.mode_id = 'relay_heist' then
    select p.id into chosen_carrier_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and not p.is_remote
    order by random()
    limit 1;

    if chosen_carrier_id is not null then
      delete from public.entities e where e.game_id = current_game.id and e.kind = 'package';
      insert into public.entities (
        game_id,
        kind,
        state,
        visible_to
      ) values (
        current_game.id,
        'package',
        jsonb_build_object(
          'carrier_player_id', chosen_carrier_id,
          'status', 'carried',
          'dropped_at', null,
          'securing_hunter_id', null,
          'securing_started_at', null
        ),
        'runner'
      );
    end if;
  end if;

  insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
  values
    (current_game.id, 'runner', 0, now()),
    (current_game.id, 'hunter', case when 'hot_cold' = any(current_game.modifiers) then 6 else 0 end, now())
  on conflict on constraint team_resources_pkey do update
    set heat_charges = excluded.heat_charges,
        heat_updated_at = excluded.heat_updated_at;

  insert into public.player_resources (player_id, game_id, tokens, charges, cooldowns)
  select p.id, current_game.id, 0, '{}'::jsonb, '{}'::jsonb
  from public.players p
  where p.game_id = current_game.id and p.status = 'active'
  on conflict (player_id) do nothing;

  insert into public.events (game_id, type, payload)
  values (
    current_game.id,
    'round_started',
    jsonb_build_object(
      'countdown_ends', countdown_ends,
      'live_starts', live_starts,
      'head_start_s', current_game.head_start_s,
      'duration_s', current_game.duration_s,
      'roles', current_game.roles
    )
  );

  return jsonb_build_object(
    'status', current_game.status,
    'countdown_ends', countdown_ends,
    'live_starts', live_starts,
    'roles', current_game.roles
  );
end;
$$;

-- 4. advance_game: step ghost, handle mirror chase timeout ---------------------
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
  base_radius double precision;
  pct numeric;
  stage_idx integer;
  stage_radius double precision;
  staged_at timestamptz;
  prev_staged_at timestamptz;
  target_interval_s double precision;
  interp double precision;
  interp_radius double precision;
  prev_stage integer;
  current_stage integer;
  announced integer;
  active_runners integer;
  active_hunters integer;
  active_survivors integer;
  ghost_rec record;
  patrol_geom geometry;
  duration_s integer;
  effective_duration_s integer;
  elapsed_s double precision;
  loop_frac double precision;
  current_ghost_pt geometry;
  runner_fix record;
  v_ghost_ping_seq integer;
  path_len_m double precision;
  v_duel_variant text;
begin
  select * into current_game from public.games g
    where g.id = advance_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status in ('ended', 'cancelled') then
    return current_game.status;
  end if;

  if current_game.status = 'countdown' and clock_timestamp() >= current_game.head_start_at then
    if current_game.head_start_s = 0 then
      update public.games set status = 'live' where id = current_game.id;
      insert into public.events (game_id, type, payload) values (current_game.id, 'game_live', '{}'::jsonb);
      current_game.status := 'live';
    else
      update public.games set status = 'head_start' where id = current_game.id;
      insert into public.events (game_id, type, payload) values (current_game.id, 'head_start_started', '{}'::jsonb);
      current_game.status := 'head_start';
    end if;
  end if;

  if current_game.status = 'head_start' and clock_timestamp() >= current_game.live_at then
    update public.games set status = 'live' where id = current_game.id;
    insert into public.events (game_id, type, payload) values (current_game.id, 'game_live', '{}'::jsonb);
    current_game.status := 'live';
  end if;

  if current_game.status = 'live' and clock_timestamp() >= current_game.ends_at then
    if current_game.mode_id = 'assassin_ring' then
      select count(*) into active_survivors
      from public.players p
      where p.game_id = current_game.id and p.status = 'active';

      if active_survivors > 1 then
        perform public.end_game(current_game.id, 'solo', 'timeout');
      else
        perform public.end_game(current_game.id, 'solo', 'last_survivor');
      end if;
    elsif current_game.mode_id = 'ghost_duel' then
      perform public.end_game(current_game.id, 'hunters', 'ghost_won');
    else
      perform public.end_game(
        current_game.id,
        case when current_game.mode_id = 'classic_chase' then 'hunters' else 'runners' end,
        'time_expired'
      );
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
    return current_game.status;
  end if;

  -- Stepping Ghost NPCs
  if current_game.status = 'live' and current_game.mode_id in ('haunted_map', 'ghost_duel') then
    v_duel_variant := coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial');
    for ghost_rec in
      select id, state, geog from public.entities
      where entities.game_id = current_game.id and kind = 'ghost'
    loop
      patrol_geom := null;
      if ghost_rec.state ? 'path_wkt' then
        begin
          patrol_geom := extensions.st_geomfromtext(ghost_rec.state->>'path_wkt', 4326);
        exception when others then
          patrol_geom := null;
        end;
      end if;

      if patrol_geom is not null and extensions.st_geometrytype(patrol_geom) = 'ST_LineString' then
        duration_s := coalesce((ghost_rec.state->>'duration_s')::int, 240);
        effective_duration_s := greatest(30, duration_s);

        path_len_m := extensions.st_length(patrol_geom::geography);
        if path_len_m > 0 and (path_len_m / effective_duration_s) > 2.0 then
          effective_duration_s := ceil(path_len_m / 2.0)::int;
        end if;

        elapsed_s := extract(epoch from (now() - current_game.live_at));
        if current_game.mode_id = 'ghost_duel' and elapsed_s >= effective_duration_s then
          loop_frac := 1.0;
        else
          loop_frac := (elapsed_s / effective_duration_s) - floor(elapsed_s / effective_duration_s);
        end if;

        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        if extensions.st_distance(current_ghost_pt::geography, current_game.area_center) > current_game.area_radius_m then
          current_ghost_pt := extensions.st_project(
            current_game.area_center,
            greatest(10, current_game.area_radius_m - 10),
            extensions.st_azimuth(current_game.area_center::geometry, current_ghost_pt)
          )::geometry;
        end if;

        update public.entities
        set geog = current_ghost_pt::geography, updated_at = now()
        where entities.id = ghost_rec.id;

        -- Mirror chase timeout check
        if current_game.mode_id = 'ghost_duel' and v_duel_variant = 'mirror_chase' and elapsed_s >= effective_duration_s then
          perform public.end_game(current_game.id, 'runners', 'ghost_escaped');
          select * into current_game from public.games g where g.id = advance_game.game_id;
          return current_game.status;
        end if;

        -- Proximity assist check (40 m) for Haunted Map
        if current_game.mode_id = 'haunted_map' and current_game.ghost_mode = 'assist' then
          for runner_fix in
            select p.id as runner_id, pr.display_name as runner_name,
                   extensions.st_distance(pp.geog, current_ghost_pt::geography) as dist_m
            from public.players p
            join public.player_positions pp on pp.player_id = p.id
            join public.profiles pr on pr.id = p.user_id
            where p.game_id = current_game.id
              and p.team = 'runner'
              and p.status = 'active'
              and pp.recorded_at > now() - interval '20 seconds'
              and coalesce(pp.accuracy_m, 10.0) <= 30.0
              and extensions.st_dwithin(pp.geog, current_ghost_pt::geography, 40)
          loop
            if not exists (
              select 1 from public.pings pi
              where pi.game_id = current_game.id
                and pi.player_id = runner_fix.runner_id
                and pi.reason = 'ghost_sighting'
                and pi.released_at > now() - interval '20 seconds'
            ) then
              update public.games g set ping_seq = g.ping_seq + 1
              where g.id = current_game.id
              returning g.ping_seq into v_ghost_ping_seq;

              insert into public.pings (
                game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
              ) values (
                current_game.id,
                v_ghost_ping_seq,
                runner_fix.runner_id,
                current_ghost_pt::geography,
                10,
                0,
                'ghost_sighting',
                now()
              );

              insert into public.events (game_id, type, audience, payload)
              values (
                current_game.id,
                'ghost_sighting',
                'hunters',
                jsonb_build_object(
                  'message', 'The ghost spotted runner ' || runner_fix.runner_name || '!',
                  'runner_id', runner_fix.runner_id,
                  'distance_m', round(runner_fix.dist_m::numeric, 1)
                )
              );
            end if;
          end loop;
        end if;
      end if;
    end loop;
  end if;

  -- Ping logic
  if current_game.status = 'live' and clock_timestamp() >= current_game.next_ping_at then
    update public.games g set ping_seq = g.ping_seq + 1
      where g.id = current_game.id
      returning g.ping_seq into current_game.ping_seq;

    for runner in
      select p.id as player_id, pp.geog, pp.accuracy_m, pp.recorded_at
      from public.players p
      join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id
        and p.team = 'runner'
        and p.status = 'active'
        and not p.is_remote
    loop
      shift_m := random() * 20.0;
      bearing := random() * 2.0 * pi();
      ping_geog := extensions.st_project(runner.geog, shift_m, bearing);
      dist_from_center := extensions.st_distance(ping_geog, current_game.area_center);
      if dist_from_center > current_game.area_radius_m then
        ping_geog := extensions.st_project(
          current_game.area_center,
          current_game.area_radius_m - 5.0,
          extensions.st_azimuth(current_game.area_center::geometry, ping_geog::geometry)
        );
      end if;

      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
      ) values (
        current_game.id,
        current_game.ping_seq,
        runner.player_id,
        ping_geog,
        runner.accuracy_m,
        extract(epoch from (clock_timestamp() - runner.recorded_at))::integer,
        'scheduled',
        clock_timestamp()
      );
      ping_count := ping_count + 1;
    end loop;

    next_ping := clock_timestamp() + make_interval(secs => current_game.ping_interval_s);
    update public.games g
      set next_ping_at = next_ping
      where g.id = current_game.id;

    insert into public.events (game_id, type, payload)
    values (
      current_game.id,
      'ping_released',
      jsonb_build_object('seq', current_game.ping_seq, 'count', ping_count)
    );
  end if;

  return current_game.status;
end;
$$;

-- 5. submit_position: handle Ghost Duel target arrival & scoring ---------------
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
  fix_geog geography;
  v_in_bounds boolean;
  v_radius double precision;
  v_accuracy real;
  v_speed real;
  v_heading real;
  v_out_since timestamptz;
  v_noise integer := 0;
  v_alerted boolean := false;
  v_smoothed real;
  v_anchor geography;
  v_anchor_since timestamptz;
  v_fast_since timestamptz;
  v_vehicle_warned boolean := false;
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

  -- Remote Operator early return: no GPS or spatial tracking
  if coalesce(me.is_remote, false) then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', clock_timestamp(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', true,
      'my_status', me.status,
      'winner', current_game.winner,
      'end_reason', current_game.end_reason,
      'noise', 0,
      'is_remote', true
    );
  end if;

  if current_game.status in ('ended', 'cancelled') or me.status <> 'active' then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', clock_timestamp(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner,
      'end_reason', current_game.end_reason
    );
  end if;

  if current_game.status = 'countdown' then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', clock_timestamp(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner,
      'end_reason', current_game.end_reason
    );
  end if;

  if submit_position.lat is null or submit_position.lng is null or
     submit_position.lat < -90 or submit_position.lat > 90 or
     submit_position.lng < -180 or submit_position.lng > 180 then
    raise exception 'Invalid position coordinates.';
  end if;

  fix_time := coalesce(submit_position.recorded_at, now());
  if fix_time > now() + interval '5 seconds' then
    fix_time := now();
  end if;

  v_accuracy := coalesce(submit_position.accuracy, 10)::real;
  v_speed := submit_position.speed::real;
  v_heading := submit_position.heading::real;

  fix_geog := extensions.st_setsrid(
    extensions.st_makepoint(submit_position.lng, submit_position.lat),
    4326
  )::geography;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_distance(fix_geog, current_game.area_center) <= v_radius;

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

  -- Classic chase arrival check
  if current_game.mode_id = 'classic_chase' and me.team = 'runner' and current_game.status = 'live' then
    if exists (
      select 1 from public.targets t
      where t.game_id = current_game.id
        and extensions.st_dwithin(fix_geog, t.geog, current_game.target_radius_m)
    ) then
      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id, 'target_reached', me.id, 'all',
        jsonb_build_object(
          'user_id', caller_id,
          'player_id', me.id,
          'message', 'A runner reached the extraction target! Runners win!'
        )
      );
      perform public.end_game(current_game.id, 'runners', 'target_reached');
      select * into current_game from public.games g where g.id = submit_position.game_id;
    end if;
  end if;

  -- Relay Heist extraction check
  if current_game.status = 'live'
     and current_game.mode_id = 'relay_heist'
     and me.team = 'runner'
     and me.status = 'active'
     and exists (
       select 1
       from public.entities e_pkg
       join public.entities e_ext on e_ext.game_id = current_game.id and e_ext.kind in ('extraction', 'extraction_point')
       where e_pkg.game_id = current_game.id
         and e_pkg.kind = 'package'
         and (e_pkg.state->>'carrier_player_id') = me.id::text
         and (e_pkg.state->>'status') = 'carried'
         and extensions.st_dwithin(fix_geog, e_ext.geog, coalesce((e_ext.state->>'radius_m')::int, 25))
     ) then
    perform public.end_game(current_game.id, 'runners', 'extraction_complete');
    select * into current_game from public.games g where g.id = submit_position.game_id;
  end if;

  -- Ghost Duel win conditions
  if current_game.mode_id = 'ghost_duel' and current_game.status = 'live' then
    v_duel_variant := coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial');
    select * into v_duel_target from public.entities where game_id = current_game.id and kind = 'target' limit 1;
    select * into v_ghost_ent from public.entities where game_id = current_game.id and kind = 'ghost' limit 1;

    if v_duel_variant in ('time_trial', 'evade') and me.team = 'runner' then
      -- Evade collision check: if runner enters within 20m of ghost hunter
      if v_duel_variant = 'evade' and v_ghost_ent.geog is not null and extensions.st_dwithin(fix_geog, v_ghost_ent.geog, 20.0) then
        insert into public.events (game_id, type, target_player, audience, payload)
        values (
          current_game.id, 'haunted', me.id, 'all',
          jsonb_build_object('player_id', me.id, 'message', 'Caught by ghost! Run failed.')
        );
        perform public.end_game(current_game.id, 'hunters', 'haunted');
        select * into current_game from public.games g where g.id = submit_position.game_id;
      -- Target arrival check
      elsif v_duel_target.geog is not null and extensions.st_dwithin(fix_geog, v_duel_target.geog, coalesce((v_duel_target.state->>'radius_m')::int, 20)) then
        v_p_time := round(extract(epoch from (now() - current_game.live_at))::numeric, 2);
        v_g_time := coalesce((v_ghost_ent.state->>'duration_s')::double precision, 240.0);
        v_delta := round((v_g_time - v_p_time)::numeric, 2);

        -- Route efficiency
        v_straight_m := extensions.st_distance(current_game.area_center, v_duel_target.geog);
        select coalesce(sum(extensions.st_distance(tp1.geog, tp2.geog)), v_straight_m)
          into v_actual_m
          from public.trail_points tp1
          join public.trail_points tp2 on tp2.player_id = tp1.player_id and tp2.recorded_at > tp1.recorded_at
          where tp1.player_id = me.id and tp1.game_id = current_game.id;
        if v_actual_m > 0 then
          v_eff := least(1.0, greatest(0.1, (v_straight_m / greatest(1.0, v_actual_m))))::real;
        end if;

        v_score := greatest(100, round(1000 + (v_delta * 10) + (v_eff * 200))::int);

        insert into public.ghost_duel_scores (
          game_id, user_id, variant, area_center, player_time_s, ghost_time_s, delta_s, efficiency, score
        ) values (
          current_game.id, caller_id, v_duel_variant, current_game.area_center, v_p_time, v_g_time, v_delta, v_eff, v_score
        );

        insert into public.events (game_id, type, target_player, audience, payload)
        values (
          current_game.id, 'ghost_duel_finished', me.id, 'all',
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
    'smoothed_speed_mps', round(coalesce(v_smoothed, 0)::numeric, 2)
  );
end;
$$;

-- 6. get_game_state: expose ghost_duel state snapshot --------------------------
create or replace function public.get_game_state(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  mine public.players%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(game_id) then raise exception 'You are not a member of this game.'; end if;

  perform public.advance_game(get_game_state.game_id);

  select * into current_game from public.games g where g.id = get_game_state.game_id;
  select * into mine from public.players p where p.game_id = get_game_state.game_id and p.user_id = caller_id;

  return jsonb_build_object(
    'server_time', clock_timestamp(),
    'game', to_jsonb(current_game) || jsonb_build_object(
      'area', jsonb_build_object(
        'longitude', extensions.st_x(current_game.area_center::extensions.geometry),
        'latitude', extensions.st_y(current_game.area_center::extensions.geometry),
        'radius_m', public.effective_radius_m(current_game.id),
        'base_radius_m', current_game.area_radius_m,
        'zone_stage', current_game.zone_stage,
        'zone_stage_count', array_length(public.zone_stage_values(current_game.id), 1),
        'shrinking', 'shrinking_zone' = any(current_game.modifiers)
      ),
      'target_set', exists (select 1 from public.targets t where t.game_id = current_game.id),
      'ping_visible_s', current_game.ping_visible_s,
      'ghost_mode', current_game.ghost_mode,
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
      'ghost_duel', case
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
      end,
      'relay_heist', case
        when current_game.mode_id = 'relay_heist' then jsonb_build_object(
          'extraction', (
            select jsonb_build_object(
              'id', e.id,
              'longitude', extensions.st_x(e.geog::extensions.geometry),
              'latitude', extensions.st_y(e.geog::extensions.geometry),
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
              when mine.team = 'runner' or current_game.status in ('ended', 'cancelled') then
                jsonb_build_object(
                  'status', 'carried',
                  'carrier_player_id', e.state->>'carrier_player_id',
                  'is_carrier', ((e.state->>'carrier_player_id') = mine.id::text),
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
        'recorded_at', pp.recorded_at,
        'is_mock', pp.is_mock
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
        'is_remote', coalesce(p.is_remote, false),
        'joined_at', p.joined_at,
        'jailed_at', case when p.status = 'jailed' then p.tagged_at else null end,
        'frozen_until', p.status_detail->>'frozen_until',
        'pending_role_swap', case when p.id = mine.id then p.status_detail->'pending_role_swap' else null end,
        'secret_role', case
          when current_game.status in ('ended', 'cancelled') or p.id = mine.id then p.secret_role
          when 'vip' = any(current_game.roles) and mine.team = 'runner' and p.team = 'runner' then p.secret_role
          else null
        end
      ) order by p.joined_at asc)
      from public.players p
      join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id and p.status <> 'left'
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(ev) order by ev.created_at asc)
      from public.events ev
      where ev.game_id = current_game.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_game_state(uuid) from public, anon;
grant execute on function public.get_game_state(uuid) to authenticated;

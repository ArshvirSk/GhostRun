-- Migration: 20261116001000_b8_territory_pulse_lifecycle.sql
-- Phase B Milestone B8: Territory Pulse (territory_pulse) Lifecycle & Zone Evaluation

-- 1. App Settings feature flag -----------------------------------------------

insert into public.app_settings (key, value) values
  ('feature.mode.territory_pulse', 'true'::jsonb)
on conflict (key) do update set value = excluded.value;

-- 2. Update Mode Catalogue ---------------------------------------------------

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
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 1,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object('variant', 'time_trial')
    ),
    jsonb_build_object(
      'id', 'jailbreak', 'layer', 'base', 'name', 'Jailbreak',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 5,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object('jail_radius_m', 15, 'auto_release_s', 300, 'release_hold_s', 10, 'release_radius_m', 10)
    ),
    jsonb_build_object(
      'id', 'assassin_ring', 'layer', 'base', 'name', 'Assassin Ring',
      'teams', jsonb_build_array('solo'), 'min_players', 3,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array('noise_meter', 'dead_drops', 'qr_tagging', 'shrinking_zone'),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'relay_heist', 'layer', 'base', 'name', 'Relay Heist',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 3,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'territory_pulse', 'layer', 'base', 'name', 'Territory Pulse',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('operator'),
      'compatible_modifiers', jsonb_build_array(
        'dead_drops', 'shrinking_zone', 'qr_tagging'
      ),
      'parameters', jsonb_build_object(
        'pulse_interval_s', 90,
        'zone_radius_m', 60,
        'zone_count', 7,
        'dominance_pct', 70
      )
    )
  );
$$;

-- 3. Spawn Territory Zones Helper --------------------------------------------

create or replace function public.spawn_territory_zones(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  g record;
  zone_radius double precision;
  ring_dist double precision;
  angle_rad double precision;
  pt geography;
  i integer;
  names text[] := array['Core', 'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
begin
  select * into g from public.games where id = p_game_id;
  if g.id is null then return; end if;

  -- Clean any existing zones for this game
  delete from public.entities where game_id = p_game_id and kind = 'zone';

  zone_radius := least(80.0, greatest(35.0, g.area_radius_m * 0.20));
  ring_dist := g.area_radius_m * 0.55;

  -- 1. Center zone: Sector Core
  insert into public.entities (
    game_id, kind, team, geog, state, visible_to
  ) values (
    p_game_id,
    'zone',
    null,
    g.area_center,
    jsonb_build_object(
      'zone_index', 0,
      'name', 'Core',
      'radius_m', zone_radius,
      'controller', null,
      'contender', null,
      'contender_pulses', 0
    ),
    'all'
  );

  -- 2. 6 Outer radial zones (60 deg intervals)
  for i in 1..6 loop
    angle_rad := radians((i - 1) * 60.0);
    pt := extensions.st_project(g.area_center, ring_dist, angle_rad);

    insert into public.entities (
      game_id, kind, team, geog, state, visible_to
    ) values (
      p_game_id,
      'zone',
      null,
      pt,
      jsonb_build_object(
        'zone_index', i,
        'name', names[i + 1],
        'radius_m', zone_radius,
        'controller', null,
        'contender', null,
        'contender_pulses', 0
      ),
      'all'
    );
  end loop;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'zones_spawned',
    'all',
    jsonb_build_object('count', 7, 'message', '7 territory sectors established across the sector.')
  );
end;
$$;

-- 4. Update start_game to support territory_pulse -----------------------------

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
  v_pulse_int integer;
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

  v_pulse_int := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_interval_s')::int, 90);

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
        roles = current_game.roles,
        mode_params = case
          when g.mode_id = 'territory_pulse' then
            g.mode_params || jsonb_build_object(
              'territory_pulse', jsonb_build_object(
                'pulse_interval_s', v_pulse_int,
                'next_pulse_at', live_starts + make_interval(secs => v_pulse_int),
                'last_pulse_at', null,
                'pulse_seq', 0,
                'scores', jsonb_build_object('runner', 0, 'hunter', 0),
                'dominance_pct', coalesce((g.mode_params->'territory_pulse'->>'dominance_pct')::int, 70),
                'consecutive_dominance', jsonb_build_object('runner', 0, 'hunter', 0)
              )
            )
          else g.mode_params
        end
    where g.id = current_game.id
    returning * into current_game;

  -- Spawn NPC ghosts if in haunted_map or ghost_duel
  if current_game.mode_id in ('haunted_map', 'ghost_duel') then
    perform public.spawn_ghost_npcs(current_game.id);
  end if;

  -- Spawn Territory Zones if in territory_pulse
  if current_game.mode_id = 'territory_pulse' then
    perform public.spawn_territory_zones(current_game.id);
  end if;

  if 'dead_drops' = any(current_game.modifiers) then
    perform public.spawn_drops(start_game.game_id, null);
  end if;

  -- Relay Heist package carrier
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

-- 5. Update advance_game to process Territory Pulses -------------------------

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

  -- Territory Pulse locals
  v_tp_next timestamptz;
  v_tp_seq integer;
  v_tp_interval integer;
  v_r_score integer := 0;
  v_h_score integer := 0;
  v_r_controlled integer := 0;
  v_h_controlled integer := 0;
  v_r_dom integer := 0;
  v_h_dom integer := 0;
  v_zone_rec record;
  v_z_runners integer;
  v_z_hunters integer;
  v_prevailing text;
  v_ctrl text;
  v_cont text;
  v_cont_p integer;
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

  -- Timeout condition check
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
    elsif current_game.mode_id = 'territory_pulse' then
      v_r_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'runner')::int, 0);
      v_h_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'hunter')::int, 0);
      if v_r_score > v_h_score then
        perform public.end_game(current_game.id, 'runners', 'points_victory');
      elsif v_h_score > v_r_score then
        perform public.end_game(current_game.id, 'hunters', 'points_victory');
      else
        perform public.end_game(current_game.id, 'runners', 'draw');
      end if;
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

  -- Territory Pulse Execution
  if current_game.status = 'live' and current_game.mode_id = 'territory_pulse' then
    v_tp_next := (current_game.mode_params->'territory_pulse'->>'next_pulse_at')::timestamptz;
    v_tp_interval := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_interval_s')::int, 90);

    if v_tp_next is not null and clock_timestamp() >= v_tp_next then
      v_tp_seq := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_seq')::int, 0) + 1;
      v_r_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'runner')::int, 0);
      v_h_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'hunter')::int, 0);
      v_r_dom := coalesce((current_game.mode_params->'territory_pulse'->'consecutive_dominance'->>'runner')::int, 0);
      v_h_dom := coalesce((current_game.mode_params->'territory_pulse'->'consecutive_dominance'->>'hunter')::int, 0);

      -- Loop through each zone entity
      for v_zone_rec in
        select id, geog, state from public.entities
        where entities.game_id = current_game.id and kind = 'zone'
        order by (state->>'zone_index')::int asc
      loop
        -- Count active runners present in zone (not remote, not incapacitated)
        select count(*) into v_z_runners
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.status = 'active'
          and not coalesce(p.is_remote, false)
          and (p.status_detail->>'incapacitated_until' is null or (p.status_detail->>'incapacitated_until')::timestamptz <= clock_timestamp())
          and pp.recorded_at > clock_timestamp() - interval '45 seconds'
          and extensions.st_dwithin(pp.geog, v_zone_rec.geog, coalesce((v_zone_rec.state->>'radius_m')::double precision, 60.0));

        -- Count active hunters present in zone (not remote, not incapacitated)
        select count(*) into v_z_hunters
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'hunter'
          and p.status = 'active'
          and not coalesce(p.is_remote, false)
          and (p.status_detail->>'incapacitated_until' is null or (p.status_detail->>'incapacitated_until')::timestamptz <= clock_timestamp())
          and pp.recorded_at > clock_timestamp() - interval '45 seconds'
          and extensions.st_dwithin(pp.geog, v_zone_rec.geog, coalesce((v_zone_rec.state->>'radius_m')::double precision, 60.0));

        -- Determine majority
        if v_z_runners > v_z_hunters then
          v_prevailing := 'runner';
        elsif v_z_hunters > v_z_runners then
          v_prevailing := 'hunter';
        else
          v_prevailing := null;
        end if;

        v_ctrl := v_zone_rec.state->>'controller';
        v_cont := v_zone_rec.state->>'contender';
        v_cont_p := coalesce((v_zone_rec.state->>'contender_pulses')::int, 0);

        if v_ctrl is null then
          -- Neutral zone: captured immediately on prevailing majority
          if v_prevailing is not null then
            v_ctrl := v_prevailing;
            v_cont := null;
            v_cont_p := 0;
          end if;
        else
          -- Owned zone
          if v_prevailing = v_ctrl then
            -- Defended successfully
            v_cont := null;
            v_cont_p := 0;
          elsif v_prevailing is not null and v_prevailing <> v_ctrl then
            -- Opponent prevailing: requires 2 consecutive pulses to flip
            if v_cont = v_prevailing then
              v_cont_p := v_cont_p + 1;
              if v_cont_p >= 2 then
                v_ctrl := v_prevailing;
                v_cont := null;
                v_cont_p := 0;
              end if;
            else
              v_cont := v_prevailing;
              v_cont_p := 1;
            end if;
          end if;
        end if;

        -- Update zone entity
        update public.entities
        set team = case when v_ctrl = 'hunter' then 'hunter'::public.team_type when v_ctrl = 'runner' then 'runner'::public.team_type else null end,
            state = state || jsonb_build_object(
              'controller', v_ctrl,
              'contender', v_cont,
              'contender_pulses', v_cont_p,
              'last_pulse_seq', v_tp_seq,
              'runners_present', v_z_runners,
              'hunters_present', v_z_hunters
            ),
            updated_at = now()
        where entities.id = v_zone_rec.id;

        -- Scoring
        if v_ctrl = 'runner' then
          v_r_score := v_r_score + 1;
          v_r_controlled := v_r_controlled + 1;
        elsif v_ctrl = 'hunter' then
          v_h_score := v_h_score + 1;
          v_h_controlled := v_h_controlled + 1;
        end if;
      end loop;

      -- Dominance check: >= 5 of 7 zones (71.4% >= 70%)
      if v_r_controlled >= 5 then
        v_r_dom := v_r_dom + 1;
        v_h_dom := 0;
      elsif v_h_controlled >= 5 then
        v_h_dom := v_h_dom + 1;
        v_r_dom := 0;
      else
        v_r_dom := 0;
        v_h_dom := 0;
      end if;

      -- Emit pulse event
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'territory_pulse',
        'all',
        jsonb_build_object(
          'pulse_seq', v_tp_seq,
          'scores', jsonb_build_object('runner', v_r_score, 'hunter', v_h_score),
          'controlled', jsonb_build_object('runner', v_r_controlled, 'hunter', v_h_controlled, 'neutral', 7 - v_r_controlled - v_h_controlled)
        )
      );

      -- Update game mode_params
      update public.games
      set mode_params = mode_params || jsonb_build_object(
        'territory_pulse', jsonb_build_object(
          'pulse_interval_s', v_tp_interval,
          'last_pulse_at', clock_timestamp(),
          'next_pulse_at', clock_timestamp() + make_interval(secs => v_tp_interval),
          'pulse_seq', v_tp_seq,
          'scores', jsonb_build_object('runner', v_r_score, 'hunter', v_h_score),
          'dominance_pct', 70,
          'consecutive_dominance', jsonb_build_object('runner', v_r_dom, 'hunter', v_h_dom)
        )
      )
      where id = current_game.id;

      -- Dominance win condition: 2 consecutive dominance pulses or full control (7 zones)
      if v_r_dom >= 2 or v_r_controlled >= 7 then
        perform public.end_game(current_game.id, 'runners', 'territory_dominance');
        select * into current_game from public.games g where g.id = advance_game.game_id;
        return current_game.status;
      elsif v_h_dom >= 2 or v_h_controlled >= 7 then
        perform public.end_game(current_game.id, 'hunters', 'territory_dominance');
        select * into current_game from public.games g where g.id = advance_game.game_id;
        return current_game.status;
      end if;
    end if;
  end if;

  -- Stepping Ghost NPCs (for haunted_map and ghost_duel)
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
      end if;
    end loop;
  end if;

  -- Scheduled radar pings
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
    end loop;

    next_ping := clock_timestamp() + make_interval(secs => current_game.ping_interval_s);
    update public.games g set next_ping_at = next_ping where g.id = current_game.id;
  end if;

  return current_game.status;
end;
$$;

-- 6. Update get_game_state to expose Territory Pulse snapshot ----------------

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
  v_ghost_duel jsonb;
  v_territory_pulse jsonb;
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

  return jsonb_build_object(
    'server_time', clock_timestamp(),
    'ghost_duel', v_ghost_duel,
    'territory_pulse', v_territory_pulse,
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
      'ghost_duel', v_ghost_duel,
      'territory_pulse', v_territory_pulse,
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
                  'dropped_at', e.state->>'dropped_at',
                  'longitude', extensions.st_x(e.geog::extensions.geometry),
                  'latitude', extensions.st_y(e.geog::extensions.geometry),
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
    'teammates', case
      when mine.team = 'solo' then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_id', p.id,
          'user_id', p.user_id,
          'display_name', pr.display_name,
          'color', p.color,
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
        'reason', pi.reason,
        'released_at', pi.released_at
      ) order by pi.seq desc)
      from public.pings pi
      where pi.game_id = current_game.id
        and pi.released_at > clock_timestamp() - make_interval(secs => current_game.ping_visible_s)
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

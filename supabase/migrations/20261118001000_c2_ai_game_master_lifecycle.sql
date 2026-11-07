-- Migration: 20261118001000_c2_ai_game_master_lifecycle.sql
-- Phase C Milestone C2: AI Game Master (narration and events)
-- Implements trigger_game_master_event, narrate_game_master, updates effective_radius_m, start_game, advance_game, resume_game, get_game_state

-- 1. effective_radius_m (updated to support ai_gm shrink_scale) ----------------
create or replace function public.effective_radius_m(p_game_id uuid)
returns double precision
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  current_game public.games%rowtype;
  stages numeric[];
  stage_index integer;
  progress double precision;
  base_rad double precision;
  gm_scale double precision := 1.0;
begin
  select * into current_game from public.games g where g.id = p_game_id;
  if not found then return null; end if;

  if (current_game.mode_params->'ai_gm'->>'shrink_scale') is not null then
    gm_scale := (current_game.mode_params->'ai_gm'->>'shrink_scale')::double precision;
  end if;

  if not ('shrinking_zone' = any(current_game.modifiers))
     or current_game.live_at is null
     or current_game.duration_s is null
     or current_game.status in ('lobby', 'target_selection', 'countdown', 'head_start') then
    return greatest(60.0, round(current_game.area_radius_m * gm_scale));
  end if;

  progress := extract(epoch from (clock_timestamp() - current_game.live_at))
    / greatest(1, current_game.duration_s);
  progress := greatest(0, least(1, progress));

  stages := public.zone_stage_values(p_game_id);
  stage_index := public.zone_stage_at(p_game_id, progress);
  base_rad := round(current_game.area_radius_m * stages[stage_index] / 100.0);
  return greatest(60.0, round(base_rad * gm_scale));
end;
$$;

revoke all on function public.effective_radius_m(uuid) from public, anon, authenticated;
grant execute on function public.effective_radius_m(uuid) to authenticated;

-- 2. trigger_game_master_event ------------------------------------------------
create or replace function public.trigger_game_master_event(
  game_id uuid,
  event_type text default null
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
  v_count integer;
  v_max integer;
  v_interval integer;
  v_chosen_event text;
  v_elapsed double precision;
  v_progress double precision;
  v_last_ping timestamptz;
  v_title text;
  v_narration text;
  v_details jsonb := '{}'::jsonb;
  v_next_at timestamptz;
  v_new_gm jsonb;
  -- Event specific locals
  v_dist double precision;
  v_bearing double precision;
  v_drop_geog extensions.geography;
  v_drop_id uuid;
  v_ping_seq integer;
  v_ping_count integer := 0;
  runner record;
  v_fog_until timestamptz;
  v_current_scale double precision;
  v_new_scale double precision;
  v_ne_count integer := 0;
  v_nw_count integer := 0;
  v_se_count integer := 0;
  v_sw_count integer := 0;
  v_rumour_quadrant text := 'North-East';
  v_max_q_count integer := -1;
  pos_rec record;
begin
  select * into current_game from public.games g where g.id = trigger_game_master_event.game_id for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status <> 'live' then
    return jsonb_build_object('success', false, 'reason', 'game_not_live', 'phase', current_game.status);
  end if;

  if not ('ai_gm' = any(current_game.modifiers)) then
    return jsonb_build_object('success', false, 'reason', 'ai_gm_modifier_not_active');
  end if;

  v_count := coalesce((current_game.mode_params->'ai_gm'->>'event_count')::int, 0);
  v_max := coalesce((current_game.mode_params->'ai_gm'->>'max_events')::int, 12);
  v_interval := coalesce((current_game.mode_params->'ai_gm'->>'event_interval_s')::int, 180);

  if v_count >= v_max then
    return jsonb_build_object('success', false, 'reason', 'max_events_reached', 'event_count', v_count, 'max_events', v_max);
  end if;

  -- 1. Determine Event Type
  if trigger_game_master_event.event_type is not null then
    if trigger_game_master_event.event_type not in ('supply_drop', 'double_ping', 'fog', 'rumour', 'shrink_step') then
      raise exception 'Invalid event_type: %', trigger_game_master_event.event_type;
    end if;
    v_chosen_event := trigger_game_master_event.event_type;
  else
    -- Context-sensitive selection
    v_elapsed := extract(epoch from (clock_timestamp() - current_game.live_at));
    v_progress := case when current_game.duration_s > 0 then v_elapsed / current_game.duration_s else 0.5 end;

    select max(released_at) into v_last_ping from public.pings p where p.game_id = current_game.id;

    if v_last_ping is null or (clock_timestamp() - v_last_ping > interval '120 seconds') then
      -- Lull detected: supply radar intel or directional rumor
      if (v_count % 2 = 0) then
        v_chosen_event := 'double_ping';
      else
        v_chosen_event := 'rumour';
      end if;
    elsif v_progress > 0.65 then
      -- Late match: accelerate urgency
      if (v_count % 3 = 0) then
        v_chosen_event := 'shrink_step';
      elsif (v_count % 3 = 1) then
        v_chosen_event := 'fog';
      else
        v_chosen_event := 'supply_drop';
      end if;
    else
      -- Regular cadence: rotation across all 5
      case (v_count % 5)
        when 0 then v_chosen_event := 'supply_drop';
        when 1 then v_chosen_event := 'double_ping';
        when 2 then v_chosen_event := 'fog';
        when 3 then v_chosen_event := 'rumour';
        else v_chosen_event := 'shrink_step';
      end case;
    end if;
  end if;

  -- 2. Execute Event Logic
  if v_chosen_event = 'supply_drop' then
    v_dist := random() * (current_game.area_radius_m * 0.65);
    v_bearing := random() * 360.0;
    v_drop_geog := extensions.st_project(current_game.area_center, v_dist, radians(v_bearing))::extensions.geography;

    insert into public.entities (game_id, kind, geog, state, visible_to)
    values (
      current_game.id,
      'drop',
      v_drop_geog,
      jsonb_build_object(
        'type', 'tactical_cache',
        'claimed', false,
        'claimed_by', null,
        'claimed_at', null,
        'spawned_by', 'ai_gm',
        'seq', v_count + 1
      ),
      'all'
    ) returning id into v_drop_id;

    v_title := 'Tactical Supply Drop';
    v_narration := 'Tactical supply cache dropped in the sector. Secure the telemetry cache before opposing forces converge.';
    v_details := jsonb_build_object(
      'entity_id', v_drop_id,
      'longitude', extensions.st_x(v_drop_geog::geometry),
      'latitude', extensions.st_y(v_drop_geog::geometry)
    );

  elsif v_chosen_event = 'double_ping' then
    select coalesce(max(seq), 0) + 1 into v_ping_seq from public.pings p where p.game_id = current_game.id;

    for runner in
      select pp.player_id, pp.geog, pp.accuracy_m, pp.recorded_at
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      where pp.game_id = current_game.id
        and p.team = 'runner'
        and p.status = 'active'
        and not coalesce(p.is_remote, false)
        and pp.recorded_at > clock_timestamp() - interval '60 seconds'
    loop
      insert into public.pings (game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at)
      values (
        current_game.id,
        v_ping_seq,
        runner.player_id,
        runner.geog,
        runner.accuracy_m,
        extract(epoch from (clock_timestamp() - runner.recorded_at))::int,
        'ai_gm_double_ping',
        clock_timestamp()
      );
      v_ping_count := v_ping_count + 1;
    end loop;

    v_title := 'Satellite Recon Sweep';
    v_narration := 'High-altitude satellite pulse re-synchronized. Active runner signatures mirrored on tactical radar.';
    v_details := jsonb_build_object('ping_seq', v_ping_seq, 'pings_emitted', v_ping_count);

  elsif v_chosen_event = 'fog' then
    v_fog_until := clock_timestamp() + interval '60 seconds';
    v_title := 'Atmospheric Radar Fog';
    v_narration := 'Dense atmospheric interference rolling into the sector. Radar feeds obscured for the next 60 seconds.';
    v_details := jsonb_build_object('duration_s', 60, 'ends_at', to_char(v_fog_until, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

  elsif v_chosen_event = 'rumour' then
    -- Runner quadrant count relative to area_center
    for pos_rec in
      select extensions.st_x(pp.geog::geometry) - extensions.st_x(current_game.area_center::geometry) as dx,
             extensions.st_y(pp.geog::geometry) - extensions.st_y(current_game.area_center::geometry) as dy
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      where pp.game_id = current_game.id
        and p.team = 'runner'
        and p.status = 'active'
        and not coalesce(p.is_remote, false)
        and pp.recorded_at > clock_timestamp() - interval '60 seconds'
    loop
      if pos_rec.dy >= 0 and pos_rec.dx >= 0 then
        v_ne_count := v_ne_count + 1;
      elsif pos_rec.dy >= 0 and pos_rec.dx < 0 then
        v_nw_count := v_nw_count + 1;
      elsif pos_rec.dy < 0 and pos_rec.dx >= 0 then
        v_se_count := v_se_count + 1;
      else
        v_sw_count := v_sw_count + 1;
      end if;
    end loop;

    v_max_q_count := v_ne_count;
    v_rumour_quadrant := 'North-East';

    if v_nw_count > v_max_q_count then
      v_max_q_count := v_nw_count;
      v_rumour_quadrant := 'North-West';
    end if;
    if v_se_count > v_max_q_count then
      v_max_q_count := v_se_count;
      v_rumour_quadrant := 'South-East';
    end if;
    if v_sw_count > v_max_q_count then
      v_max_q_count := v_sw_count;
      v_rumour_quadrant := 'South-West';
    end if;

    v_title := 'Intelligence Rumour';
    v_narration := 'Intercepted radio chatter indicates concentrated runner movement in the ' || v_rumour_quadrant || ' sector.';
    v_details := jsonb_build_object('quadrant', v_rumour_quadrant, 'confidence', 'medium');

  elsif v_chosen_event = 'shrink_step' then
    v_current_scale := coalesce((current_game.mode_params->'ai_gm'->>'shrink_scale')::double precision, 1.0);
    v_new_scale := round((v_current_scale * 0.85)::numeric, 3);
    if (current_game.area_radius_m * v_new_scale) < 60.0 then
      v_new_scale := round((60.0 / greatest(1.0, current_game.area_radius_m))::numeric, 3);
    end if;

    v_title := 'Perimeter Contraction Step';
    v_narration := 'Command has accelerated boundary containment. Sector perimeter contracted by 15%.';
    v_details := jsonb_build_object(
      'shrink_scale', v_new_scale,
      'effective_radius_m', greatest(60.0, round(current_game.area_radius_m * v_new_scale))
    );
  end if;

  -- 3. Update mode_params
  v_next_at := clock_timestamp() + make_interval(secs => v_interval);

  v_new_gm := coalesce(current_game.mode_params->'ai_gm', '{}'::jsonb) || jsonb_build_object(
    'is_active', true,
    'event_count', v_count + 1,
    'max_events', v_max,
    'event_interval_s', v_interval,
    'last_event_type', v_chosen_event,
    'last_title', v_title,
    'last_narration', v_narration,
    'last_event_at', to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'next_event_at', to_char(v_next_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  if v_chosen_event = 'shrink_step' then
    v_new_gm := v_new_gm || jsonb_build_object('shrink_scale', v_new_scale);
  end if;

  if v_chosen_event = 'fog' then
    v_new_gm := v_new_gm || jsonb_build_object('fog_active_until', to_char(v_fog_until, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;

  update public.games
  set mode_params = jsonb_set(coalesce(mode_params, '{}'::jsonb), '{ai_gm}', v_new_gm)
  where id = current_game.id;

  -- 4. Emit game_master event
  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'game_master',
    'all',
    jsonb_build_object(
      'event_type', v_chosen_event,
      'title', v_title,
      'narration', v_narration,
      'details', v_details,
      'event_seq', v_count + 1,
      'timestamp', clock_timestamp()
    )
  );

  return jsonb_build_object(
    'success', true,
    'event_type', v_chosen_event,
    'title', v_title,
    'narration', v_narration,
    'details', v_details,
    'event_count', v_count + 1,
    'next_event_at', v_next_at
  );
end;
$$;

revoke all on function public.trigger_game_master_event(uuid, text) from public, anon;
grant execute on function public.trigger_game_master_event(uuid, text) to authenticated;

-- 3. narrate_game_master ------------------------------------------------------
create or replace function public.narrate_game_master(
  game_id uuid,
  event_type text,
  custom_narration text
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
  v_clamped text;
  v_new_gm jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g where g.id = narrate_game_master.game_id for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players p where p.game_id = narrate_game_master.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found then raise exception 'You are not an active member of this game.'; end if;

  if current_game.status not in ('live', 'head_start') then
    raise exception 'Game is not live.';
  end if;

  if not ('ai_gm' = any(current_game.modifiers)) then
    raise exception 'AI Game Master modifier not active.';
  end if;

  -- Guardrail: clamp length to 250 characters and strip dangerous control characters
  v_clamped := trim(substr(coalesce(narrate_game_master.custom_narration, ''), 1, 250));
  if length(v_clamped) = 0 then
    raise exception 'Narration text cannot be empty.';
  end if;

  v_new_gm := coalesce(current_game.mode_params->'ai_gm', '{}'::jsonb) || jsonb_build_object(
    'last_narration', v_clamped,
    'last_narrated_at', to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  update public.games
  set mode_params = jsonb_set(coalesce(mode_params, '{}'::jsonb), '{ai_gm}', v_new_gm)
  where id = current_game.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'game_master_narration',
    'all',
    jsonb_build_object(
      'event_type', narrate_game_master.event_type,
      'narration', v_clamped,
      'timestamp', clock_timestamp()
    )
  );

  return jsonb_build_object(
    'success', true,
    'narration', v_clamped
  );
end;
$$;

revoke all on function public.narrate_game_master(uuid, text, text) from public, anon;
grant execute on function public.narrate_game_master(uuid, text, text) to authenticated;

-- 4. Update start_game to initialize ai_gm parameters -------------------------
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
  v_gm_interval := coalesce((current_game.mode_params->'ai_gm'->>'event_interval_s')::int, 180);
  v_gm_max := coalesce((current_game.mode_params->'ai_gm'->>'max_events')::int, 12);

  v_new_mode_params := coalesce(current_game.mode_params, '{}'::jsonb);

  if current_game.mode_id = 'territory_pulse' then
    v_new_mode_params := v_new_mode_params || jsonb_build_object(
      'territory_pulse', jsonb_build_object(
        'pulse_interval_s', v_pulse_int,
        'next_pulse_at', live_starts + make_interval(secs => v_pulse_int),
        'last_pulse_at', null,
        'pulse_seq', 0,
        'scores', jsonb_build_object('runner', 0, 'hunter', 0),
        'dominance_pct', coalesce((current_game.mode_params->'territory_pulse'->>'dominance_pct')::int, 70),
        'consecutive_dominance', jsonb_build_object('runner', 0, 'hunter', 0)
      )
    );
  end if;

  if 'ai_gm' = any(current_game.modifiers) then
    v_new_mode_params := v_new_mode_params || jsonb_build_object(
      'ai_gm', jsonb_build_object(
        'is_active', true,
        'event_interval_s', v_gm_interval,
        'max_events', v_gm_max,
        'event_count', 0,
        'last_event_type', null,
        'last_title', null,
        'last_narration', null,
        'last_event_at', null,
        'next_event_at', to_char(live_starts + make_interval(secs => v_gm_interval), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'shrink_scale', 1.0,
        'fog_active_until', null
      )
    );
  end if;

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
        mode_params = v_new_mode_params
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

  insert into public.events (game_id, type, payload)
  values (current_game.id, 'game_countdown_started', jsonb_build_object('countdown_ends', countdown_ends));

  if 'ai_gm' = any(current_game.modifiers) then
    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'game_master_init',
      'all',
      jsonb_build_object(
        'message', 'AI Game Master operational. Sector surveillance active.',
        'event_interval_s', v_gm_interval,
        'max_events', v_gm_max
      )
    );
  end if;

  return jsonb_build_object(
    'phase', current_game.status,
    'head_start_at', current_game.head_start_at,
    'live_at', current_game.live_at,
    'ends_at', current_game.ends_at
  );
end;
$$;

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;

-- 5. Update resume_game to adjust ai_gm deadlines -----------------------------
create or replace function public.resume_game(game_id uuid)
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
  caller_name text;
  v_paused_at timestamptz;
  v_pre_status public.game_status;
  v_pause_delta interval;
  v_new_mode_params jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g where g.id = resume_game.game_id for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players p where p.game_id = resume_game.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found then raise exception 'You are not an active member of this game.'; end if;

  if current_game.status <> 'paused' then
    return jsonb_build_object('success', false, 'reason', 'game_not_paused', 'phase', current_game.status);
  end if;

  v_paused_at := (current_game.mode_params->'safety'->>'paused_at')::timestamptz;
  v_pre_status := coalesce((current_game.mode_params->'safety'->>'pre_pause_status')::public.game_status, 'live'::public.game_status);

  if v_paused_at is not null then
    v_pause_delta := clock_timestamp() - v_paused_at;
  else
    v_pause_delta := interval '0 seconds';
  end if;

  select display_name into caller_name from public.profiles where id = caller_id;

  v_new_mode_params := current_game.mode_params;
  v_new_mode_params := jsonb_set(v_new_mode_params, '{safety,paused_at}', 'null'::jsonb);
  v_new_mode_params := jsonb_set(v_new_mode_params, '{safety,resumed_at}', to_jsonb(to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  v_new_mode_params := jsonb_set(v_new_mode_params, '{safety,pause_votes}', '{}'::jsonb);

  -- Adjust mode-specific pulse or curfew timers if present
  if v_new_mode_params ? 'territory_pulse' and (v_new_mode_params->'territory_pulse'->>'next_pulse_at') is not null then
    v_new_mode_params := jsonb_set(
      v_new_mode_params,
      '{territory_pulse,next_pulse_at}',
      to_jsonb(to_char((v_new_mode_params->'territory_pulse'->>'next_pulse_at')::timestamptz + v_pause_delta, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  end if;

  if (v_new_mode_params->'safety'->>'curfew_at') is not null then
    v_new_mode_params := jsonb_set(
      v_new_mode_params,
      '{safety,curfew_at}',
      to_jsonb(to_char((v_new_mode_params->'safety'->>'curfew_at')::timestamptz + v_pause_delta, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  end if;

  -- Adjust AI Game Master next_event_at and fog_active_until
  if v_new_mode_params ? 'ai_gm' then
    if (v_new_mode_params->'ai_gm'->>'next_event_at') is not null then
      v_new_mode_params := jsonb_set(
        v_new_mode_params,
        '{ai_gm,next_event_at}',
        to_jsonb(to_char((v_new_mode_params->'ai_gm'->>'next_event_at')::timestamptz + v_pause_delta, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      );
    end if;
    if (v_new_mode_params->'ai_gm'->>'fog_active_until') is not null then
      v_new_mode_params := jsonb_set(
        v_new_mode_params,
        '{ai_gm,fog_active_until}',
        to_jsonb(to_char((v_new_mode_params->'ai_gm'->>'fog_active_until')::timestamptz + v_pause_delta, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      );
    end if;
  end if;

  update public.games
  set status = v_pre_status,
      ends_at = ends_at + v_pause_delta,
      next_ping_at = next_ping_at + v_pause_delta,
      live_at = case when live_at is not null then live_at + v_pause_delta else null end,
      head_start_at = case when head_start_at is not null then head_start_at + v_pause_delta else null end,
      mode_params = v_new_mode_params
  where id = current_game.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'game_resumed',
    'all',
    jsonb_build_object(
      'player_id', me.id,
      'user_id', caller_id,
      'display_name', caller_name,
      'resumed_at', clock_timestamp(),
      'pause_duration_s', extract(epoch from v_pause_delta)::int,
      'message', caller_name || ' resumed the game!'
    )
  );

  return jsonb_build_object(
    'success', true,
    'phase', v_pre_status,
    'pause_duration_s', extract(epoch from v_pause_delta)::int
  );
end;
$$;

revoke all on function public.resume_game(uuid) from public, anon;
grant execute on function public.resume_game(uuid) to authenticated;

-- 6. Update advance_game to auto-trigger ai_gm events -------------------------
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

  if current_game.status in ('ended', 'cancelled', 'paused') then
    return current_game.status;
  end if;

  -- Curfew safety check
  if current_game.status in ('live', 'head_start') and (current_game.mode_params->'safety'->>'curfew_at') is not null then
    if clock_timestamp() >= (current_game.mode_params->'safety'->>'curfew_at')::timestamptz then
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'curfew_reached', 'all',
        jsonb_build_object('curfew_at', current_game.mode_params->'safety'->>'curfew_at', 'message', 'Curfew reached. Round automatically concluded for safety.')
      );
      perform public.end_game(current_game.id, 'runners', 'curfew_reached');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
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

      for v_zone_rec in
        select id, geog, state from public.entities
        where entities.game_id = current_game.id and kind = 'zone'
        order by (state->>'zone_index')::int asc
      loop
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
          if v_prevailing is not null then
            v_ctrl := v_prevailing;
            v_cont := null;
            v_cont_p := 0;
          end if;
        else
          if v_prevailing = v_ctrl then
            v_cont := null;
            v_cont_p := 0;
          elsif v_prevailing is not null and v_prevailing <> v_ctrl then
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

        update public.entities
        set state = v_zone_rec.state || jsonb_build_object(
              'controller', v_ctrl,
              'contender', v_cont,
              'contender_pulses', v_cont_p,
              'last_pulse_seq', v_tp_seq,
              'runners_present', v_z_runners,
              'hunters_present', v_z_hunters
            ),
            updated_at = now()
        where entities.id = v_zone_rec.id;

        if v_ctrl = 'runner' then
          v_r_score := v_r_score + 1;
          v_r_controlled := v_r_controlled + 1;
        elsif v_ctrl = 'hunter' then
          v_h_score := v_h_score + 1;
          v_h_controlled := v_h_controlled + 1;
        end if;
      end loop;

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

      if patrol_geom is not null and extensions.st_geometrytype(patrol_geom) in ('ST_LineString', 'ST_MultiLineString') then
        duration_s := coalesce((ghost_rec.state->>'duration_s')::integer, 300);
        effective_duration_s := greatest(30, duration_s);
        elapsed_s := extract(epoch from (clock_timestamp() - current_game.live_at));

        if current_game.mode_id = 'ghost_duel' then
          loop_frac := least(1.0, greatest(0.0, elapsed_s / effective_duration_s::double precision));
        else
          loop_frac := (elapsed_s - floor(elapsed_s / effective_duration_s::double precision) * effective_duration_s::double precision) / effective_duration_s::double precision;
        end if;

        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        update public.entities
        set geog = current_ghost_pt::extensions.geography,
            state = ghost_rec.state || jsonb_build_object(
              'last_interpolated_at', clock_timestamp(),
              'loop_fraction', round(loop_frac::numeric, 4),
              'elapsed_s', round(elapsed_s::numeric, 1),
              'lat', extensions.st_y(current_ghost_pt),
              'lng', extensions.st_x(current_ghost_pt)
            ),
            updated_at = now()
        where entities.id = ghost_rec.id;

        -- Sighting ping logic for haunted_map
        if current_game.mode_id = 'haunted_map' then
          for runner_fix in
            select pp.player_id, pp.geog, pp.accuracy_m, pp.recorded_at
            from public.player_positions pp
            join public.players p on p.id = pp.player_id
            where pp.game_id = current_game.id
              and p.team = 'runner'
              and p.status = 'active'
              and not p.is_remote
              and extensions.st_dwithin(pp.geog, current_ghost_pt::geography, 40)
              and pp.recorded_at > clock_timestamp() - interval '45 seconds'
          loop
            select coalesce(max(seq), 0) + 1 into v_ghost_ping_seq from public.pings where pings.game_id = current_game.id;
            insert into public.pings (game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at)
            values (
              current_game.id,
              v_ghost_ping_seq,
              runner_fix.player_id,
              runner_fix.geog,
              runner_fix.accuracy_m,
              extract(epoch from (clock_timestamp() - runner_fix.recorded_at))::integer,
              'ghost_sighting',
              clock_timestamp()
            );
            insert into public.events (game_id, type, audience, payload)
            values (
              current_game.id,
              'ghost_sighting',
              'all',
              jsonb_build_object(
                'ghost_id', ghost_rec.id,
                'runner_id', runner_fix.player_id,
                'message', 'A wandering ghost spotted a runner!'
              )
            );
          end loop;
        end if;
      end if;
    end loop;
  end if;

  -- Shrinking zone evaluation
  zone_on := ('shrinking_zone' = any(current_game.modifiers) or 'zone' = any(current_game.modifiers));
  if zone_on and current_game.status in ('live', 'head_start') then
    stages := public.zone_stage_values(current_game.id);
    stage_count := array_length(stages, 1);
    base_radius := current_game.area_radius_m;

    if stage_count > 0 and current_game.duration_s > 0 then
      target_interval_s := current_game.duration_s::double precision / (stage_count + 1)::double precision;
      elapsed_s := extract(epoch from (clock_timestamp() - current_game.live_at));
      current_stage := least(stage_count, greatest(0, floor(elapsed_s / target_interval_s)::integer));
      prev_stage := coalesce(current_game.zone_stage, 0);

      if current_stage <> prev_stage then
        update public.games set zone_stage = current_stage where id = current_game.id;
        current_game.zone_stage := current_stage;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id,
          'zone_shrink_stage',
          'all',
          jsonb_build_object(
            'stage', current_stage,
            'effective_radius_m', public.effective_radius_m(current_game.id),
            'message', 'Zone has shrunk to stage ' || current_stage::text
          )
        );
      end if;
    end if;
  end if;

  -- AI Game Master Auto-trigger
  if current_game.status = 'live' and ('ai_gm' = any(current_game.modifiers)) then
    if (current_game.mode_params->'ai_gm'->>'next_event_at') is not null
       and clock_timestamp() >= (current_game.mode_params->'ai_gm'->>'next_event_at')::timestamptz then
      perform public.trigger_game_master_event(current_game.id);
      -- reload current_game so subsequent steps have updated mode_params
      select * into current_game from public.games g where g.id = advance_game.game_id;
    end if;
  end if;

  -- Scheduled runner pings
  if current_game.status = 'live' and clock_timestamp() >= current_game.next_ping_at then
    select coalesce(max(seq), 0) + 1 into ping_count from public.pings where pings.game_id = current_game.id;
    update public.games g set ping_seq = ping_count where g.id = current_game.id;

    for runner in
      select pp.player_id, pp.geog, pp.accuracy_m, pp.recorded_at, p.id as p_id
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      where pp.game_id = current_game.id
        and p.team = 'runner'
        and p.status = 'active'
        and not coalesce(p.is_remote, false)
        and pp.recorded_at > clock_timestamp() - interval '60 seconds'
    loop
      ping_geog := runner.geog;

      if 'double_agent' = any(current_game.roles) and exists (
        select 1 from public.entities e
        where e.game_id = current_game.id and e.kind = 'scramble' and (e.state->>'runner_id')::uuid = runner.p_id
      ) then
        shift_m := 150 + (random() * 100);
        bearing := random() * 360;
        ping_geog := extensions.st_project(runner.geog, shift_m, radians(bearing))::extensions.geography;
        delete from public.entities where game_id = current_game.id and kind = 'scramble' and (state->>'runner_id')::uuid = runner.p_id;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'agent_scramble_applied', 'all',
          jsonb_build_object('runner_id', runner.p_id, 'shift_m', round(shift_m::numeric, 1))
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

revoke all on function public.advance_game(uuid) from public, anon;
grant execute on function public.advance_game(uuid) to authenticated;

-- 7. Update get_game_state to expose ai_gm snapshot ---------------------------
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
      'paused_by', current_game.mode_params->'safety'->>'paused_by',
      'paused_by_name', (
        select pr.display_name from public.profiles pr
        where pr.id = (current_game.mode_params->'safety'->>'paused_by')::uuid
      ),
      'pause_reason', current_game.mode_params->'safety'->>'pause_reason',
      'pause_votes', coalesce(current_game.mode_params->'safety'->'pause_votes', '{}'::jsonb),
      'curfew_at', current_game.mode_params->'safety'->>'curfew_at',
      'is_night', (
        extract(hour from clock_timestamp() at time zone 'UTC') in (20, 21, 22, 23, 0, 1, 2, 3, 4, 5)
      ),
      'vehicle_warning', coalesce((mine.status_detail->>'vehicle_warning')::boolean, false)
    ),
    'game', to_jsonb(current_game) || jsonb_build_object(
      'area', jsonb_build_object(
        'longitude', extensions.st_x(current_game.area_center::extensions.geometry),
        'latitude', extensions.st_y(current_game.area_center::extensions.geometry),
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

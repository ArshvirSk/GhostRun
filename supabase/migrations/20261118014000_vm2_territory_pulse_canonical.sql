-- Migration: 20261118014000_vm2_territory_pulse_canonical.sql
-- VM2: Territory Pulse (territory_pulse) Canonical Fixes
-- Discrepancy X-21: Restore canonical Milestone B8 pulse evaluation loop in advance_game
-- (fixes regression where pulse loop wrote owner_team instead of controller/contender/contender_pulses,
-- restoring 2-pulse hostile flip mechanics, dominance tracking, and get_game_state compatibility).
-- NOTE: Prepared locally on modes/territory-pulse per user directive "hold till fix".

-- 1. Canonical start_game -----------------------------------------------------
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
  chosen_agent_id uuid;
  agent_charges integer;
  agent_cooldown integer;
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
        'next_pulse_at', clock_timestamp() + make_interval(secs => current_game.countdown_s + current_game.head_start_s + v_pulse_int),
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
        'next_event_at', clock_timestamp() + make_interval(secs => current_game.countdown_s + current_game.head_start_s + v_gm_interval),
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

  -- For Relay Heist mode, assign initial carrier
  if current_game.mode_id = 'relay_heist' then
    select p.id into chosen_carrier_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and not p.is_remote
    order by random()
    limit 1;

    if chosen_carrier_id is not null then
      update public.entities
      set state = jsonb_build_object('carrier_player_id', chosen_carrier_id, 'status', 'carried', 'next_carrier_ping_at', clock_timestamp() + make_interval(secs => greatest(10, current_game.ping_interval_s * 2 / 3)))
      where entities.game_id = current_game.id and entities.kind = 'package';

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

  countdown_ends := clock_timestamp() + make_interval(secs => current_game.countdown_s);
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);
  round_ends := live_starts + make_interval(secs => current_game.duration_s);

  update public.games g
    set status = 'countdown',
        started_at = clock_timestamp(),
        head_start_at = countdown_ends,
        live_at = live_starts,
        ends_at = round_ends,
        next_ping_at = live_starts + make_interval(secs => current_game.ping_interval_s),
        ping_seq = 0
    where g.id = current_game.id;

  update public.players p
    set status = 'active'
    where p.game_id = current_game.id and p.status in ('lobby', 'joined');

  insert into public.events (game_id, type, payload)
    values (current_game.id, 'game_started', jsonb_build_object('status', 'countdown'));

  return jsonb_build_object('status', 'countdown', 'head_start_at', countdown_ends, 'live_at', live_starts);
end;
$$;

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;

-- 2. Canonical advance_game with restored Territory Pulse 2-pulse loop ---------
create or replace function public.advance_game(game_id uuid)
returns public.game_status
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  current_game public.games%rowtype;
  runner record;
  hunter record;
  runner_fix record;
  pkg_offline record;
  active_vip record;
  promoted_bodyguard record;
  carrier_rec record;
  ping_count integer;
  active_survivors integer;
  v_r_score integer;
  v_h_score integer;
  v_next_carrier_ping timestamptz;
  v_carrier_ping_seq integer;
  v_scramble_applied boolean;
  v_scramble_dist double precision;
  v_scramble_bearing double precision;
  v_scramble_pt geometry;
  v_scramble_geog geography;
  ghost_rec record;
  patrol_geom geometry;
  duration_s integer;
  effective_duration_s integer;
  elapsed_s double precision;
  loop_frac double precision;
  current_ghost_pt geometry;
  v_duel_variant text;
  v_ghost_ping_seq integer;

  -- Territory Pulse locals
  v_tp_next timestamptz;
  v_tp_seq integer;
  v_tp_interval integer;
  v_r_controlled integer;
  v_h_controlled integer;
  v_r_dom integer;
  v_h_dom integer;
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
        perform public.end_game(current_game.id, null, 'draw');
      end if;
    elsif current_game.mode_id = 'relay_heist' then
      perform public.end_game(current_game.id, 'hunters', 'time_expired');
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

  -- Territory Pulse: synchronous pulse evaluation tick (X-21 Canonical B8 Restoration)
  if current_game.status = 'live' and current_game.mode_id = 'territory_pulse' then
    v_tp_next := (current_game.mode_params->'territory_pulse'->>'next_pulse_at')::timestamptz;
    v_tp_interval := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_interval_s')::int, 90);

    if v_tp_next is not null and clock_timestamp() >= v_tp_next then
      v_tp_seq := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_seq')::int, 0) + 1;
      v_r_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'runner')::int, 0);
      v_h_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'hunter')::int, 0);
      v_r_controlled := 0;
      v_h_controlled := 0;
      v_r_dom := coalesce((current_game.mode_params->'territory_pulse'->'consecutive_dominance'->>'runner')::int, 0);
      v_h_dom := coalesce((current_game.mode_params->'territory_pulse'->'consecutive_dominance'->>'hunter')::int, 0);

      -- Loop through each zone entity
      for v_zone_rec in
        select id, geog, state from public.entities
        where entities.game_id = current_game.id and kind = 'zone'
        order by (state->>'zone_index')::int asc
      loop
        -- Count active runners present in zone (not remote, not incapacitated, fresh GPS)
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

        -- Count active hunters present in zone (not remote, not incapacitated, fresh GPS)
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

        -- Determine prevailing majority
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

        -- Update zone entity with canonical controller and contender fields
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
            updated_at = clock_timestamp()
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

  -- Jailbreak: auto-release evaluation
  if current_game.status = 'live' and current_game.mode_id = 'jailbreak' then
    for runner in
      select p.id, p.display_name, (p.status_detail->>'jailed_at')::timestamptz as jailed_time
      from public.players p
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

  -- Relay Heist: carrier offline drop (60s inactivity)
  if current_game.status = 'live' and current_game.mode_id = 'relay_heist' then
    for pkg_offline in
      select e.id as entity_id, e.state, (e.state->>'carrier_player_id')::uuid as carrier_id,
             pp.recorded_at as last_fix_at, pp.geog as carrier_geog
      from public.entities e
      left join public.player_positions pp on pp.player_id = (e.state->>'carrier_player_id')::uuid
      where e.game_id = current_game.id and e.kind = 'package' and (e.state->>'status') = 'carried'
    loop
      if pkg_offline.carrier_id is not null then
        if pkg_offline.last_fix_at is null or clock_timestamp() - pkg_offline.last_fix_at > interval '60 seconds' then
          update public.entities
          set geog = coalesce(pkg_offline.carrier_geog, current_game.area_center),
              state = jsonb_build_object(
                'status', 'dropped',
                'dropped_at', clock_timestamp(),
                'carrier_player_id', null,
                'drop_reason', 'carrier_offline'
              ),
              updated_at = clock_timestamp()
          where id = pkg_offline.entity_id;

          update public.players
          set status_detail = jsonb_set(coalesce(status_detail, '{}'::jsonb), '{is_carrier}', 'false'::jsonb)
          where id = pkg_offline.carrier_id;

          insert into public.events (game_id, type, audience, payload)
          values (
            current_game.id, 'package_dropped', 'all',
            jsonb_build_object(
              'carrier_player_id', pkg_offline.carrier_id,
              'reason', 'carrier_offline',
              'message', 'Package dropped! Carrier disconnected.'
            )
          );
        end if;
      end if;
    end loop;
  end if;

  -- VIP Escort: VIP offline auto-promotion (60s inactivity)
  if current_game.status = 'live' and ('vip' = any(current_game.roles)) then
    for active_vip in
      select p.id as vip_id, pp.recorded_at as last_fix_at, pp.geog as vip_geog
      from public.players p
      left join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and p.secret_role = 'vip'
    loop
      if active_vip.last_fix_at is null or clock_timestamp() - active_vip.last_fix_at > interval '60 seconds' then
        select p.* into promoted_bodyguard
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
          and p.secret_role = 'bodyguard' and not p.is_remote
          and pp.recorded_at > clock_timestamp() - interval '30 seconds'
        order by extensions.st_distance(pp.geog, coalesce(active_vip.vip_geog, current_game.area_center)) asc
        limit 1;

        if promoted_bodyguard.id is null then
          select p.* into promoted_bodyguard
          from public.players p
          where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
            and p.secret_role = 'bodyguard' and not p.is_remote
          order by p.created_at asc
          limit 1;
        end if;

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
        effective_duration_s := greatest(30, floor(duration_s / coalesce((ghost_rec.state->>'speed_scale')::real, 1.0))::integer);
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
            updated_at = clock_timestamp()
        where entities.id = ghost_rec.id;

        -- Mirror chase timeout check: if ghost runner reached path end before tag
        if current_game.mode_id = 'ghost_duel' and v_duel_variant = 'mirror_chase' and elapsed_s >= effective_duration_s then
          perform public.end_game(current_game.id, 'runners', 'ghost_escaped');
          select * into current_game from public.games g where g.id = advance_game.game_id;
          return current_game.status;
        end if;

        -- Evade collision check in advance_game
        if current_game.mode_id = 'ghost_duel' and v_duel_variant = 'evade' then
          for runner_fix in
            select pp.player_id, pp.geog
            from public.player_positions pp
            join public.players p on p.id = pp.player_id
            where pp.game_id = current_game.id and p.status = 'active'
              and pp.recorded_at > clock_timestamp() - interval '20 seconds'
          loop
            if extensions.st_dwithin(runner_fix.geog, current_ghost_pt::extensions.geography, 20.0) then
              perform public.end_game(current_game.id, 'hunters', 'haunted');
              select * into current_game from public.games g where g.id = advance_game.game_id;
              return current_game.status;
            end if;
          end loop;
        end if;

        -- Haunted Map sighting ping logic
        if current_game.mode_id = 'haunted_map' then
          for runner_fix in
            select pp.player_id, pp.geog, pp.accuracy_m, pp.recorded_at
            from public.player_positions pp
            join public.players p on p.id = pp.player_id
            where pp.game_id = current_game.id
              and p.team = 'runner'
              and p.status = 'active'
              and not p.is_remote
              and extensions.st_dwithin(pp.geog, current_ghost_pt::extensions.geography, 40)
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

  -- Relay Heist: Carrier extra radar ping release (1.5x cadence)
  if current_game.status = 'live' and current_game.mode_id = 'relay_heist' then
    for carrier_rec in
      select p.id as carrier_id, pp.geog as carrier_geog, pp.accuracy_m, pp.recorded_at,
             (e.state->>'next_carrier_ping_at')::timestamptz as next_carrier_ping
      from public.players p
      join public.entities e on e.game_id = current_game.id and e.kind = 'package' and (e.state->>'carrier_player_id')::uuid = p.id
      join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
    loop
      if carrier_rec.next_carrier_ping is not null and clock_timestamp() >= carrier_rec.next_carrier_ping then
        select coalesce(max(seq), 0) + 1 into v_carrier_ping_seq from public.pings where pings.game_id = current_game.id;
        insert into public.pings (game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at)
        values (
          current_game.id,
          v_carrier_ping_seq,
          carrier_rec.carrier_id,
          carrier_rec.carrier_geog,
          carrier_rec.accuracy_m,
          extract(epoch from (clock_timestamp() - carrier_rec.recorded_at))::integer,
          'carrier_pulse',
          clock_timestamp()
        );

        v_next_carrier_ping := clock_timestamp() + make_interval(secs => greatest(10, current_game.ping_interval_s * 2 / 3));
        update public.entities
        set state = jsonb_set(state, '{next_carrier_ping_at}', to_jsonb(v_next_carrier_ping)),
            updated_at = clock_timestamp()
        where entities.game_id = current_game.id and entities.kind = 'package';

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'carrier_ping_released', 'all',
          jsonb_build_object('carrier_id', carrier_rec.carrier_id, 'seq', v_carrier_ping_seq)
        );
      end if;
    end loop;
  end if;

  -- AI Game Master Auto-trigger
  if current_game.status = 'live' and ('ai_gm' = any(current_game.modifiers)) then
    if (current_game.mode_params->'ai_gm'->>'next_event_at') is not null
       and clock_timestamp() >= (current_game.mode_params->'ai_gm'->>'next_event_at')::timestamptz then
      perform public.trigger_game_master_event(current_game.id);
    end if;
  end if;

  -- Scheduled runner pings (with Double Agent scramble displacement support)
  if current_game.status = 'live' and clock_timestamp() >= current_game.next_ping_at then
    select coalesce(max(seq), 0) + 1 into ping_count from public.pings where pings.game_id = current_game.id;
    update public.games g set ping_seq = ping_count where g.id = current_game.id;

    for runner in
      select p.id as p_id, p.status_detail, pp.geog, pp.accuracy_m, pp.recorded_at
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.status = 'active'
          and not p.is_remote
          and pp.recorded_at > clock_timestamp() - interval '45 seconds'
    loop
      v_scramble_applied := false;
      v_scramble_geog := runner.geog;

      if (runner.status_detail->>'scramble') = 'true'
         or exists (select 1 from public.entities where entities.game_id = current_game.id and kind = 'scramble' and (state->>'runner_id')::uuid = runner.p_id) then
        v_scramble_dist := 150.0 + (random() * 100.0);
        v_scramble_bearing := random() * 360.0;
        v_scramble_pt := extensions.st_project(runner.geog, v_scramble_dist, radians(v_scramble_bearing))::geometry;

        if extensions.st_distance(v_scramble_pt::geography, current_game.area_center) > current_game.area_radius_m then
          v_scramble_pt := extensions.st_project(
            current_game.area_center,
            greatest(10, current_game.area_radius_m - 20),
            extensions.st_azimuth(current_game.area_center::geometry, v_scramble_pt)
          )::geometry;
        end if;

        v_scramble_geog := v_scramble_pt::geography;
        v_scramble_applied := true;

        update public.players
        set status_detail = coalesce(status_detail, '{}'::jsonb) - 'scramble'
        where id = runner.p_id;

        delete from public.entities
        where entities.game_id = current_game.id and kind = 'scramble' and (state->>'runner_id')::uuid = runner.p_id;

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'agent_scramble_applied', 'all',
          jsonb_build_object('runner_id', runner.p_id, 'displacement_m', round(v_scramble_dist::numeric, 1))
        );
      end if;

      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
      ) values (
        current_game.id,
        ping_count,
        runner.p_id,
        v_scramble_geog,
        runner.accuracy_m,
        extract(epoch from (clock_timestamp() - runner.recorded_at))::integer,
        case when v_scramble_applied then 'scheduled_scrambled' else 'scheduled' end,
        clock_timestamp()
      );
    end loop;

    update public.games g
      set next_ping_at = clock_timestamp() + make_interval(secs => current_game.ping_interval_s)
      where g.id = current_game.id;

    insert into public.events (game_id, type, payload)
      values (current_game.id, 'ping_released', jsonb_build_object('seq', ping_count));
  end if;

  select * into current_game from public.games g where g.id = advance_game.game_id;
  return current_game.status;
end;
$$;

revoke all on function public.advance_game(uuid) from public, anon;
grant execute on function public.advance_game(uuid) to authenticated;

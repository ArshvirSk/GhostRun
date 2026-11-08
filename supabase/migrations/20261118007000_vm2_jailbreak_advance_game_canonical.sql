-- Migration: 20261118007000_vm2_jailbreak_advance_game_canonical.sql
-- Restores canonical Jailbreak auto-release and all-jailed check inside advance_game,
-- and enforces runner-only team check in cancel_rescue.

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

  -- Jailbreak locals
  v_auto_release_s integer;
  jailed_rec record;
  active_runners_count integer;
  jailed_runners_count integer;

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

  -- Jailbreak Live Loop: Auto-release after timeout and all-jailed check
  if current_game.status = 'live' and current_game.mode_id = 'jailbreak' then
    v_auto_release_s := coalesce((current_game.mode_params->'jailbreak'->>'auto_release_s')::integer, 300);

    for jailed_rec in
      select p.id, p.user_id, pr.display_name
      from public.players p
      left join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id
        and p.team = 'runner'
        and p.status = 'jailed'
        and p.tagged_at is not null
        and clock_timestamp() >= p.tagged_at + make_interval(secs => v_auto_release_s)
    loop
      update public.players p
        set status = 'active', tagged_at = null
        where p.id = jailed_rec.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'runner_auto_released',
        'all',
        jsonb_build_object(
          'player_id', jailed_rec.id,
          'display_name', jailed_rec.display_name
        )
      );
    end loop;

    -- All-jailed win check: if no active runners remain and some are jailed
    select count(*) filter (where p.status = 'active'),
           count(*) filter (where p.status = 'jailed')
      into active_runners_count, jailed_runners_count
      from public.players p
      where p.game_id = current_game.id and p.team = 'runner' and not coalesce(p.is_remote, false);

    if active_runners_count = 0 and jailed_runners_count > 0 then
      perform public.end_game(current_game.id, 'hunters', 'all_jailed');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
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

create or replace function public.cancel_rescue(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into me from public.players p
    where p.game_id = cancel_rescue.game_id and p.user_id = caller_id and p.status <> 'left'
    for update;
  if not found then raise exception 'You are not a player in this game.'; end if;
  if me.team <> 'runner' then raise exception 'Only runners can cancel rescue.'; end if;

  update public.players
    set status_detail = status_detail - 'free_started_at'
    where id = me.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    cancel_rescue.game_id,
    'rescue_cancelled',
    'runner',
    jsonb_build_object('player_id', me.id)
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.cancel_rescue(uuid) from public, anon;
grant execute on function public.cancel_rescue(uuid) to authenticated;

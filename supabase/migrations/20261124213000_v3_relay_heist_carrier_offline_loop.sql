-- Migration: 20261124213000_v3_relay_heist_carrier_offline_loop.sql
-- VM2 / v3 Parity: Restore Relay Heist carrier offline auto-drop loop into advance_game
-- Rule: If an active carrier goes offline for > 60s without a GPS fix, the package automatically
-- drops at the carrier's last known location and becomes visible to all players.

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
  new_seq integer;
  live_runners integer;
  active_runners integer;
  active_hunters integer;
  now_time timestamptz := clock_timestamp();
  runner record;
  active_vip record;
  promoted_bodyguard record;
  ghost_ent public.entities%rowtype;
  v_last_step timestamptz;
  v_elapsed_s integer;
  v_step_int integer := 2;
  v_next_pt extensions.geography;
  v_next_head double precision;
  v_runner_near boolean;
  v_hunter_near boolean;
  v_next_carrier_ping timestamptz;
  v_heist_carrier record;
  v_package_state jsonb;
  v_package_dropped_at timestamptz;
  v_pulse_int integer;
  v_next_pulse timestamptz;
  v_pulse_seq integer;
  v_runner_score integer;
  v_hunter_score integer;
  v_sector record;
  v_sector_runners integer;
  v_sector_hunters integer;
  v_controller text;
  v_contender text;
  v_contender_pulses integer;
  v_runner_zones integer := 0;
  v_hunter_zones integer := 0;
  v_runner_consec integer;
  v_hunter_consec integer;
  v_pulse_scores jsonb;
  v_new_mode_params jsonb;
  v_gm_next timestamptz;
  v_gm_interval integer;
  v_gm_event_type text;
  v_gm_title text;
  v_gm_narration text;
  v_gm_count integer;
  v_gm_max integer;
  v_stages numeric[];
  v_stage_count integer;
  v_progress double precision;
  v_stage_idx integer;
  v_next_stage integer;
  v_next_start timestamptz;
begin
  select * into current_game
    from public.games g
    where g.id = advance_game.game_id
    for update;

  if not found then
    raise exception 'Game not found.';
  end if;

  if current_game.status = 'countdown' and clock_timestamp() >= current_game.head_start_at then
    if current_game.head_start_s > 0 then
      update public.games g
        set status = 'head_start'
        where g.id = current_game.id;
      insert into public.events (game_id, type, payload)
        values (current_game.id, 'game_live', jsonb_build_object('phase', 'head_start'));
      select * into current_game from public.games g where g.id = advance_game.game_id;
    else
      update public.games g
        set status = 'live'
        where g.id = current_game.id;
      insert into public.events (game_id, type, payload)
        values (current_game.id, 'game_live', jsonb_build_object('phase', 'live'));
      select * into current_game from public.games g where g.id = advance_game.game_id;
    end if;
  end if;

  if current_game.status = 'head_start' and clock_timestamp() >= current_game.live_at then
    update public.games g
      set status = 'live'
      where g.id = current_game.id;
    insert into public.events (game_id, type, payload)
      values (current_game.id, 'head_start_ended', jsonb_build_object('phase', 'live'));
    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  -- Curfew safety check: round concludes if current curfew deadline is reached
  if current_game.status in ('live', 'head_start') and (current_game.mode_params->'safety'->>'curfew_at') is not null then
    if clock_timestamp() >= (current_game.mode_params->'safety'->>'curfew_at')::timestamptz then
      perform public.end_game(current_game.id, null, 'curfew_reached');
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'game_ended', 'all',
        jsonb_build_object('curfew_at', current_game.mode_params->'safety'->>'curfew_at', 'message', 'Curfew reached. Round automatically concluded for safety.')
      );
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  if current_game.status = 'live' and clock_timestamp() >= current_game.ends_at then
    if current_game.mode_id = 'assassin_ring' then
      perform public.end_game(current_game.id, 'draw', 'time_expired');
    elsif current_game.mode_id = 'ghost_duel' then
      perform public.end_game(current_game.id, null, 'time_expired');
    elsif current_game.mode_id = 'territory_pulse' then
      v_runner_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'runner')::int, 0);
      v_hunter_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'hunter')::int, 0);
      if v_runner_score > v_hunter_score then
        perform public.end_game(current_game.id, 'runners', 'time_expired');
      elsif v_hunter_score > v_runner_score then
        perform public.end_game(current_game.id, 'hunters', 'time_expired');
      else
        perform public.end_game(current_game.id, 'draw', 'time_expired');
      end if;
    else
      perform public.end_game(current_game.id, 'runners', 'time_expired');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
    return current_game.status;
  end if;

  -- Shrinking zone evaluation (safe using zone_stage_at and zone_stage_values)
  if current_game.status = 'live'
     and ('shrinking_zone' = any(current_game.modifiers) or (current_game.mode_params->'ai_gm'->>'shrink_scale') is not null)
     and current_game.live_at is not null
     and current_game.duration_s > 0 then
    v_stages := public.zone_stage_values(current_game.id);
    v_stage_count := array_length(v_stages, 1);
    v_progress := greatest(
      0.0,
      least(1.0, extract(epoch from (clock_timestamp() - current_game.live_at)) / current_game.duration_s)
    );
    v_stage_idx := public.zone_stage_at(current_game.id, v_progress);

    if current_game.zone_stage = 0 then
      update public.games g set zone_stage = 1 where g.id = current_game.id returning * into current_game;
    elsif v_stage_idx > current_game.zone_stage then
      update public.games g set zone_stage = v_stage_idx, zone_announced = v_stage_idx where g.id = current_game.id returning * into current_game;
      insert into public.events (game_id, type, payload)
      values (
        current_game.id, 'zone_shrunk',
        jsonb_build_object(
          'stage', v_stage_idx,
          'stages', v_stage_count,
          'percent', v_stages[v_stage_idx],
          'radius_m', round(current_game.area_radius_m * v_stages[v_stage_idx] / 100.0)
        )
      );
    end if;

    v_next_stage := current_game.zone_stage + 1;
    if v_next_stage <= v_stage_count and current_game.zone_announced < v_next_stage then
      v_next_start := current_game.live_at
        + make_interval(secs => (
            current_game.duration_s * (
              2.0 / 3.0 + (v_next_stage - 2) * (1.0 / 3.0) / (v_stage_count - 1)
            )
          )::double precision);
      if clock_timestamp() >= v_next_start - interval '60 seconds' then
        update public.games g set zone_announced = v_next_stage where g.id = current_game.id returning * into current_game;
        insert into public.events (game_id, type, payload)
        values (
          current_game.id, 'zone_shrink_soon',
          jsonb_build_object(
            'stage', v_next_stage,
            'stages', v_stage_count,
            'percent', v_stages[v_next_stage],
            'radius_m', round(current_game.area_radius_m * v_stages[v_next_stage] / 100.0),
            'at', v_next_start
          )
        );
      end if;
    end if;
  end if;

  -- Jailbreak: auto-release evaluation with profiles join for display_name
  if current_game.status = 'live' and current_game.mode_id = 'jailbreak' then
    for runner in
      select p.id,
             coalesce(pr.display_name, 'Runner') as display_name,
             coalesce((p.status_detail->>'jailed_at')::timestamptz, p.tagged_at) as jailed_time
      from public.players p
      left join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id and p.team = 'runner' and p.status = 'jailed'
    loop
      if runner.jailed_time is not null
         and clock_timestamp() >= runner.jailed_time + make_interval(secs => coalesce((current_game.mode_params->'jailbreak'->>'auto_release_s')::int, 300)) then
        update public.players
        set status = 'active',
            status_detail = coalesce(status_detail, '{}'::jsonb) || jsonb_build_object('released_reason', 'auto_release', 'released_at', clock_timestamp()) - 'jailed_at'
        where id = runner.id;

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'player_rescued', 'all',
          jsonb_build_object('player_id', runner.id, 'rescued_by', null, 'reason', 'auto_release', 'message', format('%s auto-released from jail!', runner.display_name))
        );
      end if;
    end loop;
  end if;

  -- Relay Heist: carrier offline auto-drop (> 60s without fix)
  if current_game.status = 'live' and current_game.mode_id = 'relay_heist' then
    for v_heist_carrier in
      select e.id as entity_id, p.id as carrier_id, pr.display_name, pp.geog as carrier_geog
      from public.entities e
      join public.players p on p.id = (e.state->>'carrier_player_id')::uuid
      join public.profiles pr on pr.id = p.user_id
      left join public.player_positions pp on pp.player_id = p.id
      where e.game_id = current_game.id
        and e.kind = 'package'
        and (e.state->>'status') = 'carried'
        and (pp.recorded_at is null or pp.recorded_at < clock_timestamp() - interval '60 seconds')
    loop
      update public.entities e
      set geog = coalesce(v_heist_carrier.carrier_geog, e.geog),
          state = jsonb_build_object(
            'status', 'dropped',
            'carrier_player_id', null,
            'dropped_at', clock_timestamp(),
            'securing_hunter_id', null,
            'securing_started_at', null
          ),
          visible_to = 'all',
          updated_at = clock_timestamp()
      where e.id = v_heist_carrier.entity_id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'package_dropped', 'all',
        jsonb_build_object(
          'carrier_id', v_heist_carrier.carrier_id,
          'carrier_name', v_heist_carrier.display_name,
          'reason', 'carrier_offline',
          'message', 'The carrier went offline. The package was dropped!'
        )
      );
    end loop;
  end if;

  -- VIP Escort: disconnect failover promotion
  if current_game.status = 'live' and 'vip' = any(current_game.roles) then
    for active_vip in
      select p.id as vip_id, pp.recorded_at as last_seen
      from public.players p
      left join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id and p.team = 'runner' and p.secret_role = 'vip' and p.status = 'active'
    loop
      if active_vip.last_seen is not null and clock_timestamp() > active_vip.last_seen + interval '90 seconds' then
        select p.id, coalesce(pr.display_name, 'Runner') as display_name into promoted_bodyguard
        from public.players p
        left join public.profiles pr on pr.id = p.user_id
        where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
          and p.secret_role = 'bodyguard' and not p.is_remote
        order by p.created_at asc
        limit 1;

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
    for ghost_ent in
      select * from public.entities
      where game_id = current_game.id and kind = 'ghost'
    loop
      v_last_step := (ghost_ent.state->>'last_step_at')::timestamptz;
      if v_last_step is null or clock_timestamp() >= v_last_step + make_interval(secs => v_step_int) then
        v_elapsed_s := greatest(0, extract(epoch from (clock_timestamp() - current_game.live_at))::int);

        if v_elapsed_s >= coalesce((ghost_ent.state->>'duration_s')::int, 240) then
          if current_game.mode_id = 'ghost_duel' then
            perform public.end_game(current_game.id, null, 'ghost_beaten');
            select * into current_game from public.games g where g.id = advance_game.game_id;
            return current_game.status;
          end if;
        else
          v_next_pt := extensions.st_project(
            ghost_ent.geog,
            coalesce((ghost_ent.state->>'speed_mps')::double precision, 1.4) * v_step_int,
            radians(coalesce((ghost_ent.state->>'heading')::double precision, 0.0))
          );
          v_next_head := coalesce((ghost_ent.state->>'heading')::double precision, 0.0);

          if extensions.st_distance(v_next_pt, current_game.area_center) > current_game.area_radius_m * 0.9 then
            v_next_head := mod((v_next_head + 180.0)::numeric, 360::numeric)::double precision;
            v_next_pt := extensions.st_project(
              ghost_ent.geog,
              coalesce((ghost_ent.state->>'speed_mps')::double precision, 1.4) * v_step_int,
              radians(v_next_head)
            );
          end if;

          update public.entities
          set geog = v_next_pt,
              state = jsonb_set(
                jsonb_set(
                  jsonb_set(state, '{last_step_at}', to_jsonb(to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
                  '{heading}', to_jsonb(v_next_head)
                ),
                '{elapsed_s}', to_jsonb(v_elapsed_s)
              )
          where id = ghost_ent.id;

          if current_game.mode_id = 'haunted_map' then
            select exists (
              select 1 from public.players p
              join public.player_positions pp on pp.player_id = p.id
              where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
                and pp.accuracy_m <= 30
                and extensions.st_dwithin(pp.geog, v_next_pt, 40)
            ) into v_runner_near;

            if v_runner_near then
              insert into public.pings (game_id, player_id, seq, geog, accuracy_m, position_age_s, reason, released_at)
              values (
                current_game.id, null, current_game.ping_seq + 1, v_next_pt, 15.0, 0,
                'ghost_sighting',
                clock_timestamp()
              );
              update public.games set ping_seq = current_game.ping_seq + 1 where id = current_game.id;
            end if;
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- Territory Pulse: 90s pulse evaluation & 2-pulse flip logic
  if current_game.status = 'live' and current_game.mode_id = 'territory_pulse' then
    v_pulse_int := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_interval_s')::int, 90);
    v_next_pulse := (current_game.mode_params->'territory_pulse'->>'next_pulse_at')::timestamptz;
    v_pulse_seq := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_seq')::int, 0);

    if v_next_pulse is not null and clock_timestamp() >= v_next_pulse then
      v_runner_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'runner')::int, 0);
      v_hunter_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'hunter')::int, 0);
      v_pulse_seq := v_pulse_seq + 1;

      for v_sector in
        select e.id, e.geog, e.state
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'zone'
      loop
        select count(*) into v_sector_runners
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
          and not coalesce(p.is_remote, false)
          and (p.status_detail->>'incapacitated_until' is null or (p.status_detail->>'incapacitated_until')::timestamptz <= clock_timestamp())
          and pp.recorded_at > clock_timestamp() - interval '30 seconds'
          and extensions.st_dwithin(pp.geog, v_sector.geog, coalesce((v_sector.state->>'radius_m')::int, 60));

        select count(*) into v_sector_hunters
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id and p.team = 'hunter' and p.status = 'active'
          and not coalesce(p.is_remote, false)
          and (p.status_detail->>'incapacitated_until' is null or (p.status_detail->>'incapacitated_until')::timestamptz <= clock_timestamp())
          and pp.recorded_at > clock_timestamp() - interval '30 seconds'
          and extensions.st_dwithin(pp.geog, v_sector.geog, coalesce((v_sector.state->>'radius_m')::int, 60));

        v_controller := v_sector.state->>'controller';
        v_contender := v_sector.state->>'contender';
        v_contender_pulses := coalesce((v_sector.state->>'contender_pulses')::int, 0);

        if v_sector_runners > v_sector_hunters then
          if v_controller is null then
            v_controller := 'runner';
            v_contender := null;
            v_contender_pulses := 0;
          elsif v_controller = 'runner' then
            v_contender := null;
            v_contender_pulses := 0;
          else
            if v_contender = 'runner' then
              v_contender_pulses := v_contender_pulses + 1;
              if v_contender_pulses >= 2 then
                v_controller := 'runner';
                v_contender := null;
                v_contender_pulses := 0;
              end if;
            else
              v_contender := 'runner';
              v_contender_pulses := 1;
            end if;
          end if;
        elsif v_sector_hunters > v_sector_runners then
          if v_controller is null then
            v_controller := 'hunter';
            v_contender := null;
            v_contender_pulses := 0;
          elsif v_controller = 'hunter' then
            v_contender := null;
            v_contender_pulses := 0;
          else
            if v_contender = 'hunter' then
              v_contender_pulses := v_contender_pulses + 1;
              if v_contender_pulses >= 2 then
                v_controller := 'hunter';
                v_contender := null;
                v_contender_pulses := 0;
              end if;
            else
              v_contender := 'hunter';
              v_contender_pulses := 1;
            end if;
          end if;
        else
          v_contender := null;
          v_contender_pulses := 0;
        end if;

        -- Safe object merge preserving existing sector properties without NULL constraint violations
        update public.entities
        set state = coalesce(state, '{}'::jsonb) || jsonb_build_object(
              'controller', v_controller,
              'contender', v_contender,
              'contender_pulses', v_contender_pulses
            )
        where id = v_sector.id;

        if v_controller = 'runner' then
          v_runner_zones := v_runner_zones + 1;
        elsif v_controller = 'hunter' then
          v_hunter_zones := v_hunter_zones + 1;
        end if;
      end loop;

      v_runner_score := v_runner_score + v_runner_zones;
      v_hunter_score := v_hunter_score + v_hunter_zones;

      v_runner_consec := coalesce((current_game.mode_params->'territory_pulse'->'consecutive_dominance'->>'runner')::int, 0);
      v_hunter_consec := coalesce((current_game.mode_params->'territory_pulse'->'consecutive_dominance'->>'hunter')::int, 0);

      if v_runner_zones >= 5 then
        v_runner_consec := v_runner_consec + 1;
        v_hunter_consec := 0;
      elsif v_hunter_zones >= 5 then
        v_hunter_consec := v_hunter_consec + 1;
        v_runner_consec := 0;
      else
        v_runner_consec := 0;
        v_hunter_consec := 0;
      end if;

      v_pulse_scores := jsonb_build_object(
        'runner', v_runner_score,
        'hunter', v_hunter_score
      );

      v_new_mode_params := coalesce(current_game.mode_params, '{}'::jsonb);
      v_new_mode_params := jsonb_set(
        v_new_mode_params,
        '{territory_pulse}',
        jsonb_build_object(
          'pulse_interval_s', v_pulse_int,
          'pulse_seq', v_pulse_seq,
          'last_pulse_at', clock_timestamp(),
          'next_pulse_at', clock_timestamp() + make_interval(secs => v_pulse_int),
          'scores', v_pulse_scores,
          'dominance_pct', 70,
          'consecutive_dominance', jsonb_build_object('runner', v_runner_consec, 'hunter', v_hunter_consec)
        )
      );
      update public.games set mode_params = v_new_mode_params where id = current_game.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'territory_pulse_scored', 'all',
        jsonb_build_object(
          'pulse_seq', v_pulse_seq,
          'runner_zones', v_runner_zones,
          'hunter_zones', v_hunter_zones,
          'scores', v_pulse_scores,
          'runner_consecutive', v_runner_consec,
          'hunter_consecutive', v_hunter_consec
        )
      );

      if v_runner_consec >= 2 then
        perform public.end_game(current_game.id, 'runners', 'territory_dominance');
        select * into current_game from public.games g where g.id = advance_game.game_id;
        return current_game.status;
      elsif v_hunter_consec >= 2 then
        perform public.end_game(current_game.id, 'hunters', 'territory_dominance');
        select * into current_game from public.games g where g.id = advance_game.game_id;
        return current_game.status;
      end if;
    end if;
  end if;

  -- Scheduled pings release
  if current_game.status = 'live' and clock_timestamp() >= current_game.next_ping_at then
    new_seq := current_game.ping_seq + 1;

    for runner in
      select p.id,
             p.status_detail,
             pp.geog,
             pp.accuracy_m,
             pp.recorded_at,
             round(extract(epoch from (now_time - pp.recorded_at)))::integer as age_s
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and (
            (current_game.mode_id <> 'assassin_ring' and p.team = 'runner' and p.status = 'active')
            or (current_game.mode_id = 'assassin_ring' and p.status = 'active')
          )
          and not coalesce(p.is_remote, false)
          and pp.recorded_at >= now_time - make_interval(secs => current_game.ping_interval_s * 2)
    loop
      if coalesce((runner.status_detail->>'scramble')::boolean, false) is true then
        insert into public.pings (
          game_id, player_id, seq, geog, accuracy_m, position_age_s, reason, released_at
        ) values (
          current_game.id,
          runner.id,
          new_seq,
          extensions.st_project(runner.geog, 80 + (random() * 40), radians(random() * 360)),
          coalesce(runner.accuracy_m, 10.0) + 50.0,
          runner.age_s,
          'scheduled',
          now_time
        );
        update public.players
        set status_detail = status_detail - 'scramble'
        where id = runner.id;
        delete from public.entities where entities.game_id = current_game.id and entities.kind = 'scramble' and (entities.state->>'runner_id')::uuid = runner.id;
      else
        insert into public.pings (
          game_id, player_id, seq, geog, accuracy_m, position_age_s, reason, released_at
        ) values (
          current_game.id,
          runner.id,
          new_seq,
          runner.geog,
          runner.accuracy_m,
          runner.age_s,
          'scheduled',
          now_time
        );
      end if;
      ping_count := ping_count + 1;
    end loop;

    next_ping := current_game.next_ping_at + make_interval(secs => current_game.ping_interval_s);
    while next_ping <= clock_timestamp() loop
      next_ping := next_ping + make_interval(secs => current_game.ping_interval_s);
    end loop;

    update public.games g
      set next_ping_at = next_ping,
          ping_seq = new_seq
      where g.id = current_game.id;

    insert into public.events (game_id, type, payload)
      values (
        current_game.id,
        'ping_released',
        jsonb_build_object('seq', new_seq, 'count', ping_count, 'released_at', now_time)
      );

    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  return current_game.status;
end;
$$;

-- Migration: 20261118010000_vm2_vip_escort_advance_and_submit.sql
-- Restores canonical VIP Escort auto-promotion in advance_game,
-- and restores VIP-only target arrival guard and Relay Heist extraction check in submit_position.

-- 1. advance_game --------------------------------------------------------------

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

  -- Relay Heist locals
  pkg_offline record;
  carrier_rec record;
  v_carrier_ping_seq integer;

  -- VIP Escort locals
  active_vip record;
  promoted_bodyguard record;
  promoted_name text;

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
        case when current_game.mode_id in ('classic_chase', 'relay_heist') then 'hunters' else 'runners' end,
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

  -- Relay Heist Live Loop: Carrier offline auto-drop (> 60s without fix)
  if current_game.status = 'live' and current_game.mode_id = 'relay_heist' then
    for pkg_offline in
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
      set geog = coalesce(pkg_offline.carrier_geog, e.geog),
          state = jsonb_build_object(
            'status', 'dropped',
            'carrier_player_id', null,
            'dropped_at', clock_timestamp(),
            'securing_hunter_id', null,
            'securing_started_at', null
          ),
          visible_to = 'all',
          updated_at = clock_timestamp()
      where e.id = pkg_offline.entity_id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'package_dropped', 'all',
        jsonb_build_object(
          'carrier_id', pkg_offline.carrier_id,
          'carrier_name', pkg_offline.display_name,
          'reason', 'carrier_offline',
          'message', 'The carrier went offline. The package was dropped!'
        )
      );
    end loop;
  end if;

  -- VIP Escort: Auto-promote nearest bodyguard if VIP is inactive for > 60 s
  if current_game.status = 'live'
     and 'vip' = any(current_game.roles)
     and current_game.live_at is not null
     and current_game.live_at < clock_timestamp() - interval '60 seconds' then
    select * into active_vip from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.secret_role = 'vip' and p.status = 'active';

    if active_vip.id is not null then
      if not exists (
        select 1 from public.player_positions pp
        where pp.player_id = active_vip.id and pp.recorded_at > clock_timestamp() - interval '60 seconds'
      ) then
        select p.* into promoted_bodyguard
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.secret_role = 'bodyguard'
          and p.status = 'active'
          and (p.status_detail->>'frozen_until' is null or (p.status_detail->>'frozen_until')::timestamptz <= clock_timestamp())
          and pp.recorded_at > clock_timestamp() - interval '60 seconds'
        order by extensions.st_distance(
          pp.geog,
          coalesce((select vip_pos.geog from public.player_positions vip_pos where vip_pos.player_id = active_vip.id), current_game.area_center)
        ) asc
        limit 1;

        if promoted_bodyguard.id is not null then
          update public.players set secret_role = 'bodyguard' where id = active_vip.id;
          update public.players
          set secret_role = 'vip',
              status_detail = jsonb_set(coalesce(status_detail, '{}'::jsonb), '{is_vip}', 'true'::jsonb)
          where id = promoted_bodyguard.id;

          select pr.display_name into promoted_name
          from public.profiles pr where pr.id = promoted_bodyguard.user_id;

          insert into public.events (game_id, type, audience, payload)
          values (
            current_game.id,
            'vip_promoted',
            'runner',
            jsonb_build_object(
              'promoted_id', promoted_bodyguard.id,
              'promoted_name', promoted_name,
              'reason', 'vip_inactive',
              'message', promoted_name || ' has been promoted to VIP due to inactive VIP!'
            )
          );
        end if;
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

  -- Relay Heist: Carrier extra radar ping release (1.5x cadence)
  if current_game.status = 'live' and current_game.mode_id = 'relay_heist' then
    for carrier_rec in
      select p.id as carrier_id, pp.geog as carrier_geog, pp.accuracy_m, pp.recorded_at,
             (e.state->>'next_carrier_ping_at')::timestamptz as next_carrier_ping
      from public.entities e
      join public.players p on p.id = (e.state->>'carrier_player_id')::uuid
      join public.player_positions pp on pp.player_id = p.id
      where e.game_id = current_game.id
        and e.kind = 'package'
        and (e.state->>'status') = 'carried'
        and p.status = 'active'
        and pp.recorded_at > clock_timestamp() - interval '2 minutes'
    loop
      if carrier_rec.next_carrier_ping is null then
        update public.entities e
        set state = jsonb_set(e.state, '{next_carrier_ping_at}', to_jsonb((clock_timestamp() + make_interval(secs => greatest(10, floor(current_game.ping_interval_s / 1.5)::int)))::text))
        where e.game_id = current_game.id and e.kind = 'package';
      elsif clock_timestamp() >= carrier_rec.next_carrier_ping then
        update public.entities e
        set state = jsonb_set(e.state, '{next_carrier_ping_at}', to_jsonb((clock_timestamp() + make_interval(secs => greatest(10, floor(current_game.ping_interval_s / 1.5)::int)))::text))
        where e.game_id = current_game.id and e.kind = 'package';

        select coalesce(max(seq), 0) + 1 into v_carrier_ping_seq from public.pings where pings.game_id = current_game.id;
        update public.games g set ping_seq = v_carrier_ping_seq where g.id = current_game.id;

        insert into public.pings (
          game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
        ) values (
          current_game.id,
          v_carrier_ping_seq,
          carrier_rec.carrier_id,
          carrier_rec.carrier_geog,
          carrier_rec.accuracy_m,
          greatest(0, floor(extract(epoch from (clock_timestamp() - carrier_rec.recorded_at)))::integer),
          'carrier_radar',
          clock_timestamp()
        );
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


-- 2. submit_position -----------------------------------------------------------

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
#variable_conflict use_column
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
  v_prev_out timestamptz;
  v_out_since timestamptz;
  v_prev_noise integer;
  v_prev_alerted boolean;
  v_prev_smoothed real;
  v_prev_anchor geography;
  v_prev_anchor_since timestamptz;
  v_prev_updated timestamptz;
  v_prev_fast_since timestamptz;
  v_prev_vehicle_warned boolean;
  v_smoothed real;
  v_fast_since timestamptz;
  v_vehicle_warned boolean;
  v_noise integer := 0;
  v_alerted boolean := false;
  v_anchor geography;
  v_anchor_since timestamptz;
  v_dt double precision;
  v_noise_seq integer;
  v_noise_on boolean;
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

  select * into current_game from public.games where id = submit_position.game_id;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players where game_id = submit_position.game_id and user_id = caller_id;
  if not found then raise exception 'You are not a member of this game.'; end if;

  if coalesce(me.is_remote, false) then
    return jsonb_build_object(
      'phase', current_game.status,
      'is_remote', true,
      'in_bounds', true
    );
  end if;

  fix_time := coalesce(submit_position.recorded_at, clock_timestamp());
  fix_geog := extensions.st_setsrid(extensions.st_makepoint(submit_position.lng, submit_position.lat), 4326)::extensions.geography;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_dwithin(fix_geog, current_game.area_center, v_radius);
  v_accuracy := coalesce(submit_position.accuracy, 10)::real;
  v_speed := submit_position.speed::real;
  v_heading := submit_position.heading::real;

  select out_of_bounds_since, noise, noise_alerted, smoothed_speed_mps, anchor_geog, anchor_since, updated_at, fast_since, vehicle_warned
    into v_prev_out, v_prev_noise, v_prev_alerted, v_prev_smoothed, v_prev_anchor, v_prev_anchor_since, v_prev_updated, v_prev_fast_since, v_prev_vehicle_warned
    from public.player_positions
    where player_id = me.id;

  if v_in_bounds then
    v_out_since := null;
    if v_prev_out is not null then
      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id, 'boundary_restored', me.id, 'all',
        jsonb_build_object('user_id', caller_id, 'player_id', me.id)
      );
    end if;
  else
    v_out_since := coalesce(v_prev_out, fix_time);
    if v_prev_out is null then
      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id, 'boundary_warning', me.id, 'all',
        jsonb_build_object(
          'user_id', caller_id,
          'player_id', me.id,
          'message', 'You are outside the play area! Return inside.'
        )
      );
    end if;
  end if;

  v_dt := case
    when v_prev_updated is null then 1.0
    else greatest(0.5, least(10.0, extract(epoch from (now() - v_prev_updated))))
  end;

  -- Speed Smoothing & Vehicle Safety Warning (>8 m/s for 10 s)
  if v_speed is null then
    v_smoothed := coalesce(v_prev_smoothed, 0.0);
  elsif v_prev_smoothed is null then
    v_smoothed := v_speed;
  else
    v_smoothed := 0.75 * v_prev_smoothed + 0.25 * v_speed;
  end if;

  v_noise_on := ('noise_meter' = any(current_game.modifiers) or 'noise' = any(current_game.modifiers));

  if v_smoothed >= 8.0 then
    v_fast_since := coalesce(v_prev_fast_since, fix_time);
    v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);
    if not v_vehicle_warned and v_fast_since is not null and greatest(now(), fix_time) - v_fast_since >= interval '10 seconds' then
      insert into public.events (game_id, type, audience, payload, target_player)
      values (
        current_game.id, 'vehicle_warning', 'all',
        jsonb_build_object(
          'player_id', me.id,
          'user_id', caller_id,
          'speed_mps', round(v_smoothed::numeric, 1),
          'message', 'Vehicle speed detected (>8 m/s sustained for 10 s). Motorized transit is prohibited!'
        ),
        me.id
      );
      v_vehicle_warned := true;

      -- Mode-specific penalty: Noise meter spike to 100
      if v_noise_on and me.team = 'runner' then
        v_noise := 100;
      end if;

      update public.players
      set status_detail = coalesce(status_detail, '{}'::jsonb) || jsonb_build_object(
        'vehicle_warning', true,
        'speed_warning_at', clock_timestamp(),
        'speed_warnings_count', coalesce((status_detail->>'speed_warnings_count')::int, 0) + 1
      )
      where id = me.id;
    end if;
  else
    v_fast_since := null;
    v_vehicle_warned := false;
  end if;

  -- Mock location check
  if coalesce(submit_position.is_mock, false) then
    insert into public.events (game_id, type, target_player, audience, payload)
    values (
      current_game.id,
      'mock_location_detected',
      me.id,
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'message', 'Mock location detected from player.'
      )
    );
  end if;

  -- Noise modifier logic
  if v_noise_on and me.team = 'runner' and not v_vehicle_warned then
    if v_smoothed >= 8 then
      v_noise := round(coalesce(v_prev_noise, 0) + 8 * v_dt)::integer;
    elsif v_smoothed >= 5 then
      v_noise := round(coalesce(v_prev_noise, 0) + 4 * v_dt)::integer;
    elsif v_smoothed >= 2.5 then
      v_noise := round(coalesce(v_prev_noise, 0) + 1.5 * v_dt)::integer;
    elsif v_smoothed >= 0.5 then
      v_noise := greatest(0, round(coalesce(v_prev_noise, 0) - 2 * v_dt))::integer;
    else
      v_noise := greatest(0, round(coalesce(v_prev_noise, 0) - 5 * v_dt))::integer;
    end if;
    v_noise := least(100, greatest(0, v_noise));

    v_alerted := coalesce(v_prev_alerted, false);
    if v_noise >= 100 and not v_alerted then
      v_alerted := true;
      select coalesce(max(seq), 0) + 1 into v_noise_seq
        from public.pings
        where pings.game_id = current_game.id;
      insert into public.pings (game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at)
      values (
        current_game.id,
        v_noise_seq,
        me.id,
        fix_geog,
        coalesce(v_accuracy, 10)::real,
        0,
        'noise_burst',
        now()
      );
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'noise_spike',
        'hunter',
        jsonb_build_object('player_id', me.id, 'noise', v_noise)
      );
      v_noise := 50;
    elsif v_noise < 100 then
      v_alerted := false;
    end if;
  end if;

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

  -- Skip arrival & collision victory evaluations if game is paused
  if current_game.status <> 'paused' then
    -- Classic chase arrival check (guarded by VIP role if active)
    if current_game.mode_id = 'classic_chase' and me.team = 'runner' and current_game.status = 'live' then
      if (not ('vip' = any(coalesce(current_game.roles, '{}'::text[]))) or me.secret_role = 'vip') then
        if exists (
          select 1 from public.targets t
          where t.game_id = current_game.id
            and extensions.st_dwithin(fix_geog, t.geog, current_game.target_radius_m)
        ) then
          insert into public.events (game_id, type, target_player, audience, payload)
          values (
            current_game.id, 'target_reached', me.id, 'all',
            jsonb_build_object('runner_id', me.id, 'user_id', caller_id)
          );
          perform public.end_game(current_game.id, 'runners', 'target_reached');
          select * into current_game from public.games g where g.id = submit_position.game_id;
        end if;
      end if;
    end if;

    -- Relay Heist extraction check: carrier enters extraction zone
    if current_game.status = 'live'
       and current_game.mode_id = 'relay_heist'
       and me.team = 'runner'
       and exists (
         select 1
         from public.entities e_pkg
         join public.entities e_ext on e_ext.game_id = current_game.id and e_ext.kind = 'extraction'
         where e_pkg.game_id = current_game.id
           and e_pkg.kind = 'package'
           and (e_pkg.state->>'carrier_player_id') = me.id::text
           and (e_pkg.state->>'status') = 'carried'
           and extensions.st_dwithin(fix_geog, e_ext.geog, coalesce((e_ext.state->>'radius_m')::int, 25))
       ) then
      perform public.end_game(current_game.id, 'runners', 'extraction_complete');
      select * into current_game from public.games g where g.id = submit_position.game_id;
    end if;

    -- Ghost Duel arrival / collision checks
    if current_game.mode_id = 'ghost_duel' and current_game.status = 'live' then
      v_duel_variant := coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial');

      select * into v_duel_target from public.entities where entities.game_id = current_game.id and kind = 'target' limit 1;
      select * into v_ghost_ent from public.entities where entities.game_id = current_game.id and kind = 'ghost' limit 1;

      -- Evade collision check
      if v_duel_variant = 'evade' and me.team = 'runner' and v_ghost_ent.id is not null then
        if extensions.st_dwithin(fix_geog, v_ghost_ent.geog, 20.0) then
          perform public.end_game(current_game.id, 'hunters', 'haunted');
          select * into current_game from public.games g where g.id = submit_position.game_id;
        end if;
      end if;

      -- Time trial arrival check
      if v_duel_target.id is not null and extensions.st_dwithin(fix_geog, v_duel_target.geog, coalesce((v_duel_target.state->>'radius_m')::double precision, 20.0)) then
        v_p_time := greatest(1.0, extract(epoch from (now() - current_game.live_at)));
        v_g_time := coalesce((v_ghost_ent.state->>'duration_s')::double precision, 240.0);
        v_delta := v_g_time - v_p_time;

        select extensions.st_distance(current_game.area_center, v_duel_target.geog) into v_straight_m;
        select coalesce(sum(extensions.st_length(tp.geog::extensions.geography)), v_straight_m) into v_actual_m
        from public.trail_points tp where tp.game_id = current_game.id and tp.player_id = me.id;

        if v_actual_m > 0 and v_straight_m > 0 then
          v_eff := least(1.0, (v_straight_m / v_actual_m)::real);
        else
          v_eff := 1.0;
        end if;

        v_score := greatest(100, round(1000.0 + (v_delta * 10.0) + (v_eff * 200.0))::integer);

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'ghost_duel_finish', 'all',
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
    'smoothed_speed_mps', round(v_smoothed::numeric, 2)
  );
end;
$$;

revoke all on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) from public, anon;
grant execute on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) to authenticated;

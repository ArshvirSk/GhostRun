-- Migration: 20261118012000_vm2_double_agent_advance_canonical.sql
-- Restores canonical Double Agent scramble displacement in advance_game,
-- and ensures agent_scramble arms both status_detail and entities table.

-- 1. agent_scramble RPC -------------------------------------------------------

create or replace function public.agent_scramble(
  game_id uuid,
  runner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
  target_runner public.players%rowtype;
  current_game public.games%rowtype;
  v_charges integer;
  v_cooldown_s integer;
  v_last_used timestamptz;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g where g.id = agent_scramble.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then raise exception 'Round must be live.'; end if;
  if not ('double_agent' = any(current_game.roles)) then
    raise exception 'Double Agent role is not active in this game.';
  end if;

  select * into me from public.players p
  where p.game_id = current_game.id and p.user_id = caller_id and p.status <> 'left';
  if not found or me.status <> 'active' then raise exception 'Active player required.'; end if;
  if me.secret_role is distinct from 'agent' then
    raise exception 'Only the Double Agent can scramble pings.';
  end if;

  v_charges := coalesce((me.status_detail->>'scramble_charges')::int, case when (me.status_detail->>'scramble_available')::boolean then 1 else 0 end);
  v_cooldown_s := coalesce((me.status_detail->>'scramble_cooldown_s')::int, 120);
  v_last_used := (me.status_detail->>'last_scramble_at')::timestamptz;

  if v_charges <= 0 or coalesce((me.status_detail->>'scramble_available')::boolean, false) is not true then
    raise exception 'Scramble has already been used.';
  end if;

  if v_last_used is not null and now() < v_last_used + make_interval(secs => v_cooldown_s) then
    raise exception 'Scramble is on cooldown.';
  end if;

  select * into target_runner from public.players p
  where p.id = agent_scramble.runner_id
    and p.game_id = current_game.id
    and p.team = 'runner'
    and p.status = 'active';
  if not found then raise exception 'Target must be an active runner in this game.'; end if;

  v_charges := v_charges - 1;

  -- Consume charge / update cooldown
  update public.players
  set status_detail = jsonb_set(
    jsonb_set(
      jsonb_set(status_detail, '{scramble_charges}', to_jsonb(v_charges)),
      '{scramble_available}', to_jsonb(v_charges > 0)
    ),
    '{last_scramble_at}', to_jsonb(now())
  )
  where id = me.id;

  -- Arm scramble on runner status_detail
  update public.players
  set status_detail = jsonb_set(status_detail, '{scramble}', 'true'::jsonb)
  where id = target_runner.id;

  -- Also insert into entities for complete dual-stack compatibility
  delete from public.entities where game_id = current_game.id and kind = 'scramble' and (state->>'runner_id')::uuid = target_runner.id;
  insert into public.entities (game_id, kind, team, state, visible_to)
  values (
    current_game.id,
    'scramble',
    'runner',
    jsonb_build_object('runner_id', target_runner.id),
    'runner'
  );

  insert into public.events (game_id, type, audience, target_player, payload) values (
    current_game.id,
    'scramble_armed',
    'hunter',
    me.id,
    jsonb_build_object(
      'runner_id', target_runner.id,
      'charges_left', v_charges,
      'cooldown_s', v_cooldown_s
    )
  );

  return jsonb_build_object('success', true, 'runner_id', target_runner.id, 'charges_left', v_charges);
end;
$$;

revoke all on function public.agent_scramble(uuid, uuid) from public, anon;
grant execute on function public.agent_scramble(uuid, uuid) to authenticated;

-- 2. Canonical advance_game ---------------------------------------------------

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

        v_ctrl := v_zone_rec.state->>'controller';
        v_cont := v_zone_rec.state->>'contender';
        v_cont_p := coalesce((v_zone_rec.state->>'contender_pulses')::int, 0);

        if v_z_runners > v_z_hunters then
          v_prevailing := 'runner';
        elsif v_z_hunters > v_z_runners then
          v_prevailing := 'hunter';
        else
          v_prevailing := null;
        end if;

        if v_prevailing is not null then
          if v_ctrl is null then
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
          elsif v_ctrl <> v_prevailing then
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
          else
            v_cont := null;
            v_cont_p := 0;
          end if;
        else
          v_cont := null;
          v_cont_p := 0;
        end if;

        if v_ctrl = 'runner' then v_r_controlled := v_r_controlled + 1; end if;
        if v_ctrl = 'hunter' then v_h_controlled := v_h_controlled + 1; end if;

        update public.entities
        set state = jsonb_set(
          jsonb_set(
            jsonb_set(state, '{controller}', to_jsonb(v_ctrl)),
            '{contender}', to_jsonb(v_cont)
          ),
          '{contender_pulses}', to_jsonb(v_cont_p)
        ),
        updated_at = clock_timestamp()
        where id = v_zone_rec.id;
      end loop;

      v_r_score := v_r_score + v_r_controlled;
      v_h_score := v_h_score + v_h_controlled;

      if v_r_controlled >= 5 then v_r_dom := v_r_dom + 1; else v_r_dom := 0; end if;
      if v_h_controlled >= 5 then v_h_dom := v_h_dom + 1; else v_h_dom := 0; end if;

      update public.games
      set mode_params = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(mode_params, '{territory_pulse,pulse_seq}', to_jsonb(v_tp_seq)),
              '{territory_pulse,last_pulse_at}', to_jsonb(clock_timestamp()::text)
            ),
            '{territory_pulse,next_pulse_at}', to_jsonb((clock_timestamp() + make_interval(secs => v_tp_interval))::text)
          ),
          '{territory_pulse,scores}', jsonb_build_object('runner', v_r_score, 'hunter', v_h_score)
        ),
        '{territory_pulse,consecutive_dominance}', jsonb_build_object('runner', v_r_dom, 'hunter', v_h_dom)
      )
      where id = current_game.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'territory_pulse_scored', 'all',
        jsonb_build_object(
          'pulse_seq', v_tp_seq,
          'scores', jsonb_build_object('runner', v_r_score, 'hunter', v_h_score),
          'controlled', jsonb_build_object('runner', v_r_controlled, 'hunter', v_h_controlled),
          'consecutive_dominance', jsonb_build_object('runner', v_r_dom, 'hunter', v_h_dom)
        )
      );

      if v_r_dom >= 3 then
        perform public.end_game(current_game.id, 'runners', 'dominance_victory');
        select * into current_game from public.games g where g.id = advance_game.game_id;
        return current_game.status;
      elsif v_h_dom >= 3 then
        perform public.end_game(current_game.id, 'hunters', 'dominance_victory');
        select * into current_game from public.games g where g.id = advance_game.game_id;
        return current_game.status;
      end if;
    end if;
  end if;

  -- Safety pause voting check
  if current_game.status = 'live' and (current_game.mode_params->'safety'->>'vote_in_progress')::boolean is true then
    if (current_game.mode_params->'safety'->>'vote_expires_at') is not null
       and clock_timestamp() >= (current_game.mode_params->'safety'->>'vote_expires_at')::timestamptz then
      update public.games
      set mode_params = jsonb_set(
        jsonb_set(mode_params, '{safety,vote_in_progress}', 'false'::jsonb),
        '{safety,vote_result}', '"expired"'::jsonb
      )
      where id = current_game.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'safety_vote_expired', 'all',
        jsonb_build_object('message', 'Safety pause vote expired without consensus.')
      );
    end if;
  end if;

  -- Jailbreak auto-release and rescue sweep
  if current_game.status = 'live' and current_game.mode_id = 'jailbreak' then
    v_auto_release_s := coalesce((current_game.mode_params->'jailbreak'->>'auto_release_s')::int, 300);

    for jailed_rec in
      select p.id, p.user_id, p.tagged_at
      from public.players p
      where p.game_id = current_game.id
        and p.team = 'runner'
        and p.status = 'tagged'
        and p.tagged_at is not null
        and clock_timestamp() - p.tagged_at >= make_interval(secs => v_auto_release_s)
    loop
      update public.players
      set status = 'active', tagged_at = null
      where id = jailed_rec.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'runner_released',
        'all',
        jsonb_build_object(
          'runner_id', jailed_rec.id,
          'method', 'auto_timer',
          'message', 'Runner auto-released from jail after timer expiry'
        )
      );
    end loop;

    select count(*) into active_runners_count
    from public.players
    where game_id = current_game.id and team = 'runner' and status = 'active';

    select count(*) into jailed_runners_count
    from public.players
    where game_id = current_game.id and team = 'runner' and status = 'tagged';

    if active_runners_count = 0 and jailed_runners_count > 0 then
      perform public.end_game(current_game.id, 'hunters', 'all_jailed');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  -- Relay Heist: carrier offline auto-drop (60s inactivity)
  if current_game.status = 'live' and current_game.mode_id = 'relay_heist' then
    for pkg_offline in
      select e.id as entity_id, e.state, (e.state->>'carrier_player_id')::uuid as carrier_id,
             pp.recorded_at as last_fix_at, pp.geog as carrier_geog
      from public.entities e
      left join public.player_positions pp on pp.player_id = (e.state->>'carrier_player_id')::uuid
      where e.game_id = current_game.id
        and e.kind = 'package'
        and (e.state->>'status') = 'carried'
        and (
          pp.recorded_at is null
          or clock_timestamp() - pp.recorded_at > interval '60 seconds'
        )
    loop
      update public.entities
      set geog = coalesce(pkg_offline.carrier_geog, current_game.area_center),
          state = jsonb_build_object(
            'status', 'dropped',
            'carrier_player_id', null,
            'dropped_at', clock_timestamp(),
            'securing_hunter_id', null,
            'securing_started_at', null
          ),
          visible_to = 'all',
          updated_at = clock_timestamp()
      where id = pkg_offline.entity_id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'package_dropped', 'all',
        jsonb_build_object(
          'carrier_id', pkg_offline.carrier_id,
          'reason', 'carrier_offline',
          'message', 'Carrier went offline for 60s! The package has been dropped!'
        )
      );
    end loop;
  end if;

  -- VIP Escort: VIP offline auto-promotion (60s inactivity)
  if current_game.status = 'live' and ('vip' = any(current_game.roles)) then
    for active_vip in
      select p.id as vip_id, pp.recorded_at as last_fix_at, pp.geog as vip_geog
      from public.players p
      left join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id
        and p.team = 'runner'
        and p.secret_role = 'vip'
        and p.status = 'active'
        and (
          pp.recorded_at is null
          or clock_timestamp() - pp.recorded_at > interval '60 seconds'
        )
    loop
      select p.id, pr.display_name into promoted_bodyguard
      from public.players p
      join public.profiles pr on pr.id = p.user_id
      left join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id
        and p.team = 'runner'
        and p.secret_role = 'bodyguard'
        and p.status = 'active'
        and not coalesce(p.is_remote, false)
        and (p.status_detail->>'frozen_until' is null or (p.status_detail->>'frozen_until')::timestamptz <= clock_timestamp())
        and pp.recorded_at > clock_timestamp() - interval '60 seconds'
      order by case
        when active_vip.vip_geog is not null and pp.geog is not null then
          extensions.st_distance(active_vip.vip_geog, pp.geog)
        else 999999
      end asc
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
    end loop;
  end if;

  -- Ghost sightings (Simulated ghost patrol)
  if current_game.status = 'live' and (current_game.mode_id = 'haunted_map' or current_game.ghost_mode) then
    for ghost_rec in
      select id, geog, state from public.entities
      where entities.game_id = current_game.id and kind = 'ghost'
    loop
      if ghost_rec.state ? 'path_wkt' then
        patrol_geom := extensions.st_geomfromtext(ghost_rec.state->>'path_wkt', 4326);
        duration_s := coalesce((ghost_rec.state->>'duration_s')::integer, 240);
        effective_duration_s := greatest(30, floor(duration_s / coalesce((ghost_rec.state->>'speed_scale')::real, 1.0))::integer);
        elapsed_s := extract(epoch from (clock_timestamp() - current_game.live_at));
        loop_frac := (elapsed_s % effective_duration_s) / effective_duration_s::double precision;
        path_len_m := extensions.st_length(patrol_geom::extensions.geography);
        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        update public.entities
        set geog = current_ghost_pt::extensions.geography, updated_at = clock_timestamp()
        where id = ghost_rec.id;

        if current_game.mode_id = 'ghost_duel' then
          v_duel_variant := coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial');
          if v_duel_variant in ('mirror_chase', 'evade') then
            for runner_fix in
              select pp.player_id, pp.geog
              from public.player_positions pp
              join public.players p on p.id = pp.player_id
              where pp.game_id = current_game.id and p.status = 'active'
                and pp.recorded_at > clock_timestamp() - interval '20 seconds'
            loop
              if extensions.st_dwithin(runner_fix.geog, current_ghost_pt::extensions.geography, 20.0) then
                if v_duel_variant = 'mirror_chase' then
                  perform public.end_game(current_game.id, 'runners', 'ghost_tagged');
                else
                  perform public.end_game(current_game.id, 'hunters', 'ghost_caught');
                end if;
                select * into current_game from public.games g where g.id = advance_game.game_id;
                return current_game.status;
              end if;
            end loop;
          end if;
        else
          for runner_fix in
            select pp.player_id, pp.geog, pp.accuracy_m, pp.recorded_at
            from public.player_positions pp
            join public.players p on p.id = pp.player_id
            where pp.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
              and extensions.st_dwithin(pp.geog, current_ghost_pt::extensions.geography, 40.0)
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
      select pp.player_id, pp.geog, pp.accuracy_m, pp.recorded_at, p.id as p_id, p.status_detail
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      where pp.game_id = current_game.id
        and p.team = 'runner'
        and p.status = 'active'
        and not coalesce(p.is_remote, false)
        and pp.recorded_at > clock_timestamp() - interval '60 seconds'
    loop
      ping_geog := runner.geog;

      -- Double Agent Scramble Ping Displacement
      if 'double_agent' = any(current_game.roles) and (
        coalesce((runner.status_detail->>'scramble')::boolean, false) = true
        or exists (
          select 1 from public.entities e
          where e.game_id = current_game.id and e.kind = 'scramble' and (e.state->>'runner_id')::uuid = runner.p_id
        )
      ) then
        shift_m := 150 + (random() * 100);
        bearing := random() * 360;
        ping_geog := extensions.st_project(runner.geog, shift_m, radians(bearing))::extensions.geography;

        -- Inward boundary clamp to protect runner safety
        dist_from_center := extensions.st_distance(ping_geog, current_game.area_center);
        if dist_from_center > current_game.area_radius_m - 20 then
          ping_geog := extensions.st_project(
            current_game.area_center,
            greatest(0, current_game.area_radius_m - 20),
            bearing
          );
        end if;

        -- Consume scramble on runner status_detail & entities
        update public.players
        set status_detail = status_detail - 'scramble'
        where id = runner.p_id;

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

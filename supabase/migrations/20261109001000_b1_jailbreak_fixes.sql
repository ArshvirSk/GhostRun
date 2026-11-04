-- Migration: 20261109001000_b1_jailbreak_fixes.sql
-- Fix ambiguous column references in Jailbreak RPCs (complete_rescue, cancel_rescue, advance_game)

-- 1. Fix complete_rescue -----------------------------------------------------

create or replace function public.complete_rescue(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  my_pos public.player_positions%rowtype;
  jail_geog extensions.geography;
  v_release_radius_m double precision;
  v_hold_s integer;
  v_started_at timestamptz;
  freed_count integer := 0;
  rescuer_name text;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g
    where g.id = complete_rescue.game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Rescue is only available while the round is live.';
  end if;
  if current_game.mode_id <> 'jailbreak' then
    raise exception 'Rescue is only available in Jailbreak mode.';
  end if;

  select * into me from public.players p
    where p.game_id = current_game.id and p.user_id = caller_id and p.status <> 'left'
    for update;
  if not found then raise exception 'You are not a player in this game.'; end if;
  if me.team <> 'runner' then raise exception 'Only runners can rescue teammates.'; end if;
  if me.status <> 'active' then raise exception 'You cannot complete a rescue while jailed or eliminated.'; end if;

  if (me.status_detail->>'free_started_at') is null then
    raise exception 'No active rescue in progress. Start a rescue first.';
  end if;

  v_started_at := (me.status_detail->>'free_started_at')::timestamptz;
  v_hold_s := coalesce((current_game.mode_params->'jailbreak'->>'release_hold_s')::integer, 10);

  -- Allow 0.5s network leeway
  if now() < v_started_at + make_interval(secs => greatest(0, v_hold_s - 0.5)) then
    raise exception 'Rescue hold duration not completed.';
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or now() - my_pos.recorded_at > interval '20 seconds' then
    raise exception 'Your GPS fix is stale. Rescue cancelled.';
  end if;

  select e.geog into jail_geog from public.entities e
    where e.game_id = current_game.id and e.kind = 'jail'
    limit 1;
  v_release_radius_m := coalesce((current_game.mode_params->'jailbreak'->>'release_radius_m')::double precision, 10.0);
  if jail_geog is null or extensions.st_distance(my_pos.geog, jail_geog) > v_release_radius_m then
    raise exception 'You must remain within % meters of the jail to complete rescue.', v_release_radius_m;
  end if;

  -- Free all jailed runners
  update public.players p
    set status = 'active', tagged_at = null
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'jailed';
  get diagnostics freed_count = row_count;

  -- Clear free_started_at on rescuer
  update public.players p
    set status_detail = p.status_detail - 'free_started_at'
    where p.id = me.id;

  -- If Noise Meter is active, reset noise for all runners
  if 'noise_meter' = any(current_game.modifiers) or current_game.mode_id = 'noise_meter' then
    update public.player_positions pp
      set noise = 0, noise_alerted = false
      where pp.game_id = current_game.id
        and pp.player_id in (select p.id from public.players p where p.game_id = current_game.id and p.team = 'runner');
  end if;

  select pr.display_name into rescuer_name
    from public.profiles pr where pr.id = me.user_id;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'runners_freed',
    'all',
    jsonb_build_object(
      'freed_count', freed_count,
      'rescuer_id', me.id,
      'rescuer_name', rescuer_name
    )
  );

  return jsonb_build_object(
    'success', true,
    'freed_count', freed_count
  );
end;
$$;

revoke all on function public.complete_rescue(uuid) from public, anon;
grant execute on function public.complete_rescue(uuid) to authenticated;

-- 2. Fix cancel_rescue -------------------------------------------------------

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

  update public.players p
    set status_detail = p.status_detail - 'free_started_at'
    where p.id = me.id;

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

-- 3. Fix advance_game --------------------------------------------------------

create or replace function public.advance_game(game_id uuid)
returns public.game_status
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_game public.games%rowtype;
  stages integer[];
  stage_count integer;
  stage_index integer;
  next_stage integer;
  next_start timestamptz;
  target_rec public.targets%rowtype;
  p_runner record;
  next_ping_at timestamptz;
  next_seq integer;
  pos record;
  ghost_rec record;
  runner_rec record;
  patrol_geom extensions.geometry;
  patrol_len double precision;
  fraction double precision;
  ghost_curr_pt extensions.geometry;
  haunt_radius double precision;
  dist double precision;
  v_dwell_s integer;
  ghost_mode_setting text;
  v_auto_release_s integer;
  jailed_rec record;
  active_runners_count integer;
  jailed_runners_count integer;
  jail_rec public.entities%rowtype;
begin
  select * into current_game from public.games g
    where g.id = advance_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status = 'countdown' and clock_timestamp() >= current_game.head_start_at then
    if current_game.head_start_s > 0 then
      update public.games set status = 'head_start' where id = current_game.id;
      insert into public.events (game_id, type, payload)
      values (current_game.id, 'phase_changed', jsonb_build_object('phase', 'head_start'));
      current_game.status := 'head_start';
    else
      update public.games set status = 'live' where id = current_game.id;
      insert into public.events (game_id, type, payload)
      values (current_game.id, 'phase_changed', jsonb_build_object('phase', 'live'));
      current_game.status := 'live';
    end if;
  end if;

  if current_game.status = 'head_start' and clock_timestamp() >= current_game.live_at then
    update public.games set status = 'live' where id = current_game.id;
    insert into public.events (game_id, type, payload)
    values (current_game.id, 'phase_changed', jsonb_build_object('phase', 'live'));
    current_game.status := 'live';
  end if;

  if current_game.status in ('head_start', 'live') and clock_timestamp() < current_game.ends_at then
    if 'shrinking_zone' = any(current_game.modifiers) then
      stages := public.zone_stages(current_game.id);
      stage_count := array_length(stages, 1);
      stage_index := least(
        stage_count,
        1 + floor(
          (extract(epoch from (clock_timestamp() - current_game.live_at))
           / greatest(1, extract(epoch from (current_game.ends_at - current_game.live_at))))
          * stage_count
        )::integer
      );

      if stage_index > current_game.zone_stage and stage_index <= stage_count then
        update public.games set zone_stage = stage_index where id = current_game.id;
        current_game.zone_stage := stage_index;

        insert into public.events (game_id, type, payload)
        values (
          current_game.id,
          'zone_shrink',
          jsonb_build_object(
            'stage', stage_index,
            'factor', stages[stage_index],
            'radius_m', round(current_game.area_radius_m * stages[stage_index] / 100.0)
          )
        );

        -- If Jailbreak mode and jail is now outside effective radius, auto-release all jailed runners
        if current_game.mode_id = 'jailbreak' then
          select * into jail_rec from public.entities e where e.game_id = current_game.id and e.kind = 'jail' limit 1;
          if jail_rec.id is not null and extensions.st_distance(jail_rec.geog, current_game.area_center) > public.effective_radius_m(current_game.id) then
            update public.players p
              set status = 'active', tagged_at = null
              where p.game_id = current_game.id and p.team = 'runner' and p.status = 'jailed';
            insert into public.events (game_id, type, audience, payload)
            values (
              current_game.id,
              'jail_overrun',
              'all',
              jsonb_build_object('message', 'The safe zone shrank past the jail! Jailed runners are freed.')
            );
          end if;
        end if;
      end if;

      next_stage := current_game.zone_stage + 1;
      if next_stage <= stage_count then
        next_start := current_game.live_at
          + make_interval(secs => (
              extract(epoch from (current_game.ends_at - current_game.live_at))
              * (next_stage - 1) / stage_count
            )::integer);

        if now() >= next_start - interval '60 seconds'
           and not exists (
             select 1 from public.events e
             where e.game_id = current_game.id
               and e.type = 'zone_warning'
               and (e.payload->>'stage')::integer = next_stage
           ) then
          insert into public.events (game_id, type, payload)
          values (
            current_game.id,
            'zone_warning',
            jsonb_build_object(
              'stage', next_stage,
              'factor', stages[next_stage],
              'radius_m', round(current_game.area_radius_m * stages[next_stage] / 100.0),
              'at', next_start
            )
          );
        end if;
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
        and now() >= p.tagged_at + make_interval(secs => v_auto_release_s)
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
      where p.game_id = current_game.id and p.team = 'runner';

    if active_runners_count = 0 and jailed_runners_count > 0 then
      perform public.end_game(current_game.id, 'hunters', 'all_jailed');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  -- Ghost NPC simulation loop for Haunted Map & Ghost Duel
  if current_game.status = 'live' and current_game.mode_id in ('haunted_map', 'ghost_duel') then
    for ghost_rec in
      select * from public.entities e where e.game_id = current_game.id and e.kind = 'ghost'
    loop
      if (ghost_rec.state->>'path_wkt') is not null or (ghost_rec.state->>'path_geojson') is not null then
        if (ghost_rec.state->>'path_wkt') is not null then
          patrol_geom := extensions.st_geomfromtext(ghost_rec.state->>'path_wkt', 4326);
        else
          patrol_geom := extensions.st_geomfromgeojson(ghost_rec.state->>'path_geojson');
        end if;

        patrol_len := extensions.st_length(patrol_geom::extensions.geography);
        if patrol_len > 0 then
          fraction := (
            extract(epoch from (now() - coalesce((ghost_rec.state->>'spawned_at')::timestamptz, current_game.live_at)))
            * coalesce((ghost_rec.state->>'speed_mps')::double precision, 1.4)
          ) / patrol_len;

          fraction := fraction - floor(fraction);
          ghost_curr_pt := extensions.st_lineinterpolatepoint(patrol_geom, fraction);

          update public.entities
          set geog = ghost_curr_pt::extensions.geography
          where id = ghost_rec.id;

          ghost_mode_setting := coalesce(current_game.ghost_mode, 'haunt');

          if ghost_mode_setting = 'assist' then
            for runner_rec in
              select p.id as runner_id, pp.geog, pp.accuracy_m
              from public.players p
              join public.player_positions pp on pp.player_id = p.id
              where p.game_id = current_game.id
                and p.team = 'runner'
                and p.status = 'active'
                and pp.recorded_at > now() - interval '20 seconds'
            loop
              dist := extensions.st_distance(ghost_curr_pt::extensions.geography, runner_rec.geog);
              if dist <= 25.0 then
                if not exists (
                  select 1 from public.pings pi
                  where pi.game_id = current_game.id
                    and pi.player_id = runner_rec.runner_id
                    and pi.reason = 'ghost_assist'
                    and pi.released_at > now() - interval '30 seconds'
                ) then
                  select coalesce(max(seq), 0) + 1 into next_seq
                  from public.pings pi where pi.game_id = current_game.id;

                  insert into public.pings (
                    game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
                  )
                  values (
                    current_game.id,
                    next_seq,
                    runner_rec.runner_id,
                    runner_rec.geog,
                    runner_rec.accuracy_m,
                    0,
                    'ghost_assist',
                    now()
                  );

                  insert into public.events (game_id, type, audience, payload)
                  values (
                    current_game.id,
                    'ghost_sighting',
                    'hunter',
                    jsonb_build_object(
                      'ghost_id', ghost_rec.id,
                      'message', 'Ghost spotted a runner nearby!'
                    )
                  );
                end if;

                if not exists (
                  select 1 from public.events ev
                  where ev.game_id = current_game.id
                    and ev.type = 'ghost_blip'
                    and ev.target_player = runner_rec.runner_id
                    and ev.created_at > now() - interval '30 seconds'
                ) then
                  insert into public.events (game_id, type, target_player, audience, payload)
                  values (
                    current_game.id,
                    'ghost_blip',
                    runner_rec.runner_id,
                    'runner',
                    jsonb_build_object('message', 'A spectral chill passes through you...')
                  );
                end if;
              end if;
            end loop;

          else
            haunt_radius := coalesce((ghost_rec.state->>'haunt_radius_m')::double precision, 12.0);
            v_dwell_s := coalesce((current_game.mode_params->'haunted_map'->>'haunt_dwell_s')::integer, 3);

            for runner_rec in
              select p.id as runner_id, pp.geog, pp.accuracy_m
              from public.players p
              join public.player_positions pp on pp.player_id = p.id
              where p.game_id = current_game.id
                and p.team = 'runner'
                and p.status = 'active'
                and pp.recorded_at > now() - interval '20 seconds'
                and coalesce(pp.accuracy_m, 0) <= 30.0
            loop
              dist := extensions.st_distance(ghost_curr_pt::extensions.geography, runner_rec.geog);
              if dist <= haunt_radius then
                if (ghost_rec.state->'dwell_times'->>(runner_rec.runner_id::text)) is null then
                  update public.entities
                  set state = jsonb_set(
                    coalesce(state, '{}'::jsonb),
                    array['dwell_times', runner_rec.runner_id::text],
                    to_jsonb(now()::text)
                  )
                  where id = ghost_rec.id;
                elsif now() >= ((ghost_rec.state->'dwell_times'->>(runner_rec.runner_id::text))::timestamptz + make_interval(secs => v_dwell_s)) then
                  update public.players
                  set status = 'tagged', tagged_at = now(), is_ready = false
                  where id = runner_rec.runner_id;

                  insert into public.events (game_id, type, audience, payload)
                  values (
                    current_game.id,
                    'runner_haunted',
                    'all',
                    jsonb_build_object(
                      'runner_id', runner_rec.runner_id,
                      'ghost_id', ghost_rec.id,
                      'distance_m', round(dist::numeric, 1)
                    )
                  );

                  if not exists (
                    select 1 from public.players pl
                    where pl.game_id = current_game.id and pl.team = 'runner' and pl.status = 'active'
                  ) then
                    perform public.end_game(current_game.id, 'hunters', 'all_tagged');
                    select * into current_game from public.games g where g.id = advance_game.game_id;
                    return current_game.status;
                  end if;
                end if;
              else
                if (ghost_rec.state->'dwell_times'->>(runner_rec.runner_id::text)) is not null then
                  update public.entities
                  set state = jsonb_set(
                    coalesce(state, '{}'::jsonb),
                    '{dwell_times}',
                    (coalesce(state->'dwell_times', '{}'::jsonb) - runner_rec.runner_id::text)
                  )
                  where id = ghost_rec.id;
                end if;
              end if;
            end loop;
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- Classic Chase secret target arrival check
  if current_game.status = 'live' and current_game.mode = 'classic_chase' then
    select * into target_rec from public.targets t where t.game_id = current_game.id;
    if target_rec.id is not null then
      for p_runner in
        select p.id, pp.geog, pp.accuracy_m
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.status = 'active'
          and pp.recorded_at > now() - interval '20 seconds'
      loop
        if extensions.st_distance(p_runner.geog, target_rec.geog)
           <= target_rec.radius_m + least(10::double precision, coalesce(p_runner.accuracy_m, 0)::double precision) then
          perform public.end_game(current_game.id, 'runners', 'target_reached');
          select * into current_game from public.games g where g.id = advance_game.game_id;
          return current_game.status;
        end if;
      end loop;
    end if;
  end if;

  -- Scramble expiration check
  if current_game.status = 'live' and 'double_agent' = any(current_game.roles) then
    if (current_game.scrambled_until is not null) and (now() >= current_game.scrambled_until) then
      update public.games set scrambled_until = null where id = current_game.id;
      insert into public.events (game_id, type, audience, payload)
      values (current_game.id, 'scramble_expired', 'hunter', jsonb_build_object('message', 'Hunter radar is restored.'));
    end if;
  end if;

  -- Scheduled pings
  if current_game.status = 'live' and current_game.ping_interval_s > 0 then
    select coalesce(max(released_at), current_game.live_at) + make_interval(secs => current_game.ping_interval_s)
      into next_ping_at
      from public.pings
      where pings.game_id = current_game.id and reason = 'scheduled';

    if next_ping_at is null then
      next_ping_at := current_game.live_at + make_interval(secs => current_game.ping_interval_s);
    end if;

    if now() >= next_ping_at then
      select coalesce(max(seq), 0) + 1 into next_seq
        from public.pings
        where pings.game_id = current_game.id;

      for pos in
        select pp.player_id, pp.geog, pp.accuracy_m,
               extract(epoch from (now() - pp.recorded_at))::integer as age_s
        from public.player_positions pp
        join public.players p on p.id = pp.player_id
        where p.game_id = current_game.id
          and p.status = 'active'
          and p.team = 'runner'
          and pp.recorded_at > now() - interval '60 seconds'
          and not exists (
            select 1 from public.active_effects ae
            where ae.game_id = current_game.id
              and ae.effect = 'veil'
              and ae.expires_at > now()
              and ae.player_id = p.id
          )
      loop
        insert into public.pings (
          game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
        )
        values (
          current_game.id,
          next_seq,
          pos.player_id,
          pos.geog,
          pos.accuracy_m,
          pos.age_s,
          'scheduled',
          now()
        );
      end loop;

      insert into public.events (game_id, type, payload)
      values (
        current_game.id,
        'ping_released',
        jsonb_build_object('seq', next_seq, 'reason', 'scheduled')
      );
    end if;
  end if;

  -- Time expired game ending
  if current_game.status = 'live' and clock_timestamp() >= current_game.ends_at then
    if current_game.mode = 'classic_chase' then
      perform public.end_game(current_game.id, 'hunters', 'time_expired');
    elsif current_game.mode_id = 'jailbreak' then
      select count(*) into active_runners_count
        from public.players p
        where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active';
      if active_runners_count > 0 then
        perform public.end_game(current_game.id, 'runners', 'time_expired');
      else
        perform public.end_game(current_game.id, 'hunters', 'all_jailed');
      end if;
    else
      perform public.end_game(current_game.id, 'runners', 'time_expired');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  return current_game.status;
end;
$$;

revoke all on function public.advance_game(uuid) from public, anon;
grant execute on function public.advance_game(uuid) to authenticated;

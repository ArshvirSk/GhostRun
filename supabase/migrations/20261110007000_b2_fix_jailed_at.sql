-- Migration: 20261110007000_b2_fix_jailed_at.sql
-- Fix get_game_state and advance_game to use p.tagged_at instead of non-existent p.jailed_at

-- 1. get_game_state -----------------------------------------------------------

create or replace function public.get_game_state(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  snapshot jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(get_game_state.game_id) then raise exception 'You are not a member of this game.'; end if;

  perform public.advance_game(get_game_state.game_id);

  select jsonb_build_object(
    'server_time', now(),
    'game', to_jsonb(g) || jsonb_build_object(
      'area', jsonb_build_object(
        'longitude', extensions.st_x(g.area_center::extensions.geometry),
        'latitude', extensions.st_y(g.area_center::extensions.geometry),
        'radius_m', public.effective_radius_m(g.id),
        'base_radius_m', g.area_radius_m,
        'zone_stage', g.zone_stage,
        'zone_stage_count', array_length(public.zone_stage_values(g.id), 1),
        'shrinking', 'shrinking_zone' = any(g.modifiers)
      ),
      'target_set', exists (select 1 from public.targets t where t.game_id = g.id),
      'ping_visible_s', g.ping_visible_s,
      'ghost_mode', g.ghost_mode,
      'jail', (
        select jsonb_build_object(
          'id', e.id,
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 15)
        )
        from public.entities e
        where e.game_id = g.id and e.kind = 'jail'
        limit 1
      )
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
        'joined_at', p.joined_at,
        'jailed_at', case when p.status = 'jailed' then p.tagged_at else null end,
        'secret_role', case
          when g.status in ('ended', 'cancelled') or p.id = mine.id then p.secret_role
          else null
        end
      ) order by p.joined_at)
      from public.players p join public.profiles pr on pr.id = p.user_id
      where p.game_id = g.id and p.status <> 'left'
    ), '[]'::jsonb),
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
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', pp.player_id,
        'display_name', pr.display_name,
        'color', pr.color,
        'team', p.team,
        'longitude', extensions.st_x(pp.geog::extensions.geometry),
        'latitude', extensions.st_y(pp.geog::extensions.geometry),
        'accuracy_m', pp.accuracy_m,
        'recorded_at', pp.recorded_at,
        'is_mock', pp.is_mock
      ) order by p.joined_at)
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      join public.profiles pr on pr.id = p.user_id
      where pp.game_id = g.id
        and p.status <> 'left'
        and (
          g.status in ('ended', 'cancelled')
          or p.id = mine.id
          or (mine.team <> 'solo' and p.team = mine.team and p.status <> 'jailed')
        )
    ), '[]'::jsonb),
    'pings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ping.id,
        'seq', ping.seq,
        'longitude', extensions.st_x(ping.geog::extensions.geometry),
        'latitude', extensions.st_y(ping.geog::extensions.geometry),
        'position_age_s', round(ping.accuracy_m),
        'released_at', ping.released_at
      ) order by ping.seq)
      from public.pings ping
      where ping.game_id = g.id
        and (
          g.status in ('ended', 'cancelled')
          or (
            ping.released_at >= now() - make_interval(secs => coalesce(g.ping_visible_s, 10))
            and (
              g.mode_id <> 'assassin_ring'
              or ping.player_id = (
                select ra.prey_player_id from public.ring_assignments ra
                where ra.game_id = g.id and ra.hunter_player_id = mine.id and ra.status = 'active'
              )
            )
          )
        )
    ), '[]'::jsonb),
    'assassin_ring', case
      when g.mode_id = 'assassin_ring' then jsonb_build_object(
        'my_prey', (
          select jsonb_build_object(
            'player_id', prey_p.id,
            'display_name', prey_pr.display_name,
            'color', prey_pr.color,
            'status', prey_p.status
          )
          from public.ring_assignments ra
          join public.players prey_p on prey_p.id = ra.prey_player_id
          join public.profiles prey_pr on prey_pr.id = prey_p.user_id
          where ra.game_id = g.id
            and ra.hunter_player_id = mine.id
            and ra.status = 'active'
        ),
        'hunter_proximity', (
          select case
            when hunter_pp.geog is null or my_pp.geog is null then 'none'
            when extensions.st_dwithin(hunter_pp.geog, my_pp.geog, 40) then 'close'
            when extensions.st_dwithin(hunter_pp.geog, my_pp.geog, 100) then 'near'
            else 'none'
          end
          from public.ring_assignments ra
          join public.player_positions hunter_pp on hunter_pp.player_id = ra.hunter_player_id
          left join public.player_positions my_pp on my_pp.player_id = mine.id
          where ra.game_id = g.id
            and ra.prey_player_id = mine.id
            and ra.status = 'active'
        ),
        'safe_zones', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id,
            'zone_index', coalesce((e.state->>'zone_index')::int, 1),
            'longitude', extensions.st_x(e.geog::extensions.geometry),
            'latitude', extensions.st_y(e.geog::extensions.geometry),
            'radius_m', coalesce((e.state->>'radius_m')::int, 20)
          ))
          from public.entities e
          where e.game_id = g.id and e.kind = 'safe_zone'
        ), '[]'::jsonb),
        'in_safe_zone', exists (
          select 1 from public.entities e
          join public.player_positions pp on pp.player_id = mine.id
          where e.game_id = g.id and e.kind = 'safe_zone'
            and extensions.st_dwithin(e.geog, pp.geog, coalesce((e.state->>'radius_m')::int, 20))
        ),
        'active_survivors', (
          select count(*) from public.players sp where sp.game_id = g.id and sp.status = 'active'
        )
      )
      else null
    end,
    'target', case
      when g.mode_id = 'classic_chase' and (
        g.status in ('ended', 'cancelled')
        or mine.team = 'runner'
      ) then (
        select jsonb_build_object(
          'id', t.id,
          'longitude', extensions.st_x(t.geog::extensions.geometry),
          'latitude', extensions.st_y(t.geog::extensions.geometry),
          'radius_m', t.radius_m,
          'selected_by_player_id', t.selected_by_player_id
        )
        from public.targets t where t.game_id = g.id
      )
      else null
    end
  ) into snapshot
  from public.games g
  join public.players mine on mine.game_id = g.id and mine.user_id = caller_id
  where g.id = get_game_state.game_id;

  return snapshot;
end;
$$;

-- 2. advance_game -------------------------------------------------------------

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
  stage_index integer;
  progress double precision;
  next_stage integer;
  next_start timestamptz;
  ghost_rec record;
  patrol_geom geometry;
  duration_s int;
  effective_duration_s int;
  elapsed_s float;
  loop_frac float;
  current_ghost_pt geometry;
  runner_fix record;
  active_runners_count int;
  jailed_runners_count int;
  active_survivors_count int;
  v_dwells jsonb;
  v_first_seen timestamptz;
  v_ghost_ping_seq integer;
  v_auto_release_s integer;
  jailed_rec record;
  jail_rec public.entities%rowtype;
  offline_rec record;
  v_next_prey_id uuid;
begin
  if caller_id is not null and not public.is_member(advance_game.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into current_game from public.games g
    where g.id = advance_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status = 'countdown'
     and current_game.head_start_at is not null
     and now() >= current_game.head_start_at then
    update public.games g set status = 'head_start'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type, payload)
    values (current_game.id, 'head_start_began', jsonb_build_object('phase', 'head_start'));
  end if;

  if current_game.status = 'head_start'
     and current_game.live_at is not null
     and now() >= current_game.live_at then
    update public.games g set status = 'live'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type, payload)
    values (current_game.id, 'live_began', jsonb_build_object('phase', 'live'));
  end if;

  -- Shrinking zone progression: advance stage and announce 60 s before
  zone_on := 'shrinking_zone' = any(current_game.modifiers);
  if zone_on and current_game.status = 'live' then
    stages := public.zone_stage_values(current_game.id);
    stage_count := coalesce(array_length(stages, 1), 0);

    if stage_count > 0 and current_game.zone_stage < stage_count then
      progress := extract(epoch from (now() - current_game.live_at))
        / greatest(1, extract(epoch from (current_game.ends_at - current_game.live_at)));
      stage_index := least(stage_count, floor(progress * stage_count)::integer + 1);

      if stage_index > current_game.zone_stage then
        update public.games g
          set zone_stage = stage_index
          where g.id = current_game.id
          returning * into current_game;

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

  -- Jailbreak mode passive processing
  if current_game.status = 'live' and current_game.mode_id = 'jailbreak' then
    v_auto_release_s := coalesce(
      (current_game.mode_params->'jailbreak'->>'auto_release_s')::int,
      300
    );

    for jailed_rec in
      select p.id, p.user_id, p.tagged_at as jailed_at, pr.display_name
      from public.players p
      join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id
        and p.status = 'jailed'
        and p.tagged_at is not null
        and now() >= p.tagged_at + make_interval(secs => v_auto_release_s)
    loop
      update public.players
        set status = 'active', tagged_at = null, status_detail = status_detail - 'free_started_at'
        where id = jailed_rec.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'player_released', 'all',
        jsonb_build_object(
          'player_id', jailed_rec.id,
          'display_name', jailed_rec.display_name,
          'reason', 'auto_release'
        )
      );
    end loop;

    select count(*) into active_runners_count
      from public.players p
      where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active';

    if active_runners_count = 0 then
      perform public.end_game(current_game.id, 'hunters', 'all_jailed');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  -- Assassin Ring mode passive processing: offline relink and survivor check
  if current_game.status = 'live' and current_game.mode_id = 'assassin_ring' then
    for offline_rec in
      select ra.id as assignment_id, ra.hunter_player_id, ra.prey_player_id, pr.display_name
      from public.ring_assignments ra
      join public.players prey_p on prey_p.id = ra.prey_player_id
      join public.profiles pr on pr.id = prey_p.user_id
      left join public.player_positions pp on pp.player_id = prey_p.id
      where ra.game_id = current_game.id
        and ra.status = 'active'
        and prey_p.status = 'active'
        and (pp.recorded_at is null or pp.recorded_at < now() - interval '180 seconds')
    loop
      select ra2.prey_player_id into v_next_prey_id
      from public.ring_assignments ra2
      where ra2.game_id = current_game.id and ra2.hunter_player_id = offline_rec.prey_player_id and ra2.status = 'active';

      if v_next_prey_id is not null and v_next_prey_id <> offline_rec.hunter_player_id then
        update public.players set status = 'tagged', tagged_at = now() where id = offline_rec.prey_player_id;
        update public.ring_assignments ra set status = 'eliminated', eliminated_at = now()
          where ra.game_id = current_game.id and ra.prey_player_id = offline_rec.prey_player_id and ra.status = 'active';
        update public.ring_assignments ra set status = 'relinked' where ra.id = offline_rec.assignment_id;

        insert into public.ring_assignments (game_id, hunter_player_id, prey_player_id, status)
        values (current_game.id, offline_rec.hunter_player_id, v_next_prey_id, 'active');

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'player_timed_out', 'all',
          jsonb_build_object(
            'player_id', offline_rec.prey_player_id,
            'display_name', offline_rec.display_name,
            'reason', 'offline_timeout'
          )
        );
      end if;
    end loop;

    select count(*) into active_survivors_count
    from public.players sp
    where sp.game_id = current_game.id and sp.status = 'active';

    if active_survivors_count <= 1 then
      perform public.end_game(current_game.id, 'solo', 'last_survivor');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  -- Ghost NPC movement and tagging (Haunted Map)
  if current_game.status = 'live' and ('ghost_npc' = any(current_game.modifiers) or current_game.mode_id = 'haunted_map') then
    for ghost_rec in
      select e.id, e.state
      from public.entities e
      where e.game_id = current_game.id and e.kind = 'ghost'
    loop
      patrol_geom := extensions.st_geomfromgeojson(ghost_rec.state->>'patrol_route');
      duration_s := coalesce((ghost_rec.state->>'duration_s')::int, 600);
      effective_duration_s := greatest(30, duration_s / 3);
      elapsed_s := extract(epoch from (now() - current_game.live_at));
      loop_frac := (elapsed_s % effective_duration_s) / effective_duration_s::float;

      current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

      update public.entities
      set geog = current_ghost_pt::extensions.geography,
          updated_at = now()
      where id = ghost_rec.id;

      for runner_fix in
        select pp.player_id, pp.geog, pp.accuracy_m, pr.display_name
        from public.player_positions pp
        join public.players p on p.id = pp.player_id
        join public.profiles pr on pr.id = p.user_id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.status = 'active'
          and pp.accuracy_m <= 30.0
          and pp.recorded_at > now() - interval '15 seconds'
      loop
        if current_game.ghost_mode = 'assist' then
          if extensions.st_dwithin(current_ghost_pt::extensions.geography, runner_fix.geog, 40.0) then
            select coalesce(max(p.seq), 0) + 1 into v_ghost_ping_seq
            from public.pings p where p.game_id = current_game.id;

            insert into public.pings (
              game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
            ) values (
              current_game.id,
              v_ghost_ping_seq,
              runner_fix.player_id,
              runner_fix.geog,
              runner_fix.accuracy_m,
              0,
              'ghost_sighting',
              now()
            );

            insert into public.events (game_id, type, audience, payload)
            values (
              current_game.id, 'ghost_sighting', 'hunter',
              jsonb_build_object(
                'runner_id', runner_fix.player_id,
                'message', 'Ghost spotted a runner nearby!'
              )
            );
          end if;
        end if;

        if extensions.st_dwithin(current_ghost_pt::extensions.geography, runner_fix.geog, 12.0) then
          v_dwells := coalesce(ghost_rec.state->'dwells', '{}'::jsonb);
          v_first_seen := (v_dwells->>(runner_fix.player_id::text))::timestamptz;

          if v_first_seen is null then
            v_dwells := jsonb_set(
              v_dwells,
              array[runner_fix.player_id::text],
              to_jsonb(now()::text)
            );
            update public.entities
            set state = jsonb_set(ghost_rec.state, '{dwells}', v_dwells)
            where id = ghost_rec.id;
          elsif now() >= v_first_seen + interval '3 seconds' then
            update public.players
            set status = 'tagged', tagged_at = now()
            where id = runner_fix.player_id;

            insert into public.events (game_id, type, audience, payload)
            values (
              current_game.id, 'runner_haunted', 'all',
              jsonb_build_object(
                'runner_id', runner_fix.player_id,
                'display_name', runner_fix.display_name,
                'ghost_id', ghost_rec.id
              )
            );

            select count(*) into active_runners_count
            from public.players sp
            where sp.game_id = current_game.id and sp.team = 'runner' and sp.status = 'active';

            if active_runners_count = 0 then
              perform public.end_game(current_game.id, 'hunters', 'all_haunted');
            end if;

            v_dwells := v_dwells - (runner_fix.player_id::text);
            update public.entities
            set state = jsonb_set(ghost_rec.state, '{dwells}', v_dwells)
            where id = ghost_rec.id;
          end if;
        else
          v_dwells := coalesce(ghost_rec.state->'dwells', '{}'::jsonb);
          if v_dwells ? (runner_fix.player_id::text) then
            v_dwells := v_dwells - (runner_fix.player_id::text);
            update public.entities
            set state = jsonb_set(ghost_rec.state, '{dwells}', v_dwells)
            where id = ghost_rec.id;
          end if;
        end if;
      end loop;
    end loop;
  end if;

  -- Scheduled radar ping release
  if current_game.status = 'live'
     and current_game.next_ping_at is not null
     and now() >= current_game.next_ping_at then
    next_ping := current_game.next_ping_at;
    while next_ping <= now() loop
      next_ping := next_ping + make_interval(secs => current_game.ping_interval_s);
    end loop;

    update public.games g set
      ping_seq = g.ping_seq + 1,
      next_ping_at = next_ping
      where g.id = current_game.id
      returning * into current_game;

    for runner in
      select p.id, pp.geog, pp.accuracy_m, pp.recorded_at, p.status_detail
      from public.players p
      join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id
        and (
          (current_game.mode_id <> 'assassin_ring' and p.team = 'runner' and p.status = 'active')
          or (current_game.mode_id = 'assassin_ring' and p.status = 'active')
        )
        and pp.recorded_at > now() - interval '2 minutes'
    loop
      if runner.status_detail ? 'veil' then
        update public.players p
          set status_detail = p.status_detail - 'veil'
          where p.id = runner.id;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'veil_used', 'runner',
          jsonb_build_object('player_id', runner.id)
        );
        continue;
      end if;

      -- Skip ping if player is inside an active safe zone in assassin_ring
      if current_game.mode_id = 'assassin_ring' and exists (
        select 1 from public.entities e
        where e.game_id = current_game.id and e.kind = 'safe_zone'
          and extensions.st_dwithin(e.geog, runner.geog, coalesce((e.state->>'radius_m')::int, 20))
      ) then
        continue;
      end if;

      ping_geog := runner.geog;
      if (runner.status_detail ? 'decoy') or (runner.status_detail ? 'scramble') then
        shift_m := 150 + random() * 100;
        ping_geog := extensions.st_project(runner.geog, shift_m, radians(random() * 360));

        dist_from_center := extensions.st_distance(ping_geog, current_game.area_center);
        if dist_from_center > current_game.area_radius_m - 10 then
          bearing := extensions.st_azimuth(
            current_game.area_center::extensions.geometry,
            ping_geog::extensions.geometry
          );
          ping_geog := extensions.st_project(
            current_game.area_center,
            greatest(10, current_game.area_radius_m - 10),
            bearing
          );
        end if;

        if runner.status_detail ? 'scramble' then
          update public.players p
            set status_detail = p.status_detail - 'scramble'
            where p.id = runner.id;
        end if;

        if runner.status_detail ? 'decoy' then
          update public.players p
            set status_detail = p.status_detail - 'decoy'
            where p.id = runner.id;
          insert into public.events (game_id, type, audience, payload)
          values (
            current_game.id, 'decoy_used', 'runner',
            jsonb_build_object('player_id', runner.id)
          );
        end if;
      end if;

      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
      ) values (
        current_game.id,
        current_game.ping_seq,
        runner.id,
        ping_geog,
        runner.accuracy_m,
        greatest(0, floor(extract(epoch from (now() - runner.recorded_at)))::integer),
        'scheduled',
        now()
      );
      ping_count := ping_count + 1;
    end loop;

    if ping_count > 0 then
      insert into public.events (game_id, type, payload)
      values (
        current_game.id,
        'ping_released',
        jsonb_build_object(
          'seq', current_game.ping_seq,
          'count', ping_count,
          'released_at', now()
        )
      );
    end if;
  end if;

  -- Time expiry win check
  if current_game.status in ('countdown', 'head_start', 'live')
     and current_game.ends_at is not null
     and now() >= current_game.ends_at then
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
    elsif current_game.mode_id = 'assassin_ring' then
      perform public.end_game(current_game.id, 'solo', 'time_expired');
    else
      perform public.end_game(current_game.id, 'runners', 'time_expired');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  return current_game.status;
end;
$$;

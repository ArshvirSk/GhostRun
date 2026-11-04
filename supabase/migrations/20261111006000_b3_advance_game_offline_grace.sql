-- Migration: 20261111006000_b3_advance_game_offline_grace.sql
-- Fix carrier offline check in advance_game: only auto-drop if the round has been live for >= 60 seconds

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
  path_len_m double precision;
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
  pkg_offline record;
  carrier_rec record;
  v_carrier_ping_seq integer;
begin
  if caller_id is null or not public.is_member(advance_game.game_id) then
    -- health_ping or worker can call without membership
    null;
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

  -- Shrinking zone progression
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
            'radius_m', round(public.effective_radius_m(current_game.id)::numeric, 1)
          )
        );
      end if;

      next_stage := current_game.zone_stage + 1;
      if next_stage <= stage_count then
        next_start := current_game.live_at
          + make_interval(secs => (extract(epoch from (current_game.ends_at - current_game.live_at)) * (next_stage - 1) / stage_count));
        if now() >= next_start - interval '60 seconds' and not exists (
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
              'starts_in_s', greatest(0, floor(extract(epoch from (next_start - now())))::integer)
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

  -- Assassin Ring mode passive processing
  if current_game.status = 'live'
     and current_game.mode_id = 'assassin_ring'
     and current_game.live_at is not null
     and now() >= current_game.live_at + interval '180 seconds' then
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

  -- Relay Heist: carrier offline auto-drop (only after at least 60s of live play, and carrier position is stale > 60s)
  if current_game.status = 'live'
     and current_game.mode_id = 'relay_heist'
     and current_game.live_at is not null
     and current_game.live_at < now() - interval '60 seconds' then
    for pkg_offline in
      select e.id as entity_id, p.id as carrier_id, pr.display_name, pp.geog as carrier_geog
      from public.entities e
      join public.players p on p.id = (e.state->>'carrier_player_id')::uuid
      join public.profiles pr on pr.id = p.user_id
      left join public.player_positions pp on pp.player_id = p.id
      where e.game_id = current_game.id
        and e.kind = 'package'
        and (e.state->>'status') = 'carried'
        and (pp.recorded_at is null or pp.recorded_at < now() - interval '60 seconds')
    loop
      update public.entities e
      set geog = coalesce(pkg_offline.carrier_geog, e.geog),
          state = jsonb_build_object(
            'status', 'dropped',
            'carrier_player_id', null,
            'dropped_at', now(),
            'securing_hunter_id', null,
            'securing_started_at', null
          ),
          visible_to = 'all',
          updated_at = now()
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

  -- Ghost NPC simulation loop for Haunted Map & Ghost Duel
  if current_game.status = 'live' and current_game.mode_id in ('haunted_map', 'ghost_duel') then
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
        loop_frac := (elapsed_s / effective_duration_s) - floor(elapsed_s / effective_duration_s);
        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        if extensions.st_distance(current_ghost_pt::geography, current_game.area_center) > current_game.area_radius_m then
          current_ghost_pt := extensions.st_project(
            current_game.area_center,
            current_game.area_radius_m - 5,
            extensions.st_azimuth(current_game.area_center::geometry, current_ghost_pt)
          )::geometry;
        end if;

        v_dwells := coalesce(ghost_rec.state->'dwells', '{}'::jsonb);

        for runner_fix in
          select p.id as runner_id, pr.display_name as runner_name,
                 extensions.st_distance(pp.geog, current_ghost_pt::geography) as dist_m,
                 pp.accuracy_m
          from public.players p
          join public.profiles pr on pr.id = p.user_id
          join public.player_positions pp on pp.player_id = p.id
          where p.game_id = current_game.id
            and p.team = 'runner'
            and p.status = 'active'
            and pp.recorded_at > now() - interval '2 minutes'
            and coalesce(pp.accuracy_m, 0) <= 30
        loop
          if current_game.ghost_mode = 'assist' then
            if runner_fix.dist_m <= 30.0 then
              select coalesce(max(seq), 0) + 1 into v_ghost_ping_seq
              from public.pings where pings.game_id = current_game.id;

              insert into public.pings (game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at)
              values (
                current_game.id,
                v_ghost_ping_seq,
                runner_fix.runner_id,
                current_ghost_pt::geography,
                25,
                0,
                'ghost_sighting',
                now()
              );

              if not exists (
                select 1 from public.events ev
                where ev.game_id = current_game.id
                  and ev.type = 'ghost_sighting'
                  and ev.created_at > now() - interval '20 seconds'
              ) then
                insert into public.events (game_id, type, audience, payload)
                values (
                  current_game.id,
                  'ghost_sighting',
                  'hunter',
                  jsonb_build_object(
                    'ghost_index', ghost_rec.state->>'ghost_index',
                    'runner_id', runner_fix.runner_id,
                    'approx_lat', round(extensions.st_y(current_ghost_pt)::numeric, 5),
                    'approx_lng', round(extensions.st_x(current_ghost_pt)::numeric, 5),
                    'message', 'A ghost sighted a runner!'
                  )
                );
              end if;
            end if;
          end if;

          if runner_fix.dist_m <= 12.0 then
            if not (v_dwells ? runner_fix.runner_id::text) then
              v_dwells := jsonb_set(v_dwells, array[runner_fix.runner_id::text], to_jsonb(now()));
            else
              v_first_seen := (v_dwells->>runner_fix.runner_id::text)::timestamptz;
              if now() >= v_first_seen + interval '3 seconds' then
                v_dwells := v_dwells - runner_fix.runner_id::text;

                update public.players
                set status = 'tagged', tagged_at = now()
                where id = runner_fix.runner_id;

                insert into public.events (game_id, type, audience, payload)
                values (
                  current_game.id,
                  'runner_tagged',
                  'all',
                  jsonb_build_object(
                    'runner_id', runner_fix.runner_id,
                    'runner_name', runner_fix.runner_name,
                    'by', 'ghost',
                    'reason', 'haunted',
                    'tagged_at', now()
                  )
                );

                select count(*) into active_runners_count
                from public.players p
                where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active';

                if active_runners_count = 0 then
                  perform public.end_game(current_game.id, 'hunters', 'all_tagged');
                  select * into current_game from public.games g where g.id = advance_game.game_id;
                  return current_game.status;
                end if;
              end if;
            end if;
          else
            if v_dwells ? runner_fix.runner_id::text then
              v_dwells := v_dwells - runner_fix.runner_id::text;
            end if;
          end if;
        end loop;

        update public.entities
        set geog = current_ghost_pt::geography,
            state = jsonb_set(
              jsonb_set(
                jsonb_set(ghost_rec.state, '{current_lat}', to_jsonb(extensions.st_y(current_ghost_pt))),
                '{current_lng}', to_jsonb(extensions.st_x(current_ghost_pt))
              ),
              '{dwells}', v_dwells
            ),
            updated_at = now()
        where id = ghost_rec.id;
      end if;
    end loop;
  end if;

  -- Relay Heist: carrier extra radar ping release (1.5x cadence)
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
        and pp.recorded_at > now() - interval '2 minutes'
    loop
      if carrier_rec.next_carrier_ping is null then
        update public.entities e
        set state = jsonb_set(e.state, '{next_carrier_ping_at}', to_jsonb((now() + make_interval(secs => greatest(10, floor(current_game.ping_interval_s / 1.5)::int)))::text))
        where e.game_id = current_game.id and e.kind = 'package';
      elsif now() >= carrier_rec.next_carrier_ping then
        update public.entities e
        set state = jsonb_set(e.state, '{next_carrier_ping_at}', to_jsonb((now() + make_interval(secs => greatest(10, floor(current_game.ping_interval_s / 1.5)::int)))::text))
        where e.game_id = current_game.id and e.kind = 'package';

        update public.games g set ping_seq = g.ping_seq + 1
          where g.id = current_game.id
          returning g.ping_seq into v_carrier_ping_seq;

        insert into public.pings (
          game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
        ) values (
          current_game.id,
          v_carrier_ping_seq,
          carrier_rec.carrier_id,
          carrier_rec.carrier_geog,
          carrier_rec.accuracy_m,
          greatest(0, floor(extract(epoch from (now() - carrier_rec.recorded_at)))::integer),
          'carrier_radar',
          now()
        );
      end if;
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
  end if;

  -- Match expiry
  if current_game.status = 'live'
     and current_game.ends_at is not null
     and now() >= current_game.ends_at then
    if current_game.mode_id = 'assassin_ring' then
      perform public.end_game(current_game.id, 'solo', 'time_expired');
    elsif current_game.mode_id in ('tag_hunt', 'jailbreak') then
      perform public.end_game(current_game.id, 'runners', 'time_expired');
    else
      perform public.end_game(current_game.id, 'hunters', 'time_expired');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
    return current_game.status;
  end if;

  return current_game.status;
end;
$$;

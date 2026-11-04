-- Migration: 20261112011000_b4_vip_escort_fix_rls_suite.sql
-- Fix submit_position:
-- 1. Restore non-mock trail_points insertion throttled to 10s (unconditional on share_trail; filtered at read time by get_game_trails and RLS)
-- 2. Fix Classic Chase target arrival check to correctly evaluate when roles is empty: not ('vip' = any(coalesce(roles, '{}'))) or secret_role = 'vip'
-- Fix advance_game:
-- 1. Sequential phase transitions so both head_start_began and live_began are recorded even when head_start_s = 0

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
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  fix_time timestamptz;
  client_time timestamptz;
  fix_geog geography;
  v_in_bounds boolean;
  v_prev_out timestamptz;
  v_prev_noise integer;
  v_prev_speed real;
  v_prev_speed_at timestamptz;
  v_smoothed_speed real;
  v_noise integer := 0;
  v_prev_anchor geography;
  v_prev_anchor_since timestamptz;
  v_anchor geography;
  v_anchor_since timestamptz;
  v_camp_seq integer;
  v_noise_seq integer;
  v_radius real;
  v_accuracy real;
  v_speed real;
  v_heading real;
  v_fast_since timestamptz;
  v_vehicle_warned boolean;
  v_prev_fast_since timestamptz;
  v_prev_vehicle_warned boolean;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = submit_position.game_id
      and p.user_id = caller_id
      and p.status in ('active', 'jailed')
    for update;
  if not found then raise exception 'You are not an active player in this game.'; end if;

  perform public.advance_game(submit_position.game_id);

  select * into current_game from public.games g
    where g.id = submit_position.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status = 'ended' then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', now(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner
    );
  end if;

  if current_game.status = 'countdown' then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', now(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner
    );
  end if;

  if current_game.status not in ('head_start', 'live') then
    raise exception 'The round is not accepting positions.';
  end if;
  if submit_position.lat is null
     or submit_position.lng is null
     or submit_position.lat not between -90 and 90
     or submit_position.lng not between -180 and 180 then
    raise exception 'Position coordinates are invalid.';
  end if;

  v_accuracy := case
    when submit_position.accuracy is null or submit_position.accuracy < 0 then null
    else least(submit_position.accuracy, 100000)::real
  end;
  v_speed := case
    when submit_position.speed is null or submit_position.speed < 0 then null
    else least(submit_position.speed, 200)::real
  end;
  v_heading := case
    when submit_position.heading is null or submit_position.heading < 0 then null
    else (submit_position.heading::numeric % 360)::real
  end;

  client_time := coalesce(submit_position.recorded_at, now());
  if client_time > now() + interval '5 seconds' then fix_time := now();
  elsif client_time < now() - interval '2 minutes' then fix_time := now();
  else fix_time := client_time;
  end if;

  fix_geog := extensions.st_setsrid(
    extensions.st_makepoint(submit_position.lng, submit_position.lat), 4326
  )::geography;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_dwithin(fix_geog, current_game.area_center, v_radius);

  select pp.out_of_bounds_since, pp.noise, pp.smoothed_speed_mps, pp.updated_at,
         pp.anchor_geog, pp.anchor_since, pp.fast_since, pp.vehicle_warned
    into v_prev_out, v_prev_noise, v_prev_speed, v_prev_speed_at,
         v_prev_anchor, v_prev_anchor_since, v_prev_fast_since, v_prev_vehicle_warned
    from public.player_positions pp
    where pp.player_id = me.id;

  v_fast_since := coalesce(v_prev_fast_since, fix_time);
  v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);

  if v_speed is not null and v_speed >= 8.0 then
    if not v_vehicle_warned and (coalesce(fix_time, now()) - v_fast_since) >= interval '10 seconds' then
      v_vehicle_warned := true;
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'vehicle_warning',
        'all',
        jsonb_build_object(
          'player_id', me.id,
          'speed_mps', round(v_speed::numeric, 1),
          'message', 'Vehicle speed detected. Stay on foot!'
        )
      );
    end if;
  else
    v_fast_since := null;
    v_vehicle_warned := false;
  end if;

  if coalesce(submit_position.is_mock, false) then
    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'mock_location_detected',
      'host',
      jsonb_build_object(
        'player_id', me.id,
        'message', 'Mock location provider flagged for player.'
      )
    );
  end if;

  v_smoothed_speed := public.smoothed_speed(v_prev_speed, v_speed, v_prev_speed_at, fix_time);

  if 'noise_meter' = any(current_game.modifiers) and me.team = 'runner' then
    v_noise := public.calculate_noise(
      coalesce(v_prev_noise, 0),
      v_smoothed_speed,
      v_accuracy,
      v_prev_speed_at,
      fix_time
    );

    if v_noise >= 100 then
      update public.games g
        set ping_seq = g.ping_seq + 1
        where g.id = current_game.id
        returning g.ping_seq into v_noise_seq;

      insert into public.pings (game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at)
      values (current_game.id, v_noise_seq, me.id, fix_geog, coalesce(v_accuracy, 10)::real, 0, 'noise_burst', now());

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'noise_spike',
        'hunter',
        jsonb_build_object(
          'player_id', me.id,
          'noise', v_noise,
          'message', 'A runner made loud noise!'
        )
      );
      v_noise := 50;
    end if;
  end if;

  v_anchor := v_prev_anchor;
  v_anchor_since := v_prev_anchor_since;
  if v_anchor is null or not extensions.st_dwithin(fix_geog, v_anchor, 20) then
    v_anchor := fix_geog;
    v_anchor_since := fix_time;
  elsif v_anchor_since is not null and fix_time - v_anchor_since >= interval '3 minutes' then
    update public.games g
      set ping_seq = g.ping_seq + 1
      where g.id = current_game.id
      returning g.ping_seq into v_camp_seq;

    insert into public.pings (game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at)
    values (current_game.id, v_camp_seq, me.id, fix_geog, coalesce(v_accuracy, 10)::real, 0, 'anti_camp', now());

    v_anchor_since := fix_time;
  end if;

  insert into public.player_positions (
    player_id, game_id, geog, accuracy_m, speed_mps, heading_deg,
    is_mock, recorded_at, updated_at, out_of_bounds_since, noise,
    noise_alerted, smoothed_speed_mps, anchor_geog, anchor_since,
    fast_since, vehicle_warned
  )
  values (
    me.id, current_game.id, fix_geog, v_accuracy, v_speed, v_heading,
    coalesce(submit_position.is_mock, false), fix_time, now(),
    case when v_in_bounds then null else coalesce(v_prev_out, now()) end,
    coalesce(v_noise, 0), false, v_smoothed_speed, v_anchor, v_anchor_since,
    v_fast_since, v_vehicle_warned
  )
  on conflict (player_id) do update set
    geog = excluded.geog,
    accuracy_m = excluded.accuracy_m,
    speed_mps = excluded.speed_mps,
    heading_deg = excluded.heading_deg,
    is_mock = excluded.is_mock,
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

  if not v_in_bounds and v_prev_out is null then
    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'boundary_warning',
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id)
      )
    );
  end if;

  -- Classic Chase arrival check (if VIP is active, ONLY VIP can trigger arrival)
  if current_game.status = 'live'
     and current_game.mode_id = 'classic_chase'
     and me.team = 'runner'
     and me.status = 'active'
     and (not ('vip' = any(coalesce(current_game.roles, '{}'::text[]))) or me.secret_role = 'vip') then
    if exists (
      select 1 from public.targets t
      where t.game_id = current_game.id
        and extensions.st_dwithin(fix_geog, t.geog, current_game.target_radius_m)
    ) then
      perform public.end_game(current_game.id, 'runners', 'arrival');
      select * into current_game from public.games g where g.id = submit_position.game_id;
      return jsonb_build_object(
        'phase', current_game.status,
        'server_time', now(),
        'live_at', current_game.live_at,
        'ends_at', current_game.ends_at,
        'next_ping_at', current_game.next_ping_at,
        'in_bounds', v_in_bounds,
        'effective_radius_m', v_radius,
        'my_status', me.status,
        'winner', current_game.winner,
        'end_reason', current_game.end_reason
      );
    end if;
  end if;

  -- Relay Heist extraction check
  if current_game.status = 'live'
     and current_game.mode_id = 'relay_heist'
     and me.team = 'runner'
     and me.status = 'active' then
    if exists (
      select 1 from public.entities e
      where e.game_id = current_game.id
        and e.kind = 'package'
        and (e.state->>'status') = 'carried'
        and (e.state->>'carrier_player_id') = me.id::text
    ) and exists (
      select 1 from public.entities ex
      where ex.game_id = current_game.id
        and ex.kind in ('extraction', 'extraction_point')
        and extensions.st_dwithin(fix_geog, ex.geog, coalesce((ex.state->>'radius_m')::int, 25))
    ) then
      perform public.end_game(current_game.id, 'runners', 'extraction_complete');
      select * into current_game from public.games g where g.id = submit_position.game_id;
      return jsonb_build_object(
        'phase', current_game.status,
        'server_time', now(),
        'live_at', current_game.live_at,
        'ends_at', current_game.ends_at,
        'next_ping_at', current_game.next_ping_at,
        'in_bounds', v_in_bounds,
        'effective_radius_m', v_radius,
        'my_status', me.status,
        'winner', current_game.winner,
        'end_reason', current_game.end_reason
      );
    end if;
  end if;

  return jsonb_build_object(
    'phase', current_game.status,
    'server_time', now(),
    'live_at', current_game.live_at,
    'ends_at', current_game.ends_at,
    'next_ping_at', current_game.next_ping_at,
    'in_bounds', v_in_bounds,
    'effective_radius_m', v_radius,
    'my_status', me.status,
    'winner', current_game.winner,
    'noise', coalesce(v_noise, 0),
    'fast_since', v_fast_since,
    'vehicle_warned', v_vehicle_warned
  );
end;
$$;

revoke all on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) from public, anon;
grant execute on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) to authenticated;

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
  active_vip public.players%rowtype;
  promoted_bodyguard public.players%rowtype;
  promoted_name text;
begin
  if caller_id is null or not public.is_member(advance_game.game_id) then
    null;
  end if;

  select * into current_game from public.games g
    where g.id = advance_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status in ('ended', 'cancelled') then
    return current_game.status;
  end if;

  -- Phase transitions (sequential so head_start_began and live_began both emit when head_start_s = 0)
  if current_game.status = 'countdown' and now() >= current_game.head_start_at then
    update public.games g set status = 'head_start' where g.id = current_game.id;
    insert into public.events (game_id, type, audience, payload)
    values (current_game.id, 'head_start_began', 'all', jsonb_build_object('head_start_at', current_game.head_start_at));
    current_game.status := 'head_start';
  end if;

  if current_game.status = 'head_start' and now() >= current_game.live_at then
    update public.games g set status = 'live' where g.id = current_game.id;
    insert into public.events (game_id, type, audience, payload)
    values (current_game.id, 'live_began', 'all', jsonb_build_object('live_at', current_game.live_at));
    current_game.status := 'live';
  end if;

  if current_game.status = 'live' and now() >= current_game.ends_at then
    perform public.end_game(
      current_game.id,
      case
        when current_game.mode_id = 'classic_chase' then 'hunters'
        when current_game.mode_id = 'jailbreak' then 'runners'
        when current_game.mode_id = 'assassin_ring' then 'solo'
        when current_game.mode_id = 'relay_heist' then 'hunters'
        else 'runners'
      end,
      'time_expired'
    );
    select * into current_game from public.games g where g.id = advance_game.game_id;
    return current_game.status;
  end if;

  -- Scheduled radar pings
  if current_game.status = 'live' and now() >= current_game.next_ping_at then
    next_ping := current_game.next_ping_at + make_interval(secs => current_game.ping_interval_s);
    while next_ping <= now() loop
      next_ping := next_ping + make_interval(secs => current_game.ping_interval_s);
    end loop;

    for runner in
      select p.id, pp.geog, pp.accuracy_m, pp.recorded_at, p.status_detail
      from public.players p
      join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id
        and (
          (current_game.mode_id = 'assassin_ring' and p.team = 'solo' and p.status = 'active')
          or (current_game.mode_id <> 'assassin_ring' and p.team = 'runner' and p.status = 'active')
        )
        and pp.recorded_at > now() - interval '45 seconds'
    loop
      if runner.status_detail ? 'veil' then
        update public.players p
          set status_detail = p.status_detail - 'veil'
          where p.id = runner.id;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'veil_used',
          case when current_game.mode_id = 'assassin_ring' then 'all' else 'runner' end,
          jsonb_build_object('player_id', runner.id)
        );
        continue;
      end if;

      ping_geog := runner.geog;
      if runner.status_detail ? 'scramble' then
        shift_m := coalesce((runner.status_detail->'scramble'->>'shift_m')::double precision, 200.0);
        bearing := coalesce((runner.status_detail->'scramble'->>'bearing')::double precision, 45.0);
        ping_geog := extensions.st_project(ping_geog, shift_m, radians(bearing));
        dist_from_center := extensions.st_distance(ping_geog, current_game.area_center);
        if dist_from_center > current_game.area_radius_m then
          ping_geog := extensions.st_project(
            current_game.area_center,
            greatest(10.0, current_game.area_radius_m - 20.0),
            extensions.st_azimuth(current_game.area_center::geometry, ping_geog::geometry)
          );
        end if;
        update public.players p
          set status_detail = p.status_detail - 'scramble'
          where p.id = runner.id;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'scramble_applied', 'hunter',
          jsonb_build_object('player_id', runner.id)
        );
      end if;

      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
      ) values (
        current_game.id,
        current_game.ping_seq + 1,
        runner.id,
        ping_geog,
        coalesce(runner.accuracy_m, 10.0),
        greatest(0, floor(extract(epoch from (now() - runner.recorded_at)))::integer),
        'scheduled',
        now()
      );
      ping_count := ping_count + 1;
    end loop;

    update public.games g
      set next_ping_at = next_ping,
          ping_seq = g.ping_seq + case when ping_count > 0 then 1 else 0 end
      where g.id = current_game.id;
  end if;

  -- Shrinking Zone modifier
  zone_on := 'shrinking_zone' = any(current_game.modifiers);
  if zone_on and current_game.status = 'live' and current_game.live_at is not null and current_game.duration_s > 0 then
    stages := public.zone_stage_values(current_game.id);
    stage_count := coalesce(array_length(stages, 1), 0);
    if stage_count > 1 then
      progress := greatest(0.0, least(1.0, extract(epoch from (now() - current_game.live_at)) / current_game.duration_s));
      stage_index := public.zone_stage_at(current_game.id, progress);
      if current_game.zone_stage = 0 then
        update public.games g set zone_stage = 1 where g.id = current_game.id;
        current_game.zone_stage := 1;
      elsif stage_index > current_game.zone_stage then
        update public.games g set zone_stage = stage_index where g.id = current_game.id;
        current_game.zone_stage := stage_index;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'zone_shrunk', 'all',
          jsonb_build_object(
            'stage', stage_index,
            'stages', stage_count,
            'percent', stages[stage_index],
            'radius_m', round(public.effective_radius_m(current_game.id)::numeric, 1)
          )
        );
      end if;
    end if;
  end if;

  -- Jailbreak auto-release
  if current_game.status = 'live' and current_game.mode_id = 'jailbreak' then
    v_auto_release_s := coalesce((current_game.mode_params->'jailbreak'->>'auto_release_s')::int, 300);

    for jailed_rec in
      select p.id, pr.display_name
      from public.players p
      join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id
        and p.status = 'jailed'
        and p.tagged_at is not null
        and now() - p.tagged_at >= make_interval(secs => v_auto_release_s)
    loop
      update public.players p
        set status = 'active', tagged_at = null
        where p.id = jailed_rec.id;

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
  end if;

  -- Assassin Ring offline auto-relink (with 180s live grace period)
  if current_game.status = 'live'
     and current_game.mode_id = 'assassin_ring'
     and current_game.live_at is not null
     and now() >= current_game.live_at + interval '180 seconds' then
    for offline_rec in
      select ra.id as assignment_id, ra.hunter_player_id, ra.prey_player_id, pr.display_name
      from public.ring_assignments ra
      join public.players p on p.id = ra.prey_player_id
      join public.profiles pr on pr.id = p.user_id
      left join public.player_positions pp on pp.player_id = p.id
      where ra.game_id = current_game.id
        and ra.status = 'active'
        and p.status = 'active'
        and (pp.recorded_at is null or pp.recorded_at < now() - interval '180 seconds')
    loop
      select ra2.prey_player_id into v_next_prey_id
      from public.ring_assignments ra2
      where ra2.game_id = current_game.id and ra2.hunter_player_id = offline_rec.prey_player_id and ra2.status = 'active';

      if v_next_prey_id is not null and v_next_prey_id <> offline_rec.hunter_player_id then
        update public.players set status = 'tagged', tagged_at = now() where id = offline_rec.prey_player_id;
        update public.ring_assignments ra set status = 'eliminated', eliminated_at = now()
          where ra.game_id = current_game.id and ra.prey_player_id = offline_rec.prey_player_id and ra.status = 'active';
        update public.ring_assignments ra set status = 'relinked'
          where ra.game_id = current_game.id and ra.hunter_player_id = offline_rec.prey_player_id and ra.status = 'active';
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

  -- Relay Heist carrier offline auto-drop
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

  -- VIP Escort: Auto-promote nearest bodyguard if VIP is inactive for > 60 s
  if current_game.status = 'live'
     and 'vip' = any(current_game.roles)
     and current_game.live_at is not null
     and current_game.live_at < now() - interval '60 seconds' then
    select * into active_vip from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.secret_role = 'vip' and p.status = 'active';

    if active_vip.id is not null then
      if not exists (
        select 1 from public.player_positions pp
        where pp.player_id = active_vip.id and pp.recorded_at > now() - interval '60 seconds'
      ) then
        select p.* into promoted_bodyguard
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.secret_role = 'bodyguard'
          and p.status = 'active'
          and (p.status_detail->>'frozen_until' is null or (p.status_detail->>'frozen_until')::timestamptz <= now())
          and pp.recorded_at > now() - interval '60 seconds'
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
            greatest(10, current_game.area_radius_m - 10),
            extensions.st_azimuth(current_game.area_center::geometry, current_ghost_pt)
          )::geometry;
        end if;

        update public.entities
        set geog = current_ghost_pt::geography, updated_at = now()
        where entities.id = ghost_rec.id;

        -- Proximity assist check (40 m)
        if current_game.ghost_mode = 'assist' then
          for runner_fix in
            select p.id as runner_id, pr.display_name as runner_name,
                   extensions.st_distance(pp.geog, current_ghost_pt::geography) as dist_m
            from public.players p
            join public.player_positions pp on pp.player_id = p.id
            join public.profiles pr on pr.id = p.user_id
            where p.game_id = current_game.id
              and p.team = 'runner'
              and p.status = 'active'
              and pp.recorded_at > now() - interval '20 seconds'
              and coalesce(pp.accuracy_m, 10.0) <= 30.0
              and extensions.st_dwithin(pp.geog, current_ghost_pt::geography, 40)
          loop
            if not exists (
              select 1 from public.pings pi
              where pi.game_id = current_game.id
                and pi.player_id = runner_fix.runner_id
                and pi.reason = 'ghost_sighting'
                and pi.released_at > now() - interval '20 seconds'
            ) then
              update public.games g set ping_seq = g.ping_seq + 1
              where g.id = current_game.id
              returning g.ping_seq into v_ghost_ping_seq;

              insert into public.pings (
                game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
              ) values (
                current_game.id,
                v_ghost_ping_seq,
                runner_fix.runner_id,
                current_ghost_pt::geography,
                10,
                0,
                'ghost_sighting',
                now()
              );

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
                  'message', 'Ghost assisted hunters with a sighting ping!'
                )
              );
            end if;
          end loop;
        end if;

        -- Proximity hazard check (12 m)
        v_dwells := coalesce(ghost_rec.state->'dwells', '{}'::jsonb);
        for runner_fix in
          select pp.player_id, pp.geog, pp.accuracy_m, pr.display_name, p.status
          from public.player_positions pp
          join public.players p on p.id = pp.player_id
          join public.profiles pr on pr.id = p.user_id
          where pp.game_id = current_game.id
            and p.team = 'runner'
            and p.status = 'active'
            and (pp.accuracy_m is null or pp.accuracy_m <= 30)
            and extensions.st_dwithin(pp.geog, current_ghost_pt::geography, 12)
        loop
          v_first_seen := (v_dwells->>(runner_fix.player_id::text))::timestamptz;
          if v_first_seen is null then
            v_dwells := jsonb_set(v_dwells, array[runner_fix.player_id::text], to_jsonb(now()));
          elsif now() - v_first_seen >= interval '3 seconds' then
            update public.players set status = 'tagged', tagged_at = now() where id = runner_fix.player_id;
            insert into public.events (game_id, type, audience, payload)
            values (
              current_game.id,
              'runner_tagged',
              'all',
              jsonb_build_object(
                'runner_id', runner_fix.player_id,
                'runner_name', runner_fix.display_name,
                'by', 'ghost',
                'reason', 'haunted',
                'tagged_at', now(),
                'display_name', runner_fix.display_name,
                'message', runner_fix.display_name || ' was haunted by a patrolling ghost!'
              )
            );
            v_dwells := v_dwells - runner_fix.player_id::text;

            select count(*) into active_runners_count
            from public.players where players.game_id = current_game.id and team = 'runner' and status = 'active';

            if active_runners_count = 0 then
              perform public.end_game(current_game.id, 'hunters', 'all_haunted');
              select * into current_game from public.games g where g.id = advance_game.game_id;
              return current_game.status;
            end if;
          end if;
        end loop;

        update public.entities
        set state = jsonb_set(entities.state, '{dwells}', v_dwells)
        where entities.id = ghost_rec.id;
      end if;
    end loop;
  end if;

  -- Relay Heist: carrier extra pings at 1.5x cadence
  if current_game.status = 'live' and current_game.mode_id = 'relay_heist' then
    select p.id, pp.geog, pp.accuracy_m, pp.recorded_at,
           coalesce((e.state->>'last_carrier_ping_at')::timestamptz, current_game.live_at) as last_ping_at,
           e.id as entity_id
    into carrier_rec
    from public.entities e
    join public.players p on p.id = (e.state->>'carrier_player_id')::uuid
    join public.player_positions pp on pp.player_id = p.id
    where e.game_id = current_game.id
      and e.kind = 'package'
      and (e.state->>'status') = 'carried'
      and p.status = 'active';

    if carrier_rec.id is not null
       and now() >= carrier_rec.last_ping_at + make_interval(secs => round(current_game.ping_interval_s / 1.5)::integer) then
      update public.games g set ping_seq = g.ping_seq + 1
      where g.id = current_game.id
      returning g.ping_seq into v_carrier_ping_seq;

      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
      ) values (
        current_game.id,
        v_carrier_ping_seq,
        carrier_rec.id,
        carrier_rec.geog,
        coalesce(carrier_rec.accuracy_m, 15.0),
        greatest(0, floor(extract(epoch from (now() - carrier_rec.recorded_at)))::integer),
        'carrier_pulse',
        now()
      );

      update public.entities
      set state = jsonb_set(state, '{last_carrier_ping_at}', to_jsonb(now()))
      where id = carrier_rec.entity_id;
    end if;
  end if;

  return current_game.status;
end;
$$;

revoke all on function public.advance_game(uuid) from public, anon;
grant execute on function public.advance_game(uuid) to authenticated;

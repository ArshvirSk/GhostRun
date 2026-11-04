-- Migration: 20261112007000_b4_vip_escort_fix_trail_points_insert.sql
-- Fix column "speed_mps" of relation "trail_points" does not exist in submit_position()

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

  v_fast_since := v_prev_fast_since;
  v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);

  if v_speed is not null and v_speed >= 8.0 then
    if v_fast_since is null then v_fast_since := now();
    elsif (now() - v_fast_since) >= interval '10 seconds' and not v_vehicle_warned then
      v_vehicle_warned := true;
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'vehicle_warning',
        'all',
        jsonb_build_object(
          'player_id', me.id,
          'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id),
          'message', 'Vehicle speeds detected. Please play safely on foot.'
        )
      );
    end if;
  else
    v_fast_since := null;
    v_vehicle_warned := false;
  end if;

  if 'noise_meter' = any(current_game.modifiers) and me.team = 'runner' then
    if v_speed is not null and (v_accuracy is null or v_accuracy <= 50) then
      v_smoothed_speed := case
        when v_prev_speed is null then v_speed
        else (0.3 * v_speed + 0.7 * v_prev_speed)::real
      end;
    else
      v_smoothed_speed := coalesce(v_prev_speed, 0);
    end if;

    v_noise := coalesce(v_prev_noise, 0);
    if v_smoothed_speed >= 4.0 then v_noise := least(100, v_noise + 10);
    elsif v_smoothed_speed >= 2.8 then v_noise := least(100, v_noise + 4);
    elsif v_smoothed_speed <= 1.6 then v_noise := greatest(0, v_noise - 3);
    end if;

    if v_noise >= 100 then
      select coalesce(max(seq), 0) + 1 into v_noise_seq
        from public.pings
        where game_id = current_game.id;
      insert into public.pings (game_id, seq, geog, reason, visible_until)
      values (
        current_game.id,
        v_noise_seq,
        fix_geog,
        'noise',
        now() + make_interval(secs => current_game.ping_visible_s)
      );
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'noise_ping',
        'all',
        jsonb_build_object('player_id', me.id, 'seq', v_noise_seq)
      );
      v_noise := 40;
    end if;

    if v_prev_anchor is null then
      v_anchor := fix_geog;
      v_anchor_since := now();
    else
      if extensions.st_distance(fix_geog, v_prev_anchor) > 10 then
        v_anchor := fix_geog;
        v_anchor_since := now();
      else
        v_anchor := v_prev_anchor;
        v_anchor_since := coalesce(v_prev_anchor_since, now());
        if now() - v_anchor_since >= interval '45 seconds' then
          select coalesce(max(seq), 0) + 1 into v_camp_seq
            from public.pings
            where game_id = current_game.id;
          insert into public.pings (game_id, seq, geog, reason, visible_until)
          values (
            current_game.id,
            v_camp_seq,
            fix_geog,
            'camping_runner',
            now() + make_interval(secs => current_game.ping_visible_s)
          );
          insert into public.events (game_id, type, audience, payload)
          values (
            current_game.id,
            'camping_ping',
            'all',
            jsonb_build_object('player_id', me.id)
          );
          v_anchor_since := now();
        end if;
      end if;
    end if;
  end if;

  -- Mock location detection
  if coalesce(submit_position.is_mock, false) then
    if not exists (
      select 1 from public.events ev
      where ev.game_id = current_game.id
        and ev.type = 'mock_location_detected'
        and (ev.payload->>'player_id') = me.id::text
        and ev.created_at > now() - interval '60 seconds'
    ) then
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'mock_location_detected',
        'all',
        jsonb_build_object(
          'player_id', me.id,
          'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id),
          'message', 'Mock location detected from player'
        )
      );
    end if;
  end if;

  insert into public.player_positions (
    player_id, game_id, geog, accuracy_m, speed_mps, heading, is_mock,
    recorded_at, updated_at, out_of_bounds_since,
    noise, noise_alerted, smoothed_speed_mps, anchor_geog, anchor_since,
    fast_since, vehicle_warned
  ) values (
    me.id, current_game.id, fix_geog, v_accuracy, v_speed, v_heading,
    coalesce(submit_position.is_mock, false),
    fix_time, now(),
    case
      when not v_in_bounds and v_prev_out is null then now()
      when not v_in_bounds then v_prev_out
      else null
    end,
    coalesce(v_noise, 0), coalesce(v_noise >= 60, false), v_smoothed_speed, v_anchor, v_anchor_since,
    v_fast_since, v_vehicle_warned
  )
  on conflict (player_id) do update set
    game_id = excluded.game_id,
    geog = excluded.geog,
    accuracy_m = excluded.accuracy_m,
    speed_mps = excluded.speed_mps,
    heading = excluded.heading,
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
    insert into public.trail_points (
      game_id, player_id, geog, accuracy_m, recorded_at
    )
    select current_game.id, me.id, fix_geog, v_accuracy, fix_time
    where not exists (
      select 1 from public.trail_points tp
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
  elsif v_in_bounds and v_prev_out is not null then
    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'boundary_cleared',
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id)
      )
    );
  end if;

  -- Classic Chase extraction arrival: if VIP Escort role is active, ONLY VIP can trigger target reached!
  if current_game.status = 'live'
     and current_game.mode = 'classic_chase'
     and me.team = 'runner'
     and (
       not ('vip' = any(current_game.roles))
       or me.secret_role = 'vip'
     )
     and exists (
       select 1
       from public.targets t
       where t.game_id = current_game.id
         and extensions.st_dwithin(fix_geog, t.geog, current_game.target_radius_m)
     ) then
    perform public.end_game(current_game.id, 'runners', 'target_reached');
    select * into current_game from public.games g where g.id = current_game.id;
  end if;

  -- Relay Heist extraction check: carrier enters extraction zone
  if current_game.status = 'live'
     and current_game.mode_id = 'relay_heist'
     and me.team = 'runner'
     and exists (
       select 1
       from public.entities e_pkg
       join public.entities e_ext on e_ext.game_id = current_game.id and e_ext.kind in ('extraction', 'extraction_point')
       where e_pkg.game_id = current_game.id
         and e_pkg.kind = 'package'
         and (e_pkg.state->>'carrier_player_id') = me.id::text
         and (e_pkg.state->>'status') = 'carried'
         and extensions.st_dwithin(fix_geog, e_ext.geog, coalesce((e_ext.state->>'radius_m')::int, 25))
     ) then
    perform public.end_game(current_game.id, 'runners', 'extraction_complete');
    select * into current_game from public.games g where g.id = current_game.id;
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
    'end_reason', current_game.end_reason,
    'noise', coalesce(v_noise, 0),
    'smoothed_speed_mps', v_smoothed_speed,
    'fast_since', v_fast_since,
    'vehicle_warned', v_vehicle_warned
  );
end;
$$;

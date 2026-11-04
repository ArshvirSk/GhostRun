-- Migration: 20261113008000_b5_canonical_sim_fixes.sql
-- 1. Restore canonical noise tracking & fix_time clamping in submit_position
-- 2. Restore canonical ring relinking in apply_tag
-- 3. Expose relay_heist, vip_escort, and assassin_ring at root in get_game_state

-- 1. submit_position ----------------------------------------------------------
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
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if submit_position.game_id is null then raise exception 'Game not found.'; end if;

  perform public.advance_game(submit_position.game_id);

  select * into current_game from public.games g
    where g.id = submit_position.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players p
    where p.game_id = submit_position.game_id
      and p.user_id = caller_id
      and p.status <> 'left';
  if not found then raise exception 'You are not a player in this game.'; end if;

  -- Remote Operator early return: no GPS or spatial tracking
  if coalesce(me.is_remote, false) then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', clock_timestamp(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', true,
      'my_status', me.status,
      'winner', current_game.winner,
      'end_reason', current_game.end_reason,
      'noise', 0,
      'is_remote', true
    );
  end if;

  if current_game.status in ('ended', 'cancelled') or me.status <> 'active' then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', clock_timestamp(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner,
      'end_reason', current_game.end_reason
    );
  end if;

  if current_game.status = 'countdown' then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', clock_timestamp(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner,
      'end_reason', current_game.end_reason
    );
  end if;

  if submit_position.lat is null or submit_position.lng is null or
     submit_position.lat < -90 or submit_position.lat > 90 or
     submit_position.lng < -180 or submit_position.lng > 180 then
    raise exception 'Invalid position coordinates.';
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
    when submit_position.heading is null then null
    else least(greatest(submit_position.heading, 0), 360)::real
  end;

  fix_time := coalesce(submit_position.recorded_at, now());
  if fix_time > now() + interval '5 seconds' or fix_time < now() - interval '2 minutes' then
    fix_time := now();
  end if;

  fix_geog := extensions.st_setsrid(
    extensions.st_makepoint(submit_position.lng, submit_position.lat),
    4326
  )::geography;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_distance(fix_geog, current_game.area_center) <= v_radius;

  select out_of_bounds_since, noise, noise_alerted,
         smoothed_speed_mps, anchor_geog, anchor_since, updated_at,
         fast_since, vehicle_warned
    into v_prev_out, v_prev_noise, v_prev_alerted,
         v_prev_smoothed, v_prev_anchor, v_prev_anchor_since, v_prev_updated,
         v_prev_fast_since, v_prev_vehicle_warned
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

  -- Speed Smoothing & Vehicle Safety Warning
  if v_speed is null then
    v_smoothed := coalesce(v_prev_smoothed, 0.0);
  elsif v_prev_smoothed is null then
    v_smoothed := v_speed;
  else
    v_smoothed := 0.75 * v_prev_smoothed + 0.25 * v_speed;
  end if;

  if v_smoothed >= 8.0 then
    v_fast_since := coalesce(v_prev_fast_since, fix_time);
    v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);
    if not v_vehicle_warned and v_fast_since is not null and greatest(now(), fix_time) - v_fast_since >= interval '10 seconds' then
      insert into public.events (game_id, type, audience, payload, target_player)
      values (
        current_game.id, 'vehicle_warning', 'all',
        jsonb_build_object(
          'player_id', me.id,
          'speed_mps', round(v_smoothed::numeric, 1),
          'message', 'Vehicle speed detected (>8 m/s for 10 s)'
        ),
        me.id
      );
      v_vehicle_warned := true;
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
  v_noise_on := ('noise_meter' = any(current_game.modifiers) or 'noise' = any(current_game.modifiers));
  if v_noise_on and me.team = 'runner' then
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

  -- Classic chase arrival check
  if current_game.mode_id = 'classic_chase' and me.team = 'runner' and current_game.status = 'live' then
    if exists (
      select 1 from public.targets t
      where t.game_id = current_game.id
        and extensions.st_dwithin(fix_geog, t.geog, current_game.target_radius_m)
    ) then
      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id, 'target_reached', me.id, 'all',
        jsonb_build_object(
          'user_id', caller_id,
          'player_id', me.id,
          'message', 'A runner reached the extraction target! Runners win!'
        )
      );
      perform public.end_game(current_game.id, 'runners', 'target_reached');
      select * into current_game from public.games g where g.id = submit_position.game_id;
    end if;
  end if;

  return jsonb_build_object(
    'phase', current_game.status,
    'server_time', clock_timestamp(),
    'live_at', current_game.live_at,
    'ends_at', current_game.ends_at,
    'next_ping_at', current_game.next_ping_at,
    'in_bounds', v_in_bounds,
    'my_status', me.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason,
    'noise', coalesce(v_noise, 0)
  );
end;
$$;

revoke all on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) from public, anon;
grant execute on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) to authenticated;

-- 2. apply_tag (canonical relinking) ------------------------------------------
create or replace function public.apply_tag(
  p_game_id uuid,
  p_hunter_id uuid,
  p_runner_id uuid,
  p_distance_m double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_game public.games%rowtype;
  hunter_player public.players%rowtype;
  target_runner public.players%rowtype;
  remaining_runners integer;
  hunter_name text;
  runner_name text;
  is_jailbreak boolean;
  is_assassin boolean;
  is_relay boolean;
  v_next_prey_id uuid;
  active_survivors integer;
begin
  select * into current_game from public.games g
    where g.id = p_game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into hunter_player from public.players where id = p_hunter_id and game_id = p_game_id;
  if not found then raise exception 'Hunter not found in this game.'; end if;

  -- Remote Operator immunity & restriction
  if coalesce(hunter_player.is_remote, false) then
    raise exception 'Remote Operators cannot execute tags.';
  end if;

  select * into target_runner from public.players p
    where p.id = p_runner_id and p.game_id = p_game_id and p.status = 'active'
    for update;
  if not found then raise exception 'Runner is not an active player in this game.'; end if;

  if coalesce(target_runner.is_remote, false) then
    raise exception 'Remote Operators are immune to physical tags.';
  end if;

  select display_name into hunter_name from public.profiles where id = hunter_player.user_id;
  select display_name into runner_name from public.profiles where id = target_runner.user_id;

  is_jailbreak := (current_game.mode_id = 'jailbreak');
  is_assassin := (current_game.mode_id = 'assassin_ring');
  is_relay := (current_game.mode_id = 'relay_heist');

  -- Relay Heist package carrier check
  if is_relay then
    if exists (
      select 1 from public.entities e
      where e.game_id = p_game_id and e.kind = 'package'
        and (e.state->>'carrier_player_id') = target_runner.id::text
        and (e.state->>'status') = 'carried'
    ) then
      update public.entities e
      set state = jsonb_build_object(
            'carrier_player_id', null,
            'status', 'dropped',
            'dropped_at', now(),
            'securing_hunter_id', null,
            'securing_started_at', null
          ),
          visible_to = 'all'
      where e.game_id = p_game_id and e.kind = 'package';

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'package_dropped', 'all',
        jsonb_build_object(
          'carrier_player_id', target_runner.id,
          'carrier_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', runner_name || ' was tagged and dropped the package!'
        )
      );
    end if;
  end if;

  -- VIP Escort check
  if 'vip' = any(current_game.roles) and target_runner.secret_role is not null then
    if target_runner.secret_role = 'vip' then
      update public.players p
        set status = 'tagged',
            tagged_at = now(),
            is_ready = false
        where p.id = target_runner.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'vip_eliminated', 'all',
        jsonb_build_object(
          'vip_id', target_runner.id,
          'vip_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', 'The VIP has been eliminated! Hunters win!'
        )
      );

      perform public.end_game(p_game_id, 'hunters', 'vip_eliminated');
      select * into current_game from public.games g where g.id = p_game_id;

      return jsonb_build_object(
        'success', true,
        'runner_id', target_runner.id,
        'phase', current_game.status,
        'winner', current_game.winner,
        'end_reason', current_game.end_reason
      );

    elsif target_runner.secret_role = 'bodyguard' then
      if target_runner.status_detail->>'frozen_until' is not null and
         (target_runner.status_detail->>'frozen_until')::timestamptz > now() then
        raise exception 'already_frozen';
      end if;

      update public.players p
      set status_detail = coalesce(p.status_detail, '{}'::jsonb) ||
                          jsonb_build_object('frozen_until', (now() + interval '60 seconds'))
      where p.id = target_runner.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'bodyguard_frozen', 'all',
        jsonb_build_object(
          'bodyguard_id', target_runner.id,
          'bodyguard_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'frozen_seconds', 60,
          'message', runner_name || ' is a bodyguard! Frozen for 60 seconds.'
        )
      );

      return jsonb_build_object(
        'success', true,
        'runner_id', target_runner.id,
        'phase', current_game.status,
        'frozen', true,
        'frozen_seconds', 60
      );
    end if;
  end if;

  if is_assassin then
    update public.players p
      set status = 'tagged',
          tagged_at = now(),
          is_ready = false
      where p.id = target_runner.id;

    update public.ring_assignments ra
      set status = 'eliminated', eliminated_at = now()
      where ra.game_id = p_game_id and ra.prey_player_id = target_runner.id and ra.status = 'active';

    select ra.prey_player_id into v_next_prey_id
    from public.ring_assignments ra
    where ra.game_id = p_game_id and ra.hunter_player_id = target_runner.id and ra.status = 'active';

    update public.ring_assignments ra
      set status = 'relinked'
      where ra.game_id = p_game_id and ra.hunter_player_id = target_runner.id and ra.status = 'active';

    if v_next_prey_id is not null and v_next_prey_id <> p_hunter_id then
      update public.ring_assignments ra
        set status = 'relinked'
        where ra.game_id = p_game_id and ra.hunter_player_id = p_hunter_id and ra.status = 'active';

      insert into public.ring_assignments (game_id, hunter_player_id, prey_player_id, status)
      values (p_game_id, p_hunter_id, v_next_prey_id, 'active');
    end if;

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id, 'player_eliminated', 'all',
      jsonb_build_object(
        'hunter_id', p_hunter_id,
        'prey_id', target_runner.id,
        'hunter_name', hunter_name,
        'prey_name', runner_name,
        'distance_m', round(p_distance_m::numeric, 1)
      )
    );

    select count(*) into active_survivors
      from public.players sp
      where sp.game_id = p_game_id and sp.status = 'active';

    if active_survivors <= 1 then
      perform public.end_game(p_game_id, 'solo', 'last_survivor');
    end if;

  elsif is_jailbreak then
    update public.players p
      set status = 'jailed',
          tagged_at = now(),
          is_ready = false,
          status_detail = p.status_detail - 'free_started_at'
      where p.id = target_runner.id;

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id, 'runner_jailed', 'all',
      jsonb_build_object(
        'runner_id', target_runner.id,
        'hunter_id', p_hunter_id,
        'display_name', runner_name,
        'distance_m', round(p_distance_m::numeric, 1)
      )
    );

    select count(*) into remaining_runners
      from public.players p
      where p.game_id = p_game_id and p.team = 'runner' and p.status = 'active' and not p.is_remote;

    if remaining_runners = 0 then
      perform public.end_game(p_game_id, 'hunters', 'all_jailed');
    end if;

  else
    update public.players p
      set status = 'tagged',
          tagged_at = now(),
          is_ready = false
      where p.id = target_runner.id;

    select count(*) into remaining_runners
      from public.players p
      where p.game_id = p_game_id and p.team = 'runner' and p.status = 'active' and not p.is_remote;

    if remaining_runners = 0 then
      perform public.end_game(p_game_id, 'hunters', 'all_runners_tagged');
    end if;
  end if;

  insert into public.tags (
    game_id, hunter_player_id, runner_player_id, distance_m,
    hunter_display_name, runner_display_name
  ) values (
    p_game_id, p_hunter_id, target_runner.id, p_distance_m,
    hunter_name, runner_name
  );

  select * into current_game from public.games g where g.id = p_game_id;

  return jsonb_build_object(
    'success', true,
    'runner_id', target_runner.id,
    'phase', current_game.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason
  );
end;
$$;

revoke all on function public.apply_tag(uuid, uuid, uuid, double precision) from public, anon;
grant execute on function public.apply_tag(uuid, uuid, uuid, double precision) to authenticated;

-- 3. get_game_state (root fields for relay_heist, vip_escort, assassin_ring) ---
create or replace function public.get_game_state(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  snapshot jsonb;
  current_game public.games%rowtype;
  mine public.players%rowtype;
  v_relay_heist jsonb;
  v_vip_escort jsonb;
  v_assassin_ring jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(game_id) then raise exception 'You are not a member of this game.'; end if;

  perform public.advance_game(get_game_state.game_id);

  select * into current_game from public.games g where g.id = get_game_state.game_id;
  select * into mine from public.players p where p.game_id = get_game_state.game_id and p.user_id = caller_id;

  v_relay_heist := case
    when current_game.mode_id = 'relay_heist' then jsonb_build_object(
      'extraction', (
        select jsonb_build_object(
          'id', e.id,
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 25)
        )
        from public.entities e
        where e.game_id = current_game.id and e.kind in ('extraction', 'extraction_point')
        limit 1
      ),
      'package', (
        select case
          when (e.state->>'status') = 'dropped' then
            jsonb_build_object(
              'status', 'dropped',
              'longitude', extensions.st_x(e.geog::extensions.geometry),
              'latitude', extensions.st_y(e.geog::extensions.geometry),
              'dropped_at', e.state->>'dropped_at',
              'securing_hunter_id', e.state->>'securing_hunter_id',
              'securing_started_at', e.state->>'securing_started_at'
            )
          when mine.team = 'runner' or current_game.status in ('ended', 'cancelled') then
            jsonb_build_object(
              'status', 'carried',
              'carrier_player_id', e.state->>'carrier_player_id',
              'is_carrier', ((e.state->>'carrier_player_id') = mine.id::text),
              'longitude', extensions.st_x(e.geog::extensions.geometry),
              'latitude', extensions.st_y(e.geog::extensions.geometry),
              'handoff_pending_to', e.state->>'handoff_pending_to',
              'handoff_expires_at', e.state->>'handoff_expires_at'
            )
          else
            jsonb_build_object(
              'status', 'carried'
            )
        end
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'package'
        limit 1
      ),
      'is_carrier', exists (
        select 1 from public.entities e
        where e.game_id = current_game.id and e.kind = 'package'
          and (e.state->>'carrier_player_id') = mine.id::text
          and (e.state->>'status') = 'carried'
      ),
      'handoff_pending_from', (
        select e.state->>'carrier_player_id'
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'package'
          and (e.state->>'handoff_pending_to') = mine.id::text
          and (e.state->>'handoff_expires_at')::timestamptz > clock_timestamp()
        limit 1
      )
    )
    else null
  end;

  v_vip_escort := case
    when 'vip' = any(current_game.roles) then jsonb_build_object(
      'is_active', true,
      'vip_player_id', case
        when mine.team = 'runner' or current_game.status in ('ended', 'cancelled') then (
          select p.id from public.players p
          where p.game_id = current_game.id and p.team = 'runner' and p.secret_role = 'vip' and p.status = 'active'
          limit 1
        )
        else null
      end
    )
    else null
  end;

  v_assassin_ring := case
    when current_game.mode_id = 'assassin_ring' then jsonb_build_object(
      'my_prey', (
        select jsonb_build_object(
          'player_id', prey_p.id,
          'display_name', prey_pr.display_name,
          'color', prey_pr.color,
          'status', prey_p.status
        )
        from public.ring_assignments ra
        join public.players prey_p on prey_p.id = ra.prey_player_id
        left join public.profiles prey_pr on prey_pr.id = prey_p.user_id
        where ra.game_id = current_game.id and ra.hunter_player_id = mine.id and ra.status = 'active'
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
        where ra.game_id = current_game.id
          and ra.prey_player_id = mine.id
          and ra.status = 'active'
      ),
      'safe_zones', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 20)
        ))
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'safe_zone'
      ), '[]'::jsonb),
      'in_safe_zone', exists (
        select 1 from public.entities e
        join public.player_positions pp on pp.player_id = mine.id
        where e.game_id = current_game.id and e.kind = 'safe_zone'
          and extensions.st_dwithin(e.geog, pp.geog, coalesce((e.state->>'radius_m')::int, 20))
      ),
      'active_survivors', (
        select count(*) from public.players sp where sp.game_id = current_game.id and sp.status = 'active'
      )
    )
    else null
  end;

  select jsonb_build_object(
    'server_time', clock_timestamp(),
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
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 15)
        )
        from public.entities e
        where e.game_id = g.id and e.kind = 'jail'
        limit 1
      ),
      'jail_rules', case
        when g.mode_id = 'jailbreak' then jsonb_build_object(
          'auto_release_s', coalesce((g.mode_params->'jailbreak'->>'auto_release_s')::int, 300),
          'release_hold_s', coalesce((g.mode_params->'jailbreak'->>'release_hold_s')::int, 10),
          'release_radius_m', coalesce((g.mode_params->'jailbreak'->>'release_radius_m')::int, 10)
        )
        else null
      end,
      'relay_heist', v_relay_heist,
      'vip_escort', v_vip_escort,
      'assassin_ring', v_assassin_ring
    ),
    'relay_heist', v_relay_heist,
    'vip_escort', v_vip_escort,
    'assassin_ring', v_assassin_ring,
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
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'user_id', p.user_id,
        'display_name', pr.display_name,
        'color', pr.color,
        'team', p.team,
        'status', p.status,
        'is_ready', p.is_ready,
        'is_remote', coalesce(p.is_remote, false),
        'joined_at', p.joined_at,
        'jailed_at', case when p.status = 'jailed' then p.tagged_at else null end,
        'frozen_until', p.status_detail->>'frozen_until',
        'pending_role_swap', case when p.id = mine.id then p.status_detail->'pending_role_swap' else null end,
        'secret_role', case
          when g.status in ('ended', 'cancelled') or p.id = mine.id then p.secret_role
          when 'vip' = any(g.roles) and mine.team = 'runner' and p.team = 'runner' then p.secret_role
          else null
        end
      ) order by p.joined_at)
      from public.players p join public.profiles pr on pr.id = p.user_id
      where p.game_id = g.id and p.status <> 'left'
    ), '[]'::jsonb),
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
        and not coalesce(p.is_remote, false)
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
        'player_id', ping.player_id,
        'longitude', extensions.st_x(ping.geog::extensions.geometry),
        'latitude', extensions.st_y(ping.geog::extensions.geometry),
        'position_age_s', ping.position_age_s,
        'reason', ping.reason,
        'released_at', ping.released_at
      ) order by ping.seq)
      from public.pings ping
      where ping.game_id = g.id
        and (
          g.status in ('ended', 'cancelled')
          or (
            ping.released_at >= clock_timestamp() - make_interval(secs => coalesce(g.ping_visible_s, 10))
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
    'markers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'label', coalesce(e.state->>'label', 'Marker'),
        'latitude', extensions.st_y(e.geog::extensions.geometry),
        'longitude', extensions.st_x(e.geog::extensions.geometry),
        'placed_by', e.state->>'placed_by',
        'placed_at', e.state->>'placed_at',
        'expires_at', e.state->>'expires_at'
      ))
      from public.entities e
      where e.game_id = g.id
        and e.kind = 'marker'
        and (e.visible_to = 'all' or e.visible_to = mine.team::text)
        and (e.state->>'expires_at')::timestamptz > clock_timestamp()
    ), '[]'::jsonb),
    'scan_envelope', (
      select jsonb_build_object(
        'id', e.id,
        'latitude', extensions.st_y(e.geog::extensions.geometry),
        'longitude', extensions.st_x(e.geog::extensions.geometry),
        'radius_m', coalesce((e.state->>'radius_m')::int, 150),
        'expires_at', e.state->>'expires_at'
      )
      from public.entities e
      where e.game_id = g.id
        and e.kind = 'scan_envelope'
        and (e.visible_to = 'all' or e.visible_to = mine.team::text)
        and (e.state->>'expires_at')::timestamptz > clock_timestamp()
      order by e.updated_at desc
      limit 1
    ),
    'operator', case
      when 'operator' = any(g.roles) then jsonb_build_object(
        'is_operator', coalesce(mine.is_remote, false),
        'scan_cooldown_s', (
          select greatest(0, ceil(extract(epoch from (
            (pr.cooldowns->>'operator_scan')::timestamptz + interval '90 seconds' - clock_timestamp()
          ))))
          from public.player_resources pr
          where pr.player_id = mine.id
        )
      )
      else null
    end,
    'target', case
      when mine.team = 'runner' or g.status in ('ended', 'cancelled') then (
        select jsonb_build_object(
          'longitude', extensions.st_x(t.geog::extensions.geometry),
          'latitude', extensions.st_y(t.geog::extensions.geometry),
          'radius_m', g.target_radius_m
        )
        from public.targets t
        where t.game_id = g.id
      )
      else null
    end,
    'heat_marks', case when mine.team = 'hunter' or g.status in ('ended', 'cancelled') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', hpf.id,
        'hunter_id', hpf.hunter_id,
        'result', hpf.result,
        'longitude', extensions.st_x(hpf.hunter_geog::extensions.geometry),
        'latitude', extensions.st_y(hpf.hunter_geog::extensions.geometry),
        'pressed_at', hpf.pressed_at
      ) order by hpf.pressed_at asc)
      from public.heat_press_feed hpf
      where hpf.game_id = g.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'heat_charges', case when mine.team = 'hunter' then (
      select tr.heat_charges from public.team_resources tr
      where tr.game_id = g.id and tr.team = 'hunter'
    ) else null end,
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.id)
      from (
        select * from public.events ev
        where ev.game_id = g.id
          and (
            (ev.target_player is null and (ev.audience = 'all' or ev.audience = mine.team::text))
            or ev.target_player = mine.id
          )
      ) e
    ), '[]'::jsonb)
  ) into snapshot
  from public.games g
  where g.id = get_game_state.game_id;

  return snapshot;
end;
$$;

revoke all on function public.get_game_state(uuid) from public, anon;
grant execute on function public.get_game_state(uuid) to authenticated;

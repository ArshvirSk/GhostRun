-- Migration: 20261113002000_b5_operator_lifecycle.sql
-- Operator Role Lifecycle: apply_tag, attempt_tag, submit_position, start_game, get_game_state

-- 1. apply_tag ----------------------------------------------------------------
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
  target_runner public.players%rowtype;
  hunter_player public.players%rowtype;
  runner_name text;
  hunter_name text;
  active_runners integer;
  active_survivors integer;
  is_jailbreak boolean;
  is_assassin boolean;
  is_vip boolean;
  v_next_prey_id uuid;
begin
  select * into current_game from public.games g
    where g.id = p_game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into hunter_player from public.players where id = p_hunter_id and game_id = p_game_id;
  if hunter_player.is_remote then
    raise exception 'Remote operators cannot tag runners.';
  end if;

  select * into target_runner from public.players p
    where p.id = p_runner_id and p.game_id = p_game_id and p.status = 'active'
    for update;
  if not found then raise exception 'That player is not taggable.'; end if;
  if target_runner.is_remote then
    raise exception 'Remote operators cannot be tagged.';
  end if;

  select pr.display_name into runner_name
    from public.profiles pr where pr.id = target_runner.user_id;
  select pr.display_name into hunter_name
    from public.players hp join public.profiles pr on pr.id = hp.user_id
    where hp.id = p_hunter_id;

  insert into public.tags (game_id, hunter_id, runner_id, distance_m)
  values (p_game_id, p_hunter_id, target_runner.id, greatest(0, p_distance_m)::real);

  update public.players p set last_tag_attempt_at = null where p.id = p_hunter_id;

  is_jailbreak := (current_game.mode_id = 'jailbreak');
  is_assassin := (current_game.mode_id = 'assassin_ring');
  is_vip := ('vip' = any(current_game.roles));

  -- Relay Heist: carrier tag drops package
  if current_game.mode_id = 'relay_heist' then
    if exists (
      select 1 from public.entities e
      where e.game_id = p_game_id and e.kind = 'package'
        and (e.state->>'carrier_player_id') = target_runner.id::text
        and (e.state->>'status') = 'carried'
    ) then
      update public.entities e
      set geog = (select pp.geog from public.player_positions pp where pp.player_id = target_runner.id),
          state = jsonb_build_object(
            'status', 'dropped',
            'carrier_player_id', null,
            'dropped_at', now(),
            'securing_hunter_id', null,
            'securing_started_at', null
          ),
          visible_to = 'all',
          updated_at = now()
      where e.game_id = p_game_id and e.kind = 'package';

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'package_dropped', 'all',
        jsonb_build_object(
          'carrier_id', target_runner.id,
          'carrier_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', 'The carrier was tagged! The package has been dropped!'
        )
      );
    end if;
  end if;

  -- VIP Escort: branch on secret_role
  if is_vip and target_runner.team = 'runner' then
    if target_runner.secret_role = 'vip' then
      update public.players p
        set status = 'tagged', tagged_at = now(), is_ready = false
        where p.id = target_runner.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'vip_eliminated', 'all',
        jsonb_build_object(
          'vip_id', target_runner.id,
          'vip_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', 'The VIP (' || runner_name || ') was eliminated by ' || hunter_name || '!'
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
      if coalesce((target_runner.status_detail->>'frozen_until')::timestamptz > now(), false) then
        raise exception 'That bodyguard is already frozen.';
      end if;

      update public.players p
      set status_detail = jsonb_set(
        coalesce(status_detail, '{}'::jsonb),
        '{frozen_until}',
        to_jsonb(now() + interval '60 seconds')
      )
      where p.id = target_runner.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'bodyguard_frozen', 'all',
        jsonb_build_object(
          'bodyguard_id', target_runner.id,
          'bodyguard_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'duration_s', 60,
          'message', hunter_name || ' tagged bodyguard ' || runner_name || ' (frozen for 60s)!'
        )
      );

      return jsonb_build_object(
        'success', true,
        'runner_id', target_runner.id,
        'frozen', true,
        'frozen_duration_s', 60,
        'phase', current_game.status,
        'winner', current_game.winner,
        'end_reason', current_game.end_reason
      );
    end if;
  end if;

  -- Jailbreak mode
  if is_jailbreak then
    update public.players p
      set status = 'jailed', tagged_at = now(), is_ready = false
      where p.id = target_runner.id;

    select count(*) into active_runners
      from public.players p
      where p.game_id = p_game_id and p.team = 'runner' and p.status = 'active' and not p.is_remote;

    if active_runners = 0 then
      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'runner_jailed', 'all',
        jsonb_build_object(
          'runner_id', target_runner.id,
          'runner_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', 'The last runner (' || runner_name || ') was jailed! Hunters win!'
        )
      );
      perform public.end_game(p_game_id, 'hunters', 'all_jailed');
    else
      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'runner_jailed', 'all',
        jsonb_build_object(
          'runner_id', target_runner.id,
          'runner_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', runner_name || ' was jailed by ' || hunter_name || '!'
        )
      );
    end if;

  -- Assassin Ring mode
  elsif is_assassin then
    update public.players p
      set status = 'tagged', tagged_at = now(), is_ready = false
      where p.id = target_runner.id;

    select prey_player_id into v_next_prey_id
    from public.ring_assignments
    where game_id = p_game_id and hunter_player_id = target_runner.id and status = 'active';

    update public.ring_assignments
    set status = 'eliminated', eliminated_at = now()
    where game_id = p_game_id and prey_player_id = target_runner.id and status = 'active';

    update public.ring_assignments
    set prey_player_id = v_next_prey_id
    where game_id = p_game_id and hunter_player_id = p_hunter_id and status = 'active';

    select count(*) into active_survivors
      from public.players p
      where p.game_id = p_game_id and p.status = 'active';

    if active_survivors <= 1 then
      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'player_eliminated', 'all',
        jsonb_build_object(
          'victim_id', target_runner.id,
          'victim_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', hunter_name || ' eliminated the final target ' || runner_name || '!'
        )
      );
      perform public.end_game(p_game_id, 'solo', 'last_survivor');
    else
      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'player_eliminated', 'all',
        jsonb_build_object(
          'victim_id', target_runner.id,
          'victim_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'survivors', active_survivors,
          'message', runner_name || ' was eliminated by ' || hunter_name || '!'
        )
      );
    end if;

  -- Standard elimination
  else
    update public.players p
      set status = 'tagged', tagged_at = now(), is_ready = false
      where p.id = target_runner.id;

    select count(*) into active_runners
      from public.players p
      where p.game_id = p_game_id and p.team = 'runner' and p.status = 'active' and not p.is_remote;

    if active_runners = 0 then
      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'runner_tagged', 'all',
        jsonb_build_object(
          'runner_id', target_runner.id,
          'runner_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', 'The last runner (' || runner_name || ') was tagged! Hunters win!'
        )
      );
      perform public.end_game(p_game_id, 'hunters', 'all_tagged');
    else
      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'runner_tagged', 'all',
        jsonb_build_object(
          'runner_id', target_runner.id,
          'runner_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', runner_name || ' was tagged by ' || hunter_name || '!'
        )
      );
    end if;
  end if;

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

-- 2. attempt_tag --------------------------------------------------------------
create or replace function public.attempt_tag(game_id uuid)
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
  target_id uuid;
  target_distance double precision;
  v_my_prey_id uuid;
  frozen_target_exists boolean;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = attempt_tag.game_id
      and p.user_id = caller_id
      and p.status = 'active'
    for update;
  if not found then raise exception 'You are not an active player in this game.'; end if;
  if me.is_remote then
    raise exception 'Remote operators cannot tag runners.';
  end if;

  perform public.advance_game(attempt_tag.game_id);

  select * into current_game from public.games g
    where g.id = attempt_tag.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Tagging is only available while the round is live.';
  end if;

  if current_game.mode_id <> 'assassin_ring' and me.team <> 'hunter' then
    raise exception 'Only hunters can tag runners.';
  end if;

  if me.last_tag_attempt_at is not null
     and now() - me.last_tag_attempt_at < interval '8 seconds' then
    return jsonb_build_object('success', false, 'reason', 'cooldown');
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or now() - my_pos.recorded_at > interval '20 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_position');
  end if;

  -- Safe zone check
  if exists (
    select 1 from public.entities e
    where e.game_id = current_game.id and e.kind = 'safe_zone'
      and extensions.st_dwithin(e.geog, my_pos.geog, coalesce((e.state->>'radius_m')::int, 20))
  ) then
    return jsonb_build_object('success', false, 'reason', 'in_safe_zone');
  end if;

  if current_game.mode_id = 'assassin_ring' then
    select ra.prey_player_id into v_my_prey_id
    from public.ring_assignments ra
    where ra.game_id = current_game.id and ra.hunter_player_id = me.id and ra.status = 'active';

    if v_my_prey_id is null then
      return jsonb_build_object('success', false, 'reason', 'no_prey_assigned');
    end if;

    if exists (
      select 1 from public.entities e
      join public.player_positions pp on pp.player_id = v_my_prey_id
      where e.game_id = current_game.id and e.kind = 'safe_zone'
        and extensions.st_dwithin(e.geog, pp.geog, coalesce((e.state->>'radius_m')::int, 20))
    ) then
      return jsonb_build_object('success', false, 'reason', 'in_safe_zone');
    end if;

    select p.id, extensions.st_distance(pp.geog, my_pos.geog)
      into target_id, target_distance
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.id = v_my_prey_id
      and p.game_id = current_game.id
      and p.status = 'active'
      and not p.is_remote
      and pp.recorded_at > now() - interval '20 seconds'
      and extensions.st_distance(pp.geog, my_pos.geog)
          <= current_game.tag_radius_m + least(
               10::double precision,
               (coalesce(my_pos.accuracy_m, 0)::double precision
                + coalesce(pp.accuracy_m, 0)::double precision) / 2
             );

    if target_id is null then
      update public.players p set last_tag_attempt_at = now() where p.id = me.id;
      return jsonb_build_object('success', false, 'reason', 'no_target');
    end if;

  else
    -- Standard Hunter vs Runner modes: pick nearest UN-FROZEN active field runner
    select p.id, extensions.st_distance(pp.geog, my_pos.geog)
      into target_id, target_distance
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = current_game.id
      and p.team = 'runner'
      and p.status = 'active'
      and not p.is_remote
      and (p.status_detail->>'frozen_until' is null or (p.status_detail->>'frozen_until')::timestamptz <= now())
      and pp.recorded_at > now() - interval '20 seconds'
      and extensions.st_distance(pp.geog, my_pos.geog)
          <= current_game.tag_radius_m + least(
               10::double precision,
               (coalesce(my_pos.accuracy_m, 0)::double precision
                + coalesce(pp.accuracy_m, 0)::double precision) / 2
             )
    order by extensions.st_distance(pp.geog, my_pos.geog) asc
    limit 1;

    if target_id is null then
      select exists (
        select 1
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.status = 'active'
          and not p.is_remote
          and (p.status_detail->>'frozen_until')::timestamptz > now()
          and pp.recorded_at > now() - interval '20 seconds'
          and extensions.st_distance(pp.geog, my_pos.geog)
              <= current_game.tag_radius_m + least(
                   10::double precision,
                   (coalesce(my_pos.accuracy_m, 0)::double precision
                    + coalesce(pp.accuracy_m, 0)::double precision) / 2
                 )
      ) into frozen_target_exists;

      if frozen_target_exists then
        return jsonb_build_object('success', false, 'reason', 'already_frozen');
      end if;

      update public.players p set last_tag_attempt_at = now() where p.id = me.id;
      return jsonb_build_object('success', false, 'reason', 'no_target');
    end if;
  end if;

  return public.apply_tag(current_game.id, me.id, target_id, target_distance);
end;
$$;

revoke all on function public.attempt_tag(uuid) from public, anon;
grant execute on function public.attempt_tag(uuid) to authenticated;

-- 3. submit_position ----------------------------------------------------------
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
  v_camp_seq integer;
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
  if me.is_remote then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', now(),
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
      'server_time', now(),
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
      'server_time', now(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner,
      'end_reason', current_game.end_reason
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
    when submit_position.heading is null then null
    else least(greatest(submit_position.heading, 0), 360)::real
  end;

  fix_time := coalesce(submit_position.recorded_at, now());
  if fix_time > now() + interval '30 seconds' then
    raise exception 'Fix timestamp is in the future.';
  end if;
  if fix_time < now() - interval '60 seconds' then
    fix_time := now() - interval '60 seconds';
  end if;

  fix_geog := extensions.st_setsrid(
    extensions.st_makepoint(submit_position.lng, submit_position.lat),
    4326
  )::geography;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_dwithin(fix_geog, current_game.area_center, v_radius);

  select pp.out_of_bounds_since into v_prev_out
    from public.player_positions pp
    where pp.player_id = me.id;

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

  -- Inline speed smoothing and vehicle safety tracking
  select
    pp.smoothed_speed_mps,
    pp.fast_since,
    pp.vehicle_warned,
    pp.recorded_at
  into
    v_prev_smoothed,
    v_prev_fast_since,
    v_prev_vehicle_warned,
    v_prev_updated
  from public.player_positions pp
  where pp.player_id = me.id;

  v_smoothed := case
    when v_prev_smoothed is null then coalesce(v_speed, 0.0)
    when v_speed is not null then (0.75 * v_prev_smoothed + 0.25 * v_speed)::real
    else v_prev_smoothed
  end;

  v_fast_since := v_prev_fast_since;
  v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);

  if v_smoothed >= 8.0 then
    if v_fast_since is null then
      v_fast_since := fix_time;
    elsif fix_time - v_fast_since >= interval '10 seconds' and not v_vehicle_warned then
      v_vehicle_warned := true;
      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id,
        'vehicle_warning',
        me.id,
        'all',
        jsonb_build_object(
          'player_id', me.id,
          'speed_mps', round(v_smoothed::numeric, 2),
          'message', 'Speed alert: excessive speed detected (> 8 m/s for 10 s).'
        )
      );
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

  -- Inline Noise Calculation
  v_noise_on := ('noise_meter' = any(current_game.modifiers)) or (current_game.mode_id = 'noise_meter');
  if v_noise_on and me.team = 'runner' then
    select
      pn.noise,
      pn.alerted,
      pn.anchor_geog,
      pn.anchor_since,
      pn.updated_at
    into
      v_prev_noise,
      v_prev_alerted,
      v_prev_anchor,
      v_prev_anchor_since,
      v_prev_updated
    from public.player_noise pn
    where pn.player_id = me.id;

    v_prev_noise := coalesce(v_prev_noise, 0);
    v_prev_alerted := coalesce(v_prev_alerted, false);
    v_dt := case
      when v_prev_updated is null then 1.0
      else greatest(0.1, extract(epoch from (fix_time - v_prev_updated)))
    end;

    if v_speed is not null and v_speed >= 4.0 then
      v_noise := least(100, v_prev_noise + round(20 * (v_dt / 2.0))::integer);
    elsif v_speed is not null and v_speed >= 2.0 then
      v_noise := least(100, v_prev_noise + round(10 * (v_dt / 2.0))::integer);
    elsif v_speed is not null and v_speed >= 0.5 then
      v_noise := least(100, v_prev_noise + round(3 * (v_dt / 2.0))::integer);
    else
      v_noise := greatest(0, v_prev_noise - round(5 * (v_dt / 2.0))::integer);
    end if;

    if v_prev_anchor is null then
      v_anchor := fix_geog;
      v_anchor_since := fix_time;
    elsif extensions.st_distance(fix_geog, v_prev_anchor) > 15 then
      v_anchor := fix_geog;
      v_anchor_since := fix_time;
    else
      v_anchor := v_prev_anchor;
      v_anchor_since := v_prev_anchor_since;
      if fix_time - v_anchor_since >= interval '45 seconds' and v_noise < 100 then
        v_noise := 100;
        update public.games g set ping_seq = g.ping_seq + 1
          where g.id = current_game.id
          returning g.ping_seq into v_camp_seq;
        insert into public.pings (
          game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
        ) values (
          current_game.id, v_camp_seq, me.id, fix_geog,
          coalesce(v_accuracy, 15.0), 0, 'camping', now()
        );
        insert into public.events (game_id, type, target_player, audience, payload)
        values (
          current_game.id, 'noise_ping', me.id, 'all',
          jsonb_build_object('player_id', me.id, 'reason', 'camping')
        );
      end if;
    end if;

    if v_noise >= 100 and not v_prev_alerted then
      v_alerted := true;
      update public.games g set ping_seq = g.ping_seq + 1
        where g.id = current_game.id
        returning g.ping_seq into v_noise_seq;
      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
      ) values (
        current_game.id, v_noise_seq, me.id, fix_geog,
        coalesce(v_accuracy, 15.0), 0, 'noise_threshold', now()
      );
      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id, 'noise_ping', me.id, 'all',
        jsonb_build_object('player_id', me.id, 'reason', 'noise_threshold')
      );
    elsif v_noise < 80 then
      v_alerted := false;
    else
      v_alerted := v_prev_alerted;
    end if;

    insert into public.player_noise (
      player_id, game_id, noise, alerted, anchor_geog, anchor_since, updated_at
    ) values (
      me.id, current_game.id, v_noise, v_alerted, v_anchor, v_anchor_since, fix_time
    ) on conflict (player_id) do update set
      noise = excluded.noise,
      alerted = excluded.alerted,
      anchor_geog = excluded.anchor_geog,
      anchor_since = excluded.anchor_since,
      updated_at = excluded.updated_at;
  end if;

  insert into public.player_positions (
    player_id, game_id, geog, accuracy_m, speed_mps, heading_deg,
    recorded_at, is_mock, in_bounds, out_of_bounds_since,
    smoothed_speed_mps, fast_since, vehicle_warned
  ) values (
    me.id, current_game.id, fix_geog, v_accuracy, v_speed, v_heading,
    fix_time, coalesce(submit_position.is_mock, false), v_in_bounds, v_out_since,
    v_smoothed, v_fast_since, v_vehicle_warned
  )
  on conflict (player_id) do update set
    game_id = excluded.game_id,
    geog = excluded.geog,
    accuracy_m = excluded.accuracy_m,
    speed_mps = excluded.speed_mps,
    heading_deg = excluded.heading_deg,
    recorded_at = excluded.recorded_at,
    is_mock = excluded.is_mock,
    in_bounds = excluded.in_bounds,
    out_of_bounds_since = excluded.out_of_bounds_since,
    smoothed_speed_mps = excluded.smoothed_speed_mps,
    fast_since = excluded.fast_since,
    vehicle_warned = excluded.vehicle_warned;

  -- Store trail points throttled to 10s
  if not coalesce(submit_position.is_mock, false) then
    if not exists (
      select 1 from public.trail_points tp
      where tp.player_id = me.id
        and tp.recorded_at > fix_time - interval '10 seconds'
    ) then
      insert into public.trail_points (
        player_id, game_id, geog, accuracy_m, speed_mps, recorded_at
      ) values (
        me.id, current_game.id, fix_geog, v_accuracy, v_speed, fix_time
      );
    end if;
  end if;

  -- Classic Chase Target Arrival Check
  if current_game.mode_id = 'classic_chase'
     and current_game.status = 'live'
     and me.team = 'runner'
     and (not ('vip' = any(coalesce(current_game.roles, '{}'::text[]))) or me.secret_role = 'vip')
     and v_in_bounds then
    if exists (
      select 1 from public.targets t
      where t.game_id = current_game.id
        and extensions.st_dwithin(
          fix_geog,
          t.geog,
          current_game.target_radius_m + least(10::double precision, coalesce(v_accuracy, 0)::double precision)
        )
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
    'server_time', now(),
    'live_at', current_game.live_at,
    'ends_at', current_game.ends_at,
    'next_ping_at', current_game.next_ping_at,
    'in_bounds', v_in_bounds,
    'my_status', me.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason,
    'noise', v_noise
  );
end;
$$;

revoke all on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) from public, anon;
grant execute on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) to authenticated;

-- 4. start_game ----------------------------------------------------------------
create or replace function public.start_game(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  active_runners integer;
  active_hunters integer;
  field_runners integer;
  field_hunters integer;
  unassigned integer;
  active_total integer;
  missing_consent integer;
  countdown_ends timestamptz;
  live_starts timestamptz;
  round_ends timestamptz;
  hunter_heat_charges integer := 0;
  chosen_agent_id uuid;
  agent_charges integer;
  agent_cooldown integer;
  safe_zone_count integer;
  chosen_carrier_id uuid;
  chosen_vip_id uuid;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g
    where g.id = start_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.host_id <> caller_id then
    raise exception 'Only the host can start the round.';
  end if;
  if current_game.status not in ('lobby', 'target_selection') then
    raise exception 'This game has already started.';
  end if;
  if current_game.mode_id = 'classic_chase' and current_game.status <> 'target_selection' then
    raise exception 'Choose the secret target before starting the round.';
  end if;

  perform public.assert_mode_config(
    current_game.mode_id, current_game.roles, current_game.modifiers
  );

  -- For Jailbreak mode, jail must be placed before start
  if current_game.mode_id = 'jailbreak' then
    if not exists (select 1 from public.entities e where e.game_id = current_game.id and e.kind = 'jail') then
      raise exception 'Place the jail before starting the round.';
    end if;
  end if;

  -- For Relay Heist mode, extraction point must be placed before start
  if current_game.mode_id = 'relay_heist' then
    if not exists (select 1 from public.entities e where e.game_id = current_game.id and e.kind in ('extraction', 'extraction_point')) then
      raise exception 'Place the extraction point before starting the round.';
    end if;
  end if;

  select count(*) filter (where p.team = 'runner'),
         count(*) filter (where p.team = 'hunter'),
         count(*) filter (where p.team = 'runner' and not p.is_remote),
         count(*) filter (where p.team = 'hunter' and not p.is_remote),
         count(*) filter (where p.team = 'unassigned'),
         count(*)
    into active_runners, active_hunters, field_runners, field_hunters, unassigned, active_total
    from public.players p
    where p.game_id = current_game.id and p.status = 'active';

  if current_game.mode_id = 'assassin_ring' then
    if active_total < 3 then
      raise exception 'Assassin Ring requires at least 3 players to form a ring.';
    end if;

    update public.players p
      set team = 'solo'
      where p.game_id = current_game.id and p.status = 'active';

    select count(*) into safe_zone_count
      from public.entities e
      where e.game_id = current_game.id and e.kind = 'safe_zone';

    if safe_zone_count < 2 then
      insert into public.entities (game_id, kind, geog, state, visible_to)
      values
        (current_game.id, 'safe_zone',
         extensions.st_project(current_game.area_center, current_game.area_radius_m * 0.45, radians(0)),
         jsonb_build_object('zone_index', 1, 'radius_m', 20), 'all'),
        (current_game.id, 'safe_zone',
         extensions.st_project(current_game.area_center, current_game.area_radius_m * 0.45, radians(180)),
         jsonb_build_object('zone_index', 2, 'radius_m', 20), 'all');
    end if;

    with shuffled as (
      select p.id,
             row_number() over (order by random()) as rn,
             count(*) over () as total
      from public.players p
      where p.game_id = current_game.id and p.status = 'active'
    ),
    ring as (
      select s1.id as hunter_id,
             s2.id as prey_id
      from shuffled s1
      join shuffled s2 on s2.rn = (case when s1.rn = s1.total then 1 else s1.rn + 1 end)
    )
    insert into public.ring_assignments (game_id, hunter_player_id, prey_player_id, status)
    select current_game.id, hunter_id, prey_id, 'active'
    from ring;

  elsif current_game.mode_id not in ('haunted_map', 'ghost_duel') then
    if active_runners = 0 or active_hunters = 0 then
      raise exception 'Assign at least one runner and one hunter before starting.';
    end if;
    if unassigned > 0 then
      raise exception 'Every player must choose a team before the round starts.';
    end if;
    -- Operator Role: require at least 1 field player per squad
    if 'operator' = any(current_game.roles) then
      if field_runners = 0 then
        raise exception 'Runners require at least one active field runner.';
      end if;
      if field_hunters = 0 then
        raise exception 'Hunters require at least one active field hunter.';
      end if;
    end if;
  else
    if active_runners = 0 and active_hunters = 0 then
      raise exception 'Assign at least one player before starting.';
    end if;
  end if;

  if current_game.mode_id = 'classic_chase'
     and not exists (select 1 from public.targets t where t.game_id = current_game.id) then
    raise exception 'Runners must save the secret target first.';
  end if;

  select count(*) into missing_consent
    from public.players p
    where p.game_id = current_game.id and p.status = 'active' and p.share_trail is null;
  if missing_consent > 0 then
    raise exception 'Every player must choose whether to share their route before the round starts.';
  end if;

  -- Double Agent assignment (exclude remote operators)
  if 'double_agent' = any(current_game.roles) and current_game.mode_id <> 'assassin_ring' then
    if field_hunters >= 2 then
      select p.id into chosen_agent_id
      from public.players p
      where p.game_id = current_game.id and p.team = 'hunter' and p.status = 'active' and not p.is_remote
      order by random()
      limit 1;

      agent_charges := coalesce((current_game.mode_params->'double_agent'->>'scramble_charges')::int, 1);
      agent_cooldown := coalesce((current_game.mode_params->'double_agent'->>'scramble_cooldown_s')::int, 120);

      update public.players
      set secret_role = 'agent',
          status_detail = jsonb_build_object(
            'scramble_available', true,
            'scramble_charges', agent_charges,
            'scramble_cooldown_s', agent_cooldown,
            'whisper_available', true
          )
      where id = chosen_agent_id;

      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id,
        'agent_assigned',
        chosen_agent_id,
        'hunter',
        jsonb_build_object('message', 'You are secretly working as the Double Agent.')
      );
    else
      current_game.roles := array_remove(current_game.roles, 'double_agent');
      update public.games set roles = current_game.roles where id = current_game.id;
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'role_disabled',
        'all',
        jsonb_build_object(
          'role', 'double_agent',
          'reason', 'Requires at least 2 active field hunters to maintain mystery.'
        )
      );
    end if;
  end if;

  -- VIP Escort assignment (exclude remote operators)
  if 'vip' = any(current_game.roles) and current_game.mode_id not in ('assassin_ring', 'relay_heist') then
    if field_runners >= 2 then
      select p.id into chosen_vip_id
      from public.players p
      where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and not p.is_remote
      order by random()
      limit 1;

      update public.players p
      set secret_role = 'vip',
          status_detail = jsonb_build_object('is_vip', true, 'swap_cooldown_until', null)
      where p.id = chosen_vip_id;

      update public.players p
      set secret_role = 'bodyguard',
          status_detail = jsonb_build_object('is_vip', false, 'frozen_until', null, 'swap_cooldown_until', null)
      where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and not p.is_remote and p.id <> chosen_vip_id;

      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id,
        'vip_assigned',
        chosen_vip_id,
        'runner',
        jsonb_build_object('message', 'You are the VIP! Survive and reach extraction.')
      );

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'vip_role_active',
        'runner',
        jsonb_build_object('message', 'VIP Escort is active. Protect your squad VIP!')
      );
    else
      current_game.roles := array_remove(current_game.roles, 'vip');
      update public.games set roles = current_game.roles where id = current_game.id;
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'role_disabled',
        'all',
        jsonb_build_object(
          'role', 'vip',
          'reason', 'VIP Escort requires at least 2 active field runners (1 VIP + 1 bodyguard).'
        )
      );
    end if;
  end if;

  countdown_ends := clock_timestamp() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);
  round_ends := live_starts + make_interval(secs => current_game.duration_s);

  update public.games g
    set status = 'countdown',
        head_start_at = countdown_ends,
        live_at = live_starts,
        ends_at = round_ends,
        ping_interval_s = case
          when 'hot_cold' = any(g.modifiers) or g.mode_id = 'hot_cold' then least(900, g.ping_interval_s * 3)
          else g.ping_interval_s
        end,
        next_ping_at = live_starts + make_interval(secs => case
          when 'hot_cold' = any(g.modifiers) or g.mode_id = 'hot_cold' then least(900, g.ping_interval_s * 3)
          else g.ping_interval_s
        end),
        ping_seq = 0,
        roles = current_game.roles
    where g.id = current_game.id
    returning * into current_game;

  if current_game.mode_id in ('haunted_map', 'ghost_duel') then
    perform public.spawn_ghost_npcs(current_game.id);
  end if;

  if 'dead_drops' = any(current_game.modifiers) then
    perform public.spawn_drops(start_game.game_id, null);
  end if;

  -- Relay Heist package carrier (exclude remote operators)
  if current_game.mode_id = 'relay_heist' then
    select p.id into chosen_carrier_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and not p.is_remote
    order by random()
    limit 1;

    if chosen_carrier_id is not null then
      delete from public.entities where game_id = current_game.id and kind = 'package';
      insert into public.entities (
        game_id,
        kind,
        state,
        visible_to
      ) values (
        current_game.id,
        'package',
        jsonb_build_object(
          'carrier_player_id', chosen_carrier_id,
          'status', 'carried',
          'dropped_at', null,
          'securing_hunter_id', null,
          'securing_started_at', null
        ),
        'runner'
      );
    end if;
  end if;

  insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
  values
    (current_game.id, 'runner', 0, now()),
    (current_game.id, 'hunter', case when 'hot_cold' = any(current_game.modifiers) then 6 else 0 end, now())
  on conflict on constraint team_resources_pkey do update
    set heat_charges = excluded.heat_charges,
        heat_updated_at = excluded.heat_updated_at;

  insert into public.player_resources (player_id, game_id, tokens, charges, cooldowns)
  select p.id, current_game.id, 0, '{}'::jsonb, '{}'::jsonb
  from public.players p
  where p.game_id = current_game.id and p.status = 'active'
  on conflict (player_id) do nothing;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'game_started',
    'all',
    jsonb_build_object(
      'countdown_ends', countdown_ends,
      'live_starts', live_starts,
      'ends_at', round_ends
    )
  );

  return jsonb_build_object(
    'status', current_game.status,
    'head_start_at', countdown_ends,
    'live_at', live_starts,
    'next_ping_at', current_game.next_ping_at,
    'ends_at', round_ends,
    'countdown_ends', countdown_ends,
    'live_starts', live_starts,
    'roles', current_game.roles
  );
end;
$$;

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;

-- 5. get_game_state -----------------------------------------------------------
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
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(game_id) then raise exception 'You are not a member of this game.'; end if;

  perform public.advance_game(get_game_state.game_id);

  select * into current_game from public.games g where g.id = get_game_state.game_id;
  select * into mine from public.players p where p.game_id = get_game_state.game_id and p.user_id = caller_id;

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
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 15)
        )
        from public.entities e
        where e.game_id = g.id and e.kind = 'jail'
        limit 1
      ),
      'extraction', (
        select jsonb_build_object(
          'id', e.id,
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 25)
        )
        from public.entities e
        where e.game_id = g.id and e.kind in ('extraction', 'extraction_point')
        limit 1
      ),
      'package', (
        select jsonb_build_object(
          'id', e.id,
          'status', e.state->>'status',
          'carrier_player_id', e.state->>'carrier_player_id',
          'dropped_at', e.state->>'dropped_at',
          'latitude', case when e.geog is not null then extensions.st_y(e.geog::extensions.geometry) else null end,
          'longitude', case when e.geog is not null then extensions.st_x(e.geog::extensions.geometry) else null end
        )
        from public.entities e
        where e.game_id = g.id and e.kind = 'package'
          and (
            e.state->>'status' = 'dropped'
            or mine.team = 'runner'
            or g.status in ('ended', 'cancelled')
          )
        limit 1
      ),
      'vip_escort', case
        when 'vip' = any(g.roles) then jsonb_build_object(
          'is_active', true,
          'vip_player_id', case
            when mine.team = 'runner' or g.status in ('ended', 'cancelled') then (
              select p.id from public.players p
              where p.game_id = g.id and p.team = 'runner' and p.secret_role = 'vip' and p.status = 'active'
              limit 1
            )
            else null
          end
        )
        else null
      end
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
        'is_remote', p.is_remote,
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
    'markers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'label', e.state->>'label',
        'latitude', extensions.st_y(e.geog::extensions.geometry),
        'longitude', extensions.st_x(e.geog::extensions.geometry),
        'placed_by', e.state->>'placed_by',
        'placed_at', e.state->>'placed_at',
        'expires_at', e.state->>'expires_at'
      ) order by e.updated_at asc)
      from public.entities e
      where e.game_id = g.id
        and e.kind = 'marker'
        and (e.visible_to = 'all' or e.visible_to = mine.team)
        and (e.state->>'expires_at')::timestamptz > now()
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
        and (e.visible_to = 'all' or e.visible_to = mine.team)
        and (e.state->>'expires_at')::timestamptz > now()
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
    'relay_heist', case
      when g.mode_id = 'relay_heist' then jsonb_build_object(
        'extraction', (
          select jsonb_build_object(
            'id', e.id,
            'longitude', extensions.st_x(e.geog::extensions.geometry),
            'latitude', extensions.st_y(e.geog::extensions.geometry),
            'radius_m', coalesce((e.state->>'radius_m')::int, 25)
          )
          from public.entities e
          where e.game_id = g.id and e.kind in ('extraction', 'extraction_point')
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
            when mine.team = 'runner' or g.status in ('ended', 'cancelled') then
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
          where e.game_id = g.id and e.kind = 'package'
          limit 1
        ),
        'is_carrier', exists (
          select 1 from public.entities e
          where e.game_id = g.id and e.kind = 'package'
            and (e.state->>'carrier_player_id') = mine.id::text
            and (e.state->>'status') = 'carried'
        ),
        'handoff_pending_from', (
          select e.state->>'carrier_player_id'
          from public.entities e
          where e.game_id = g.id and e.kind = 'package'
            and (e.state->>'handoff_pending_to') = mine.id::text
            and (e.state->>'handoff_expires_at')::timestamptz > now()
          limit 1
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
        order by ev.id desc limit 50
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

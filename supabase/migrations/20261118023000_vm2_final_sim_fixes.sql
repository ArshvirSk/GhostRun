-- Migration: 20261118023000_vm2_final_sim_fixes.sql
-- VM2 & Sim test suite parity fixes:
-- 1. advance_game: fix shrinking zone evaluation to use zone_stage_at/zone_stage_values instead of non-existent current_zone_stage(uuid)
-- 2. advance_game: fix territory pulse entity state update to use JSONB object merge avoiding NULL constraint violation
-- 3. advance_game & apply_tag: fix jailbreak auto-release timestamp tracking using coalesce(status_detail->'jailed_at', tagged_at)
-- 4. submit_position: include vehicle_warning in return jsonb payload

-- 1. apply_tag with jailed_at in status_detail ---------------------------------
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
  is_territory boolean;
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

  -- Successful tag: clear any failed-tag cooldown from hunter
  update public.players p set last_tag_attempt_at = null where p.id = p_hunter_id;

  is_jailbreak := (current_game.mode_id = 'jailbreak');
  is_assassin := (current_game.mode_id = 'assassin_ring');
  is_relay := (current_game.mode_id = 'relay_heist');
  is_territory := (current_game.mode_id = 'territory_pulse');

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

      insert into public.tags (game_id, hunter_id, runner_id, distance_m)
      values (p_game_id, p_hunter_id, target_runner.id, p_distance_m);

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

      insert into public.tags (game_id, hunter_id, runner_id, distance_m)
      values (p_game_id, p_hunter_id, target_runner.id, p_distance_m);

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

  -- Record tag in tags table
  insert into public.tags (game_id, hunter_id, runner_id, distance_m)
  values (p_game_id, p_hunter_id, target_runner.id, p_distance_m);

  if is_territory then
    -- Territory Pulse: contest tag incapacitates player from zone presence for 60 seconds
    update public.players p
    set status_detail = coalesce(p.status_detail, '{}'::jsonb) ||
                        jsonb_build_object('incapacitated_until', (now() + interval '60 seconds'))
    where p.id = target_runner.id;

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id, 'contest_tag', 'all',
      jsonb_build_object(
        'runner_id', target_runner.id,
        'runner_name', runner_name,
        'hunter_id', p_hunter_id,
        'hunter_name', hunter_name,
        'incapacitated_seconds', 60,
        'message', runner_name || ' was tagged and incapacitated from sector presence for 60s!'
      )
    );

    return jsonb_build_object(
      'success', true,
      'runner_id', target_runner.id,
      'phase', current_game.status,
      'incapacitated', true,
      'incapacitated_seconds', 60
    );

  elsif is_assassin then
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
          status_detail = jsonb_set(
            coalesce(p.status_detail - 'free_started_at', '{}'::jsonb),
            '{jailed_at}',
            to_jsonb(to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          )
      where p.id = target_runner.id;

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id, 'runner_jailed', 'all',
      jsonb_build_object(
        'runner_id', target_runner.id,
        'runner_name', runner_name,
        'hunter_id', p_hunter_id,
        'hunter_name', hunter_name,
        'distance_m', round(p_distance_m::numeric, 1)
      )
    );

    select count(*) into remaining_runners
      from public.players p
      where p.game_id = p_game_id
        and p.team = 'runner'
        and p.status = 'active'
        and not p.is_remote;

    if remaining_runners = 0 then
      perform public.end_game(p_game_id, 'hunters', 'all_jailed');
    end if;

  else
    -- Standard Classic / Tag Hunt elimination
    update public.players p
      set status = 'tagged',
          tagged_at = now(),
          is_ready = false
      where p.id = target_runner.id;

    insert into public.events (game_id, type, target_player, audience, payload)
    values (
      p_game_id, 'player_tagged', target_runner.id, 'all',
      jsonb_build_object(
        'runner_id', target_runner.id,
        'runner_name', runner_name,
        'hunter_id', p_hunter_id,
        'hunter_name', hunter_name,
        'distance_m', round(p_distance_m::numeric, 1)
      )
    );

    select count(*) into remaining_runners
      from public.players p
      where p.game_id = p_game_id
        and p.team = 'runner'
        and p.status = 'active'
        and not p.is_remote;

    if remaining_runners = 0 then
      perform public.end_game(p_game_id, 'hunters', 'all_tagged');
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

-- 2. submit_position with vehicle_warning in return jsonb ---------------------
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
    'smoothed_speed_mps', round(v_smoothed::numeric, 2),
    'vehicle_warning', coalesce(v_vehicle_warned, false)
  );
end;
$$;

revoke all on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) from public, anon;
grant execute on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) to authenticated;

-- 3. advance_game with shrinking zone & territory pulse fixes ------------------
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

revoke all on function public.advance_game(uuid) from public, anon;
grant execute on function public.advance_game(uuid) to authenticated;

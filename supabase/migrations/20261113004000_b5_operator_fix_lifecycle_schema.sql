-- Migration: 20261113004000_b5_operator_fix_lifecycle_schema.sql
-- Fix player_positions column (heading vs heading_deg) and players json mapping in get_game_state

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

  fix_time := coalesce(submit_position.recorded_at, clock_timestamp());
  v_accuracy := submit_position.accuracy::real;
  v_speed := submit_position.speed::real;
  v_heading := submit_position.heading::real;

  -- Discard fixes older than 30 seconds
  if fix_time < clock_timestamp() - interval '30 seconds' then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', clock_timestamp(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner,
      'end_reason', current_game.end_reason,
      'discarded', true,
      'reason', 'fix_too_old'
    );
  end if;

  -- Discard fix if accuracy is worse than 50m
  if v_accuracy is not null and v_accuracy > 50.0 then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', clock_timestamp(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner,
      'end_reason', current_game.end_reason,
      'discarded', true,
      'reason', 'accuracy_too_poor'
    );
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
    pp.vehicle_warned
  into
    v_prev_smoothed,
    v_prev_fast_since,
    v_prev_vehicle_warned
  from public.player_positions pp
  where pp.player_id = me.id;

  if v_speed is not null and v_prev_smoothed is not null then
    v_smoothed := 0.7 * v_speed + 0.3 * v_prev_smoothed;
  else
    v_smoothed := coalesce(v_speed, 0.0);
  end if;

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

    if v_prev_updated is null then
      v_noise := 0;
      v_anchor := fix_geog;
      v_anchor_since := fix_time;
    else
      v_dt := greatest(1.0, least(30.0, extract(epoch from (fix_time - v_prev_updated))));
      v_anchor := coalesce(v_prev_anchor, fix_geog);
      v_anchor_since := coalesce(v_prev_anchor_since, fix_time);

      if v_prev_anchor is not null and extensions.st_distance(fix_geog, v_prev_anchor) > 15.0 then
        v_anchor := fix_geog;
        v_anchor_since := fix_time;
      end if;

      v_noise := v_prev_noise;

      if v_speed is not null and v_speed > 2.5 then
        v_noise := v_noise + round(v_dt * 15.0 * (v_speed - 2.5))::integer;
      elsif v_speed is not null and v_speed < 1.0 then
        v_noise := greatest(0, v_noise - round(v_dt * 5.0)::integer);
      end if;

      if fix_time - v_anchor_since > interval '20 seconds' then
        v_noise := v_noise + round(v_dt * 3.0)::integer;
        if not v_prev_alerted and v_noise >= 80 then
          update public.games g set ping_seq = g.ping_seq + 1
            where g.id = current_game.id
            returning g.ping_seq into v_camp_seq;
          insert into public.pings (
            game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
          ) values (
            current_game.id, v_camp_seq, me.id, fix_geog,
            coalesce(v_accuracy, 15.0), 0, 'camping_threshold', clock_timestamp()
          );
        end if;
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
        coalesce(v_accuracy, 15.0), 0, 'noise_threshold', clock_timestamp()
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
    player_id, game_id, geog, accuracy_m, speed_mps, heading,
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
    heading = excluded.heading,
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
    'server_time', clock_timestamp(),
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

-- 2. get_game_state -----------------------------------------------------------
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
      'relay_heist', case
        when g.mode_id = 'relay_heist' then jsonb_build_object(
          'extraction', (
            select jsonb_build_object(
              'latitude', extensions.st_y(e.geog::extensions.geometry),
              'longitude', extensions.st_x(e.geog::extensions.geometry),
              'radius_m', coalesce((e.state->>'radius_m')::int, 25)
            )
            from public.entities e
            where e.game_id = g.id and e.kind = 'extraction'
            limit 1
          ),
          'package_status', (
            select e.state->>'status'
            from public.entities e
            where e.game_id = g.id and e.kind = 'package'
            limit 1
          ),
          'dropped_package_location', case
            when exists (
              select 1 from public.entities e
              where e.game_id = g.id and e.kind = 'package' and e.state->>'status' = 'dropped'
            ) then (
              select jsonb_build_object(
                'latitude', extensions.st_y(e.geog::extensions.geometry),
                'longitude', extensions.st_x(e.geog::extensions.geometry)
              )
              from public.entities e
              where e.game_id = g.id and e.kind = 'package'
              limit 1
            )
            else null
          end,
          'carrier_visible', (
            select case
              when e.state->>'status' = 'dropped' then true
              when mine.team = 'runner' then true
              when g.status in ('ended', 'cancelled') then true
              else false
            end
            from public.entities e
            where e.game_id = g.id and e.kind = 'package'
            limit 1
          )
        )
        else null
      end,
      'vip_escort', case
        when 'vip' = any(g.roles) then jsonb_build_object(
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
    'my_player_id', mine.id,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'user_id', p.user_id,
        'team', p.team,
        'status', p.status,
        'is_ready', p.is_ready,
        'is_remote', coalesce(p.is_remote, false),
        'jailed_at', case when p.status = 'jailed' then p.tagged_at else null end,
        'frozen_until', p.status_detail->>'frozen_until',
        'secret_role', case
          when g.status in ('ended', 'cancelled') or p.id = mine.id then p.secret_role
          when 'vip' = any(g.roles) and mine.team = 'runner' and p.team = 'runner' then p.secret_role
          else null
        end,
        'pending_role_swap', case
          when p.id = mine.id then p.status_detail->'pending_role_swap'
          else null
        end,
        'display_name', pr.display_name,
        'color', pr.color,
        'joined_at', p.joined_at
      ) order by p.joined_at)
      from public.players p
      left join public.profiles pr on pr.id = p.user_id
      where p.game_id = g.id and p.status <> 'left'
    ), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', pp.player_id,
        'latitude', extensions.st_y(pp.geog::extensions.geometry),
        'longitude', extensions.st_x(pp.geog::extensions.geometry),
        'accuracy_m', pp.accuracy_m,
        'speed_mps', pp.speed_mps,
        'heading_deg', pp.heading,
        'recorded_at', pp.recorded_at,
        'is_mock', pp.is_mock,
        'in_bounds', pp.in_bounds
      ))
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      where pp.game_id = g.id
        and not p.is_remote
        and (
          g.status in ('ended', 'cancelled')
          or p.id = mine.id
          or (mine.team <> 'solo' and p.team = mine.team and p.status <> 'jailed')
        )
    ), '[]'::jsonb),
    'pings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seq', pi.seq,
        'latitude', extensions.st_y(pi.geog::extensions.geometry),
        'longitude', extensions.st_x(pi.geog::extensions.geometry),
        'accuracy_m', pi.accuracy_m,
        'released_at', pi.released_at,
        'position_age_s', pi.position_age_s,
        'reason', pi.reason
      ) order by pi.seq desc)
      from public.pings pi
      where pi.game_id = g.id
        and (
          g.status in ('ended', 'cancelled')
          or pi.released_at >= (clock_timestamp() - make_interval(secs => g.ping_visible_s))
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
          left join public.profiles prey_pr on prey_pr.id = prey_p.user_id
          where ra.game_id = g.id and ra.hunter_player_id = mine.id
        ),
        'safe_zones', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id,
            'latitude', extensions.st_y(e.geog::extensions.geometry),
            'longitude', extensions.st_x(e.geog::extensions.geometry),
            'radius_m', coalesce((e.state->>'radius_m')::int, 20)
          ))
          from public.entities e
          where e.game_id = g.id and e.kind = 'safe_zone'
        ), '[]'::jsonb),
        'in_safe_zone', coalesce((
          select true from public.entities e
          join public.player_positions pp on pp.player_id = mine.id
          where e.game_id = g.id and e.kind = 'safe_zone'
            and extensions.st_dwithin(pp.geog, e.geog, coalesce((e.state->>'radius_m')::int, 20))
          limit 1
        ), false),
        'hunter_proximity', (
          select case
            when exists (
              select 1 from public.ring_assignments ra
              join public.players hp on hp.id = ra.hunter_player_id
              join public.player_positions hpp on hpp.player_id = hp.id
              join public.player_positions mypos on mypos.player_id = mine.id
              where ra.game_id = g.id
                and ra.prey_player_id = mine.id
                and hp.status = 'active'
                and extensions.st_dwithin(hpp.geog, mypos.geog, 40)
            ) then 'close'
            when exists (
              select 1 from public.ring_assignments ra
              join public.players hp on hp.id = ra.hunter_player_id
              join public.player_positions hpp on hpp.player_id = hp.id
              join public.player_positions mypos on mypos.player_id = mine.id
              where ra.game_id = g.id
                and ra.prey_player_id = mine.id
                and hp.status = 'active'
                and extensions.st_dwithin(hpp.geog, mypos.geog, 100)
            ) then 'near'
            else 'none'
          end
        )
      )
      else null
    end,
    'package_carrier', case
      when g.mode_id = 'relay_heist' then (
        select jsonb_build_object(
          'id', p.id,
          'display_name', pr.display_name,
          'color', pr.color,
          'is_carrier', (p.id = mine.id),
          'handoff_pending_from', (
            select e.state->>'handoff_from_id'
            from public.entities e
            where e.game_id = g.id and e.kind = 'package'
              and e.state->>'handoff_to_id' = mine.id::text
          )
        )
        from public.entities e
        join public.players p on p.id::text = e.state->>'carrier_player_id'
        left join public.profiles pr on pr.id = p.user_id
        where e.game_id = g.id and e.kind = 'package'
          and (
            e.state->>'status' = 'dropped'
            or mine.team = 'runner'
            or g.status in ('ended', 'cancelled')
          )
        limit 1
      )
      else null
    end,
    'events', coalesce((
      select jsonb_agg(to_jsonb(ev) order by ev.created_at desc)
      from public.events ev
      where ev.game_id = g.id
        and (
          ev.audience = 'all'
          or (ev.audience = 'runner' and mine.team = 'runner')
          or (ev.audience = 'hunter' and mine.team = 'hunter')
          or (ev.target_player is not null and ev.target_player = mine.id)
        )
    ), '[]'::jsonb),
    'ghosts', case when g.mode_id in ('haunted_map', 'ghost_duel') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', npc.id,
        'label', npc.label,
        'latitude', extensions.st_y(npc.current_point),
        'longitude', extensions.st_x(npc.current_point),
        'is_blip', true
      ))
      from public.game_npcs npc
      where npc.game_id = g.id
        and npc.status = 'active'
        and (
          g.ghost_mode = 'assist'
          or (
            g.ghost_mode = 'haunt'
            and mine.team = 'runner'
            and exists (
              select 1 from public.player_positions pp
              where pp.player_id = mine.id
                and extensions.st_dwithin(npc.geog, pp.geog, 50)
            )
          )
        )
    ), '[]'::jsonb) else '[]'::jsonb end,
    'target', case
      when mine.team = 'runner' or g.status in ('ended', 'cancelled') then (
        select jsonb_build_object(
          'id', p.id,
          'display_name', pr.display_name,
          'color', pr.color
        )
        from public.targets t
        join public.players p on p.id = t.runner_id
        left join public.profiles pr on pr.id = p.user_id
        where t.game_id = g.id
        limit 1
      )
      else null
    end,
    'heat_marks', case when mine.team = 'hunter' or g.status in ('ended', 'cancelled') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'latitude', round(extensions.st_y(hp.hunter_geog::extensions.geometry)::numeric, 6),
        'longitude', round(extensions.st_x(hp.hunter_geog::extensions.geometry)::numeric, 6),
        'result', hp.result,
        'pressed_at', hp.pressed_at,
        'fuzzed_radius_m', hp.fuzzed_radius_m
      ) order by hp.pressed_at desc)
      from public.heat_presses hp
      where hp.game_id = g.id and hp.pressed_at >= (clock_timestamp() - interval '5 minutes')
    ), '[]'::jsonb) else '[]'::jsonb end,
    'heat_charges', case when mine.team = 'hunter' then (
      select tr.heat_charges from public.team_resources tr
      where tr.game_id = g.id and tr.team = 'hunter'
    ) else null end
  ) into snapshot
  from public.games g
  where g.id = get_game_state.game_id;

  return snapshot;
end;
$$;

revoke all on function public.get_game_state(uuid) from public, anon;
grant execute on function public.get_game_state(uuid) to authenticated;

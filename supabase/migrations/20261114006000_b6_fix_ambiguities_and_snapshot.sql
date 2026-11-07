-- Fix ambiguities in tag_ghost & submit_position, and expose ghost_duel snapshot at top level of get_game_state

-- 1. tag_ghost: table-qualify game_id to avoid PL/pgSQL ambiguity
create or replace function public.tag_ghost(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  my_fix public.player_positions%rowtype;
  ghost_ent public.entities%rowtype;
  dist_m double precision;
  ghost_duration double precision;
  elapsed double precision;
  final_score integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g where g.id = tag_ghost.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then raise exception 'The round is not live.'; end if;
  if current_game.mode_id <> 'ghost_duel' then raise exception 'tag_ghost is only for Ghost Duel.'; end if;

  select * into me from public.players p where p.game_id = tag_ghost.game_id and p.user_id = caller_id and p.status = 'active';
  if not found then raise exception 'Active player not found.'; end if;

  select * into my_fix from public.player_positions pp where pp.player_id = me.id;
  if not found or my_fix.recorded_at < now() - interval '15 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_fix');
  end if;

  select * into ghost_ent from public.entities e where e.game_id = tag_ghost.game_id and e.kind = 'ghost' limit 1;
  if not found or ghost_ent.geog is null then
    return jsonb_build_object('success', false, 'reason', 'no_ghost');
  end if;

  dist_m := extensions.st_distance(my_fix.geog, ghost_ent.geog);
  if dist_m > 10.0 then
    return jsonb_build_object('success', false, 'reason', 'out_of_range', 'distance_m', round(dist_m::numeric, 1));
  end if;

  ghost_duration := coalesce((ghost_ent.state->>'duration_s')::double precision, 240.0);
  elapsed := extract(epoch from (now() - current_game.live_at));
  final_score := greatest(100, round(1000 + ((ghost_duration - elapsed) * 10))::int);

  insert into public.ghost_duel_scores (
    game_id, user_id, variant, area_center, player_time_s, ghost_time_s, delta_s, efficiency, score
  ) values (
    current_game.id, caller_id, 'mirror_chase', current_game.area_center, elapsed, ghost_duration, ghost_duration - elapsed, 1.0, final_score
  );

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'ghost_tagged',
    'all',
    jsonb_build_object('player_id', me.id, 'score', final_score, 'time_s', elapsed, 'message', 'Ghost caught! Hunter wins!')
  );

  perform public.end_game(current_game.id, 'hunters', 'ghost_tagged');

  return jsonb_build_object('success', true, 'score', final_score, 'distance_m', round(dist_m::numeric, 1), 'game_ended', true);
end;
$$;

revoke all on function public.tag_ghost(uuid) from public, anon;
grant execute on function public.tag_ghost(uuid) to authenticated;

-- 2. submit_position: table-qualify entities.game_id in Ghost Duel check
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
  fix_geog extensions.geography;
  fix_time timestamptz;
  v_accuracy real;
  v_speed real;
  v_heading real;
  v_in_bounds boolean;
  v_radius integer;
  v_noise real;
  v_prev_fix record;
  v_dt double precision;
  v_dist double precision;
  v_inst_speed double precision;
  v_prev_smoothed double precision;
  v_smoothed double precision;
  v_out_since timestamptz;
  v_penalty text;
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

  perform public.advance_game(submit_position.game_id);

  select * into current_game from public.games g
    where g.id = submit_position.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players p
    where p.game_id = submit_position.game_id
      and p.user_id = caller_id;
  if not found then raise exception 'Player not in this game.'; end if;

  if me.status in ('left', 'tagged') then
    return jsonb_build_object(
      'phase', current_game.status,
      'my_status', me.status,
      'server_time', clock_timestamp()
    );
  end if;

  -- Jailed runners cannot submit normal position movements
  if me.status = 'jailed' then
    return jsonb_build_object(
      'phase', current_game.status,
      'my_status', me.status,
      'jailed', true,
      'server_time', clock_timestamp(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at
    );
  end if;

  -- Remote operators: cannot submit physical field fixes
  if coalesce(me.is_remote, false) then
    return jsonb_build_object(
      'phase', current_game.status,
      'my_status', me.status,
      'is_remote', true,
      'server_time', clock_timestamp(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at
    );
  end if;

  -- Frozen bodyguards: cannot move while frozen
  if me.status_detail ? 'frozen_until' and (me.status_detail->>'frozen_until')::timestamptz > clock_timestamp() then
    return jsonb_build_object(
      'phase', current_game.status,
      'my_status', me.status,
      'frozen', true,
      'frozen_until', me.status_detail->>'frozen_until',
      'server_time', clock_timestamp(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at
    );
  end if;

  if submit_position.lat is null or submit_position.lng is null or
     submit_position.lat < -90 or submit_position.lat > 90 or
     submit_position.lng < -180 or submit_position.lng > 180 then
    raise exception 'Invalid GPS coordinates.';
  end if;

  fix_time := coalesce(submit_position.recorded_at, now());
  if fix_time > now() + interval '5 seconds' then
    fix_time := now();
  end if;

  v_accuracy := coalesce(submit_position.accuracy, 10)::real;
  v_speed := submit_position.speed::real;
  v_heading := submit_position.heading::real;

  fix_geog := extensions.st_setsrid(
    extensions.st_makepoint(submit_position.lng, submit_position.lat),
    4326
  )::extensions.geography;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_dwithin(fix_geog, current_game.area_center, v_radius);

  select * into v_prev_fix
    from public.player_positions pp
    where pp.player_id = me.id;

  insert into public.player_positions (
    player_id, geog, accuracy_m, speed_mps, heading_deg,
    recorded_at, synced_at, is_mock, out_of_bounds_since, smoothed_speed_mps
  ) values (
    me.id, fix_geog, v_accuracy, v_speed, v_heading,
    fix_time, now(), coalesce(submit_position.is_mock, false), v_out_since,
    round(coalesce(v_smoothed, 0)::numeric, 2)
  ) on conflict (player_id) do update set
    geog = excluded.geog,
    accuracy_m = excluded.accuracy_m,
    speed_mps = excluded.speed_mps,
    heading_deg = excluded.heading_deg,
    recorded_at = excluded.recorded_at,
    synced_at = excluded.synced_at,
    is_mock = excluded.is_mock,
    out_of_bounds_since = excluded.out_of_bounds_since,
    smoothed_speed_mps = excluded.smoothed_speed_mps;

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

  -- Relay Heist extraction check
  if current_game.status = 'live'
     and current_game.mode_id = 'relay_heist'
     and me.team = 'runner'
     and me.status = 'active'
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
    select * into current_game from public.games g where g.id = submit_position.game_id;
  end if;

  -- Ghost Duel win conditions
  if current_game.mode_id = 'ghost_duel' and current_game.status = 'live' then
    v_duel_variant := coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial');
    select * into v_duel_target from public.entities e where e.game_id = current_game.id and e.kind = 'target' limit 1;
    select * into v_ghost_ent from public.entities e where e.game_id = current_game.id and e.kind = 'ghost' limit 1;

    if v_duel_variant in ('time_trial', 'evade') and me.team = 'runner' then
      -- Evade collision check: if runner enters within 20m of ghost hunter
      if v_duel_variant = 'evade' and v_ghost_ent.geog is not null and extensions.st_dwithin(fix_geog, v_ghost_ent.geog, 20.0) then
        insert into public.events (game_id, type, target_player, audience, payload)
        values (
          current_game.id, 'haunted', me.id, 'all',
          jsonb_build_object('player_id', me.id, 'message', 'Caught by ghost! Run failed.')
        );
        perform public.end_game(current_game.id, 'hunters', 'haunted');
        select * into current_game from public.games g where g.id = submit_position.game_id;
      -- Target arrival check
      elsif v_duel_target.geog is not null and extensions.st_dwithin(fix_geog, v_duel_target.geog, coalesce((v_duel_target.state->>'radius_m')::int, 20)) then
        v_p_time := round(extract(epoch from (now() - current_game.live_at))::numeric, 2);
        v_g_time := coalesce((v_ghost_ent.state->>'duration_s')::double precision, 240.0);
        v_delta := round((v_g_time - v_p_time)::numeric, 2);

        -- Route efficiency
        v_straight_m := extensions.st_distance(current_game.area_center, v_duel_target.geog);
        select coalesce(sum(extensions.st_distance(tp1.geog, tp2.geog)), v_straight_m)
          into v_actual_m
          from public.trail_points tp1
          join public.trail_points tp2 on tp2.player_id = tp1.player_id and tp2.recorded_at > tp1.recorded_at
          where tp1.player_id = me.id and tp1.game_id = current_game.id;
        if v_actual_m > 0 then
          v_eff := least(1.0, greatest(0.1, (v_straight_m / greatest(1.0, v_actual_m))))::real;
        end if;

        v_score := greatest(100, round(1000 + (v_delta * 10) + (v_eff * 200))::int);

        insert into public.ghost_duel_scores (
          game_id, user_id, variant, area_center, player_time_s, ghost_time_s, delta_s, efficiency, score
        ) values (
          current_game.id, caller_id, v_duel_variant, current_game.area_center, v_p_time, v_g_time, v_delta, v_eff, v_score
        );

        insert into public.events (game_id, type, target_player, audience, payload)
        values (
          current_game.id, 'ghost_duel_finished', me.id, 'all',
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
    'smoothed_speed_mps', round(coalesce(v_smoothed, 0)::numeric, 2)
  );
end;
$$;

-- 3. get_game_state: expose ghost_duel snapshot both at top level and inside game
create or replace function public.get_game_state(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  mine public.players%rowtype;
  v_ghost_duel jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(game_id) then raise exception 'You are not a member of this game.'; end if;

  perform public.advance_game(get_game_state.game_id);

  select * into current_game from public.games g where g.id = get_game_state.game_id;
  select * into mine from public.players p where p.game_id = get_game_state.game_id and p.user_id = caller_id;

  v_ghost_duel := case
    when current_game.mode_id = 'ghost_duel' then jsonb_build_object(
      'variant', coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial'),
      'target', (
        select jsonb_build_object(
          'id', e.id,
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 20)
        )
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'target'
        limit 1
      ),
      'ghost', (
        select jsonb_build_object(
          'id', e.id,
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'duration_s', coalesce((e.state->>'duration_s')::int, 240),
          'elapsed_s', greatest(0, extract(epoch from (clock_timestamp() - current_game.live_at))::int),
          'total_length_m', coalesce((e.state->>'total_length_m')::real, 0),
          'path_wkt', e.state->>'path_wkt'
        )
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'ghost'
        limit 1
      )
    )
    else null
  end;

  return jsonb_build_object(
    'server_time', clock_timestamp(),
    'ghost_duel', v_ghost_duel,
    'game', to_jsonb(current_game) || jsonb_build_object(
      'area', jsonb_build_object(
        'longitude', extensions.st_x(current_game.area_center::extensions.geometry),
        'latitude', extensions.st_y(current_game.area_center::extensions.geometry),
        'radius_m', public.effective_radius_m(current_game.id),
        'base_radius_m', current_game.area_radius_m,
        'zone_stage', current_game.zone_stage,
        'zone_stage_count', array_length(public.zone_stage_values(current_game.id), 1),
        'shrinking', 'shrinking_zone' = any(current_game.modifiers)
      ),
      'target_set', exists (select 1 from public.targets t where t.game_id = current_game.id),
      'ping_visible_s', current_game.ping_visible_s,
      'ghost_mode', current_game.ghost_mode,
      'jail', (
        select jsonb_build_object(
          'id', e.id,
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 15)
        )
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'jail'
        limit 1
      ),
      'jail_rules', case
        when current_game.mode_id = 'jailbreak' then jsonb_build_object(
          'auto_release_s', coalesce((current_game.mode_params->'jailbreak'->>'auto_release_s')::int, 300),
          'release_hold_s', coalesce((current_game.mode_params->'jailbreak'->>'release_hold_s')::int, 10),
          'release_radius_m', coalesce((current_game.mode_params->'jailbreak'->>'release_radius_m')::int, 10)
        )
        else null
      end,
      'ghost_duel', v_ghost_duel,
      'relay_heist', case
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
                  'dropped_at', e.state->>'dropped_at',
                  'longitude', extensions.st_x(e.geog::extensions.geometry),
                  'latitude', extensions.st_y(e.geog::extensions.geometry),
                  'securing_hunter_id', e.state->>'securing_hunter_id',
                  'securing_started_at', e.state->>'securing_started_at'
                )
              when (e.state->>'status') = 'carried' and (e.state->>'handoff_pending_to') is not null then
                jsonb_build_object(
                  'status', 'carried',
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
      end,
      'vip_escort', case
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
      end
    ),
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
          when current_game.status in ('ended', 'cancelled') or p.id = mine.id then p.secret_role
          when 'vip' = any(current_game.roles) and mine.team = 'runner' and p.team = 'runner' then p.secret_role
          else null
        end
      ) order by p.joined_at asc)
      from public.players p
      join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id and p.status <> 'left'
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(ev) order by ev.created_at asc)
      from public.events ev
      where ev.game_id = current_game.id
    ), '[]'::jsonb)
  );
end;
$$;
